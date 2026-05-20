// ─── Object Pool ────────────────────────────────────────────────────
// Generic, typed object pool for high-frequency create/destroy patterns
// (bullets, effects, enemies, UI elements, etc.)

/** Factory and reset functions for pool objects */
export interface PoolConfig<T> {
  /** Create a new instance */
  create: () => T;
  /** Reset an instance before reuse (optional — return it to initial state) */
  reset?: (obj: T) => void;
  /** Dispose an instance when pool shrinks (optional cleanup) */
  dispose?: (obj: T) => void;
  /** Pre-warm count (create this many upfront) */
  initialSize?: number;
  /** Hard cap on pool growth (0 = unlimited) */
  maxSize?: number;
}

export class ObjectPool<T> {
  private available: T[] = [];
  private active = new Set<T>();
  private config: Required<PoolConfig<T>>;
  private totalCreated = 0;

  constructor(config: PoolConfig<T>) {
    this.config = {
      create: config.create,
      reset: config.reset ?? (() => {}),
      dispose: config.dispose ?? (() => {}),
      initialSize: config.initialSize ?? 0,
      maxSize: config.maxSize ?? 0,
    };

    // Pre-warm
    for (let i = 0; i < this.config.initialSize; i++) {
      this.available.push(this.config.create());
      this.totalCreated++;
    }
  }

  /** Get an object from the pool (creates new if pool empty and under cap) */
  acquire(): T | null {
    let obj: T;

    if (this.available.length > 0) {
      obj = this.available.pop()!;
    } else if (this.config.maxSize > 0 && this.totalCreated >= this.config.maxSize) {
      return null; // At capacity
    } else {
      obj = this.config.create();
      this.totalCreated++;
    }

    this.config.reset(obj);
    this.active.add(obj);
    return obj;
  }

  /** Return an object to the pool */
  release(obj: T): void {
    if (!this.active.has(obj)) return;
    this.active.delete(obj);
    this.available.push(obj);
  }

  /** Release all active objects back to the pool */
  releaseAll(): void {
    for (const obj of this.active) {
      this.available.push(obj);
    }
    this.active.clear();
  }

  /** Run a function on all currently active objects */
  forEach(fn: (obj: T) => void): void {
    for (const obj of this.active) {
      fn(obj);
    }
  }

  /** Shrink the available pool to a target size, disposing extras */
  shrink(targetAvailable: number): void {
    while (this.available.length > targetAvailable) {
      const obj = this.available.pop()!;
      this.config.dispose(obj);
      this.totalCreated--;
    }
  }

  /** Dispose all objects and clear the pool */
  clear(): void {
    for (const obj of this.active) {
      this.config.dispose(obj);
    }
    for (const obj of this.available) {
      this.config.dispose(obj);
    }
    this.active.clear();
    this.available.length = 0;
    this.totalCreated = 0;
  }

  get activeCount(): number { return this.active.size; }
  get availableCount(): number { return this.available.length; }
  get totalCount(): number { return this.totalCreated; }
}

// ─── Pool Manager ───────────────────────────────────────────────────
// Named pool registry for managing multiple pools centrally.

export class PoolManager {
  private pools = new Map<string, ObjectPool<any>>();

  /** Create and register a pool */
  create<T>(name: string, config: PoolConfig<T>): ObjectPool<T> {
    const pool = new ObjectPool(config);
    this.pools.set(name, pool);
    return pool;
  }

  /** Get a pool by name */
  get<T>(name: string): ObjectPool<T> | undefined {
    return this.pools.get(name);
  }

  /** Acquire from a named pool */
  acquire<T>(name: string): T | null {
    const pool = this.pools.get(name);
    return pool ? pool.acquire() : null;
  }

  /** Release to a named pool */
  release<T>(name: string, obj: T): void {
    this.pools.get(name)?.release(obj);
  }

  /** Get stats for debugging */
  getStats(): { name: string; active: number; available: number; total: number }[] {
    const stats: { name: string; active: number; available: number; total: number }[] = [];
    for (const [name, pool] of this.pools) {
      stats.push({
        name,
        active: pool.activeCount,
        available: pool.availableCount,
        total: pool.totalCount,
      });
    }
    return stats;
  }

  /** Cleanup all pools */
  dispose(): void {
    for (const pool of this.pools.values()) {
      pool.clear();
    }
    this.pools.clear();
  }
}

// ─── Shared THREE.js Math Pools ────────────────────────────────────
// Use these instead of `new THREE.Vector3()` etc. in hot paths to
// eliminate per-frame GC pressure. Always release() after use.

import * as THREE from 'three';

/** Shared pool of THREE.Vector3. Always release() after use. */
export const vec3Pool = new ObjectPool<THREE.Vector3>({
  create: () => new THREE.Vector3(),
  reset: (v) => { v.set(0, 0, 0); },
  initialSize: 32,
});

/** Shared pool of THREE.Quaternion. Always release() after use. */
export const quatPool = new ObjectPool<THREE.Quaternion>({
  create: () => new THREE.Quaternion(),
  reset: (q) => { q.set(0, 0, 0, 1); },
  initialSize: 16,
});

/** Shared pool of THREE.Matrix4. Always release() after use. */
export const mat4Pool = new ObjectPool<THREE.Matrix4>({
  create: () => new THREE.Matrix4(),
  reset: (m) => { m.identity(); },
  initialSize: 8,
});

/** Shared pool of THREE.Euler. Always release() after use. */
export const eulerPool = new ObjectPool<THREE.Euler>({
  create: () => new THREE.Euler(),
  reset: (e) => { e.set(0, 0, 0); },
  initialSize: 8,
});

/** Shared pool of THREE.Color. Always release() after use. */
export const colorPool = new ObjectPool<THREE.Color>({
  create: () => new THREE.Color(),
  reset: (c) => { c.set(0); },
  initialSize: 8,
});
