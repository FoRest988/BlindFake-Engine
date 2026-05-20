import { describe, it, expect, vi } from 'vitest';
import { ObjectPool, PoolManager } from '../client/src/engine/ObjectPool';

describe('ObjectPool', () => {
  const makePool = (opts?: { max?: number; initial?: number }) =>
    new ObjectPool<{ value: number }>({
      create: () => ({ value: 0 }),
      reset: (o) => { o.value = 0; },
      maxSize: opts?.max ?? 0,
      initialSize: opts?.initial ?? 0,
    });

  it('acquires a new object', () => {
    const pool = makePool();
    const obj = pool.acquire();
    expect(obj).not.toBeNull();
    expect(obj!.value).toBe(0);
    expect(pool.activeCount).toBe(1);
  });

  it('releases and reuses objects', () => {
    const pool = makePool();
    const obj = pool.acquire()!;
    obj.value = 42;
    pool.release(obj);
    expect(pool.activeCount).toBe(0);
    expect(pool.availableCount).toBe(1);

    const reused = pool.acquire()!;
    expect(reused.value).toBe(0); // reset was called
    expect(pool.activeCount).toBe(1);
  });

  it('respects maxSize', () => {
    const pool = makePool({ max: 2 });
    pool.acquire();
    pool.acquire();
    const third = pool.acquire();
    expect(third).toBeNull();
  });

  it('pre-warms with initialSize', () => {
    const pool = makePool({ initial: 5 });
    expect(pool.availableCount).toBe(5);
    expect(pool.totalCount).toBe(5);
  });

  it('releaseAll returns all active objects', () => {
    const pool = makePool();
    pool.acquire();
    pool.acquire();
    pool.acquire();
    expect(pool.activeCount).toBe(3);
    pool.releaseAll();
    expect(pool.activeCount).toBe(0);
    expect(pool.availableCount).toBe(3);
  });

  it('forEach iterates active objects', () => {
    const pool = makePool();
    const a = pool.acquire()!;
    const b = pool.acquire()!;
    a.value = 1;
    b.value = 2;
    const vals: number[] = [];
    pool.forEach((o) => vals.push(o.value));
    expect(vals.sort()).toEqual([1, 2]);
  });

  it('shrink disposes excess available objects', () => {
    const dispose = vi.fn();
    const pool = new ObjectPool<{ value: number }>({
      create: () => ({ value: 0 }),
      dispose,
      initialSize: 10,
    });
    pool.shrink(3);
    expect(pool.availableCount).toBe(3);
    expect(dispose).toHaveBeenCalledTimes(7);
  });

  it('clear disposes everything', () => {
    const dispose = vi.fn();
    const pool = new ObjectPool<{ value: number }>({
      create: () => ({ value: 0 }),
      dispose,
      initialSize: 3,
    });
    pool.acquire();
    pool.clear();
    expect(pool.activeCount).toBe(0);
    expect(pool.availableCount).toBe(0);
    expect(pool.totalCount).toBe(0);
  });
});

describe('PoolManager', () => {
  it('creates and retrieves pools', () => {
    const pm = new PoolManager();
    pm.create('bullets', { create: () => ({ x: 0, y: 0 }) });
    const pool = pm.get('bullets');
    expect(pool).toBeDefined();
  });

  it('acquire and release through manager', () => {
    const pm = new PoolManager();
    pm.create('items', { create: () => ({ id: 1 }) });
    const obj = pm.acquire('items');
    expect(obj).not.toBeNull();
    pm.release('items', obj);
  });

  it('getStats returns pool info', () => {
    const pm = new PoolManager();
    pm.create('a', { create: () => ({}), initialSize: 5 });
    pm.acquire('a');
    const stats = pm.getStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].name).toBe('a');
    expect(stats[0].active).toBe(1);
    expect(stats[0].available).toBe(4);
  });

  it('dispose clears all pools', () => {
    const pm = new PoolManager();
    pm.create('x', { create: () => ({}) });
    pm.acquire('x');
    pm.dispose();
    expect(pm.get('x')).toBeUndefined();
  });
});
