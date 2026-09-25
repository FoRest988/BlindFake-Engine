// ─── Rapier 3D Physics Engine Wrapper ───────────────────────────────
// Professional physics with rigid bodies, colliders, joints, raycasts,
// character controllers, and debug visualization.

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type RigidBodyType = 'dynamic' | 'kinematic' | 'static';
export type ColliderShape = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'cone' | 'trimesh' | 'convexHull';

export interface RaycastHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  entityId: number;
}

export interface ContactEvent {
  entityA: number;
  entityB: number;
  started: boolean;
}

export interface BodyDescriptor {
  type: RigidBodyType;
  shape: ColliderShape;
  /** Interpreted per shape: box=(hx,hy,hz), sphere=(radius,_,_), capsule=(radius,halfHeight,_), cylinder/cone=(radius,halfHeight,_) */
  shapeSize: THREE.Vector3;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  mass?: number;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  gravityScale?: number;
  isSensor?: boolean;
  layer?: number;
  mask?: number;
  ccd?: boolean;
  lockRotation?: boolean;
}

export class RapierPhysicsEngine {
  private world!: RAPIER.World;
  private bodies = new Map<number, RAPIER.RigidBody>();
  private colliders = new Map<number, RAPIER.Collider>();
  private handleToEntity = new Map<number, number>();
  private eventQueue!: RAPIER.EventQueue;
  private initialized = false;
  private characterControllers = new Map<number, RAPIER.KinematicCharacterController>();

  public gravity = new THREE.Vector3(0, -20, 0);
  public onContact: ((event: ContactEvent) => void) | null = null;

