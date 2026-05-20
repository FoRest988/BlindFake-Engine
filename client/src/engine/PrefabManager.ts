// ─── Prefab Manager ─────────────────────────────────────────────────
// Template-based object instantiation with variants, pooling,
// override tracking, and scene snapshot support.

import * as THREE from 'three';

export interface PrefabComponentData {
  type: string;
  data: Record<string, unknown>;
}

export interface PrefabDefinition {
  id: string;
  name: string;
  tags?: string[];
  components: PrefabComponentData[];
  children?: PrefabDefinition[];
  /** Optional reference to a parent prefab for variant system */
  basePrefabId?: string;
  /** Overrides on top of the base prefab */
  overrides?: Record<string, Record<string, unknown>>;
  /** Metadata */
  thumbnail?: string;
  description?: string;
  createdAt?: number;
}

export class PrefabManager {
  private prefabs = new Map<string, PrefabDefinition>();
  private pools = new Map<string, THREE.Object3D[]>();
  private activePooled = new Map<string, Set<THREE.Object3D>>();
  private onChangeCallbacks: (() => void)[] = [];

  /** Register a prefab template */
  register(prefab: PrefabDefinition): void {
    this.prefabs.set(prefab.id, prefab);
    this.notifyChange();
  }

  /** Get a prefab definition */
  get(id: string): PrefabDefinition | undefined {
    return this.prefabs.get(id);
  }

  /** Check if a prefab exists */
  has(id: string): boolean {
    return this.prefabs.has(id);
  }

  /** Clone a prefab definition with optional overrides */
  clone(id: string, overrides?: Partial<Record<string, Record<string, unknown>>>): PrefabDefinition | null {
    const resolved = this.resolve(id);
    if (!resolved) return null;

    const cloned: PrefabDefinition = JSON.parse(JSON.stringify(resolved));
    cloned.id = `${id}_${Date.now()}`;

    if (overrides) {
      for (const comp of cloned.components) {
        if (overrides[comp.type]) {
          Object.assign(comp.data, overrides[comp.type]);
        }
      }
    }

    return cloned;
  }

  /** Resolve a prefab, applying base prefab inheritance chain */
  resolve(id: string): PrefabDefinition | null {
    const prefab = this.prefabs.get(id);
    if (!prefab) return null;

    if (!prefab.basePrefabId) return prefab;

    // Resolve base chain (max 10 levels to prevent infinite loops)
    let base = this.prefabs.get(prefab.basePrefabId);
    let depth = 0;
    const chain: PrefabDefinition[] = [prefab];
    while (base && depth < 10) {
      chain.unshift(base);
      if (!base.basePrefabId) break;
      base = this.prefabs.get(base.basePrefabId);
      depth++;
    }

    // Merge: start from the root base and apply each override layer
    const result: PrefabDefinition = JSON.parse(JSON.stringify(chain[0]));
    result.id = id;
    result.name = prefab.name;

    for (let i = 1; i < chain.length; i++) {
      const layer = chain[i];
      if (layer.overrides) {
        for (const comp of result.components) {
          if (layer.overrides[comp.type]) {
            Object.assign(comp.data, layer.overrides[comp.type]);
          }
        }
      }
      // Add any new components from the variant
      if (layer.components) {
        for (const comp of layer.components) {
          if (!result.components.find(c => c.type === comp.type)) {
            result.components.push(JSON.parse(JSON.stringify(comp)));
          }
        }
      }
    }

    return result;
  }

  /** Create a variant of an existing prefab */
  createVariant(baseId: string, name: string, overrides?: Record<string, Record<string, unknown>>): PrefabDefinition | null {
    if (!this.prefabs.has(baseId)) return null;
    const variant: PrefabDefinition = {
      id: `${baseId}_variant_${Date.now()}`,
      name,
      basePrefabId: baseId,
      overrides: overrides ?? {},
      components: [],
      createdAt: Date.now(),
    };
    this.register(variant);
    return variant;
  }

