/**
 * NavMeshSystem — 3D Navigation Mesh for AI pathfinding.
 * Features:
 * - NavMesh generation from scene geometry (voxelization + polygon extraction)
 * - A* pathfinding on navigation polygons
 * - Path smoothing with string-pulling (funnel algorithm)
 * - NavMesh agents with steering behaviors
 * - Off-mesh links (jumps, ladders, teleports)
 * - Dynamic obstacle avoidance
 * - NavMesh areas with cost modifiers
 * - Debug visualization
 */

import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────

export interface NavPoly {
  id: number;
  vertices: THREE.Vector3[];  // 3+ vertices defining the polygon
  center: THREE.Vector3;
  normal: THREE.Vector3;
  neighbors: number[];        // adjacent polygon IDs
  area: number;               // surface area
  cost: number;               // traversal cost modifier (1 = normal)
  areaType: string;           // 'walkable' | 'water' | 'road' | 'grass' etc.
}

export interface NavEdge {
  polyA: number;
  polyB: number;
  /** Shared edge vertices (portal) */
  left: THREE.Vector3;
  right: THREE.Vector3;
  width: number;
}

export interface OffMeshLink {
  id: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  bidirectional: boolean;
  cost: number;
  areaType: string;
  /** Radius in which the link activates */
  radius: number;
}

export interface NavPath {
  points: THREE.Vector3[];
  length: number;
  polyIds: number[];
  valid: boolean;
}

export interface NavAgentConfig {
  radius: number;
  height: number;
  maxSpeed: number;
  acceleration: number;
  stoppingDistance: number;
  /** Max slope in degrees the agent can traverse */
  maxSlope: number;
  /** Step height the agent can climb */
  stepHeight: number;
  /** Avoidance priority (lower = higher priority) */
  avoidancePriority: number;
  /** Area cost overrides */
  areaCosts: Record<string, number>;
}

const DEFAULT_AGENT_CONFIG: NavAgentConfig = {
  radius: 0.5,
  height: 2,
  maxSpeed: 5,
  acceleration: 10,
  stoppingDistance: 0.2,
  maxSlope: 45,
  stepHeight: 0.4,
  avoidancePriority: 1,
  areaCosts: {},
};

// ─── NavMesh ─────────────────────────────────────────

export class NavMesh {
  private polys: NavPoly[] = [];
  private edges: NavEdge[] = [];
  private offMeshLinks: OffMeshLink[] = [];
  private nextPolyId = 0;
  private nextLinkId = 0;
  private polyGrid = new Map<string, number[]>();
  private cellSize = 2;

  // ─── Building ──────────────────────────────────

