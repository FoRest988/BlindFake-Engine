// ─── Raycasting Utilities ────────────────────────────────────────────
// Easy raycasting for mouse picking, shooting, interaction detection,
// ground detection, and line-of-sight checks.

import * as THREE from 'three';

const _raycaster = new THREE.Raycaster();
const _screenPoint = new THREE.Vector2();
const _direction = new THREE.Vector3();

export interface RaycastHit {
  object: THREE.Object3D;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  faceIndex: number | null;
  /** The top-level entity root (walks up parents) */
  root: THREE.Object3D;
}

export class RaycastUtils {
  /** Cast from camera through screen pixel (mouse click picking) */
  static fromScreen(
    screenX: number,
    screenY: number,
    camera: THREE.Camera,
    targets: THREE.Object3D[],
    options?: { recursive?: boolean; layers?: number },
  ): RaycastHit | null {
    _screenPoint.set(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1,
    );
    _raycaster.setFromCamera(_screenPoint, camera);
    if (options?.layers !== undefined) _raycaster.layers.set(options.layers);

    return this.castAgainst(_raycaster, targets, options?.recursive ?? true);
  }

  /** Cast from a 3D origin in a direction */
  static fromPoint(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    targets: THREE.Object3D[],
    options?: { maxDistance?: number; recursive?: boolean },
  ): RaycastHit | null {
    _raycaster.set(origin, direction.clone().normalize());
    _raycaster.far = options?.maxDistance ?? Infinity;

    return this.castAgainst(_raycaster, targets, options?.recursive ?? true);
  }

  /** Cast from origin in direction, return ALL hits sorted by distance */
  static fromPointAll(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    targets: THREE.Object3D[],
    options?: { maxDistance?: number; recursive?: boolean },
  ): RaycastHit[] {
    _raycaster.set(origin, direction.clone().normalize());
    _raycaster.far = options?.maxDistance ?? Infinity;

    const intersections = _raycaster.intersectObjects(targets, options?.recursive ?? true);
    return intersections.map((i) => this.toHit(i));
  }

  /** Cast downward from position to find ground height */
  static groundCheck(
    position: THREE.Vector3,
    targets: THREE.Object3D[],
    maxDistance = 100,
  ): { hit: boolean; height: number; normal: THREE.Vector3 } {
    _raycaster.set(
      new THREE.Vector3(position.x, position.y + 1, position.z),
      new THREE.Vector3(0, -1, 0),
    );
    _raycaster.far = maxDistance;

    const hit = this.castAgainst(_raycaster, targets, true);
    if (hit) {
      return { hit: true, height: hit.point.y, normal: hit.normal };
    }
    return { hit: false, height: 0, normal: new THREE.Vector3(0, 1, 0) };
  }

  /** Check if there's a clear line of sight between two 3D points */
  static lineOfSight(
    from: THREE.Vector3,
    to: THREE.Vector3,
    obstacles: THREE.Object3D[],
  ): boolean {
    _direction.copy(to).sub(from);
    const dist = _direction.length();
    _direction.normalize();

    _raycaster.set(from, _direction);
    _raycaster.far = dist;

    const intersections = _raycaster.intersectObjects(obstacles, true);
    return intersections.length === 0;
  }

  /** Sphere overlap check — find all objects within radius of a point */
  static sphereOverlap(
    center: THREE.Vector3,
    radius: number,
    candidates: THREE.Object3D[],
  ): THREE.Object3D[] {
    const rSq = radius * radius;
    const results: THREE.Object3D[] = [];

    for (const obj of candidates) {
      const pos = new THREE.Vector3();
      obj.getWorldPosition(pos);
      if (pos.distanceToSquared(center) <= rSq) {
        results.push(obj);
      }
    }

    return results;
  }

  /** Box overlap — check if object's world bounding box intersects a box */
  static boxOverlap(
    box: THREE.Box3,
    candidates: THREE.Object3D[],
  ): THREE.Object3D[] {
    const results: THREE.Object3D[] = [];
    const objBox = new THREE.Box3();

    for (const obj of candidates) {
      objBox.setFromObject(obj);
      if (box.intersectsBox(objBox)) {
        results.push(obj);
      }
    }

    return results;
  }

  /** Screen-to-world: project a screen point to a plane in world space */
  static screenToWorldPlane(
    screenX: number,
    screenY: number,
    camera: THREE.Camera,
    plane: THREE.Plane,
  ): THREE.Vector3 | null {
    _screenPoint.set(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1,
    );
    _raycaster.setFromCamera(_screenPoint, camera);

    const target = new THREE.Vector3();
    const hit = _raycaster.ray.intersectPlane(plane, target);
    return hit;
  }

  /** Screen-to-ground: convenience for Y=0 plane */
  static screenToGround(screenX: number, screenY: number, camera: THREE.Camera, groundY = 0): THREE.Vector3 | null {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);
    return this.screenToWorldPlane(screenX, screenY, camera, plane);
  }

  // ── Private ─────────────────────────────────────────────────────

  private static castAgainst(
    raycaster: THREE.Raycaster,
    targets: THREE.Object3D[],
    recursive: boolean,
  ): RaycastHit | null {
    const intersections = raycaster.intersectObjects(targets, recursive);
    if (intersections.length === 0) return null;
    return this.toHit(intersections[0]);
  }

  private static toHit(intersection: THREE.Intersection): RaycastHit {
    // Walk up to find the root entity object
    let root = intersection.object;
    while (root.parent && root.parent.type !== 'Scene') {
      root = root.parent;
    }

    return {
      object: intersection.object,
      point: intersection.point.clone(),
      normal: intersection.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0),
      distance: intersection.distance,
      faceIndex: intersection.faceIndex ?? null,
      root,
    };
  }
}
