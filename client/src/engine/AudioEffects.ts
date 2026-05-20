/**
 * AudioEffects — Advanced audio processing chain for the AudioManager.
 * Features:
 * - Audio effect presets (reverb, delay, EQ, distortion, chorus)
 * - Audio zones with spatial triggers
 * - Audio snapshots for quick transitions
 * - Music layering system with crossfade
 */

import * as THREE from 'three';

// ─── Effect Definitions ──────────────────────────────

export type EffectType = 'reverb' | 'delay' | 'eq' | 'distortion' | 'compressor' | 'filter';

export interface ReverbConfig {
  type: 'reverb';
  duration: number;  // seconds
  decay: number;     // 0-1
  wet: number;       // mix 0-1
}

export interface DelayConfig {
  type: 'delay';
  time: number;      // seconds
  feedback: number;  // 0-1
  wet: number;
}

export interface EQConfig {
  type: 'eq';
  low: number;       // dB gain for low band
  mid: number;       // dB gain for mid band
  high: number;      // dB gain for high band
}

export interface DistortionConfig {
  type: 'distortion';
  amount: number;    // 0-100
  wet: number;
}

export interface CompressorConfig {
  type: 'compressor';
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}

export interface FilterConfig {
  type: 'filter';
  filterType: BiquadFilterType;
  frequency: number;
  Q: number;
  gain: number;
}

export interface ChorusConfig {
  type: 'chorus';
  /** Modulation rate in Hz (0.1–10) */
  rate: number;
  /** Modulation depth in ms (1–20) */
  depth: number;
  /** Delay centre point in ms (5–30) */
  delay: number;
  wet: number;
}

export interface LimiterConfig {
  type: 'limiter';
  /** Ceiling in dBFS (e.g. -0.3) */
  ceiling: number;
  /** Lookahead / release in seconds */
  release: number;
}

export interface PhaserConfig {
  type: 'phaser';
  /** LFO rate in Hz */
  rate: number;
  /** Depth: 0–1 */
  depth: number;
  /** Number of all-pass stages (2, 4, 6, 8) */
  stages: number;
  wet: number;
}

export type EffectConfig =
  | ReverbConfig
  | DelayConfig
  | EQConfig
  | DistortionConfig
  | CompressorConfig
  | FilterConfig
  | ChorusConfig
  | LimiterConfig
  | PhaserConfig;

// ─── Audio Effects Chain ─────────────────────────────

