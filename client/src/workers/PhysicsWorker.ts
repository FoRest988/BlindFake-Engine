/**
 * PhysicsWorker — Rapier3D physics simulation running entirely off the main thread.
 *
 * Communication protocol (main → worker):
 *   init       → initialize Rapier with gravity
 *   addBody    → register a rigid body + collider
 *   removeBody → remove body and collider
 *   addTrimesh → register a static trimesh collider (terrain)
 *   createKCC  → create a kinematic character controller
 *   step       → advance simulation; includes kinematic syncs, velocity overrides, KCC moves
 *   setGravity → change world gravity
 *   reset      → destroy and clear the world
 *
 * Communication protocol (worker → main):
 *   ready      → Rapier initialized; safe to start sending commands
 *   stepResult → packed Float32Array transforms + KCC results (transferable)
 *
 * Transform buffer layout (Float32Array):
 *   [count, (entityId, px,py,pz, rx,ry,rz,rw, vx,vy,vz) × count]
 *   where count = number of dynamic bodies in this result.
 *
 * KCC result buffer layout (Float32Array):
 *   [count, (entityId, correctedX,correctedY,correctedZ, grounded:0|1) × count]
 */

import RAPIER from '@dimforge/rapier3d-compat';

// ─── Serialized types (must not use THREE.js — workers don't have DOM) ────────

export type ColliderShape =
  | 'box' | 'sphere' | 'capsule' | 'cylinder' | 'cone' | 'trimesh' | 'convexHull';

export interface SerializedBodyDesc {
  type: 'dynamic' | 'kinematic' | 'static';
  shape: ColliderShape;
  /** half-extents or shape params: box=(hx,hy,hz), sphere=(radius,_,_), capsule=(radius,halfH,_) */
  sx: number; sy: number; sz: number;
  px: number; py: number; pz: number;
  rx: number; ry: number; rz: number; rw: number;
  mass?: number;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  gravityScale?: number;
  isSensor?: boolean;
  ccd?: boolean;
  lockRotation?: boolean;
  layer?: number;
  mask?: number;
}

export interface KinematicUpdate {
  id: number;
  px: number; py: number; pz: number;
  rx: number; ry: number; rz: number; rw: number;
}

export interface VelocityUpdate {
  id: number;
  vx: number; vy: number; vz: number;
}

export interface KCCMove {
  id: number;
  dx: number; dy: number; dz: number;
}

export interface TeleportUpdate {
  id: number;
  px: number; py: number; pz: number;
  rx: number; ry: number; rz: number; rw: number;
}

export type PhysicsWorkerCommand =
  | { type: 'init'; gravity: { x: number; y: number; z: number } }
  | { type: 'addBody'; entityId: number; desc: SerializedBodyDesc }
  | { type: 'removeBody'; entityId: number }
  | { type: 'addTrimesh'; entityId: number; vertices: Float32Array; indices: Uint32Array }
  | { type: 'createKCC'; entityId: number; offset?: number }
  | { type: 'removeKCC'; entityId: number }
  | { type: 'step'; delta: number; kinematics: KinematicUpdate[]; velocities: VelocityUpdate[]; teleports: TeleportUpdate[]; kccMoves: KCCMove[] }
  | { type: 'setGravity'; x: number; y: number; z: number }
  | { type: 'reset' };

// ─── Buffer strides ────────────────────────────────────────────────────────────

/** Float32 values per dynamic body: entityId, px,py,pz, rx,ry,rz,rw, vx,vy,vz */
const TRANSFORM_STRIDE = 11;

/** Float32 values per KCC result: entityId, dx,dy,dz, grounded */
const KCC_STRIDE = 5;

// ─── Worker state ──────────────────────────────────────────────────────────────

let world: RAPIER.World | null = null;
let eventQueue: RAPIER.EventQueue | null = null;
let initialized = false;

const bodies        = new Map<number, RAPIER.RigidBody>();
const colliders     = new Map<number, RAPIER.Collider>();
const kccControllers = new Map<number, RAPIER.KinematicCharacterController>();
const handleToEntity = new Map<number, number>();

// ─── Initialization ────────────────────────────────────────────────────────────

async function initPhysics(gravity: { x: number; y: number; z: number }): Promise<void> {
  await RAPIER.init();
  world = new RAPIER.World(gravity);
  eventQueue = new RAPIER.EventQueue(true);
  initialized = true;
  self.postMessage({ type: 'ready' });
}

// ─── Body management ──────────────────────────────────────────────────────────

