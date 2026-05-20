// ─── Camera Effects ─────────────────────────────────────────────────
// Screen shake, zoom punch, slow motion, cinematic bars, FOV kick,
// camera trauma system for professional "game feel" / juice.

import * as THREE from 'three';

export class CameraEffects {
  private camera: THREE.PerspectiveCamera;

  // Original state (restored after effects)
  private originalFOV: number;
  private originalPosition = new THREE.Vector3();
  private originalRotZ = 0;

  // ── Shake ───────────────────────────────────────────────────────
  private trauma = 0; // 0..1, shake intensity (squared for actual shake)
  private traumaDecay = 1.5; // trauma reduction per second
  private maxShakeOffset = 0.5; // max positional displacement
  private maxShakeAngle = 0.03; // max rotational displacement (radians)
  private shakeFrequency = 25; // noise frequency
  private shakeElapsed = 0;

  // ── Zoom Punch ──────────────────────────────────────────────────
  private zoomPunchActive = false;
  private zoomPunchAmount = 0;
  private zoomPunchDecay = 0;
  private zoomPunchCurrent = 0;

  // ── FOV Kick ────────────────────────────────────────────────────
  private fovKickActive = false;
  private fovKickTarget = 0;
  private fovKickCurrent = 0;
  private fovKickSpeed = 0;
  private fovKickReturn = 0;

  // ── Slow Motion ─────────────────────────────────────────────────
  private timeScale = 1;
  private targetTimeScale = 1;
  private timeScaleLerpSpeed = 5;

  // ── Cinematic Bars ──────────────────────────────────────────────
  private barsActive = false;
  private barsProgress = 0;
  private barsTarget = 0;
  private barsSpeed = 2;
  private topBar: HTMLElement | null = null;
  private bottomBar: HTMLElement | null = null;
  private barHeight = 60; // pixels

