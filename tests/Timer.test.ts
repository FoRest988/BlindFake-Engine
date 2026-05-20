import { describe, it, expect, vi } from 'vitest';
import { TimerManager, CooldownTracker, Stopwatch } from '../client/src/engine/Timer';

describe('TimerManager', () => {
  it('delay fires after duration', () => {
    const tm = new TimerManager();
    const fn = vi.fn();
    tm.delay(1.0, fn);
    tm.update(0.5);
    expect(fn).not.toHaveBeenCalled();
    tm.update(0.6);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('delay auto-removes after firing', () => {
    const tm = new TimerManager();
    const fn = vi.fn();
    tm.delay(1.0, fn);
    tm.update(2.0);
    expect(tm.activeCount).toBe(0);
  });

  it('every repeats at interval', () => {
    const tm = new TimerManager();
    const fn = vi.fn();
    tm.every(0.5, fn);
    tm.update(0.5);
    expect(fn).toHaveBeenCalledTimes(1);
    tm.update(0.5);
    expect(fn).toHaveBeenCalledTimes(2);
    tm.update(0.5);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('cancel stops a timer', () => {
    const tm = new TimerManager();
    const fn = vi.fn();
    const handle = tm.delay(1.0, fn);
    handle.cancel();
    tm.update(2.0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('pause and resume work', () => {
    const tm = new TimerManager();
    const fn = vi.fn();
    const handle = tm.delay(1.0, fn);
    tm.update(0.4);
    tm.pause(handle.id);
    tm.update(2.0);
    expect(fn).not.toHaveBeenCalled();
    tm.resume(handle.id);
    tm.update(0.7);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('cancelAll clears everything', () => {
    const tm = new TimerManager();
    tm.delay(1, vi.fn());
    tm.every(1, vi.fn());
    tm.cancelAll();
    expect(tm.activeCount).toBe(0);
  });
});

describe('CooldownTracker', () => {
  it('starts active and becomes ready', () => {
    const cd = new CooldownTracker();
    cd.start('fireball', 2.0);
    expect(cd.isActive('fireball')).toBe(true);
    expect(cd.isReady('fireball')).toBe(false);
    cd.update(2.1);
    expect(cd.isActive('fireball')).toBe(false);
    expect(cd.isReady('fireball')).toBe(true);
  });

  it('getRemaining returns correct time', () => {
    const cd = new CooldownTracker();
    cd.start('skill', 3.0);
    cd.update(1.0);
    expect(cd.getRemaining('skill')).toBeCloseTo(2.0);
  });

  it('reset clears a cooldown', () => {
    const cd = new CooldownTracker();
    cd.start('dash', 5.0);
    cd.reset('dash');
    expect(cd.isReady('dash')).toBe(true);
  });

  it('unknown cooldown is ready', () => {
    const cd = new CooldownTracker();
    expect(cd.isReady('unknown')).toBe(true);
  });
});

describe('Stopwatch', () => {
  it('accumulates time when running', () => {
    const sw = new Stopwatch();
    sw.start();
    sw.update(1.5);
    sw.update(0.5);
    expect(sw.time).toBeCloseTo(2.0);
  });

  it('does not accumulate when stopped', () => {
    const sw = new Stopwatch();
    sw.start();
    sw.update(1.0);
    sw.stop();
    sw.update(1.0);
    expect(sw.time).toBeCloseTo(1.0);
  });

  it('reset zeros and stops', () => {
    const sw = new Stopwatch();
    sw.start();
    sw.update(5.0);
    sw.reset();
    expect(sw.time).toBe(0);
    expect(sw.isRunning).toBe(false);
  });

  it('restart zeros and starts', () => {
    const sw = new Stopwatch();
    sw.start();
    sw.update(5.0);
    sw.restart();
    expect(sw.time).toBe(0);
    expect(sw.isRunning).toBe(true);
  });
});
