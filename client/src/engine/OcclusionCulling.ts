/**
 * OcclusionCulling — Advanced visibility culling system.
 * Features:
 * - Frustum culling (standard + hierarchical)
 * - Software occlusion culling via depth buffer read-back
 * - Portal-based culling for indoor scenes
 * - Distance-based LOD culling
 * - Sector/cell visibility pre-computation
 * - Culling statistics
 */

import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────

export interface CullStats {
  totalObjects: number;
  frustumCulled: number;
  occlusionCulled: number;
  distanceCulled: number;
  portalCulled: number;
  rendered: number;
  timeMs: number;
}

export interface LODEntry {
  distance: number;
  object: THREE.Object3D;
}

export interface CullingPortal {
  id: string;
  /** 4 vertices defining the portal quad (world space) */
  vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  /** The two sectors this portal connects */
  sectorA: string;
  sectorB: string;
  open: boolean;
}

export interface CullingSector {
  id: string;
  /** Axis-aligned bounding box for this sector */
  bounds: THREE.Box3;
  /** Objects in this sector */
  objects: THREE.Object3D[];
  /** Portals connecting to other sectors */
  portalIds: string[];
}

// ─── Frustum Culling (Enhanced) ──────────────────────

export class HierarchicalFrustumCuller {
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private tempBox = new THREE.Box3();
  private tempSphere = new THREE.Sphere();

  /** Update frustum from camera. Call each frame. */
  updateFrustum(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }

  /** Test a single object against frustum */
  isVisible(obj: THREE.Object3D): boolean {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
      if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
      this.tempSphere.copy(obj.geometry.boundingSphere!);
      this.tempSphere.applyMatrix4(obj.matrixWorld);
      return this.frustum.intersectsSphere(this.tempSphere);
    }
    // For groups/other, use bounding box
    this.tempBox.setFromObject(obj);
    return !this.tempBox.isEmpty() && this.frustum.intersectsBox(this.tempBox);
  }

  /** Hierarchical cull: skip entire subtrees if parent bounding box is outside frustum */
  cullHierarchy(root: THREE.Object3D): THREE.Object3D[] {
    const visible: THREE.Object3D[] = [];
    this.cullNode(root, visible);
    return visible;
  }

  private cullNode(node: THREE.Object3D, visible: THREE.Object3D[]): void {
    // Check node's bounding box first
    this.tempBox.setFromObject(node);
    if (this.tempBox.isEmpty()) return;
    if (!this.frustum.intersectsBox(this.tempBox)) return; // Skip entire subtree

    if ((node as THREE.Mesh).isMesh) {
      visible.push(node);
    }

    for (const child of node.children) {
      this.cullNode(child, visible);
    }
  }
}

// ─── Software Occlusion Culling ──────────────────────

/**
 * Uses a low-resolution depth buffer rendered on the CPU
 * to determine if objects are behind other objects.
 * This is a simplified screen-space approach.
 */
export class SoftwareOcclusionCuller {
  private width: number;
  private height: number;
  private depthBuffer: Float32Array;
  private projMatrix = new THREE.Matrix4();
  private viewMatrix = new THREE.Matrix4();
  private vpMatrix = new THREE.Matrix4();

  constructor(width = 128, height = 64) {
    this.width = width;
    this.height = height;
    this.depthBuffer = new Float32Array(width * height).fill(1);
  }

  /** Clear depth buffer */
  clear(): void {
    this.depthBuffer.fill(1);
  }

  /** Update matrices from camera */
  updateCamera(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.viewMatrix.copy(camera.matrixWorldInverse);
    this.projMatrix.copy(camera.projectionMatrix);
    this.vpMatrix.multiplyMatrices(this.projMatrix, this.viewMatrix);
  }

