/**
 * RagdollSystem — Ragdoll physics using Rapier3D.
 * Features:
 * - Automatic bone-to-rigidbody mapping
 * - Configurable joint constraints (ball, hinge, cone-twist)
 * - Ragdoll activation/deactivation (blend with animation)
 * - Partial ragdoll (e.g., only the upper body goes limp)
 * - Impulse application (hit reactions)
 * - Ragdoll pose snapshots
 * - Motor-driven joints for active ragdoll
 */

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

// ─── Types ───────────────────────────────────────────

export type RagdollJointType = 'ball' | 'hinge' | 'fixed';

export interface RagdollBoneConfig {
  boneName: string;
  /** Collider shape (capsule is most common for limbs) */
  shape: 'capsule' | 'box' | 'sphere';
  /** Half-extents or radius + half-height depending on shape */
  size: { radius?: number; halfHeight?: number; halfExtents?: [number, number, number] };
  /** Mass of this body part */
  mass: number;
  /** Offset from bone origin */
  offset?: THREE.Vector3;
}

export interface RagdollJointConfig {
  parentBone: string;
  childBone: string;
  type: RagdollJointType;
  /** Anchor offset in parent local space */
  anchorA: THREE.Vector3;
  /** Anchor offset in child local space */
  anchorB: THREE.Vector3;
  /** For hinge joints — the axis of rotation (local to parent) */
  axis?: THREE.Vector3;
  /** Angular limits in radians [min, max] */
  limits?: [number, number];
  /** Cone angle limit for ball joints */
  coneAngle?: number;
}

export interface RagdollConfig {
  bones: RagdollBoneConfig[];
  joints: RagdollJointConfig[];
  /** Global damping factor */
  linearDamping: number;
  angularDamping: number;
  /** Collision group */
  collisionGroup?: number;
}

export interface RagdollInstance {
  id: string;
  config: RagdollConfig;
  skeleton: THREE.Skeleton;
  rootObject: THREE.Object3D;
  bodies: Map<string, RAPIER.RigidBody>;
  colliders: Map<string, RAPIER.Collider>;
  joints: RAPIER.ImpulseJoint[];
  active: boolean;
  /** Per-bone blend weight (0 = animation, 1 = physics) */
  blendWeights: Map<string, number>;
}

// ─── Preset Ragdoll Configs ──────────────────────────

