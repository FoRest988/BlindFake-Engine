// ─── Camera Controller ──────────────────────────────────────────────
// Runtime camera modes: FPS, Third-Person, Orbit, Top-Down, Free-Fly.
// Independent from editor OrbitControls — this drives in-game cameras.

import * as THREE from 'three';

export type CameraMode = 'fps' | 'thirdPerson' | 'orbit' | 'topDown' | 'freeFly';

export interface CameraConfig {
  mode: CameraMode;
  /** Move speed (units/sec) */
  moveSpeed: number;
  /** Sprint multiplier */
  sprintMultiplier: number;
  /** Mouse sensitivity (radians/pixel) */
  sensitivity: number;
  /** Vertical look limits (radians). Default [-PI/2, PI/2] */
  pitchLimits: [number, number];
  /** Smoothing factor (0 = instant, 1 = very slow) */
  smoothing: number;

  /** Third-person distance */
  followDistance: number;
  /** Third-person height offset */
  followHeight: number;
  /** Third-person collision enabled */
  followCollision: boolean;

  /** Orbit zoom limits */
  orbitMinDist: number;
  orbitMaxDist: number;

  /** Top-down height */
  topDownHeight: number;
  /** Top-down rotation (fixed angle) */
  topDownAngle: number;
}

const DEFAULT_CONFIG: CameraConfig = {
  mode: 'fps',
  moveSpeed: 8,
  sprintMultiplier: 2,
  sensitivity: 0.002,
  pitchLimits: [-Math.PI / 2 + 0.01, Math.PI / 2 - 0.01],
  smoothing: 0.1,
  followDistance: 5,
  followHeight: 2,
  followCollision: true,
  orbitMinDist: 1,
  orbitMaxDist: 50,
  topDownHeight: 15,
  topDownAngle: -Math.PI / 2,
};

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private config: CameraConfig;

  // Look state
  private yaw = 0;
  private pitch = 0;

  // Target for follow modes
  private target: THREE.Object3D | null = null;
  private targetOffset = new THREE.Vector3(0, 1.6, 0); // eye height for FPS

  // Orbit
  private orbitDist = 10;

  // Smoothed position (for follow)
  private smoothPos = new THREE.Vector3();
  private smoothLook = new THREE.Vector3();
  private initialized = false;

  // Input state (set externally each frame)
  private moveInput = new THREE.Vector2(); // x = strafe, y = forward
  private lookDelta = new THREE.Vector2(); // mouse delta
  private sprint = false;
  private scrollDelta = 0;

  // Temp vectors
  private _forward = new THREE.Vector3();
  private _right = new THREE.Vector3();
  private _desired = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, config?: Partial<CameraConfig>) {
    this.camera = camera;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.orbitDist = this.config.followDistance;
    this.smoothPos.copy(camera.position);
  }

  setTarget(obj: THREE.Object3D | null, eyeOffset?: THREE.Vector3): void {
    this.target = obj;
    if (eyeOffset) this.targetOffset.copy(eyeOffset);
    this.initialized = false;
  }

  setMode(mode: CameraMode): void {
    this.config.mode = mode;
    this.initialized = false;
  }

  getMode(): CameraMode { return this.config.mode; }

  setConfig(partial: Partial<CameraConfig>): void {
    Object.assign(this.config, partial);
  }

  /** Call each frame with raw input */
  setInput(move: THREE.Vector2, look: THREE.Vector2, sprint: boolean, scroll: number): void {
    this.moveInput.copy(move);
    this.lookDelta.copy(look);
    this.sprint = sprint;
    this.scrollDelta = scroll;
  }

  update(dt: number): void {
    // Apply look
    this.yaw -= this.lookDelta.x * this.config.sensitivity;
    this.pitch -= this.lookDelta.y * this.config.sensitivity;
    this.pitch = Math.max(this.config.pitchLimits[0], Math.min(this.config.pitchLimits[1], this.pitch));

    switch (this.config.mode) {
      case 'fps': this.updateFPS(dt); break;
      case 'thirdPerson': this.updateThirdPerson(dt); break;
      case 'orbit': this.updateOrbit(dt); break;
      case 'topDown': this.updateTopDown(dt); break;
      case 'freeFly': this.updateFreeFly(dt); break;
    }
  }

  // ── FPS Camera ─────────────────────────────────

  private updateFPS(dt: number): void {
    if (!this.target) {
      this.updateFreeFly(dt);
      return;
    }

    const speed = this.config.moveSpeed * (this.sprint ? this.config.sprintMultiplier : 1) * dt;

    // Move target based on yaw
    this._forward.set(0, 0, -1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    this._right.set(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);

    this.target.position.addScaledVector(this._forward, this.moveInput.y * speed);
    this.target.position.addScaledVector(this._right, this.moveInput.x * speed);

    // Camera at target's eye position
    const eyePos = this.target.position.clone().add(this.targetOffset);
    this.camera.position.copy(eyePos);

    // Apply look rotation
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  // ── Third-Person Camera ────────────────────────

  private updateThirdPerson(dt: number): void {
    if (!this.target) return;

    const speed = this.config.moveSpeed * (this.sprint ? this.config.sprintMultiplier : 1) * dt;
    this._forward.set(0, 0, -1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    this._right.set(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);

    this.target.position.addScaledVector(this._forward, this.moveInput.y * speed);
    this.target.position.addScaledVector(this._right, this.moveInput.x * speed);

    // Desired camera position: behind and above target
    const targetPos = this.target.position.clone().add(this.targetOffset);
    this._desired.set(0, 0, 1)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), -this.pitch)
      .applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw)
      .multiplyScalar(this.config.followDistance)
      .add(targetPos)
      .setY(targetPos.y + this.config.followHeight);

    // Smooth follow
    const t = this.initialized ? 1 - Math.pow(this.config.smoothing, dt * 60) : 1;
    this.smoothPos.lerp(this._desired, t);
    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(targetPos);
    this.initialized = true;
  }

  // ── Orbit Camera ───────────────────────────────

  private updateOrbit(dt: number): void {
    // Zoom with scroll
    this.orbitDist -= this.scrollDelta * 0.5;
    this.orbitDist = Math.max(this.config.orbitMinDist, Math.min(this.config.orbitMaxDist, this.orbitDist));

    const center = this.target
      ? this.target.position.clone().add(this.targetOffset)
      : new THREE.Vector3();

    // Spherical offset from yaw/pitch/distance
    const x = this.orbitDist * Math.cos(this.pitch) * Math.sin(this.yaw);
    const y = this.orbitDist * Math.sin(this.pitch);
    const z = this.orbitDist * Math.cos(this.pitch) * Math.cos(this.yaw);

    this._desired.set(center.x + x, center.y + y, center.z + z);

    const t = this.initialized ? 1 - Math.pow(this.config.smoothing, dt * 60) : 1;
    this.smoothPos.lerp(this._desired, t);
    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(center);
    this.initialized = true;
  }

  // ── Top-Down Camera ────────────────────────────

  private updateTopDown(dt: number): void {
    const center = this.target ? this.target.position.clone() : new THREE.Vector3();

    // Optional: move target with input
    if (this.target) {
      const speed = this.config.moveSpeed * (this.sprint ? this.config.sprintMultiplier : 1) * dt;
      this.target.position.x += this.moveInput.x * speed;
      this.target.position.z -= this.moveInput.y * speed;
    }

    this._desired.set(center.x, center.y + this.config.topDownHeight, center.z + 0.01);

    const t = this.initialized ? 1 - Math.pow(this.config.smoothing, dt * 60) : 1;
    this.smoothPos.lerp(this._desired, t);
    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(center);
    this.initialized = true;
  }

  // ── Free-Fly Camera ────────────────────────────

  private updateFreeFly(dt: number): void {
    const speed = this.config.moveSpeed * (this.sprint ? this.config.sprintMultiplier : 1) * dt;

    this._forward.set(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this._right.set(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);

    this.camera.position.addScaledVector(this._forward, this.moveInput.y * speed);
    this.camera.position.addScaledVector(this._right, this.moveInput.x * speed);

    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /** Interpolate between current camera and another position/quaternion */
  lerpTo(pos: THREE.Vector3, lookAt: THREE.Vector3, alpha: number): void {
    this.camera.position.lerp(pos, alpha);
    const dir = lookAt.clone().sub(this.camera.position).normalize();
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(dir.y);
  }

  getCamera(): THREE.PerspectiveCamera { return this.camera; }
  getYaw(): number { return this.yaw; }
  getPitch(): number { return this.pitch; }

  setYaw(y: number): void { this.yaw = y; }
  setPitch(p: number): void { this.pitch = p; }
}
