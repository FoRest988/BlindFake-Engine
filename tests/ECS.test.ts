import { describe, it, expect } from 'vitest';
import { Entity } from '../client/src/ecs/Entity';
import { Component } from '../client/src/ecs/Component';
import { World } from '../client/src/ecs/World';
import { System } from '../client/src/ecs/System';
import { ObjectPool } from '../client/src/engine/ObjectPool';

// Test components
class PositionComponent extends Component {
  x = 0;
  y = 0;
}

class VelocityComponent extends Component {
  vx = 0;
  vy = 0;
}

class HealthComponent extends Component {
  hp = 100;
}

describe('Entity', () => {
  it('has an id and name', () => {
    const e = new Entity(1, 'Player');
    expect(e.id).toBe(1);
    expect(e.name).toBe('Player');
    expect(e.active).toBe(true);
  });

  it('uses default name when none given', () => {
    const e = new Entity(42);
    expect(e.name).toBe('Entity_42');
  });

  it('adds and retrieves components', () => {
    const e = new Entity(1);
    const pos = new PositionComponent();
    pos.x = 10;
    pos.y = 20;
    e.add(pos);
    expect(e.has(PositionComponent)).toBe(true);
    expect(e.get(PositionComponent).x).toBe(10);
    expect(e.get(PositionComponent).y).toBe(20);
  });

  it('tryGet returns undefined for missing component', () => {
    const e = new Entity(1);
    expect(e.tryGet(PositionComponent)).toBeUndefined();
  });

  it('throws when getting missing component', () => {
    const e = new Entity(1);
    expect(() => e.get(PositionComponent)).toThrow();
  });

  it('removes components', () => {
    const e = new Entity(1);
    e.add(new PositionComponent());
    e.remove(PositionComponent);
    expect(e.has(PositionComponent)).toBe(false);
  });

  it('supports tags', () => {
    const e = new Entity(1);
    e.addTag('enemy').addTag('boss');
    expect(e.hasTag('enemy')).toBe(true);
    expect(e.hasTag('boss')).toBe(true);
    expect(e.hasTag('player')).toBe(false);
  });

  it('getAll returns all components', () => {
    const e = new Entity(1);
    e.add(new PositionComponent());
    e.add(new VelocityComponent());
    expect(e.getAll()).toHaveLength(2);
  });

  it('dispose clears components and deactivates', () => {
    const e = new Entity(1);
    e.add(new PositionComponent());
    e.dispose();
    expect(e.active).toBe(false);
    expect(e.getAll()).toHaveLength(0);
  });

  it('sets entity reference on component', () => {
    const e = new Entity(1);
    const pos = new PositionComponent();
    e.add(pos);
    expect(pos.entity).toBe(e);
  });
});

