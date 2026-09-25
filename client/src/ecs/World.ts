import { Entity } from './Entity';
import { System } from './System';
import { Component, ComponentClass } from './Component';

// ── Archetype cache entry ─────────────────────────────────────────────────────
// A lightweight snapshot of matching entities for a specific component signature.
// Invalidated whenever any entity gains or loses a component in the signature.

interface ArchetypeCache {
  entities: Entity[];
  dirty: boolean;
  /** Numeric ids of the component types in this signature (see _typeKey). */
  typeIds: Set<number>;
}

export class World {
  private entities = new Map<number, Entity>();
  private systems: System[] = [];
  private nextEntityId = 1;
  private entitiesToRemove: number[] = [];

  /** Inverted index: ComponentClass → Set of entity IDs that own it. Enables O(1) query. */
  private componentIndex = new Map<ComponentClass, Set<number>>();

  // ── Archetype query cache ───────────────────────────────────────────────────
  // Key: sorted numeric type ids joined by '|' (ids are assigned per constructor,
  // so minification and duplicate class names cannot collide).
  private archetypeCache = new Map<string, ArchetypeCache>();

  // ── Per-system frame timing (double buffered) ────────────────────────────────
  /** ms consumed by each system during the frame being updated. */
  private currentFrameMs = new Map<System, number>();
  /** ms consumed by each system during the last completed frame. */
  private lastFrameMs = new Map<System, number>();

  private _indexAdd(entityId: number, type: ComponentClass): void {
    let set = this.componentIndex.get(type);
    if (!set) {
      set = new Set();
      this.componentIndex.set(type, set);
    }
    set.add(entityId);
    this._invalidateCachesFor(type);
  }

  private _indexRemove(entityId: number, type: ComponentClass): void {
    this.componentIndex.get(type)?.delete(entityId);
    this._invalidateCachesFor(type);
  }

  private _invalidateCachesFor(type: ComponentClass): void {
    const id = _typeKey(type);
    for (const entry of this.archetypeCache.values()) {
      if (entry.typeIds.has(id)) entry.dirty = true;
    }
  }

  createEntity(name?: string): Entity {
    const id = this.nextEntityId++;
    const entity = new Entity(id, name);
    entity._onComponentAdded = (type) => this._indexAdd(entity.id, type);
    entity._onComponentRemoved = (type, comp) => {
      this._indexRemove(entity.id, type);
      comp?.dispose?.();
    };
    this.entities.set(id, entity);
    return entity;
  }

  removeEntity(id: number): void {
    this.entitiesToRemove.push(id);
  }

  getEntity(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  /**
   * Query entities that have ALL of the specified component types.
   * Uses the component index to start from the smallest candidate set — O(k) where k
   * is the size of the rarest component set, rather than O(n) over all entities.
   */
  query(...componentTypes: ComponentClass[]): Entity[] {
    if (componentTypes.length === 0) {
      const result: Entity[] = [];
      for (const e of this.entities.values()) { if (e.active) result.push(e); }
      return result;
    }

    // Pick the component type with the fewest owners as the starting set
    let smallestType = componentTypes[0];
    let smallestSize = this.componentIndex.get(smallestType)?.size ?? 0;
    for (let i = 1; i < componentTypes.length; i++) {
      const s = this.componentIndex.get(componentTypes[i])?.size ?? 0;
      if (s < smallestSize) { smallestType = componentTypes[i]; smallestSize = s; }
    }

    const candidates = this.componentIndex.get(smallestType);
    if (!candidates || candidates.size === 0) return [];

    const rest = componentTypes.filter(t => t !== smallestType);
    const result: Entity[] = [];
    for (const id of candidates) {
      const entity = this.entities.get(id);
      if (entity && entity.active && rest.every(t => entity.has(t))) {
        result.push(entity);
      }
    }
    return result;
  }

  /**
   * Like `query()` but the result is cached and only recomputed when an entity
   * gains or loses a component in the queried set. Use this for hot-path queries
   * that run every frame with the same component signature.
   *
   * **Important:** Do NOT mutate the returned array — it is the live cache slice.
   * If you need to add/remove during iteration, use `query()` instead.
   */
  queryWithCache(...componentTypes: ComponentClass[]): readonly Entity[] {
    const key = _archetypeKey(componentTypes);
    let entry = this.archetypeCache.get(key);
    if (!entry) {
      entry = { entities: [], dirty: true, typeIds: new Set(componentTypes.map(_typeKey)) };
      this.archetypeCache.set(key, entry);
    }
    if (entry.dirty) {
      entry.entities = this.query(...componentTypes);
      entry.dirty = false;
    }
    return entry.entities;
  }

  addSystem(system: System): void {
    system.world = this;
    this.systems.push(system);
    this.systems.sort((a, b) => a.priority - b.priority);
    system.init();
  }

  getSystem<T extends System>(type: new (...args: any[]) => T): T | undefined {
    return this.systems.find((s) => s instanceof type) as T | undefined;
  }

  removeSystem(system: System): void {
    const idx = this.systems.indexOf(system);
    if (idx !== -1) {
      this.systems.splice(idx, 1);
      system.destroy();
    }
  }

  update(delta: number, elapsed: number, mode: 'edit' | 'play' = 'play'): void {
    // Remove queued entities
    for (const id of this.entitiesToRemove) {
      const entity = this.entities.get(id);
      if (entity) {
        // Release component resources and clean the index before dispose clears the internal map
        for (const comp of entity.getAll()) comp.dispose?.();
        for (const type of entity.getComponentTypes()) {
          this._indexRemove(id, type);
        }
        entity.dispose();
        this.entities.delete(id);
      }
    }
    this.entitiesToRemove.length = 0;

    // Update all systems, timing each one
    this.currentFrameMs.clear();
    for (const system of this.systems) {
      if (!system.enabled) continue;
      if (mode === 'edit' && !system.runsInEditMode) continue;
      const start = performance.now();
      system.update(delta, elapsed);
      this.currentFrameMs.set(system, performance.now() - start);
    }

    // Swap timing buffers so getSystemTimings() reports the frame that just finished
    const finished = this.currentFrameMs;
    this.currentFrameMs = this.lastFrameMs;
    this.lastFrameMs = finished;
  }

  /** Milliseconds consumed by each system during the last completed frame. */
  getSystemTimings(): ReadonlyMap<System, number> {
    return this.lastFrameMs;
  }

  /** All registered systems in priority order. */
  getSystems(): readonly System[] {
    return this.systems;
  }

  get entityCount(): number {
    return this.entities.size;
  }

  /** Iterable access to all entities */
  get allEntities(): IterableIterator<Entity> {
    return this.entities.values();
  }

  clear(): void {
    for (const entity of this.entities.values()) {
      for (const comp of entity.getAll()) comp.dispose?.();
      entity.dispose();
    }
    this.entities.clear();
    this.componentIndex.clear();
    this.archetypeCache.clear();
    this.nextEntityId = 1;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const typeIds = new WeakMap<ComponentClass, number>();
let nextTypeId = 1;

/** Stable numeric id for a ComponentClass (assigned on first use; survives minification). */
function _typeKey(type: ComponentClass): number {
  let id = typeIds.get(type);
  if (id === undefined) {
    id = nextTypeId++;
    typeIds.set(type, id);
  }
  return id;
}

/** Stable cache key for a component-type signature (order-independent). */
function _archetypeKey(types: ComponentClass[]): string {
  return types.map(_typeKey).sort((a, b) => a - b).join('|');
}
