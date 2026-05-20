// ─── Tween & Easing System ─────────────────────────────────────────
// Smooth value transitions for animations, UI, gameplay.
// Supports chaining, delays, yoyo, repeat, callbacks.

// ── Easing Functions ───────────────────────────────────────────────
export type EasingFunction = (t: number) => number;

export const Easing = {
  // Linear
  Linear: (t: number) => t,

  // Quadratic
  QuadIn: (t: number) => t * t,
  QuadOut: (t: number) => t * (2 - t),
  QuadInOut: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

  // Cubic
  CubicIn: (t: number) => t * t * t,
  CubicOut: (t: number) => (--t) * t * t + 1,
  CubicInOut: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  // Quartic
  QuartIn: (t: number) => t * t * t * t,
  QuartOut: (t: number) => 1 - (--t) * t * t * t,
  QuartInOut: (t: number) => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,

  // Quintic
  QuintIn: (t: number) => t * t * t * t * t,
  QuintOut: (t: number) => 1 + (--t) * t * t * t * t,
  QuintInOut: (t: number) => t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t,

  // Sinusoidal
  SineIn: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  SineOut: (t: number) => Math.sin((t * Math.PI) / 2),
  SineInOut: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,

  // Exponential
  ExpoIn: (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  ExpoOut: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  ExpoInOut: (t: number) => {
    if (t === 0 || t === 1) return t;
    return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
  },

  // Circular
  CircIn: (t: number) => 1 - Math.sqrt(1 - t * t),
  CircOut: (t: number) => Math.sqrt(1 - (--t) * t),
  CircInOut: (t: number) =>
    t < 0.5 ? (1 - Math.sqrt(1 - 4 * t * t)) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,

  // Elastic
  ElasticIn: (t: number) => {
    if (t === 0 || t === 1) return t;
    return -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI);
  },
  ElasticOut: (t: number) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
  },
  ElasticInOut: (t: number) => {
    if (t === 0 || t === 1) return t;
    t *= 2;
    if (t < 1) return -0.5 * Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI);
    return 0.5 * Math.pow(2, -10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI) + 1;
  },

  // Bounce
  BounceOut: (t: number) => {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
  },
  BounceIn: (t: number) => 1 - Easing.BounceOut(1 - t),
  BounceInOut: (t: number) =>
    t < 0.5 ? Easing.BounceIn(t * 2) * 0.5 : Easing.BounceOut(t * 2 - 1) * 0.5 + 0.5,

  // Back (overshoot)
  BackIn: (t: number) => { const s = 1.70158; return t * t * ((s + 1) * t - s); },
  BackOut: (t: number) => { const s = 1.70158; return (--t) * t * ((s + 1) * t + s) + 1; },
  BackInOut: (t: number) => {
    const s = 1.70158 * 1.525;
    if ((t *= 2) < 1) return 0.5 * (t * t * ((s + 1) * t - s));
    return 0.5 * ((t -= 2) * t * ((s + 1) * t + s) + 2);
  },
} as const;

// ── Tween Class ───────────────────────────────────────────────────

export interface TweenConfig {
  duration: number;
  easing?: EasingFunction;
  delay?: number;
  repeat?: number;     // -1 = infinite
  yoyo?: boolean;
  onStart?: () => void;
  onUpdate?: (progress: number) => void;
  onComplete?: () => void;
  onRepeat?: () => void;
}

export class Tween<T extends Record<string, number>> {
  private target: T;
  private from: Partial<T> = {};
  private to: Partial<T> = {};
  private config: Required<TweenConfig>;
  private elapsed = 0;
  private started = false;
  private completed = false;
  private repeatCount = 0;
  private reversed = false;
  private paused = false;

  // Chain next tween
  private chainedTween: Tween<any> | null = null;

