import * as THREE from 'three';

// ─── Audio Preset Types ────────────────────────────────────────────
export interface SoundOptions {
  volume?: number;
  loop?: boolean;
  playbackRate?: number;
  /** 3D spatial sound — provide a position or THREE.Object3D */
  spatial?: boolean;
  /** Reference distance for spatial falloff (default 1) */
  refDistance?: number;
  /** Rolloff factor for spatial falloff (default 1) */
  rolloffFactor?: number;
  /** Max distance for spatial falloff (default 10000) */
  maxDistance?: number;
  /** Fade in duration in seconds */
  fadeIn?: number;
  /** Group name for managing categories (e.g., 'sfx', 'music', 'ambient', 'ui') */
  group?: string;
}

export interface AudioGroup {
  volume: number;
  muted: boolean;
  sounds: Set<SoundHandle>;
}

export interface SoundHandle {
  id: number;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode;
  pannerNode: PannerNode | null;
  buffer: AudioBuffer;
  options: SoundOptions;
  playing: boolean;
  startTime: number;
}

interface MusicTrack {
  url: string;
  buffer: AudioBuffer | null;
  handle: SoundHandle | null;
}

// ─── AudioManager ──────────────────────────────────────────────────
export class AudioManager {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private compressor: DynamicsCompressorNode;

  // Audio groups (sfx, music, ambient, ui, voice)
  private groups = new Map<string, AudioGroup>();

  // Cache loaded buffers by URL
  private bufferCache = new Map<string, AudioBuffer>();

  // Active sounds
  private activeSounds = new Map<number, SoundHandle>();
  private nextSoundId = 1;

  // THREE.js audio listener for spatial audio
  private listener: THREE.AudioListener;

  // Music system
  private currentMusic: MusicTrack | null = null;
  private musicQueue: string[] = [];
  private musicShuffle = false;

  // Master volume
  private _masterVolume = 1;
  private _lastValidListenerPos = new THREE.Vector3();
  private _lastValidListenerForward = new THREE.Vector3(0, 0, -1);
  private _lastValidListenerUp = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.ctx = new AudioContext();

