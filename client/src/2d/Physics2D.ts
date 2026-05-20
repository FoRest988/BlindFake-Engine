/**
 * Physics2D — Simple 2D physics engine with AABB collision detection.
 * Features:
 * - Rigid body simulation (static, dynamic, kinematic)
 * - AABB collision detection + resolution
 * - Gravity, friction, restitution
 * - Trigger zones (non-physical overlap detection)
 * - Raycasting (2D)
 * - Collision layers and masks
 * - 2D particle emitter
 */

import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────

export type BodyType = 'static' | 'dynamic' | 'kinematic';

export interface AABB {
  minX: number; minY: number;
  maxX: number; maxY: number;
}

export interface RigidBody2D {
  id: number;
  type: BodyType;
  x: number; y: number;
  width: number; height: number;
  vx: number; vy: number;
  mass: number;
  restitution: number;   // bounciness 0-1
  friction: number;       // 0-1
  gravityScale: number;
  isTrigger: boolean;
  layer: number;         // collision layer (bitmask)
  mask: number;          // which layers to collide with (bitmask)
  /** Attached user data (e.g., the Sprite2D or entity) */
  userData?: unknown;
  /** Whether body is grounded (touching something below) */
  grounded: boolean;
}

export interface CollisionEvent {
  bodyA: RigidBody2D;
  bodyB: RigidBody2D;
  overlapX: number;
  overlapY: number;
  normalX: number;
  normalY: number;
}

export interface RaycastHit2D {
  body: RigidBody2D;
  hitX: number;
  hitY: number;
  distance: number;
  normalX: number;
  normalY: number;
}

// ─── Physics2D World ─────────────────────────────────

export class Physics2D {
  private bodies: RigidBody2D[] = [];
  private nextId = 1;
  private gravity = { x: 0, y: -500 };

  private onCollisionCallbacks: Array<(event: CollisionEvent) => void> = [];
  private onTriggerCallbacks: Array<(event: CollisionEvent) => void> = [];

  // Spatial hash grid for broad-phase
  private gridCellSize = 128;
  private grid = new Map<number, RigidBody2D[]>();

  setGravity(x: number, y: number): void {
    this.gravity.x = x;
    this.gravity.y = y;
  }

  createBody(config: Partial<RigidBody2D> & { x: number; y: number; width: number; height: number }): RigidBody2D {
    const body: RigidBody2D = {
      id: this.nextId++,
      type: config.type ?? 'dynamic',
      x: config.x, y: config.y,
      width: config.width, height: config.height,
      vx: config.vx ?? 0, vy: config.vy ?? 0,
      mass: config.mass ?? 1,
      restitution: config.restitution ?? 0.2,
      friction: config.friction ?? 0.1,
      gravityScale: config.gravityScale ?? 1,
      isTrigger: config.isTrigger ?? false,
      layer: config.layer ?? 1,
      mask: config.mask ?? 0xFFFF,
      userData: config.userData,
      grounded: false,
    };
    this.bodies.push(body);
    return body;
  }

  removeBody(id: number): void {
    const idx = this.bodies.findIndex(b => b.id === id);
    if (idx !== -1) this.bodies.splice(idx, 1);
  }

  getBody(id: number): RigidBody2D | undefined {
    return this.bodies.find(b => b.id === id);
  }

  onCollision(cb: (event: CollisionEvent) => void): void {
    this.onCollisionCallbacks.push(cb);
  }

  onTrigger(cb: (event: CollisionEvent) => void): void {
    this.onTriggerCallbacks.push(cb);
  }

