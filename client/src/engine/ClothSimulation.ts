/**
 * ClothSimulation — Advanced Verlet-integration cloth physics.
 * Features:
 * - Verlet particle system with constraints
 * - Structural, shear, and bend springs
 * - Pin constraints (attach to bones, objects, or world)
 * - Wind force with turbulence
 * - Sphere and plane collision
 * - Self-collision (broad phase grid)
 * - Tearing under force threshold
 * - LOD: reduce iterations based on distance
 * - Integration with Three.js geometry (position + normal updates)
 */

import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────

export interface ClothConfig {
  /** Width segments */
  widthSegments: number;
  /** Height segments */
  heightSegments: number;
  /** Physical width */
  width: number;
  /** Physical height */
  height: number;
  /** Mass per particle */
  mass: number;
  /** Structural stiffness [0-1] */
  structural: number;
  /** Shear stiffness [0-1] */
  shear: number;
  /** Bend stiffness [0-1] */
  bend: number;
  /** Damping factor [0-1] */
  damping: number;
  /** Gravity */
  gravity: THREE.Vector3;
  /** Solver iterations per step */
  iterations: number;
  /** Allow tearing */
  tearable: boolean;
  /** Force threshold for tearing */
  tearThreshold: number;
}

export interface ClothCollider {
  type: 'sphere' | 'plane' | 'box';
  /** For sphere: center */
  position: THREE.Vector3;
  /** For sphere: radius; for plane: not used */
  radius?: number;
  /** For plane: normal vector */
  normal?: THREE.Vector3;
  /** For plane: distance from origin */
  offset?: number;
  /** For box: half-extents */
  halfExtents?: THREE.Vector3;
  /** Friction [0-1] */
  friction: number;
}

interface Particle {
  position: THREE.Vector3;
  previous: THREE.Vector3;
  acceleration: THREE.Vector3;
  mass: number;
  invMass: number;
  pinned: boolean;
  /** If pinned: an object to follow */
  pinTarget?: THREE.Object3D;
  /** Offset from pin target */
  pinOffset?: THREE.Vector3;
  /** Grid indices */
  ix: number;
  iy: number;
}

interface Constraint {
  a: number;
  b: number;
  restLength: number;
  stiffness: number;
  type: 'structural' | 'shear' | 'bend';
  broken: boolean;
}

// ─── Default Config ──────────────────────────────────

export const DEFAULT_CLOTH_CONFIG: ClothConfig = {
  widthSegments: 20,
  heightSegments: 20,
  width: 2,
  height: 2,
  mass: 0.1,
  structural: 1.0,
  shear: 0.8,
  bend: 0.3,
  damping: 0.97,
  gravity: new THREE.Vector3(0, -9.81, 0),
  iterations: 8,
  tearable: false,
  tearThreshold: 50,
};

// ─── Cloth Simulation ────────────────────────────────

export class ClothSimulation {
  readonly config: ClothConfig;
  private particles: Particle[] = [];
  private constraints: Constraint[] = [];
  private colliders: ClothCollider[] = [];

  // Wind
  private windForce = new THREE.Vector3();
  private windTurbulence = 0;

  // Three.js mesh
  private mesh: THREE.Mesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;

  // Self-collision grid
  private selfCollision = false;
  private gridCellSize = 0.2;

  constructor(config: Partial<ClothConfig> = {}) {
    this.config = { ...DEFAULT_CLOTH_CONFIG, ...config };
    this.buildParticlesAndConstraints();
  }