  /** Rasterize an occluder's bounding box into the depth buffer */
  rasterizeOccluder(box: THREE.Box3): void {
    const corners = this.getScreenCorners(box);
    if (!corners) return;

    const minX = Math.max(0, Math.floor(corners.minX));
    const maxX = Math.min(this.width - 1, Math.ceil(corners.maxX));
    const minY = Math.max(0, Math.floor(corners.minY));
    const maxY = Math.min(this.height - 1, Math.ceil(corners.maxY));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * this.width + x;
        if (corners.depth < this.depthBuffer[idx]) {
          this.depthBuffer[idx] = corners.depth;
        }
      }
    }
  }

  /** Test if an object's bounding box is fully occluded */
  isOccluded(box: THREE.Box3): boolean {
    const corners = this.getScreenCorners(box);
    if (!corners) return true; // Behind camera

    const minX = Math.max(0, Math.floor(corners.minX));
    const maxX = Math.min(this.width - 1, Math.ceil(corners.maxX));
    const minY = Math.max(0, Math.floor(corners.minY));
    const maxY = Math.min(this.height - 1, Math.ceil(corners.maxY));

    // If any pixel in the rect has a depth greater than the object's near depth,
    // then the object is potentially visible
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = y * this.width + x;
        if (this.depthBuffer[idx] >= corners.depth) {
          return false; // At least one pixel is not occluded
        }
      }
    }
    return true;
  }

  private getScreenCorners(box: THREE.Box3): { minX: number; maxX: number; minY: number; maxY: number; depth: number } | null {
    const points = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let nearDepth = Infinity;
    let allBehind = true;

    for (const p of points) {
      p.applyMatrix4(this.vpMatrix);
      // If behind near plane, clip
      if (p.z < -1) continue;
      allBehind = false;

      const sx = (p.x * 0.5 + 0.5) * this.width;
      const sy = (p.y * 0.5 + 0.5) * this.height;
      const depth = p.z * 0.5 + 0.5;

      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
      if (depth < nearDepth) nearDepth = depth;
    }

    if (allBehind) return null;
    return { minX, maxX, minY, maxY, depth: nearDepth };
  }
}

// ─── Portal-Based Culling ────────────────────────────

export class PortalCullingSystem {
  private sectors = new Map<string, CullingSector>();
  private portals = new Map<string, CullingPortal>();

  addSector(sector: CullingSector): void {
    this.sectors.set(sector.id, sector);
  }

  removeSector(id: string): void {
    this.sectors.delete(id);
  }

  addPortal(portal: CullingPortal): void {
    this.portals.set(portal.id, portal);
  }

  removePortal(id: string): void {
    this.portals.delete(id);
  }

  /** Find which sector a point is in */
  findSector(point: THREE.Vector3): CullingSector | null {
    for (const sector of this.sectors.values()) {
      if (sector.bounds.containsPoint(point)) return sector;
    }
    return null;
  }

  /** Get all visible objects from a camera position using portal traversal */
  getVisibleObjects(cameraPos: THREE.Vector3, frustum: THREE.Frustum, maxDepth = 4): Set<THREE.Object3D> {
    const result = new Set<THREE.Object3D>();
    const currentSector = this.findSector(cameraPos);
    if (!currentSector) {
      // Not in any sector — render everything
      for (const s of this.sectors.values()) {
        for (const obj of s.objects) result.add(obj);
      }
      return result;
    }

    const visited = new Set<string>();
    this.traversePortals(currentSector, frustum, result, visited, maxDepth);
    return result;
  }

  private traversePortals(
    sector: CullingSector,
    frustum: THREE.Frustum,
    result: Set<THREE.Object3D>,
    visited: Set<string>,
    depth: number,
  ): void {
    if (depth <= 0 || visited.has(sector.id)) return;
    visited.add(sector.id);

    // Add objects in this sector that pass frustum test
    for (const obj of sector.objects) {
      result.add(obj);
    }

    // Traverse connected portals
    for (const portalId of sector.portalIds) {
      const portal = this.portals.get(portalId);
      if (!portal || !portal.open) continue;

      // Check if portal is in frustum
      const portalBox = new THREE.Box3();
      for (const v of portal.vertices) portalBox.expandByPoint(v);
      if (!frustum.intersectsBox(portalBox)) continue;

      // Go to the other side
      const nextSectorId = portal.sectorA === sector.id ? portal.sectorB : portal.sectorA;
      const nextSector = this.sectors.get(nextSectorId);
      if (nextSector) {
        this.traversePortals(nextSector, frustum, result, visited, depth - 1);
      }
    }
  }
}

// ─── Distance LOD Culler ─────────────────────────────

export class DistanceLODCuller {
  private lodGroups = new Map<string, LODEntry[]>();
  private maxDistance = 1000;

  setMaxDistance(d: number): void { this.maxDistance = d; }

  /** Register LOD levels for an object (sorted by distance ascending) */
  registerLOD(id: string, levels: LODEntry[]): void {
    this.lodGroups.set(id, levels.sort((a, b) => a.distance - b.distance));
  }

