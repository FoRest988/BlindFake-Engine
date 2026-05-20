/**
 * AudioMixer — Professional-grade named bus routing system.
 *
 * Architecture:
 *   Sound source → Bus (insert FX chain) → optional Bus sends → Master Bus → destination
 *
 * Features:
 *  - Named buses with volume, pan, mute, solo
 *  - Per-bus insert effects chain (uses AudioEffectsChain)
 *  - Bus sends (route to another bus at a given send level)
 *  - Solo matrix: soloing a bus silences all others
 *  - Metering: RMS peak levels readable each frame
 *  - Snapshot import/export for full mixer state recall
 */

import { AudioEffectsChain, type EffectConfig } from './AudioEffects';

// ── Types ──────────────────────────────────────────────────────────

export interface BusOptions {
  volume?: number;       // 0–1, default 1
  pan?: number;          // -1 (left) to +1 (right), default 0
  mute?: boolean;
  solo?: boolean;
}

export interface BusSend {
  targetBusId: string;
  level: number;         // 0–1 send level
  preFader: boolean;     // true = send before volume fader
}

export interface BusSnapshot {
  id: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  sends: BusSend[];
  effects: EffectConfig[];
}

export interface MixerSnapshot {
  name: string;
  buses: BusSnapshot[];
}

// ── Bus ────────────────────────────────────────────────────────────

export class MixerBus {
  readonly id: string;
  readonly name: string;

  // Web Audio nodes
  readonly inputGain: GainNode;        // sources connect here
  readonly faderGain: GainNode;        // post-fader volume
  readonly pannerNode: StereoPannerNode;
  readonly muteGain: GainNode;         // 0 when muted
  readonly outputGain: GainNode;       // final out (connects to destination or sends)
  readonly analyser: AnalyserNode;     // for metering

  private fxChain: AudioEffectsChain;
  private _sends: BusSend[] = [];

  private _volume = 1;
  private _pan = 0;
  private _mute = false;
  private _solo = false;

  // Send nodes: targetBusId → GainNode that connects to target.inputGain
  private sendNodes = new Map<string, GainNode>();

  private _peakLevel = 0;
  private _analyserBuffer: Float32Array<ArrayBuffer>;

  constructor(
    public readonly ctx: AudioContext,
    id: string,
    name: string,
    options: BusOptions = {},
  ) {
    this.id = id;
    this.name = name;

    this.inputGain  = ctx.createGain();
    this.faderGain  = ctx.createGain();
    this.pannerNode = ctx.createStereoPanner();
    this.muteGain   = ctx.createGain();
    this.outputGain = ctx.createGain();
    this.analyser   = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this._analyserBuffer = new Float32Array(this.analyser.frequencyBinCount);

    this.fxChain = new AudioEffectsChain(ctx);

    // Routing: input → FX → fader → panner → mute → analyser → output
    this.inputGain.connect(this.fxChain.inputNode);
    this.fxChain.outputNode.connect(this.faderGain);
    this.faderGain.connect(this.pannerNode);
    this.pannerNode.connect(this.muteGain);
    this.muteGain.connect(this.analyser);
    this.analyser.connect(this.outputGain);

    this.volume = options.volume ?? 1;
    this.pan    = options.pan    ?? 0;
    this.mute   = options.mute   ?? false;
    this._solo  = options.solo   ?? false;
  }

  // ── Properties ──────────────────────────────────────────────────

  get volume(): number { return this._volume; }
  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    this.faderGain.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.02);
  }

  get pan(): number { return this._pan; }
  set pan(v: number) {
    this._pan = Math.max(-1, Math.min(1, v));
    this.pannerNode.pan.setTargetAtTime(this._pan, this.ctx.currentTime, 0.02);
  }

  get mute(): boolean { return this._mute; }
  set mute(v: boolean) {
    this._mute = v;
    this.muteGain.gain.setTargetAtTime(v ? 0 : 1, this.ctx.currentTime, 0.005);
  }

  get solo(): boolean { return this._solo; }
  set solo(v: boolean) { this._solo = v; }

  // ── Effects (Inserts) ────────────────────────────────────────────

  addInsert(config: EffectConfig): void {
    this.fxChain.addEffect(config);
  }

  removeInsert(index: number): void {
    this.fxChain.removeEffect(index);
  }

  clearInserts(): void {
    this.fxChain.clearEffects();
  }

  getEffects(): EffectConfig[] {
    return this.fxChain.getEffects();
  }

  // ── Sends ────────────────────────────────────────────────────────

  getSends(): BusSend[] { return [...this._sends]; }

  /** Register a send to another bus (does not wire audio nodes — call AudioMixer.wireSend). */
  _registerSend(send: BusSend, sendGain: GainNode): void {
    this._sends.push(send);
    this.sendNodes.set(send.targetBusId, sendGain);
  }

  _removeSend(targetBusId: string): void {
    this._sends = this._sends.filter(s => s.targetBusId !== targetBusId);
    const node = this.sendNodes.get(targetBusId);
    if (node) { node.disconnect(); this.sendNodes.delete(targetBusId); }
  }

  getSendGain(targetBusId: string): GainNode | undefined {
    return this.sendNodes.get(targetBusId);
  }

  // ── Metering ─────────────────────────────────────────────────────

  /** Call once per frame. Returns peak RMS in range 0–1. */
  updateMeter(): number {
    this.analyser.getFloatTimeDomainData(this._analyserBuffer);
    let sum = 0;
    for (const s of this._analyserBuffer) sum += s * s;
    this._peakLevel = Math.sqrt(sum / this._analyserBuffer.length);
    return this._peakLevel;
  }

  get peakLevel(): number { return this._peakLevel; }

  // ── Snapshot ─────────────────────────────────────────────────────

  toSnapshot(): BusSnapshot {
    return {
      id: this.id,
      volume: this._volume,
      pan: this._pan,
      mute: this._mute,
      solo: this._solo,
      sends: [...this._sends],
      effects: this.getEffects(),
    };
  }

  dispose(): void {
    this.inputGain.disconnect();
    this.fxChain.clearEffects();
    this.outputGain.disconnect();
    for (const sg of this.sendNodes.values()) sg.disconnect();
    this.sendNodes.clear();
  }
}

