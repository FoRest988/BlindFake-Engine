/**
 * PlayModeSystem — Enhanced play / pause / step for the editor:
 * - Scene transform snapshot & restore
 * - Pause with live inspection (select objects, read properties)
 * - Step-by-step execution (advance single frame)
 * - Slow-motion (time scale)
 * - Play mode overlay (border glow, "PLAYING" indicator)
 * - Events: onPlay, onPause, onStop, onStep
 */

import * as THREE from 'three';

/* ─── Types ─────────────────────────────────────────── */

export type PlayState = 'stopped' | 'playing' | 'paused';

export interface PlayModeConfig {
  maxSnapshotDepth: number;
  showOverlay: boolean;
  pauseOnError: boolean;
  timeScale: number;
}

export interface PlayModeEvent {
  type: 'play' | 'pause' | 'stop' | 'step';
  time: number;
  frame: number;
}

type PlayModeListener = (event: PlayModeEvent) => void;

/* ─── Play Mode System ──────────────────────────────── */

export class PlayModeSystem {
  private state: PlayState = 'stopped';
  private scene: THREE.Scene;
  private frame: number = 0;
  private elapsed: number = 0;
  private listeners: Map<string, PlayModeListener[]> = new Map();
  private overlay: HTMLDivElement | null = null;
  private stepRequested: boolean = false;

  private config: PlayModeConfig = {
    maxSnapshotDepth: 100,
    showOverlay: true,
    pauseOnError: true,
    timeScale: 1,
  };

  // Store original transforms for quick restore
  private objectStates: Map<string, {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
    visible: boolean;
    userData: Record<string, unknown>;
    material: THREE.Material | THREE.Material[] | null;
  }> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /* ── State ────────────────────────────────────────── */

  getState(): PlayState { return this.state; }
  getFrame(): number { return this.frame; }
  getElapsed(): number { return this.elapsed; }
  getTimeScale(): number { return this.config.timeScale; }
  setTimeScale(scale: number): void { this.config.timeScale = Math.max(0.01, Math.min(10, scale)); }
  setConfig(partial: Partial<PlayModeConfig>): void { Object.assign(this.config, partial); }

  isPlaying(): boolean { return this.state === 'playing'; }
  isPaused(): boolean { return this.state === 'paused'; }
  isStopped(): boolean { return this.state === 'stopped'; }

  /* ── Play ─────────────────────────────────────────── */

  play(): void {
    if (this.state === 'playing') return;

    if (this.state === 'stopped') {
      // Take snapshot before entering play mode
      this.takeSnapshot();
      this.frame = 0;
      this.elapsed = 0;
    }

    this.state = 'playing';
    this.showPlayOverlay(true);
    this.emit({ type: 'play', time: this.elapsed, frame: this.frame });
  }