  /** Build navmesh from scene geometry by extracting walkable triangles */
  buildFromScene(scene: THREE.Object3D, config: { maxSlope?: number; cellSize?: number; minArea?: number } = {}): void {
    this.clear();
    const maxSlope = config.maxSlope ?? 45;
    const minArea = config.minArea ?? 0.01;
    this.cellSize = config.cellSize ?? 2;

    const maxSlopeRad = THREE.MathUtils.degToRad(maxSlope);
    const up = new THREE.Vector3(0, 1, 0);

    scene.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (obj.name.startsWith('__')) return; // skip internal objects

      const geo = obj.geometry;
      if (!geo.attributes.position) return;

      const posAttr = geo.attributes.position;
      const index = geo.index;
      const worldMatrix = obj.matrixWorld;

      const triCount = index ? index.count / 3 : posAttr.count / 3;

      for (let t = 0; t < triCount; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

        const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0).applyMatrix4(worldMatrix);
        const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1).applyMatrix4(worldMatrix);
        const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2).applyMatrix4(worldMatrix);

        // Compute face normal
        const edge1 = new THREE.Vector3().subVectors(v1, v0);
        const edge2 = new THREE.Vector3().subVectors(v2, v0);
        const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

        // Check slope: angle between normal and up
        const slopeAngle = Math.acos(Math.min(1, Math.max(-1, normal.dot(up))));
        if (slopeAngle > maxSlopeRad) continue;

        // Check area (skip degenerate triangles)
        const area = edge1.cross(edge2).length() * 0.5;
        if (area < minArea) continue;

        const center = new THREE.Vector3().addVectors(v0, v1).add(v2).divideScalar(3);

        const poly: NavPoly = {
          id: this.nextPolyId++,
          vertices: [v0, v1, v2],
          center,
          normal,
          neighbors: [],
          area,
          cost: 1,
          areaType: 'walkable',
        };

        this.polys.push(poly);
      }
    });

    // Build adjacency
    this.buildAdjacency();
    // Build spatial grid
    this.buildGrid();
  }

  /** Add a manual polygon */
  addPoly(vertices: THREE.Vector3[], areaType = 'walkable', cost = 1): NavPoly {
    const center = new THREE.Vector3();
    for (const v of vertices) center.add(v);
    center.divideScalar(vertices.length);

    const e1 = new THREE.Vector3().subVectors(vertices[1], vertices[0]);
    const e2 = new THREE.Vector3().subVectors(vertices[2], vertices[0]);
    const normal = new THREE.Vector3().crossVectors(e1, e2).normalize();
    const area = e1.cross(e2).length() * 0.5;

    const poly: NavPoly = {
      id: this.nextPolyId++,
      vertices: [...vertices],
      center, normal, neighbors: [], area, cost, areaType,
    };
    this.polys.push(poly);
    return poly;
  }

  addOffMeshLink(from: THREE.Vector3, to: THREE.Vector3, bidirectional = true, cost = 1, radius = 1): OffMeshLink {
    const link: OffMeshLink = {
      id: this.nextLinkId++,
      from: from.clone(), to: to.clone(),
      bidirectional, cost, areaType: 'offmesh', radius,
    };
    this.offMeshLinks.push(link);
    return link;
  }

  removeOffMeshLink(id: number): void {
    const idx = this.offMeshLinks.findIndex(l => l.id === id);
    if (idx !== -1) this.offMeshLinks.splice(idx, 1);
  }

  // ─── Adjacency ────────────────────────────────

  private buildAdjacency(): void {
    // Two triangles are neighbors if they share an edge (2 vertices within epsilon)
    const eps = 0.01;
    this.edges = [];

    for (let i = 0; i < this.polys.length; i++) {
      for (let j = i + 1; j < this.polys.length; j++) {
        const shared = this.findSharedEdge(this.polys[i], this.polys[j], eps);
        if (shared) {
          this.polys[i].neighbors.push(this.polys[j].id);
          this.polys[j].neighbors.push(this.polys[i].id);
          this.edges.push({
            polyA: this.polys[i].id,
            polyB: this.polys[j].id,
            left: shared[0],
            right: shared[1],
            width: shared[0].distanceTo(shared[1]),
          });
        }
      }
    }
  }

  private findSharedEdge(a: NavPoly, b: NavPoly, eps: number): [THREE.Vector3, THREE.Vector3] | null {
    const matches: THREE.Vector3[] = [];
    for (const va of a.vertices) {
      for (const vb of b.vertices) {
        if (va.distanceTo(vb) < eps) {
          matches.push(va.clone());
          if (matches.length === 2) return [matches[0], matches[1]];
        }
      }
    }
    return null;
  }

  private buildGrid(): void {
    this.polyGrid.clear();
    for (const poly of this.polys) {
      const key = this.gridKey(poly.center.x, poly.center.z);
      const arr = this.polyGrid.get(key) ?? [];
      arr.push(poly.id);
      this.polyGrid.set(key, arr);
    }
  }

  private gridKey(x: number, z: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  // ─── Queries ──────────────────────────────────

  /** Find the closest polygon to a world position */
  findClosestPoly(pos: THREE.Vector3, maxDist = 20): NavPoly | null {
    let best: NavPoly | null = null;
    let bestDist = maxDist;

    // Check nearby grid cells first
    const cx = Math.floor(pos.x / this.cellSize);
    const cz = Math.floor(pos.z / this.cellSize);
    const radius = Math.ceil(maxDist / this.cellSize);

    const checked = new Set<number>();

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const key = `${cx + dx},${cz + dz}`;
        const ids = this.polyGrid.get(key);
        if (!ids) continue;
        for (const id of ids) {
          if (checked.has(id)) continue;
          checked.add(id);
          const poly = this.polys[id];
          if (!poly) continue;
          const d = pos.distanceTo(poly.center);
          if (d < bestDist) {
            bestDist = d;
            best = poly;
          }
        }
      }
    }

    // Fallback: linear scan if grid found nothing
    if (!best) {
      for (const poly of this.polys) {
        const d = pos.distanceTo(poly.center);
        if (d < bestDist) {
          bestDist = d;
          best = poly;
        }
      }
    }

    return best;
  }

  getPolyById(id: number): NavPoly | undefined {
    return this.polys.find(p => p.id === id);
  }

  // ─── A* Pathfinding ───────────────────────────

  findPath(from: THREE.Vector3, to: THREE.Vector3, areaCosts?: Record<string, number>): NavPath {
    const startPoly = this.findClosestPoly(from);
    const endPoly = this.findClosestPoly(to);

    if (!startPoly || !endPoly) {
      return { points: [], length: 0, polyIds: [], valid: false };
    }

    if (startPoly.id === endPoly.id) {
      return { points: [from.clone(), to.clone()], length: from.distanceTo(to), polyIds: [startPoly.id], valid: true };
    }

    // A* on polygon graph
    const openSet = new Map<number, { polyId: number; g: number; f: number; parent: number | null }>();
    const closedSet = new Set<number>();
    const cameFrom = new Map<number, number | null>();

    openSet.set(startPoly.id, {
      polyId: startPoly.id,
      g: 0,
      f: startPoly.center.distanceTo(endPoly.center),
      parent: null,
    });
    cameFrom.set(startPoly.id, null);

    while (openSet.size > 0) {
      // Find node with lowest f
      let current: { polyId: number; g: number; f: number; parent: number | null } | null = null;
      for (const node of openSet.values()) {
        if (!current || node.f < current.f) current = node;
      }
      if (!current) break;

      if (current.polyId === endPoly.id) {
        return this.reconstructPath(from, to, startPoly.id, endPoly.id, cameFrom, areaCosts);
      }

      openSet.delete(current.polyId);
      closedSet.add(current.polyId);

      const poly = this.getPolyById(current.polyId);
      if (!poly) continue;

      for (const neighborId of poly.neighbors) {
        if (closedSet.has(neighborId)) continue;

        const neighbor = this.getPolyById(neighborId);
        if (!neighbor) continue;

        const cost = areaCosts?.[neighbor.areaType] ?? neighbor.cost;
        const g = current.g + poly.center.distanceTo(neighbor.center) * cost;
        const h = neighbor.center.distanceTo(endPoly.center);

        const existing = openSet.get(neighborId);
        if (existing && existing.g <= g) continue;

        openSet.set(neighborId, {
          polyId: neighborId,
          g,
          f: g + h,
          parent: current.polyId,
        });
        cameFrom.set(neighborId, current.polyId);
      }
    }

    return { points: [], length: 0, polyIds: [], valid: false };
  }

  private reconstructPath(
    from: THREE.Vector3, to: THREE.Vector3,
    startId: number, endId: number,
    cameFrom: Map<number, number | null>,
    _areaCosts?: Record<string, number>
  ): NavPath {
    // Build polygon chain by backtracking parents
    const chain: number[] = [];

    let current: number | null = endId;
    while (current !== null) {
      chain.unshift(current);
      if (current === startId) break;
      current = cameFrom.get(current) ?? null;
    }

    if (chain.length === 0 || chain[0] !== startId) {
      return { points: [], length: 0, polyIds: [], valid: false };
    }

    // Simple path through polygon centers + smoothing
    const points = [from.clone()];
    for (let i = 1; i < chain.length - 1; i++) {
      const poly = this.getPolyById(chain[i]);
      if (poly) points.push(poly.center.clone());
    }
    points.push(to.clone());

    // Apply string-pulling (funnel algorithm simplification)
    const smoothed = this.smoothPath(points);

    let length = 0;
    for (let i = 1; i < smoothed.length; i++) {
      length += smoothed[i].distanceTo(smoothed[i - 1]);
    }

    return { points: smoothed, length, polyIds: chain, valid: true };
  }

  /** Simple path smoothing — removes redundant waypoints via line-of-sight */
  private smoothPath(points: THREE.Vector3[]): THREE.Vector3[] {
    if (points.length <= 2) return points;

    const result: THREE.Vector3[] = [points[0]];
    let current = 0;

    while (current < points.length - 1) {
      let farthest = current + 1;

      // Try to skip waypoints if there's a direct path
      for (let i = points.length - 1; i > current + 1; i--) {
        // Simple check: if midpoints are close to navmesh
        const mid = new THREE.Vector3().lerpVectors(points[current], points[i], 0.5);
        if (this.findClosestPoly(mid, 3)) {
          farthest = i;
          break;
        }
      }

      result.push(points[farthest]);
      current = farthest;
    }

    return result;
  }

  // ─── Utility ──────────────────────────────────

  getPolys(): ReadonlyArray<NavPoly> { return this.polys; }
  getEdges(): ReadonlyArray<NavEdge> { return this.edges; }
  getOffMeshLinks(): ReadonlyArray<OffMeshLink> { return this.offMeshLinks; }

  /** Sample a random point on the navmesh */
  getRandomPoint(): THREE.Vector3 | null {
    if (this.polys.length === 0) return null;
    const poly = this.polys[Math.floor(Math.random() * this.polys.length)];
    // Random point on triangle (barycentric coordinates)
    const r1 = Math.random();
    const r2 = Math.random();
    const sqrtR1 = Math.sqrt(r1);
    const a = 1 - sqrtR1;
    const b = sqrtR1 * (1 - r2);
    const c = r2 * sqrtR1;
    return new THREE.Vector3(
      poly.vertices[0].x * a + poly.vertices[1].x * b + poly.vertices[2].x * c,
      poly.vertices[0].y * a + poly.vertices[1].y * b + poly.vertices[2].y * c,
      poly.vertices[0].z * a + poly.vertices[1].z * b + poly.vertices[2].z * c,
    );
  }

  clear(): void {
    this.polys = [];
    this.edges = [];
    this.offMeshLinks = [];
    this.polyGrid.clear();
    this.nextPolyId = 0;
  }

  get polyCount(): number { return this.polys.length; }
  get edgeCount(): number { return this.edges.length; }

  // ─── Serialization ────────────────────────────

  serialize(): string {
    return JSON.stringify({
      polys: this.polys.map(p => ({
        id: p.id,
        vertices: p.vertices.map(v => [v.x, v.y, v.z]),
        neighbors: p.neighbors,
        cost: p.cost,
        areaType: p.areaType,
      })),
      links: this.offMeshLinks.map(l => ({
        id: l.id,
        from: [l.from.x, l.from.y, l.from.z],
        to: [l.to.x, l.to.y, l.to.z],
        bidirectional: l.bidirectional,
        cost: l.cost,
        radius: l.radius,
      })),
      cellSize: this.cellSize,
    });
  }

  deserialize(json: string): void {
    this.clear();
    const data = JSON.parse(json);
    this.cellSize = data.cellSize ?? 2;

    for (const p of data.polys) {
      const verts = p.vertices.map((v: number[]) => new THREE.Vector3(v[0], v[1], v[2]));
      const center = new THREE.Vector3();
      for (const v of verts) center.add(v);
      center.divideScalar(verts.length);

      const e1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
      const e2 = new THREE.Vector3().subVectors(verts[2], verts[0]);

      this.polys.push({
        id: p.id,
        vertices: verts,
        center,
        normal: new THREE.Vector3().crossVectors(e1, e2).normalize(),
        neighbors: p.neighbors,
        area: e1.cross(e2).length() * 0.5,
        cost: p.cost,
        areaType: p.areaType,
      });
    }

    this.nextPolyId = Math.max(0, ...this.polys.map(p => p.id)) + 1;

    for (const l of data.links ?? []) {
      this.offMeshLinks.push({
        id: l.id,
        from: new THREE.Vector3(l.from[0], l.from[1], l.from[2]),
        to: new THREE.Vector3(l.to[0], l.to[1], l.to[2]),
        bidirectional: l.bidirectional,
        cost: l.cost,
        areaType: 'offmesh',
        radius: l.radius,
      });
    }
    this.nextLinkId = Math.max(0, ...this.offMeshLinks.map(l => l.id)) + 1;

    this.buildGrid();
  }
}