  update(delta: number): void {
    const dt = Math.min(delta, 1 / 30); // cap to prevent tunneling

    // Integrate velocities
    for (const body of this.bodies) {
      if (body.type !== 'dynamic') continue;

      body.vx += this.gravity.x * body.gravityScale * dt;
      body.vy += this.gravity.y * body.gravityScale * dt;

      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.grounded = false;
    }

    // Spatial hash broad-phase + narrow-phase collision detection
    this.grid.clear();
    const cs = this.gridCellSize;
    for (const body of this.bodies) {
      const minCX = Math.floor((body.x - body.width / 2) / cs);
      const maxCX = Math.floor((body.x + body.width / 2) / cs);
      const minCY = Math.floor((body.y - body.height / 2) / cs);
      const maxCY = Math.floor((body.y + body.height / 2) / cs);
      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cy = minCY; cy <= maxCY; cy++) {
          const key = cx * 73856093 ^ cy * 19349663;
          let cell = this.grid.get(key);
          if (!cell) { cell = []; this.grid.set(key, cell); }
          cell.push(body);
        }
      }
    }

    const checked = new Set<number>();
    for (const cell of this.grid.values()) {
      for (let i = 0; i < cell.length; i++) {
        for (let j = i + 1; j < cell.length; j++) {
          const a = cell[i];
          const b = cell[j];

          // Deduplicate pairs across cells
          const pairKey = a.id < b.id ? a.id * 100000 + b.id : b.id * 100000 + a.id;
          if (checked.has(pairKey)) continue;
          checked.add(pairKey);

          // Skip static-static
          if (a.type === 'static' && b.type === 'static') continue;

          // Check layer masks
          if (!(a.layer & b.mask) || !(b.layer & a.mask)) continue;

          const collision = this.testAABB(a, b);
          if (!collision) continue;

          // Trigger zones — notify but don't resolve
          if (a.isTrigger || b.isTrigger) {
            for (const cb of this.onTriggerCallbacks) cb(collision);
            continue;
          }

          // Resolve collision
          this.resolveCollision(collision);
          for (const cb of this.onCollisionCallbacks) cb(collision);
        }
      }
    }
  }

  private testAABB(a: RigidBody2D, b: RigidBody2D): CollisionEvent | null {
    const aMinX = a.x - a.width / 2;
    const aMaxX = a.x + a.width / 2;
    const aMinY = a.y - a.height / 2;
    const aMaxY = a.y + a.height / 2;

    const bMinX = b.x - b.width / 2;
    const bMaxX = b.x + b.width / 2;
    const bMinY = b.y - b.height / 2;
    const bMaxY = b.y + b.height / 2;

    const overlapX = Math.min(aMaxX, bMaxX) - Math.max(aMinX, bMinX);
    const overlapY = Math.min(aMaxY, bMaxY) - Math.max(aMinY, bMinY);

    if (overlapX <= 0 || overlapY <= 0) return null;

    // Minimum penetration axis
    let normalX = 0, normalY = 0;
    if (overlapX < overlapY) {
      normalX = a.x < b.x ? -1 : 1;
    } else {
      normalY = a.y < b.y ? -1 : 1;
    }

    return { bodyA: a, bodyB: b, overlapX, overlapY, normalX, normalY };
  }

  private resolveCollision(event: CollisionEvent): void {
    const { bodyA, bodyB, overlapX, overlapY, normalX, normalY } = event;

    // Separation
    const sep = normalX !== 0 ? overlapX : overlapY;
    const invMassA = bodyA.type === 'dynamic' ? 1 / bodyA.mass : 0;
    const invMassB = bodyB.type === 'dynamic' ? 1 / bodyB.mass : 0;
    const totalInvMass = invMassA + invMassB;

    if (totalInvMass === 0) return;

    // Position correction
    bodyA.x += normalX * sep * (invMassA / totalInvMass);
    bodyA.y += normalY * sep * (invMassA / totalInvMass);
    bodyB.x -= normalX * sep * (invMassB / totalInvMass);
    bodyB.y -= normalY * sep * (invMassB / totalInvMass);

    // Velocity resolution
    const relVx = bodyA.vx - bodyB.vx;
    const relVy = bodyA.vy - bodyB.vy;
    const velAlongNormal = relVx * normalX + relVy * normalY;

    // Don't resolve if separating
    if (velAlongNormal > 0) return;

    const restitution = Math.min(bodyA.restitution, bodyB.restitution);
    const j = -(1 + restitution) * velAlongNormal / totalInvMass;

    bodyA.vx += j * invMassA * normalX;
    bodyA.vy += j * invMassA * normalY;
    bodyB.vx -= j * invMassB * normalX;
    bodyB.vy -= j * invMassB * normalY;

    // Friction
    const tangentX = relVx - velAlongNormal * normalX;
    const tangentY = relVy - velAlongNormal * normalY;
    const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY);

    if (tangentLen > 0.001) {
      const friction = Math.sqrt(bodyA.friction * bodyB.friction);
      const frictionImpulse = Math.min(friction * Math.abs(j), tangentLen);
      const fnx = tangentX / tangentLen;
      const fny = tangentY / tangentLen;

      bodyA.vx -= frictionImpulse * invMassA * fnx;
      bodyA.vy -= frictionImpulse * invMassA * fny;
      bodyB.vx += frictionImpulse * invMassB * fnx;
      bodyB.vy += frictionImpulse * invMassB * fny;
    }

    // Ground detection
    if (normalY > 0.5 && bodyA.type === 'dynamic') bodyA.grounded = true;
    if (normalY < -0.5 && bodyB.type === 'dynamic') bodyB.grounded = true;
  }

  // ─── Raycasting ────────────────────────────────

  raycast(originX: number, originY: number, dirX: number, dirY: number, maxDist = 1000, layerMask = 0xFFFF): RaycastHit2D | null {
    let closest: RaycastHit2D | null = null;
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len === 0) return null;
    const ndx = dirX / len;
    const ndy = dirY / len;

    for (const body of this.bodies) {
      if (!(body.layer & layerMask)) continue;

      const hit = this.raycastAABB(originX, originY, ndx, ndy, maxDist, body);
      if (hit && (!closest || hit.distance < closest.distance)) {
        closest = hit;
      }
    }

    return closest;
  }

  private raycastAABB(ox: number, oy: number, dx: number, dy: number, maxDist: number, body: RigidBody2D): RaycastHit2D | null {
    const minX = body.x - body.width / 2;
    const maxX = body.x + body.width / 2;
    const minY = body.y - body.height / 2;
    const maxY = body.y + body.height / 2;

    let tmin = -Infinity, tmax = Infinity;
    let nx = 0, ny = 0;

    if (dx !== 0) {
      const t1 = (minX - ox) / dx;
      const t2 = (maxX - ox) / dx;
      const tNear = Math.min(t1, t2);
      const tFar = Math.max(t1, t2);
      if (tNear > tmin) { tmin = tNear; nx = dx > 0 ? -1 : 1; ny = 0; }
      tmax = Math.min(tmax, tFar);
    } else if (ox < minX || ox > maxX) return null;

    if (dy !== 0) {
      const t1 = (minY - oy) / dy;
      const t2 = (maxY - oy) / dy;
      const tNear = Math.min(t1, t2);
      const tFar = Math.max(t1, t2);
      if (tNear > tmin) { tmin = tNear; nx = 0; ny = dy > 0 ? -1 : 1; }
      tmax = Math.min(tmax, tFar);
    } else if (oy < minY || oy > maxY) return null;

    if (tmin > tmax || tmin < 0 || tmin > maxDist) return null;

    return {
      body,
      hitX: ox + dx * tmin,
      hitY: oy + dy * tmin,
      distance: tmin,
      normalX: nx,
      normalY: ny,
    };
  }

  // ─── Queries ───────────────────────────────────

  queryAABB(aabb: AABB, layerMask = 0xFFFF): RigidBody2D[] {
    return this.bodies.filter(b => {
      if (!(b.layer & layerMask)) return false;
      return !(b.x + b.width / 2 < aabb.minX || b.x - b.width / 2 > aabb.maxX ||
               b.y + b.height / 2 < aabb.minY || b.y - b.height / 2 > aabb.maxY);
    });
  }

  queryRadius(cx: number, cy: number, radius: number, layerMask = 0xFFFF): RigidBody2D[] {
    const r2 = radius * radius;
    return this.bodies.filter(b => {
      if (!(b.layer & layerMask)) return false;
      const dx = b.x - cx;
      const dy = b.y - cy;
      return dx * dx + dy * dy <= r2;
    });
  }

  getAllBodies(): ReadonlyArray<RigidBody2D> { return this.bodies; }

  dispose(): void {
    this.bodies = [];
    this.onCollisionCallbacks = [];
    this.onTriggerCallbacks = [];
  }
}

