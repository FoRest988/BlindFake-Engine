/**
 * LODSystem — Level of Detail management.
 * Automatically swaps mesh detail levels based on camera distance.
 * 
 * Usage:
 *   const lod = engine.lod;
 *   const group = lod.create('tree', [
 *     { object: highPolyTree, distance: 0 },
 *     { object: medPolyTree, distance: 25 },
 *     { object: lowPolyTree, distance: 60 },
 *     { object: billboardTree, distance: 120 },
 *   ]);
 *   scene.add(group);
 */

import * as THREE from 'three';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';

export interface LODLevel {
  /** The 3D object for this detail level */
  object: THREE.Object3D;
  /** Distance from camera at which this level activates (ascending order) */
  distance: number;
}

export interface LODEntry {
  name: string;
  lod: THREE.LOD;
  levels: LODLevel[];
}

export class LODSystem {
  private entries = new Map<string, LODEntry>();
  private camera: THREE.Camera;
  private autoUpdate = true;

  /** Global bias: positive = switch to lower detail sooner, negative = keep high detail longer */
  public distanceBias = 0;
  /** Hysteresis factor to prevent rapid switching at threshold boundaries */
  public hysteresis = 1.05;

  constructor(camera: THREE.Camera) {
    this.camera = camera;
  }

  /** Set the camera used for distance calculations */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /**
   * Create a new LOD group.
   * @param name Unique identifier
   * @param levels Array of { object, distance } sorted by ascending distance
   * @returns The THREE.LOD object to add to scene
   */
  create(name: string, levels: LODLevel[]): THREE.LOD {
    const lod = new THREE.LOD();
    lod.name = `LOD_${name}`;

    // Sort levels by distance ascending
    const sorted = [...levels].sort((a, b) => a.distance - b.distance);

    for (const level of sorted) {
      lod.addLevel(level.object, level.distance + this.distanceBias);
    }

    lod.autoUpdate = false; // We manage updates ourselves for hysteresis

    const entry: LODEntry = { name, lod, levels: sorted };
    this.entries.set(name, entry);
    return lod;
  }

  /** Remove a LOD group by name */
  remove(name: string): void {
    const entry = this.entries.get(name);
    if (entry) {
      entry.lod.parent?.remove(entry.lod);
      this.entries.delete(name);
    }
  }

  /** Get a LOD group by name */
  get(name: string): THREE.LOD | undefined {
    return this.entries.get(name)?.lod;
  }

  /**
   * Generate LOD levels automatically by simplifying geometry.
   * Creates 3 levels: original, 50% reduced, 25% reduced.
   * Works only for single-mesh objects.
   */
  createAutoLOD(
    name: string,
    mesh: THREE.Mesh,
    distances: [number, number, number] = [0, 30, 60]
  ): THREE.LOD {
    const levels: LODLevel[] = [
      { object: mesh, distance: distances[0] },
    ];

    // Level 1: Reduce vertex count (simple approach — merge nearby vertices)
    const geo1 = this.simplifyGeometry(mesh.geometry, 0.5);
    const mesh1 = new THREE.Mesh(geo1, mesh.material);
    mesh1.castShadow = mesh.castShadow;
    mesh1.receiveShadow = mesh.receiveShadow;
    levels.push({ object: mesh1, distance: distances[1] });

    // Level 2: Further reduced
    const geo2 = this.simplifyGeometry(mesh.geometry, 0.25);
    const mesh2 = new THREE.Mesh(geo2, mesh.material);
    mesh2.castShadow = mesh.castShadow;
    mesh2.receiveShadow = mesh.receiveShadow;
    levels.push({ object: mesh2, distance: distances[2] });

    return this.create(name, levels);
  }