  /** Create a prefab from a Three.js scene object (snapshot) */
  createFromSceneObject(object: THREE.Object3D, name?: string): PrefabDefinition {
    const prefab: PrefabDefinition = {
      id: `prefab_${Date.now()}`,
      name: name ?? (object.name || 'Scene Prefab'),
      components: [],
      children: [],
      createdAt: Date.now(),
    };

    // Extract transform
    prefab.components.push({
      type: 'TransformComponent',
      data: {
        position: { x: object.position.x, y: object.position.y, z: object.position.z },
        rotation: { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z },
        scale: { x: object.scale.x, y: object.scale.y, z: object.scale.z },
      },
    });

    // Extract mesh info
    if (object instanceof THREE.Mesh) {
      const geo = object.geometry;
      const mat = object.material;
      prefab.components.push({
        type: 'MeshComponent',
        data: {
          geometryType: geo.type,
          geometryParams: (geo as any).parameters ?? {},
          materialType: Array.isArray(mat) ? mat[0]?.type : mat?.type,
          materialColor: Array.isArray(mat) ? undefined : (mat as THREE.MeshStandardMaterial).color?.getHex(),
          castShadow: object.castShadow,
          receiveShadow: object.receiveShadow,
        },
      });
    }

    // Extract light info
    if (object instanceof THREE.Light) {
      prefab.components.push({
        type: 'LightComponent',
        data: {
          lightType: object.type,
          color: object.color.getHex(),
          intensity: object.intensity,
        },
      });
    }

    // Recurse children
    for (const child of object.children) {
      if (child.name.startsWith('__')) continue; // skip internal helpers
      prefab.children!.push(this.createFromSceneObject(child, child.name));
    }

    this.register(prefab);
    return prefab;
  }

  // ── Object Pool ─────────────────────────────────────────────────

  /** Pre-warm a pool for a prefab */
  warmPool(id: string, count: number, factory: (def: PrefabDefinition) => THREE.Object3D): void {
    const def = this.resolve(id);
    if (!def) return;

    if (!this.pools.has(id)) this.pools.set(id, []);
    if (!this.activePooled.has(id)) this.activePooled.set(id, new Set());

    const pool = this.pools.get(id)!;
    for (let i = 0; i < count; i++) {
      const obj = factory(def);
      obj.visible = false;
      pool.push(obj);
    }
  }

  /** Get an object from the pool (or create new) */
  spawn(id: string, factory: (def: PrefabDefinition) => THREE.Object3D): THREE.Object3D | null {
    const def = this.resolve(id);
    if (!def) return null;

    if (!this.pools.has(id)) this.pools.set(id, []);
    if (!this.activePooled.has(id)) this.activePooled.set(id, new Set());

    const pool = this.pools.get(id)!;
    const active = this.activePooled.get(id)!;

    let obj: THREE.Object3D;
    if (pool.length > 0) {
      obj = pool.pop()!;
      obj.visible = true;
    } else {
      obj = factory(def);
    }

    active.add(obj);
    return obj;
  }

  /** Return an object to the pool */
  despawn(id: string, obj: THREE.Object3D): void {
    const pool = this.pools.get(id);
    const active = this.activePooled.get(id);
    if (!pool || !active) return;

    active.delete(obj);
    obj.visible = false;
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.scale.set(1, 1, 1);
    pool.push(obj);
  }

  /** Get pool stats */
  getPoolStats(id: string): { available: number; active: number } | null {
    const pool = this.pools.get(id);
    const active = this.activePooled.get(id);
    if (!pool && !active) return null;
    return { available: pool?.length ?? 0, active: active?.size ?? 0 };
  }

  // ── Query & Manage ──────────────────────────────────────────────

  /** Get all prefabs, optionally filtered by tag */
  getAll(tag?: string): PrefabDefinition[] {
    const all = Array.from(this.prefabs.values());
    if (!tag) return all;
    return all.filter(p => p.tags?.includes(tag));
  }

  /** Search prefabs by name (case-insensitive) */
  search(query: string): PrefabDefinition[] {
    const q = query.toLowerCase();
    return Array.from(this.prefabs.values()).filter(p =>
      p.name.toLowerCase().includes(q) || p.tags?.some(t => t.toLowerCase().includes(q))
    );
  }

  /** Remove a prefab */
  remove(id: string): boolean {
    const result = this.prefabs.delete(id);
    if (result) this.notifyChange();
    return result;
  }

  /** Get all variants of a base prefab */
  getVariants(baseId: string): PrefabDefinition[] {
    return Array.from(this.prefabs.values()).filter(p => p.basePrefabId === baseId);
  }

  /** Serialize all prefabs */
  serialize(): object {
    return Array.from(this.prefabs.values());
  }

  /** Deserialize prefabs */
  deserialize(data: PrefabDefinition[]): void {
    this.prefabs.clear();
    data.forEach(p => this.register(p));
  }

  /** Export a single prefab as JSON */
  exportPrefab(id: string): string | null {
    const def = this.resolve(id);
    if (!def) return null;
    return JSON.stringify(def, null, 2);
  }

  /** Import a prefab from JSON */
  importPrefab(json: string): PrefabDefinition | null {
    try {
      const def = JSON.parse(json) as PrefabDefinition;
      if (!def.id || !def.name) return null;
      this.register(def);
      return def;
    } catch {
      return null;
    }
  }

  /** Subscribe to changes */
  onChange(cb: () => void): void {
    this.onChangeCallbacks.push(cb);
  }

  private notifyChange(): void {
    for (const cb of this.onChangeCallbacks) cb();
  }
}
