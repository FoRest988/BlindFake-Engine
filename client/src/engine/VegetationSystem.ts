/**
 * VegetationSystem — GPU-instanced vegetation scattering for terrain.
 * - Scatter grass, flowers, bushes, trees per terrain layer
 * - LOD distance culling
 * - Wind animation via vertex shader
 * - Density painting support
 */

import * as THREE from 'three';
import type { TerrainSystem } from './TerrainSystem';

export interface VegetationLayer {
  name: string;
  mesh: THREE.BufferGeometry;
  material: THREE.Material;
  density: number;          // instances per square unit
  minScale: number;
  maxScale: number;
  alignToNormal: boolean;
  randomRotation: boolean;
  splatChannel: number;     // 0=R, 1=G, 2=B, 3=A — which splat layer triggers this
  splatThreshold: number;   // minimum splat weight to place instance (0-1)
  maxSlope: number;         // max terrain slope (degrees) for placement
  minHeight: number;
  maxHeight: number;
  lodDistance: number;       // distance beyond which instances are hidden
  windStrength: number;
}

const WIND_VERTEX = /* glsl */`
  uniform float time;
  uniform float windStrength;
  attribute vec3 instanceOffset;
  attribute float instanceScale;
  attribute float instanceRotation;

  varying vec2 vUv;
  varying vec3 vNormal;

  mat3 rotateY(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat3(c, 0, s, 0, 1, 0, -s, 0, c);
  }

  void main() {
    vUv = uv;

    vec3 pos = position * instanceScale;
    pos = rotateY(instanceRotation) * pos;

    // Wind sway (stronger at top)
    float heightFactor = clamp(position.y / 2.0, 0.0, 1.0);
    float wind = sin(time * 2.0 + instanceOffset.x * 0.1 + instanceOffset.z * 0.15) * windStrength * heightFactor;
    pos.x += wind;
    pos.z += wind * 0.5;

    pos += instanceOffset;

    vNormal = normalize(normalMatrix * (rotateY(instanceRotation) * normal));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const WIND_FRAGMENT = /* glsl */`
  uniform sampler2D map;
  uniform vec3 color;
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vec4 texColor = texture2D(map, vUv);
    if (texColor.a < 0.5) discard;

    float NdotL = max(dot(vNormal, normalize(vec3(0.5, 1.0, 0.3))), 0.0);
    vec3 lit = texColor.rgb * color * (0.4 + 0.6 * NdotL);
    gl_FragColor = vec4(lit, texColor.a);
  }