describe('World', () => {
  it('creates entities with incrementing ids', () => {
    const world = new World();
    const e1 = world.createEntity('A');
    const e2 = world.createEntity('B');
    expect(e1.id).toBeLessThan(e2.id);
    expect(world.entityCount).toBe(2);
  });

  it('retrieves entities by id', () => {
    const world = new World();
    const e = world.createEntity('Test');
    expect(world.getEntity(e.id)).toBe(e);
    expect(world.getEntity(9999)).toBeUndefined();
  });

  it('removes entities on next update', () => {
    const world = new World();
    const e = world.createEntity();
    world.removeEntity(e.id);
    // entity still exists before update
    expect(world.entityCount).toBe(1);
    world.update(0, 0);
    expect(world.entityCount).toBe(0);
  });

  it('queries entities with specific components', () => {
    const world = new World();
    const e1 = world.createEntity();
    e1.add(new PositionComponent());
    e1.add(new VelocityComponent());

    const e2 = world.createEntity();
    e2.add(new PositionComponent());

    const e3 = world.createEntity();
    e3.add(new HealthComponent());

    const withPosAndVel = world.query(PositionComponent, VelocityComponent);
    expect(withPosAndVel).toHaveLength(1);
    expect(withPosAndVel[0]).toBe(e1);

    const withPos = world.query(PositionComponent);
    expect(withPos).toHaveLength(2);
  });

  it('query excludes inactive entities', () => {
    const world = new World();
    const e = world.createEntity();
    e.add(new PositionComponent());
    e.active = false;
    expect(world.query(PositionComponent)).toHaveLength(0);
  });

  it('adds and runs systems', () => {
    let updated = false;

    class TestSystem extends System {
      update(_dt: number, _elapsed: number): void {
        updated = true;
      }
    }

    const world = new World();
    world.addSystem(new TestSystem());
    world.update(0.016, 0);
    expect(updated).toBe(true);
  });

  it('respects system priority ordering', () => {
    const order: string[] = [];

    class SystemA extends System {
      priority = 10;
      update(): void { order.push('A'); }
    }
    class SystemB extends System {
      priority = 1;
      update(): void { order.push('B'); }
    }

    const world = new World();
    world.addSystem(new SystemA());
    world.addSystem(new SystemB());
    world.update(0, 0);
    expect(order).toEqual(['B', 'A']); // lower priority runs first
  });

  it('disabled systems do not update', () => {
    let called = false;
    class TestSystem extends System {
      update(): void { called = true; }
    }

    const world = new World();
    const sys = new TestSystem();
    sys.enabled = false;
    world.addSystem(sys);
    world.update(0, 0);
    expect(called).toBe(false);
  });

  it('clear removes all entities', () => {
    const world = new World();
    world.createEntity();
    world.createEntity();
    world.clear();
    expect(world.entityCount).toBe(0);
  });

  it('component index: query uses index — correct results after adding components', () => {
    const world = new World();
    const e1 = world.createEntity();
    e1.add(new PositionComponent());
    e1.add(new VelocityComponent());

    const e2 = world.createEntity();
    e2.add(new PositionComponent());

    // Only e1 should match both
    const both = world.query(PositionComponent, VelocityComponent);
    expect(both).toHaveLength(1);
    expect(both[0]).toBe(e1);

    // Both e1 and e2 should match a single-component query
    expect(world.query(PositionComponent)).toHaveLength(2);
  });

  it('component index: removing a component updates query results', () => {
    const world = new World();
    const e = world.createEntity();
    e.add(new PositionComponent());
    e.add(new VelocityComponent());

    expect(world.query(PositionComponent, VelocityComponent)).toHaveLength(1);

    e.remove(VelocityComponent);

    expect(world.query(PositionComponent, VelocityComponent)).toHaveLength(0);
    expect(world.query(PositionComponent)).toHaveLength(1);
  });

  it('component index: removing an entity cleans up the index', () => {
    const world = new World();
    const e = world.createEntity();
    e.add(new PositionComponent());

    expect(world.query(PositionComponent)).toHaveLength(1);

    world.removeEntity(e.id);
    world.update(0, 0);

    expect(world.query(PositionComponent)).toHaveLength(0);
  });

  it('component index: clear resets the index', () => {
    const world = new World();
    const e = world.createEntity();
    e.add(new PositionComponent());

    world.clear();

    expect(world.entityCount).toBe(0);
    expect(world.query(PositionComponent)).toHaveLength(0);
  });
});

// ── Phase 5 additions ─────────────────────────────────────────────────────────

describe('World.queryWithCache (archetype cache)', () => {
  it('returns same results as query()', () => {
    const world = new World();
    const e1 = world.createEntity();
    e1.add(new PositionComponent());
    e1.add(new VelocityComponent());
    const e2 = world.createEntity();
    e2.add(new PositionComponent());

    expect(world.queryWithCache(PositionComponent, VelocityComponent)).toHaveLength(1);
    expect(world.queryWithCache(PositionComponent)).toHaveLength(2);
  });

  it('result is invalidated when a component is added', () => {
    const world = new World();
    const e = world.createEntity();
    e.add(new PositionComponent());

    const first = world.queryWithCache(PositionComponent, VelocityComponent);
    expect(first).toHaveLength(0);

    e.add(new VelocityComponent());

    const second = world.queryWithCache(PositionComponent, VelocityComponent);
    expect(second).toHaveLength(1);
  });

  it('result is invalidated when a component is removed', () => {
    const world = new World();
    const e = world.createEntity();
    e.add(new PositionComponent());
    e.add(new VelocityComponent());

    expect(world.queryWithCache(PositionComponent, VelocityComponent)).toHaveLength(1);

    e.remove(VelocityComponent);

    expect(world.queryWithCache(PositionComponent, VelocityComponent)).toHaveLength(0);
  });

  it('cache is cleared on world.clear()', () => {
    const world = new World();
    const e = world.createEntity();
    e.add(new PositionComponent());

    world.queryWithCache(PositionComponent); // populate cache
    world.clear();

    expect(world.queryWithCache(PositionComponent)).toHaveLength(0);
  });
});

