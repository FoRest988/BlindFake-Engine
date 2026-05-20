/**
 * AssetManifest — Per-project registry of all known assets.
 *
 * Tracks URLs, sizes, types, and optional KTX2-compressed variants.
 * Enables accurate pre-load progress bars and priority-based streaming.
 *
 * Usage:
 *   const manifest = new AssetManifest();
 *   manifest.add({ url: '/models/tree.glb', type: 'model', name: 'Tree', size: 204800, critical: true });
 *   manifest.save('my-project-id');
 *
 *   // In engine init:
 *   manifest.load('my-project-id');
 *   await manifest.preloadAll(engine.assets, (n, t) => console.log(`${n}/${t}`));
 */

import type { AssetManager } from './AssetManager';

// ── Types ────────────────────────────────────────────────────────────────────

export type ManifestAssetType =
  | 'model'
  | 'texture'
  | 'audio'
  | 'scene'
  | 'prefab'
  | 'script'
  | 'material'
  | 'unknown';

export interface ManifestEntry {
  /** URL or path used to load the asset. */
  url: string;
  type: ManifestAssetType;
  /** Display name (file name without extension is fine). */
  name: string;
  /** File size in bytes (0 = unknown). Used for progress estimation. */
  size: number;
  /** Optional KTX2-compressed URL for textures (replaces `url` when available). */
  ktx2Url?: string;
  /** If true, this asset is loaded before the game starts. */
  critical?: boolean;
  /** Load priority. Higher = loaded sooner in the streaming queue. Default 0. */
  priority?: number;
}

export interface ManifestSnapshot {
  version: 1;
  projectId: string;
  savedAt: number;
  entries: ManifestEntry[];
  totalBytes: number;
}

// ── Class ────────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'blindfake_manifest_';

export class AssetManifest {
  private _entries = new Map<string, ManifestEntry>();
  private _projectId = '';

  // ── CRUD ─────────────────────────────────────────────────────────────────

  /** Add or update a manifest entry (keyed by url). */
  add(entry: ManifestEntry): void {
    this._entries.set(entry.url, { priority: 0, ...entry });
  }

  /** Add multiple entries at once. */
  addAll(entries: ManifestEntry[]): void {
    for (const e of entries) this.add(e);
  }

  /** Remove an entry by URL. */
  remove(url: string): void {
    this._entries.delete(url);
  }

  /** Get a single entry by URL. */
  get(url: string): ManifestEntry | undefined {
    return this._entries.get(url);
  }

  /** All entries as an array. */
  all(): ManifestEntry[] {
    return [...this._entries.values()];
  }

  /** Entries filtered by type. */
  ofType(type: ManifestAssetType): ManifestEntry[] {
    return this.all().filter(e => e.type === type);
  }

  /** Critical entries (critical flag or priority > 0). */
  critical(): ManifestEntry[] {
    return this.all().filter(e => e.critical || (e.priority ?? 0) > 0);
  }

  /** Total number of entries. */
  get size(): number {
    return this._entries.size;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  /** Total declared size in bytes. */
  totalBytes(): number {
    let sum = 0;
    for (const e of this._entries.values()) sum += e.size;
    return sum;
  }

  /** Human-readable total size string. */
  totalSizeString(): string {
    const bytes = this.totalBytes();
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }

  /** Count per type. */
  breakdown(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of this._entries.values()) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    }
    return counts;
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  toJSON(): ManifestSnapshot {
    return {
      version: 1,
      projectId: this._projectId,
      savedAt: Date.now(),
      entries: this.all(),
      totalBytes: this.totalBytes(),
    };
  }

  fromJSON(snapshot: ManifestSnapshot): void {
    this._projectId = snapshot.projectId;
    this._entries.clear();
    for (const entry of snapshot.entries) this._entries.set(entry.url, entry);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  /** Persist manifest to localStorage. */
  save(projectId: string): void {
    this._projectId = projectId;
    try {
      localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(this.toJSON()));
    } catch { /* ignore quota errors */ }
  }

  /**
   * Restore manifest from localStorage.
   * @returns true if a saved manifest was found.
   */
  load(projectId: string): boolean {
    this._projectId = projectId;
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + projectId);
      if (!raw) return false;
      const snapshot = JSON.parse(raw) as ManifestSnapshot;
      if (snapshot.version !== 1) return false;
      this.fromJSON(snapshot);
      return true;
    } catch {
      return false;
    }
  }

  /** Remove saved manifest from localStorage and clear entries. */
  clear(projectId?: string): void {
    const id = projectId ?? this._projectId;
    if (id) {
      try { localStorage.removeItem(STORAGE_PREFIX + id); } catch { /* ignore */ }
    }
    this._entries.clear();
  }

  // ── Streaming helpers ─────────────────────────────────────────────────────

  /**
   * Send all loadable manifest entries into the AssetManager streaming queue.
   * Critical / high-priority entries are dispatched first.
   *
   * @param assetManager  Engine AssetManager instance.
   * @param onProgress    Optional callback (loaded, total) for progress UI.
   */
  async preloadAll(
    assetManager: AssetManager,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const loadable = this.all().filter(
      e => e.type === 'model' || e.type === 'texture' || e.type === 'audio',
    );
    // Descending priority
    const sorted = [...loadable].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    let loaded = 0;
    const total = sorted.length;

    await Promise.all(
      sorted.map(entry => {
        // Use KTX2 URL for textures when available
        const effectiveUrl = (entry.type === 'texture' && entry.ktx2Url) ? entry.ktx2Url : entry.url;
        return assetManager
          .enqueue(effectiveUrl, entry.type as 'model' | 'texture' | 'audio', entry.priority)
          .then(() => { loaded++; onProgress?.(loaded, total); })
          .catch(e => console.warn(`[AssetManifest] Failed: ${entry.url}`, e));
      }),
    );
  }
}