  constructor(target: T, to: Partial<T>, config: TweenConfig) {
    this.target = target;
    this.to = { ...to };
    this.config = {
      duration: config.duration,
      easing: config.easing ?? Easing.Linear,
      delay: config.delay ?? 0,
      repeat: config.repeat ?? 0,
      yoyo: config.yoyo ?? false,
      onStart: config.onStart ?? (() => {}),
      onUpdate: config.onUpdate ?? (() => {}),
      onComplete: config.onComplete ?? (() => {}),
      onRepeat: config.onRepeat ?? (() => {}),
    };

    // Capture initial values
    for (const key of Object.keys(to) as (keyof T)[]) {
      this.from[key] = target[key] as any;
    }
  }

  /** Chain another tween to start after this one completes */
  then<U extends Record<string, number>>(target: U, to: Partial<U>, config: TweenConfig): Tween<U> {
    const next = new Tween(target, to, config);
    this.chainedTween = next;
    return next;
  }

  pause(): this {
    this.paused = true;
    return this;
  }

  resume(): this {
    this.paused = false;
    return this;
  }

  stop(): void {
    this.completed = true;
  }

  get isComplete(): boolean {
    return this.completed;
  }

  /** Returns true if this tween (and chain) is finished */
  update(delta: number): boolean {
    if (this.completed || this.paused) return this.completed;

    this.elapsed += delta;

    // Delay
    if (this.elapsed < this.config.delay) return false;

    // First frame after delay
    if (!this.started) {
      this.started = true;
      // Re-capture from values (they may have changed)
      for (const key of Object.keys(this.to) as (keyof T)[]) {
        this.from[key] = this.target[key] as any;
      }
      this.config.onStart();
    }

    const activeTime = this.elapsed - this.config.delay;
    let t = Math.min(activeTime / this.config.duration, 1);
    if (this.reversed) t = 1 - t;

    // Apply easing
    const easedT = this.config.easing(t);

    // Interpolate values
    for (const key of Object.keys(this.to) as (keyof T)[]) {
      const start = this.from[key] as number;
      const end = this.to[key] as number;
      (this.target as any)[key] = start + (end - start) * easedT;
    }

    this.config.onUpdate(easedT);

    // Complete?
    if (activeTime >= this.config.duration) {
      // Repeat logic
      if (this.config.repeat === -1 || this.repeatCount < this.config.repeat) {
        this.repeatCount++;
        this.elapsed = this.config.delay;
        this.started = false;

        if (this.config.yoyo) {
          this.reversed = !this.reversed;
        } else {
          // Reset from values
          for (const key of Object.keys(this.to) as (keyof T)[]) {
            (this.target as any)[key] = this.from[key];
          }
        }
        this.config.onRepeat();
        return false;
      }

      this.completed = true;
      this.config.onComplete();

      // Start chained tween
      if (this.chainedTween) {
        TweenManager.instance?.add(this.chainedTween);
      }
    }

    return this.completed;
  }
}

// ── Tween Manager ─────────────────────────────────────────────────

export class TweenManager {
  static instance: TweenManager | null = null;
  private tweens: Tween<any>[] = [];

  constructor() {
    TweenManager.instance = this;
  }

  /** Create and register a tween */
  to<T extends Record<string, number>>(target: T, to: Partial<T>, config: TweenConfig): Tween<T> {
    const tween = new Tween(target, to, config);
    this.tweens.push(tween);
    return tween;
  }

  /** Add an existing tween */
  add<T extends Record<string, number>>(tween: Tween<T>): void {
    this.tweens.push(tween);
  }

  /** Update all active tweens, remove completed ones */
  update(delta: number): void {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      if (this.tweens[i].update(delta)) {
        this.tweens.splice(i, 1);
      }
    }
  }

  /** Kill all tweens affecting a specific target */
  killTweensOf(target: any): void {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      if ((this.tweens[i] as any).target === target) {
        this.tweens[i].stop();
        this.tweens.splice(i, 1);
      }
    }
  }

  /** Stop and remove all tweens */
  clear(): void {
    for (const tween of this.tweens) tween.stop();
    this.tweens.length = 0;
  }

  get activeTweenCount(): number {
    return this.tweens.length;
  }
}
