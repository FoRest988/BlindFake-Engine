import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdaptiveMusicSystem, type MusicStateConfig, type LayerConfig } from '../client/src/engine/AdaptiveMusicSystem';

// ── Web Audio API mocks ──────────────────────────────────────────────────────

const makeAudioParam = (v = 0) => ({
  value: v,
  setValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
  cancelScheduledValues: vi.fn(),
});

const mockConnect    = vi.fn();
const mockDisconnect = vi.fn();
const mockSourceStart = vi.fn();
const mockSourceStop  = vi.fn();

let lastSourceNode: MockBufferSource;

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

class MockAudioContext {
  currentTime = 0;
  destination = { connect: mockConnect, disconnect: mockDisconnect };

  createBufferSource = vi.fn(() => {
    lastSourceNode = new MockBufferSource();
    return lastSourceNode;
  });

  createGain = vi.fn(() => ({
    gain: makeAudioParam(1),
    connect: mockConnect,
    disconnect: mockDisconnect,
  }));

  createConvolver = vi.fn(() => ({ connect: mockConnect, buffer: null }));
  createBiquadFilter = vi.fn(() => ({
    type: 'lowpass',
    frequency: makeAudioParam(20000),
    Q: makeAudioParam(1),
    connect: mockConnect,
  }));
}

vi.stubGlobal('AudioContext', MockAudioContext);

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeLayer(id: string, threshold = 0): LayerConfig {
  return { id, url: `sound://${id}`, maxVolume: 1, intensityThreshold: threshold };
}

function makeState(id: string, layers: LayerConfig[] = [makeLayer('base')], bpm = 120): MusicStateConfig {
  return { id, bpm, layers, defaultIntensity: 0.5 };
}

function makeFakeBuffer(): AudioBuffer {
  return { duration: 10, length: 441000, numberOfChannels: 2, sampleRate: 44100 } as unknown as AudioBuffer;
}

function makeSystem(): AdaptiveMusicSystem {
  const ctx  = new (AudioContext as unknown as typeof MockAudioContext)() as unknown as AudioContext;
  const dest = ctx.destination as unknown as AudioNode;
  const sys  = new AdaptiveMusicSystem(ctx, dest);
  // Provide a synchronous mock loadBuffer
  sys.loadBuffer = vi.fn(async () => makeFakeBuffer());
  return sys;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdaptiveMusicSystem', () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    mockSourceStart.mockClear();
    mockSourceStop.mockClear();
  });

  describe('state definition', () => {
    it('defines and retrieves a state', () => {
      const sys = makeSystem();
      sys.defineState(makeState('explore'));
      expect(sys.getState('explore')).toBeDefined();
    });

    it('returns undefined for unknown state', () => {
      const sys = makeSystem();
      expect(sys.getState('unknown')).toBeUndefined();
    });

    it('lists all defined state ids', () => {
      const sys = makeSystem();
      sys.defineState(makeState('explore'));
      sys.defineState(makeState('combat'));
      expect(sys.getStateIds()).toContain('explore');
      expect(sys.getStateIds()).toContain('combat');
    });
  });

  describe('start / stop', () => {
    it('starts in the given state', async () => {
      const sys = makeSystem();
      sys.defineState(makeState('explore'));
      await sys.start('explore');
      expect(sys.currentState).toBe('explore');
      expect(sys.isPlaying).toBe(true);
    });

    it('starts sources when entering a state', async () => {
      const sys = makeSystem();
      sys.defineState(makeState('explore'));
      await sys.start('explore');
      expect(mockSourceStart).toHaveBeenCalled();
    });

    it('stop marks system as not playing', async () => {
      const sys = makeSystem();
      sys.defineState(makeState('explore'));
      await sys.start('explore');
      sys.stop(0);
      expect(sys.isPlaying).toBe(false);
    });

    it('start on unknown state is a no-op', async () => {
      const sys = makeSystem();
      await sys.start('nonexistent');
      expect(sys.currentState).toBeNull();
    });
  });

  describe('intensity', () => {
    it('sets intensity within 0–1 range', () => {
      const sys = makeSystem();
      sys.setIntensity(0.8);
      expect(sys.intensity).toBeCloseTo(0.8);
    });

    it('clamps intensity below 0', () => {
      const sys = makeSystem();
      sys.setIntensity(-1);
      expect(sys.intensity).toBe(0);
    });

    it('clamps intensity above 1', () => {
      const sys = makeSystem();
      sys.setIntensity(2);
      expect(sys.intensity).toBe(1);
    });
  });

  describe('transitions', () => {
    it('transitions to another state (crossfade)', async () => {
      const sys = makeSystem();
      sys.defineState(makeState('explore'));
      sys.defineState(makeState('combat'));
      sys.defineTransition('explore', 'combat', { type: 'crossfade', duration: 0.01 });
      await sys.start('explore');
      await sys.transitionTo('combat');
      expect(sys.currentState).toBe('combat');
    });

    it('transitions immediately', async () => {
      const sys = makeSystem();
      sys.defineState(makeState('explore'));
      sys.defineState(makeState('combat'));
      sys.defineTransition('explore', 'combat', { type: 'immediate' });
      await sys.start('explore');
      await sys.transitionTo('combat');
      expect(sys.currentState).toBe('combat');
    });

    it('transitioning to current state is a no-op', async () => {
      const sys = makeSystem();
      sys.defineState(makeState('explore'));
      await sys.start('explore');
      const startCallsBefore = mockSourceStart.mock.calls.length;
      await sys.transitionTo('explore');
      expect(mockSourceStart.mock.calls.length).toBe(startCallsBefore);
    });

    it('transitioning when not playing is a no-op', async () => {
      const sys = makeSystem();
      sys.defineState(makeState('explore'));
      sys.defineState(makeState('combat'));
      await sys.transitionTo('combat'); // not yet started
      expect(sys.currentState).toBeNull();
    });
  });

  describe('preload', () => {
    it('preloads a state without starting playback', async () => {
      const sys = makeSystem();
      sys.defineState(makeState('explore'));
      await sys.preloadState('explore');
      expect(mockSourceStart).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('update does not throw', async () => {
      const sys = makeSystem();
      expect(() => sys.update(0.016)).not.toThrow();
    });
  });
});
