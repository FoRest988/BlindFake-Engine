/**
 * PerformanceManager — Adaptive quality system (Babylon.js SceneOptimizer-inspired).
 *
 * Monitors real-time FPS and progressively adjusts rendering quality to keep
 * the frame rate at or above a configurable target (default 60 FPS).
 *
 * Quality tiers cascade from least-impactful to most-impactful:
 *  1. Reduce shadow map resolution
 *  2. Disable expensive post-processing (SSAO, SSR, motion blur)
 *  3. Reduce pixel ratio
 *  4. Reduce draw distance / LOD aggressiveness
 *  5. Disable shadows entirely
 *
 * When FPS exceeds target + headroom, quality is restored one tier at a time.
 */

import * as THREE from 'three';
import type { Engine } from './Engine';

// ── Quality Preset ─────────────────────────────────────────

export type QualityLevel = 'ultra' | 'high' | 'medium' | 'low' | 'potato';

export interface QualityPreset {
  shadowMapSize: number;
  shadowsEnabled: boolean;
  pixelRatio: number;
  maxLightsWithShadows: number;
  postProcessingEnabled: boolean;
  ssaoEnabled: boolean;
  ssrEnabled: boolean;
  bloomEnabled: boolean;
  motionBlurEnabled: boolean;
  antialias: boolean;
  drawDistance: number;
  lodBias: number;            // multiplier for LOD distance thresholds
}

const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  ultra: {
    shadowMapSize: 4096,
    shadowsEnabled: true,
    pixelRatio: Math.min(window.devicePixelRatio, 2),
    maxLightsWithShadows: 8,
    postProcessingEnabled: true,
    ssaoEnabled: true,
    ssrEnabled: true,
    bloomEnabled: true,
    motionBlurEnabled: true,
    antialias: true,
    drawDistance: 2000,
    lodBias: 1.0,
  },
  high: {
    shadowMapSize: 2048,
    shadowsEnabled: true,
    pixelRatio: Math.min(window.devicePixelRatio, 1.5),
    maxLightsWithShadows: 4,
    postProcessingEnabled: true,
    ssaoEnabled: true,
    ssrEnabled: false,
    bloomEnabled: true,
    motionBlurEnabled: true,
    antialias: true,
    drawDistance: 1500,
    lodBias: 1.0,
  },
  medium: {
    shadowMapSize: 1024,
    shadowsEnabled: true,
    pixelRatio: 1,
    maxLightsWithShadows: 2,
    postProcessingEnabled: true,
    ssaoEnabled: false,
    ssrEnabled: false,
    bloomEnabled: true,
    motionBlurEnabled: false,
    antialias: true,
    drawDistance: 1000,
    lodBias: 0.75,
  },
  low: {
    shadowMapSize: 512,
    shadowsEnabled: true,
    pixelRatio: 1,
    maxLightsWithShadows: 1,
    postProcessingEnabled: true,
    ssaoEnabled: false,
    ssrEnabled: false,
    bloomEnabled: false,
    motionBlurEnabled: false,
    antialias: false,
    drawDistance: 500,
    lodBias: 0.5,
  },
  potato: {
    shadowMapSize: 256,
    shadowsEnabled: false,
    pixelRatio: 0.75,
    maxLightsWithShadows: 0,
    postProcessingEnabled: false,
    ssaoEnabled: false,
    ssrEnabled: false,
    bloomEnabled: false,
    motionBlurEnabled: false,
    antialias: false,
    drawDistance: 300,
    lodBias: 0.3,
  },
};

const LEVELS_ORDERED: QualityLevel[] = ['ultra', 'high', 'medium', 'low', 'potato'];

// ── Performance Manager ────────────────────────────────────

export class PerformanceManager {
  private engine: Engine | null = null;
  private renderer: THREE.WebGLRenderer | null = null;

  // Adaptive quality
  public enabled = false;
  public targetFPS = 60;
  public headroom = 10;                 // FPS above target before upgrading
  public downgradeThreshold = 5;        // frames below target before downgrade
  public upgradeThreshold = 120;        // frames above target+headroom before upgrade

  private currentLevel: QualityLevel = 'ultra';
  private belowTargetFrames = 0;
  private aboveTargetFrames = 0;

  // FPS tracking (rolling average)
  private frameTimes: number[] = [];
  private maxSamples = 60;
  private lastFrameTime = 0;