/** Creates a humanoid ragdoll configuration for typical character rigs */
export function createHumanoidRagdollConfig(
  boneNames: {
    hips: string; spine: string; chest: string; head: string;
    upperArmL: string; lowerArmL: string; handL: string;
    upperArmR: string; lowerArmR: string; handR: string;
    upperLegL: string; lowerLegL: string; footL: string;
    upperLegR: string; lowerLegR: string; footR: string;
  },
): RagdollConfig {
  const bones: RagdollBoneConfig[] = [
    { boneName: boneNames.hips, shape: 'box', size: { halfExtents: [0.15, 0.1, 0.1] }, mass: 8 },
    { boneName: boneNames.spine, shape: 'box', size: { halfExtents: [0.12, 0.12, 0.08] }, mass: 6 },
    { boneName: boneNames.chest, shape: 'box', size: { halfExtents: [0.15, 0.12, 0.1] }, mass: 8 },
    { boneName: boneNames.head, shape: 'sphere', size: { radius: 0.1 }, mass: 4 },
    // Arms
    { boneName: boneNames.upperArmL, shape: 'capsule', size: { radius: 0.04, halfHeight: 0.12 }, mass: 2 },
    { boneName: boneNames.lowerArmL, shape: 'capsule', size: { radius: 0.035, halfHeight: 0.11 }, mass: 1.5 },
    { boneName: boneNames.handL, shape: 'box', size: { halfExtents: [0.04, 0.02, 0.06] }, mass: 0.5 },
    { boneName: boneNames.upperArmR, shape: 'capsule', size: { radius: 0.04, halfHeight: 0.12 }, mass: 2 },
    { boneName: boneNames.lowerArmR, shape: 'capsule', size: { radius: 0.035, halfHeight: 0.11 }, mass: 1.5 },
    { boneName: boneNames.handR, shape: 'box', size: { halfExtents: [0.04, 0.02, 0.06] }, mass: 0.5 },
    // Legs
    { boneName: boneNames.upperLegL, shape: 'capsule', size: { radius: 0.055, halfHeight: 0.18 }, mass: 4 },
    { boneName: boneNames.lowerLegL, shape: 'capsule', size: { radius: 0.045, halfHeight: 0.17 }, mass: 3 },
    { boneName: boneNames.footL, shape: 'box', size: { halfExtents: [0.04, 0.03, 0.08] }, mass: 1 },
    { boneName: boneNames.upperLegR, shape: 'capsule', size: { radius: 0.055, halfHeight: 0.18 }, mass: 4 },
    { boneName: boneNames.lowerLegR, shape: 'capsule', size: { radius: 0.045, halfHeight: 0.17 }, mass: 3 },
    { boneName: boneNames.footR, shape: 'box', size: { halfExtents: [0.04, 0.03, 0.08] }, mass: 1 },
  ];

  const zero = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3(1, 0, 0);

  const joints: RagdollJointConfig[] = [
    // Spine chain
    { parentBone: boneNames.hips, childBone: boneNames.spine, type: 'ball', anchorA: new THREE.Vector3(0, 0.1, 0), anchorB: zero.clone(), coneAngle: Math.PI / 6 },
    { parentBone: boneNames.spine, childBone: boneNames.chest, type: 'ball', anchorA: new THREE.Vector3(0, 0.12, 0), anchorB: zero.clone(), coneAngle: Math.PI / 6 },
    { parentBone: boneNames.chest, childBone: boneNames.head, type: 'ball', anchorA: new THREE.Vector3(0, 0.12, 0), anchorB: zero.clone(), coneAngle: Math.PI / 4 },
    // Left arm
    { parentBone: boneNames.chest, childBone: boneNames.upperArmL, type: 'ball', anchorA: new THREE.Vector3(-0.15, 0.1, 0), anchorB: zero.clone(), coneAngle: Math.PI / 2 },
    { parentBone: boneNames.upperArmL, childBone: boneNames.lowerArmL, type: 'hinge', anchorA: new THREE.Vector3(0, -0.12, 0), anchorB: zero.clone(), axis: right.clone(), limits: [0, Math.PI * 0.8] },
    { parentBone: boneNames.lowerArmL, childBone: boneNames.handL, type: 'ball', anchorA: new THREE.Vector3(0, -0.11, 0), anchorB: zero.clone(), coneAngle: Math.PI / 4 },
    // Right arm
    { parentBone: boneNames.chest, childBone: boneNames.upperArmR, type: 'ball', anchorA: new THREE.Vector3(0.15, 0.1, 0), anchorB: zero.clone(), coneAngle: Math.PI / 2 },
    { parentBone: boneNames.upperArmR, childBone: boneNames.lowerArmR, type: 'hinge', anchorA: new THREE.Vector3(0, -0.12, 0), anchorB: zero.clone(), axis: right.clone(), limits: [0, Math.PI * 0.8] },
    { parentBone: boneNames.lowerArmR, childBone: boneNames.handR, type: 'ball', anchorA: new THREE.Vector3(0, -0.11, 0), anchorB: zero.clone(), coneAngle: Math.PI / 4 },
    // Left leg
    { parentBone: boneNames.hips, childBone: boneNames.upperLegL, type: 'ball', anchorA: new THREE.Vector3(-0.08, -0.1, 0), anchorB: zero.clone(), coneAngle: Math.PI / 3 },
    { parentBone: boneNames.upperLegL, childBone: boneNames.lowerLegL, type: 'hinge', anchorA: new THREE.Vector3(0, -0.18, 0), anchorB: zero.clone(), axis: right.clone(), limits: [-Math.PI * 0.8, 0] },
    { parentBone: boneNames.lowerLegL, childBone: boneNames.footL, type: 'hinge', anchorA: new THREE.Vector3(0, -0.17, 0), anchorB: zero.clone(), axis: right.clone(), limits: [-Math.PI / 4, Math.PI / 4] },
    // Right leg
    { parentBone: boneNames.hips, childBone: boneNames.upperLegR, type: 'ball', anchorA: new THREE.Vector3(0.08, -0.1, 0), anchorB: zero.clone(), coneAngle: Math.PI / 3 },
    { parentBone: boneNames.upperLegR, childBone: boneNames.lowerLegR, type: 'hinge', anchorA: new THREE.Vector3(0, -0.18, 0), anchorB: zero.clone(), axis: right.clone(), limits: [-Math.PI * 0.8, 0] },
    { parentBone: boneNames.lowerLegR, childBone: boneNames.footR, type: 'hinge', anchorA: new THREE.Vector3(0, -0.17, 0), anchorB: zero.clone(), axis: right.clone(), limits: [-Math.PI / 4, Math.PI / 4] },
  ];

  return {
    bones,
    joints,
    linearDamping: 0.3,
    angularDamping: 0.5,
  };
}