`;

export class VegetationSystem {
  private terrain: TerrainSystem;
  private layers: VegetationLayerInstance[] = [];
  private parent: THREE.Object3D;
  private elapsed = 0;

  constructor(terrain: TerrainSystem, parent: THREE.Object3D) {
    this.terrain = terrain;
    this.parent = parent;
  }

  addLayer(config: VegetationLayer): void {
    const layer = new VegetationLayerInstance(config, this.terrain, this.parent);
    this.layers.push(layer);
    layer.generate();
  }

  removeLayer(name: string): void {
    const idx = this.layers.findIndex(l => l.config.name === name);
    if (idx >= 0) {
      this.layers[idx].dispose();
      this.layers.splice(idx, 1);
    }
  }

  /** Call each frame to animate wind */
  update(delta: number, cameraPosition: THREE.Vector3): void {
    this.elapsed += delta;
    for (const layer of this.layers) {
      layer.update(this.elapsed, cameraPosition);
    }
  }

  /** Regenerate all vegetation (call after terrain edit) */
  regenerate(): void {
    for (const layer of this.layers) {
      layer.generate();
    }
  }

  getLayers(): VegetationLayer[] {
    return this.layers.map(l => l.config);
  }

  dispose(): void {
    for (const layer of this.layers) layer.dispose();
    this.layers.length = 0;
  }
}

class VegetationLayerInstance {
  public config: VegetationLayer;
  private terrain: TerrainSystem;
  private parent: THREE.Object3D;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private windMaterial: THREE.ShaderMaterial | null = null;
  private instanceCount = 0;

  constructor(config: VegetationLayer, terrain: TerrainSystem, parent: THREE.Object3D) {
    this.config = config;
    this.terrain = terrain;
    this.parent = parent;
  }

  generate(): void {
    this.dispose();

    const cfg = this.config;
    const terrainCfg = this.terrain.getConfig();
    const splatData = this.terrain.getSplatData();
    const heightData = this.terrain.getHeightData();
    const res = terrainCfg.resolution;

    if (!splatData || !heightData) return;

    // Collect valid positions
    const positions: THREE.Vector3[] = [];
    const normals: THREE.Vector3[] = [];
    const cellW = terrainCfg.width / res;
    const cellD = terrainCfg.depth / res;
    const maxSlopeRad = (cfg.maxSlope / 180) * Math.PI;

    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const idx = (z * res + x) * 4;
        const splatWeight = splatData[idx + cfg.splatChannel] / 255;
        if (splatWeight < cfg.splatThreshold) continue;

        const height = heightData[z * res + x] * terrainCfg.maxHeight;
        if (height < cfg.minHeight || height > cfg.maxHeight) continue;

        // Compute normal for slope check
        const hL = x > 0 ? heightData[z * res + (x - 1)] * terrainCfg.maxHeight : height;
        const hR = x < res - 1 ? heightData[z * res + (x + 1)] * terrainCfg.maxHeight : height;
        const hU = z > 0 ? heightData[(z - 1) * res + x] * terrainCfg.maxHeight : height;
        const hD = z < res - 1 ? heightData[(z + 1) * res + x] * terrainCfg.maxHeight : height;
        const norm = new THREE.Vector3(hL - hR, 2 * cellW, hU - hD).normalize();
        const slope = Math.acos(Math.min(1, norm.y));
        if (slope > maxSlopeRad) continue;

        // Multiple instances per cell based on density
        const numInCell = Math.max(1, Math.floor(cfg.density * cellW * cellD * splatWeight));
        for (let i = 0; i < numInCell; i++) {
          const px = (x + Math.random()) * cellW - terrainCfg.width / 2;
          const pz = (z + Math.random()) * cellD - terrainCfg.depth / 2;
          positions.push(new THREE.Vector3(px, height, pz));
          normals.push(norm);
        }
      }
    }

    if (positions.length === 0) return;

    // Limit instance count for performance
    const maxInstances = Math.min(positions.length, 65536);
    this.instanceCount = maxInstances;

    // Create InstancedMesh
    this.instancedMesh = new THREE.InstancedMesh(
      cfg.mesh,
      cfg.material,
      maxInstances
    );
    this.instancedMesh.name = `Vegetation_${cfg.name}`;
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = false;
    this.instancedMesh.frustumCulled = false;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < maxInstances; i++) {
      const p = positions[i];
      const scale = cfg.minScale + Math.random() * (cfg.maxScale - cfg.minScale);
      dummy.position.copy(p);
      dummy.scale.setScalar(scale);

      if (cfg.randomRotation) {
        dummy.rotation.y = Math.random() * Math.PI * 2;
      }
      if (cfg.alignToNormal) {
        const n = normals[i];
        dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      }

      dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    this.parent.add(this.instancedMesh);
  }

  update(elapsed: number, _cameraPosition: THREE.Vector3): void {
    // If using custom wind shader material, update time uniform
    if (this.windMaterial) {
      this.windMaterial.uniforms.time.value = elapsed;
    }
  }

  dispose(): void {
    if (this.instancedMesh) {
      this.parent.remove(this.instancedMesh);
      this.instancedMesh.geometry.dispose();
      if (this.instancedMesh.material instanceof THREE.Material) {
        this.instancedMesh.material.dispose();
      }
      this.instancedMesh = null;
    }
    if (this.windMaterial) {
      this.windMaterial.dispose();
      this.windMaterial = null;
    }
  }

  /** Create wind-animated shader material for grass/foliage */
  static createWindMaterial(texture: THREE.Texture, color = new THREE.Color(0x55aa33), windStrength = 0.3): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        color: { value: color },
        time: { value: 0 },
        windStrength: { value: windStrength },
      },
      vertexShader: WIND_VERTEX,
      fragmentShader: WIND_FRAGMENT,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
    });
  }
}
