/**
 * AssetDependencyGraph — Tracks references between assets and scene objects.
 * Features:
 * - Dependency tracking (which objects use which assets)
 * - Unused asset detection
 * - Asset reference counting
 * - Batch import with auto-classification
 * - Streaming/lazy loader for large scenes
 * - Asset migration & cleanup utilities
 */

import * as THREE from 'three';

export type AssetKind = 'texture' | 'model' | 'audio' | 'material' | 'prefab' | 'script' | 'scene';

export interface AssetNode {
  id: string;
  kind: AssetKind;
  name: string;
  path: string;
  sizeBytes: number;
  /** IDs of assets this asset depends on (e.g., a material depends on its textures) */
  dependencies: Set<string>;
  /** IDs of assets/objects that reference this asset */
  referencedBy: Set<string>;
  metadata: Record<string, unknown>;
  lastAccessed: number;
}

export interface AssetUsageReport {
  totalAssets: number;
  usedAssets: number;
  unusedAssets: AssetNode[];
  totalSizeBytes: number;
  unusedSizeBytes: number;
  /** Assets with most references */
  hotAssets: Array<{ asset: AssetNode; refCount: number }>;
  /** Broken references (referencing non-existent assets) */
  brokenRefs: Array<{ from: string; to: string }>;
}

export class AssetDependencyGraph {
  private nodes = new Map<string, AssetNode>();
  private onChangeCallbacks: Array<() => void> = [];

  // ─── Node Management ──────────────────────────────

  register(id: string, kind: AssetKind, name: string, path: string, sizeBytes = 0): AssetNode {
    if (this.nodes.has(id)) return this.nodes.get(id)!;
    const node: AssetNode = {
      id, kind, name, path, sizeBytes,
      dependencies: new Set(),
      referencedBy: new Set(),
      metadata: {},
      lastAccessed: Date.now(),
    };
    this.nodes.set(id, node);
    this.notifyChange();
    return node;
  }

  unregister(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    // Clean up references
    for (const depId of node.dependencies) {
      this.nodes.get(depId)?.referencedBy.delete(id);
    }
    for (const refId of node.referencedBy) {
      this.nodes.get(refId)?.dependencies.delete(id);
    }
    this.nodes.delete(id);
    this.notifyChange();
  }

  get(id: string): AssetNode | undefined {
    const node = this.nodes.get(id);
    if (node) node.lastAccessed = Date.now();
    return node;
  }

  // ─── Dependency Edges ─────────────────────────────

  addDependency(fromId: string, toId: string): void {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) return;
    from.dependencies.add(toId);
    to.referencedBy.add(fromId);
  }

  removeDependency(fromId: string, toId: string): void {
    this.nodes.get(fromId)?.dependencies.delete(toId);
    this.nodes.get(toId)?.referencedBy.delete(fromId);
  }

  addObjectReference(objectName: string, assetId: string): void {
    const node = this.nodes.get(assetId);
    if (node) node.referencedBy.add(`obj:${objectName}`);
  }

  removeObjectReference(objectName: string, assetId: string): void {
    this.nodes.get(assetId)?.referencedBy.delete(`obj:${objectName}`);
  }

  // ─── Queries ──────────────────────────────────────

  getDependencies(id: string): AssetNode[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    return [...node.dependencies].map(d => this.nodes.get(d)).filter(Boolean) as AssetNode[];
  }

  getReferencedBy(id: string): string[] {
    const node = this.nodes.get(id);
    return node ? [...node.referencedBy] : [];
  }

  getReferenceCount(id: string): number {
    return this.nodes.get(id)?.referencedBy.size ?? 0;
  }

  getUnused(): AssetNode[] {
    return [...this.nodes.values()].filter(n => n.referencedBy.size === 0);
  }

  getByKind(kind: AssetKind): AssetNode[] {
    return [...this.nodes.values()].filter(n => n.kind === kind);
  }

  search(query: string): AssetNode[] {
    const q = query.toLowerCase();
    return [...this.nodes.values()].filter(n =>
      n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)
    );
  }

  // ─── Analysis ─────────────────────────────────────

  generateReport(): AssetUsageReport {
    const all = [...this.nodes.values()];
    const unused = all.filter(n => n.referencedBy.size === 0);
    const brokenRefs: AssetUsageReport['brokenRefs'] = [];

    for (const node of all) {
      for (const depId of node.dependencies) {
        if (!this.nodes.has(depId)) {
          brokenRefs.push({ from: node.id, to: depId });
        }
      }
    }

    const hotAssets = all
      .map(a => ({ asset: a, refCount: a.referencedBy.size }))
      .sort((a, b) => b.refCount - a.refCount)
      .slice(0, 10);

    return {
      totalAssets: all.length,
      usedAssets: all.length - unused.length,
      unusedAssets: unused,
      totalSizeBytes: all.reduce((sum, n) => sum + n.sizeBytes, 0),
      unusedSizeBytes: unused.reduce((sum, n) => sum + n.sizeBytes, 0),
      hotAssets,
      brokenRefs,
    };
  }

  // ─── Scene Scanner ────────────────────────────────

  /** Scan a Three.js scene and auto-register texture/material references */
  scanScene(scene: THREE.Object3D): void {
    scene.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) {
          const matId = `mat:${mat.uuid}`;
          this.register(matId, 'material', mat.name || mat.type, '', 0);
          this.addObjectReference(obj.name || obj.uuid, matId);

          // Scan texture slots
          const texSlots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'displacementMap', 'alphaMap', 'envMap', 'lightMap', 'bumpMap'] as const;
          for (const slot of texSlots) {
            const tex = (mat as any)[slot] as THREE.Texture | null;
            if (tex) {
              const texId = `tex:${tex.uuid}`;
              this.register(texId, 'texture', tex.name || slot, '', 0);
              this.addDependency(matId, texId);
            }
          }
        }
      }
    });
  }

  // ─── Batch Classification ─────────────────────────

  /** Auto-classify a list of files by extension */
  static classifyFiles(files: File[]): Map<AssetKind, File[]> {
    const result = new Map<AssetKind, File[]>();
    const kindMap: Record<string, AssetKind> = {
      '.png': 'texture', '.jpg': 'texture', '.jpeg': 'texture', '.webp': 'texture',
      '.bmp': 'texture', '.hdr': 'texture', '.exr': 'texture', '.tga': 'texture',
      '.glb': 'model', '.gltf': 'model', '.fbx': 'model', '.obj': 'model', '.dae': 'model',
      '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.flac': 'audio', '.m4a': 'audio',
      '.scene': 'scene', '.prefab': 'prefab', '.ts': 'script', '.js': 'script',
      '.mat': 'material',
    };

    for (const file of files) {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      const kind = kindMap[ext] ?? 'model';
      if (!result.has(kind)) result.set(kind, []);
      result.get(kind)!.push(file);
    }

    return result;
  }

  // ─── Serialization ────────────────────────────────

  serialize(): string {
    const entries = [...this.nodes.values()].map(n => ({
      id: n.id, kind: n.kind, name: n.name, path: n.path, sizeBytes: n.sizeBytes,
      dependencies: [...n.dependencies],
      referencedBy: [...n.referencedBy],
      metadata: n.metadata,
    }));
    return JSON.stringify(entries);
  }

  deserialize(json: string): void {
    this.nodes.clear();
    const entries = JSON.parse(json) as Array<{
      id: string; kind: AssetKind; name: string; path: string; sizeBytes: number;
      dependencies: string[]; referencedBy: string[]; metadata: Record<string, unknown>;
    }>;
    for (const e of entries) {
      this.nodes.set(e.id, {
        id: e.id, kind: e.kind, name: e.name, path: e.path, sizeBytes: e.sizeBytes,
        dependencies: new Set(e.dependencies),
        referencedBy: new Set(e.referencedBy),
        metadata: e.metadata,
        lastAccessed: Date.now(),
      });
    }
    this.notifyChange();
  }

  get size(): number { return this.nodes.size; }

  onChange(cb: () => void): void { this.onChangeCallbacks.push(cb); }

  private notifyChange(): void { for (const cb of this.onChangeCallbacks) cb(); }
}

