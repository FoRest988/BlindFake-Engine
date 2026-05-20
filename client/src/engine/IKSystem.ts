/**
 * IKSystem — Inverse Kinematics for skeletal animation.
 * Features:
 * - FABRIK (Forward And Backward Reaching IK) solver
 * - CCD (Cyclic Coordinate Descent) solver
 * - Two-bone IK (optimized for arms/legs)
 * - Look-at constraint (head tracking)
 * - Foot placement (ground alignment)
 * - Pole targets for elbow/knee direction
 * - Bone constraints (min/max angles)
 * - Multiple IK chains per skeleton
 */

import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────

export type IKSolverType = 'fabrik' | 'ccd' | 'twoBone';

export interface BoneConstraint {
  /** Min rotation in radians per axis */
  min: THREE.Euler;
  /** Max rotation in radians per axis */
  max: THREE.Euler;
}

export interface IKChainConfig {
  id: string;
  /** Solver algorithm */
  solver: IKSolverType;
  /** Bone names from root to tip */
  boneNames: string[];
  /** Target position in world space */
  target: THREE.Vector3;
  /** Pole target for bend direction (e.g., knee/elbow) */
  poleTarget?: THREE.Vector3;
  /** Solver iterations */
  iterations: number;
  /** Tolerance (stop if close enough) */
  tolerance: number;
  /** Blend weight (0 = full FK, 1 = full IK) */
  weight: number;
  /** Per-bone constraints */
  constraints?: Map<string, BoneConstraint>;
}

export interface FootIKConfig {
  /** Left foot bone name */
  leftFootBone: string;
  /** Right foot bone name */
  rightFootBone: string;
  /** Hip bone name (for height adjustment) */
  hipBone: string;
  /** Max ray distance for ground check */
  rayLength: number;
  /** Offset above ground */
  footOffset: number;
  /** Blend speed for smooth transitions */
  blendSpeed: number;
  /** Layers to raycast against */
  raycastLayers?: THREE.Object3D[];
}

// ─── IK Solvers ──────────────────────────────────────

/**
 * FABRIK — Forward And Backward Reaching Inverse Kinematics
 * Works well for chains of any length. Natural-looking results.
 */
function solveFABRIK(
  positions: THREE.Vector3[],
  lengths: number[],
  target: THREE.Vector3,
  iterations: number,
  tolerance: number,
): void {
  const n = positions.length;
  if (n < 2) return;

  const rootPos = positions[0].clone();

  for (let iter = 0; iter < iterations; iter++) {
    // Check if close enough
    if (positions[n - 1].distanceTo(target) < tolerance) break;

    // Forward reaching: start from end effector
    positions[n - 1].copy(target);
    for (let i = n - 2; i >= 0; i--) {
      const dir = new THREE.Vector3().subVectors(positions[i], positions[i + 1]).normalize();
      positions[i].copy(positions[i + 1]).add(dir.multiplyScalar(lengths[i]));
    }

    // Backward reaching: start from root
    positions[0].copy(rootPos);
    for (let i = 0; i < n - 1; i++) {
      const dir = new THREE.Vector3().subVectors(positions[i + 1], positions[i]).normalize();
      positions[i + 1].copy(positions[i]).add(dir.multiplyScalar(lengths[i]));
    }
  }
}

/**
 * CCD — Cyclic Coordinate Descent
 * Simple iterative solver. Works well for constrained chains.
 */
function solveCCD(
  bones: THREE.Bone[],
  target: THREE.Vector3,
  iterations: number,
  tolerance: number,
  constraints?: Map<string, BoneConstraint>,
): void {
  if (bones.length < 2) return;

  const endEffector = bones[bones.length - 1];

  for (let iter = 0; iter < iterations; iter++) {
    const tipPos = new THREE.Vector3();
    endEffector.getWorldPosition(tipPos);
    if (tipPos.distanceTo(target) < tolerance) break;

    // Iterate from tip to root
    for (let i = bones.length - 2; i >= 0; i--) {
      const bone = bones[i];
      const bonePos = new THREE.Vector3();
      bone.getWorldPosition(bonePos);

      endEffector.getWorldPosition(tipPos);

      const toTip = new THREE.Vector3().subVectors(tipPos, bonePos).normalize();
      const toTarget = new THREE.Vector3().subVectors(target, bonePos).normalize();

      const quat = new THREE.Quaternion().setFromUnitVectors(toTip, toTarget);

      // Apply rotation in bone's local space
      const worldQuat = new THREE.Quaternion();
      bone.getWorldQuaternion(worldQuat);
      const localQuat = worldQuat.clone().invert().multiply(quat).multiply(worldQuat);
      bone.quaternion.multiply(localQuat);

      // Apply constraints
      if (constraints?.has(bone.name)) {
        const c = constraints.get(bone.name)!;
        const euler = new THREE.Euler().setFromQuaternion(bone.quaternion);
        euler.x = THREE.MathUtils.clamp(euler.x, c.min.x, c.max.x);
        euler.y = THREE.MathUtils.clamp(euler.y, c.min.y, c.max.y);
        euler.z = THREE.MathUtils.clamp(euler.z, c.min.z, c.max.z);
        bone.quaternion.setFromEuler(euler);
      }

      bone.updateMatrixWorld(true);
    }
  }
}