    // Master gain → compressor → output
    this.masterGain = this.ctx.createGain();
    this.compressor = this.ctx.createDynamicsCompressor();
    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);

    // THREE.js listener for spatial sound integration
    this.listener = new THREE.AudioListener();

    // Default groups
    this.createGroup('master', 1);
    this.createGroup('sfx', 0.8);
    this.createGroup('music', 0.5);
    this.createGroup('ambient', 0.6);
    this.createGroup('ui', 0.7);
    this.createGroup('voice', 1.0);

    // Resume context on user interaction (browser policy)
    const resume = () => {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => { /* already running or blocked */ });
      }
      document.removeEventListener('click', resume);
      document.removeEventListener('keydown', resume);
    };
    document.addEventListener('click', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  }

  // ── Loading ──────────────────────────────────────────────────────

  /** Load an audio file and cache it */
  async load(url: string): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(url);
    if (cached) return cached;

    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.bufferCache.set(url, audioBuffer);
    return audioBuffer;
  }

  /** Preload multiple audio files */
  async preloadAll(urls: string[]): Promise<void> {
    await Promise.all(urls.map((url) => this.load(url)));
  }

  // ── Playback ─────────────────────────────────────────────────────

  /** Play a sound effect. Returns a handle for controlling it. */
  async play(url: string, options: SoundOptions = {}): Promise<SoundHandle> {
    const buffer = await this.load(url);
    return this.playBuffer(buffer, options);
  }

  /** Play a pre-loaded AudioBuffer */
  playBuffer(buffer: AudioBuffer, options: SoundOptions = {}): SoundHandle {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = options.loop ?? false;
    source.playbackRate.value = options.playbackRate ?? 1;

    // Gain node for this sound
    const gainNode = this.ctx.createGain();
    const groupName = options.group ?? 'sfx';
    const group = this.getOrCreateGroup(groupName);
    const baseVolume = (options.volume ?? 1) * group.volume * this._masterVolume;

    // Fade in
    if (options.fadeIn && options.fadeIn > 0) {
      gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(baseVolume, this.ctx.currentTime + options.fadeIn);
    } else {
      gainNode.gain.value = baseVolume;
    }

    // Spatial (3D) audio
    let pannerNode: PannerNode | null = null;
    if (options.spatial) {
      pannerNode = this.ctx.createPanner();
      pannerNode.panningModel = 'HRTF';
      pannerNode.distanceModel = 'inverse';
      pannerNode.refDistance = options.refDistance ?? 1;
      pannerNode.rolloffFactor = options.rolloffFactor ?? 1;
      pannerNode.maxDistance = options.maxDistance ?? 10000;

      source.connect(gainNode);
      gainNode.connect(pannerNode);
      pannerNode.connect(this.masterGain);
    } else {
      source.connect(gainNode);
      gainNode.connect(this.masterGain);
    }

    const id = this.nextSoundId++;
    const handle: SoundHandle = {
      id,
      source,
      gainNode,
      pannerNode,
      buffer,
      options,
      playing: true,
      startTime: this.ctx.currentTime,
    };

    source.onended = () => {
      handle.playing = false;
      handle.source = null;
      this.activeSounds.delete(id);
      group.sounds.delete(handle);
    };

    source.start(0);
    this.activeSounds.set(id, handle);
    group.sounds.add(handle);

    return handle;
  }

  /** Stop a specific sound with optional fade out */
  stop(handle: SoundHandle, fadeOut = 0): void {
    if (!handle.playing || !handle.source) return;

    if (fadeOut > 0) {
      handle.gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeOut);
      handle.source.stop(this.ctx.currentTime + fadeOut);
    } else {
      handle.source.stop();
    }
  }

  /** Pause a sound */
  pause(handle: SoundHandle): void {
    if (!handle.playing) return;
    handle.source?.stop();
    handle.playing = false;
  }

  /** Set 3D position for a spatial sound */
  setSoundPosition(handle: SoundHandle, x: number, y: number, z: number): void {
    if (handle.pannerNode) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      handle.pannerNode.positionX.value = x;
      handle.pannerNode.positionY.value = y;
      handle.pannerNode.positionZ.value = z;
    }
  }

  /** Update listener position (call each frame with camera position) */
  updateListener(camera: THREE.Camera): void {
    const pos = camera.position;
    const orientation = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

    const safePos = (Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z))
      ? pos
      : this._lastValidListenerPos;
    const safeForward = (Number.isFinite(orientation.x) && Number.isFinite(orientation.y) && Number.isFinite(orientation.z))
      ? orientation
      : this._lastValidListenerForward;
    const safeUp = (Number.isFinite(up.x) && Number.isFinite(up.y) && Number.isFinite(up.z))
      ? up
      : this._lastValidListenerUp;

    if (safePos === pos) this._lastValidListenerPos.copy(pos);
    if (safeForward === orientation) this._lastValidListenerForward.copy(orientation);
    if (safeUp === up) this._lastValidListenerUp.copy(up);

    if (this.ctx.listener.positionX) {
      this.ctx.listener.positionX.value = safePos.x;
      this.ctx.listener.positionY.value = safePos.y;
      this.ctx.listener.positionZ.value = safePos.z;
      this.ctx.listener.forwardX.value = safeForward.x;
      this.ctx.listener.forwardY.value = safeForward.y;
      this.ctx.listener.forwardZ.value = safeForward.z;
      this.ctx.listener.upX.value = safeUp.x;
      this.ctx.listener.upY.value = safeUp.y;
      this.ctx.listener.upZ.value = safeUp.z;
    }
  }

  // ── Music System ─────────────────────────────────────────────────

  /** Play background music with crossfade */
  async playMusic(url: string, fadeIn = 1, fadeOut = 1): Promise<void> {
    // Fade out current music
    if (this.currentMusic?.handle) {
      this.stop(this.currentMusic.handle, fadeOut);
    }

    const buffer = await this.load(url);
    const handle = this.playBuffer(buffer, {
      volume: 1,
      loop: true,
      fadeIn,
      group: 'music',
    });

    this.currentMusic = { url, buffer, handle };
  }

  /** Stop current music */
  stopMusic(fadeOut = 1): void {
    if (this.currentMusic?.handle) {
      this.stop(this.currentMusic.handle, fadeOut);
      this.currentMusic = null;
    }
  }

  /** Set music playlist and start playing */
  async setPlaylist(urls: string[], shuffle = false): Promise<void> {
    this.musicQueue = [...urls];
    this.musicShuffle = shuffle;
    if (shuffle) {
      // Fisher-Yates shuffle
      for (let i = this.musicQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.musicQueue[i], this.musicQueue[j]] = [this.musicQueue[j], this.musicQueue[i]];
      }
    }
    if (this.musicQueue.length > 0) {
      await this.playMusic(this.musicQueue[0]);
    }
  }

  /** Advance to next track in playlist */
  async nextTrack(): Promise<void> {
    if (this.musicQueue.length === 0) return;
    const current = this.musicQueue.shift()!;
    this.musicQueue.push(current); // loop back
    if (this.musicQueue.length > 0) {
      await this.playMusic(this.musicQueue[0]);
    }
  }

  // ── Groups & Volume ─────────────────────────────────────────────

  createGroup(name: string, volume = 1): AudioGroup {
    const group: AudioGroup = { volume, muted: false, sounds: new Set() };
    this.groups.set(name, group);
    return group;
  }

  getOrCreateGroup(name: string): AudioGroup {
    let group = this.groups.get(name);
    if (!group) group = this.createGroup(name);
    return group;
  }

  setGroupVolume(name: string, volume: number): void {
    const group = this.groups.get(name);
    if (!group) return;
    group.volume = Math.max(0, Math.min(1, volume));
    // Update all active sounds in this group
    for (const handle of group.sounds) {
      if (handle.playing) {
        const base = (handle.options.volume ?? 1) * group.volume * this._masterVolume;
        handle.gainNode.gain.value = group.muted ? 0 : base;
      }
    }
  }

  muteGroup(name: string, muted: boolean): void {
    const group = this.groups.get(name);
    if (!group) return;
    group.muted = muted;
    for (const handle of group.sounds) {
      if (handle.playing) {
        handle.gainNode.gain.value = muted ? 0 : (handle.options.volume ?? 1) * group.volume * this._masterVolume;
      }
    }
  }

  get masterVolume(): number {
    return this._masterVolume;
  }

  set masterVolume(vol: number) {
    this._masterVolume = Math.max(0, Math.min(1, vol));
    this.masterGain.gain.value = this._masterVolume;
  }

  // ── Utilities ───────────────────────────────────────────────────

  /** Play a one-shot sound (fire and forget) */
  async oneShot(url: string, volume = 1, group = 'sfx'): Promise<void> {
    await this.play(url, { volume, group });
  }

  /** Play a random sound from a list (variation) */
  async playRandom(urls: string[], options: SoundOptions = {}): Promise<SoundHandle> {
    const url = urls[Math.floor(Math.random() * urls.length)];
    return this.play(url, options);
  }

  /** Stop all sounds */
  stopAll(fadeOut = 0): void {
    for (const handle of this.activeSounds.values()) {
      this.stop(handle, fadeOut);
    }
  }

  /** Get the THREE.js AudioListener for attaching to camera */
  getListener(): THREE.AudioListener {
    return this.listener;
  }

  /** Number of currently playing sounds */
  get activeSoundCount(): number {
    return this.activeSounds.size;
  }

  dispose(): void {
    this.stopAll();
    this.bufferCache.clear();
    this.ctx.close();
  }

  // ── Audio Zones ─────────────────────────────────────────────────

  private audioZones: AudioZone[] = [];
  private zoneHelpers: Map<string, THREE.LineSegments> = new Map();
  private showZoneHelpers = false;
  private zoneScene: THREE.Scene | null = null;

  setZoneScene(scene: THREE.Scene): void {
    this.zoneScene = scene;
  }

  addAudioZone(zone: Omit<AudioZone, '_handle' | 'id'>): AudioZone {
    const z: AudioZone = {
      ...zone,
      id: 'azone_' + Math.random().toString(36).substring(2, 8),
      _handle: null,
    };
    this.audioZones.push(z);
    if (this.showZoneHelpers && this.zoneScene) this.createZoneHelper(z);
    return z;
  }

  removeAudioZone(id: string): void {
    const idx = this.audioZones.findIndex(z => z.id === id);
    if (idx < 0) return;
    const z = this.audioZones[idx];
    if (z._handle) this.stop(z._handle, 0.5);
    const helper = this.zoneHelpers.get(id);
    if (helper) {
      helper.parent?.remove(helper);
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
      this.zoneHelpers.delete(id);
    }
    this.audioZones.splice(idx, 1);
  }

  getAudioZones(): AudioZone[] {
    return this.audioZones;
  }

  updateAudioZone(id: string, partial: Partial<AudioZone>): void {
    const z = this.audioZones.find(z2 => z2.id === id);
    if (!z) return;
    if (partial.name !== undefined) z.name = partial.name;
    if (partial.soundUrl !== undefined) z.soundUrl = partial.soundUrl;
    if (partial.volume !== undefined) z.volume = partial.volume;
    if (partial.position) z.position.copy(partial.position);
    if (partial.size) z.size.copy(partial.size);
    if (partial.loop !== undefined) z.loop = partial.loop;
    const helper = this.zoneHelpers.get(id);
    if (helper) {
      helper.position.copy(z.position);
      helper.scale.set(z.size.x * 2, z.size.y * 2, z.size.z * 2);
    }
  }

  setShowAudioZoneHelpers(show: boolean): void {
    this.showZoneHelpers = show;
    for (const z of this.audioZones) {
      if (show && !this.zoneHelpers.has(z.id) && this.zoneScene) {
        this.createZoneHelper(z);
      } else if (!show && this.zoneHelpers.has(z.id)) {
        const h = this.zoneHelpers.get(z.id)!;
        h.parent?.remove(h);
        h.geometry.dispose();
        (h.material as THREE.Material).dispose();
        this.zoneHelpers.delete(z.id);
      }
    }
  }

  /** Check listener position against zones and trigger/stop sounds */
  updateZones(listenerPos: THREE.Vector3): void {
    for (const z of this.audioZones) {
      const dx = Math.abs(listenerPos.x - z.position.x);
      const dy = Math.abs(listenerPos.y - z.position.y);
      const dz = Math.abs(listenerPos.z - z.position.z);
      const inside = dx < z.size.x && dy < z.size.y && dz < z.size.z;

      if (inside && !z._handle) {
        // Enter zone — start playing
        this.play(z.soundUrl, { loop: z.loop, volume: z.volume, group: 'ambient' })
          .then(handle => { z._handle = handle; });
      } else if (!inside && z._handle) {
        // Leave zone — fade out
        this.stop(z._handle, 0.8);
        z._handle = null;
      }
    }
  }

  private createZoneHelper(z: AudioZone): void {
    if (!this.zoneScene) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({ color: 0x44ff88 });
    const helper = new THREE.LineSegments(edges, mat);
    helper.position.copy(z.position);
    helper.scale.set(z.size.x * 2, z.size.y * 2, z.size.z * 2);
    helper.userData._audioZoneHelper = true;
    this.zoneScene.add(helper);
    this.zoneHelpers.set(z.id, helper);
  }
}

export interface AudioZone {
  id: string;
  name: string;
  position: THREE.Vector3;
  size: THREE.Vector3;
  soundUrl: string;
  volume: number;
  loop: boolean;
  _handle: SoundHandle | null;
}