export class AudioEffectsChain {
  private ctx: AudioContext;
  private input: GainNode;
  private output: GainNode;
  private effects: Array<{ config: EffectConfig; nodes: AudioNode[] }> = [];

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output);
  }

  get inputNode(): GainNode { return this.input; }
  get outputNode(): GainNode { return this.output; }

  /** Return a copy of the current effect config list (for snapshots). */
  getEffects(): EffectConfig[] {
    return this.effects.map(e => ({ ...e.config }));
  }

  addEffect(config: EffectConfig): void {
    const nodes = this.createEffectNodes(config);
    this.effects.push({ config, nodes });
    this.rebuildChain();
  }

  removeEffect(index: number): void {
    const removed = this.effects.splice(index, 1);
    for (const { nodes } of removed) {
      for (const n of nodes) n.disconnect();
    }
    this.rebuildChain();
  }

  clearEffects(): void {
    for (const { nodes } of this.effects) {
      for (const n of nodes) n.disconnect();
    }
    this.effects = [];
    this.input.disconnect();
    this.input.connect(this.output);
  }

  private rebuildChain(): void {
    this.input.disconnect();
    let prev: AudioNode = this.input;

    for (const { nodes } of this.effects) {
      prev.connect(nodes[0]);
      prev = nodes[nodes.length - 1];
    }

    prev.connect(this.output);
  }

  private createEffectNodes(config: EffectConfig): AudioNode[] {
    switch (config.type) {
      case 'reverb':      return this.createReverb(config);
      case 'delay':       return this.createDelay(config);
      case 'eq':          return this.createEQ(config);
      case 'distortion':  return this.createDistortion(config);
      case 'compressor':  return this.createCompressor(config);
      case 'filter':      return this.createFilter(config);
      case 'chorus':      return this.createChorus(config);
      case 'limiter':     return this.createLimiter(config);
      case 'phaser':      return this.createPhaser(config);
    }
  }

  private createReverb(config: ReverbConfig): AudioNode[] {
    const convolver = this.ctx.createConvolver();
    const wet = this.ctx.createGain();
    const dry = this.ctx.createGain();
    const merger = this.ctx.createGain();

    // Generate impulse response
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * config.duration;
    const impulse = this.ctx.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, config.decay * 10);
      }
    }
    convolver.buffer = impulse;

    wet.gain.value = config.wet;
    dry.gain.value = 1 - config.wet;

    // Routing: input → dry → merger, input → convolver → wet → merger
    // We'll use a pass-through gain as "input" that splits to both
    const splitInput = this.ctx.createGain();
    splitInput.connect(dry);
    splitInput.connect(convolver);
    convolver.connect(wet);
    dry.connect(merger);
    wet.connect(merger);

    return [splitInput, merger];
  }

  private createDelay(config: DelayConfig): AudioNode[] {
    const delay = this.ctx.createDelay(5);
    delay.delayTime.value = config.time;

    const feedback = this.ctx.createGain();
    feedback.gain.value = Math.min(config.feedback, 0.95); // prevent runaway

    const wet = this.ctx.createGain();
    wet.gain.value = config.wet;

    const dry = this.ctx.createGain();
    dry.gain.value = 1 - config.wet;

    const merger = this.ctx.createGain();
    const splitInput = this.ctx.createGain();

    splitInput.connect(dry);
    splitInput.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    dry.connect(merger);
    wet.connect(merger);

    return [splitInput, merger];
  }

  private createEQ(config: EQConfig): AudioNode[] {
    const low = this.ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 320;
    low.gain.value = config.low;

    const mid = this.ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1000;
    mid.Q.value = 0.5;
    mid.gain.value = config.mid;

    const high = this.ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 3200;
    high.gain.value = config.high;

    low.connect(mid);
    mid.connect(high);

    return [low, high];
  }

  private createDistortion(config: DistortionConfig): AudioNode[] {
    const shaper = this.ctx.createWaveShaper();
    const amount = Math.min(config.amount, 100);
    const samples = 44100;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
    }
    shaper.curve = curve;
    shaper.oversample = '4x';

    const wet = this.ctx.createGain();
    wet.gain.value = config.wet;
    const dry = this.ctx.createGain();
    dry.gain.value = 1 - config.wet;
    const merger = this.ctx.createGain();
    const splitInput = this.ctx.createGain();

    splitInput.connect(dry);
    splitInput.connect(shaper);
    shaper.connect(wet);
    dry.connect(merger);
    wet.connect(merger);

    return [splitInput, merger];
  }

  private createCompressor(config: CompressorConfig): AudioNode[] {
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = config.threshold;
    comp.knee.value = config.knee;
    comp.ratio.value = config.ratio;
    comp.attack.value = config.attack;
    comp.release.value = config.release;
    return [comp];
  }

  private createFilter(config: FilterConfig): AudioNode[] {
    const filter = this.ctx.createBiquadFilter();
    filter.type = config.filterType;
    filter.frequency.value = config.frequency;
    filter.Q.value = config.Q;
    filter.gain.value = config.gain;
    return [filter];
  }

  private createChorus(config: ChorusConfig): AudioNode[] {
    // Chorus = dry signal + modulated delay copies
    const splitInput = this.ctx.createGain();
    const merger     = this.ctx.createGain();
    const dry        = this.ctx.createGain();
    dry.gain.value   = 1 - config.wet;

    // Two voices slightly detuned
    const voices = 2;
    for (let v = 0; v < voices; v++) {
      const delay   = this.ctx.createDelay(0.1);
      const centreMs = config.delay / 1000;
      delay.delayTime.value = centreMs;

      // LFO to modulate delay time
      const lfo      = this.ctx.createOscillator();
      const lfoGain  = this.ctx.createGain();
      lfo.type       = 'sine';
      lfo.frequency.value  = config.rate * (1 + v * 0.15);
      lfoGain.gain.value   = (config.depth / 1000) * 0.5;
      lfo.connect(lfoGain);
      lfoGain.connect(delay.delayTime);
      lfo.start();

      const voiceGain = this.ctx.createGain();
      voiceGain.gain.value = config.wet / voices;

      splitInput.connect(delay);
      delay.connect(voiceGain);
      voiceGain.connect(merger);
    }

    splitInput.connect(dry);
    dry.connect(merger);

    return [splitInput, merger];
  }

  private createLimiter(config: LimiterConfig): AudioNode[] {
    // Brick-wall limiter implemented as a fast compressor
    const comp = this.ctx.createDynamicsCompressor();
    const ceilingLinear = Math.pow(10, config.ceiling / 20);
    comp.threshold.value = config.ceiling;
    comp.knee.value      = 0;
    comp.ratio.value     = 20;   // near-infinite ratio
    comp.attack.value    = 0.001;
    comp.release.value   = Math.max(0.01, config.release);

    // Output gain to honour ceiling
    const outGain = this.ctx.createGain();
    outGain.gain.value = ceilingLinear;

    comp.connect(outGain);
    return [comp, outGain];
  }

  private createPhaser(config: PhaserConfig): AudioNode[] {
    // N all-pass stages modulated by a shared LFO
    const splitInput = this.ctx.createGain();
    const merger     = this.ctx.createGain();
    const wet        = this.ctx.createGain();
    const dry        = this.ctx.createGain();
    wet.gain.value   = config.wet;
    dry.gain.value   = 1 - config.wet;

    const stages = Math.max(2, Math.min(8, config.stages));
    const allpasses: BiquadFilterNode[] = [];

    for (let i = 0; i < stages; i++) {
      const ap = this.ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = 1000 * (i + 1);
      ap.Q.value = 0.1;
      allpasses.push(ap);
    }

    // Chain all-pass filters
    for (let i = 0; i < allpasses.length - 1; i++) {
      allpasses[i].connect(allpasses[i + 1]);
    }

    // LFO modulates all filter frequencies
    const lfo      = this.ctx.createOscillator();
    const lfoGain  = this.ctx.createGain();
    lfo.type       = 'sine';
    lfo.frequency.value = config.rate;
    lfoGain.gain.value  = 800 * config.depth; // sweep range

    lfo.connect(lfoGain);
    for (const ap of allpasses) lfoGain.connect(ap.frequency);
    lfo.start();

    splitInput.connect(dry);
    dry.connect(merger);
    splitInput.connect(allpasses[0]);
    allpasses[allpasses.length - 1].connect(wet);
    wet.connect(merger);

    return [splitInput, merger];
  }

  dispose(): void {
    this.clearEffects();
    this.input.disconnect();
    this.output.disconnect();
  }
}

