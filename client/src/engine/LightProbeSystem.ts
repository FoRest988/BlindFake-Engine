/**
 * LightProbeSystem — Light probes and baked global illumination.
 * Features:
 * - Light probe placement (grid or manual)
 * - Spherical Harmonics (SH) capture per probe
 * - Runtime interpolation between nearby probes
 * - Reflection probes (cube map capture per location)
 * - Probe baking from scene lights
 * - Serialization for baked lighting
 */

import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────

export interface SHCoefficients {
  /** 9 RGB coefficients (L0-L2 bands) — 27 floats total */
  coeffs: Float32Array;
}

export interface LightProbeData {
  id: string;
  position: THREE.Vector3;
  /** Spherical harmonics coefficients */
  sh: SHCoefficients;
  /** Radius of influence */
  radius: number;
  /** Intensity multiplier */
  intensity: number;
}

export interface ReflectionProbeData {
  id: string;
  position: THREE.Vector3;
  /** Box bounds for box-projected cubemap */
  bounds: THREE.Box3;
  /** Generated cubemap texture */
  cubeMap: THREE.CubeTexture | null;
  /** Resolution of each cubemap face */
  resolution: number;
  /** Intensity */
  intensity: number;
}

export interface ProbeGridConfig {
  /** Bounding box for the grid */
  bounds: THREE.Box3;
  /** Spacing between probes */
  spacing: THREE.Vector3;
  /** Radius of influence per probe */
  probeRadius: number;
}

// ─── SH Utilities ────────────────────────────────────

function createEmptySH(): SHCoefficients {
  return { coeffs: new Float32Array(27) };
}

/**
 * Evaluate SH at a given direction.
 * Uses first 3 bands (L0, L1, L2) = 9 coefficients per channel.
 */
function evaluateSH(sh: SHCoefficients, direction: THREE.Vector3): THREE.Color {
  const x = direction.x, y = direction.y, z = direction.z;
  const c = sh.coeffs;

  // SH basis functions
  const b0 = 0.282095;                    // Y00
  const b1 = 0.488603;                    // Y1-1, Y10, Y11
  const b2_0 = 1.092548;                  // Y2-2, Y2-1, Y21
  const b2_1 = 0.315392;                  // Y20
  const b2_2 = 0.546274;                  // Y22

  const basis = [
    b0,
    b1 * y, b1 * z, b1 * x,
    b2_0 * x * y, b2_0 * y * z, b2_1 * (3 * z * z - 1),
    b2_0 * x * z, b2_2 * (x * x - y * y),
  ];

  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 9; i++) {
    r += basis[i] * c[i * 3];
    g += basis[i] * c[i * 3 + 1];
    b += basis[i] * c[i * 3 + 2];
  }

  return new THREE.Color(Math.max(0, r), Math.max(0, g), Math.max(0, b));
}

/**
 * Accumulate a directional light sample into SH coefficients.
 */
function accumulateSHSample(sh: SHCoefficients, direction: THREE.Vector3, color: THREE.Color, weight: number): void {
  const x = direction.x, y = direction.y, z = direction.z;
  const c = sh.coeffs;

  const b0 = 0.282095;
  const b1 = 0.488603;
  const b2_0 = 1.092548;
  const b2_1 = 0.315392;
  const b2_2 = 0.546274;

  const basis = [
    b0,
    b1 * y, b1 * z, b1 * x,
    b2_0 * x * y, b2_0 * y * z, b2_1 * (3 * z * z - 1),
    b2_0 * x * z, b2_2 * (x * x - y * y),
  ];

  const rgb = [color.r * weight, color.g * weight, color.b * weight];
  for (let i = 0; i < 9; i++) {
    c[i * 3] += basis[i] * rgb[0];
    c[i * 3 + 1] += basis[i] * rgb[1];
    c[i * 3 + 2] += basis[i] * rgb[2];
  }
}

/**
 * Blend (lerp) two SH coefficient sets.
 */