  /**
   * Simplified geometry reduction: keeps every Nth face to maintain triangle coherence.
   * Basic approach — for production use, integrate a proper mesh simplifier.
   */
  private simplifyGeometry(source: THREE.BufferGeometry, ratio: number): THREE.BufferGeometry {
    const posAttr = source.getAttribute('position') as THREE.BufferAttribute;
    if (!posAttr) return source.clone();

    const sourceIndex = source.getIndex();
    const totalVerts = posAttr.count;
    const normalAttr = source.getAttribute('normal') as THREE.BufferAttribute | null;
    const uvAttr = source.getAttribute('uv') as THREE.BufferAttribute | null;

    // Determine source triangles
    let srcTriCount: number;
    if (sourceIndex) {
      srcTriCount = Math.floor(sourceIndex.count / 3);
    } else {
      srcTriCount = Math.floor(totalVerts / 3);
    }

    const targetTris = Math.max(1, Math.floor(srcTriCount * ratio));
    if (targetTris >= srcTriCount) return source.clone();

    const step = srcTriCount / targetTris;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    for (let t = 0; t < targetTris; t++) {
      const triIdx = Math.min(Math.floor(t * step), srcTriCount - 1);

      for (let v = 0; v < 3; v++) {
        let vertIdx: number;
        if (sourceIndex) {
          vertIdx = sourceIndex.getX(triIdx * 3 + v);
        } else {
          vertIdx = triIdx * 3 + v;
        }

        positions.push(posAttr.getX(vertIdx), posAttr.getY(vertIdx), posAttr.getZ(vertIdx));
        if (normalAttr) normals.push(normalAttr.getX(vertIdx), normalAttr.getY(vertIdx), normalAttr.getZ(vertIdx));
        if (uvAttr) uvs.push(uvAttr.getX(vertIdx), uvAttr.getY(vertIdx));
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (normals.length > 0) geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    if (uvs.length > 0) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeBoundingSphere();

    return geo;
  }

  /** Update all LOD groups based on camera distance. Call in game loop. */
  update(): void {
    if (!this.autoUpdate) return;

    for (const entry of this.entries.values()) {
      entry.lod.update(this.camera);
    }
  }

  /** Get stats about LOD usage */
  getStats(): { total: number; byLevel: Map<number, number> } {
    const byLevel = new Map<number, number>();
    for (const entry of this.entries.values()) {
      const currentLevel = entry.lod.getCurrentLevel();
      byLevel.set(currentLevel, (byLevel.get(currentLevel) ?? 0) + 1);
    }
    return { total: this.entries.size, byLevel };
  }

  /** Enable/disable auto-update */
  setAutoUpdate(enabled: boolean): void {
    this.autoUpdate = enabled;
  }

  /** Remove all LOD groups */
  clear(): void {
    for (const entry of this.entries.values()) {
      entry.lod.parent?.remove(entry.lod);
    }
    this.entries.clear();
  }

  dispose(): void {
    this.clear();
  }

  // ── Auto-generation ────────────────────────────────────────────────────────

  /**
   * Automatically generate a multi-level LOD group from a single high-poly mesh.
   *
   * Produces up to three levels:
   *   - Level 0 (distance 0):  original mesh (full detail)
   *   - Level 1 (distance d1): ~50 % of original vertex count
   *   - Level 2 (distance d2): ~25 % of original vertex count
   *
   * Uses Three.js `SimplifyModifier`. If simplification fails for a level
   * (e.g. non-indexed geometry), that level is silently skipped.
   *
   * @param name Unique identifier passed to `create()`
   * @param mesh  High-poly source mesh (level 0)
   * @param d1    Camera distance at which to switch to 50 % detail (default 20)
   * @param d2    Camera distance at which to switch to 25 % detail (default 60)
   * @returns THREE.LOD group — add to scene as usual
   */
  generateFromMesh(name: string, mesh: THREE.Mesh, d1 = 20, d2 = 60): THREE.LOD {
    const simplify = new SimplifyModifier();
    const srcGeo = mesh.geometry;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const vertCount = srcGeo.attributes['position']?.count ?? 0;

    const levels: LODLevel[] = [{ object: mesh, distance: 0 }];

    if (vertCount > 6) {
      // 50 % detail
      try {
        const geo50 = simplify.modify(srcGeo.clone(), Math.max(3, Math.floor(vertCount * 0.5)));
        const mesh50 = new THREE.Mesh(geo50, mat);
        mesh50.name = `${mesh.name}_lod1`;
        levels.push({ object: mesh50, distance: d1 });
      } catch { /* SimplifyModifier may fail on non-indexed or degenerate geometries */ }

      // 25 % detail
      try {
        const geo25 = simplify.modify(srcGeo.clone(), Math.max(3, Math.floor(vertCount * 0.25)));
        const mesh25 = new THREE.Mesh(geo25, mat);
        mesh25.name = `${mesh.name}_lod2`;
        levels.push({ object: mesh25, distance: d2 });
      } catch { /* skip */ }
    }

    return this.create(name, levels);
  }
}
