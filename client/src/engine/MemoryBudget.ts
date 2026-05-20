/**
 * MemoryBudget — tracks engine asset memory usage and enforces soft limits.
 * Integrates with AssetManager to trigger LRU eviction when a budget is exceeded.
 *
 * Usage:
 *   const budget = new MemoryBudget({ maxTextureMB: 256, maxGeometryMB: 128 });
 *   budget.onEvictionNeeded((cat) => assetManager.evictLRU(cat));
 *   budget.trackTexture(bytes);
 */
import type * as THREE from 'three';

export interface MemoryBudgetConfig {
  /** Max GPU texture memory in MB (default: 256) */
  maxTextureMB: number;
  /** Max geometry / vertex buffer memory in MB (default: 128) */
  maxGeometryMB: number;
  /** Max decoded audio buffer memory in MB (default: 64) */
  maxAudioMB: number;
}

export interface MemorySnapshot {
  texturesMB: number;
  geometryMB: number;
  audioMB: number;
  totalMB: number;
  textureBudgetPct: number;
  geometryBudgetPct: number;
  audioBudgetPct: number;
  anyExceeded: boolean;
}

export type EvictionCategory = 'texture' | 'geometry' | 'audio';
type EvictionCallback = (category: EvictionCategory) => void;

export class MemoryBudget {
  private textureBytes = 0;
  private geometryBytes = 0;
  private audioBytes = 0;

  private config: MemoryBudgetConfig;
  private evictionCallbacks: EvictionCallback[] = [];

  constructor(config: Partial<MemoryBudgetConfig> = {}) {
    this.config = {
      maxTextureMB:  config.maxTextureMB  ?? 256,
      maxGeometryMB: config.maxGeometryMB ?? 128,
      maxAudioMB:    config.maxAudioMB    ?? 64,
    };
  }

  // ── Accounting ────────────────────────────────────────────────────

  trackTexture(bytes: number): void {
    this.textureBytes += bytes;
    if (this.isTextureBudgetExceeded()) this.notify('texture');
  }
  untrackTexture(bytes: number): void {
    this.textureBytes = Math.max(0, this.textureBytes - bytes);
  }

  trackGeometry(bytes: number): void {
    this.geometryBytes += bytes;
    if (this.isGeometryBudgetExceeded()) this.notify('geometry');
  }
  untrackGeometry(bytes: number): void {
    this.geometryBytes = Math.max(0, this.geometryBytes - bytes);
  }

  trackAudio(bytes: number): void {
    this.audioBytes += bytes;
    if (this.isAudioBudgetExceeded()) this.notify('audio');
  }
  untrackAudio(bytes: number): void {
    this.audioBytes = Math.max(0, this.audioBytes - bytes);
  }

  // ── Budget checks ─────────────────────────────────────────────────

  isTextureBudgetExceeded(): boolean {
    return this.textureBytes > this.config.maxTextureMB * 1_048_576;
  }
  isGeometryBudgetExceeded(): boolean {
    return this.geometryBytes > this.config.maxGeometryMB * 1_048_576;
  }
  isAudioBudgetExceeded(): boolean {
    return this.audioBytes > this.config.maxAudioMB * 1_048_576;
  }

  // ── Stats ─────────────────────────────────────────────────────────

  getSnapshot(): MemorySnapshot {
    const MB = 1_048_576;
    const texturesMB  = this.textureBytes  / MB;
    const geometryMB  = this.geometryBytes / MB;
    const audioMB     = this.audioBytes    / MB;
    return {
      texturesMB,
      geometryMB,
      audioMB,
      totalMB: texturesMB + geometryMB + audioMB,
      textureBudgetPct:  texturesMB  / this.config.maxTextureMB  * 100,
      geometryBudgetPct: geometryMB  / this.config.maxGeometryMB * 100,
      audioBudgetPct:    audioMB     / this.config.maxAudioMB    * 100,
      anyExceeded: this.isTextureBudgetExceeded() || this.isGeometryBudgetExceeded() || this.isAudioBudgetExceeded(),
    };
  }

  // ── Config ────────────────────────────────────────────────────────

  getBudget(): Readonly<MemoryBudgetConfig> { return this.config; }

  setBudget(config: Partial<MemoryBudgetConfig>): void {
    Object.assign(this.config, config);
  }

  // ── Eviction callbacks ────────────────────────────────────────────

  onEvictionNeeded(callback: EvictionCallback): void {
    this.evictionCallbacks.push(callback);
  }

  private notify(category: EvictionCategory): void {
    for (const cb of this.evictionCallbacks) cb(category);
  }

  // ── Static estimators ─────────────────────────────────────────────

  /**
   * Estimate GPU texture memory for a THREE.Texture.
   * Assumes RGBA8 (4 bytes/pixel) and no mipmaps. Multiply by ~1.33 for mips.
   */
  static estimateTextureBytes(texture: THREE.Texture): number {
    const src = texture.source?.data;
    if (src && typeof (src as any).width === 'number' && typeof (src as any).height === 'number') {
      return (src as { width: number; height: number }).width
           * (src as { width: number; height: number }).height
           * 4;
    }
    return 512 * 512 * 4; // conservative fallback: ~1 MB
  }

  /**
   * Estimate CPU geometry memory for a THREE.BufferGeometry.
   */
  static estimateGeometryBytes(geometry: THREE.BufferGeometry): number {
    let bytes = 0;
    for (const attr of Object.values(geometry.attributes)) {
      bytes += (attr as THREE.BufferAttribute).array.byteLength;
    }
    if (geometry.index) bytes += geometry.index.array.byteLength;
    return bytes;
  }

  /**
   * Estimate memory for a Web Audio AudioBuffer.
   */
  static estimateAudioBytes(buffer: AudioBuffer): number {
    // Float32 samples × channels × sample count
    return buffer.numberOfChannels * buffer.length * 4;
  }
}
