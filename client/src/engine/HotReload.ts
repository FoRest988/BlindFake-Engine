/**
 * HotReload — Watches for file changes and hot-reloads assets/scripts/shaders
 * without requiring a full page reload. Works with Vite's import.meta.hot
 * and also provides manual asset re-loading capabilities.
 */

import * as THREE from 'three';

export interface HotReloadConfig {
  /** Enable hot reload for scripts */
  scripts: boolean;
  /** Enable hot reload for assets (textures, models) */
  assets: boolean;
  /** Enable hot reload for shaders */
  shaders: boolean;
  /** Debounce time (ms) before applying changes */
  debounce: number;
}

export type ReloadHandler = (path: string, module?: unknown) => void;

export class HotReloadSystem {
  private config: HotReloadConfig;
  private handlers = new Map<string, ReloadHandler[]>();
  private watchers: Array<() => void> = [];
  private pendingReloads = new Map<string, ReturnType<typeof setTimeout>>();
  private reloadCount = 0;
  private isEnabled = true;
  private statusCallback?: (msg: string) => void;

  constructor(config: Partial<HotReloadConfig> = {}) {
    this.config = {
      scripts: true,
      assets: true,
      shaders: true,
      debounce: 300,
      ...config,
    };

    this.setupViteHMR();
  }

  /** Register handler for a specific file pattern (glob-ish) */
  on(pattern: string, handler: ReloadHandler): void {
    if (!this.handlers.has(pattern)) {
      this.handlers.set(pattern, []);
    }
    this.handlers.get(pattern)!.push(handler);
  }

  /** Remove handler for a pattern */
  off(pattern: string, handler: ReloadHandler): void {
    const list = this.handlers.get(pattern);
    if (list) {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  /** Set a status callback (e.g., show in editor status bar) */
  onStatus(cb: (msg: string) => void): void {
    this.statusCallback = cb;
  }

  /** Manually trigger reload for a path */
  triggerReload(path: string, module?: unknown): void {
    if (!this.isEnabled) return;

    // Debounce
    const existing = this.pendingReloads.get(path);
    if (existing) clearTimeout(existing);

    this.pendingReloads.set(path, setTimeout(() => {
      this.pendingReloads.delete(path);
      this.executeReload(path, module);
    }, this.config.debounce));
  }

  private executeReload(path: string, module?: unknown): void {
    this.reloadCount++;
    const startTime = performance.now();

    let handled = false;

    for (const [pattern, handlers] of this.handlers) {
      if (this.matchPattern(path, pattern)) {
        for (const handler of handlers) {
          try {
            handler(path, module);
            handled = true;
          } catch (err) {
            console.error(`[HotReload] Handler error for ${path}:`, err);
          }
        }
      }
    }

    const elapsed = (performance.now() - startTime).toFixed(1);
    const msg = handled
      ? `[HotReload] Reloaded ${path} (${elapsed}ms)`
      : `[HotReload] No handler for ${path}`;

    console.log(msg);
    this.statusCallback?.(msg);
  }

  /** Reload a texture by URL (re-fetches and updates material) */
  async reloadTexture(url: string, material: THREE.Material): Promise<void> {
    const { TextureLoader } = await import('three');
    const loader = new TextureLoader();
    const texture = await loader.loadAsync(url + '?t=' + Date.now());

    // Update all texture properties on the material
    const mat = material as unknown as Record<string, unknown>;
    for (const key of Object.keys(mat)) {
      const val = mat[key];
      if (val && typeof val === 'object' && 'isTexture' in val) {
        const oldTex = val as THREE.Texture;
        if (oldTex.image?.src?.includes(url.split('/').pop()!)) {
          oldTex.image = texture.image;
          oldTex.needsUpdate = true;
        }
      }
    }

    material.needsUpdate = true;
    console.log(`[HotReload] Texture reloaded: ${url}`);
  }

  /** Setup Vite HMR integration */
  private setupViteHMR(): void {
    const hot = (import.meta as ImportMetaWithHot).hot;
    if (hot) {
      hot.on('vite:beforeUpdate', () => {
        this.statusCallback?.('[HotReload] Vite update incoming...');
      });

      hot.on('vite:afterUpdate', () => {
        this.statusCallback?.('[HotReload] Vite update applied');
      });

      // Accept self for HMR
      hot.accept(() => {
        console.log('[HotReload] Module self-accepted');
      });
    }
  }

  /** Simple glob-ish pattern matching */
  private matchPattern(path: string, pattern: string): boolean {
    // Support: *.ext, folder/*, exact match
    if (pattern === '*') return true;
    if (pattern.startsWith('*.')) {
      return path.endsWith(pattern.substring(1));
    }
    if (pattern.endsWith('/*')) {
      return path.startsWith(pattern.substring(0, pattern.length - 1));
    }
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(path);
    }
    return path === pattern || path.endsWith('/' + pattern) || path.endsWith('\\' + pattern);
  }

  /** Enable/disable hot reload */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      for (const timeout of this.pendingReloads.values()) {
        clearTimeout(timeout);
      }
      this.pendingReloads.clear();
    }
  }

  /** Get reload stats */
  getStats(): { enabled: boolean; totalReloads: number; pendingReloads: number; handlersCount: number } {
    return {
      enabled: this.isEnabled,
      totalReloads: this.reloadCount,
      pendingReloads: this.pendingReloads.size,
      handlersCount: this.handlers.size,
    };
  }

  dispose(): void {
    for (const timeout of this.pendingReloads.values()) {
      clearTimeout(timeout);
    }
    this.pendingReloads.clear();
    this.handlers.clear();
    for (const cleanup of this.watchers) cleanup();
    this.watchers.length = 0;
  }
}

// Type extension for import.meta.hot
interface ImportMetaWithHot {
  hot?: {
    accept: (cb?: () => void) => void;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    dispose: (cb: () => void) => void;
  };
}

// Re-export for convenience — augment import.meta
export {};
