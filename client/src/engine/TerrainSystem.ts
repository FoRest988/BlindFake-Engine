/**
 * TerrainSystem — Heightmap-based terrain with:
 * - Multi-layer texture splatting (up to 4 textures blended via splatmap)
 * - Runtime heightmap editing (raise/lower/smooth/flatten)
 * - LOD chunks for large terrains
 * - Collision mesh generation
 * - Terrain painting (texture weights)
 * - Import/export heightmaps (PNG grayscale)
 */

import * as THREE from 'three';

export interface TerrainConfig {
  /** Width in world units */
  width: number;
  /** Depth in world units */
  depth: number;
  /** Max height */
  maxHeight: number;
  /** Resolution (vertices per side) */
  resolution: number;
  /** Number of chunks per side (for LOD) */
  chunks: number;
  /** Grid offset for multi-tile terrains */
  gridX?: number;
  gridZ?: number;
}

export interface TerrainLayer {
  name: string;
  diffuse: THREE.Texture;
  normal?: THREE.Texture;
  tiling: number; // UV repeat
}

export type TerrainBrush = 'raise' | 'lower' | 'smooth' | 'flatten' | 'paint' | 'noise' | 'ramp';

/** Saved terrain state for undo/redo */
export interface TerrainSnapshot {
  heightData: Float32Array;
  splatData: Uint8Array;
  splatData2: Uint8Array;
}

/** FBM procedural noise parameters */
export interface NoiseParams {
  scale?: number;       // default 1
  octaves?: number;     // default 6
  persistence?: number; // default 0.5
  lacunarity?: number;  // default 2
  amplitude?: number;   // default 1 (multiplied by maxHeight)
  offsetX?: number;
  offsetZ?: number;
  additive?: boolean;   // add to existing height vs replace
}

/** Runtime foliage layer */
export interface FoliageLayerConfig {
  name: string;
  mesh: THREE.InstancedMesh;
  scaleMin: number;
  scaleMax: number;
  /** Minimum slope angle in degrees (0 = flat ground). Instances are placed only where slope is between slopeMin..slopeMax */
  slopeMin?: number;
  /** Maximum slope angle in degrees (90 = vertical cliff) */
  slopeMax?: number;
}

// ── FBM Noise helpers (used for procedural terrain generation) ─────────────
function _noiseHash(ix: number, iz: number): number {
  let n = ix + iz * 57;
  n = (n << 13) ^ n;
  const nn = Math.imul(n, n);
  return 1 - ((Math.imul(n, (Math.imul(nn, 15731) + 789221) | 0) + 1376312589) & 0x7fffffff) / 1073741824;
}

function _valueNoise2D(x: number, z: number): number {
  const ix = Math.floor(x); const iz = Math.floor(z);
  const fx = x - ix;        const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  return _noiseHash(ix,   iz  ) * (1 - ux) * (1 - uz)
       + _noiseHash(ix+1, iz  ) * ux       * (1 - uz)
       + _noiseHash(ix,   iz+1) * (1 - ux) * uz
       + _noiseHash(ix+1, iz+1) * ux       * uz;
}

function _fbm(x: number, z: number, octaves: number, persistence: number, lacunarity: number): number {
  let val = 0, amp = 1, freq = 1, maxVal = 0;
  for (let i = 0; i < octaves; i++) {
    val += _valueNoise2D(x * freq, z * freq) * amp;
    maxVal += amp;
    amp  *= persistence;
    freq *= lacunarity;
  }
  return val / maxVal;
}

const DEFAULT_CONFIG: TerrainConfig = {
  width: 256,
  depth: 256,
  maxHeight: 50,
  resolution: 256,
  chunks: 4,
};

/** Terrain vertex/fragment shader with splatmap blending */
const TERRAIN_VERTEX = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    vHeight = position.y;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const TERRAIN_FRAGMENT = /* glsl */`
  uniform sampler2D splatMap;
  uniform sampler2D splatMap2;
  uniform sampler2D layer0Diffuse; uniform sampler2D layer1Diffuse;
  uniform sampler2D layer2Diffuse; uniform sampler2D layer3Diffuse;
  uniform sampler2D layer4Diffuse; uniform sampler2D layer5Diffuse;
  uniform sampler2D layer6Diffuse; uniform sampler2D layer7Diffuse;
  uniform float layer0Tiling; uniform float layer1Tiling;
  uniform float layer2Tiling; uniform float layer3Tiling;
  uniform float layer4Tiling; uniform float layer5Tiling;
  uniform float layer6Tiling; uniform float layer7Tiling;
  uniform float layer0Roughness; uniform float layer1Roughness;
  uniform float layer2Roughness; uniform float layer3Roughness;
  uniform float layer4Roughness; uniform float layer5Roughness;
  uniform float layer6Roughness; uniform float layer7Roughness;
  uniform float maxHeight;
  uniform vec3 sunDirection;
  uniform int  blendVizLayer;
  uniform float waterLevel;
  uniform int   enableShoreFoam;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;

  void main() {
    vec4 splat  = texture2D(splatMap,  vUv);
    vec4 splat2 = texture2D(splatMap2, vUv);
    float w0=splat.r, w1=splat.g, w2=splat.b, w3=splat.a;
    float w4=splat2.r,w5=splat2.g, w6=splat2.b,w7=splat2.a;
    float tw = w0+w1+w2+w3+w4+w5+w6+w7;
    if (tw < 0.001) { w0 = 1.0; tw = 1.0; }

    // Blend visualization overlay
    if (blendVizLayer >= 0) {
      float wv = blendVizLayer==0 ? w0 : blendVizLayer==1 ? w1 : blendVizLayer==2 ? w2 :
                 blendVizLayer==3 ? w3 : blendVizLayer==4 ? w4 : blendVizLayer==5 ? w5 :
                 blendVizLayer==6 ? w6 : w7;
      float nw = wv / tw;
      gl_FragColor = vec4(nw, nw * 0.5, 0.0, 1.0);
      return;
    }

    // Sample diffuse per layer
    vec3 d0=texture2D(layer0Diffuse,vUv*layer0Tiling).rgb; vec3 d1=texture2D(layer1Diffuse,vUv*layer1Tiling).rgb;
    vec3 d2=texture2D(layer2Diffuse,vUv*layer2Tiling).rgb; vec3 d3=texture2D(layer3Diffuse,vUv*layer3Tiling).rgb;
    vec3 d4=texture2D(layer4Diffuse,vUv*layer4Tiling).rgb; vec3 d5=texture2D(layer5Diffuse,vUv*layer5Tiling).rgb;
    vec3 d6=texture2D(layer6Diffuse,vUv*layer6Tiling).rgb; vec3 d7=texture2D(layer7Diffuse,vUv*layer7Tiling).rgb;

    // Weighted blend
    vec3 color = (d0*w0+d1*w1+d2*w2+d3*w3+d4*w4+d5*w5+d6*w6+d7*w7) / tw;
    float roughness = (layer0Roughness*w0+layer1Roughness*w1+layer2Roughness*w2+layer3Roughness*w3
                      +layer4Roughness*w4+layer5Roughness*w5+layer6Roughness*w6+layer7Roughness*w7) / tw;

    vec3 N = normalize(vNormal);
    vec3 L = normalize(sunDirection);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 H = normalize(L + V);
    float NdotL  = max(dot(N, L), 0.0);
    float specExp = max(2.0, (1.0 - roughness) * 64.0);
    float spec = pow(max(dot(N, H), 0.0), specExp) * (1.0 - roughness) * 0.3;
    float lighting = 0.25 + 0.75 * NdotL + spec;

    // Shore foam
    if (enableShoreFoam == 1) {
      float above = vHeight - waterLevel;
      float foam = (1.0 - smoothstep(0.0, 1.5, above)) * step(0.0, above);
      color = mix(color, vec3(1.0), foam * 0.6);
    }

    gl_FragColor = vec4(color * lighting, 1.0);
  }
`;