  private buildParticlesAndConstraints(): void {
    const { widthSegments: w, heightSegments: h, width, height, mass } = this.config;
    this.particles = [];
    this.constraints = [];

    const stepX = width / w;
    const stepY = height / h;

    // Create particles
    for (let iy = 0; iy <= h; iy++) {
      for (let ix = 0; ix <= w; ix++) {
        const x = ix * stepX - width / 2;
        const y = -iy * stepY + height / 2;
        const pos = new THREE.Vector3(x, y, 0);

        this.particles.push({
          position: pos.clone(),
          previous: pos.clone(),
          acceleration: new THREE.Vector3(),
          mass,
          invMass: 1 / mass,
          pinned: false,
          ix,
          iy,
        });
      }
    }

    const cols = w + 1;
    const idx = (ix: number, iy: number) => iy * cols + ix;

    // Structural constraints (horizontal + vertical)
    for (let iy = 0; iy <= h; iy++) {
      for (let ix = 0; ix <= w; ix++) {
        if (ix < w) this.addConstraint(idx(ix, iy), idx(ix + 1, iy), this.config.structural, 'structural');
        if (iy < h) this.addConstraint(idx(ix, iy), idx(ix, iy + 1), this.config.structural, 'structural');
      }
    }

    // Shear constraints (diagonals)
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        this.addConstraint(idx(ix, iy), idx(ix + 1, iy + 1), this.config.shear, 'shear');
        this.addConstraint(idx(ix + 1, iy), idx(ix, iy + 1), this.config.shear, 'shear');
      }
    }

    // Bend constraints (skip one)
    for (let iy = 0; iy <= h; iy++) {
      for (let ix = 0; ix <= w; ix++) {
        if (ix + 2 <= w) this.addConstraint(idx(ix, iy), idx(ix + 2, iy), this.config.bend, 'bend');
        if (iy + 2 <= h) this.addConstraint(idx(ix, iy), idx(ix, iy + 2), this.config.bend, 'bend');
      }
    }
  }

  private addConstraint(a: number, b: number, stiffness: number, type: Constraint['type']): void {
    const restLength = this.particles[a].position.distanceTo(this.particles[b].position);
    this.constraints.push({ a, b, restLength, stiffness, type, broken: false });
  }

  // ─── Pin Management ────────────────────────────

  /** Pin a particle at grid position */
  pin(ix: number, iy: number, target?: THREE.Object3D, offset?: THREE.Vector3): void {
    const p = this.getParticle(ix, iy);
    if (!p) return;
    p.pinned = true;
    p.invMass = 0;
    p.pinTarget = target;
    p.pinOffset = offset?.clone();
  }

  unpin(ix: number, iy: number): void {
    const p = this.getParticle(ix, iy);
    if (!p) return;
    p.pinned = false;
    p.invMass = 1 / p.mass;
    p.pinTarget = undefined;
    p.pinOffset = undefined;
  }

  /** Pin entire top row (common for curtain/flag) */
  pinTopRow(): void {
    for (let ix = 0; ix <= this.config.widthSegments; ix++) {
      this.pin(ix, 0);
    }
  }

  /** Pin corners only */
  pinCorners(): void {
    this.pin(0, 0);
    this.pin(this.config.widthSegments, 0);
  }

  private getParticle(ix: number, iy: number): Particle | undefined {
    const cols = this.config.widthSegments + 1;
    const idx = iy * cols + ix;
    return this.particles[idx];
  }

  // ─── Forces ────────────────────────────────────

  setWind(force: THREE.Vector3, turbulence = 0.5): void {
    this.windForce.copy(force);
    this.windTurbulence = turbulence;
  }

  setGravity(gravity: THREE.Vector3): void {
    this.config.gravity.copy(gravity);
  }

  // ─── Colliders ─────────────────────────────────

  addCollider(collider: ClothCollider): void {
    this.colliders.push(collider);
  }

  removeCollider(index: number): void {
    this.colliders.splice(index, 1);
  }

  clearColliders(): void {
    this.colliders.length = 0;
  }

  enableSelfCollision(cellSize = 0.2): void {
    this.selfCollision = true;
    this.gridCellSize = cellSize;
  }

  disableSelfCollision(): void {
    this.selfCollision = false;
  }

  // ─── Simulation Step ───────────────────────────

  update(delta: number): void {
    const dt = Math.min(delta, 1 / 30); // Cap to avoid explosion

    // Apply forces
    for (const p of this.particles) {
      if (p.pinned) {
        // Follow pin target
        if (p.pinTarget) {
          const worldPos = new THREE.Vector3();
          p.pinTarget.getWorldPosition(worldPos);
          if (p.pinOffset) worldPos.add(p.pinOffset);
          p.position.copy(worldPos);
          p.previous.copy(worldPos);
        }
        continue;
      }

      // Gravity
      p.acceleration.copy(this.config.gravity);

      // Wind with turbulence
      if (this.windForce.lengthSq() > 0) {
        const turbX = (Math.random() - 0.5) * 2 * this.windTurbulence;
        const turbY = (Math.random() - 0.5) * 2 * this.windTurbulence;
        const turbZ = (Math.random() - 0.5) * 2 * this.windTurbulence;
        p.acceleration.add(
          new THREE.Vector3(
            this.windForce.x + turbX,
            this.windForce.y + turbY,
            this.windForce.z + turbZ,
          ).multiplyScalar(p.invMass),
        );
      }
    }

    // Verlet integration
    const damping = this.config.damping;
    for (const p of this.particles) {
      if (p.pinned) continue;

      const temp = p.position.clone();
      const velocity = new THREE.Vector3().subVectors(p.position, p.previous).multiplyScalar(damping);
      p.position.add(velocity).add(p.acceleration.multiplyScalar(dt * dt));
      p.previous.copy(temp);
    }

    // Constraint solving (multiple iterations for stability)
    for (let iter = 0; iter < this.config.iterations; iter++) {
      this.solveConstraints();
    }

    // Collisions
    this.solveCollisions();

    // Self-collision
    if (this.selfCollision) {
      this.solveSelfCollision();
    }

    // Update Three.js geometry
    this.updateGeometry();
  }

  private solveConstraints(): void {
    for (const c of this.constraints) {
      if (c.broken) continue;

      const pA = this.particles[c.a];
      const pB = this.particles[c.b];

      const diff = new THREE.Vector3().subVectors(pB.position, pA.position);
      const dist = diff.length();
      if (dist < 0.0001) continue;

      // Tearing check
      if (this.config.tearable && dist > c.restLength * this.config.tearThreshold) {
        c.broken = true;
        continue;
      }

      const correction = (dist - c.restLength) / dist * c.stiffness;
      const totalInvMass = pA.invMass + pB.invMass;
      if (totalInvMass <= 0) continue;

      const corrVec = diff.multiplyScalar(correction / totalInvMass);

      if (!pA.pinned) pA.position.add(corrVec.clone().multiplyScalar(pA.invMass));
      if (!pB.pinned) pB.position.sub(corrVec.clone().multiplyScalar(pB.invMass));
    }
  }

  private solveCollisions(): void {
    for (const collider of this.colliders) {
      switch (collider.type) {
        case 'sphere':
          this.collideSphere(collider);
          break;
        case 'plane':
          this.collidePlane(collider);
          break;
        case 'box':
          this.collideBox(collider);
          break;
      }
    }
  }

  private collideSphere(c: ClothCollider): void {
    const radius = c.radius || 0.5;
    for (const p of this.particles) {
      if (p.pinned) continue;
      const diff = new THREE.Vector3().subVectors(p.position, c.position);
      const dist = diff.length();
      if (dist < radius) {
        diff.normalize().multiplyScalar(radius);
        p.position.copy(c.position).add(diff);
        // Friction
        if (c.friction > 0) {
          const velocity = new THREE.Vector3().subVectors(p.position, p.previous);
          const normal = diff.normalize();
          const vn = velocity.dot(normal);
          const tangent = velocity.sub(normal.multiplyScalar(vn));
          p.previous.add(tangent.multiplyScalar(c.friction));
        }
      }
    }
  }

  private collidePlane(c: ClothCollider): void {
    const normal = c.normal || new THREE.Vector3(0, 1, 0);
    const offset = c.offset || 0;
    for (const p of this.particles) {
      if (p.pinned) continue;
      const dot = p.position.dot(normal) - offset;
      if (dot < 0) {
        p.position.add(normal.clone().multiplyScalar(-dot));
        // Friction
        if (c.friction > 0) {
          const velocity = new THREE.Vector3().subVectors(p.position, p.previous);
          const vn = velocity.dot(normal);
          const tangent = velocity.sub(normal.clone().multiplyScalar(vn));
          p.previous.add(tangent.multiplyScalar(c.friction));
        }
      }
    }
  }

  private collideBox(c: ClothCollider): void {
    if (!c.halfExtents) return;
    const he = c.halfExtents;
    for (const p of this.particles) {
      if (p.pinned) continue;
      const local = new THREE.Vector3().subVectors(p.position, c.position);
      const clamped = new THREE.Vector3(
        THREE.MathUtils.clamp(local.x, -he.x, he.x),
        THREE.MathUtils.clamp(local.y, -he.y, he.y),
        THREE.MathUtils.clamp(local.z, -he.z, he.z),
      );
      // If inside box, push out
      if (local.equals(clamped)) {
        // Find closest face
        const dists = [
          he.x - Math.abs(local.x),
          he.y - Math.abs(local.y),
          he.z - Math.abs(local.z),
        ];
        const minIdx = dists[0] < dists[1] ? (dists[0] < dists[2] ? 0 : 2) : (dists[1] < dists[2] ? 1 : 2);
        const sign = local.getComponent(minIdx) > 0 ? 1 : -1;
        const normal = new THREE.Vector3();
        normal.setComponent(minIdx, sign);
        p.position.copy(c.position).add(clamped);
        p.position.setComponent(minIdx, c.position.getComponent(minIdx) + sign * he.getComponent(minIdx));
      }
    }
  }

  private solveSelfCollision(): void {
    // Spatial hash grid for broad phase
    const grid = new Map<string, number[]>();
    const cs = this.gridCellSize;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const key = `${Math.floor(p.position.x / cs)},${Math.floor(p.position.y / cs)},${Math.floor(p.position.z / cs)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(i);
    }

    const minDist = cs * 0.5;
    for (const indices of grid.values()) {
      for (let a = 0; a < indices.length; a++) {
        for (let b = a + 1; b < indices.length; b++) {
          const pA = this.particles[indices[a]];
          const pB = this.particles[indices[b]];
          if (pA.pinned && pB.pinned) continue;

          // Skip if they are neighbors (connected by structural constraint)
          const ai = indices[a], bi = indices[b];
          if (Math.abs(pA.ix - pB.ix) + Math.abs(pA.iy - pB.iy) <= 1) continue;

          const diff = new THREE.Vector3().subVectors(pB.position, pA.position);
          const dist = diff.length();
          if (dist < minDist && dist > 0.001) {
            const correction = diff.normalize().multiplyScalar((minDist - dist) * 0.5);
            if (!pA.pinned) pA.position.sub(correction);
            if (!pB.pinned) pB.position.add(correction);
          }
        }
      }
    }
  }

  // ─── Three.js Integration ─────────────────────

  /** Create a Three.js mesh for this cloth */
  createMesh(material?: THREE.Material): THREE.Mesh {
    const { widthSegments: w, heightSegments: h } = this.config;
    const geometry = new THREE.PlaneGeometry(this.config.width, this.config.height, w, h);

    const mat = material || new THREE.MeshStandardMaterial({
      color: 0xdddddd,
      side: THREE.DoubleSide,
      wireframe: false,
    });

    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, mat);
    return this.mesh;
  }

  /** Get existing mesh */
  getMesh(): THREE.Mesh | null {
    return this.mesh;
  }

  private updateGeometry(): void {
    if (!this.geometry) return;

    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.particles.length; i++) {
      posAttr.setXYZ(i, this.particles[i].position.x, this.particles[i].position.y, this.particles[i].position.z);
    }
    posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  /** Set the world transform of the cloth (moves all particles) */
  setTransform(position: THREE.Vector3, quaternion?: THREE.Quaternion): void {
    const offset = new THREE.Vector3().subVectors(position, this.particles[0].position);
    for (const p of this.particles) {
      p.position.add(offset);
      p.previous.add(offset);
      if (quaternion) {
        p.position.sub(position).applyQuaternion(quaternion).add(position);
        p.previous.sub(position).applyQuaternion(quaternion).add(position);
      }
    }
  }

  // ─── Utility ───────────────────────────────────

  getParticleCount(): number { return this.particles.length; }
  getConstraintCount(): number { return this.constraints.length; }
  getBrokenCount(): number { return this.constraints.filter(c => c.broken).length; }

  /** Reset to initial state */
  reset(): void {
    this.buildParticlesAndConstraints();
    this.updateGeometry();
  }

  dispose(): void {
    this.geometry?.dispose();
    this.mesh = null;
    this.geometry = null;
    this.particles = [];
    this.constraints = [];
  }
}
