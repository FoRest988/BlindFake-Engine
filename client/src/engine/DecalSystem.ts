/**
 * DecalSystem — Project decals (bullet holes, blood, footprints, scorch marks)
 * onto surfaces in the scene. Uses THREE.DecalGeometry for projection.
 */

import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

export interface DecalConfig {
  /** Material to use for the decal. If not provided, a default is created. */
  material?: THREE.Material;
  /** Texture for the decal */
  texture?: THREE.Texture;
  /** Size of the decal projected onto the surface */
  size?: THREE.Vector3;
  /** Color tint */
  color?: THREE.ColorRepresentation;
  /** Opacity (0-1) */
  opacity?: number;
  /** Offset along surface normal to avoid z-fighting */
  normalOffset?: number;
  /** Lifetime in seconds (0 = permanent) */
  lifetime?: number;
  /** Time to fade out before being removed */
  fadeTime?: number;
  /** Max decals of this type before oldest is removed */
  maxCount?: number;
}

interface ActiveDecal {
  mesh: THREE.Mesh;
  age: number;
  lifetime: number;
  fadeTime: number;
  pool: string;
}

// ── Decal Presets ─────────────────────────────────────────────────

const DEFAULT_SIZE = new THREE.Vector3(0.5, 0.5, 0.2);

export const DecalPresets = {
  bulletHole: (): DecalConfig => ({
    size: new THREE.Vector3(0.15, 0.15, 0.1),
    color: 0x222222,
    opacity: 0.9,
    lifetime: 30,
    fadeTime: 3,
    maxCount: 50,
  }),
  blood: (): DecalConfig => ({
    size: new THREE.Vector3(0.6, 0.6, 0.2),
    color: 0x8b0000,
    opacity: 0.8,
    lifetime: 60,
    fadeTime: 5,
    maxCount: 30,
  }),
  scorch: (): DecalConfig => ({
    size: new THREE.Vector3(1.0, 1.0, 0.3),
    color: 0x1a1a1a,
    opacity: 0.7,
    lifetime: 45,
    fadeTime: 5,
    maxCount: 20,
  }),
  footprint: (): DecalConfig => ({
    size: new THREE.Vector3(0.3, 0.6, 0.1),
    color: 0x555555,
    opacity: 0.4,
    lifetime: 15,
    fadeTime: 3,
    maxCount: 40,
  }),
  paint: (): DecalConfig => ({
    size: new THREE.Vector3(0.4, 0.4, 0.15),
    color: 0xff4444,
    opacity: 0.9,
    lifetime: 0,
    fadeTime: 0,
    maxCount: 100,
  }),
};

// ── Decal Manager ─────────────────────────────────────────────────

export class DecalSystem {
  private scene: THREE.Scene | null = null;
  private decals: ActiveDecal[] = [];
  private poolCounts = new Map<string, number>();
  private poolMax = new Map<string, number>();
  private _tempOrientation = new THREE.Euler();

  /** Offset along surface normal ($) */
  public defaultNormalOffset = 0.001;

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /**
   * Project a decal onto a mesh at the hit point.
   * @param target The mesh to project onto
   * @param position Hit point on the surface
   * @param normal Surface normal at the hit point
   * @param config Decal configuration
   * @param poolName Optional pool name for managing max counts per type
   */
  project(
    target: THREE.Mesh,
    position: THREE.Vector3,
    normal: THREE.Vector3,
    config: DecalConfig = {},
    poolName = 'default'
  ): THREE.Mesh | null {
    if (!this.scene) return null;

    const size = config.size ?? DEFAULT_SIZE.clone();
    const offset = config.normalOffset ?? this.defaultNormalOffset;

    // Position with normal offset
    const decalPos = position.clone().addScaledVector(normal, offset);

    // Calculate orientation from normal
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(normal.dot(up)) > 0.99) {
      up.set(0, 0, 1);
    }
    const mat4 = new THREE.Matrix4();
    mat4.lookAt(decalPos, decalPos.clone().add(normal), up);
    this._tempOrientation.setFromRotationMatrix(mat4);