export class TerrainSystem {
  private config: TerrainConfig;
  private heightData: Float32Array;
  private splatData: Uint8Array; // RGBA per vertex -> layers 0-3
  private splatData2: Uint8Array; // RGBA per vertex -> layers 4-7
  private mesh!: THREE.Mesh;
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.ShaderMaterial;
  private splatTexture!: THREE.DataTexture;
  private splatTexture2!: THREE.DataTexture;
  private layers: (TerrainLayer | null)[] = [null, null, null, null, null, null, null, null];
  private parent: THREE.Object3D;

  // Brush
  private brushSize = 10;
  private brushStrength = 0.3;
  private brushFalloff = 0.5;
  private currentBrush: TerrainBrush = 'raise';
  private paintLayerIndex = 0;

  // Editor helpers
  private brushIndicator: THREE.Mesh | null = null;

  // Brush throttle & ramp
  private brushThrottleMs = 30;
  private lastBrushTime = 0;
  private rampOrigin: THREE.Vector3 | null = null;

  // Flat neutral normal map texture
  private flatNormalTex!: THREE.Texture;

  // LOD geometry cache (0=full, 1=half, 2=quarter detail)
  private lodGeometries: THREE.BufferGeometry[] = [];

  // Undo/redo ring buffer
  private undoStack: TerrainSnapshot[] = [];
  private undoPtr = -1;
  private readonly UNDO_LIMIT = 30;

  // Foliage
  private foliageLayers: FoliageLayerConfig[] = [];
  private foliageDensity: Float32Array[] = [];
  private foliageRes = 64;

  constructor(parent: THREE.Object3D, config: Partial<TerrainConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.parent = parent;

    // Clamp resolution to avoid massive memory allocations (max 512 = ~25MB per tile)
    if (this.config.resolution > 512) {
      console.warn(`[Terrain] Resolution ${this.config.resolution} clamped to 512 (max safe value)`);
      this.config.resolution = 512;
    }

    const res = this.config.resolution;
    this.heightData = new Float32Array(res * res);
    this.splatData = new Uint8Array(res * res * 4);
    this.splatData2 = new Uint8Array(res * res * 4);

    // Default: layer 0 everywhere
    for (let i = 0; i < res * res; i++) {
      this.splatData[i * 4] = 255; // R channel = layer 0
    }

    this.flatNormalTex = this.createFlatNormalTexture();
    this.buildMesh();
    this.createBrushIndicator();

    // Apply grid offset
    const gx = this.config.gridX ?? 0;
    const gz = this.config.gridZ ?? 0;
    if (gx !== 0 || gz !== 0) {
      this.mesh.position.set(gx * this.config.width, 0, gz * this.config.depth);
    }
  }

  /* ─── Public API ──────────────────────────────────────── */

  /** Access raw splatmap data (RGBA bytes per vertex) */
  getSplatData(): Uint8Array { return this.splatData; }

  /** Access raw splatmap data for layers 4-7 */
  getSplatData2(): Uint8Array { return this.splatData2; }

  /** Set terrain layer (0-7) */
  setLayer(index: number, layer: TerrainLayer): void {
    if (index < 0 || index > 7) return;
    this.layers[index] = layer;

    const key = `layer${index}Diffuse`;
    this.material.uniforms[key].value = layer.diffuse;
    this.material.uniforms[`layer${index}Tiling`].value = layer.tiling;
    this.material.needsUpdate = true;
  }

  /** Set terrain layer color (creates a solid-color texture). Used by terrain editor color picker. */
  setLayerColor(index: number, hexColor: string, tiling = 16): void {
    if (index < 0 || index > 7) return;
    const tex = this.createDefaultTexture(hexColor);
    this.material.uniforms[`layer${index}Diffuse`].value = tex;
    this.material.uniforms[`layer${index}Tiling`].value = tiling;
    this.material.needsUpdate = true;
  }

