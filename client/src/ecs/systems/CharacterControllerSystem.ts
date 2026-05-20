// ─── Character Controller System (Rapier KCC) ──────────────────────
// Handles player input → movement via Rapier's kinematic character controller.
// Supports slope climbing, step detection, and snap-to-ground.

import * as THREE from 'three';
import { System } from '../System';
import type { Engine } from '../../engine/Engine';
import { TransformComponent, PhysicsBodyComponent, CameraFollowComponent } from '../components/GameComponents';
import { CharacterControllerComponent } from '../components/GameComponents2D';
import { PhysicsSystem } from './PhysicsSystem';

const GRAVITY = -20;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER_TIME = 0.14;

// Module-level constant — avoids `new THREE.Vector3(0,1,0)` every frame in hot path
const _UP = new THREE.Vector3(0, 1, 0);

export class CharacterControllerSystem extends System {
  priority = 15;

  private engine: Engine;
  private _moveDir = new THREE.Vector3();
  private _camForward = new THREE.Vector3();
  private _camRight = new THREE.Vector3();
  private _desiredMove = new THREE.Vector3();
  private _corrected = new THREE.Vector3();
  private verticalVelocities = new Map<number, number>();
  private coyoteTimers = new Map<number, number>();
  private jumpBufferTimers = new Map<number, number>();
  // After a jump fires, Rapier may still report "grounded" for a frame or two.
  // This timer blocks the isGrounded→vertVel=0 branch for a short window post-jump.
  private jumpImmunityTimers = new Map<number, number>();

  constructor(engine: Engine) {
    super();
    this.engine = engine;
  }