    // Create decal geometry
    let decalGeo: THREE.BufferGeometry;
    try {
      decalGeo = new DecalGeometry(target, decalPos, this._tempOrientation, size);
    } catch {
      return null; // DecalGeometry can fail for edge cases
    }

    if (decalGeo.getAttribute('position')?.count === 0) {
      decalGeo.dispose();
      return null;
    }

    // Material
    const material = config.material ??
      new THREE.MeshBasicMaterial({
        map: config.texture ?? null,
        color: config.color ?? 0xffffff,
        transparent: true,
        opacity: config.opacity ?? 0.8,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });

    const mesh = new THREE.Mesh(decalGeo, material);
    mesh.renderOrder = 100;
    mesh.name = `Decal_${poolName}`;

    // Enforce pool limits
    const maxCount = config.maxCount ?? 100;
    this.poolMax.set(poolName, maxCount);
    const currentCount = this.poolCounts.get(poolName) ?? 0;

    if (currentCount >= maxCount) {
      // Remove oldest decal in this pool
      const oldest = this.decals.findIndex(d => d.pool === poolName);
      if (oldest >= 0) {
        this.removeDecal(oldest);
      }
    }

    this.scene.add(mesh);
    this.decals.push({
      mesh,
      age: 0,
      lifetime: config.lifetime ?? 0,
      fadeTime: config.fadeTime ?? 2,
      pool: poolName,
    });
    this.poolCounts.set(poolName, (this.poolCounts.get(poolName) ?? 0) + 1);

    return mesh;
  }

  /**
   * Convenience: project at a raycast hit result.
   */
  projectAtHit(
    hit: { object: THREE.Object3D; point: THREE.Vector3; face?: { normal: THREE.Vector3 } | null },
    config: DecalConfig = {},
    poolName = 'default'
  ): THREE.Mesh | null {
    if (!(hit.object instanceof THREE.Mesh)) return null;
    const normal = hit.face?.normal ?? new THREE.Vector3(0, 1, 0);
    // Transform normal to world space
    const worldNormal = normal.clone().transformDirection(hit.object.matrixWorld);
    return this.project(hit.object, hit.point, worldNormal, config, poolName);
  }

  /** Update decal lifetimes and fade-outs */
  update(delta: number): void {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const decal = this.decals[i];
      if (decal.lifetime <= 0) continue; // permanent

      decal.age += delta;

      // Fade out
      if (decal.age >= decal.lifetime - decal.fadeTime) {
        const fadeProgress = (decal.age - (decal.lifetime - decal.fadeTime)) / decal.fadeTime;
        const mat = decal.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, 1 - fadeProgress) * (mat.userData.originalOpacity ?? mat.opacity);
        if (!mat.userData.originalOpacity) mat.userData.originalOpacity = mat.opacity;
      }

      if (decal.age >= decal.lifetime) {
        this.removeDecal(i);
      }
    }
  }

  private removeDecal(index: number): void {
    const decal = this.decals[index];
    decal.mesh.geometry.dispose();
    if (!Array.isArray(decal.mesh.material)) {
      decal.mesh.material.dispose();
    }
    decal.mesh.parent?.remove(decal.mesh);
    this.poolCounts.set(decal.pool, Math.max(0, (this.poolCounts.get(decal.pool) ?? 1) - 1));
    this.decals.splice(index, 1);
  }

  /** Remove all decals */
  clear(poolName?: string): void {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      if (!poolName || this.decals[i].pool === poolName) {
        this.removeDecal(i);
      }
    }
  }

  /** Get statistics */
  getStats(): { total: number; byPool: Record<string, number> } {
    const byPool: Record<string, number> = {};
    for (const [name, count] of this.poolCounts) {
      byPool[name] = count;
    }
    return { total: this.decals.length, byPool };
  }

  dispose(): void {
    this.clear();
    this.scene = null;
  }
}