  async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: this.gravity.x, y: this.gravity.y, z: this.gravity.z });
    this.eventQueue = new RAPIER.EventQueue(true);
    this.initialized = true;
  }

  get isReady(): boolean { return this.initialized; }

  setGravity(x: number, y: number, z: number): void {
    this.gravity.set(x, y, z);
    if (this.world) this.world.gravity = { x, y, z };
  }

  // ── Body Creation ──────────────────────────────────────────────────

  createBody(entityId: number, desc: BodyDescriptor): void {
    if (!this.initialized) return;
    this.removeBody(entityId);

    // Rigid body descriptor
    let bodyDesc: RAPIER.RigidBodyDesc;
    switch (desc.type) {
      case 'dynamic': bodyDesc = RAPIER.RigidBodyDesc.dynamic(); break;
      case 'kinematic': bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased(); break;
      default: bodyDesc = RAPIER.RigidBodyDesc.fixed(); break;
    }

    bodyDesc.setTranslation(desc.position.x, desc.position.y, desc.position.z);
    bodyDesc.setRotation({ x: desc.rotation.x, y: desc.rotation.y, z: desc.rotation.z, w: desc.rotation.w });
    if (desc.linearDamping != null) bodyDesc.setLinearDamping(desc.linearDamping);
    if (desc.angularDamping != null) bodyDesc.setAngularDamping(desc.angularDamping);
    if (desc.gravityScale != null) bodyDesc.setGravityScale(desc.gravityScale);
    if (desc.ccd) bodyDesc.setCcdEnabled(true);

    const body = this.world.createRigidBody(bodyDesc);
    if (desc.lockRotation) body.lockRotations(true, true);

    // Collider descriptor
    const s = desc.shapeSize;
    let colliderDesc: RAPIER.ColliderDesc;
    switch (desc.shape) {
      case 'sphere':   colliderDesc = RAPIER.ColliderDesc.ball(s.x); break;
      case 'capsule':  colliderDesc = RAPIER.ColliderDesc.capsule(s.y, s.x); break;
      case 'cylinder': colliderDesc = RAPIER.ColliderDesc.cylinder(s.y, s.x); break;
      case 'cone':     colliderDesc = RAPIER.ColliderDesc.cone(s.y, s.x); break;
      default:         colliderDesc = RAPIER.ColliderDesc.cuboid(s.x, s.y, s.z); break;
    }

    if (desc.friction != null) colliderDesc.setFriction(desc.friction);
    if (desc.restitution != null) colliderDesc.setRestitution(desc.restitution);
    if (desc.isSensor) colliderDesc.setSensor(true);
    if (desc.mass != null) colliderDesc.setMass(desc.mass);

    // Collision groups: high 16 bits = membership, low 16 bits = filter
    const layer = desc.layer ?? 0x0001;
    const mask = desc.mask ?? 0xFFFF;
    colliderDesc.setCollisionGroups((layer << 16) | mask);
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    const collider = this.world.createCollider(colliderDesc, body);

    this.bodies.set(entityId, body);
    this.colliders.set(entityId, collider);
    this.handleToEntity.set(collider.handle, entityId);
  }

  removeBody(entityId: number): void {
    const collider = this.colliders.get(entityId);
    if (collider) this.handleToEntity.delete(collider.handle);

    const body = this.bodies.get(entityId);
    if (body) {
      this.world.removeRigidBody(body);
      this.bodies.delete(entityId);
      this.colliders.delete(entityId);
    }

    const kcc = this.characterControllers.get(entityId);
    if (kcc) {
      this.world.removeCharacterController(kcc);
      this.characterControllers.delete(entityId);
    }
  }

  hasBody(entityId: number): boolean { return this.bodies.has(entityId); }

  // ── Transform Sync ─────────────────────────────────────────────────

  setBodyTransform(entityId: number, pos: THREE.Vector3, rot: THREE.Quaternion): void {
    const body = this.bodies.get(entityId);
    if (!body) return;

    if (body.isKinematic()) {
      body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
      body.setNextKinematicRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    } else {
      body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
      body.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
    }
  }

  getBodyPosition(entityId: number): THREE.Vector3 | null {
    const body = this.bodies.get(entityId);
    if (!body) return null;
    const p = body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  /** Write body position into `out` — no allocation. Returns false if body not found. */
  getBodyPositionInto(entityId: number, out: THREE.Vector3): boolean {
    const body = this.bodies.get(entityId);
    if (!body) return false;
    const p = body.translation();
    out.set(p.x, p.y, p.z);
    return true;
  }

  getBodyRotation(entityId: number): THREE.Quaternion | null {
    const body = this.bodies.get(entityId);
    if (!body) return null;
    const r = body.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  /** Write body rotation into `out` — no allocation. Returns false if body not found. */
  getBodyRotationInto(entityId: number, out: THREE.Quaternion): boolean {
    const body = this.bodies.get(entityId);
    if (!body) return false;
    const r = body.rotation();
    out.set(r.x, r.y, r.z, r.w);
    return true;
  }

  // ── Velocity ───────────────────────────────────────────────────────

  setLinearVelocity(entityId: number, vel: THREE.Vector3): void {
    const body = this.bodies.get(entityId);
    if (body) body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
  }

  getLinearVelocity(entityId: number): THREE.Vector3 {
    const body = this.bodies.get(entityId);
    if (!body) return new THREE.Vector3();
    const v = body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  /** Write linear velocity into `out` — no allocation. Returns false if body not found. */
  getLinearVelocityInto(entityId: number, out: THREE.Vector3): boolean {
    const body = this.bodies.get(entityId);
    if (!body) return false;
    const v = body.linvel();
    out.set(v.x, v.y, v.z);
    return true;
  }

  setAngularVelocity(entityId: number, vel: THREE.Vector3): void {
    const body = this.bodies.get(entityId);
    if (body) body.setAngvel({ x: vel.x, y: vel.y, z: vel.z }, true);
  }

  getAngularVelocity(entityId: number): THREE.Vector3 {
    const body = this.bodies.get(entityId);
    if (!body) return new THREE.Vector3();
    const v = body.angvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  // ── Forces & Impulses ──────────────────────────────────────────────

  applyForce(entityId: number, force: THREE.Vector3): void {
    const body = this.bodies.get(entityId);
    if (body) body.addForce({ x: force.x, y: force.y, z: force.z }, true);
  }

  applyImpulse(entityId: number, impulse: THREE.Vector3): void {
    const body = this.bodies.get(entityId);
    if (body) body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
  }

  applyTorque(entityId: number, torque: THREE.Vector3): void {
    const body = this.bodies.get(entityId);
    if (body) body.addTorque({ x: torque.x, y: torque.y, z: torque.z }, true);
  }

  applyTorqueImpulse(entityId: number, torque: THREE.Vector3): void {
    const body = this.bodies.get(entityId);
    if (body) body.applyTorqueImpulse({ x: torque.x, y: torque.y, z: torque.z }, true);
  }

  applyForceAtPoint(entityId: number, force: THREE.Vector3, point: THREE.Vector3): void {
    const body = this.bodies.get(entityId);
    if (body) body.addForceAtPoint({ x: force.x, y: force.y, z: force.z }, { x: point.x, y: point.y, z: point.z }, true);
  }

  // ── Character Controller ───────────────────────────────────────────

  createCharacterController(entityId: number, offset = 0.01): RAPIER.KinematicCharacterController {
    const existing = this.characterControllers.get(entityId);
    if (existing) return existing;

    const kcc = this.world.createCharacterController(offset);
    kcc.enableAutostep(0.5, 0.2, true);
    kcc.enableSnapToGround(0.5);
    kcc.setApplyImpulsesToDynamicBodies(true);
    this.characterControllers.set(entityId, kcc);
    return kcc;
  }

  moveCharacter(entityId: number, desiredMovement: THREE.Vector3): THREE.Vector3 {
    const kcc = this.characterControllers.get(entityId);
    const collider = this.colliders.get(entityId);
    if (!kcc || !collider) return desiredMovement.clone();

    kcc.computeColliderMovement(collider, { x: desiredMovement.x, y: desiredMovement.y, z: desiredMovement.z });
    const m = kcc.computedMovement();
    return new THREE.Vector3(m.x, m.y, m.z);
  }

  /** Write corrected movement into `out` — no allocation. Returns true if KCC found. */
  moveCharacterInto(entityId: number, desiredMovement: THREE.Vector3, out: THREE.Vector3): boolean {
    const kcc = this.characterControllers.get(entityId);
    const collider = this.colliders.get(entityId);
    if (!kcc || !collider) {
      out.copy(desiredMovement);
      return false;
    }
    kcc.computeColliderMovement(collider, { x: desiredMovement.x, y: desiredMovement.y, z: desiredMovement.z });
    const m = kcc.computedMovement();
    out.set(m.x, m.y, m.z);
    return true;
  }

  isCharacterGrounded(entityId: number): boolean {
    const kcc = this.characterControllers.get(entityId);
    if (!kcc) return false;
    return kcc.computedGrounded();
  }

  // ── Raycasting ─────────────────────────────────────────────────────

  raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDist: number, excludeEntity?: number): RaycastHit | null {
    if (!this.initialized) return null;

    // Normalize so that timeOfImpact correctly represents world-space distance
    const dir = direction.clone().normalize();
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z }
    );

    let excludeCollider: RAPIER.Collider | undefined;
    if (excludeEntity != null) excludeCollider = this.colliders.get(excludeEntity);

    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, excludeCollider);
    if (!hit) return null;

    const dist = hit.timeOfImpact;
    return {
      point: new THREE.Vector3(
        origin.x + dir.x * dist,
        origin.y + dir.y * dist,
        origin.z + dir.z * dist
      ),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance: dist,
      entityId: this.handleToEntity.get(hit.collider.handle) ?? -1,
    };
  }

  raycastAll(origin: THREE.Vector3, direction: THREE.Vector3, maxDist: number): RaycastHit[] {
    if (!this.initialized) return [];

    const results: RaycastHit[] = [];
    // Normalize so that timeOfImpact correctly represents world-space distance
    const dir = direction.clone().normalize();
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z }
    );

    this.world.intersectionsWithRay(ray, maxDist, true, (hit) => {
      const dist = hit.timeOfImpact;
      results.push({
        point: new THREE.Vector3(
          origin.x + dir.x * dist,
          origin.y + dir.y * dist,
          origin.z + dir.z * dist
        ),
        normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
        distance: dist,
        entityId: this.handleToEntity.get(hit.collider.handle) ?? -1,
      });
      return true;
    });

    return results;
  }

  // ── Shape Cast ─────────────────────────────────────────────────────

  shapeCast(shape: ColliderShape, size: THREE.Vector3, origin: THREE.Vector3, direction: THREE.Vector3, maxDist: number): RaycastHit | null {
    if (!this.initialized) return null;

    let s: RAPIER.Ball | RAPIER.Capsule | RAPIER.Cuboid;
    switch (shape) {
      case 'sphere':  s = new RAPIER.Ball(size.x); break;
      case 'capsule': s = new RAPIER.Capsule(size.y, size.x); break;
      default:        s = new RAPIER.Cuboid(size.x, size.y, size.z); break;
    }

    const hit = this.world.castShape(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: direction.x, y: direction.y, z: direction.z },
      s, 0.0, maxDist, true
    );

    if (!hit) return null;

    return {
      point: new THREE.Vector3(hit.witness1.x, hit.witness1.y, hit.witness1.z),
      normal: new THREE.Vector3(hit.normal1.x, hit.normal1.y, hit.normal1.z),
      distance: hit.time_of_impact,
      entityId: this.handleToEntity.get(hit.collider.handle) ?? -1,
    };
  }

  // ── Trimesh (Terrain / Static Geometry) ────────────────────────────

  addTrimeshBody(entityId: number, mesh: THREE.Mesh, layer = 0x0020, mask = 0xFFFF): void {
    if (!this.initialized) return;
    this.removeBody(entityId);

    const geo = mesh.geometry;
    if (!geo) return;

    const posAttr = geo.attributes.position;
    const vertices = new Float32Array(posAttr.count * 3);

    mesh.updateWorldMatrix(true, false);
    const mat = mesh.matrixWorld;
    const v = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(mat);
      vertices[i * 3] = v.x;
      vertices[i * 3 + 1] = v.y;
      vertices[i * 3 + 2] = v.z;
    }

    let indices: Uint32Array;
    if (geo.index) {
      indices = new Uint32Array(geo.index.count);
      for (let i = 0; i < geo.index.count; i++) indices[i] = geo.index.getX(i);
    } else {
      indices = new Uint32Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) indices[i] = i;
    }

    const bodyDesc = RAPIER.RigidBodyDesc.fixed();
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    if (!colliderDesc) return;

    colliderDesc.setCollisionGroups((layer << 16) | mask);
    colliderDesc.setFriction(0.7);
    const collider = this.world.createCollider(colliderDesc, body);

    this.bodies.set(entityId, body);
    this.colliders.set(entityId, collider);
    this.handleToEntity.set(collider.handle, entityId);
  }

  addConvexHullBody(entityId: number, mesh: THREE.Mesh, bodyType: RigidBodyType = 'static', layer = 0x0001, mask = 0xFFFF): void {
    if (!this.initialized) return;
    this.removeBody(entityId);

    const geo = mesh.geometry;
    if (!geo) return;

    const posAttr = geo.attributes.position;
    const points = new Float32Array(posAttr.count * 3);

    mesh.updateWorldMatrix(true, false);
    const mat = mesh.matrixWorld;
    const v = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(mat);
      points[i * 3] = v.x;
      points[i * 3 + 1] = v.y;
      points[i * 3 + 2] = v.z;
    }

    let bodyDesc: RAPIER.RigidBodyDesc;
    switch (bodyType) {
      case 'dynamic': bodyDesc = RAPIER.RigidBodyDesc.dynamic(); break;
      case 'kinematic': bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased(); break;
      default: bodyDesc = RAPIER.RigidBodyDesc.fixed(); break;
    }
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.convexHull(points);
    if (!colliderDesc) return;

    colliderDesc.setCollisionGroups((layer << 16) | mask);
    const collider = this.world.createCollider(colliderDesc, body);

    this.bodies.set(entityId, body);
    this.colliders.set(entityId, collider);
    this.handleToEntity.set(collider.handle, entityId);
  }

  // ── Joints ─────────────────────────────────────────────────────────

  createRevoluteJoint(entityA: number, entityB: number, anchorA: THREE.Vector3, anchorB: THREE.Vector3, axis: THREE.Vector3): RAPIER.ImpulseJoint | null {
    const bA = this.bodies.get(entityA), bB = this.bodies.get(entityB);
    if (!bA || !bB) return null;
    const desc = RAPIER.JointData.revolute(
      { x: anchorA.x, y: anchorA.y, z: anchorA.z },
      { x: anchorB.x, y: anchorB.y, z: anchorB.z },
      { x: axis.x, y: axis.y, z: axis.z }
    );
    return this.world.createImpulseJoint(desc, bA, bB, true);
  }

  createFixedJoint(entityA: number, entityB: number, anchorA: THREE.Vector3, anchorB: THREE.Vector3): RAPIER.ImpulseJoint | null {
    const bA = this.bodies.get(entityA), bB = this.bodies.get(entityB);
    if (!bA || !bB) return null;
    const desc = RAPIER.JointData.fixed(
      { x: anchorA.x, y: anchorA.y, z: anchorA.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: anchorB.x, y: anchorB.y, z: anchorB.z },
      { x: 0, y: 0, z: 0, w: 1 }
    );
    return this.world.createImpulseJoint(desc, bA, bB, true);
  }

  createSphericalJoint(entityA: number, entityB: number, anchorA: THREE.Vector3, anchorB: THREE.Vector3): RAPIER.ImpulseJoint | null {
    const bA = this.bodies.get(entityA), bB = this.bodies.get(entityB);
    if (!bA || !bB) return null;
    const desc = RAPIER.JointData.spherical(
      { x: anchorA.x, y: anchorA.y, z: anchorA.z },
      { x: anchorB.x, y: anchorB.y, z: anchorB.z }
    );
    return this.world.createImpulseJoint(desc, bA, bB, true);
  }

  createPrismaticJoint(entityA: number, entityB: number, anchorA: THREE.Vector3, anchorB: THREE.Vector3, axis: THREE.Vector3): RAPIER.ImpulseJoint | null {
    const bA = this.bodies.get(entityA), bB = this.bodies.get(entityB);
    if (!bA || !bB) return null;
    const desc = RAPIER.JointData.prismatic(
      { x: anchorA.x, y: anchorA.y, z: anchorA.z },
      { x: anchorB.x, y: anchorB.y, z: anchorB.z },
      { x: axis.x, y: axis.y, z: axis.z }
    );
    return this.world.createImpulseJoint(desc, bA, bB, true);
  }

  // ── Simulation Step ────────────────────────────────────────────────

  /** Advance the world by exactly `dt` seconds (the caller supplies a fixed step). */
  step(dt: number): void {
    if (!this.initialized) return;

    this.world.timestep = dt;
    this.world.step(this.eventQueue);

    // Drain collision events
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (this.onContact) {
        const eA = this.handleToEntity.get(h1) ?? -1;
        const eB = this.handleToEntity.get(h2) ?? -1;
        if (eA >= 0 && eB >= 0) {
          this.onContact({ entityA: eA, entityB: eB, started });
        }
      }
    });
  }

  // ── Debug Visualization ────────────────────────────────────────────

  getDebugRender(): { vertices: Float32Array; colors: Float32Array } | null {
    if (!this.initialized) return null;
    const buffers = this.world.debugRender();
    return { vertices: buffers.vertices, colors: buffers.colors };
  }

  // ── Cleanup ────────────────────────────────────────────────────────

  dispose(): void {
    for (const kcc of this.characterControllers.values()) {
      this.world.removeCharacterController(kcc);
    }
    this.characterControllers.clear();
    this.bodies.clear();
    this.colliders.clear();
    this.handleToEntity.clear();

    if (this.world) this.world.free();
    this.initialized = false;
  }

  get bodyCount(): number { return this.bodies.size; }
  get rapierWorld(): RAPIER.World | null { return this.world ?? null; }
}
