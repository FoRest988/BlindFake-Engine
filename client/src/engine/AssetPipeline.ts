/**
 * AssetPipeline — Automatic processing of imported assets:
 * - Texture compression/resizing/atlas generation
 * - Model optimization (merge geometries, simplify)
 * - Audio format conversion info
 * - Progress tracking & queuing
 */

import * as THREE from 'three';

export type PipelineStage = 'queued' | 'processing' | 'complete' | 'error';

export interface PipelineJob {
  id: number;
  name: string;
  type: 'texture' | 'model' | 'audio' | 'generic';
  input: string | File | Blob;
  stage: PipelineStage;
  progress: number; // 0-1
  result?: unknown;
  error?: string;
  options: PipelineOptions;
}

export interface PipelineOptions {
  /** Max texture dimension (will downscale if larger) */
  maxTextureSize?: number;
  /** Generate mipmaps for textures */
  generateMipmaps?: boolean;
  /** Texture format preference */
  textureFormat?: 'png' | 'jpeg' | 'webp';
  /** JPEG/WebP quality 0-1 */
  quality?: number;
  /** Flip Y axis for textures */
  flipY?: boolean;
  /** Merge meshes in models */
  mergeMeshes?: boolean;
  /** Generate LODs for models */
  generateLODs?: boolean;
  /** Normalize model scale */
  normalizeScale?: boolean;
  /** Target scale for normalization */
  targetScale?: number;
  /** Center model at origin */
  centerModel?: boolean;
}

const DEFAULT_OPTIONS: PipelineOptions = {
  maxTextureSize: 2048,
  generateMipmaps: true,
  textureFormat: 'webp',
  quality: 0.85,
  flipY: true,
  mergeMeshes: false,
  generateLODs: false,
  normalizeScale: false,
  targetScale: 1,
  centerModel: true,
};

export class AssetPipeline {
  private jobs: PipelineJob[] = [];
  private jobIdCounter = 0;
  private processing = false;
  private onProgressCallback?: (job: PipelineJob) => void;
  private onCompleteCallback?: (job: PipelineJob) => void;
  private defaultOptions: PipelineOptions;