// ── AudioMixer ─────────────────────────────────────────────────────

export class AudioMixer {
  private ctx: AudioContext;
  private buses = new Map<string, MixerBus>();
  private masterBus: MixerBus;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    // Create master bus that routes to ctx.destination
    this.masterBus = new MixerBus(ctx, '__master__', 'Master');
    this.masterBus.outputGain.connect(ctx.destination);
    this.buses.set('__master__', this.masterBus);
  }

  // ── Bus Management ───────────────────────────────────────────────

  /** Create a named bus. By default it routes to the master bus. */
  createBus(id: string, name: string, options: BusOptions = {}): MixerBus {
    if (this.buses.has(id)) return this.buses.get(id)!;
    const bus = new MixerBus(this.ctx, id, name, options);
    this.buses.set(id, bus);
    // Auto-route to master
    bus.outputGain.connect(this.masterBus.inputGain);
    return bus;
  }

  getBus(id: string): MixerBus | undefined {
    return this.buses.get(id);
  }

  getMasterBus(): MixerBus { return this.masterBus; }

  removeBus(id: string): void {
    if (id === '__master__') return;
    const bus = this.buses.get(id);
    if (!bus) return;
    bus.dispose();
    this.buses.delete(id);
  }

  getBusIds(): string[] {
    return Array.from(this.buses.keys());
  }

  // ── Solo Matrix ──────────────────────────────────────────────────

  /** Solo a bus. Mutes all non-soloed buses on master. */
  setSolo(busId: string, solo: boolean): void {
    const bus = this.buses.get(busId);
    if (!bus) return;
    bus.solo = solo;
    this.applySoloMatrix();
  }

  private applySoloMatrix(): void {
    const anySolo = Array.from(this.buses.values()).some(b => b.solo);
    for (const bus of this.buses.values()) {
      if (bus.id === '__master__') continue;
      const silenced = anySolo && !bus.solo;
      bus.muteGain.gain.setTargetAtTime(silenced || bus.mute ? 0 : 1, this.ctx.currentTime, 0.005);
    }
  }

  // ── Sends ────────────────────────────────────────────────────────

  /**
   * Create an aux send from `fromBusId` to `toBusId`.
   * Returns the gain node so you can automate the send level.
   */
  addSend(fromBusId: string, toBusId: string, level = 1, preFader = false): GainNode | undefined {
    const from = this.buses.get(fromBusId);
    const to   = this.buses.get(toBusId);
    if (!from || !to) return undefined;

    const sendGain = this.ctx.createGain();
    sendGain.gain.value = level;

    const source = preFader ? from.inputGain : from.faderGain;
    source.connect(sendGain);
    sendGain.connect(to.inputGain);

    from._registerSend({ targetBusId: toBusId, level, preFader }, sendGain);
    return sendGain;
  }

  removeSend(fromBusId: string, toBusId: string): void {
    const from = this.buses.get(fromBusId);
    from?._removeSend(toBusId);
  }

  // ── Routing ──────────────────────────────────────────────────────

  /** Re-route a bus output to a different destination bus (instead of master). */
  routeBusTo(fromBusId: string, toBusId: string): void {
    const from = this.buses.get(fromBusId);
    const to   = this.buses.get(toBusId);
    if (!from || !to) return;
    from.outputGain.disconnect();
    from.outputGain.connect(to.inputGain);
  }

  /** Get a GainNode to use as a source input to a named bus. */
  getBusInput(busId: string): GainNode | undefined {
    return this.buses.get(busId)?.inputGain;
  }

  // ── Metering ─────────────────────────────────────────────────────

  /** Update all bus meters; returns a map of busId → peak level. */
  updateMeters(): Map<string, number> {
    const levels = new Map<string, number>();
    for (const [id, bus] of this.buses) {
      levels.set(id, bus.updateMeter());
    }
    return levels;
  }

  // ── Snapshots ────────────────────────────────────────────────────

  saveSnapshot(name: string): MixerSnapshot {
    return {
      name,
      buses: Array.from(this.buses.values()).map(b => b.toSnapshot()),
    };
  }

  recallSnapshot(snapshot: MixerSnapshot, transitionTime = 0.1): void {
    for (const busSnap of snapshot.buses) {
      let bus = this.buses.get(busSnap.id);
      if (!bus && busSnap.id !== '__master__') {
        bus = this.createBus(busSnap.id, busSnap.id);
      }
      if (!bus) continue;
      bus.faderGain.gain.linearRampToValueAtTime(busSnap.volume, this.ctx.currentTime + transitionTime);
      bus.pan = busSnap.pan;
      bus.mute = busSnap.mute;
      bus.solo = busSnap.solo;
    }
  }

  dispose(): void {
    for (const bus of this.buses.values()) bus.dispose();
    this.buses.clear();
  }
}
