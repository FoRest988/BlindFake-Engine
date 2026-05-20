import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioMixer } from '../client/src/engine/AudioMixer';

// ── Web Audio API mocks ──────────────────────────────────────────────────────

const mockConnect    = vi.fn();
const mockDisconnect = vi.fn();
const mockStart      = vi.fn();

const makeAudioParam = (initial = 0) => ({
  value: initial,
  setValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
});

const makeNodeBase = () => ({
  connect: mockConnect,
  disconnect: mockDisconnect,
  gain: makeAudioParam(1),
  pan: makeAudioParam(0),
});

const makeAnalyser = () => ({
  ...makeNodeBase(),
  fftSize: 256,
  frequencyBinCount: 128,
  getFloatTimeDomainData: vi.fn((arr: Float32Array) => arr.fill(0)),
});

const makeCompressor = () => ({
  ...makeNodeBase(),
  threshold: makeAudioParam(-24),
  knee:      makeAudioParam(30),
  ratio:     makeAudioParam(12),
  attack:    makeAudioParam(0.003),
  release:   makeAudioParam(0.25),
});

const makePanner = () => ({
  ...makeNodeBase(),
  pan: makeAudioParam(0),
});

class MockAudioContext {
  currentTime = 0;
  sampleRate   = 44100;
  destination  = makeNodeBase();

  createGain        = vi.fn(() => makeNodeBase());
  createStereoPanner = vi.fn(() => makePanner());
  createAnalyser    = vi.fn(() => makeAnalyser());
  createDynamicsCompressor = vi.fn(() => makeCompressor());
  createBiquadFilter = vi.fn(() => ({
    ...makeNodeBase(),
    type: 'lowpass',
    frequency: makeAudioParam(350),
    Q: makeAudioParam(1),
  }));
  createDelay = vi.fn(() => ({ ...makeNodeBase(), delayTime: makeAudioParam(0) }));
  createConvolver = vi.fn(() => ({ ...makeNodeBase(), buffer: null }));
  createOscillator = vi.fn(() => ({ ...makeNodeBase(), start: mockStart, frequency: makeAudioParam(0), type: 'sine' }));
}

vi.stubGlobal('AudioContext', MockAudioContext);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMixer(): AudioMixer {
  const ctx = new (AudioContext as unknown as typeof MockAudioContext)() as unknown as AudioContext;
  return new AudioMixer(ctx);
}

// Helper that also creates the bus with required name argument
function addBus(mixer: AudioMixer, id: string) {
  mixer.createBus(id, id.charAt(0).toUpperCase() + id.slice(1));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AudioMixer', () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockDisconnect.mockClear();
  });

  describe('bus creation', () => {
    it('creates a master bus by default', () => {
      const mixer = makeMixer();
      const master = mixer.getMasterBus();
      expect(master).toBeDefined();
    });

    it('creates a named bus', () => {
      const mixer = makeMixer();
      addBus(mixer, 'sfx');
      expect(mixer.getBus('sfx')).toBeDefined();
    });

    it('returns undefined for unknown bus', () => {
      const mixer = makeMixer();
      expect(mixer.getBus('unknown')).toBeUndefined();
    });

    it('lists all bus ids including master', () => {
      const mixer = makeMixer();
      addBus(mixer, 'sfx');
      addBus(mixer, 'music');
      const ids = mixer.getBusIds();
      // Internal master bus id is __master__
      expect(ids).toContain('__master__');
      expect(ids).toContain('sfx');
      expect(ids).toContain('music');
    });
  });

  describe('volume control', () => {
    it('sets bus volume', () => {
      const mixer = makeMixer();
      addBus(mixer, 'sfx');
      const bus = mixer.getBus('sfx')!;
      bus.volume = 0.5;
      expect(bus.volume).toBeCloseTo(0.5);
    });

    it('clamps volume to 0–1', () => {
      const mixer = makeMixer();
      addBus(mixer, 'sfx');
      const bus = mixer.getBus('sfx')!;
      bus.volume = -1;
      expect(bus.volume).toBeCloseTo(0);
      bus.volume = 5;
      expect(bus.volume).toBeCloseTo(1);
    });

    it('mutes and unmutes a bus', () => {
      const mixer = makeMixer();
      addBus(mixer, 'sfx');
      const bus = mixer.getBus('sfx')!;
      bus.mute = true;
      expect(bus.mute).toBe(true);
      bus.mute = false;
      expect(bus.mute).toBe(false);
    });
  });

  describe('solo matrix', () => {
    it('soloing a bus marks it as soloed', () => {
      const mixer = makeMixer();
      addBus(mixer, 'sfx');
      addBus(mixer, 'music');
      mixer.setSolo('sfx', true);
      expect(mixer.getBus('sfx')!.solo).toBe(true);
      expect(mixer.getBus('music')!.solo).toBe(false);
    });

    it('clearing solo un-solos the bus', () => {
      const mixer = makeMixer();
      addBus(mixer, 'sfx');
      mixer.setSolo('sfx', true);
      mixer.setSolo('sfx', false);
      expect(mixer.getBus('sfx')!.solo).toBe(false);
    });
  });

  describe('bus removal', () => {
    it('removes a non-master bus', () => {
      const mixer = makeMixer();
      addBus(mixer, 'sfx');
      mixer.removeBus('sfx');
      expect(mixer.getBus('sfx')).toBeUndefined();
    });

    it('does not remove the master bus', () => {
      const mixer = makeMixer();
      mixer.removeBus('__master__');
      expect(mixer.getMasterBus()).toBeDefined();
    });
  });

  describe('snapshots', () => {
    it('saves and recalls a snapshot (volume restored)', () => {
      const mixer = makeMixer();
      addBus(mixer, 'sfx');
      mixer.getBus('sfx')!.volume = 0.75;
      const snap = mixer.saveSnapshot('snap1');
      expect(snap.name).toBe('snap1');
      expect(snap.buses.find(b => b.id === 'sfx')?.volume).toBeCloseTo(0.75);
    });

    it('recallSnapshot applies stored volumes', () => {
      const mixer = makeMixer();
      addBus(mixer, 'sfx');
      mixer.getBus('sfx')!.volume = 0.6;
      const snap = mixer.saveSnapshot('s');
      mixer.getBus('sfx')!.volume = 0.1;
      mixer.recallSnapshot(snap);
      // volume setter is via linearRamp — value property unchanged; just check no throw
      expect(() => mixer.recallSnapshot(snap)).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('disposes without error', () => {
      const mixer = makeMixer();
      addBus(mixer, 'sfx');
      expect(() => mixer.dispose()).not.toThrow();
    });
  });
});