/**
 * Two-Bone IK — Analytical solver for exactly 2 bones (upper arm + forearm, thigh + shin).
 * Most efficient and stable for limbs.
 */
function solveTwoBone(
  root: THREE.Bone,
  mid: THREE.Bone,
  tip: THREE.Bone,
  target: THREE.Vector3,
  poleTarget?: THREE.Vector3,
): void {
  const rootPos = new THREE.Vector3();
  const midPos = new THREE.Vector3();
  const tipPos = new THREE.Vector3();

  root.getWorldPosition(rootPos);
  mid.getWorldPosition(midPos);
  tip.getWorldPosition(tipPos);

  const upperLen = rootPos.distanceTo(midPos);
  const lowerLen = midPos.distanceTo(tipPos);
  const targetDist = Math.min(rootPos.distanceTo(target), upperLen + lowerLen - 0.001);

  if (targetDist < Math.abs(upperLen - lowerLen) + 0.001) return;

  // Law of cosines for joint angle
  const cosAngle = (upperLen * upperLen + lowerLen * lowerLen - targetDist * targetDist) / (2 * upperLen * lowerLen);
  const jointAngle = Math.acos(THREE.MathUtils.clamp(cosAngle, -1, 1));

  // Direction from root to target
  const targetDir = new THREE.Vector3().subVectors(target, rootPos).normalize();

  // Angle at root
  const cosRootAngle = (upperLen * upperLen + targetDist * targetDist - lowerLen * lowerLen) / (2 * upperLen * targetDist);
  const rootAngle = Math.acos(THREE.MathUtils.clamp(cosRootAngle, -1, 1));

  // Build rotation axis
  const currentDir = new THREE.Vector3().subVectors(tipPos, rootPos).normalize();
  const rotAxis = new THREE.Vector3().crossVectors(currentDir, targetDir);
  if (rotAxis.lengthSq() < 0.0001) rotAxis.set(0, 1, 0);
  rotAxis.normalize();

  // Apply root rotation
  const rootWorldQuat = new THREE.Quaternion();
  root.getWorldQuaternion(rootWorldQuat);

  const alignQuat = new THREE.Quaternion().setFromUnitVectors(currentDir, targetDir);
  const pitchQuat = new THREE.Quaternion().setFromAxisAngle(rotAxis, -rootAngle);

  const parentWorldQuat = new THREE.Quaternion();
  if (root.parent) root.parent.getWorldQuaternion(parentWorldQuat);
  const parentInv = parentWorldQuat.clone().invert();

  const newRootWorld = pitchQuat.multiply(alignQuat).multiply(rootWorldQuat);
  root.quaternion.copy(parentInv.multiply(newRootWorld));
  root.updateMatrixWorld(true);

  // Apply mid bone rotation (bend)
  const midBendAngle = Math.PI - jointAngle;
  const midAxis = new THREE.Vector3(1, 0, 0); // local X axis for typical rigs
  mid.quaternion.setFromAxisAngle(midAxis, midBendAngle);

  // Pole target adjustment
  if (poleTarget) {
    root.getWorldPosition(rootPos);
    mid.getWorldPosition(midPos);
    tip.getWorldPosition(tipPos);

    const limbDir = new THREE.Vector3().subVectors(target, rootPos).normalize();
    const midDir = new THREE.Vector3().subVectors(midPos, rootPos);
    const projected = midDir.sub(limbDir.multiplyScalar(midDir.dot(limbDir)));

    const poleDir = new THREE.Vector3().subVectors(poleTarget, rootPos);
    const projectedPole = poleDir.sub(limbDir.clone().multiplyScalar(poleDir.dot(limbDir)));

    if (projected.lengthSq() > 0.0001 && projectedPole.lengthSq() > 0.0001) {
      projected.normalize();
      projectedPole.normalize();
      const twist = new THREE.Quaternion().setFromUnitVectors(projected, projectedPole);
      root.quaternion.premultiply(parentInv.clone().multiply(twist).multiply(parentWorldQuat));
    }
  }

  root.updateMatrixWorld(true);
}