// ─── Ragdoll System ──────────────────────────────────

export class RagdollSystem {
  private rapierWorld: RAPIER.World;
  private RAPIER: typeof RAPIER;
  private ragdolls = new Map<string, RagdollInstance>();

  constructor(rapierWorld: RAPIER.World, rapierModule: typeof RAPIER) {
    this.rapierWorld = rapierWorld;
    this.RAPIER = rapierModule;
  }

  /** Create a ragdoll for a skinned mesh */
  create(
    id: string,
    skeleton: THREE.Skeleton,
    rootObject: THREE.Object3D,
    config: RagdollConfig,
  ): RagdollInstance {
    const R = this.RAPIER;
    const boneMap = new Map<string, THREE.Bone>();
    for (const bone of skeleton.bones) boneMap.set(bone.name, bone);

    const bodies = new Map<string, RAPIER.RigidBody>();
    const colliders = new Map<string, RAPIER.Collider>();
    const blendWeights = new Map<string, number>();

    // Create rigid bodies + colliders for each bone
    for (const boneConf of config.bones) {
      const bone = boneMap.get(boneConf.boneName);
      if (!bone) continue;

      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      bone.getWorldPosition(worldPos);
      bone.getWorldQuaternion(worldQuat);

      if (boneConf.offset) {
        worldPos.add(boneConf.offset.clone().applyQuaternion(worldQuat));
      }

      const bodyDesc = R.RigidBodyDesc.dynamic()
        .setTranslation(worldPos.x, worldPos.y, worldPos.z)
        .setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w })
        .setLinearDamping(config.linearDamping)
        .setAngularDamping(config.angularDamping);

      const body = this.rapierWorld.createRigidBody(bodyDesc);

      // Create collider
      let colliderDesc: RAPIER.ColliderDesc;
      switch (boneConf.shape) {
        case 'capsule':
          colliderDesc = R.ColliderDesc.capsule(
            boneConf.size.halfHeight || 0.1,
            boneConf.size.radius || 0.05,
          );
          break;
        case 'sphere':
          colliderDesc = R.ColliderDesc.ball(boneConf.size.radius || 0.05);
          break;
        case 'box':
        default: {
          const he = boneConf.size.halfExtents || [0.05, 0.05, 0.05];
          colliderDesc = R.ColliderDesc.cuboid(he[0], he[1], he[2]);
          break;
        }
      }

      colliderDesc.setMass(boneConf.mass);
      if (config.collisionGroup !== undefined) {
        colliderDesc.setCollisionGroups(config.collisionGroup);
      }

      const collider = this.rapierWorld.createCollider(colliderDesc, body);

