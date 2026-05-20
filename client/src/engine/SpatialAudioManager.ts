/**
 * SpatialAudioManager — Enhanced 3D positional audio with HRTF, room acoustics,
 * occlusion simulation, and Doppler effect.
 *
 * Built on top of the Web Audio API PannerNode (HRTF panning model) and
 * BiquadFilters for occlusion/material absorption.
 *
 * Features:
 *  - HRTF panning (panningModel: 'HRTF') for binaural 3D sound
 *  - Room acoustics: reverb tail generated from room size/material presets
 *  - Occlusion: low-pass filter simulates sound passing through walls
 *  - Doppler: pitch shift based on source/listener velocity
 *  - Distance attenuation models: linear, inverse, exponential
 *  - Per-source material absorption (muffled, underwater, concrete, etc.)
 */

import * as THREE from 'three';

// ── Types ──────────────────────────────────────────────────────────

export type AttenuationModel = 'linear' | 'inverse' | 'exponential';
export type RoomPreset = 'none' | 'small_room' | 'medium_room' | 'large_hall' | 'cave' | 'outdoor';
export type OcclusionMaterial = 'none' | 'glass' | 'wood' | 'concrete' | 'metal' | 'soil' | 'water';

export interface SpatialSourceOptions {
  /** Reference distance where volume = 1 (default 1) */
  refDistance?: number;
  /** Maximum distance beyond which volume = 0 (default 10000) */
  maxDistance?: number;
  /** Rolloff factor (default 1) */
  rolloffFactor?: number;
  attenuation?: AttenuationModel;
  /** Cone inner angle in degrees (default 360 — omnidirectional) */
  coneInnerAngle?: number;
  /** Cone outer angle in degrees (default 360) */
  coneOuterAngle?: number;
  /** Gain outside the outer cone (default 0) */
  coneOuterGain?: number;
  /** Enable Doppler shift (default true) */
  doppler?: boolean;
  /** Apply room reverb send (default true if a room is set) */
  sendToRoom?: boolean;
}

export interface RoomConfig {
  preset: RoomPreset;
  /** Override reverb decay time in seconds (0 = use preset default) */
  reverbTime?: number;
  /** High-frequency damping coefficient 0–1 (0 = none, 1 = full) */
  hfDamping?: number;
  /** Room size scale factor (affects early reflections) */
  size?: number;
}

// ── Material occlusion filter presets (cutoff freq in Hz) ─────────

const OCCLUSION_CUTOFF: Record<OcclusionMaterial, number> = {
  none:     20000,
  glass:    8000,
  wood:     2500,
  concrete: 800,
  metal:    4000,
  soil:     300,
  water:    600,
};

// ── Room reverb decay times ────────────────────────────────────────

const ROOM_REVERB: Record<RoomPreset, { decay: number; hfDamp: number }> = {
  none:        { decay: 0,    hfDamp: 0 },
  small_room:  { decay: 0.4,  hfDamp: 0.5 },
  medium_room: { decay: 1.0,  hfDamp: 0.4 },
  large_hall:  { decay: 2.5,  hfDamp: 0.2 },
  cave:        { decay: 3.5,  hfDamp: 0.1 },
  outdoor:     { decay: 0.2,  hfDamp: 0.7 },
};

// ── Spatial Sound Source ───────────────────────────────────────────

export interface SpatialSource {
  id: number;
  panner: PannerNode;
  gainNode: GainNode;
  occlusionFilter: BiquadFilterNode;
  source: AudioBufferSourceNode | null;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  prevPosition: THREE.Vector3;
  options: SpatialSourceOptions;
  playing: boolean;
}

// ── SpatialAudioManager ────────────────────────────────────────────

export class SpatialAudioManager {
  private ctx: AudioContext;

  // Master chain: spatialSources → roomReverb → masterGain → destination
  private masterGain: GainNode;
  private roomConvolver: ConvolverNode | null = null;
  private roomSendGain: GainNode;
  private roomDryGain: GainNode;

  private listenerPos = new THREE.Vector3();
  private listenerVelocity = new THREE.Vector3();
  private listenerForward = new THREE.Vector3(0, 0, -1);
  private listenerUp = new THREE.Vector3(0, 1, 0);
  private lastValidListenerPos = new THREE.Vector3();
  private lastValidListenerForward = new THREE.Vector3(0, 0, -1);
  private lastValidListenerUp = new THREE.Vector3(0, 1, 0);

  private sources = new Map<number, SpatialSource>();
  private nextId = 1;

  private currentRoom: RoomConfig = { preset: 'none' };

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;

