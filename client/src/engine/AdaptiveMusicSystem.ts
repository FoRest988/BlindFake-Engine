/**
 * AdaptiveMusicSystem — State-machine driven adaptive/interactive music.
 *
 * Concepts:
 *  - MusicState: a named configuration (tracks, tempo, intensity)
 *  - MusicLayer: a looping audio buffer that can be faded in/out independently
 *  - Transition: rules for moving between states (immediate, on-beat, crossfade)
 *  - Intensity: a 0–1 parameter that drives automatic layer mixing within a state
 *
 * Usage:
 *   const ams = new AdaptiveMusicSystem(audioCtx, destinationNode);
 *   ams.defineState('explore', { bpm: 80, layers: [...] });
 *   ams.defineState('combat',  { bpm: 140, layers: [...] });
 *   ams.defineTransition('explore', 'combat', { type: 'crossfade', duration: 2 });
 *   ams.start('explore');
 *   // In combat:
 *   ams.transitionTo('combat');
 */

// ── Types ──────────────────────────────────────────────────────────

export type TransitionType = 'immediate' | 'crossfade' | 'on-beat' | 'stinger';

export interface LayerConfig {
  id: string;
  /** URL or key for the audio buffer (resolved via loadBuffer callback) */
  url: string;
  /** Volume for this layer at full intensity */
  maxVolume: number;
  /** Minimum intensity threshold at which this layer becomes audible (0–1) */
  intensityThreshold: number;
  /** Loop this layer (always true for music layers) */
  loop?: boolean;
}

export interface MusicStateConfig {
  id: string;
  /** Beats per minute — used for on-beat transitions */
  bpm: number;
  /** Audio layers that make up this state */
  layers: LayerConfig[];
  /** Starting intensity when entering this state (0–1) */
  defaultIntensity?: number;
}

export interface MusicTransition {
  fromState: string;
  toState: string;
  type: TransitionType;
  /** Crossfade duration in seconds (used for 'crossfade') */
  duration?: number;
  /** Stinger buffer URL to play over the transition */
  stingerUrl?: string;
}

// ── Active Layer ───────────────────────────────────────────────────

interface ActiveLayer {
  config: LayerConfig;
  source: AudioBufferSourceNode;
  gain: GainNode;
  targetVolume: number;
}

// ── AdaptiveMusicSystem ────────────────────────────────────────────

export class AdaptiveMusicSystem {
  private ctx: AudioContext;
  private destination: AudioNode;

  private states = new Map<string, MusicStateConfig>();
  private transitions = new Map<string, MusicTransition>();
  private buffers = new Map<string, AudioBuffer>();

  private currentStateId: string | null = null;
  private activeLayers = new Map<string, ActiveLayer>();

  private _intensity = 0.5;
  private _playing = false;
  private fadeSpeed = 2.0;  // volume units / second