// ─── IK System ───────────────────────────────────────

export class IKSystem {
  private chains: IKChainConfig[] = [];
  private skeleton: THREE.Skeleton | null = null;
  private boneMap = new Map<string, THREE.Bone>();
  private footIK: FootIKConfig | null = null;
  private raycaster = new THREE.Raycaster();

  // Foot IK state
  private leftFootY = 0;
  private rightFootY = 0;
  private hipOffset = 0;

  /** Bind to a skinned mesh's skeleton */
  bind(skeleton: THREE.Skeleton): void {
    this.skeleton = skeleton;
    this.boneMap.clear();
    for (const bone of skeleton.bones) {
      this.boneMap.set(bone.name, bone);
    }
  }

  /** Add an IK chain */
  addChain(config: IKChainConfig): void {
    this.chains.push(config);
  }

  removeChain(id: string): void {
    const idx = this.chains.findIndex(c => c.id === id);
    if (idx !== -1) this.chains.splice(idx, 1);
  }

  getChain(id: string): IKChainConfig | undefined {
    return this.chains.find(c => c.id === id);
  }

  /** Set foot IK for automatic ground alignment */
  enableFootIK(config: FootIKConfig): void {
    this.footIK = config;
  }

  disableFootIK(): void {
    this.footIK = null;
  }

  /** Update all IK chains. Call after animation update but before render. */
  update(delta: number): void {
    if (!this.skeleton) return;

    for (const chain of this.chains) {
      if (chain.weight <= 0) continue;
      this.solveChain(chain);
    }

    if (this.footIK) {
      this.solveFootIK(delta);
    }
  }

  private solveChain(config: IKChainConfig): void {
    const bones: THREE.Bone[] = [];
    for (const name of config.boneNames) {
      const bone = this.boneMap.get(name);
      if (!bone) return;
      bones.push(bone);
    }

    switch (config.solver) {
      case 'fabrik': {
        // Extract world positions
        const positions = bones.map(b => {
          const pos = new THREE.Vector3();
          b.getWorldPosition(pos);
          return pos;
        });
        const lengths: number[] = [];
        for (let i = 0; i < positions.length - 1; i++) {
          lengths.push(positions[i].distanceTo(positions[i + 1]));
        }

        // Blend target
        const blendedTarget = config.weight < 1
          ? positions[positions.length - 1].clone().lerp(config.target, config.weight)
          : config.target.clone();

        solveFABRIK(positions, lengths, blendedTarget, config.iterations, config.tolerance);

        // Apply positions back to bones
        for (let i = 0; i < bones.length - 1; i++) {
          const dir = new THREE.Vector3().subVectors(positions[i + 1], positions[i]).normalize();
          const currentDir = new THREE.Vector3();
          bones[i + 1].getWorldPosition(currentDir).sub(positions[i]).normalize();

          if (currentDir.lengthSq() > 0.0001 && dir.lengthSq() > 0.0001) {
            const rot = new THREE.Quaternion().setFromUnitVectors(currentDir, dir);
            bones[i].quaternion.premultiply(rot);
            bones[i].updateMatrixWorld(true);
          }
        }
        break;
      }

      case 'ccd': {
        const blendedTarget = config.weight < 1
          ? new THREE.Vector3().lerpVectors(
              (() => { const p = new THREE.Vector3(); bones[bones.length - 1].getWorldPosition(p); return p; })(),
              config.target, config.weight)
          : config.target.clone();

        solveCCD(bones, blendedTarget, config.iterations, config.tolerance, config.constraints);
        break;
      }

      case 'twoBone': {
        if (bones.length !== 3) return;
        const blendedTarget = config.weight < 1
          ? new THREE.Vector3().lerpVectors(
              (() => { const p = new THREE.Vector3(); bones[2].getWorldPosition(p); return p; })(),
              config.target, config.weight)
          : config.target.clone();

        solveTwoBone(bones[0], bones[1], bones[2], blendedTarget, config.poleTarget);
        break;
      }
    }
  }