    this.masterGain = ctx.createGain();
    this.roomSendGain = ctx.createGain();
    this.roomDryGain  = ctx.createGain();
    this.roomDryGain.gain.value = 1;
    this.roomSendGain.gain.value = 0;

    this.masterGain.connect(this.roomDryGain);
    this.roomDryGain.connect(destination);
    this.masterGain.connect(this.roomSendGain);
    // roomSendGain → roomConvolver (set when room changes)
  }

  // ── Listener ─────────────────────────────────────────────────────

  /**
   * Call each frame with the camera/listener's current world-space data.
   * velocity is in world-units/second (used for Doppler).
   */
  updateListener(camera: THREE.Camera, velocity?: THREE.Vector3): void {
    const prevPos = this.listenerPos.clone();
    this.listenerPos.copy(camera.position);

    if (velocity) {
      this.listenerVelocity.copy(velocity);
    }

    this.listenerForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.listenerUp.set(0, 1, 0).applyQuaternion(camera.quaternion);

    const validPos = Number.isFinite(this.listenerPos.x) && Number.isFinite(this.listenerPos.y) && Number.isFinite(this.listenerPos.z);
    const validForward = Number.isFinite(this.listenerForward.x) && Number.isFinite(this.listenerForward.y) && Number.isFinite(this.listenerForward.z);
    const validUp = Number.isFinite(this.listenerUp.x) && Number.isFinite(this.listenerUp.y) && Number.isFinite(this.listenerUp.z);

    if (validPos) this.lastValidListenerPos.copy(this.listenerPos);
    else this.listenerPos.copy(this.lastValidListenerPos);

    if (validForward) this.lastValidListenerForward.copy(this.listenerForward);
    else this.listenerForward.copy(this.lastValidListenerForward);

    if (validUp) this.lastValidListenerUp.copy(this.listenerUp);
    else this.listenerUp.copy(this.lastValidListenerUp);

    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(this.listenerPos.x, t);
      l.positionY.setValueAtTime(this.listenerPos.y, t);
      l.positionZ.setValueAtTime(this.listenerPos.z, t);
      l.forwardX.setValueAtTime(this.listenerForward.x, t);
      l.forwardY.setValueAtTime(this.listenerForward.y, t);
      l.forwardZ.setValueAtTime(this.listenerForward.z, t);
      l.upX.setValueAtTime(this.listenerUp.x, t);
      l.upY.setValueAtTime(this.listenerUp.y, t);
      l.upZ.setValueAtTime(this.listenerUp.z, t);
    }
  }

  // ── Room Acoustics ────────────────────────────────────────────────

  setRoom(config: RoomConfig): void {
    this.currentRoom = config;
    this.buildRoomConvolver(config);
  }

  private buildRoomConvolver(config: RoomConfig): void {
    if (this.roomConvolver) {
      this.roomConvolver.disconnect();
    }

    const preset = ROOM_REVERB[config.preset];
    const decayTime = config.reverbTime ?? preset.decay;
    const hfDamp   = config.hfDamping  ?? preset.hfDamp;

    if (decayTime <= 0) {
      this.roomSendGain.gain.value = 0;
      return;
    }

    // Generate synthetic impulse response
    const sampleRate = this.ctx.sampleRate;
    const length     = Math.ceil(sampleRate * decayTime);
    const buffer     = this.ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const env = Math.pow(1 - i / length, 2 + hfDamp * 8);
        data[i] = (Math.random() * 2 - 1) * env;
      }
    }

    this.roomConvolver = this.ctx.createConvolver();
    this.roomConvolver.buffer = buffer;

    // HF damping via low-pass on the reverb tail
    const hfFilter = this.ctx.createBiquadFilter();
    hfFilter.type = 'lowpass';
    hfFilter.frequency.value = 20000 * (1 - hfDamp * 0.85);

    const roomOutputGain = this.ctx.createGain();
    roomOutputGain.gain.value = 0.4; // reverb wet mix

    this.roomSendGain.connect(this.roomConvolver);
    this.roomConvolver.connect(hfFilter);
    hfFilter.connect(roomOutputGain);
    roomOutputGain.connect(this.roomDryGain); // mix back into dry output

    this.roomSendGain.gain.value = 1;
  }

  // ── Source Creation ───────────────────────────────────────────────

  createSource(
    buffer: AudioBuffer,
    position: THREE.Vector3,
    options: SpatialSourceOptions = {},
    loop = false,
  ): SpatialSource {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop   = loop;

    const panner = this.ctx.createPanner();
    panner.panningModel    = 'HRTF';
    panner.distanceModel   = options.attenuation === 'linear' ? 'linear' : options.attenuation === 'exponential' ? 'exponential' : 'inverse';
    panner.refDistance     = options.refDistance  ?? 1;
    panner.maxDistance     = options.maxDistance  ?? 10000;
    panner.rolloffFactor   = options.rolloffFactor ?? 1;
    panner.coneInnerAngle  = options.coneInnerAngle ?? 360;
    panner.coneOuterAngle  = options.coneOuterAngle ?? 360;
    panner.coneOuterGain   = options.coneOuterGain  ?? 0;
    panner.positionX.value = Number.isFinite(position.x) ? position.x : 0;
    panner.positionY.value = Number.isFinite(position.y) ? position.y : 0;
    panner.positionZ.value = Number.isFinite(position.z) ? position.z : 0;

    // Occlusion filter
    const occlusionFilter = this.ctx.createBiquadFilter();
    occlusionFilter.type = 'lowpass';
    occlusionFilter.frequency.value = 20000; // fully open by default

    const gainNode = this.ctx.createGain();

    // Chain: source → occlusionFilter → panner → gainNode → masterGain
    source.connect(occlusionFilter);
    occlusionFilter.connect(panner);
    panner.connect(gainNode);
    gainNode.connect(this.masterGain);

    const id = this.nextId++;
    const spatSource: SpatialSource = {
      id,
      panner,
      gainNode,
      occlusionFilter,
      source,
      position: position.clone(),
      velocity: new THREE.Vector3(),
      prevPosition: position.clone(),
      options,
      playing: false,
    };

    source.onended = () => {
      spatSource.playing = false;
      spatSource.source = null;
      this.sources.delete(id);
    };

    source.start();
    spatSource.playing = true;
    this.sources.set(id, spatSource);

    return spatSource;
  }

  // ── Source Update ─────────────────────────────────────────────────

  /**
   * Update source position, velocity and Doppler pitch shift.
   * Call each frame for moving sources.
   */
  updateSourcePosition(src: SpatialSource, position: THREE.Vector3, delta: number): void {
    src.prevPosition.copy(src.position);
    src.position.copy(position);
    src.velocity.subVectors(src.position, src.prevPosition).divideScalar(Math.max(delta, 0.001));

    const t = this.ctx.currentTime;
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return;
    src.panner.positionX.setValueAtTime(position.x, t);
    src.panner.positionY.setValueAtTime(position.y, t);
    src.panner.positionZ.setValueAtTime(position.z, t);

    // Doppler
    if (src.options.doppler !== false && src.source) {
      const SPEED_OF_SOUND = 343;
      const toListener = this.listenerPos.clone().sub(src.position);
      const dist = toListener.length();
      if (dist > 0.01) {
        toListener.normalize();
        const srcTowardsListener = src.velocity.dot(toListener);
        const lisTowardsSource   = this.listenerVelocity.dot(toListener.negate());
        const doppler = (SPEED_OF_SOUND + lisTowardsSource) / (SPEED_OF_SOUND - srcTowardsListener);
        src.source.playbackRate.setValueAtTime(Math.max(0.1, Math.min(4, doppler)), t);
      }
    }
  }

  // ── Occlusion ─────────────────────────────────────────────────────

  /**
   * Apply occlusion material filter to a source.
   * Call when a raycast determines what material is between listener and source.
   */
  setOcclusion(src: SpatialSource, material: OcclusionMaterial, occlusionFactor = 1.0): void {
    const baseCutoff = OCCLUSION_CUTOFF[material];
    // Interpolate between open (20kHz) and fully occluded cutoff
    const cutoff = 20000 + (baseCutoff - 20000) * Math.max(0, Math.min(1, occlusionFactor));
    src.occlusionFilter.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, 0.05);
  }

  // ── Stop ─────────────────────────────────────────────────────────

  stopSource(src: SpatialSource, fadeOut = 0): void {
    if (!src.source) return;
    if (fadeOut > 0) {
      src.gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeOut);
      src.source.stop(this.ctx.currentTime + fadeOut);
    } else {
      src.source.stop();
    }
  }

  stopAll(fadeOut = 0): void {
    for (const src of this.sources.values()) {
      this.stopSource(src, fadeOut);
    }
  }

  // ── Accessors ─────────────────────────────────────────────────────

  get activeSourceCount(): number { return this.sources.size; }
  get masterVolume(): number { return this.masterGain.gain.value; }
  set masterVolume(v: number) { this.masterGain.gain.value = Math.max(0, Math.min(1, v)); }

  getCurrentRoom(): RoomConfig { return { ...this.currentRoom }; }
}