  /* ── Pause ────────────────────────────────────────── */

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.showPlayOverlay(true);
    this.emit({ type: 'pause', time: this.elapsed, frame: this.frame });
  }

  /* ── Toggle ───────────────────────────────────────── */

  togglePlayPause(): void {
    if (this.state === 'playing') this.pause();
    else this.play();
  }

  /* ── Stop ─────────────────────────────────────────── */

  stop(): void {
    if (this.state === 'stopped') return;

    // Restore scene to pre-play state
    this.restoreSnapshot();

    this.state = 'stopped';
    this.frame = 0;
    this.elapsed = 0;
    this.showPlayOverlay(false);
    this.emit({ type: 'stop', time: 0, frame: 0 });
  }

  /* ── Step ─────────────────────────────────────────── */

  /** Advance exactly one frame. If stopped, enters paused mode first. */
  step(): void {
    if (this.state === 'stopped') {
      this.takeSnapshot();
      this.frame = 0;
      this.elapsed = 0;
      this.state = 'paused';
      this.showPlayOverlay(true);
    }

    this.stepRequested = true;
    this.emit({ type: 'step', time: this.elapsed, frame: this.frame });
  }

  /* ── Update (call each frame from editor loop) ─── */

  /** Returns the effective delta time for this frame. Returns 0 if paused/stopped. */
  update(rawDelta: number): number {
    if (this.state === 'stopped') return 0;

    if (this.state === 'paused') {
      if (this.stepRequested) {
        this.stepRequested = false;
        this.frame++;
        const dt = (1 / 60) * this.config.timeScale; // Fixed step at 60fps
        this.elapsed += dt;
        this.updateOverlayInfo();
        return dt;
      }
      return 0;
    }

    // Playing
    const dt = rawDelta * this.config.timeScale;
    this.frame++;
    this.elapsed += dt;
    this.updateOverlayInfo();
    return dt;
  }

  /* ── Snapshot ──────────────────────────────────────── */

  private takeSnapshot(): void {
    // Store a transform cache for fast restore
    this.objectStates.clear();
    this.scene.traverse((obj) => {
      this.objectStates.set(obj.uuid, {
        position: obj.position.clone(),
        rotation: obj.rotation.clone(),
        scale: obj.scale.clone(),
        visible: obj.visible,
        userData: JSON.parse(JSON.stringify(obj.userData)),
        material: obj instanceof THREE.Mesh ? obj.material : null,
      });
    });
  }

  private restoreSnapshot(): void {
    // Quick restore: reset transforms of existing objects
    this.scene.traverse((obj) => {
      const saved = this.objectStates.get(obj.uuid);
      if (saved) {
        obj.position.copy(saved.position);
        obj.rotation.copy(saved.rotation);
        obj.scale.copy(saved.scale);
        obj.visible = saved.visible;
        if (obj instanceof THREE.Mesh && saved.material) {
          obj.material = saved.material;
        }
        // Restore userData
        for (const key of Object.keys(obj.userData)) {
          delete obj.userData[key];
        }
        Object.assign(obj.userData, saved.userData);
      }
    });

    // Remove objects that were added during play mode
    const knownUUIDs = new Set(this.objectStates.keys());
    const toRemove: THREE.Object3D[] = [];
    this.scene.traverse((obj) => {
      if (obj === this.scene) return;
      if (!knownUUIDs.has(obj.uuid)) {
        toRemove.push(obj);
      }
    });
    for (const obj of toRemove) {
      obj.removeFromParent();
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        if (obj.material instanceof THREE.Material) obj.material.dispose();
      }
    }

    this.objectStates.clear();
  }

  /* ── Events ───────────────────────────────────────── */

  on(type: PlayModeEvent['type'], listener: PlayModeListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  off(type: PlayModeEvent['type'], listener: PlayModeListener): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  }

  private emit(event: PlayModeEvent): void {
    const list = this.listeners.get(event.type);
    if (list) {
      for (const fn of list) fn(event);
    }
  }

  /* ── Overlay ──────────────────────────────────────── */

  /** Attach overlay to a container element */
  attachOverlay(container: HTMLElement): void {
    if (this.overlay) return;
    // Minimal overlay — just a glow indicator, no blue bar
    this.overlay = document.createElement('div');
    this.overlay.className = 'playmode-overlay';
    this.overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:1000;pointer-events:none;display:none;';
    container.style.position = 'relative';
    container.appendChild(this.overlay);
  }

  private showPlayOverlay(show: boolean): void {
    if (!this.overlay) return;
    this.overlay.style.display = show ? 'block' : 'none';

    // Border glow on viewport container
    const parent = this.overlay.parentElement;
    if (parent) {
      if (show && this.state === 'playing') {
        parent.style.boxShadow = 'inset 0 0 6px 2px rgba(46, 204, 113, 0.5)';
      } else if (show && this.state === 'paused') {
        parent.style.boxShadow = 'inset 0 0 6px 2px rgba(255, 200, 0, 0.5)';
      } else {
        parent.style.boxShadow = '';
      }
    }
  }

  private updateOverlayInfo(): void {
    // No bar, nothing to update
  }

  /* ── Cleanup ──────────────────────────────────────── */

  dispose(): void {
    if (this.state !== 'stopped') this.stop();
    this.overlay?.remove();
    this.overlay = null;
    this.listeners.clear();
    this.objectStates.clear();
  }
}