  update(delta: number, _elapsed: number): void {
    const entities = this.world.query(TransformComponent, CharacterControllerComponent);
    const physicsSystem = this.world.getSystem(PhysicsSystem);

    for (const entity of entities) {
      const transform = entity.get(TransformComponent);
      const controller = entity.get(CharacterControllerComponent);
      const body = entity.tryGet(PhysicsBodyComponent);
      const input = this.engine.input;

      // Get camera directions on XZ plane
      this.engine.camera.getWorldDirection(this._camForward);
      this._camForward.y = 0;
      this._camForward.normalize();
      this._camRight.crossVectors(this._camForward, _UP).normalize();

      // Build move direction from input
      this._moveDir.set(0, 0, 0);

      if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) this._moveDir.add(this._camForward);
      if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) this._moveDir.sub(this._camForward);
      if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) this._moveDir.add(this._camRight);
      if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) this._moveDir.sub(this._camRight);

      if (this._moveDir.lengthSq() > 0) this._moveDir.normalize();

      controller.isRunning = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight');
      const speed = controller.isRunning ? controller.runSpeed : controller.moveSpeed;
      const jumpHeld = input.isKeyDown('space') || input.isKeyDown(' ');

      controller.moveDirection.copy(this._moveDir);

      if (body && physicsSystem && physicsSystem.rapier.isReady) {
        // Mark body as using character controller
        body._useCharacterController = true;
        let didJumpThisFrame = false;

        // Track vertical velocity manually (Rapier KCC is kinematic)
        let vertVel = this.verticalVelocities.get(entity.id) ?? 0;
        let coyoteTimer = Math.max(0, (this.coyoteTimers.get(entity.id) ?? COYOTE_TIME) - delta);
        let jumpBufferTimer = Math.max(0, (this.jumpBufferTimers.get(entity.id) ?? 0) - delta);
        let jumpImmunity = Math.max(0, (this.jumpImmunityTimers.get(entity.id) ?? 0) - delta);
        const isGrounded = jumpImmunity <= 0 && (body.grounded || physicsSystem.rapier.isCharacterGrounded(entity.id));

        if (!jumpHeld) {
          controller.canJump = true;
        }

        if (input.isKeyJustPressed('space') || input.isKeyJustPressed(' ') || (jumpHeld && controller.canJump)) {
          jumpBufferTimer = JUMP_BUFFER_TIME;
        }

        if (isGrounded) {
          coyoteTimer = COYOTE_TIME;
          vertVel = Math.min(vertVel, 0);
          controller.isJumping = false;
        } else {
          vertVel += GRAVITY * delta;
        }

        // Jump buffering + coyote time smooth over grounded-state jitter.
        if (jumpBufferTimer > 0 && coyoteTimer > 0 && controller.canJump) {
          vertVel = controller.jumpForce;
          controller.isJumping = true;
          controller.canJump = false;
          didJumpThisFrame = true;
          body.grounded = false;
          jumpBufferTimer = 0;
          coyoteTimer = 0;
          jumpImmunity = 0.18; // prevent Rapier grounded-lag from zeroing vertVel
        }

        // Desired movement for this frame
        this._desiredMove.set(
          this._moveDir.x * speed * delta,
          vertVel * delta,
          this._moveDir.z * speed * delta
        );

        // Use Rapier KCC for collision-corrected movement (zero-alloc via *Into)
        physicsSystem.rapier.moveCharacterInto(entity.id, this._desiredMove, this._corrected);
        transform.position.add(this._corrected);

        // Sync position back to Rapier kinematic body
        physicsSystem.rapier.setBodyTransform(entity.id, transform.position, transform.quaternion);

        // Update grounded state from Rapier
        const groundedAfterMove = physicsSystem.rapier.isCharacterGrounded(entity.id);
        body.grounded = (didJumpThisFrame && vertVel > 0) || jumpImmunity > 0 ? false : groundedAfterMove;
        if (body.grounded) {
          coyoteTimer = COYOTE_TIME;
          vertVel = Math.min(vertVel, 0);
          controller.isJumping = false;
        }

        this.verticalVelocities.set(entity.id, vertVel);
        this.coyoteTimers.set(entity.id, coyoteTimer);
        this.jumpBufferTimers.set(entity.id, jumpBufferTimer);
        this.jumpImmunityTimers.set(entity.id, jumpImmunity);

        // Sync velocity into component for game logic
        body.velocity.set(
          this._moveDir.x * speed,
          vertVel,
          this._moveDir.z * speed
        );
      } else {
        // Fallback: direct transform movement (no physics)
        transform.position.x += this._moveDir.x * speed * delta;
        transform.position.z += this._moveDir.z * speed * delta;
      }

      // Rotate toward movement direction
      if (this._moveDir.lengthSq() > 0.01 && controller.mode === 'third-person') {
        const targetAngle = Math.atan2(this._moveDir.x, this._moveDir.z);
        let currentAngle = transform.rotation.y;
        let diff = targetAngle - currentAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        currentAngle += diff * Math.min(1, controller.rotationSpeed * delta);
        transform.rotation.y = currentAngle;
        transform.quaternion.setFromEuler(transform.rotation);
      }
    }

    // Camera follow
    this.updateCameraFollow(delta);

    // Prune state maps for entities that are no longer in the world to prevent unbounded growth
    if (this.verticalVelocities.size > 0) {
      const activeIds = new Set(entities.map(e => e.id));
      for (const id of this.verticalVelocities.keys()) {
        if (!activeIds.has(id)) {
          this.verticalVelocities.delete(id);
          this.coyoteTimers.delete(id);
          this.jumpBufferTimers.delete(id);
          this.jumpImmunityTimers.delete(id);
        }
      }
    }
  }

  private updateCameraFollow(delta: number): void {
    const entities = this.world.query(TransformComponent, CameraFollowComponent);

    for (const entity of entities) {
      const follow = entity.get(CameraFollowComponent);
      if (!follow.isActive) continue;

      const transform = entity.get(TransformComponent);
      const targetPos = transform.position.clone().add(follow.offset);
      const lookTarget = transform.position.clone().add(follow.lookAtOffset);

      const t = 1 - Math.exp(-follow.smoothSpeed * delta);
      this.engine.camera.position.lerp(targetPos, t);
      this.engine.camera.lookAt(lookTarget);
    }
  }
}