  private solveFootIK(delta: number): void {
    if (!this.footIK || !this.skeleton) return;

    const cfg = this.footIK;
    const leftFoot = this.boneMap.get(cfg.leftFootBone);
    const rightFoot = this.boneMap.get(cfg.rightFootBone);
    const hip = this.boneMap.get(cfg.hipBone);
    if (!leftFoot || !rightFoot || !hip) return;

    const leftPos = new THREE.Vector3();
    const rightPos = new THREE.Vector3();
    leftFoot.getWorldPosition(leftPos);
    rightFoot.getWorldPosition(rightPos);

    // Raycast down from each foot
    const leftGroundY = this.raycastGround(leftPos, cfg);
    const rightGroundY = this.raycastGround(rightPos, cfg);

    // Smooth transitions
    const speed = cfg.blendSpeed * delta;
    this.leftFootY = THREE.MathUtils.lerp(this.leftFootY, leftGroundY ?? leftPos.y, speed);
    this.rightFootY = THREE.MathUtils.lerp(this.rightFootY, rightGroundY ?? rightPos.y, speed);

    // Adjust hip height (lower to the lowest foot)
    const targetHipOffset = Math.min(
      (leftGroundY ?? leftPos.y) - leftPos.y,
      (rightGroundY ?? rightPos.y) - rightPos.y,
    );
    this.hipOffset = THREE.MathUtils.lerp(this.hipOffset, Math.min(0, targetHipOffset), speed);
    hip.position.y += this.hipOffset;

    // Adjust foot positions
    if (leftGroundY !== null) {
      leftFoot.position.y += (this.leftFootY + cfg.footOffset) - leftPos.y;
    }
    if (rightGroundY !== null) {
      rightFoot.position.y += (this.rightFootY + cfg.footOffset) - rightPos.y;
    }
  }

  private raycastGround(pos: THREE.Vector3, cfg: FootIKConfig): number | null {
    this.raycaster.set(
      new THREE.Vector3(pos.x, pos.y + 1, pos.z),
      new THREE.Vector3(0, -1, 0),
    );
    this.raycaster.far = cfg.rayLength;

    const targets = cfg.raycastLayers ?? [];
    if (targets.length === 0) return null;

    const intersects = this.raycaster.intersectObjects(targets, true);
    return intersects.length > 0 ? intersects[0].point.y : null;
  }

  // ─── Look-At Constraint ────────────────────────

  /** Make a bone look at a target (e.g., head tracking) */
  lookAt(boneName: string, target: THREE.Vector3, weight = 1, maxAngle = Math.PI / 3): void {
    const bone = this.boneMap.get(boneName);
    if (!bone) return;

    const bonePos = new THREE.Vector3();
    bone.getWorldPosition(bonePos);

    const dir = new THREE.Vector3().subVectors(target, bonePos).normalize();

    // Get bone's current forward direction (typically local Z or -Z)
    const boneWorldQuat = new THREE.Quaternion();
    bone.getWorldQuaternion(boneWorldQuat);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(boneWorldQuat);

    // Clamp angle
    const angle = forward.angleTo(dir);
    if (angle > maxAngle) {
      const axis = new THREE.Vector3().crossVectors(forward, dir).normalize();
      const clampedQuat = new THREE.Quaternion().setFromAxisAngle(axis, maxAngle);
      dir.copy(forward).applyQuaternion(clampedQuat);
    }

    const lookQuat = new THREE.Quaternion().setFromUnitVectors(forward, dir);

    // Blend
    if (weight < 1) {
      lookQuat.slerp(new THREE.Quaternion(), 1 - weight);
    }

    bone.quaternion.premultiply(lookQuat);
    bone.updateMatrixWorld(true);
  }

  // ─── Utility ───────────────────────────────────

  getBoneNames(): string[] {
    return [...this.boneMap.keys()];
  }

  getBone(name: string): THREE.Bone | undefined {
    return this.boneMap.get(name);
  }

  dispose(): void {
    this.chains = [];
    this.boneMap.clear();
    this.skeleton = null;
    this.footIK = null;
  }
}