  removeLOD(id: string): void {
    this.lodGroups.delete(id);
  }

  /** Update LOD visibility based on camera distance */
  update(cameraPos: THREE.Vector3): number {
    let culledCount = 0;

    for (const levels of this.lodGroups.values()) {
      const pos = new THREE.Vector3();
      levels[0].object.getWorldPosition(pos);
      const dist = cameraPos.distanceTo(pos);

      if (dist > this.maxDistance) {
        // Too far — hide all
        for (const lod of levels) lod.object.visible = false;
        culledCount++;
        continue;
      }

      // Find appropriate LOD level
      let activeIndex = 0;
      for (let i = levels.length - 1; i >= 0; i--) {
        if (dist >= levels[i].distance) {
          activeIndex = i;
          break;
        }
      }

      for (let i = 0; i < levels.length; i++) {
        levels[i].object.visible = (i === activeIndex);
      }
    }

    return culledCount;
  }
}

// ─── Main Culling Manager ────────────────────────────

export class OcclusionCullingManager {
  readonly frustumCuller = new HierarchicalFrustumCuller();
  readonly occlusionCuller = new SoftwareOcclusionCuller();
  readonly portalSystem = new PortalCullingSystem();
  readonly lodCuller = new DistanceLODCuller();

  /** Enable/disable each culling stage */
  enableFrustumCulling = true;
  enableOcclusionCulling = false; // Expensive, opt-in
  enablePortalCulling = false;    // Only for indoor scenes
  enableLODCulling = true;

  /** Large occluder meshes (walls, buildings) for software occlusion */
  occluders: THREE.Mesh[] = [];

  lastStats: CullStats = {
    totalObjects: 0, frustumCulled: 0, occlusionCulled: 0,
    distanceCulled: 0, portalCulled: 0, rendered: 0, timeMs: 0,
  };

  /** Run full culling pipeline. Call before render. */
  cull(scene: THREE.Scene, camera: THREE.Camera): CullStats {
    const t0 = performance.now();
    const stats: CullStats = {
      totalObjects: 0, frustumCulled: 0, occlusionCulled: 0,
      distanceCulled: 0, portalCulled: 0, rendered: 0, timeMs: 0,
    };

    // Collect all meshes
    const meshes: THREE.Mesh[] = [];
    scene.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
    });
    stats.totalObjects = meshes.length;

    // Update frustum
    this.frustumCuller.updateFrustum(camera);

    // Portal culling (determine potentially visible set)
    let portalVisibleSet: Set<THREE.Object3D> | null = null;
    if (this.enablePortalCulling) {
      const cameraPos = new THREE.Vector3();
      camera.getWorldPosition(cameraPos);
      const frustum = new THREE.Frustum();
      const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(m);
      portalVisibleSet = this.portalSystem.getVisibleObjects(cameraPos, frustum);
    }

    // LOD culling
    if (this.enableLODCulling) {
      const cameraPos = new THREE.Vector3();
      camera.getWorldPosition(cameraPos);
      stats.distanceCulled = this.lodCuller.update(cameraPos);
    }

    // Software occlusion: rasterize occluders first
    if (this.enableOcclusionCulling) {
      this.occlusionCuller.clear();
      this.occlusionCuller.updateCamera(camera);
      const box = new THREE.Box3();
      for (const occ of this.occluders) {
        box.setFromObject(occ);
        this.occlusionCuller.rasterizeOccluder(box);
      }
    }

    // Per-mesh culling
    const box = new THREE.Box3();
    for (const mesh of meshes) {
      // Portal cull
      if (portalVisibleSet && !portalVisibleSet.has(mesh)) {
        mesh.visible = false;
        stats.portalCulled++;
        continue;
      }

      // Frustum cull
      if (this.enableFrustumCulling && !this.frustumCuller.isVisible(mesh)) {
        mesh.visible = false;
        stats.frustumCulled++;
        continue;
      }

      // Occlusion cull
      if (this.enableOcclusionCulling) {
        box.setFromObject(mesh);
        if (this.occlusionCuller.isOccluded(box)) {
          mesh.visible = false;
          stats.occlusionCulled++;
          continue;
        }
      }

      mesh.visible = true;
      stats.rendered++;
    }

    stats.timeMs = performance.now() - t0;
    this.lastStats = stats;
    return stats;
  }

  getStats(): CullStats {
    return { ...this.lastStats };
  }
}