function blendSH(a: SHCoefficients, b: SHCoefficients, t: number): SHCoefficients {
  const result = createEmptySH();
  for (let i = 0; i < 27; i++) {
    result.coeffs[i] = a.coeffs[i] * (1 - t) + b.coeffs[i] * t;
  }
  return result;
}

// ─── Light Probe System ──────────────────────────────

export class LightProbeSystem {
  private probes: LightProbeData[] = [];
  private reflectionProbes: ReflectionProbeData[] = [];
  private spatialGrid = new Map<string, LightProbeData[]>();
  private gridCellSize = 10;

  // ─── Probe Management ────────────────────────

  addProbe(data: Omit<LightProbeData, 'sh'>): LightProbeData {
    const probe: LightProbeData = { ...data, sh: createEmptySH() };
    this.probes.push(probe);
    this.insertIntoGrid(probe);
    return probe;
  }

  removeProbe(id: string): void {
    const idx = this.probes.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.probes.splice(idx, 1);
      this.rebuildGrid();
    }
  }

  getProbe(id: string): LightProbeData | undefined {
    return this.probes.find(p => p.id === id);
  }

  /** Generate a grid of probes within a bounding volume */
  generateGrid(config: ProbeGridConfig): void {
    const { bounds, spacing, probeRadius } = config;
    let counter = 0;

    for (let x = bounds.min.x; x <= bounds.max.x; x += spacing.x) {
      for (let y = bounds.min.y; y <= bounds.max.y; y += spacing.y) {
        for (let z = bounds.min.z; z <= bounds.max.z; z += spacing.z) {
          this.addProbe({
            id: `probe_grid_${counter++}`,
            position: new THREE.Vector3(x, y, z),
            radius: probeRadius,
            intensity: 1,
          });
        }
      }
    }
  }

  // ─── Baking ──────────────────────────────────

  /** Bake all probes from scene lights (simplified — samples light directions) */
  bakeFromScene(scene: THREE.Scene): void {
    const lights: { dir: THREE.Vector3; color: THREE.Color; intensity: number }[] = [];

    // Collect all lights
    scene.traverse(obj => {
      if (obj instanceof THREE.DirectionalLight) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.quaternion).normalize();
        lights.push({ dir, color: obj.color.clone(), intensity: obj.intensity });
      } else if (obj instanceof THREE.PointLight) {
        lights.push({
          dir: new THREE.Vector3(), // Will be computed per-probe
          color: obj.color.clone(),
          intensity: obj.intensity,
        });
        // Store position for per-probe calculation
        (lights[lights.length - 1] as any)._pos = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
        (lights[lights.length - 1] as any)._isPoint = true;
      } else if (obj instanceof THREE.AmbientLight) {
        // Ambient contributes uniformly to L0
        lights.push({
          dir: new THREE.Vector3(0, 1, 0), // Doesn't matter for ambient
          color: obj.color.clone(),
          intensity: obj.intensity,
        });
        (lights[lights.length - 1] as any)._isAmbient = true;
      }
    });

    for (const probe of this.probes) {
      probe.sh = createEmptySH();

      for (const light of lights) {
        if ((light as any)._isAmbient) {
          // Ambient: only affects L0 band
          const color = light.color.clone().multiplyScalar(light.intensity);
          probe.sh.coeffs[0] += color.r * 0.282095 * 4 * Math.PI;
          probe.sh.coeffs[1] += color.g * 0.282095 * 4 * Math.PI;
          probe.sh.coeffs[2] += color.b * 0.282095 * 4 * Math.PI;
        } else if ((light as any)._isPoint) {
          // Point light: direction depends on probe position
          const lightPos = (light as any)._pos as THREE.Vector3;
          const dir = new THREE.Vector3().subVectors(lightPos, probe.position);
          const dist = dir.length();
          if (dist < 0.001) continue;
          dir.divideScalar(dist);
          // Inverse square falloff
          const atten = light.intensity / (1 + dist * dist);
          accumulateSHSample(probe.sh, dir, light.color, atten);
        } else {
          // Directional
          accumulateSHSample(probe.sh, light.dir, light.color, light.intensity);
        }
      }

      // Also sample hemisphere for indirect bounce (basic sky contribution)
      const skyColor = new THREE.Color(0.5, 0.6, 0.8);
      const groundColor = new THREE.Color(0.2, 0.15, 0.1);
      const samples = 32;
      for (let i = 0; i < samples; i++) {
        const theta = Math.acos(1 - 2 * (i + 0.5) / samples);
        const phi = 2 * Math.PI * (i * 0.618033988749895); // Golden ratio
        const dir = new THREE.Vector3(
          Math.sin(theta) * Math.cos(phi),
          Math.cos(theta),
          Math.sin(theta) * Math.sin(phi),
        );
        const color = dir.y > 0 ? skyColor : groundColor;
        accumulateSHSample(probe.sh, dir, color, 0.1 / samples);
      }
    }
  }

  // ─── Runtime Sampling ────────────────────────

  /** Sample all affecting probes at a world position and return blended SH */
  sampleAt(position: THREE.Vector3): SHCoefficients {
    const nearby = this.findNearbyProbes(position);
    if (nearby.length === 0) return createEmptySH();
    if (nearby.length === 1) return nearby[0].sh;

    // Weighted blend by inverse distance
    let totalWeight = 0;
    const weights: number[] = [];

    for (const probe of nearby) {
      const dist = position.distanceTo(probe.position);
      const w = Math.max(0, 1 - dist / probe.radius) * probe.intensity;
      weights.push(w);
      totalWeight += w;
    }

    if (totalWeight < 0.001) return createEmptySH();

    const result = createEmptySH();
    for (let p = 0; p < nearby.length; p++) {
      const w = weights[p] / totalWeight;
      for (let i = 0; i < 27; i++) {
        result.coeffs[i] += nearby[p].sh.coeffs[i] * w;
      }
    }

    return result;
  }

  /** Evaluate lighting color at a position for a given surface normal */
  evaluateAt(position: THREE.Vector3, normal: THREE.Vector3): THREE.Color {
    const sh = this.sampleAt(position);
    return evaluateSH(sh, normal);
  }

  /** Apply probe lighting to a mesh (sets MeshStandardMaterial envMapIntensity-like factor) */
  applyToMesh(mesh: THREE.Mesh): void {
    const pos = new THREE.Vector3();
    mesh.getWorldPosition(pos);
    const sh = this.sampleAt(pos);

    // Create a Three.js LightProbe from our SH data
    const threeSH = new THREE.SphericalHarmonics3();
    for (let i = 0; i < 9; i++) {
      threeSH.coefficients[i].set(
        sh.coeffs[i * 3],
        sh.coeffs[i * 3 + 1],
        sh.coeffs[i * 3 + 2],
      );
    }

    // Apply to material if possible
    const mat = mesh.material;
    if (mat && (mat as any).isMeshStandardMaterial) {
      // Store SH data on the material for custom shaders
      (mat as any)._probeSH = threeSH;
    }
  }

  // ─── Reflection Probes ──────────────────────

  addReflectionProbe(config: Omit<ReflectionProbeData, 'cubeMap'>): ReflectionProbeData {
    const probe: ReflectionProbeData = { ...config, cubeMap: null };
    this.reflectionProbes.push(probe);
    return probe;
  }

  /** Capture cubemap at a reflection probe location */
  captureReflectionProbe(
    id: string,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
  ): THREE.CubeTexture | null {
    const probe = this.reflectionProbes.find(p => p.id === id);
    if (!probe) return null;

    const cubeCamera = new THREE.CubeCamera(0.1, 1000, new THREE.WebGLCubeRenderTarget(probe.resolution));
    cubeCamera.position.copy(probe.position);
    cubeCamera.update(renderer, scene);

    probe.cubeMap = cubeCamera.renderTarget.texture;
    return probe.cubeMap;
  }

  /** Get the best reflection probe for a given position */
  getReflectionAt(position: THREE.Vector3): ReflectionProbeData | null {
    let best: ReflectionProbeData | null = null;
    let bestDist = Infinity;

    for (const probe of this.reflectionProbes) {
      if (probe.bounds.containsPoint(position)) {
        const dist = position.distanceTo(probe.position);
        if (dist < bestDist) {
          bestDist = dist;
          best = probe;
        }
      }
    }

    return best;
  }

  /** Apply best reflection probe to a mesh */
  applyReflectionToMesh(mesh: THREE.Mesh): void {
    const pos = new THREE.Vector3();
    mesh.getWorldPosition(pos);
    const probe = this.getReflectionAt(pos);
    if (!probe?.cubeMap) return;

    const mat = mesh.material;
    if (mat && (mat as any).isMeshStandardMaterial) {
      (mat as THREE.MeshStandardMaterial).envMap = probe.cubeMap;
      (mat as THREE.MeshStandardMaterial).envMapIntensity = probe.intensity;
      (mat as THREE.MeshStandardMaterial).needsUpdate = true;
    }
  }

  // ─── Spatial Grid ────────────────────────────

  private gridKey(x: number, y: number, z: number): string {
    const cs = this.gridCellSize;
    return `${Math.floor(x / cs)},${Math.floor(y / cs)},${Math.floor(z / cs)}`;
  }

  private insertIntoGrid(probe: LightProbeData): void {
    const key = this.gridKey(probe.position.x, probe.position.y, probe.position.z);
    if (!this.spatialGrid.has(key)) this.spatialGrid.set(key, []);
    this.spatialGrid.get(key)!.push(probe);
  }

  private rebuildGrid(): void {
    this.spatialGrid.clear();
    for (const p of this.probes) this.insertIntoGrid(p);
  }

  private findNearbyProbes(pos: THREE.Vector3): LightProbeData[] {
    const results: LightProbeData[] = [];
    const cs = this.gridCellSize;
    const cx = Math.floor(pos.x / cs);
    const cy = Math.floor(pos.y / cs);
    const cz = Math.floor(pos.z / cs);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${cx + dx},${cy + dy},${cz + dz}`;
          const cell = this.spatialGrid.get(key);
          if (!cell) continue;
          for (const probe of cell) {
            if (pos.distanceTo(probe.position) <= probe.radius) {
              results.push(probe);
            }
          }
        }
      }
    }

    return results;
  }

  // ─── Serialization ──────────────────────────

  serialize(): string {
    return JSON.stringify({
      probes: this.probes.map(p => ({
        id: p.id,
        position: p.position.toArray(),
        sh: Array.from(p.sh.coeffs),
        radius: p.radius,
        intensity: p.intensity,
      })),
      reflectionProbes: this.reflectionProbes.map(p => ({
        id: p.id,
        position: p.position.toArray(),
        bounds: { min: p.bounds.min.toArray(), max: p.bounds.max.toArray() },
        resolution: p.resolution,
        intensity: p.intensity,
      })),
    });
  }

  deserialize(json: string): void {
    const data = JSON.parse(json);
    this.probes = [];
    this.reflectionProbes = [];
    this.spatialGrid.clear();

    for (const p of data.probes) {
      const probe: LightProbeData = {
        id: p.id,
        position: new THREE.Vector3().fromArray(p.position),
        sh: { coeffs: new Float32Array(p.sh) },
        radius: p.radius,
        intensity: p.intensity,
      };
      this.probes.push(probe);
      this.insertIntoGrid(probe);
    }

    for (const p of data.reflectionProbes) {
      this.reflectionProbes.push({
        id: p.id,
        position: new THREE.Vector3().fromArray(p.position),
        bounds: new THREE.Box3(
          new THREE.Vector3().fromArray(p.bounds.min),
          new THREE.Vector3().fromArray(p.bounds.max),
        ),
        cubeMap: null,
        resolution: p.resolution,
        intensity: p.intensity,
      });
    }
  }

  dispose(): void {
    for (const p of this.reflectionProbes) {
      p.cubeMap?.dispose();
    }
    this.probes = [];
    this.reflectionProbes = [];
    this.spatialGrid.clear();
  }
}

export { evaluateSH, blendSH, accumulateSHSample, createEmptySH };
