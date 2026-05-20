import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SpatialAudioManager, type SpatialSourceOptions, type OcclusionMaterial } from '../client/src/engine/SpatialAudioManager';

// ── Web Audio API mocks ──────────────────────────────────────────────────────

const mockConnect    = vi.fn();
const mockDisconnect = vi.fn();
const mockSourceStart = vi.fn();
const mockSourceStop  = vi.fn();
const mockSetValue    = vi.fn();

const makeAudioParam = (v = 0) => ({
  value: v,
  setValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
});

const makeNodeBase = () => ({
  connect: mockConnect,
  disconnect: mockDisconnect,
  gain: makeAudioParam(1),
});

class MockBufferSource {
  buffer: AudioBuffer | null = null;
  loop   = false;
  playbackRate = makeAudioParam(1);
  onended: (() => void) | null = null;
  connect    = mockConnect;
  disconnect = mockDisconnect;
  start      = mockSourceStart;
  stop       = mockSourceStop;
}

class MockPannerNode {
  panningModel  = 'HRTF';
  distanceModel = 'inverse';
  refDistance   = 1;
  maxDistance   = 10000;
  rolloffFactor = 1;
  coneInnerAngle = 360;
  coneOuterAngle = 360;
  coneOuterGain  = 0;
  positionX = makeAudioParam(0);
  positionY = makeAudioParam(0);
  positionZ = makeAudioParam(0);
  orientationX = makeAudioParam(1);
  orientationY = makeAudioParam(0);
  orientationZ = makeAudioParam(0);
  connect    = mockConnect;
  disconnect = mockDisconnect;
  gain       = makeAudioParam(1);
}

const makeListener = () => ({
  positionX: makeAudioParam(0),
  positionY: makeAudioParam(0),
  positionZ: makeAudioParam(0),
  forwardX: makeAudioParam(0),
  forwardY: makeAudioParam(0),
  forwardZ: makeAudioParam(-1),
  upX: makeAudioParam(0),
  upY: makeAudioParam(1),
  upZ: makeAudioParam(0),
  setPosition: vi.fn(),
  setOrientation: vi.fn(),
});

class MockAudioContext {
  currentTime = 0;
  sampleRate   = 44100;
  listener     = makeListener();
  destination  = makeNodeBase();

  createBufferSource = vi.fn(() => new MockBufferSource());
  createPanner       = vi.fn(() => new MockPannerNode());
  createGain         = vi.fn(() => makeNodeBase());
  createBiquadFilter = vi.fn(() => ({
    ...makeNodeBase(),
    type: 'lowpass',
    frequency: makeAudioParam(20000),
    Q: makeAudioParam(1),
  }));
  createConvolver = vi.fn(() => ({ ...makeNodeBase(), buffer: null }));
  createBuffer    = vi.fn((ch: number, len: number, sr: number) => ({
    duration: len / sr,
    length: len,
    numberOfChannels: ch,
    sampleRate: sr,
    getChannelData: vi.fn(() => new Float32Array(len)),
  }));
}

vi.stubGlobal('AudioContext', MockAudioContext);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFakeBuffer(): AudioBuffer {
  return {
    duration: 1,
    length: 44100,
    numberOfChannels: 1,
    sampleRate: 44100,
    getChannelData: () => new Float32Array(44100),
  } as unknown as AudioBuffer;
}