  // GPU capability detection
  public gpuTier: 'high' | 'mid' | 'low' = 'high';
  public webgpuSupported = false;
  public maxTextureSize = 4096;
  public maxAnisotropy = 1;

  // Stats (public for profiler overlay)
  public avgFrameTime = 0;
  public avgFPS = 0;
  public drawCalls = 0;
  public triangles = 0;
  public textureMemory = 0;
  public geometryCount = 0;

  constructor() {
    this.detectWebGPU();
  }

  /** Wire up to the engine after construction */
  init(engine: Engine): void {
    this.engine = engine;
    this.renderer = engine.renderer;
    this.detectGPUCapabilities();
    this.autoSelectInitialQuality();
  }

  /** Call once per frame (put at start of loop) */
  frameStart(): void {
    this.lastFrameTime = performance.now();
  }

  /** Call once per frame (put at end of loop) */
  frameEnd(): void {
    const dt = performance.now() - this.lastFrameTime;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > this.maxSamples) this.frameTimes.shift();

    // Calculate rolling average
    const sum = this.frameTimes.reduce((a, b) => a + b, 0);
    this.avgFrameTime = sum / this.frameTimes.length;
    this.avgFPS = 1000 / this.avgFrameTime;

    // Collect renderer stats
    if (this.renderer) {
      const info = this.renderer.info;
      this.drawCalls = info.render.calls;
      this.triangles = info.render.triangles;
      this.geometryCount = info.memory.geometries;
      this.textureMemory = info.memory.textures;
    }

    // Adaptive quality adjustment
    if (this.enabled && this.frameTimes.length >= 30) {
      this.adaptQuality();
    }
  }

  // ── Adaptive Quality ─────────────────────────────

  private adaptQuality(): void {
    const targetMs = 1000 / this.targetFPS;

    if (this.avgFrameTime > targetMs * 1.1) {
      // Below target
      this.aboveTargetFrames = 0;
      this.belowTargetFrames++;
      if (this.belowTargetFrames >= this.downgradeThreshold) {
        this.downgrade();
        this.belowTargetFrames = 0;
      }
    } else if (this.avgFPS > this.targetFPS + this.headroom) {
      // Above target with headroom — consider upgrade
      this.belowTargetFrames = 0;
      this.aboveTargetFrames++;
      if (this.aboveTargetFrames >= this.upgradeThreshold) {
        this.upgrade();
        this.aboveTargetFrames = 0;
      }
    } else {
      // In sweet spot
      this.belowTargetFrames = 0;
      this.aboveTargetFrames = 0;
    }
  }

  private downgrade(): void {
    const idx = LEVELS_ORDERED.indexOf(this.currentLevel);
    if (idx < LEVELS_ORDERED.length - 1) {
      this.setQuality(LEVELS_ORDERED[idx + 1]);
    }
  }

  private upgrade(): void {
    const idx = LEVELS_ORDERED.indexOf(this.currentLevel);
    if (idx > 0) {
      this.setQuality(LEVELS_ORDERED[idx - 1]);
    }
  }

  /** Manually set quality level */
  setQuality(level: QualityLevel): void {
    if (level === this.currentLevel) return;
    this.currentLevel = level;
    this.applyPreset(QUALITY_PRESETS[level]);
    this.frameTimes.length = 0; // Reset samples after quality change
    console.log(`[PerformanceManager] Quality → ${level}`);
  }

  getQuality(): QualityLevel { return this.currentLevel; }
  getPreset(): QualityPreset { return { ...QUALITY_PRESETS[this.currentLevel] }; }

  private applyPreset(p: QualityPreset): void {
    if (!this.engine || !this.renderer) return;

    // Pixel ratio
    this.renderer.setPixelRatio(p.pixelRatio);

    // Shadows
    this.renderer.shadowMap.enabled = p.shadowsEnabled;

    // Update shadow maps on all lights in scene
    const scene = this.engine.scenes.active;
    if (scene) {
      scene.traverse((obj) => {
        if ((obj as THREE.Light).isLight) {
          const light = obj as THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight;
          if (light.shadow) {
            if (p.shadowsEnabled && light.castShadow) {
              light.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
              // Force shadow map re-creation
              if (light.shadow.map) {
                light.shadow.map.dispose();
                light.shadow.map = null as unknown as THREE.WebGLRenderTarget;
              }
            }
          }
        }
      });
    }

    // Post-processing
    const pp = this.engine.postProcessing;
    pp.enabled = p.postProcessingEnabled;

    // Toggle individual effects
    const ssao = pp.getEffect('ssao');
    if (ssao) ssao.enabled = p.ssaoEnabled;
    const ssr = pp.getEffect('ssr');
    if (ssr) ssr.enabled = p.ssrEnabled;
    const bloom = pp.getEffect('bloom');
    if (bloom) bloom.enabled = p.bloomEnabled;
    const mb = pp.getEffect('motionBlur');
    if (mb) mb.enabled = p.motionBlurEnabled;

    // Camera draw distance
    this.engine.camera.far = p.drawDistance;
    this.engine.camera.updateProjectionMatrix();

    // Resize to apply new pixel ratio
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    pp.resize(w, h);
  }

  // ── GPU Detection ────────────────────────────────

  private async detectWebGPU(): Promise<void> {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
      try {
        const adapter = await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter();
        this.webgpuSupported = adapter !== null;
      } catch {
        this.webgpuSupported = false;
      }
    }
  }

  private detectGPUCapabilities(): void {
    if (!this.renderer) return;

    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();

    // GPU tier detection via renderer info string
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    let gpuName = '';
    if (debugInfo) {
      gpuName = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();
    }

    // Heuristic GPU classification
    if (this.isMobileGPU(gpuName) || gpuName.includes('intel uhd') || gpuName.includes('mesa')) {
      this.gpuTier = 'low';
    } else if (gpuName.includes('intel') || gpuName.includes('radeon vega') || gpuName.includes('mx')) {
      this.gpuTier = 'mid';
    } else {
      this.gpuTier = 'high';
    }
  }

  private isMobileGPU(name: string): boolean {
    return /adreno|mali|powervr|apple gpu|imgtech/.test(name);
  }

  private autoSelectInitialQuality(): void {
    switch (this.gpuTier) {
      case 'high': this.setQuality('ultra'); break;
      case 'mid':  this.setQuality('high');  break;
      case 'low':  this.setQuality('medium'); break;
    }
  }

  dispose(): void {
    this.frameTimes.length = 0;
    this.engine = null;
    this.renderer = null;
  }
}