  // ── Tilt ────────────────────────────────────────────────────────
  private tiltAngle = 0;
  private tiltTarget = 0;
  private tiltSpeed = 3;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.originalFOV = camera.fov;
  }

  // ── Public API ──────────────────────────────────────────────────

  /** Add trauma for screen shake (0..1). Stacks — multiple hits add up. */
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** One-shot shake with specific intensity */
  shake(intensity = 0.5): void {
    this.addTrauma(intensity);
  }

  /** Strong impact shake (explosion, big hit) */
  impact(intensity = 0.8): void {
    this.addTrauma(intensity);
    this.zoomPunch(3, 8);
  }

  /** Zoom punch — quick FOV change that snaps back (for hits/explosions) */
  zoomPunch(amount = 5, decaySpeed = 10): void {
    this.zoomPunchActive = true;
    this.zoomPunchAmount = amount;
    this.zoomPunchCurrent = amount;
    this.zoomPunchDecay = decaySpeed;
  }

  /** Smooth FOV kick (sprinting, dashing) */
  fovKick(targetFOVOffset: number, speed = 4, returnSpeed = 2): void {
    this.fovKickActive = true;
    this.fovKickTarget = targetFOVOffset;
    this.fovKickSpeed = speed;
    this.fovKickReturn = returnSpeed;
  }

  /** Stop FOV kick (return to normal) */
  stopFovKick(): void {
    this.fovKickTarget = 0;
    this.fovKickSpeed = this.fovKickReturn;
  }

  /** Set slow motion (0.1 = very slow, 1 = normal, 2 = fast) */
  setSlowMotion(scale: number, lerpSpeed = 5): void {
    this.targetTimeScale = Math.max(0.01, scale);
    this.timeScaleLerpSpeed = lerpSpeed;
  }

  /** Instant slow-motion for a duration, then return to normal */
  bulletTime(scale: number, duration: number): void {
    this.timeScale = scale;
    this.targetTimeScale = scale;
    setTimeout(() => {
      this.targetTimeScale = 1;
    }, duration * 1000);
  }

  /** Get current time scale (apply to delta for slow-mo) */
  getTimeScale(): number {
    return this.timeScale;
  }

  /** Show cinematic letterbox bars */
  showCinematicBars(height = 60, speed = 2): void {
    this.barHeight = height;
    this.barsTarget = 1;
    this.barsSpeed = speed;
    if (!this.barsActive) {
      this.barsActive = true;
      this.createBars();
    }
  }

  /** Hide cinematic bars */
  hideCinematicBars(speed = 2): void {
    this.barsTarget = 0;
    this.barsSpeed = speed;
  }

  /** Set camera tilt (dutch angle) */
  setTilt(angleDegrees: number, speed = 3): void {
    this.tiltTarget = angleDegrees * (Math.PI / 180);
    this.tiltSpeed = speed;
  }

  /** Reset tilt to 0 */
  resetTilt(speed = 3): void {
    this.tiltTarget = 0;
    this.tiltSpeed = speed;
  }

  /** Set shake parameters */
  setShakeParams(params: { decay?: number; maxOffset?: number; maxAngle?: number; frequency?: number }): void {
    if (params.decay !== undefined) this.traumaDecay = params.decay;
    if (params.maxOffset !== undefined) this.maxShakeOffset = params.maxOffset;
    if (params.maxAngle !== undefined) this.maxShakeAngle = params.maxAngle;
    if (params.frequency !== undefined) this.shakeFrequency = params.frequency;
  }

  // ── Update (call every frame) ─────────────────────────────────

  update(delta: number): void {
    this.originalPosition.copy(this.camera.position);
    this.originalFOV = this.camera.fov;
    this.originalRotZ = this.camera.rotation.z;
    let fovDelta = 0;

    // ── Shake ─────────────────────────────────────────
    if (this.trauma > 0) {
      this.shakeElapsed += delta;
      const shake = this.trauma * this.trauma; // quadratic for more natural feel

      // Use sine waves at different frequencies for pseudo-random shake
      const t = this.shakeElapsed * this.shakeFrequency;
      const offsetX = this.maxShakeOffset * shake * Math.sin(t * 1.1 + 0.3);
      const offsetY = this.maxShakeOffset * shake * Math.sin(t * 1.7 + 1.2);
      const angleZ = this.maxShakeAngle * shake * Math.sin(t * 1.3 + 2.1);

      this.camera.position.x += offsetX;
      this.camera.position.y += offsetY;
      this.camera.rotation.z += angleZ;

      this.trauma = Math.max(0, this.trauma - this.traumaDecay * delta);
    }

    // ── Zoom Punch ────────────────────────────────────
    if (this.zoomPunchActive) {
      this.zoomPunchCurrent = this.zoomPunchCurrent + (0 - this.zoomPunchCurrent) * Math.min(1, this.zoomPunchDecay * delta);
      fovDelta += this.zoomPunchCurrent;

      if (Math.abs(this.zoomPunchCurrent) < 0.01) {
        this.zoomPunchActive = false;
        this.zoomPunchCurrent = 0;
      }
    }

    // ── FOV Kick ──────────────────────────────────────
    if (this.fovKickActive) {
      const diff = this.fovKickTarget - this.fovKickCurrent;
      const speed = this.fovKickTarget !== 0 ? this.fovKickSpeed : this.fovKickReturn;
      this.fovKickCurrent += diff * Math.min(1, speed * delta);
      fovDelta += this.fovKickCurrent;

      if (this.fovKickTarget === 0 && Math.abs(this.fovKickCurrent) < 0.01) {
        this.fovKickActive = false;
        this.fovKickCurrent = 0;
      }
    }

    // Apply FOV changes
    if (fovDelta !== 0) {
      this.camera.fov = this.originalFOV + fovDelta;
      this.camera.updateProjectionMatrix();
    }

    // ── Slow Motion ───────────────────────────────────
    if (Math.abs(this.timeScale - this.targetTimeScale) > 0.001) {
      this.timeScale += (this.targetTimeScale - this.timeScale) * Math.min(1, this.timeScaleLerpSpeed * delta);
    } else {
      this.timeScale = this.targetTimeScale;
    }

    // ── Cinematic Bars ────────────────────────────────
    if (this.barsActive) {
      const diff = this.barsTarget - this.barsProgress;
      this.barsProgress += diff * Math.min(1, this.barsSpeed * delta);

      if (this.topBar && this.bottomBar) {
        const h = this.barsProgress * this.barHeight;
        this.topBar.style.height = `${h}px`;
        this.bottomBar.style.height = `${h}px`;
      }

      if (this.barsTarget === 0 && this.barsProgress < 0.01) {
        this.barsActive = false;
        this.destroyBars();
      }
    }

    // ── Tilt ──────────────────────────────────────────
    if (Math.abs(this.tiltAngle - this.tiltTarget) > 0.0001) {
      this.tiltAngle += (this.tiltTarget - this.tiltAngle) * Math.min(1, this.tiltSpeed * delta);
      this.camera.rotation.z += this.tiltAngle;
    }
  }

  /** Restore camera position after shake (call at end of frame if needed) */
  restorePosition(): void {
    this.camera.position.copy(this.originalPosition);
    this.camera.rotation.z = this.originalRotZ;
    if ((this.camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      (this.camera as THREE.PerspectiveCamera).fov = this.originalFOV;
      (this.camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
  }

  // ── Cinematic Bars DOM ──────────────────────────────────────────

  private createBars(): void {
    this.destroyBars();

    const barStyle = `position:fixed;left:0;width:100%;background:#000;z-index:900;pointer-events:none;height:0;transition:none;`;

    this.topBar = document.createElement('div');
    this.topBar.style.cssText = barStyle + 'top:0;';
    document.body.appendChild(this.topBar);

    this.bottomBar = document.createElement('div');
    this.bottomBar.style.cssText = barStyle + 'bottom:0;';
    document.body.appendChild(this.bottomBar);
  }

  private destroyBars(): void {
    this.topBar?.remove();
    this.bottomBar?.remove();
    this.topBar = null;
    this.bottomBar = null;
    this.barsProgress = 0;
  }

  dispose(): void {
    this.destroyBars();
  }
}