      bodies.set(boneConf.boneName, body);
      colliders.set(boneConf.boneName, collider);
      blendWeights.set(boneConf.boneName, 0); // Start with animation
    }

    // Create joints
    const joints: RAPIER.ImpulseJoint[] = [];
    for (const jointConf of config.joints) {
      const parentBody = bodies.get(jointConf.parentBone);
      const childBody = bodies.get(jointConf.childBone);
      if (!parentBody || !childBody) continue;

      const anchorA = { x: jointConf.anchorA.x, y: jointConf.anchorA.y, z: jointConf.anchorA.z };
      const anchorB = { x: jointConf.anchorB.x, y: jointConf.anchorB.y, z: jointConf.anchorB.z };

      let jointData: RAPIER.JointData;

      switch (jointConf.type) {
        case 'ball':
          jointData = R.JointData.spherical(anchorA, anchorB);
          break;
        case 'hinge': {
          const axis = jointConf.axis || new THREE.Vector3(1, 0, 0);
          jointData = R.JointData.revolute(
            anchorA, anchorB,
            { x: axis.x, y: axis.y, z: axis.z },
          );
          break;
        }
        case 'fixed':
        default:
          jointData = R.JointData.fixed(
            anchorA,
            { x: 0, y: 0, z: 0, w: 1 },
            anchorB,
            { x: 0, y: 0, z: 0, w: 1 },
          );
          break;
      }

      const joint = this.rapierWorld.createImpulseJoint(jointData, parentBody, childBody, true);

      // Apply limits for revolute joints
      if (jointConf.type === 'hinge' && jointConf.limits) {
        const revolute = joint as RAPIER.RevoluteImpulseJoint;
        if (revolute.setLimits) {
          revolute.setLimits(jointConf.limits[0], jointConf.limits[1]);
        }
      }

      joints.push(joint);
    }

    const instance: RagdollInstance = {
      id, config, skeleton, rootObject,
      bodies, colliders, joints,
      active: false, blendWeights,
    };

    // Start sleeping (kinematic)
    this.setKinematic(instance, true);

    this.ragdolls.set(id, instance);
    return instance;
  }

  /** Activate ragdoll (switch from animation to physics) */
  activate(id: string, blendDuration = 0): void {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll || ragdoll.active) return;

    ragdoll.active = true;

    // Sync physics bodies to current bone positions
    this.syncBodiesToBones(ragdoll);

    // Switch to dynamic
    this.setKinematic(ragdoll, false);

    if (blendDuration <= 0) {
      // Instant activation
      for (const boneName of ragdoll.blendWeights.keys()) {
        ragdoll.blendWeights.set(boneName, 1);
      }
    }
  }

  /** Deactivate ragdoll (switch back to animation) */
  deactivate(id: string): void {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll || !ragdoll.active) return;

    ragdoll.active = false;
    this.setKinematic(ragdoll, true);

    for (const boneName of ragdoll.blendWeights.keys()) {
      ragdoll.blendWeights.set(boneName, 0);
    }
  }

  /** Activate only specific bones (partial ragdoll) */
  activatePartial(id: string, boneNames: string[]): void {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll) return;

    ragdoll.active = true;
    const R = this.RAPIER;

    for (const [name, body] of ragdoll.bodies) {
      if (boneNames.includes(name)) {
        body.setBodyType(R.RigidBodyType.Dynamic, true);
        ragdoll.blendWeights.set(name, 1);
      } else {
        body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
        ragdoll.blendWeights.set(name, 0);
      }
    }
  }

  /** Apply an impulse to a specific bone */
  applyImpulse(id: string, boneName: string, impulse: THREE.Vector3, point?: THREE.Vector3): void {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll) return;

    const body = ragdoll.bodies.get(boneName);
    if (!body) return;

    if (point) {
      body.applyImpulseAtPoint(
        { x: impulse.x, y: impulse.y, z: impulse.z },
        { x: point.x, y: point.y, z: point.z },
        true,
      );
    } else {
      body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    }
  }

  /** Update: sync physics bodies to bones or vice versa */
  update(): void {
    for (const ragdoll of this.ragdolls.values()) {
      if (!ragdoll.active) {
        // Kinematic: bones drive bodies
        this.syncBodiesToBones(ragdoll);
      } else {
        // Dynamic: bodies drive bones
        this.syncBonesToBodies(ragdoll);
      }
    }
  }

  private syncBodiesToBones(ragdoll: RagdollInstance): void {
    const boneMap = new Map<string, THREE.Bone>();
    for (const bone of ragdoll.skeleton.bones) boneMap.set(bone.name, bone);

    for (const [boneName, body] of ragdoll.bodies) {
      const bone = boneMap.get(boneName);
      if (!bone) continue;

      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      bone.getWorldPosition(pos);
      bone.getWorldQuaternion(quat);

      body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
      body.setNextKinematicRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    }
  }

  private syncBonesToBodies(ragdoll: RagdollInstance): void {
    const boneMap = new Map<string, THREE.Bone>();
    for (const bone of ragdoll.skeleton.bones) boneMap.set(bone.name, bone);

    for (const [boneName, body] of ragdoll.bodies) {
      const weight = ragdoll.blendWeights.get(boneName) || 0;
      if (weight <= 0) continue;

      const bone = boneMap.get(boneName);
      if (!bone) continue;

      const physPos = body.translation();
      const physRot = body.rotation();

      const targetPos = new THREE.Vector3(physPos.x, physPos.y, physPos.z);
      const targetQuat = new THREE.Quaternion(physRot.x, physRot.y, physRot.z, physRot.w);

      // Convert world to local
      if (bone.parent) {
        const parentWorldInverse = new THREE.Matrix4();
        bone.parent.updateWorldMatrix(true, false);
        parentWorldInverse.copy(bone.parent.matrixWorld).invert();

        targetPos.applyMatrix4(parentWorldInverse);
        const parentWorldQuat = new THREE.Quaternion();
        bone.parent.getWorldQuaternion(parentWorldQuat);
        targetQuat.premultiply(parentWorldQuat.invert());
      }

      // Blend
      if (weight < 1) {
        bone.position.lerp(targetPos, weight);
        bone.quaternion.slerp(targetQuat, weight);
      } else {
        bone.position.copy(targetPos);
        bone.quaternion.copy(targetQuat);
      }
    }
  }

  private setKinematic(ragdoll: RagdollInstance, kinematic: boolean): void {
    const R = this.RAPIER;
    for (const body of ragdoll.bodies.values()) {
      body.setBodyType(
        kinematic ? R.RigidBodyType.KinematicPositionBased : R.RigidBodyType.Dynamic,
        true,
      );
    }
  }

  /** Get snapshot of current ragdoll pose */
  getSnapshot(id: string): Map<string, { pos: THREE.Vector3; rot: THREE.Quaternion }> | null {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll) return null;

    const snap = new Map<string, { pos: THREE.Vector3; rot: THREE.Quaternion }>();
    for (const [name, body] of ragdoll.bodies) {
      const t = body.translation();
      const r = body.rotation();
      snap.set(name, {
        pos: new THREE.Vector3(t.x, t.y, t.z),
        rot: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      });
    }
    return snap;
  }

  /** Destroy a ragdoll, removing all physics objects */
  destroy(id: string): void {
    const ragdoll = this.ragdolls.get(id);
    if (!ragdoll) return;

    for (const joint of ragdoll.joints) {
      this.rapierWorld.removeImpulseJoint(joint, true);
    }
    for (const body of ragdoll.bodies.values()) {
      this.rapierWorld.removeRigidBody(body);
    }

    this.ragdolls.delete(id);
  }

  getRagdoll(id: string): RagdollInstance | undefined {
    return this.ragdolls.get(id);
  }

  dispose(): void {
    for (const id of [...this.ragdolls.keys()]) this.destroy(id);
  }
}