// ─── 2D Particle Emitter ─────────────────────────────

export interface Particle2DConfig {
  x: number; y: number;
  maxParticles: number;
  emitRate: number;        // particles per second
  lifetime: number;        // seconds
  speed: number;
  speedVariance: number;
  angle: number;           // emission direction in radians
  angleVariance: number;
  size: number;
  sizeVariance: number;
  sizeEnd?: number;
  color: number;           // hex
  colorEnd?: number;
  opacity: number;
  opacityEnd?: number;
  gravity: { x: number; y: number };
}

interface Particle2D {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number; sizeStart: number; sizeEnd: number;
  color: number; colorEnd: number;
  opacity: number; opacityEnd: number;
}

export class ParticleEmitter2D {
  private config: Particle2DConfig;
  private particles: Particle2D[] = [];
  private emitAccum = 0;
  private group: THREE.Group;
  private meshes: THREE.Mesh[] = [];
  private material: THREE.MeshBasicMaterial;

  active = true;

  constructor(config: Particle2DConfig) {
    this.config = config;
    this.group = new THREE.Group();
    this.group.position.set(config.x, config.y, 0);
    this.material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false });
  }

  get object(): THREE.Group { return this.group; }

  update(delta: number): void {
    // Emit new particles
    if (this.active) {
      this.emitAccum += this.config.emitRate * delta;
      while (this.emitAccum >= 1 && this.particles.length < this.config.maxParticles) {
        this.emitAccum--;
        this.emit();
      }
    }

    // Update existing
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= delta;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        if (this.meshes[i]) {
          this.group.remove(this.meshes[i]);
          this.meshes[i].geometry.dispose();
          this.meshes.splice(i, 1);
        }
        continue;
      }

      // Physics
      p.vx += this.config.gravity.x * delta;
      p.vy += this.config.gravity.y * delta;
      p.x += p.vx * delta;
      p.y += p.vy * delta;

      // Interpolation
      const t = 1 - p.life / p.maxLife;
      const size = p.sizeStart + (p.sizeEnd - p.sizeStart) * t;
      const opacity = p.opacity + (p.opacityEnd - p.opacity) * t;

      // Update mesh
      if (this.meshes[i]) {
        this.meshes[i].position.set(p.x, p.y, 0);
        this.meshes[i].scale.setScalar(size);
        (this.meshes[i].material as THREE.MeshBasicMaterial).opacity = opacity;
      }
    }
  }

  private emit(): void {
    const cfg = this.config;
    const angle = cfg.angle + (Math.random() - 0.5) * cfg.angleVariance;
    const speed = cfg.speed + (Math.random() - 0.5) * cfg.speedVariance;
    const size = cfg.size + (Math.random() - 0.5) * cfg.sizeVariance;

    const p: Particle2D = {
      x: 0, y: 0,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: cfg.lifetime, maxLife: cfg.lifetime,
      size, sizeStart: size, sizeEnd: cfg.sizeEnd ?? 0,
      color: cfg.color, colorEnd: cfg.colorEnd ?? cfg.color,
      opacity: cfg.opacity, opacityEnd: cfg.opacityEnd ?? 0,
    };

    this.particles.push(p);

    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = this.material.clone();
    mat.color.setHex(cfg.color);
    mat.opacity = cfg.opacity;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0, 0);
    mesh.scale.setScalar(size);
    this.group.add(mesh);
    this.meshes.push(mesh);
  }

  setPosition(x: number, y: number): void {
    this.group.position.set(x, y, 0);
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.group.removeFromParent();
    this.particles = [];
    this.meshes = [];
  }
}