  constructor(options: Partial<PipelineOptions> = {}) {
    this.defaultOptions = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Set progress callback */
  onProgress(cb: (job: PipelineJob) => void): void {
    this.onProgressCallback = cb;
  }

  /** Set completion callback */
  onComplete(cb: (job: PipelineJob) => void): void {
    this.onCompleteCallback = cb;
  }

  /** Queue a texture for processing */
  processTexture(input: string | File | Blob, name: string, options?: Partial<PipelineOptions>): PipelineJob {
    return this.enqueue(name, 'texture', input, options);
  }

  /** Queue a model for processing */
  processModel(input: string | File | Blob, name: string, options?: Partial<PipelineOptions>): PipelineJob {
    return this.enqueue(name, 'model', input, options);
  }

  /** Queue a generic asset */
  processAsset(input: string | File | Blob, name: string, options?: Partial<PipelineOptions>): PipelineJob {
    const type = this.detectType(name);
    return this.enqueue(name, type, input, options);
  }

  private enqueue(name: string, type: PipelineJob['type'], input: string | File | Blob, options?: Partial<PipelineOptions>): PipelineJob {
    const job: PipelineJob = {
      id: ++this.jobIdCounter,
      name,
      type,
      input,
      stage: 'queued',
      progress: 0,
      options: { ...this.defaultOptions, ...options },
    };

    this.jobs.push(job);
    this.processQueue();
    return job;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (true) {
      const job = this.jobs.find(j => j.stage === 'queued');
      if (!job) break;

      job.stage = 'processing';
      this.onProgressCallback?.(job);

      try {
        switch (job.type) {
          case 'texture':
            job.result = await this.processTextureJob(job);
            break;
          case 'model':
            job.result = await this.processModelJob(job);
            break;
          default:
            job.result = job.input;
        }
        job.stage = 'complete';
        job.progress = 1;
      } catch (err) {
        job.stage = 'error';
        job.error = err instanceof Error ? err.message : String(err);
      }

      this.onProgressCallback?.(job);
      this.onCompleteCallback?.(job);
    }

    this.processing = false;
  }

  /** Process a texture: resize, convert format, optimize */
  private async processTextureJob(job: PipelineJob): Promise<{ texture: THREE.Texture; blob: Blob; width: number; height: number }> {
    const img = await this.loadImage(job.input);
    job.progress = 0.3;
    this.onProgressCallback?.(job);

    const opts = job.options;

    // Determine target size
    let width = img.width;
    let height = img.height;
    const maxSize = opts.maxTextureSize ?? 2048;

    if (width > maxSize || height > maxSize) {
      const scale = maxSize / Math.max(width, height);
      width = Math.floor(width * scale);
      height = Math.floor(height * scale);
    }

    // Make power of two
    width = THREE.MathUtils.ceilPowerOfTwo(width);
    height = THREE.MathUtils.ceilPowerOfTwo(height);

    // Draw to canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    if (opts.flipY) {
      ctx.translate(0, height);
      ctx.scale(1, -1);
    }

    ctx.drawImage(img, 0, 0, width, height);
    job.progress = 0.6;
    this.onProgressCallback?.(job);

    // Convert to target format
    const mimeType = `image/${opts.textureFormat ?? 'webp'}`;
    const quality = opts.quality ?? 0.85;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error('Failed to convert texture')),
        mimeType,
        quality
      );
    });

    job.progress = 0.8;
    this.onProgressCallback?.(job);

    // Create Three.js texture
    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = opts.generateMipmaps ?? true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    job.progress = 1;
    return { texture, blob, width, height };
  }

  /** Process a model: center, normalize scale, optional merge */
  private async processModelJob(job: PipelineJob): Promise<{ info: ModelInfo }> {
    job.progress = 0.5;
    this.onProgressCallback?.(job);

    // Model processing — we provide metadata/instructions
    // Actual loading is done by the engine's asset system
    const info: ModelInfo = {
      name: job.name,
      centerAtOrigin: job.options.centerModel ?? true,
      normalizeScale: job.options.normalizeScale ?? false,
      targetScale: job.options.targetScale ?? 1,
      mergeMeshes: job.options.mergeMeshes ?? false,
      generateLODs: job.options.generateLODs ?? false,
    };

    job.progress = 1;
    return { info };
  }

  /** Center a loaded model at origin */
  static centerModel(object: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
  }

  /** Normalize model scale to fit within target size */
  static normalizeModel(object: THREE.Object3D, targetScale: number = 1): void {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const scale = targetScale / maxDim;
      object.scale.multiplyScalar(scale);
    }
  }

  /** Merge all meshes in an object into one geometry */
  static mergeMeshes(object: THREE.Object3D): THREE.Mesh | null {
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    object.traverse(child => {
      if (child instanceof THREE.Mesh) {
        const clonedGeo = child.geometry.clone();
        clonedGeo.applyMatrix4(child.matrixWorld);
        geometries.push(clonedGeo);

        if (Array.isArray(child.material)) {
          materials.push(...child.material);
        } else {
          materials.push(child.material);
        }
      }
    });

    if (geometries.length === 0) return null;

    const { mergeGeometries } = THREE as unknown as { mergeGeometries: (geos: THREE.BufferGeometry[]) => THREE.BufferGeometry };
    if (!mergeGeometries) {
      console.warn('[AssetPipeline] mergeGeometries not available');
      return null;
    }

    const merged = mergeGeometries(geometries);
    if (!merged) return null;

    return new THREE.Mesh(merged, materials.length === 1 ? materials[0] : materials);
  }

  /** Generate a texture atlas from multiple textures */
  static generateAtlas(
    textures: { name: string; image: HTMLImageElement }[],
    maxSize: number = 4096
  ): { canvas: HTMLCanvasElement; uvMap: Map<string, { u: number; v: number; w: number; h: number }> } {
    // Simple row-based packing
    const canvas = document.createElement('canvas');
    canvas.width = maxSize;
    canvas.height = maxSize;
    const ctx = canvas.getContext('2d')!;

    const uvMap = new Map<string, { u: number; v: number; w: number; h: number }>();
    let x = 0, y = 0, rowHeight = 0;

    for (const tex of textures) {
      if (x + tex.image.width > maxSize) {
        x = 0;
        y += rowHeight;
        rowHeight = 0;
      }
      if (y + tex.image.height > maxSize) break; // atlas full

      ctx.drawImage(tex.image, x, y);
      uvMap.set(tex.name, {
        u: x / maxSize,
        v: y / maxSize,
        w: tex.image.width / maxSize,
        h: tex.image.height / maxSize,
      });

      x += tex.image.width;
      rowHeight = Math.max(rowHeight, tex.image.height);
    }

    return { canvas, uvMap };
  }

  private loadImage(input: string | File | Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));

      if (typeof input === 'string') {
        img.crossOrigin = 'anonymous';
        img.src = input;
      } else {
        img.src = URL.createObjectURL(input);
      }
    });
  }

  private detectType(name: string): PipelineJob['type'] {
    const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.hdr'].includes(ext)) return 'texture';
    if (['.glb', '.gltf', '.fbx', '.obj', '.dae'].includes(ext)) return 'model';
    if (['.mp3', '.wav', '.ogg', '.flac'].includes(ext)) return 'audio';
    return 'generic';
  }

  /** Get all jobs */
  getJobs(): ReadonlyArray<PipelineJob> {
    return this.jobs;
  }

  /** Get pending job count */
  get pendingCount(): number {
    return this.jobs.filter(j => j.stage === 'queued' || j.stage === 'processing').length;
  }

  /** Clear completed jobs */
  clearCompleted(): void {
    this.jobs = this.jobs.filter(j => j.stage !== 'complete');
  }

  dispose(): void {
    this.jobs = [];
    this.onProgressCallback = undefined;
    this.onCompleteCallback = undefined;
  }
}

interface ModelInfo {
  name: string;
  centerAtOrigin: boolean;
  normalizeScale: boolean;
  targetScale: number;
  mergeMeshes: boolean;
  generateLODs: boolean;
}