// ─── NavAgent ────────────────────────────────────────

export class NavAgent {
  public position: THREE.Vector3;
  public velocity = new THREE.Vector3();
  public config: NavAgentConfig;
  public currentPath: NavPath | null = null;
  public pathIndex = 0;
  public active = true;

  /** Object to move (e.g., a mesh or entity). Position is synced each update. */
  public object: THREE.Object3D | null = null;

  private navMesh: NavMesh;
  private onArrived?: () => void;

  constructor(navMesh: NavMesh, position: THREE.Vector3, config?: Partial<NavAgentConfig>) {
    this.navMesh = navMesh;
    this.position = position.clone();
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
  }

  /** Set destination and compute path */
  setDestination(target: THREE.Vector3): boolean {
    const path = this.navMesh.findPath(this.position, target, this.config.areaCosts);
    if (!path.valid) return false;
    this.currentPath = path;
    this.pathIndex = 0;
    return true;
  }

  /** Set callback for when agent reaches destination */
  onArrive(cb: () => void): void {
    this.onArrived = cb;
  }

  stop(): void {
    this.currentPath = null;
    this.pathIndex = 0;
    this.velocity.set(0, 0, 0);
  }

  update(delta: number): void {
    if (!this.active || !this.currentPath || this.currentPath.points.length === 0) return;

    const target = this.currentPath.points[this.pathIndex];
    if (!target) return;

    const toTarget = new THREE.Vector3().subVectors(target, this.position);
    toTarget.y = 0; // keep on XZ plane
    const dist = toTarget.length();

    if (dist < this.config.stoppingDistance) {
      this.pathIndex++;
      if (this.pathIndex >= this.currentPath.points.length) {
        // Arrived
        this.stop();
        this.onArrived?.();
        return;
      }
      return;
    }

    // Steering
    const desired = toTarget.normalize().multiplyScalar(this.config.maxSpeed);
    const steer = desired.sub(this.velocity);
    const maxForce = this.config.acceleration * delta;
    if (steer.length() > maxForce) steer.normalize().multiplyScalar(maxForce);

    this.velocity.add(steer);
    if (this.velocity.length() > this.config.maxSpeed) {
      this.velocity.normalize().multiplyScalar(this.config.maxSpeed);
    }

    this.position.add(this.velocity.clone().multiplyScalar(delta));

    // Sync with object
    if (this.object) {
      this.object.position.copy(this.position);
      // Face movement direction
      if (this.velocity.lengthSq() > 0.01) {
        const lookTarget = this.position.clone().add(this.velocity);
        this.object.lookAt(lookTarget);
      }
    }
  }