// ─── Streaming Asset Loader ──────────────────────────

export interface StreamingConfig {
  /** Distance from camera to start loading assets */
  loadDistance: number;
  /** Distance at which assets are unloaded */
  unloadDistance: number;
  /** Maximum concurrent loads */
  maxConcurrent: number;
}

export interface StreamingAsset {
  id: string;
  position: THREE.Vector3;
  loadFn: () => Promise<THREE.Object3D>;
  unloadFn?: (obj: THREE.Object3D) => void;
  loaded: boolean;
  loading: boolean;
  object: THREE.Object3D | null;
}

export class StreamingAssetLoader {
  private assets: StreamingAsset[] = [];
  private activeLoads = 0;
  private config: StreamingConfig;

  constructor(config: Partial<StreamingConfig> = {}) {
    this.config = {
      loadDistance: config.loadDistance ?? 100,
      unloadDistance: config.unloadDistance ?? 150,
      maxConcurrent: config.maxConcurrent ?? 4,
    };
  }

  register(asset: StreamingAsset): void {
    this.assets.push(asset);
  }

  unregister(id: string): void {
    const idx = this.assets.findIndex(a => a.id === id);
    if (idx !== -1) {
      const asset = this.assets[idx];
      if (asset.loaded && asset.object) {
        asset.unloadFn?.(asset.object);
        asset.object.removeFromParent();
      }
      this.assets.splice(idx, 1);
    }
  }

  /** Call each frame to check distances and load/unload */
  update(cameraPosition: THREE.Vector3, scene: THREE.Scene): void {
    for (const asset of this.assets) {
      const dist = cameraPosition.distanceTo(asset.position);

      if (!asset.loaded && !asset.loading && dist < this.config.loadDistance) {
        if (this.activeLoads < this.config.maxConcurrent) {
          this.loadAsset(asset, scene);
        }
      } else if (asset.loaded && asset.object && dist > this.config.unloadDistance) {
        this.unloadAsset(asset);
      }
    }
  }

  private async loadAsset(asset: StreamingAsset, scene: THREE.Scene): Promise<void> {
    asset.loading = true;
    this.activeLoads++;

    try {
      const obj = await asset.loadFn();
      asset.object = obj;
      asset.loaded = true;
      scene.add(obj);
    } catch (e) {
      console.warn(`[StreamingLoader] Failed to load ${asset.id}:`, e);
    } finally {
      asset.loading = false;
      this.activeLoads--;
    }
  }

  private unloadAsset(asset: StreamingAsset): void {
    if (asset.object) {
      asset.unloadFn?.(asset.object);
      asset.object.removeFromParent();
    }
    asset.object = null;
    asset.loaded = false;
  }

  getStats(): { total: number; loaded: number; loading: number } {
    return {
      total: this.assets.length,
      loaded: this.assets.filter(a => a.loaded).length,
      loading: this.assets.filter(a => a.loading).length,
    };
  }

  dispose(): void {
    for (const asset of this.assets) {
      if (asset.loaded && asset.object) {
        asset.unloadFn?.(asset.object);
        asset.object.removeFromParent();
      }
    }
    this.assets = [];
  }
}