function addBody(entityId: number, desc: SerializedBodyDesc): void {
  if (!world) return;
  removeBody(entityId); // clean up if re-registering

  // Rigid body
  let bodyDesc: RAPIER.RigidBodyDesc;
  switch (desc.type) {
    case 'dynamic':   bodyDesc = RAPIER.RigidBodyDesc.dynamic(); break;
    case 'kinematic': bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased(); break;
    default:          bodyDesc = RAPIER.RigidBodyDesc.fixed(); break;
  }

  bodyDesc.setTranslation(desc.px, desc.py, desc.pz);
  bodyDesc.setRotation({ x: desc.rx, y: desc.ry, z: desc.rz, w: desc.rw });
  if (desc.linearDamping  != null) bodyDesc.setLinearDamping(desc.linearDamping);
  if (desc.angularDamping != null) bodyDesc.setAngularDamping(desc.angularDamping);
  if (desc.gravityScale   != null) bodyDesc.setGravityScale(desc.gravityScale);
  if (desc.ccd) bodyDesc.setCcdEnabled(true);

  const body = world.createRigidBody(bodyDesc);
  if (desc.lockRotation) body.lockRotations(true, true);

  // Collider
  let colliderDesc: RAPIER.ColliderDesc;
  switch (desc.shape) {
    case 'sphere':   colliderDesc = RAPIER.ColliderDesc.ball(desc.sx); break;
    case 'capsule':  colliderDesc = RAPIER.ColliderDesc.capsule(desc.sy, desc.sx); break;
    case 'cylinder': colliderDesc = RAPIER.ColliderDesc.cylinder(desc.sy, desc.sx); break;
    case 'cone':     colliderDesc = RAPIER.ColliderDesc.cone(desc.sy, desc.sx); break;
    default:         colliderDesc = RAPIER.ColliderDesc.cuboid(desc.sx, desc.sy, desc.sz); break;
  }

  if (desc.friction    != null) colliderDesc.setFriction(desc.friction);
  if (desc.restitution != null) colliderDesc.setRestitution(desc.restitution);
  if (desc.mass        != null) colliderDesc.setMass(desc.mass);
  if (desc.isSensor) colliderDesc.setSensor(true);

  const layer  = desc.layer  ?? 0x0001;
  const mask   = desc.mask   ?? 0xFFFF;
  colliderDesc.setCollisionGroups((layer << 16) | mask);
  colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

  const collider = world.createCollider(colliderDesc, body);
  bodies.set(entityId, body);
  colliders.set(entityId, collider);
  handleToEntity.set(collider.handle, entityId);
}

function addTrimesh(entityId: number, vertices: Float32Array, indices: Uint32Array): void {
  if (!world) return;
  removeBody(entityId);

  const body     = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const collDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
  if (!collDesc) return;

  collDesc.setFriction(0.7);
  const collider = world.createCollider(collDesc, body);
  bodies.set(entityId, body);
  colliders.set(entityId, collider);
  handleToEntity.set(collider.handle, entityId);
}

function removeBody(entityId: number): void {
  if (!world) return;

  const collider = colliders.get(entityId);
  if (collider) handleToEntity.delete(collider.handle);

  const body = bodies.get(entityId);
  if (body) {
    world.removeRigidBody(body);
    bodies.delete(entityId);
    colliders.delete(entityId);
  }

  const kcc = kccControllers.get(entityId);
  if (kcc) {
    world.removeCharacterController(kcc);
    kccControllers.delete(entityId);
  }
}

function createKCC(entityId: number, offset = 0.01): void {
  if (!world || kccControllers.has(entityId)) return;

  const kcc = world.createCharacterController(offset);
  kcc.enableAutostep(0.5, 0.2, true);
  kcc.enableSnapToGround(0.5);
  kcc.setApplyImpulsesToDynamicBodies(true);
  kccControllers.set(entityId, kcc);
}

function resetWorld(): void {
  bodies.clear();
  colliders.clear();
  kccControllers.clear();
  handleToEntity.clear();
  if (world) {
    world.free();
    world = null;
  }
  initialized = false;
}

// ─── Physics step ─────────────────────────────────────────────────────────────