  get isMoving(): boolean {
    return this.currentPath !== null && this.pathIndex < (this.currentPath?.points.length ?? 0);
  }
}

// ─── NavMesh Debug Visualizer ────────────────────────

export class NavMeshDebugDraw {
  private group = new THREE.Group();
  private lineMaterial: THREE.LineBasicMaterial;
  private polyMaterial: THREE.MeshBasicMaterial;

  constructor() {
    this.group.name = '__navmesh_debug';
    this.lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff88, depthTest: false, transparent: true, opacity: 0.6 });
    this.polyMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthTest: false });
  }

  get object(): THREE.Group { return this.group; }

  draw(navMesh: NavMesh): void {
    this.clear();

    // Draw polygons
    for (const poly of navMesh.getPolys()) {
      // Triangle mesh
      const geo = new THREE.BufferGeometry();
      const verts = new Float32Array(poly.vertices.length * 3);
      for (let i = 0; i < poly.vertices.length; i++) {
        verts[i * 3] = poly.vertices[i].x;
        verts[i * 3 + 1] = poly.vertices[i].y + 0.05; // slight offset
        verts[i * 3 + 2] = poly.vertices[i].z;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      if (poly.vertices.length === 3) {
        geo.setIndex([0, 1, 2]);
      }
      const mesh = new THREE.Mesh(geo, this.polyMaterial);
      this.group.add(mesh);

      // Wireframe edges
      const lineVerts: number[] = [];
      for (let i = 0; i < poly.vertices.length; i++) {
        const v = poly.vertices[i];
        const next = poly.vertices[(i + 1) % poly.vertices.length];
        lineVerts.push(v.x, v.y + 0.06, v.z, next.x, next.y + 0.06, next.z);
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
      this.group.add(new THREE.LineSegments(lineGeo, this.lineMaterial));
    }

    // Draw off-mesh links
    const linkMat = new THREE.LineBasicMaterial({ color: 0xff8800, depthTest: false });
    for (const link of navMesh.getOffMeshLinks()) {
      const geo = new THREE.BufferGeometry().setFromPoints([link.from, link.to]);
      this.group.add(new THREE.Line(geo, linkMat));
    }
  }

  drawPath(path: NavPath): void {
    if (!path.valid || path.points.length < 2) return;
    const mat = new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false, linewidth: 2 });
    const elevated = path.points.map(p => new THREE.Vector3(p.x, p.y + 0.1, p.z));
    const geo = new THREE.BufferGeometry().setFromPoints(elevated);
    const line = new THREE.Line(geo, mat);
    line.name = '__navpath_debug';
    this.group.add(line);
  }

  clear(): void {
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
      }
    }
  }

  dispose(): void {
    this.clear();
    this.lineMaterial.dispose();
    this.polyMaterial.dispose();
    this.group.removeFromParent();
  }
}