  /** Called by the system when it needs to load a buffer for a URL. */
  public loadBuffer: ((url: string) => Promise<AudioBuffer>) | null = null;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.destination = destination;
  }

  // ── State / Transition Definitions ──────────────────────────────

  defineState(config: MusicStateConfig): void {
    this.states.set(config.id, config);
  }

  defineTransition(fromState: string, toState: string, transition: Omit<MusicTransition, 'fromState' | 'toState'>): void {
    const key = `${fromState}→${toState}`;
    this.transitions.set(key, { fromState, toState, ...transition });
  }

  getState(id: string): MusicStateConfig | undefined {
    return this.states.get(id);
  }

  getStateIds(): string[] {
    return Array.from(this.states.keys());
  }

  // ── Playback ─────────────────────────────────────────────────────

  async start(stateId: string): Promise<void> {
    const state = this.states.get(stateId);
    if (!state) return;

    this._playing = true;
    this.currentStateId = stateId;
    this._intensity = state.defaultIntensity ?? 0.5;

    await this.activateState(state, 0);
  }

  async transitionTo(toStateId: string): Promise<void> {
    if (!this._playing || toStateId === this.currentStateId) return;

    const toState = this.states.get(toStateId);
    if (!toState) return;

    const key = `${this.currentStateId}→${toStateId}`;
    const transition = this.transitions.get(key) ?? { type: 'crossfade' as TransitionType, duration: 1 };

    if (transition.type === 'immediate') {
      this.stopAllLayers(0);
      this.currentStateId = toStateId;
      this._intensity = toState.defaultIntensity ?? 0.5;
      await this.activateState(toState, 0);

    } else if (transition.type === 'crossfade') {
      const fadeTime = transition.duration ?? 1;
      // Fade out current layers
      for (const layer of this.activeLayers.values()) {
        layer.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeTime);
        layer.source.stop(this.ctx.currentTime + fadeTime);
      }
      this.activeLayers.clear();

      this.currentStateId = toStateId;
      this._intensity = toState.defaultIntensity ?? 0.5;
      await this.activateState(toState, fadeTime * 0.5); // start new layers halfway through

    } else {
      // Default: crossfade
      const fadeTime = transition.duration ?? 1;
      this.stopAllLayers(fadeTime);
      this.currentStateId = toStateId;
      this._intensity = toState.defaultIntensity ?? 0.5;
      await this.activateState(toState, 0);
    }
  }

  stop(fadeOut = 1): void {
    this._playing = false;
    this.stopAllLayers(fadeOut);
    this.currentStateId = null;
  }

  // ── Intensity ─────────────────────────────────────────────────────

  get intensity(): number { return this._intensity; }

  setIntensity(value: number): void {
    this._intensity = Math.max(0, Math.min(1, value));
    this.applyIntensityToLayers();
  }

  private applyIntensityToLayers(): void {
    for (const layer of this.activeLayers.values()) {
      const targetVol = this._intensity >= layer.config.intensityThreshold
        ? layer.config.maxVolume * this._intensity
        : 0;
      layer.targetVolume = targetVol;
      layer.gain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.2);
    }
  }

  // ── Per-frame update ──────────────────────────────────────────────

  /**
   * Call once per frame if using manual intensity ramps.
   * delta is the frame time in seconds.
   */
  update(_delta: number): void {
    // Placeholder for beat-sync logic, auto-intensity ramps, etc.
    // Currently intensity is set manually via setIntensity().
  }

  // ── State Activation ──────────────────────────────────────────────

  private async activateState(state: MusicStateConfig, fadeInDelay: number): Promise<void> {
    for (const layerConfig of state.layers) {
      let buffer = this.buffers.get(layerConfig.url);
      if (!buffer && this.loadBuffer) {
        try {
          buffer = await this.loadBuffer(layerConfig.url);
          this.buffers.set(layerConfig.url, buffer);
        } catch {
          continue;
        }
      }
      if (!buffer) continue;

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = layerConfig.loop !== false;

      const gain = this.ctx.createGain();
      const targetVol = this._intensity >= layerConfig.intensityThreshold
        ? layerConfig.maxVolume * this._intensity
        : 0;

      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(targetVol, this.ctx.currentTime + fadeInDelay + 0.5);

      source.connect(gain);
      gain.connect(this.destination);
      source.start(this.ctx.currentTime + fadeInDelay);

      this.activeLayers.set(layerConfig.id, { config: layerConfig, source, gain, targetVolume: targetVol });
    }
  }

  private stopAllLayers(fadeOut: number): void {
    for (const layer of this.activeLayers.values()) {
      if (fadeOut > 0) {
        layer.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeOut);
        layer.source.stop(this.ctx.currentTime + fadeOut);
      } else {
        layer.source.stop();
      }
    }
    this.activeLayers.clear();
  }

  // ── Accessors ─────────────────────────────────────────────────────

  get currentState(): string | null { return this.currentStateId; }
  get isPlaying(): boolean { return this._playing; }
  get activeLayerCount(): number { return this.activeLayers.size; }

  /** Pre-load all buffers for a state without starting playback. */
  async preloadState(stateId: string): Promise<void> {
    const state = this.states.get(stateId);
    if (!state || !this.loadBuffer) return;
    await Promise.all(
      state.layers.map(async (layer) => {
        if (!this.buffers.has(layer.url)) {
          const buf = await this.loadBuffer!(layer.url);
          this.buffers.set(layer.url, buf);
        }
      }),
    );
  }
}