function makeManager(): SpatialAudioManager {
  const ctx  = new (AudioContext as unknown as typeof MockAudioContext)() as unknown as AudioContext;
  const dest = ctx.destination as unknown as AudioNode;
  return new SpatialAudioManager(ctx, dest);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SpatialAudioManager', () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    mockSourceStart.mockClear();
    mockSourceStop.mockClear();
    mockSetValue.mockClear();
  });

  describe('source creation', () => {
    it('creates a spatial source and starts it', () => {
      const mgr = makeManager();
      const pos = new THREE.Vector3(1, 0, 0);
      mgr.createSource(makeFakeBuffer(), pos);
      expect(mockSourceStart).toHaveBeenCalledTimes(1);
    });

    it('returns a SpatialSource with the correct initial position', () => {
      const mgr = makeManager();
      const pos = new THREE.Vector3(3, 2, 1);
      const src = mgr.createSource(makeFakeBuffer(), pos);
      expect(src.position.x).toBeCloseTo(3);
      expect(src.position.y).toBeCloseTo(2);
      expect(src.position.z).toBeCloseTo(1);
    });

    it('increments active source count', () => {
      const mgr = makeManager();
      expect(mgr.activeSourceCount).toBe(0);
      mgr.createSource(makeFakeBuffer(), new THREE.Vector3());
      expect(mgr.activeSourceCount).toBe(1);
    });

    it('applies source options (refDistance, rolloff)', () => {
      const mgr = makeManager();
      const opts: SpatialSourceOptions = { refDistance: 5, rolloffFactor: 2, attenuation: 'linear' };
      const src = mgr.createSource(makeFakeBuffer(), new THREE.Vector3(), opts);
      expect(src.panner.refDistance).toBe(5);
      expect(src.panner.rolloffFactor).toBe(2);
    });
  });

  describe('source position update', () => {
    it('updates position without throwing', () => {
      const mgr = makeManager();
      const src = mgr.createSource(makeFakeBuffer(), new THREE.Vector3());
      expect(() => mgr.updateSourcePosition(src, new THREE.Vector3(5, 0, 0), 0.016)).not.toThrow();
    });

    it('updates the stored position after updateSourcePosition', () => {
      const mgr = makeManager();
      const src = mgr.createSource(makeFakeBuffer(), new THREE.Vector3());
      mgr.updateSourcePosition(src, new THREE.Vector3(10, 0, 0), 0.016);
      expect(src.position.x).toBeCloseTo(10);
    });
  });

  describe('occlusion', () => {
    it('sets occlusion to concrete without throwing', () => {
      const mgr = makeManager();
      const src = mgr.createSource(makeFakeBuffer(), new THREE.Vector3());
      expect(() => mgr.setOcclusion(src, 'concrete', 1.0)).not.toThrow();
    });

    it('sets occlusion to none (clears filter)', () => {
      const mgr = makeManager();
      const src = mgr.createSource(makeFakeBuffer(), new THREE.Vector3());
      mgr.setOcclusion(src, 'concrete', 1.0);
      expect(() => mgr.setOcclusion(src, 'none', 0)).not.toThrow();
    });

    const materials: OcclusionMaterial[] = ['none', 'glass', 'wood', 'concrete', 'metal', 'soil', 'water'];
    for (const mat of materials) {
      it(`handles occlusion material: ${mat}`, () => {
        const mgr = makeManager();
        const src = mgr.createSource(makeFakeBuffer(), new THREE.Vector3());
        expect(() => mgr.setOcclusion(src, mat, 0.5)).not.toThrow();
      });
    }
  });

  describe('listener update', () => {
    it('updates listener without throwing', () => {
      const mgr  = makeManager();
      const cam  = new THREE.PerspectiveCamera();
      cam.position.set(0, 1.7, 0);
      expect(() => mgr.updateListener(cam)).not.toThrow();
    });

    it('updates listener with velocity', () => {
      const mgr = makeManager();
      const cam = new THREE.PerspectiveCamera();
      const vel = new THREE.Vector3(5, 0, 0);
      expect(() => mgr.updateListener(cam, vel)).not.toThrow();
    });
  });

  describe('room acoustics', () => {
    const presets = ['none', 'small_room', 'medium_room', 'large_hall', 'cave', 'outdoor'] as const;
    for (const preset of presets) {
      it(`setRoom preset "${preset}" does not throw`, () => {
        const mgr = makeManager();
        expect(() => mgr.setRoom({ preset })).not.toThrow();
      });
    }

    it('getCurrentRoom returns the set config', () => {
      const mgr = makeManager();
      mgr.setRoom({ preset: 'large_hall' });
      expect(mgr.getCurrentRoom().preset).toBe('large_hall');
    });

    it('setRoom with custom reverbTime', () => {
      const mgr = makeManager();
      expect(() => mgr.setRoom({ preset: 'medium_room', reverbTime: 1.5, hfDamping: 0.3 })).not.toThrow();
    });
  });

  describe('stop', () => {
    it('stopSource stops the audio node', () => {
      const mgr = makeManager();
      const src = mgr.createSource(makeFakeBuffer(), new THREE.Vector3());
      mgr.stopSource(src);
      expect(mockSourceStop).toHaveBeenCalled();
    });

    it('stopAll stops all sources', () => {
      const mgr = makeManager();
      mgr.createSource(makeFakeBuffer(), new THREE.Vector3(1, 0, 0));
      mgr.createSource(makeFakeBuffer(), new THREE.Vector3(2, 0, 0));
      mgr.stopAll();
      expect(mockSourceStop).toHaveBeenCalledTimes(2);
    });

    it('stopSource on already-stopped source is a no-op', () => {
      const mgr = makeManager();
      const src = mgr.createSource(makeFakeBuffer(), new THREE.Vector3());
      src.source = null; // simulate already stopped
      expect(() => mgr.stopSource(src)).not.toThrow();
    });
  });

  describe('master volume', () => {
    it('sets master volume', () => {
      const mgr = makeManager();
      mgr.masterVolume = 0.5;
      expect(mgr.masterVolume).toBeCloseTo(0.5);
    });

    it('clamps master volume to 0–1', () => {
      const mgr = makeManager();
      mgr.masterVolume = -1;
      expect(mgr.masterVolume).toBe(0);
      mgr.masterVolume = 5;
      expect(mgr.masterVolume).toBe(1);
    });
  });
});
