/**
 * Fixed-timestep accumulator.
 *
 * Frame time is variable; simulation steps are not. `advance(dt)` banks the
 * frame time and returns how many fixed steps the caller must run this frame.
 * `alpha` is the fraction of a step left over, for render interpolation.
 *
 * Guards against the "spiral of death": a single frame is clamped to
 * MAX_FRAME_DT and at most MAX_SUBSTEPS steps run per frame; anything beyond
 * that is dropped rather than accumulated.
 */
export const FIXED_DT = 1 / 60;
export const MAX_FRAME_DT = 0.25;
export const MAX_SUBSTEPS = 5;

export interface GameLoopOptions {
  fixedDt?: number;
  maxFrameDt?: number;
  maxSubsteps?: number;
}

export class GameLoop {
  readonly fixedDt: number;
  readonly maxFrameDt: number;
  readonly maxSubsteps: number;

  private accumulator = 0;

  constructor(options: GameLoopOptions = {}) {
    this.fixedDt = options.fixedDt ?? FIXED_DT;
    this.maxFrameDt = options.maxFrameDt ?? MAX_FRAME_DT;
    this.maxSubsteps = options.maxSubsteps ?? MAX_SUBSTEPS;
  }

  /** Bank `dt` seconds of frame time and return the number of fixed steps to run. */
  advance(dt: number): number {
    if (!(dt > 0)) return 0;
    this.accumulator += Math.min(dt, this.maxFrameDt);
    let steps = Math.floor(this.accumulator / this.fixedDt + 1e-9);
    if (steps > this.maxSubsteps) {
      steps = this.maxSubsteps;
      this.accumulator = 0; // drop the excess instead of chasing it forever
    } else {
      this.accumulator -= steps * this.fixedDt;
      if (this.accumulator < 1e-9) this.accumulator = 0;
    }
    return steps;
  }

  /** Fraction [0, 1) of a fixed step that is still pending; use it to interpolate rendering. */
  get alpha(): number {
    return this.accumulator / this.fixedDt;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
