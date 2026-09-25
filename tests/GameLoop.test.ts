import { describe, expect, it } from 'vitest';
import { FIXED_DT, GameLoop, MAX_SUBSTEPS } from '../client/src/engine/loop/GameLoop';

describe('GameLoop (fixed-timestep accumulator)', () => {
  it('runs 9 steps for three 50 ms frames', () => {
    const loop = new GameLoop();
    let steps = 0;
    for (let i = 0; i < 3; i++) steps += loop.advance(0.05);
    expect(steps).toBe(9);
    expect(loop.alpha).toBeCloseTo(0, 6);
  });

  it('carries the remainder between frames', () => {
    const loop = new GameLoop();
    expect(loop.advance(FIXED_DT / 2)).toBe(0);
    expect(loop.alpha).toBeCloseTo(0.5, 6);
    expect(loop.advance(FIXED_DT / 2)).toBe(1);
    expect(loop.alpha).toBeCloseTo(0, 6);
  });

  it('clamps a huge frame to the substep ceiling and drops the excess', () => {
    const loop = new GameLoop();
    expect(loop.advance(1.0)).toBe(MAX_SUBSTEPS);
    expect(loop.alpha).toBe(0);
    // Next normal frame is not penalised by the earlier stall.
    expect(loop.advance(FIXED_DT)).toBe(1);
  });

  it('ignores non-positive or NaN deltas', () => {
    const loop = new GameLoop();
    expect(loop.advance(0)).toBe(0);
    expect(loop.advance(-1)).toBe(0);
    expect(loop.advance(Number.NaN)).toBe(0);
  });

  it('reset() clears banked time', () => {
    const loop = new GameLoop();
    loop.advance(FIXED_DT / 2);
    loop.reset();
    expect(loop.alpha).toBe(0);
  });
});
