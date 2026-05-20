/**
 * SplinePathSystem — Create and manage spline paths for:
 * - Movement paths (NPCs, vehicles, cameras)
 * - Collision walls (barriers, fences, invisible walls)
 * - Rail systems, roller coasters, rivers, roads
 */
import * as THREE from 'three';

export interface SplinePathConfig {
  name: string;
  points: THREE.Vector3[];
  closed: boolean;
  type: 'movement' | 'collision' | 'camera' | 'generic';
  tension?: number; // CatmullRom tension (0-1)
}

export class SplinePath {
  name: string;
  points: THREE.Vector3[];
  closed: boolean;
  type: SplinePathConfig['type'];
  tension: number;

  private curve: THREE.CatmullRomCurve3;
  private lineMesh: THREE.Line | null = null;
  private pointMeshes: THREE.Mesh[] = [];
  private collisionMesh: THREE.Mesh | null = null;
  private parent: THREE.Object3D;

  constructor(parent: THREE.Object3D, config: SplinePathConfig) {
    this.parent = parent;
    this.name = config.name;
    this.points = config.points.map(p => p.clone());
    this.closed = config.closed;
    this.type = config.type;
    this.tension = config.tension ?? 0.5;

    this.curve = new THREE.CatmullRomCurve3(this.points, this.closed, 'catmullrom', this.tension);
    this.buildVisualization();
  }

  /** Get position along the path (0..1) */
  getPointAt(t: number): THREE.Vector3 {
    return this.curve.getPointAt(Math.max(0, Math.min(1, t)));
  }

  /** Get tangent (direction) at t (0..1) */
  getTangentAt(t: number): THREE.Vector3 {
    return this.curve.getTangentAt(Math.max(0, Math.min(1, t)));
  }

  /** Get total path length */
  getLength(): number {
    return this.curve.getLength();
  }

  /** Add a control point */
  addPoint(position: THREE.Vector3): void {
    this.points.push(position.clone());
    this.rebuildCurve();
  }

  /** Insert a control point at index */
  insertPoint(index: number, position: THREE.Vector3): void {
    this.points.splice(index, 0, position.clone());
    this.rebuildCurve();
  }

  /** Remove a control point by index */
  removePoint(index: number): void {
    if (this.points.length <= 2) return;
    this.points.splice(index, 1);
    this.rebuildCurve();
  }

  /** Move a control point */
  movePoint(index: number, position: THREE.Vector3): void {
    if (index < 0 || index >= this.points.length) return;
    this.points[index].copy(position);
    this.rebuildCurve();
  }

  /** Generate a collision wall mesh from the spline */
  generateCollisionWall(height: number = 3, segments: number = 64): THREE.Mesh {
    if (this.collisionMesh) {
      this.parent.remove(this.collisionMesh);
      this.collisionMesh.geometry.dispose();
      (this.collisionMesh.material as THREE.Material).dispose();
    }

    const pathPoints = this.curve.getPoints(segments);
    const vertices: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < pathPoints.length; i++) {
      const p = pathPoints[i];
      vertices.push(p.x, p.y, p.z);
      vertices.push(p.x, p.y + height, p.z);
    }

    for (let i = 0; i < pathPoints.length - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }

    if (this.closed && pathPoints.length > 2) {
      const last = (pathPoints.length - 1) * 2;
      indices.push(last, 0, last + 1);
      indices.push(last + 1, 0, 1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.collisionMesh = new THREE.Mesh(geo, mat);
    this.collisionMesh.name = `${this.name}_CollisionWall`;
    this.collisionMesh.userData.isCollider = true;
    this.parent.add(this.collisionMesh);

    return this.collisionMesh;
  }

  /** Set visualization visibility */
  setVisible(visible: boolean): void {
    if (this.lineMesh) this.lineMesh.visible = visible;
    for (const pm of this.pointMeshes) pm.visible = visible;
    if (this.collisionMesh) this.collisionMesh.visible = visible;
  }

  /** Get serializable data */
  serialize(): SplinePathConfig {
    return {
      name: this.name,
      points: this.points.map(p => p.clone()),
      closed: this.closed,
      type: this.type,
      tension: this.tension,
    };
  }

  dispose(): void {
    if (this.lineMesh) {
      this.parent.remove(this.lineMesh);
      this.lineMesh.geometry.dispose();
      (this.lineMesh.material as THREE.Material).dispose();
    }
    for (const pm of this.pointMeshes) {
      this.parent.remove(pm);
      pm.geometry.dispose();
      (pm.material as THREE.Material).dispose();
    }
    if (this.collisionMesh) {
      this.parent.remove(this.collisionMesh);
      this.collisionMesh.geometry.dispose();
      (this.collisionMesh.material as THREE.Material).dispose();
    }
  }

  private rebuildCurve(): void {
    this.curve = new THREE.CatmullRomCurve3(this.points, this.closed, 'catmullrom', this.tension);
    this.buildVisualization();
  }

  private buildVisualization(): void {
    // Clean up old
    if (this.lineMesh) {
      this.parent.remove(this.lineMesh);
      this.lineMesh.geometry.dispose();
      (this.lineMesh.material as THREE.Material).dispose();
    }
    for (const pm of this.pointMeshes) {
      this.parent.remove(pm);
      pm.geometry.dispose();
      (pm.material as THREE.Material).dispose();
    }
    this.pointMeshes = [];

    if (this.points.length < 2) return;

    // Line
    const curvePoints = this.curve.getPoints(Math.max(this.points.length * 10, 50));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(curvePoints);
    const color = this.type === 'collision' ? 0xff4444 : this.type === 'camera' ? 0x44aaff : 0x44ff44;
    const lineMat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
    this.lineMesh = new THREE.Line(lineGeo, lineMat);
    this.lineMesh.name = `${this.name}_Path`;
    this.lineMesh.renderOrder = 998;
    this.parent.add(this.lineMesh);

    // Control point spheres
    const sphereGeo = new THREE.SphereGeometry(0.2, 8, 8);
    for (let i = 0; i < this.points.length; i++) {
      const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, depthTest: false });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      sphere.position.copy(this.points[i]);
      sphere.renderOrder = 999;
      sphere.userData._splinePointIndex = i;
      sphere.userData._splineName = this.name;
      this.parent.add(sphere);
      this.pointMeshes.push(sphere);
    }
  }
}

/**
 * SplinePathSystem — Manages multiple spline paths in a scene
 */
export class SplinePathSystem {
  private paths: Map<string, SplinePath> = new Map();
  private parent: THREE.Object3D;

  constructor(parent: THREE.Object3D) {
    this.parent = parent;
  }

  createPath(config: SplinePathConfig): SplinePath {
    const path = new SplinePath(this.parent, config);
    this.paths.set(config.name, path);
    return path;
  }

  getPath(name: string): SplinePath | undefined {
    return this.paths.get(name);
  }

  getAllPaths(): SplinePath[] {
    return Array.from(this.paths.values());
  }

  removePath(name: string): void {
    const path = this.paths.get(name);
    if (path) {
      path.dispose();
      this.paths.delete(name);
    }
  }

  /** Move an object along a named path over time */
  moveAlongPath(
    object: THREE.Object3D,
    pathName: string,
    t: number,
    alignToPath = true,
  ): boolean {
    const path = this.paths.get(pathName);
    if (!path) return false;

    const pos = path.getPointAt(t);
    object.position.copy(pos);

    if (alignToPath) {
      const tangent = path.getTangentAt(t);
      object.lookAt(pos.clone().add(tangent));
    }

    return true;
  }

  serializeAll(): SplinePathConfig[] {
    return Array.from(this.paths.values()).map(p => p.serialize());
  }

  dispose(): void {
    for (const path of this.paths.values()) {
      path.dispose();
    }
    this.paths.clear();
  }
}