  /** Get height at world position (bilinear interpolated) */
  getHeightAt(worldX: number, worldZ: number): number {
    const { width, depth, resolution } = this.config;
    // Convert world coords to heightmap UV
    const u = (worldX + width / 2) / width;
    const v = (worldZ + depth / 2) / depth;

    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;

    const fx = u * (resolution - 1);
    const fz = v * (resolution - 1);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const dx = fx - ix;
    const dz = fz - iz;

    const h00 = this.getHeight(ix, iz);
    const h10 = this.getHeight(ix + 1, iz);
    const h01 = this.getHeight(ix, iz + 1);
    const h11 = this.getHeight(ix + 1, iz + 1);

    // Bilinear
    return (
      h00 * (1 - dx) * (1 - dz) +
      h10 * dx * (1 - dz) +
      h01 * (1 - dx) * dz +
      h11 * dx * dz
    );
  }

  /** Apply brush at world position (optional worldY enables 3D sphere distance) */
  applyBrush(worldX: number, worldZ: number, dt: number = 1/60, worldY?: number): void {
    // Throttle to avoid CPU spikes on fast mouse moves
    const now = performance.now();
    if (now - this.lastBrushTime < this.brushThrottleMs) return;
    this.lastBrushTime = now;

    const { width, depth, resolution, maxHeight } = this.config;
    const u = (worldX + width / 2) / width;
    const v = (worldZ + depth / 2) / depth;

    const centerX = Math.round(u * (resolution - 1));
    const centerZ = Math.round(v * (resolution - 1));
    const radius = Math.round(this.brushSize * resolution / width);

    // Guard: radius=0 causes division by zero (NaN propagation)
    if (radius <= 0) {
      this.updateGeometry();
      if (this.currentBrush === 'paint') this.updateSplatMap();
      return;
    }

    const centerH = this.heightData[centerZ * resolution + centerX];

    // Ramp: set origin on first stroke
    if (this.currentBrush === 'ramp' && !this.rampOrigin) {
      this.rampOrigin = new THREE.Vector3(centerX, centerH, centerZ);
    }

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const px = centerX + dx;
        const pz = centerZ + dz;
        if (px < 0 || px >= resolution || pz < 0 || pz >= resolution) continue;

        // 3D sphere distance (accounts for height differences when worldY provided)
        let dist: number;
        if (worldY !== undefined) {
          const ph = this.heightData[pz * resolution + px];
          const dy = (ph - centerH) / Math.max(1, this.brushSize);
          dist = Math.sqrt(dx * dx + dz * dz + dy * dy * radius * radius) / radius;
        } else {
          dist = Math.sqrt(dx * dx + dz * dz) / radius;
        }
        if (dist > 1) continue;

        const exponent = 1 / Math.max(0.05, 1 - this.brushFalloff + 0.01);
        const falloff = Math.max(0, 1 - Math.pow(dist, exponent));
        const strength = this.brushStrength * falloff * dt * 60;
        if (!isFinite(strength)) continue;

        const idx = pz * resolution + px;

        switch (this.currentBrush) {
          case 'raise':
            this.heightData[idx] = Math.min(maxHeight, this.heightData[idx] + strength);
            break;
          case 'lower':
            this.heightData[idx] = Math.max(-maxHeight, this.heightData[idx] - strength);
            break;
          case 'smooth': {
            const avg = this.getNeighborAverage(px, pz);
            this.heightData[idx] += (avg - this.heightData[idx]) * strength;
            break;
          }
          case 'flatten': {
            this.heightData[idx] += (centerH - this.heightData[idx]) * strength;
            break;
          }
          case 'noise': {
            const t = performance.now() * 0.001;
            const nv = _valueNoise2D((px / resolution) * 8 + t, (pz / resolution) * 8 + t * 0.7);
            this.heightData[idx] = Math.min(maxHeight, Math.max(-maxHeight,
              this.heightData[idx] + (nv * 2 - 1) * strength));
            break;
          }
          case 'ramp': {
            if (this.rampOrigin) {
              const rx = this.rampOrigin.x, rz = this.rampOrigin.z, rh = this.rampOrigin.y;
              const rdx = centerX - rx, rdz = centerZ - rz;
              const rampLenSq = rdx * rdx + rdz * rdz;
              if (rampLenSq > 0.001) {
                const t2 = Math.max(0, Math.min(1, ((px - rx) * rdx + (pz - rz) * rdz) / rampLenSq));
                const targetH = rh + (centerH - rh) * t2;
                this.heightData[idx] += (targetH - this.heightData[idx]) * strength;
              }
            }
            break;
          }
          case 'paint': {
            const si = idx * 4;
            const add = Math.round(strength * 255);
            if (this.paintLayerIndex < 4) {
              const ch = this.paintLayerIndex;
              for (let c = 0; c < 4; c++) {
                if (c === ch) {
                  this.splatData[si + c] = Math.min(255, this.splatData[si + c] + add);
                } else {
                  this.splatData[si + c] = Math.max(0, this.splatData[si + c] - Math.round(add / 3));
                }
              }
              for (let c = 0; c < 4; c++) {
                this.splatData2[si + c] = Math.max(0, this.splatData2[si + c] - Math.round(add / 7));
              }
            } else {
              const ch = this.paintLayerIndex - 4;
              for (let c = 0; c < 4; c++) {
                if (c === ch) {
                  this.splatData2[si + c] = Math.min(255, this.splatData2[si + c] + add);
                } else {
                  this.splatData2[si + c] = Math.max(0, this.splatData2[si + c] - Math.round(add / 3));
                }
              }
              for (let c = 0; c < 4; c++) {
                this.splatData[si + c] = Math.max(0, this.splatData[si + c] - Math.round(add / 7));
              }
            }
            break;
          }
        }

        if (!isFinite(this.heightData[idx])) this.heightData[idx] = 0;
      }
    }

    const rMinX = Math.max(0, centerX - radius - 1);
    const rMaxX = Math.min(resolution - 1, centerX + radius + 1);
    const rMinZ = Math.max(0, centerZ - radius - 1);
    const rMaxZ = Math.min(resolution - 1, centerZ + radius + 1);
    this.updateGeometry(rMinX, rMaxX, rMinZ, rMaxZ);
    if (this.currentBrush === 'paint') {
      this.updateSplatMap();
    }
  }

  /** Reset the ramp tool origin (call on pointer-up) */
  resetRampOrigin(): void {
    this.rampOrigin = null;
  }

  /** Set brush parameters */
  setBrush(brush: TerrainBrush, size?: number, strength?: number, falloff?: number): void {
    this.currentBrush = brush;
    if (size !== undefined) this.brushSize = size;
    if (strength !== undefined) this.brushStrength = strength;
    if (falloff !== undefined) this.brushFalloff = falloff;
  }

  /** Set paint layer index (0-7) */
  setPaintLayer(index: number): void {
    this.paintLayerIndex = Math.max(0, Math.min(7, index));
  }

  /** Force a geometry refresh (public – used after bulk-editing heightData externally) */
  refreshGeometry(): void {
    this.updateGeometry();
  }

  /** Force a splatmap refresh (public – used after bulk-editing splatData externally) */
  refreshSplatMap(): void {
    this.updateSplatMap();
  }

  /** Move brush sphere indicator to world position (worldY from raycast hit) */
  updateBrushPosition(worldX: number, worldY: number, worldZ: number): void {
    if (this.brushIndicator) {
      this.brushIndicator.position.set(worldX, worldY, worldZ);
      this.brushIndicator.scale.setScalar(this.brushSize * 2);
      this.brushIndicator.visible = true;
    }
  }

  hideBrush(): void {
    if (this.brushIndicator) this.brushIndicator.visible = false;
  }

  /** Import heightmap from grayscale image */
  async importHeightmap(imageUrl: string): Promise<void> {
    const img = await this.loadImage(imageUrl);
    const canvas = document.createElement('canvas');
    const res = this.config.resolution;
    canvas.width = res;
    canvas.height = res;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, res, res);
    const pixels = ctx.getImageData(0, 0, res, res).data;

    for (let i = 0; i < res * res; i++) {
      this.heightData[i] = (pixels[i * 4] / 255) * this.config.maxHeight;
    }

    this.updateGeometry();
  }

  /** Export heightmap as PNG (grayscale) */
  exportHeightmap(): string {
    const res = this.config.resolution;
    const canvas = document.createElement('canvas');
    canvas.width = res;
    canvas.height = res;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(res, res);

    for (let i = 0; i < res * res; i++) {
      const v = Math.round((this.heightData[i] / this.config.maxHeight) * 255);
      imageData.data[i * 4] = v;
      imageData.data[i * 4 + 1] = v;
      imageData.data[i * 4 + 2] = v;
      imageData.data[i * 4 + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  /** Get the terrain mesh */
  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  /** Get raw height data */
  getHeightData(): Float32Array {
    return this.heightData;
  }

  /** Get terrain config */
  getConfig(): Readonly<TerrainConfig> {
    return this.config;
  }

  /** Get terrain layer data (for copying between tiles) */
  getLayers(): ReadonlyArray<TerrainLayer | null> {
    return this.layers;
  }

  /** Get the shader material (for copying uniforms) */
  getMaterial(): THREE.ShaderMaterial {
    return this.material;
  }

  /* ─── Internal ───────────────────────────────────────── */

  private buildMesh(): void {
    const { width, depth, resolution } = this.config;

    this.geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array(resolution * resolution * 3);
    const uvs = new Float32Array(resolution * resolution * 2);
    const normals = new Float32Array(resolution * resolution * 3);

    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const idx = z * resolution + x;
        const u = x / (resolution - 1);
        const v = z / (resolution - 1);

        vertices[idx * 3] = (u - 0.5) * width;
        vertices[idx * 3 + 1] = this.heightData[idx];
        vertices[idx * 3 + 2] = (v - 0.5) * depth;

        uvs[idx * 2] = u;
        uvs[idx * 2 + 1] = v;

        normals[idx * 3 + 1] = 1; // default up
      }
    }

    // Indices — use typed array directly to avoid huge JS array
    const indexCount = (resolution - 1) * (resolution - 1) * 6;
    const useUint32 = resolution * resolution > 65535;
    const indices = useUint32 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let ii = 0;
    for (let z = 0; z < resolution - 1; z++) {
      for (let x = 0; x < resolution - 1; x++) {
        const a = z * resolution + x;
        const b = a + 1;
        const c = (z + 1) * resolution + x;
        const d = c + 1;

        indices[ii++] = a;
        indices[ii++] = c;
        indices[ii++] = b;
        indices[ii++] = b;
        indices[ii++] = c;
        indices[ii++] = d;
      }
    }

    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

    // Splatmap texture (layers 0-3)
    this.splatTexture = new THREE.DataTexture(
      new Uint8Array(this.splatData.buffer) as unknown as BufferSource,
      resolution,
      resolution,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.splatTexture.minFilter = THREE.LinearFilter;
    this.splatTexture.magFilter = THREE.LinearFilter;
    this.splatTexture.needsUpdate = true;

    // Splatmap texture 2 (layers 4-7)
    this.splatTexture2 = new THREE.DataTexture(
      new Uint8Array(this.splatData2.buffer) as unknown as BufferSource,
      resolution,
      resolution,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this.splatTexture2.minFilter = THREE.LinearFilter;
    this.splatTexture2.magFilter = THREE.LinearFilter;
    this.splatTexture2.needsUpdate = true;

    // Default colours per layer
    const defaultColors = ['#4a7c3f', '#8b7355', '#6b6b6b', '#c2b280', '#5a8a4a', '#a0522d', '#808080', '#deb887'];

    this.material = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERTEX,
      fragmentShader: TERRAIN_FRAGMENT,
      uniforms: {
        splatMap: { value: this.splatTexture },
        splatMap2: { value: this.splatTexture2 },
        layer0Diffuse: { value: this.createDefaultTexture(defaultColors[0]) },
        layer1Diffuse: { value: this.createDefaultTexture(defaultColors[1]) },
        layer2Diffuse: { value: this.createDefaultTexture(defaultColors[2]) },
        layer3Diffuse: { value: this.createDefaultTexture(defaultColors[3]) },
        layer4Diffuse: { value: this.createDefaultTexture(defaultColors[4]) },
        layer5Diffuse: { value: this.createDefaultTexture(defaultColors[5]) },
        layer6Diffuse: { value: this.createDefaultTexture(defaultColors[6]) },
        layer7Diffuse: { value: this.createDefaultTexture(defaultColors[7]) },
        layer0Tiling: { value: 16. },
        layer1Tiling: { value: 16. },
        layer2Tiling: { value: 16. },
        layer3Tiling: { value: 16. },
        layer4Tiling: { value: 16. },
        layer5Tiling: { value: 16. },
        layer6Tiling: { value: 16. },
        layer7Tiling: { value: 16. },
        layer0Roughness: { value: 0.8 },
        layer1Roughness: { value: 0.8 },
        layer2Roughness: { value: 0.8 },
        layer3Roughness: { value: 0.8 },
        layer4Roughness: { value: 0.8 },
        layer5Roughness: { value: 0.8 },
        layer6Roughness: { value: 0.8 },
        layer7Roughness: { value: 0.8 },
        blendVizLayer: { value: -1 },
        waterLevel: { value: 0.0 },
        enableShoreFoam: { value: 0 },
        maxHeight: { value: this.config.maxHeight },
        sunDirection: { value: new THREE.Vector3(0.5, 1, 0.3).normalize() },
      },
      extensions: {},
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'Terrain';
    this.mesh.receiveShadow = true;
    this.parent.add(this.mesh);

    this.computeNormals();
  }

  private updateGeometry(regionMinX?: number, regionMaxX?: number, regionMinZ?: number, regionMaxZ?: number): void {
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const res = this.config.resolution;
    const isRegion = regionMinX !== undefined;
    const minX = regionMinX ?? 0;
    const maxX = regionMaxX ?? res - 1;
    const minZ = regionMinZ ?? 0;
    const maxZ = regionMaxZ ?? res - 1;

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = z * res + x;
        if (!isFinite(this.heightData[idx])) this.heightData[idx] = 0;
        posAttr.setY(idx, this.heightData[idx]);
      }
    }

    posAttr.needsUpdate = true;
    if (isRegion) {
      this.computeNormalsRegion(minX, maxX, minZ, maxZ);
    } else {
      this.computeNormals();
      this.geometry.computeBoundingBox();
      this.geometry.computeBoundingSphere();
    }
  }

  private updateSplatMap(): void {
    this.splatTexture.image.data.set(this.splatData);
    this.splatTexture.needsUpdate = true;
    this.splatTexture2.image.data.set(this.splatData2);
    this.splatTexture2.needsUpdate = true;
  }

  private computeNormals(): void {
    this.geometry.computeVertexNormals();
  }

  private computeNormalsRegion(minX: number, maxX: number, minZ: number, maxZ: number): void {
    const normalAttr = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const { width, depth, resolution } = this.config;
    const cellW = width / (resolution - 1);
    const cellD = depth / (resolution - 1);
    const startX = Math.max(0, minX - 1);
    const endX = Math.min(resolution - 1, maxX + 1);
    const startZ = Math.max(0, minZ - 1);
    const endZ = Math.min(resolution - 1, maxZ + 1);
    for (let z = startZ; z <= endZ; z++) {
      for (let x = startX; x <= endX; x++) {
        const idx = z * resolution + x;
        let nx = (this.getHeight(x - 1, z) - this.getHeight(x + 1, z)) / (2 * cellW);
        let ny = 1;
        let nz = (this.getHeight(x, z - 1) - this.getHeight(x, z + 1)) / (2 * cellD);
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0) { nx /= len; ny /= len; nz /= len; }
        normalAttr.setXYZ(idx, nx, ny, nz);
      }
    }
    normalAttr.needsUpdate = true;
  }

  private getHeight(x: number, z: number): number {
    const res = this.config.resolution;
    x = Math.max(0, Math.min(res - 1, x));
    z = Math.max(0, Math.min(res - 1, z));
    return this.heightData[z * res + x];
  }

  private getNeighborAverage(x: number, z: number): number {
    let sum = 0, count = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const h = this.getHeight(x + dx, z + dz);
        if (isFinite(h)) {
          sum += h;
          count++;
        }
      }
    }
    return count > 0 ? sum / count : 0;
  }

  private createBrushIndicator(): void {
    const geo = new THREE.SphereGeometry(0.5, 12, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, transparent: true, opacity: 0.35, depthTest: false, wireframe: true,
    });
    this.brushIndicator = new THREE.Mesh(geo, mat);
    this.brushIndicator.visible = false;
    this.brushIndicator.renderOrder = 999;
    this.parent.add(this.brushIndicator);
  }

  private createDefaultTexture(color: string): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 4, 4);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  /** Generate a low-resolution collision mesh (avoids OOM on large terrains) */
  generateCollisionMesh(): THREE.Mesh {
    const { width, depth, resolution, gridX = 0, gridZ = 0 } = this.config;
    // Quarter-resolution collision (max 64) — fixes RangeError on 512²+ terrains
    const collisionRes = Math.max(32, Math.min(64, Math.floor(resolution / 4)));
    const stride = (resolution - 1) / (collisionRes - 1);

    const vertices = new Float32Array(collisionRes * collisionRes * 3);
    for (let z = 0; z < collisionRes; z++) {
      for (let x = 0; x < collisionRes; x++) {
        const srcX = Math.min(Math.round(x * stride), resolution - 1);
        const srcZ = Math.min(Math.round(z * stride), resolution - 1);
        const h = this.heightData[srcZ * resolution + srcX];
        const idx = z * collisionRes + x;
        vertices[idx * 3]     = (x / (collisionRes - 1) - 0.5) * width;
        vertices[idx * 3 + 1] = isFinite(h) ? h : 0;
        vertices[idx * 3 + 2] = (z / (collisionRes - 1) - 0.5) * depth;
      }
    }

    const indexCount = (collisionRes - 1) * (collisionRes - 1) * 6;
    const indices = collisionRes * collisionRes > 65535
      ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let ii = 0;
    for (let z = 0; z < collisionRes - 1; z++) {
      for (let x = 0; x < collisionRes - 1; x++) {
        const a = z * collisionRes + x, b = a + 1;
        const c = (z + 1) * collisionRes + x, d = c + 1;
        indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
        indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'TerrainCollision';
    mesh.position.set(gridX * width, 0, gridZ * depth);
    mesh.userData.isCollider = true;
    return mesh;
  }

  /** Set grid position offset */
  setGridPosition(gx: number, gz: number): void {
    this.config.gridX = gx;
    this.config.gridZ = gz;
    this.mesh.position.set(gx * this.config.width, 0, gz * this.config.depth);
    if (this.brushIndicator) {
      // Brush indicator is in world space, no need to offset
    }
  }

  private createFlatNormalTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#8080ff'; // neutral normal: (0.5, 0.5, 1.0)
    ctx.fillRect(0, 0, 1, 1);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  private getSampleNormal(x: number, z: number): THREE.Vector3 {
    const { width, depth, resolution } = this.config;
    const cw = width / (resolution - 1), cd = depth / (resolution - 1);
    return new THREE.Vector3(
      -(this.getHeight(x+1,z) - this.getHeight(x-1,z)) / (2*cw),
      1,
      -(this.getHeight(x,z+1) - this.getHeight(x,z-1)) / (2*cd),
    ).normalize();
  }

  private buildLODGeometry(lodRes: number): THREE.BufferGeometry {
    const { width, depth, resolution } = this.config;
    const stride = (resolution - 1) / (lodRes - 1);
    const vertices = new Float32Array(lodRes * lodRes * 3);
    const uvs = new Float32Array(lodRes * lodRes * 2);
    for (let z = 0; z < lodRes; z++) {
      for (let x = 0; x < lodRes; x++) {
        const sx = Math.min(Math.round(x * stride), resolution - 1);
        const sz = Math.min(Math.round(z * stride), resolution - 1);
        const h  = this.heightData[sz * resolution + sx];
        const i  = z * lodRes + x;
        vertices[i*3]   = (x/(lodRes-1) - 0.5) * width;
        vertices[i*3+1] = isFinite(h) ? h : 0;
        vertices[i*3+2] = (z/(lodRes-1) - 0.5) * depth;
        uvs[i*2] = x/(lodRes-1); uvs[i*2+1] = z/(lodRes-1);
      }
    }
    const ic = (lodRes-1)*(lodRes-1)*6;
    const idx = lodRes*lodRes > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
    let ii = 0;
    for (let z = 0; z < lodRes-1; z++) {
      for (let x = 0; x < lodRes-1; x++) {
        const a=z*lodRes+x,b=a+1,c=(z+1)*lodRes+x,d=c+1;
        idx[ii++]=a;idx[ii++]=c;idx[ii++]=b;idx[ii++]=b;idx[ii++]=c;idx[ii++]=d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return geo;
  }

  // ── New Public API ──────────────────────────────────────────────────────

  setLayerTiling(index: number, tiling: number): void {
    if (index < 0 || index > 7) return;
    this.material.uniforms[`layer${index}Tiling`].value = tiling;
    if (this.layers[index]) this.layers[index]!.tiling = tiling;
  }

  setLayerNormalMap(_index: number, _tex: THREE.Texture | null): void {
    // Normal map samplers removed to stay within WebGL MAX_TEXTURE_IMAGE_UNITS (16).
    // Stored for future use when a texture atlas approach is implemented.
  }

  setLayerRoughness(index: number, roughness: number): void {
    if (index < 0 || index > 7) return;
    this.material.uniforms[`layer${index}Roughness`].value = Math.max(0, Math.min(1, roughness));
  }

  /** Show blend weight of one layer as overlay. Pass -1 to disable. */
  setBlendVisualization(layer: number): void {
    this.material.uniforms['blendVizLayer'].value = layer;
  }

  setShoreFoam(enabled: boolean, waterLevel = 0): void {
    this.material.uniforms['enableShoreFoam'].value = enabled ? 1 : 0;
    this.material.uniforms['waterLevel'].value = waterLevel;
  }

  applyNoiseHeightmap(params: NoiseParams): void {
    const { resolution, maxHeight } = this.config;
    const scale      = params.scale      ?? 1;
    const octaves    = params.octaves    ?? 6;
    const persistence= params.persistence?? 0.5;
    const lacunarity = params.lacunarity ?? 2;
    const amplitude  = params.amplitude  ?? 1;
    const offX       = params.offsetX    ?? 0;
    const offZ       = params.offsetZ    ?? 0;
    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const nx = (x / (resolution-1) + offX) * scale;
        const nz = (z / (resolution-1) + offZ) * scale;
        const v  = _fbm(nx, nz, octaves, persistence, lacunarity) * 0.5 + 0.5;
        const h  = v * maxHeight * amplitude;
        const i  = z * resolution + x;
        this.heightData[i] = params.additive
          ? Math.min(maxHeight, this.heightData[i] + h)
          : Math.min(maxHeight, h);
      }
    }
    this.updateGeometry();
  }

  applySlopeAutoPaint(slopeMin: number, slopeMax: number, layerIndex: number): void {
    const res = this.config.resolution;
    const cosLo = Math.cos((slopeMax * Math.PI) / 180);
    const cosHi = Math.cos((slopeMin * Math.PI) / 180);
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const cosA = this.getSampleNormal(x, z).y;
        if (cosA < cosLo || cosA > cosHi) continue;
        const t = 1 - Math.abs(cosA - (cosLo+cosHi)*0.5) / ((cosHi-cosLo)*0.5 + 0.001);
        const weight = Math.round(t * 255);
        const si = (z * res + x) * 4;
        if (layerIndex < 4) {
          this.splatData[si + layerIndex] = Math.min(255, this.splatData[si + layerIndex] + weight);
        } else {
          this.splatData2[si + (layerIndex - 4)] = Math.min(255, this.splatData2[si + (layerIndex - 4)] + weight);
        }
      }
    }
    this.updateSplatMap();
  }

  async applyStampBlend(imageUrl: string, centerX: number, centerZ: number, worldScale: number, blendFactor: number): Promise<void> {
    const img = await this.loadImage(imageUrl);
    const sr = Math.min(512, img.width);
    const canvas = document.createElement('canvas'); canvas.width = sr; canvas.height = sr;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, sr, sr);
    const pixels = ctx.getImageData(0, 0, sr, sr).data;
    const { width, depth, resolution, maxHeight } = this.config;
    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const wx = (x/(resolution-1) - 0.5) * width;
        const wz = (z/(resolution-1) - 0.5) * depth;
        const su = (wx - centerX) / worldScale + 0.5;
        const sv = (wz - centerZ) / worldScale + 0.5;
        if (su < 0 || su > 1 || sv < 0 || sv > 1) continue;
        const pi = (Math.floor(sv*(sr-1))*sr + Math.floor(su*(sr-1)))*4;
        const stampH = (pixels[pi] / 255) * maxHeight;
        const i = z * resolution + x;
        this.heightData[i] = Math.min(maxHeight, this.heightData[i] + stampH * blendFactor);
      }
    }
    this.updateGeometry();
  }

  pushUndo(): void {
    if (this.undoPtr < this.undoStack.length - 1) this.undoStack.length = this.undoPtr + 1;
    this.undoStack.push({
      heightData: new Float32Array(this.heightData),
      splatData:  new Uint8Array(this.splatData),
      splatData2: new Uint8Array(this.splatData2),
    });
    if (this.undoStack.length > this.UNDO_LIMIT) this.undoStack.shift();
    else this.undoPtr++;
  }

  undo(): boolean {
    if (this.undoPtr <= 0) return false;
    this.undoPtr--;
    const s = this.undoStack[this.undoPtr];
    this.heightData.set(s.heightData); this.splatData.set(s.splatData); this.splatData2.set(s.splatData2);
    this.updateGeometry(); this.updateSplatMap();
    return true;
  }

  redo(): boolean {
    if (this.undoPtr >= this.undoStack.length - 1) return false;
    this.undoPtr++;
    const s = this.undoStack[this.undoPtr];
    this.heightData.set(s.heightData); this.splatData.set(s.splatData); this.splatData2.set(s.splatData2);
    this.updateGeometry(); this.updateSplatMap();
    return true;
  }

  snapshotState(): TerrainSnapshot {
    return { heightData: new Float32Array(this.heightData), splatData: new Uint8Array(this.splatData), splatData2: new Uint8Array(this.splatData2) };
  }

  restoreState(snap: TerrainSnapshot): void {
    this.heightData.set(snap.heightData); this.splatData.set(snap.splatData); this.splatData2.set(snap.splatData2);
    this.updateGeometry(); this.updateSplatMap();
  }

  updateLOD(cameraPos: THREE.Vector3): void {
    const dist = cameraPos.distanceTo(this.mesh.position);
    const { width, resolution } = this.config;
    const level = dist < width * 1.5 ? 0 : dist < width * 4 ? 1 : 2;
    const targetRes = level === 0 ? resolution : level === 1 ? Math.max(32, Math.floor(resolution/2)) : Math.max(16, Math.floor(resolution/4));
    if (!this.lodGeometries[level]) this.lodGeometries[level] = level === 0 ? this.geometry : this.buildLODGeometry(targetRes);
    if (this.mesh.geometry !== this.lodGeometries[level]) this.mesh.geometry = this.lodGeometries[level];
  }

  stitchEdgeWith(neighbor: TerrainSystem, direction: 'north' | 'south' | 'east' | 'west'): void {
    const res  = this.config.resolution;
    const nRes = neighbor.config.resolution;
    const nd   = neighbor.heightData;
    const avg  = (a: number, b: number) => (a + b) * 0.5;
    if (direction === 'north') {
      for (let x = 0; x < res; x++) {
        const nx = Math.round((x/(res-1)) * (nRes-1));
        const v = avg(this.heightData[x], nd[(nRes-1)*nRes + nx]);
        this.heightData[x] = v; nd[(nRes-1)*nRes + nx] = v;
      }
    } else if (direction === 'south') {
      for (let x = 0; x < res; x++) {
        const nx = Math.round((x/(res-1)) * (nRes-1));
        const v = avg(this.heightData[(res-1)*res + x], nd[nx]);
        this.heightData[(res-1)*res + x] = v; nd[nx] = v;
      }
    } else if (direction === 'east') {
      for (let z = 0; z < res; z++) {
        const nz = Math.round((z/(res-1)) * (nRes-1));
        const v = avg(this.heightData[z*res + (res-1)], nd[nz*nRes]);
        this.heightData[z*res + (res-1)] = v; nd[nz*nRes] = v;
      }
    } else {
      for (let z = 0; z < res; z++) {
        const nz = Math.round((z/(res-1)) * (nRes-1));
        const v = avg(this.heightData[z*res], nd[nz*nRes + (nRes-1)]);
        this.heightData[z*res] = v; nd[nz*nRes + (nRes-1)] = v;
      }
    }
    this.updateGeometry(); neighbor.updateGeometry();
  }

  exportHeightmapRAW(): Uint16Array {
    const res = this.config.resolution;
    const raw = new Uint16Array(res * res);
    for (let i = 0; i < res * res; i++) raw[i] = Math.round(Math.max(0, Math.min(1, this.heightData[i] / this.config.maxHeight)) * 65535);
    return raw;
  }

  importHeightmapRAW(data: Uint16Array, srcWidth: number, srcHeight: number): void {
    const res = this.config.resolution;
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const sx = Math.round((x/(res-1)) * (srcWidth-1));
        const sz = Math.round((z/(res-1)) * (srcHeight-1));
        this.heightData[z*res + x] = (data[sz * srcWidth + sx] / 65535) * this.config.maxHeight;
      }
    }
    this.updateGeometry();
  }

  paintFoliageDensity(worldX: number, worldZ: number, layerIndex: number, strength: number): void {
    const density = this.foliageDensity[layerIndex];
    if (!density) return;
    const { width, depth } = this.config;
    const cx = Math.round(((worldX + width/2) / width) * (this.foliageRes - 1));
    const cz = Math.round(((worldZ + depth/2) / depth) * (this.foliageRes - 1));
    const r  = Math.round(this.brushSize * this.foliageRes / width);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = cx + dx, pz = cz + dz;
        if (px < 0 || px >= this.foliageRes || pz < 0 || pz >= this.foliageRes) continue;
        const dist = Math.sqrt(dx*dx + dz*dz) / Math.max(1, r);
        if (dist > 1) continue;
        density[pz * this.foliageRes + px] = Math.min(1, density[pz * this.foliageRes + px] + strength * (1 - dist*dist));
      }
    }
  }

  refreshFoliageMeshes(): void {
    const { width, depth, resolution } = this.config;
    const dummy = new THREE.Object3D();
    for (let li = 0; li < this.foliageLayers.length; li++) {
      const layer = this.foliageLayers[li];
      const density = this.foliageDensity[li];
      if (!density) continue;

      // Slope filter thresholds (cosine of angle — higher cosine = flatter)
      const slopeMinDeg = layer.slopeMin ?? 0;
      const slopeMaxDeg = layer.slopeMax ?? 90;
      const cosHi = Math.cos((slopeMinDeg * Math.PI) / 180); // flat limit
      const cosLo = Math.cos((slopeMaxDeg * Math.PI) / 180); // steep limit
      const useSlopeFilter = slopeMaxDeg < 89;

      const maxCount = layer.mesh.instanceMatrix.count;
      const matrices: THREE.Matrix4[] = [];

      for (let z = 0; z < this.foliageRes; z++) {
        for (let x = 0; x < this.foliageRes; x++) {
          if (matrices.length >= maxCount) break;
          if (Math.random() > density[z * this.foliageRes + x]) continue;

          const wx = ((x + Math.random()) / this.foliageRes - 0.5) * width;
          const wz = ((z + Math.random()) / this.foliageRes - 0.5) * depth;

          // Slope filter — sample normal from heightmap at this world position
          if (useSlopeFilter) {
            const hx = Math.min(resolution - 1, Math.max(0, Math.round(((wx / width) + 0.5) * (resolution - 1))));
            const hz = Math.min(resolution - 1, Math.max(0, Math.round(((wz / depth) + 0.5) * (resolution - 1))));
            const cosA = this.getSampleNormal(hx, hz).y;
            if (cosA < cosLo || cosA > cosHi) continue;
          }

          const scale = layer.scaleMin + Math.random() * (layer.scaleMax - layer.scaleMin);
          dummy.position.set(wx, this.getHeightAt(wx, wz), wz);
          dummy.rotation.y = Math.random() * Math.PI * 2;
          dummy.scale.setScalar(scale);
          dummy.updateMatrix();
          matrices.push(dummy.matrix.clone());
        }
        if (matrices.length >= maxCount) break;
      }

      layer.mesh.count = matrices.length;
      for (let i = 0; i < matrices.length; i++) layer.mesh.setMatrixAt(i, matrices[i]);
      layer.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Erase foliage density at a world position. Uses the same brushSize as sculpting. */
  eraseFoliageDensity(worldX: number, worldZ: number, layerIndex: number, strength: number): void {
    const density = this.foliageDensity[layerIndex];
    if (!density) return;
    const { width, depth } = this.config;
    const cx = Math.round(((worldX + width / 2) / width) * (this.foliageRes - 1));
    const cz = Math.round(((worldZ + depth / 2) / depth) * (this.foliageRes - 1));
    const r  = Math.max(1, Math.round(this.brushSize * this.foliageRes / width));
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = cx + dx, pz = cz + dz;
        if (px < 0 || px >= this.foliageRes || pz < 0 || pz >= this.foliageRes) continue;
        const dist = Math.sqrt(dx * dx + dz * dz) / r;
        if (dist > 1) continue;
        density[pz * this.foliageRes + px] = Math.max(0,
          density[pz * this.foliageRes + px] - strength * (1 - dist * dist));
      }
    }
  }

  /** Zero out all foliage density for a layer. */
  clearFoliageDensity(layerIndex: number): void {
    const density = this.foliageDensity[layerIndex];
    if (density) density.fill(0);
  }

  /** Remove a foliage layer by index (disposes its InstancedMesh from scene). */
  removeFoliageLayer(index: number): void {
    if (index < 0 || index >= this.foliageLayers.length) return;
    const layer = this.foliageLayers[index];
    if (layer.mesh.parent) layer.mesh.parent.remove(layer.mesh);
    layer.mesh.dispose();
    this.foliageLayers.splice(index, 1);
    this.foliageDensity.splice(index, 1);
  }

  /** Number of foliage layers registered on this tile. */
  getFoliageLayerCount(): number {
    return this.foliageLayers.length;
  }

  addFoliageLayer(config: FoliageLayerConfig): void {
    this.foliageLayers.push(config);
    this.foliageDensity.push(new Float32Array(this.foliageRes * this.foliageRes));
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.splatTexture.dispose();
    this.splatTexture2.dispose();
    this.flatNormalTex.dispose();
    for (const geo of this.lodGeometries) geo?.dispose();
    this.lodGeometries = [];
    if (this.brushIndicator) {
      (this.brushIndicator.geometry as THREE.BufferGeometry).dispose();
      (this.brushIndicator.material as THREE.Material).dispose();
      this.parent.remove(this.brushIndicator);
    }
    this.parent.remove(this.mesh);
  }
}