function step(
  delta: number,
  kinematics: KinematicUpdate[],
  velocities: VelocityUpdate[],
  teleports: TeleportUpdate[],
  kccMoves: KCCMove[],
): void {
  if (!world || !eventQueue) return;

  // 1. Teleport dynamic bodies (game logic respawn etc.)
  for (const t of teleports) {
    const body = bodies.get(t.id);
    if (body) {
      body.setTranslation({ x: t.px, y: t.py, z: t.pz }, true);
      body.setRotation({ x: t.rx, y: t.ry, z: t.rz, w: t.rw }, true);
    }
  }

  // 2. Apply kinematic body next-frame positions
  for (const k of kinematics) {
    const body = bodies.get(k.id);
    if (body?.isKinematic()) {
      body.setNextKinematicTranslation({ x: k.px, y: k.py, z: k.pz });
      body.setNextKinematicRotation({ x: k.rx, y: k.ry, z: k.rz, w: k.rw });
    }
  }

  // 3. Apply velocity overrides for dynamic bodies
  for (const v of velocities) {
    bodies.get(v.id)?.setLinvel({ x: v.vx, y: v.vy, z: v.vz }, true);
  }

  // 4. Step the world
  world.timestep = Math.min(delta, 1 / 30);
  world.step(eventQueue);

  // 5. Drain collision events
  const contacts: Array<{ entityA: number; entityB: number; started: boolean }> = [];
  eventQueue.drainCollisionEvents((h1, h2, started) => {
    const a = handleToEntity.get(h1) ?? -1;
    const b = handleToEntity.get(h2) ?? -1;
    if (a !== -1 && b !== -1) contacts.push({ entityA: a, entityB: b, started });
  });

  // 6. Pack dynamic body transforms into transferable Float32Array
  const dynamicBodies: Array<{ id: number; body: RAPIER.RigidBody }> = [];
  for (const [id, body] of bodies) {
    if (body.isDynamic()) dynamicBodies.push({ id, body });
  }

  const transformBuf = new Float32Array(1 + dynamicBodies.length * TRANSFORM_STRIDE);
  transformBuf[0] = dynamicBodies.length;
  for (let i = 0; i < dynamicBodies.length; i++) {
    const { id, body } = dynamicBodies[i];
    const base = 1 + i * TRANSFORM_STRIDE;
    const p = body.translation();
    const r = body.rotation();
    const v = body.linvel();
    transformBuf[base + 0]  = id;
    transformBuf[base + 1]  = p.x;
    transformBuf[base + 2]  = p.y;
    transformBuf[base + 3]  = p.z;
    transformBuf[base + 4]  = r.x;
    transformBuf[base + 5]  = r.y;
    transformBuf[base + 6]  = r.z;
    transformBuf[base + 7]  = r.w;
    transformBuf[base + 8]  = v.x;
    transformBuf[base + 9]  = v.y;
    transformBuf[base + 10] = v.z;
  }

  // 7. Compute KCC corrected movements
  const kccBuf = new Float32Array(1 + kccMoves.length * KCC_STRIDE);
  kccBuf[0] = kccMoves.length;
  for (let i = 0; i < kccMoves.length; i++) {
    const move = kccMoves[i];
    const kcc  = kccControllers.get(move.id);
    const coll = colliders.get(move.id);
    const base = 1 + i * KCC_STRIDE;

    if (kcc && coll) {
      kcc.computeColliderMovement(coll, { x: move.dx, y: move.dy, z: move.dz });
      const m = kcc.computedMovement();
      kccBuf[base + 0] = move.id;
      kccBuf[base + 1] = m.x;
      kccBuf[base + 2] = m.y;
      kccBuf[base + 3] = m.z;
      kccBuf[base + 4] = kcc.computedGrounded() ? 1 : 0;
    } else {
      // Pass-through if no controller found
      kccBuf[base + 0] = move.id;
      kccBuf[base + 1] = move.dx;
      kccBuf[base + 2] = move.dy;
      kccBuf[base + 3] = move.dz;
      kccBuf[base + 4] = 0;
    }
  }

  // 8. Transfer buffers (zero-copy via structured clone transfer)
  self.postMessage(
    { type: 'stepResult', delta, transforms: transformBuf.buffer, kccResults: kccBuf.buffer, contacts },
    { transfer: [transformBuf.buffer, kccBuf.buffer] },
  );
}

// ─── Message router ───────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<PhysicsWorkerCommand>) => {
  const cmd = event.data;
  switch (cmd.type) {
    case 'init':
      initPhysics(cmd.gravity);
      break;
    case 'addBody':
      addBody(cmd.entityId, cmd.desc);
      break;
    case 'removeBody':
      removeBody(cmd.entityId);
      break;
    case 'addTrimesh':
      addTrimesh(cmd.entityId, cmd.vertices, cmd.indices);
      break;
    case 'createKCC':
      createKCC(cmd.entityId, cmd.offset);
      break;
    case 'removeKCC': {
      const kcc = kccControllers.get(cmd.entityId);
      if (kcc && world) world.removeCharacterController(kcc);
      kccControllers.delete(cmd.entityId);
      break;
    }
    case 'step':
      if (initialized) {
        step(cmd.delta, cmd.kinematics, cmd.velocities, cmd.teleports, cmd.kccMoves);
      }
      break;
    case 'setGravity':
      if (world) world.gravity = { x: cmd.x, y: cmd.y, z: cmd.z };
      break;
    case 'reset':
      resetWorld();
      break;
  }
};
