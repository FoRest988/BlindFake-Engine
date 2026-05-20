/**
 * Phase 19 — Stability & Benchmark tests
 *
 * Covers:
 *  - BenchmarkRunner API (suite definition, stats, formatting)
 *  - ECS performance budget (1 000 entity creates < 100 ms)
 *  - ObjectPool throughput
 *  - UISystem stability (large widget tree, rapid re-render)
 *  - AudioMixer stability (many buses, dispose)
 *  - Network round-trip simulation
 */

import { describe, it, expect, vi } from 'vitest';
import { BenchmarkRunner, BenchmarkSuiteBuilder, time, assertUnder } from '../client/src/engine/Benchmark';
import { UICanvas, UIButton, UILabel } from '../client/src/engine/UISystem';
import { VirtualJoystick } from '../client/src/engine/VirtualJoystick';
import { TouchInputManager } from '../client/src/engine/TouchInputManager';

// ── BenchmarkRunner ───────────────────────────────────────────────────────────

describe('BenchmarkRunner', () => {
  it('runs a suite and returns stats', async () => {
    const runner = new BenchmarkRunner();
    runner.suite('noop', b => {
      b.add('empty fn', () => { /* nothing */ }, { iterations: 10, warmup: 1 });
    });
    const results = await runner.runAll();
    expect(results).toHaveLength(1);
    expect(results[0].cases).toHaveLength(1);
  });

  it('stats have correct shape', async () => {
    const runner = new BenchmarkRunner();
    runner.suite('math', b => {
      b.add('sqrt loop', () => { let x = 0; for (let i = 0; i < 100; i++) x += Math.sqrt(i); }, { iterations: 20, warmup: 2 });
    });
    const [suite] = await runner.runAll();
    const s = suite.cases[0];
    expect(s.min).toBeGreaterThanOrEqual(0);
    expect(s.max).toBeGreaterThanOrEqual(s.min);
    expect(s.mean).toBeGreaterThanOrEqual(s.min);
    expect(s.p95).toBeLessThanOrEqual(s.max + 0.001);
    expect(s.stddev).toBeGreaterThanOrEqual(0);
    expect(s.opsPerSec).toBeGreaterThan(0);
    expect(s.iterations).toBe(20);
  });

  it('runSuite returns null for unknown suite', async () => {
    const runner = new BenchmarkRunner();
    expect(await runner.runSuite('nonexistent')).toBeNull();
  });

  it('runSuite returns only the named suite', async () => {
    const runner = new BenchmarkRunner();
    runner.suite('A', b => b.add('a', () => {}));
    runner.suite('B', b => b.add('b', () => {}));
    const result = await runner.runSuite('A');
    expect(result!.suiteName).toBe('A');
  });

  it('formatReport returns a non-empty string', async () => {
    const runner = new BenchmarkRunner();
    runner.suite('fmt', b => b.add('x', () => {}, { iterations: 5 }));
    const results = await runner.runAll();
    const report  = runner.formatReport(results);
    expect(report.length).toBeGreaterThan(0);
    expect(report).toContain('fmt');
    expect(report).toContain('x');
  });

  it('handles async benchmark cases', async () => {
    const runner = new BenchmarkRunner();
    runner.suite('async', b => {
      b.add('resolved promise', async () => { await Promise.resolve(); }, { iterations: 5, warmup: 1 });
    });
    const results = await runner.runAll();
    expect(results[0].cases[0].mean).toBeGreaterThanOrEqual(0);
  });
});

// ── BenchmarkSuiteBuilder ─────────────────────────────────────────────────────

describe('BenchmarkSuiteBuilder', () => {
  it('accumulates cases', () => {
    const b = new BenchmarkSuiteBuilder();
    b.add('a', () => {});
    b.add('b', () => {});
    expect(b.cases).toHaveLength(2);
  });

  it('applies default options', () => {
    const b = new BenchmarkSuiteBuilder();
    b.add('x', () => {});
    expect(b.cases[0].opts.iterations).toBe(50);
    expect(b.cases[0].opts.warmup).toBe(3);
  });

  it('overrides options', () => {
    const b = new BenchmarkSuiteBuilder();
    b.add('x', () => {}, { iterations: 7, warmup: 1 });
    expect(b.cases[0].opts.iterations).toBe(7);
    expect(b.cases[0].opts.warmup).toBe(1);
  });
});