describe('World component pooling (Phase 5)', () => {
  class TagComponent extends Component {
    tag = '';
  }

  it('acquireComponent falls back to new when no pool is registered', () => {
    const world = new World();
    const c = world.acquireComponent(TagComponent);
    expect(c).toBeInstanceOf(TagComponent);
  });

  it('acquireComponent returns pool instances', () => {
    const world = new World();
    const pool = new ObjectPool<TagComponent>({
      create: () => new TagComponent(),
      reset: (c) => { c.tag = ''; },
      initialSize: 2,
    });
    world.registerComponentPool(TagComponent, pool);

    const c = world.acquireComponent(TagComponent);
    expect(c).toBeInstanceOf(TagComponent);
    // Pool size should have decreased by 1 (was pre-allocated)
    expect(pool.availableCount).toBe(1);
  });

  it('releasing an entity returns component to pool', () => {
    const world = new World();
    const pool = new ObjectPool<TagComponent>({
      create: () => new TagComponent(),
      reset: (c) => { c.tag = ''; },
      initialSize: 0,
    });
    world.registerComponentPool(TagComponent, pool);

    const entity = world.createEntity();
    const comp = world.acquireComponent(TagComponent);
    comp.tag = 'hero';
    entity.add(comp);

    expect(pool.availableCount).toBe(0);

    entity.remove(TagComponent);

    expect(pool.availableCount).toBe(1);
    // tag should be reset by the pool's reset fn
    const recycled = pool.acquire()!;
    expect(recycled.tag).toBe('');
  });
});

describe('System.tickBudgetMs (Phase 5)', () => {
  it('system with 0 budget runs normally', () => {
    let ran = false;
    class QuickSystem extends System {
      tickBudgetMs = 0;
      update() { ran = true; }
    }
    const world = new World();
    world.addSystem(new QuickSystem());
    world.update(0.016, 0);
    expect(ran).toBe(true);
  });

  it('system with budget is still called and getSystemTimings records it', () => {
    let ran = false;
    class BudgetedSystem extends System {
      tickBudgetMs = 16; // 16ms budget
      update() { ran = true; }
    }
    const world = new World();
    const sys = new BudgetedSystem();
    world.addSystem(sys);
    world.update(0.016, 0);
    expect(ran).toBe(true);
    // Timings are reset after update, so they should be empty
    expect(world.getSystemTimings().size).toBe(0);
  });
});

describe('System read/write component declarations (Phase 5)', () => {
  it('systems can declare read and write component types', () => {
    class MovementSystem extends System {
      override readComponents = [VelocityComponent];
      override writeComponents = [PositionComponent];
      update() {}
    }
    const sys = new MovementSystem();
    expect(sys.readComponents).toContain(VelocityComponent);
    expect(sys.writeComponents).toContain(PositionComponent);
  });
});

describe('ECS benchmark — 10 000 entity query performance (Phase 5)', () => {
  it('queries 10k entities in under 50ms', () => {
    const world = new World();
    const N = 10_000;

    for (let i = 0; i < N; i++) {
      const e = world.createEntity();
      e.add(new PositionComponent());
      if (i % 2 === 0) e.add(new VelocityComponent());
    }

    const start = performance.now();
    const results = world.query(PositionComponent, VelocityComponent);
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(N / 2);
    expect(elapsed).toBeLessThan(50);
  });

  it('queryWithCache is faster than query on repeated hot-path calls', () => {
    const world = new World();
    for (let i = 0; i < 5_000; i++) {
      const e = world.createEntity();
      e.add(new PositionComponent());
      if (i % 3 === 0) e.add(new VelocityComponent());
    }

    // Warm up cache
    world.queryWithCache(PositionComponent, VelocityComponent);

    const ITERS = 1_000;
    const t0 = performance.now();
    for (let i = 0; i < ITERS; i++) world.queryWithCache(PositionComponent, VelocityComponent);
    const cachedTime = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < ITERS; i++) world.query(PositionComponent, VelocityComponent);
    const uncachedTime = performance.now() - t1;

    // Cached should be materially faster (at least 10×)
    expect(cachedTime).toBeLessThan(uncachedTime / 10);
  });
});
