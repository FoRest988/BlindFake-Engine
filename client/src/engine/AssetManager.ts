import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MemoryBudget } from './MemoryBudget';

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  bones: THREE.Bone[];
  meshes: THREE.Mesh[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

export class AssetManager {
  private gltfLoader: GLTFLoader;
  private textureLoader: THREE.TextureLoader;
  private audioLoader: THREE.AudioLoader;
  private ktx2Loader: KTX2Loader | null = null;

  private modelCache   = new Map<string, LoadedModel>();
  private textureCache = new Map<string, THREE.Texture>();
  private audioCache   = new Map<string, AudioBuffer>();

  // ── LRU tracking (url → last-access timestamp) ────────────────────
  private modelLRU   = new Map<string, number>();
  private textureLRU = new Map<string, number>();
  private audioLRU   = new Map<string, number>();

  // ── Memory accounting ────────────────────────────────────────────
  private textureBytesMap = new Map<string, number>();
  private audioBytesMap   = new Map<string, number>();

  /** Shared memory budget. Accessible externally for monitoring. */
  public readonly memoryBudget = new MemoryBudget();

  private loadingQueue: Array<{ url: string; type: string }> = [];
  private totalToLoad = 0;
  private loadedCount = 0;

  // ── Streaming priority queue ────────────────────────────────────────────
  private streamQueue: Array<{
    url: string;
    type: 'model' | 'texture' | 'audio';
    priority: number;
    resolve: (result: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];
  private activeConcurrent = 0;
  private maxConcurrentLoads = 4;

  public onProgress?: (loaded: number, total: number) => void;

  constructor() {
    this.gltfLoader = new GLTFLoader();

    // Draco compression for smaller models
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.gltfLoader.setDRACOLoader(dracoLoader);

    this.textureLoader = new THREE.TextureLoader();
    this.audioLoader   = new THREE.AudioLoader();

    // Trigger LRU eviction when a budget is exceeded
    this.memoryBudget.onEvictionNeeded((category) => {
      if (category === 'texture') this.evictLRUTexture();
      else if (category === 'audio') this.evictLRUAudio();
    });
  }

  async loadModel(url: string): Promise<LoadedModel> {
    if (this.modelCache.has(url)) {
      this.modelLRU.set(url, Date.now());
      return this.cloneModel(this.modelCache.get(url)!);
    }

    const gltf = await this.loadGLTF(url);
    const model = this.extractModelData(gltf);
    this.applyFallbackTextures(model);
    this.modelCache.set(url, model);
    this.modelLRU.set(url, Date.now());
    this.markLoaded();
    return this.cloneModel(model);
  }

  async loadTexture(url: string): Promise<THREE.Texture> {
    if (this.textureCache.has(url)) {
      this.textureLRU.set(url, Date.now());
      return this.textureCache.get(url)!;
    }

    // KTX2 / Basis Universal compressed textures
    const lowerUrl = url.toLowerCase();
    if ((lowerUrl.endsWith('.ktx2') || lowerUrl.endsWith('.ktx')) && this.ktx2Loader) {
      return new Promise<THREE.Texture>((resolve, reject) => {
        this.ktx2Loader!.load(
          url,
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            const bytes = MemoryBudget.estimateTextureBytes(texture);
            this.textureBytesMap.set(url, bytes);
            this.memoryBudget.trackTexture(bytes);
            this.textureCache.set(url, texture);
            this.textureLRU.set(url, Date.now());
            this.markLoaded();
            resolve(texture);
          },
          undefined,
          reject,
        );
      });
    }

    // Standard PNG / JPEG / WebP textures
    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          const bytes = MemoryBudget.estimateTextureBytes(texture);
          this.textureBytesMap.set(url, bytes);
          this.memoryBudget.trackTexture(bytes);
          this.textureCache.set(url, texture);
          this.textureLRU.set(url, Date.now());
          this.markLoaded();
          resolve(texture);
        },
        undefined,
        reject
      );
    });
  }

  async loadAudio(url: string): Promise<AudioBuffer> {
    if (this.audioCache.has(url)) {
      this.audioLRU.set(url, Date.now());
      return this.audioCache.get(url)!;
    }

    return new Promise((resolve, reject) => {
      this.audioLoader.load(
        url,
        (buffer) => {
          const bytes = MemoryBudget.estimateAudioBytes(buffer);
          this.audioBytesMap.set(url, bytes);
          this.memoryBudget.trackAudio(bytes);
          this.audioCache.set(url, buffer);
          this.audioLRU.set(url, Date.now());
          this.markLoaded();
          resolve(buffer);
        },
        undefined,
        reject
      );
    });
  }

  /** Preload a batch of assets. Returns when all are loaded. */
  async preload(assets: Array<{ url: string; type: 'model' | 'texture' | 'audio' }>): Promise<void> {
    this.totalToLoad += assets.length;
    const promises = assets.map((asset) => {
      switch (asset.type) {
        case 'model': return this.loadModel(asset.url);
        case 'texture': return this.loadTexture(asset.url);
        case 'audio': return this.loadAudio(asset.url);
      }
    });
    await Promise.all(promises);
  }

  /** Extract all data from a loaded glTF — bones, meshes, materials, textures */
  private extractModelData(gltf: GLTF): LoadedModel {
    const bones: THREE.Bone[] = [];
    const meshes: THREE.Mesh[] = [];
    const materials: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];
    const materialSet = new Set<THREE.Material>();
    const textureSet = new Set<THREE.Texture>();

    gltf.scene.traverse((child) => {
      if (child instanceof THREE.Bone) {
        bones.push(child);
      }
      if (child instanceof THREE.Mesh) {
        meshes.push(child);
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          if (!materialSet.has(mat)) {
            materialSet.add(mat);
            materials.push(mat);
            // Extract textures from material
            if (mat instanceof THREE.MeshStandardMaterial) {
              const texProps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const;
              for (const prop of texProps) {
                const tex = mat[prop];
                if (tex && !textureSet.has(tex)) {
                  textureSet.add(tex);
                  textures.push(tex);
                }
              }
            }
          }
        }
      }
    });

    return {
      scene: gltf.scene,
      animations: gltf.animations,
      bones,
      meshes,
      materials,
      textures,
    };
  }

  private cloneModel(model: LoadedModel): LoadedModel {
    const clonedScene = model.scene.clone(true);
    const bones: THREE.Bone[] = [];
    const meshes: THREE.Mesh[] = [];
    clonedScene.traverse((child) => {
      if (child instanceof THREE.Bone) bones.push(child);
      if (child instanceof THREE.Mesh) meshes.push(child);
    });
    return {
      scene: clonedScene,
      animations: model.animations, // AnimationClips are shared (immutable)
      bones,
      meshes,
      materials: model.materials,
      textures: model.textures,
    };
  }

  private loadGLTF(url: string): Promise<GLTF> {
    // For blob URLs, load via ArrayBuffer + parse() to avoid texture resolution issues
    if (url.startsWith('blob:')) {
      return fetch(url)
        .then(r => r.arrayBuffer())
        .then(buffer => new Promise<GLTF>((resolve, reject) => {
          this.gltfLoader.parse(buffer, '', resolve, reject);
        }));
    }
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(url, resolve, undefined, reject);
    });
  }

  /**
   * Load a model from a FileList (supports .glb with embedded textures,
   * and .gltf with external texture files selected alongside it).
   */
  async loadModelFromFiles(files: FileList): Promise<LoadedModel> {
    const fileArray = Array.from(files);
    const modelFile = fileArray.find(f =>
      f.name.toLowerCase().endsWith('.glb') || f.name.toLowerCase().endsWith('.gltf')
    );
    if (!modelFile) throw new Error('No .glb or .gltf file found');

    const buffer = await modelFile.arrayBuffer();
    const isGLB = modelFile.name.toLowerCase().endsWith('.glb');

    // Build blob URL map for all resource files (textures, bins)
    // Store both the original name and cleaned variants for flexible matching
    const blobMap = new Map<string, string>();
    const blobList: string[] = [];
    for (const file of fileArray) {
      if (file === modelFile) continue;
      const url = URL.createObjectURL(file);
      const lowName = file.name.toLowerCase();
      blobMap.set(lowName, url);
      blobList.push(url);
      // Also store without spaces replaced by underscores and vice versa for fuzzy matching
      const noSpaces = lowName.replace(/\s+/g, '_');
      if (noSpaces !== lowName) blobMap.set(noSpaces, url);
      const withSpaces = lowName.replace(/_/g, ' ');
      if (withSpaces !== lowName) blobMap.set(withSpaces, url);
      // Strip UUID-like prefix (32 hex chars with optional hyphens, followed by _ or -)
      const stripped = lowName.replace(/^[0-9a-f]{32}[-_]/i, '').replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_]/i, '');
      if (stripped !== lowName) blobMap.set(stripped, url);
      // Also strip and normalize spaces
      if (stripped !== lowName) {
        const strippedNoSpace = stripped.replace(/\s+/g, '_');
        if (strippedNoSpace !== stripped) blobMap.set(strippedNoSpace, url);
        const strippedWithSpace = stripped.replace(/_/g, ' ');
        if (strippedWithSpace !== stripped) blobMap.set(strippedWithSpace, url);
      }
      // Also try stripping common download prefix patterns (e.g. "download_", numbered IDs)
      const stripped2 = lowName.replace(/^\d+[-_]/, '');
      if (stripped2 !== lowName && stripped2 !== stripped) blobMap.set(stripped2, url);
    }

    // Create a LoadingManager that intercepts texture/resource requests
    const manager = new THREE.LoadingManager();
    manager.onError = (url: string) => {
      console.warn('[AssetManager] Resource not found (may be embedded):', url);
    };
    manager.setURLModifier((url: string) => {
      // Don't modify blob or data URIs — they're already resolved
      if (url.startsWith('blob:') || url.startsWith('data:')) return url;

      // Extract basename from the URL — try decoded and raw
      let basename: string | undefined;
      try {
        basename = decodeURIComponent(url).split('/').pop()?.split('\\').pop()?.toLowerCase();
      } catch {
        basename = url.split('/').pop()?.split('\\').pop()?.toLowerCase();
      }

      // Also get the raw (possibly percent-encoded) basename
      const rawBasename = url.split('/').pop()?.split('\\').pop()?.toLowerCase();

      // Try all possible name variants against the blobMap
      const candidates: string[] = [];
      if (basename) candidates.push(basename);
      if (rawBasename && rawBasename !== basename) candidates.push(rawBasename);

      // Generate variants for each candidate
      const allVariants: string[] = [];
      for (const name of candidates) {
        allVariants.push(name);
        // Spaces ↔ underscores
        const noSpaces = name.replace(/\s+/g, '_');
        if (noSpaces !== name) allVariants.push(noSpaces);
        const withSpaces = name.replace(/_/g, ' ');
        if (withSpaces !== name) allVariants.push(withSpaces);
        // Decode remaining percent-encoding (e.g., %20 → space)
        try {
          const decoded = decodeURIComponent(name);
          if (decoded !== name) allVariants.push(decoded);
        } catch { /* ignore */ }
        // Strip UUID-like prefix (32 hex chars or 8-4-4-4-12 with hyphens)
        const stripped = name.replace(/^[0-9a-f]{32}[-_]/i, '').replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_]/i, '');
        if (stripped !== name) {
          allVariants.push(stripped);
          const strippedNoSpaces = stripped.replace(/\s+/g, '_');
          if (strippedNoSpaces !== stripped) allVariants.push(strippedNoSpaces);
          const strippedWithSpaces = stripped.replace(/_/g, ' ');
          if (strippedWithSpaces !== stripped) allVariants.push(strippedWithSpaces);
        }
      }

      // Direct lookups
      for (const variant of allVariants) {
        if (blobMap.has(variant)) return blobMap.get(variant)!;
      }

      // Partial match (endsWith) as last resort
      if (basename) {
        const uuidRe = /^[0-9a-f]{32}[-_]|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_]/i;
        const strippedBn: string = basename.replace(uuidRe, '');
        for (const [key, val] of blobMap) {
          if (key.endsWith(basename) || basename.endsWith(key)) return val;
          const strippedKey: string = key.replace(uuidRe, '');
          if (strippedKey === strippedBn || strippedKey === basename || key === strippedBn) return val;
          // Also try with spaces/underscores normalized
          const normBn = strippedBn.replace(/\s+/g, '_');
          const normKey = strippedKey.replace(/\s+/g, '_');
          if (normKey === normBn) return val;
        }
      }
      return url;
    });

    const loader = new GLTFLoader(manager);
    // Copy DRACO decoder if available
    if ((this.gltfLoader as any).dracoLoader) {
      loader.setDRACOLoader((this.gltfLoader as any).dracoLoader);
    }

    if (isGLB) {
      const gltf = await new Promise<GLTF>((resolve, reject) => {
        loader.parse(buffer, '', resolve, reject);
      });
      const model = this.extractModelData(gltf);
      // Apply fallback material to meshes that lost textures
      this.applyFallbackTextures(model);
      // Delay blob URL cleanup to let async texture loading finish
      setTimeout(() => { for (const url of blobList) URL.revokeObjectURL(url); }, 120000);
      this.markLoaded();
      return model;
    }

    // GLTF: also rewrite image/buffer URIs in the JSON to blob URLs
    const text = new TextDecoder().decode(buffer);
    const gltfJson = JSON.parse(text);

    if (gltfJson.images) {
      for (const img of gltfJson.images) {
        if (!img.uri) continue;
        let basename: string;
        try {
          basename = decodeURIComponent(img.uri).split('/').pop()!.split('\\').pop()!.toLowerCase();
        } catch {
          basename = img.uri.split('/').pop()!.split('\\').pop()!.toLowerCase();
        }
        // Direct match
        if (blobMap.has(basename)) {
          img.uri = blobMap.get(basename);
          continue;
        }
        // Fuzzy match: spaces vs underscores
        const noSpaces = basename.replace(/\s+/g, '_');
        if (blobMap.has(noSpaces)) { img.uri = blobMap.get(noSpaces); continue; }
        const withSpaces = basename.replace(/_/g, ' ');
        if (blobMap.has(withSpaces)) { img.uri = blobMap.get(withSpaces); continue; }
        // Strip UUID prefix
        const strippedBn = basename.replace(/^[0-9a-f]{8,}[-_]/, '');
        if (strippedBn !== basename && blobMap.has(strippedBn)) { img.uri = blobMap.get(strippedBn); continue; }
        // Partial match
        let matched = false;
        for (const [key, val] of blobMap) {
          if (key.endsWith(basename) || basename.endsWith(key)) { img.uri = val; matched = true; break; }
          const strippedKey = key.replace(/^[0-9a-f]{8,}[-_]/, '');
          if (strippedKey === strippedBn || strippedKey === basename || key === strippedBn) { img.uri = val; matched = true; break; }
        }
        if (matched) continue;
        console.warn('[AssetManager] Could not resolve texture:', img.uri, 'basename:', basename);
      }
    }
    if (gltfJson.buffers) {
      for (const buf of gltfJson.buffers) {
        if (!buf.uri) continue;
        let basename: string;
        try {
          basename = decodeURIComponent(buf.uri).split('/').pop()!.split('\\').pop()!.toLowerCase();
        } catch {
          basename = buf.uri.split('/').pop()!.split('\\').pop()!.toLowerCase();
        }
        if (blobMap.has(basename)) {
          buf.uri = blobMap.get(basename);
          continue;
        }
        // UUID stripping fallback for buffer URIs
        const strippedBuf = basename.replace(/^[0-9a-f]{8,}[-_]/, '');
        if (strippedBuf !== basename && blobMap.has(strippedBuf)) {
          buf.uri = blobMap.get(strippedBuf);
        }
      }
    }

    const modifiedBuffer = new TextEncoder().encode(JSON.stringify(gltfJson)).buffer;
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(modifiedBuffer, '', resolve, reject);
    });

    // Apply fallback textures for any that failed to load
    const model = this.extractModelData(gltf);
    this.applyFallbackTextures(model);

    // Delay blob URL cleanup to let async texture loading finish
    setTimeout(() => { for (const url of blobList) URL.revokeObjectURL(url); }, 30000);
    return model;
  }

  /** Ensure all meshes have valid materials even if textures failed to load */
  private applyFallbackTextures(model: LoadedModel): void {
    const texProps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const;
    for (const mesh of model.meshes) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial) {
          for (const prop of texProps) {
            const tex = mat[prop];
            if (tex && !tex.image) {
              mat[prop] = null;
            }
          }
          mat.needsUpdate = true;
        }
      }
    }
  }

  private markLoaded(): void {
    this.loadedCount++;
    this.onProgress?.(this.loadedCount, this.totalToLoad);
  }

  unloadModel(key: string): void {
    const model = this.modelCache.get(key);
    if (!model) return;
    model.meshes.forEach((m) => m.geometry.dispose());
    model.materials.forEach((m) => m.dispose());
    model.textures.forEach((t) => t.dispose());
    this.modelCache.delete(key);
  }

  unloadTexture(key: string): void {
    const tex = this.textureCache.get(key);
    if (!tex) return;
    tex.dispose();
    this.textureCache.delete(key);
  }

  unloadAudio(key: string): void {
    const bytes = this.audioBytesMap.get(key) ?? 0;
    this.memoryBudget.untrackAudio(bytes);
    this.audioBytesMap.delete(key);
    this.audioLRU.delete(key);
    this.audioCache.delete(key);
  }

  // ── LRU eviction ────────────────────────────────────────────────────
  // Called automatically by MemoryBudget when a budget is exceeded.
  // Eviction removes from the CACHE only — textures still live in GPU
  // memory as long as a THREE.Material references them. This is intentional:
  // we don't want visible glitches; we just prevent the cache from growing.

  /** Evict the least-recently-used texture from cache. */
  evictLRUTexture(): void {
    if (this.textureLRU.size === 0) return;
    let oldest = Infinity, oldestUrl = '';
    for (const [url, t] of this.textureLRU) {
      if (t < oldest) { oldest = t; oldestUrl = url; }
    }
    if (oldestUrl) {
      const bytes = this.textureBytesMap.get(oldestUrl) ?? 0;
      this.memoryBudget.untrackTexture(bytes);
      this.textureBytesMap.delete(oldestUrl);
      this.textureCache.delete(oldestUrl);
      this.textureLRU.delete(oldestUrl);
    }
  }

  /** Evict the least-recently-used audio buffer from cache. */
  evictLRUAudio(): void {
    if (this.audioLRU.size === 0) return;
    let oldest = Infinity, oldestUrl = '';
    for (const [url, t] of this.audioLRU) {
      if (t < oldest) { oldest = t; oldestUrl = url; }
    }
    if (oldestUrl) {
      const bytes = this.audioBytesMap.get(oldestUrl) ?? 0;
      this.memoryBudget.untrackAudio(bytes);
      this.audioBytesMap.delete(oldestUrl);
      this.audioCache.delete(oldestUrl);
      this.audioLRU.delete(oldestUrl);
    }
  }

  /** Manually evict all LRU assets until memory is back under budget. */
  evictLRU(category: 'texture' | 'audio'): void {
    if (category === 'texture') {
      while (this.memoryBudget.isTextureBudgetExceeded() && this.textureLRU.size > 0) {
        this.evictLRUTexture();
      }
    } else {
      while (this.memoryBudget.isAudioBudgetExceeded() && this.audioLRU.size > 0) {
        this.evictLRUAudio();
      }
    }
  }

  /** Clear all caches (useful when loading a new scene). */
  clearAllCaches(): void {
    this.modelLRU.clear();
    this.textureLRU.clear();
    this.audioLRU.clear();
    this.modelCache.clear();
    this.textureCache.clear();
    this.audioCache.clear();
    this.textureBytesMap.clear();
    this.audioBytesMap.clear();
  }

  // ── KTX2 / Basis Universal ────────────────────────────────────────────────

  /**
   * Enable KTX2 / Basis Universal compressed texture loading.
   * Must be called with the active THREE.WebGLRenderer for format detection.
   * The transcoder WASM is loaded from Three.js's standard path automatically.
   *
   * @param renderer  The engine's WebGLRenderer.
   * @param transcoderPath  Optional custom path to the Basis transcoder WASM files.
   */
  initKTX2(
    renderer: THREE.WebGLRenderer,
    transcoderPath = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/',
  ): void {
    if (this.ktx2Loader) return; // already initialised
    const loader = new KTX2Loader();
    loader.setTranscoderPath(transcoderPath);
    loader.detectSupport(renderer);
    this.ktx2Loader = loader;
  }

  // ── Streaming priority queue ─────────────────────────────────────────────

  /**
   * Enqueue an asset load with an optional priority.
   * Higher priority values are loaded before lower ones.
   * Respects `maxConcurrentLoads` to avoid saturating the network.
   *
   * @param url       Asset URL.
   * @param type      'model' | 'texture' | 'audio'
   * @param priority  Higher = sooner. Default 0.
   * @returns Promise resolving with the loaded asset.
   */
  enqueue<T = unknown>(url: string, type: 'model' | 'texture' | 'audio', priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.streamQueue.push({
        url,
        type,
        priority,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      // Keep highest priority at front (stable sort)
      this.streamQueue.sort((a, b) => b.priority - a.priority);
      this._processStreamQueue();
    });
  }

  /** Set maximum simultaneous streaming loads (default 4). */
  setMaxConcurrentLoads(n: number): void {
    this.maxConcurrentLoads = Math.max(1, n);
  }

  private _processStreamQueue(): void {
    while (this.activeConcurrent < this.maxConcurrentLoads && this.streamQueue.length > 0) {
      const req = this.streamQueue.shift()!;
      this.activeConcurrent++;
      this._executeStreamLoad(req)
        .finally(() => {
          this.activeConcurrent--;
          this._processStreamQueue();
        });
    }
  }

  private async _executeStreamLoad(req: {
    url: string;
    type: 'model' | 'texture' | 'audio';
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  }): Promise<void> {
    try {
      let result: unknown;
      switch (req.type) {
        case 'model':   result = await this.loadModel(req.url);   break;
        case 'texture': result = await this.loadTexture(req.url); break;
        case 'audio':   result = await this.loadAudio(req.url);   break;
      }
      req.resolve(result);
    } catch (e) {
      req.reject(e);
    }
  }

  dispose(): void {
    this.textureCache.forEach((tex) => tex.dispose());
    this.modelCache.forEach((model) => {
      model.meshes.forEach((m) => m.geometry.dispose());
      model.materials.forEach((m) => m.dispose());
      model.textures.forEach((t) => t.dispose());
    });
    this.clearAllCaches();
  }
}
