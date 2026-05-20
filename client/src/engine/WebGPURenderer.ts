/**
 * WebGPURenderer — Feature-detection and renderer creation for BlindFake: Phantom.
 *
 * Attempts to initialise a WebGPU renderer (Three.js r165+ `three/webgpu` bundle)
 * and falls back gracefully to WebGL2 / WebGL1 when WebGPU is unavailable.
 *
 * Quick-start:
 *   const { renderer, capabilities } = await createRenderer({ canvas, antialias: true });
 *   engine.renderer = renderer;
 *   console.log('Backend:', capabilities.backend); // 'webgpu' | 'webgl2' | 'webgl1'
 */

import * as THREE from 'three';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  alpha?: boolean;
  powerPreference?: 'default' | 'high-performance' | 'low-power';
}

export type RendererBackend = 'webgpu' | 'webgl2' | 'webgl1';

// ── Capabilities singleton ───────────────────────────────────────────────────

export interface RendererCapabilities {
  isWebGPU: boolean;
  backend: RendererBackend;
}

/** Populated by createRenderer(); safe to read anywhere after engine init. */
export const rendererCapabilities: RendererCapabilities = {
  isWebGPU: false,
  backend: 'webgl2',
};

// ── Standalone async factory ─────────────────────────────────────────────────

export interface RendererCreateResult {
  renderer: THREE.WebGLRenderer;
  capabilities: RendererCapabilities;
}

/**
 * Create the best renderer available in the current browser.
 * WebGPU (1.6 MB) is loaded via dynamic import only when the API is confirmed live.
 */
export async function createRenderer(
  params: THREE.WebGLRendererParameters,
): Promise<RendererCreateResult> {
  const caps: RendererCapabilities = { isWebGPU: false, backend: 'webgl2' };

  // WebGPU path ---------------------------------------------------------------
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await (navigator as Navigator & {
        gpu: { requestAdapter(): Promise<unknown> };
      }).gpu.requestAdapter();

      if (adapter) {
        // Dynamic import keeps three/webgpu out of the main bundle
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = await import('three/webgpu') as any;
        const WGPURenderer = mod.WebGPURenderer as new (p: unknown) => THREE.WebGLRenderer & { init(): Promise<void> };
        const renderer = new WGPURenderer({ ...params });
        await renderer.init();

        caps.isWebGPU = true;
        caps.backend = 'webgpu';
        Object.assign(rendererCapabilities, caps);
        console.info('[BlindFake: Phantom] WebGPU renderer active');
        return { renderer, capabilities: caps };
      }
    } catch (e) {
      console.info('[BlindFake: Phantom] WebGPU init failed, using WebGL:', e);
    }
  }

  // WebGL fallback ------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer(params);
  const gl = renderer.getContext();
  caps.backend =
    typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
      ? 'webgl2'
      : 'webgl1';

  Object.assign(rendererCapabilities, caps);
  console.info(`[BlindFake: Phantom] WebGL renderer active (${caps.backend})`);
  return { renderer, capabilities: caps };
}

// ── Legacy class wrapper (kept for backward compat) ─────────────────────────

export class WebGPURendererWrapper {
  public renderer!: THREE.WebGLRenderer;
  public backend: RendererBackend = 'webgl2';
  public isWebGPUSupported = false;

  private canvas: HTMLCanvasElement;
  private options: RendererOptions;

  constructor(options: RendererOptions) {
    this.canvas = options.canvas;
    this.options = options;
  }

  /** Initialize the best available renderer */
  async init(): Promise<THREE.WebGLRenderer> {
    this.isWebGPUSupported = this.checkWebGPUSupport();

    if (this.isWebGPUSupported) {
      try {
        // Dynamically import three/webgpu (available in Three.js 0.170+)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = await import('three/webgpu') as any;
        const WGPURenderer = mod.WebGPURenderer as new (p: unknown) => THREE.WebGLRenderer & { init(): Promise<void> };
        const wgpuRenderer = new WGPURenderer({
          canvas: this.canvas,
          antialias: this.options.antialias ?? true,
          alpha: this.options.alpha ?? false,
        });
        await wgpuRenderer.init();
        this.renderer = wgpuRenderer;
        this.backend = 'webgpu';
        console.info('[BlindFake: Phantom] Using WebGPU backend');
        return this.renderer;
      } catch {
        // WebGPU renderer failed; fall through to WebGL
      }
    }

    // WebGL fallback (default)
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.options.antialias ?? true,
      alpha: this.options.alpha ?? false,
      powerPreference: this.options.powerPreference ?? 'high-performance',
    });

    this.backend = 'webgl2';
    console.info('[BlindFake: Phantom] Using WebGL backend');

    // Enable WebGL2 features
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    return this.renderer;
  }

  /** Check if WebGPU is supported in the current browser */
  checkWebGPUSupport(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  /** Get GPU info string for debug display */
  getGPUInfo(): string {
    if (this.backend === 'webgpu') {
      return 'WebGPU';
    }

    const gl = this.renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
      const gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      return `WebGL2 | ${vendor} | ${gpuRenderer}`;
    }
    return 'WebGL2';
  }

  /** Get renderer capabilities summary */
  getCapabilities(): Record<string, unknown> {
    const caps = this.renderer.capabilities;
    return {
      backend: this.backend,
      webgpuAvailable: this.isWebGPUSupported,
      maxTextures: caps.maxTextures,
      maxVertexTextures: caps.maxVertexTextures,
      maxTextureSize: caps.maxTextureSize,
      maxCubemapSize: caps.maxCubemapSize,
      maxAttributes: caps.maxAttributes,
      maxVertexUniforms: caps.maxVertexUniforms,
      maxFragmentUniforms: caps.maxFragmentUniforms,
      maxVaryings: caps.maxVaryings,
      maxSamples: caps.maxSamples,
      vertexTextures: caps.vertexTextures,
      isWebGL2: caps.isWebGL2,
      precision: caps.precision,
    };
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height);
  }

  setPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