// ─── Effect Presets ──────────────────────────────────

export const AUDIO_PRESETS: Record<string, EffectConfig[]> = {
  'Cathedral': [
    { type: 'reverb', duration: 4, decay: 0.6, wet: 0.5 },
    { type: 'eq', low: 2, mid: -1, high: -3 },
  ],
  'Cave': [
    { type: 'reverb', duration: 2.5, decay: 0.8, wet: 0.6 },
    { type: 'filter', filterType: 'lowpass', frequency: 2000, Q: 1, gain: 0 },
  ],
  'Outdoor': [
    { type: 'reverb', duration: 0.5, decay: 0.2, wet: 0.15 },
    { type: 'eq', low: -2, mid: 0, high: 3 },
  ],
  'Underwater': [
    { type: 'filter', filterType: 'lowpass', frequency: 500, Q: 2, gain: 0 },
    { type: 'reverb', duration: 3, decay: 0.5, wet: 0.7 },
  ],
  'Radio': [
    { type: 'filter', filterType: 'bandpass', frequency: 2000, Q: 5, gain: 0 },
    { type: 'distortion', amount: 15, wet: 0.3 },
  ],
  'Horror': [
    { type: 'reverb', duration: 5, decay: 0.7, wet: 0.4 },
    { type: 'eq', low: 6, mid: -4, high: -6 },
    { type: 'filter', filterType: 'lowpass', frequency: 1500, Q: 0.5, gain: 0 },
  ],
};

// ─── Audio Zone System ───────────────────────────────

export interface AudioZoneConfig {
  id: string;
  name: string;
  center: THREE.Vector3;
  radius: number;
  /** Inner radius where effect is at full strength */
  innerRadius: number;
  /** Sound to play when inside the zone */
  soundUrl?: string;
  /** Volume of the zone audio */
  volume: number;
  /** Loop the zone audio */
  loop: boolean;
  /** Effect preset to apply */
  preset?: string;
}

export class AudioZoneSystem {
  private zones: AudioZoneConfig[] = [];
  private activeZones = new Set<string>();
  private onEnterCallbacks = new Map<string, () => void>();
  private onExitCallbacks = new Map<string, () => void>();

  addZone(config: AudioZoneConfig): void {
    this.zones.push(config);
  }

  removeZone(id: string): void {
    const idx = this.zones.findIndex(z => z.id === id);
    if (idx !== -1) this.zones.splice(idx, 1);
    this.activeZones.delete(id);
  }