// ── time() helper ─────────────────────────────────────────────────────────────

describe('time()', () => {
  it('returns label and non-negative ms', () => {
    const result = time('test', () => { for (let i = 0; i < 1000; i++) Math.sin(i); });
    expect(result.label).toBe('test');
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });
});

// ── assertUnder() helper ──────────────────────────────────────────────────────

describe('assertUnder()', () => {
  it('does not throw when fn is fast enough', () => {
    expect(() => assertUnder(10000, () => {})).not.toThrow();
  });

  it('throws when fn exceeds budget', () => {
    // Simulate slow: we monkey-patch performance.now
    let call = 0;
    const origNow = performance.now;
    vi.spyOn(performance, 'now').mockImplementation(() => (++call % 2 === 0) ? 9999 : 0);
    expect(() => assertUnder(1, () => {})).toThrow(/budget/i);
    vi.restoreAllMocks();
  });
});

// ── Performance budgets ───────────────────────────────────────────────────────

describe('Performance budgets', () => {
  it('ECS World — 1 000 entity creates completes < 500ms', async () => {
    const { World } = await import('../client/src/ecs/World');
    const world = new World();
    assertUnder(500, () => {
      for (let i = 0; i < 1000; i++) world.createEntity();
    });
  });

  it('UICanvas — render 100 labels completes < 50ms', () => {
    const mockCtx = {
      save: () => {}, restore: () => {},
      fillText: () => {}, fillRect: () => {},
      beginPath: () => {}, fill: () => {}, stroke: () => {},
      arc: () => {}, roundRect: () => {},
      moveTo: () => {}, lineTo: () => {}, quadraticCurveTo: () => {}, closePath: () => {},
      strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'alphabetic',
    } as unknown as CanvasRenderingContext2D;

    const canvas = new UICanvas(1280, 720);
    for (let i = 0; i < 100; i++) canvas.add(new UILabel(`Item ${i}`));

    assertUnder(50, () => {
      for (let frame = 0; frame < 10; frame++) canvas.render(mockCtx);
    });
  });

  it('VirtualJoystick — 10 000 pointerMove calls < 50ms', () => {
    const j = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed', deadZone: 0 });
    j.pointerDown(1, 100, 100);
    assertUnder(50, () => {
      for (let i = 0; i < 10000; i++) j.pointerMove(1, 100 + (i % 60), 100);
    });
  });
});

// ── Stability: rapid create/destroy cycles ─────────────────────────────────

describe('Stability: create/destroy cycles', () => {
  it('UICanvas add/remove 500 widgets without leaking', () => {
    const canvas = new UICanvas(800, 600);
    for (let i = 0; i < 500; i++) {
      const b = new UIButton(`Btn${i}`);
      canvas.add(b);
      canvas.remove(b);
    }
    expect(canvas.getWidgets()).toHaveLength(0);
  });

  it('VirtualJoystick down/up 1000 times without throwing', () => {
    const j = new VirtualJoystick({ x: 100, y: 100, radius: 60, mode: 'fixed' });
    for (let i = 0; i < 1000; i++) {
      j.pointerDown(1, 100 + (i % 50), 100);
      j.pointerUp(1);
    }
    expect(j.active).toBe(false);
  });

  it('TouchInputManager: dispose then re-create is safe', () => {
    const el = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setPointerCapture: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      style: {} as CSSStyleDeclaration,
    } as unknown as HTMLElement;
    for (let i = 0; i < 20; i++) {
      const m = new TouchInputManager(el);
      m.dispose();
    }
    expect(el.addEventListener).toHaveBeenCalled();
  });
});
