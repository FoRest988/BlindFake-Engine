import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import { LuaScriptRunner } from './LuaScriptRunner';

export interface CinematicKeyframe {
  time: number;
  cameraPosition?: THREE.Vector3;
  cameraLookAt?: THREE.Vector3;
  cameraFov?: number;
  subtitle?: string;
  subtitleSpeaker?: string;
  letterbox?: boolean;
  fadeColor?: string;
  fadeAlpha?: number;
  event?: string;
}

export interface CinematicTrack {
  name: string;
  duration: number;
  keyframes: CinematicKeyframe[];
  loop?: boolean;
}

export class CinematicEngine {
  private engine: Engine;
  private luaRunner: LuaScriptRunner;

  private currentTrack: CinematicTrack | null = null;
  private currentTime = 0;
  private playing = false;
  private paused = false;
  private playbackSpeed = 1;

  // Camera state for interpolation
  private savedCameraState: { pos: THREE.Vector3; rot: THREE.Quaternion; fov: number } | null = null;
  private cameraPos = new THREE.Vector3();
  private cameraLookAt = new THREE.Vector3();
  private cameraFov = 60;

  // DOM references
  private overlay: HTMLElement | null = null;
  private topLetterbox: HTMLElement | null = null;
  private bottomLetterbox: HTMLElement | null = null;
  private subtitleEl: HTMLElement | null = null;

  // Callbacks
  public onCinematicStart?: () => void;
  public onCinematicEnd?: () => void;
  public onEvent?: (eventName: string) => void;

  constructor(engine: Engine) {
    this.engine = engine;
    this.luaRunner = new LuaScriptRunner(this);
    this.bindDOM();
  }

  private bindDOM(): void {
    this.overlay = document.getElementById('cinematic-overlay');
    this.topLetterbox = this.overlay?.querySelector('.letterbox.top') ?? null;
    this.bottomLetterbox = this.overlay?.querySelector('.letterbox.bottom') ?? null;
    this.subtitleEl = document.getElementById('subtitle-text');
  }

  /** Play a cinematic track object */
  play(track: CinematicTrack): void {
    this.currentTrack = track;
    this.currentTime = 0;
    this.playing = true;
    this.paused = false;

    // Save camera state to restore after
    this.savedCameraState = {
      pos: this.engine.camera.position.clone(),
      rot: this.engine.camera.quaternion.clone(),
      fov: this.engine.camera.fov,
    };

    this.showOverlay();
    this.onCinematicStart?.();
  }

  /** Load and play a Lua cinematic script */
  async playScript(luaCode: string): Promise<void> {
    const track = this.luaRunner.execute(luaCode);
    if (track) {
      this.play(track);
    }
  }

  /** Load a .lua cinematic file from URL */
  async playFile(url: string): Promise<void> {
    const response = await fetch(url);
    const luaCode = await response.text();
    await this.playScript(luaCode);
  }

  stop(): void {
    this.playing = false;
    this.paused = false;
    this.currentTrack = null;

    // Restore camera
    if (this.savedCameraState) {
      this.engine.camera.position.copy(this.savedCameraState.pos);
      this.engine.camera.quaternion.copy(this.savedCameraState.rot);
      this.engine.camera.fov = this.savedCameraState.fov;
      this.engine.camera.updateProjectionMatrix();
      this.savedCameraState = null;
    }

    this.hideOverlay();
    this.onCinematicEnd?.();
  }

  pause(): void {
    if (this.playing) this.paused = true;
  }

  resume(): void {
    if (this.playing) this.paused = false;
  }

  setSpeed(speed: number): void {
    this.playbackSpeed = speed;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentTrackName(): string | null {
    return this.currentTrack?.name ?? null;
  }

  get time(): number {
    return this.currentTime;
  }

  get duration(): number {
    return this.currentTrack?.duration ?? 0;
  }

  update(delta: number): void {
    if (!this.playing || this.paused || !this.currentTrack) return;

    this.currentTime += delta * this.playbackSpeed;

    // Find surrounding keyframes
    const track = this.currentTrack;
    const t = this.currentTime;

    // Find previous and next keyframes
    let prevKf: CinematicKeyframe | null = null;
    let nextKf: CinematicKeyframe | null = null;

    for (let i = 0; i < track.keyframes.length; i++) {
      if (track.keyframes[i].time <= t) {
        prevKf = track.keyframes[i];
      }
      if (track.keyframes[i].time > t && !nextKf) {
        nextKf = track.keyframes[i];
      }
    }

    if (prevKf) {
      this.applyKeyframe(prevKf, nextKf);
    }

    // Check if cinematic ended
    if (this.currentTime >= track.duration) {
      if (track.loop) {
        this.currentTime = 0;
      } else {
        this.stop();
      }
    }
  }

  private applyKeyframe(current: CinematicKeyframe, next: CinematicKeyframe | null): void {
    const camera = this.engine.camera;

    if (next && current.cameraPosition && next.cameraPosition) {
      // Interpolate between keyframes
      const range = next.time - current.time;
      const alpha = range > 0 ? Math.min(1, (this.currentTime - current.time) / range) : 1;
      const smoothAlpha = this.smoothstep(alpha);

      this.cameraPos.lerpVectors(current.cameraPosition, next.cameraPosition, smoothAlpha);
      camera.position.copy(this.cameraPos);

      if (current.cameraLookAt && next.cameraLookAt) {
        this.cameraLookAt.lerpVectors(current.cameraLookAt, next.cameraLookAt, smoothAlpha);
        camera.lookAt(this.cameraLookAt);
      }

      if (current.cameraFov !== undefined && next.cameraFov !== undefined) {
        camera.fov = THREE.MathUtils.lerp(current.cameraFov, next.cameraFov, smoothAlpha);
        camera.updateProjectionMatrix();
      }
    } else if (current.cameraPosition) {
      camera.position.copy(current.cameraPosition);
      if (current.cameraLookAt) {
        camera.lookAt(current.cameraLookAt);
      }
      if (current.cameraFov !== undefined) {
        camera.fov = current.cameraFov;
        camera.updateProjectionMatrix();
      }
    }

    // Subtitles
    if (this.subtitleEl) {
      if (current.subtitle !== undefined) {
        let text = current.subtitle;
        if (current.subtitleSpeaker) {
          text = `<strong>${this.escapeHtml(current.subtitleSpeaker)}:</strong> ${this.escapeHtml(current.subtitle)}`;
        } else {
          text = this.escapeHtml(text);
        }
        this.subtitleEl.innerHTML = text;
      }
    }

    // Letterbox
    if (current.letterbox !== undefined) {
      this.setLetterbox(current.letterbox);
    }

    // Events
    if (current.event) {
      this.onEvent?.(current.event);
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  private showOverlay(): void {
    this.overlay?.classList.remove('hidden');
    this.setLetterbox(true);
  }

  private hideOverlay(): void {
    this.setLetterbox(false);
    if (this.subtitleEl) this.subtitleEl.textContent = '';
    setTimeout(() => {
      this.overlay?.classList.add('hidden');
    }, 800);
  }

  private setLetterbox(active: boolean): void {
    if (active) {
      this.topLetterbox?.classList.add('active');
      this.bottomLetterbox?.classList.add('active');
    } else {
      this.topLetterbox?.classList.remove('active');
      this.bottomLetterbox?.classList.remove('active');
    }
  }
}