  onEnter(zoneId: string, cb: () => void): void { this.onEnterCallbacks.set(zoneId, cb); }
  onExit(zoneId: string, cb: () => void): void { this.onExitCallbacks.set(zoneId, cb); }

  /** Call each frame with listener position */
  update(listenerPos: THREE.Vector3): Array<{ zone: AudioZoneConfig; strength: number }> {
    const active: Array<{ zone: AudioZoneConfig; strength: number }> = [];

    for (const zone of this.zones) {
      const dist = listenerPos.distanceTo(zone.center);
      const wasActive = this.activeZones.has(zone.id);

      if (dist <= zone.radius) {
        // Calculate blend strength based on inner/outer radius
        let strength = 1;
        if (dist > zone.innerRadius) {
          strength = 1 - (dist - zone.innerRadius) / (zone.radius - zone.innerRadius);
        }

        active.push({ zone, strength });

        if (!wasActive) {
          this.activeZones.add(zone.id);
          this.onEnterCallbacks.get(zone.id)?.();
        }
      } else if (wasActive) {
        this.activeZones.delete(zone.id);
        this.onExitCallbacks.get(zone.id)?.();
      }
    }

    return active;
  }

  getZones(): ReadonlyArray<AudioZoneConfig> { return this.zones; }
  isInZone(id: string): boolean { return this.activeZones.has(id); }
}

// ─── Audio Snapshot System ───────────────────────────

export interface AudioSnapshot {
  name: string;
  groupVolumes: Record<string, number>;
  effects: EffectConfig[];
  transitionTime: number; // seconds to blend to this snapshot
}

export class AudioSnapshotManager {
  private snapshots = new Map<string, AudioSnapshot>();

  define(snapshot: AudioSnapshot): void {
    this.snapshots.set(snapshot.name, snapshot);
  }

  get(name: string): AudioSnapshot | undefined {
    return this.snapshots.get(name);
  }

  getAll(): string[] {
    return [...this.snapshots.keys()];
  }

  remove(name: string): void {
    this.snapshots.delete(name);
  }
}

// ─── Music Layer System ──────────────────────────────

export interface MusicLayer {
  id: string;
  name: string;
  url: string;
  volume: number;
  /** Whether this layer is currently audible */
  active: boolean;
}

export interface MusicLayerSet {
  name: string;
  bpm: number;
  layers: MusicLayer[];
}

/**
 * Manages multiple synchronized music layers that can be
 * faded in/out independently (e.g., combat drums, exploration melody).
 */
export class MusicLayerManager {
  private layerSets = new Map<string, MusicLayerSet>();
  private activeLayers = new Map<string, { volume: number; targetVolume: number }>();
  private fadeSpeed = 2; // volume units per second

  addLayerSet(set: MusicLayerSet): void {
    this.layerSets.set(set.name, set);
  }

  removeLayerSet(name: string): void {
    this.layerSets.delete(name);
  }

  /** Enable a specific layer — fades in over time */
  enableLayer(layerId: string, targetVolume = 1): void {
    const existing = this.activeLayers.get(layerId);
    if (existing) {
      existing.targetVolume = targetVolume;
    } else {
      this.activeLayers.set(layerId, { volume: 0, targetVolume });
    }
  }

  /** Disable a specific layer — fades out */
  disableLayer(layerId: string): void {
    const existing = this.activeLayers.get(layerId);
    if (existing) existing.targetVolume = 0;
  }

  /** Call each frame to update fade transitions */
  update(delta: number): Map<string, number> {
    const volumes = new Map<string, number>();

    for (const [id, state] of this.activeLayers) {
      if (state.volume < state.targetVolume) {
        state.volume = Math.min(state.volume + this.fadeSpeed * delta, state.targetVolume);
      } else if (state.volume > state.targetVolume) {
        state.volume = Math.max(state.volume - this.fadeSpeed * delta, state.targetVolume);
      }

      volumes.set(id, state.volume);

      // Remove fully faded out layers
      if (state.volume <= 0 && state.targetVolume <= 0) {
        this.activeLayers.delete(id);
      }
    }

    return volumes;
  }

  setFadeSpeed(speed: number): void {
    this.fadeSpeed = speed;
  }

  getLayerSets(): string[] {
    return [...this.layerSets.keys()];
  }

  getLayerSet(name: string): MusicLayerSet | undefined {
    return this.layerSets.get(name);
  }
}
