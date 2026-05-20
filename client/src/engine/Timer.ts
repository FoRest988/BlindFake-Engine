// ─── Timer Utilities ────────────────────────────────────────────────
// Managed timers, delays, intervals, cooldowns, countdowns.

export interface TimerHandle {
  id: number;
  cancel: () => void;
}

export class TimerManager {
  private nextId = 1;
  private timers = new Map<number, TimerEntry>();

  /** Wait for duration, then call fn once */
  delay(duration: number, fn: () => void): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, {
      remaining: duration,
      interval: 0,
      callback: fn,
      repeat: false,
      paused: false,
    });
    return { id, cancel: () => this.cancel(id) };
  }

  /** Call fn every interval seconds */
  every(interval: number, fn: () => void): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, {
      remaining: interval,
      interval,
      callback: fn,
      repeat: true,
      paused: false,
    });
    return { id, cancel: () => this.cancel(id) };
  }

  /** Cancel a timer */
  cancel(id: number): void {
    this.timers.delete(id);
  }

  /** Pause a timer */
  pause(id: number): void {
    const t = this.timers.get(id);
    if (t) t.paused = true;
  }

  /** Resume a timer */
  resume(id: number): void {
    const t = this.timers.get(id);
    if (t) t.paused = false;
  }

  /** Cancel all timers */
  cancelAll(): void {
    this.timers.clear();
  }

  /** Update all timers (call each frame with delta in seconds) */
  update(delta: number): void {
    const toRemove: number[] = [];

    for (const [id, timer] of this.timers) {
      if (timer.paused) continue;

      timer.remaining -= delta;
      if (timer.remaining <= 0) {
        timer.callback();
        if (timer.repeat) {
          timer.remaining += timer.interval;
        } else {
          toRemove.push(id);
        }
      }
    }

    for (const id of toRemove) {
      this.timers.delete(id);
    }
  }

  get activeCount(): number {
    return this.timers.size;
  }
}

interface TimerEntry {
  remaining: number;
  interval: number;
  callback: () => void;
  repeat: boolean;
  paused: boolean;
}

// ─── Cooldown Tracker ───────────────────────────────────────────────
// Track named cooldowns (abilities, attacks, etc.)

export class CooldownTracker {
  private cooldowns = new Map<string, number>();

  /** Start a cooldown */
  start(name: string, duration: number): void {
    this.cooldowns.set(name, duration);
  }

  /** Check if a cooldown is active */
  isActive(name: string): boolean {
    return (this.cooldowns.get(name) ?? 0) > 0;
  }

  /** Check if a cooldown is ready (not active) */
  isReady(name: string): boolean {
    return !this.isActive(name);
  }

  /** Get remaining time */
  getRemaining(name: string): number {
    return Math.max(0, this.cooldowns.get(name) ?? 0);
  }

  /** Get progress (0 = just started, 1 = ready) — needs original duration */
  getProgress(name: string, totalDuration: number): number {
    const remaining = this.getRemaining(name);
    if (totalDuration <= 0) return 1;
    return 1 - remaining / totalDuration;
  }

  /** Reset a cooldown */
  reset(name: string): void {
    this.cooldowns.delete(name);
  }

  /** Update all cooldowns */
  update(delta: number): void {
    for (const [name, remaining] of this.cooldowns) {
      const newVal = remaining - delta;
      if (newVal <= 0) {
        this.cooldowns.delete(name);
      } else {
        this.cooldowns.set(name, newVal);
      }
    }
  }
}

// ─── Stopwatch ──────────────────────────────────────────────────────

export class Stopwatch {
  private elapsed = 0;
  private running = false;

  start(): void { this.running = true; }
  stop(): void { this.running = false; }
  reset(): void { this.elapsed = 0; this.running = false; }
  restart(): void { this.elapsed = 0; this.running = true; }

  get time(): number { return this.elapsed; }
  get isRunning(): boolean { return this.running; }

  update(delta: number): void {
    if (this.running) this.elapsed += delta;
  }
}