// ── Render Stats Overlay ───────────────────────────────

export class RenderStatsOverlay {
  private container: HTMLElement;
  private visible = false;
  private manager: PerformanceManager;
  private animId = 0;

  constructor(manager: PerformanceManager) {
    this.manager = manager;
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position:fixed;top:8px;left:8px;z-index:99999;padding:8px 12px;
      background:rgba(0,0,0,0.8);color:#0f0;font:11px/1.5 monospace;
      border-radius:4px;pointer-events:none;display:none;min-width:200px;
    `;
    document.body.appendChild(this.container);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.update();
    else cancelAnimationFrame(this.animId);
  }

  show(): void { this.visible = true; this.container.style.display = 'block'; this.update(); }
  hide(): void { this.visible = false; this.container.style.display = 'none'; cancelAnimationFrame(this.animId); }

  private update = (): void => {
    if (!this.visible) return;
    const m = this.manager;
    const fpsColor = m.avgFPS >= 55 ? '#0f0' : m.avgFPS >= 30 ? '#ff0' : '#f00';
    this.container.innerHTML = `
      <div style="color:${fpsColor};font-size:14px;font-weight:bold">${Math.round(m.avgFPS)} FPS</div>
      <div>Frame: ${m.avgFrameTime.toFixed(1)}ms</div>
      <div>Draw calls: ${m.drawCalls}</div>
      <div>Triangles: ${(m.triangles / 1000).toFixed(1)}k</div>
      <div>Textures: ${m.textureMemory} | Geo: ${m.geometryCount}</div>
      <div>Quality: <b>${m.getQuality().toUpperCase()}</b></div>
      <div>GPU: ${m.gpuTier} | WebGPU: ${m.webgpuSupported ? '✓' : '✗'}</div>
    `;
    this.animId = requestAnimationFrame(this.update);
  };

  dispose(): void {
    cancelAnimationFrame(this.animId);
    this.container.remove();
  }
}
