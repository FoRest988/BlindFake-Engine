/**
 * Profiler — Real-time performance profiling overlay.
 * Shows frame time breakdown, draw calls, triangles, memory, GPU info.
 * Toggle with engine.profiler.toggle() or F4 in editor.
 */

import * as THREE from 'three';

interface ProfileFrame {
  total: number;
  physics: number;
  render: number;
  scripts: number;
  other: number;
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  textures: number;
  geometries: number;
  programs: number;
}

export class Profiler {
  private renderer: THREE.WebGLRenderer | null = null;
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private visible = false;

  // Frame history
  private history: ProfileFrame[] = [];
  private historyMax = 120; // frames

  // Timing markers
  private markers = new Map<string, number>();
  private currentFrame: Partial<ProfileFrame> = {};
  private frameStart = 0;

  // Update interval
  private updateInterval = 0;
  private lastUpdate = 0;
  private fps = 0;
  private frameCount = 0;
  private fpsTime = 0;

  // Memory
  private memoryMB = 0;

  setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
  }

  /** Begin a named profiling section */
  begin(name: string): void {
    this.markers.set(name, performance.now());
  }

  /** End a named profiling section */
  end(name: string): void {
    const start = this.markers.get(name);
    if (start === undefined) return;
    const elapsed = performance.now() - start;
    (this.currentFrame as Record<string, number>)[name] = elapsed;
    this.markers.delete(name);
  }

  /** Call at the very beginning of the frame */
  frameBegin(): void {
    this.frameStart = performance.now();
    this.currentFrame = {};
  }

  /** Call at the very end of the frame */
  frameEnd(): void {
    const total = performance.now() - this.frameStart;
    const physics = this.currentFrame.physics ?? 0;
    const render = this.currentFrame.render ?? 0;
    const scripts = this.currentFrame.scripts ?? 0;

    const frame: ProfileFrame = {
      total,
      physics,
      render,
      scripts,
      other: Math.max(0, total - physics - render - scripts),
      drawCalls: 0,
      triangles: 0,
      points: 0,
      lines: 0,
      textures: 0,
      geometries: 0,
      programs: 0,
    };

    // Renderer stats
    if (this.renderer) {
      const info = this.renderer.info;
      frame.drawCalls = info.render.calls;
      frame.triangles = info.render.triangles;
      frame.points = info.render.points;
      frame.lines = info.render.lines;
      frame.textures = info.memory.textures;
      frame.geometries = info.memory.geometries;
      frame.programs = info.programs?.length ?? 0;
    }

    this.history.push(frame);
    if (this.history.length > this.historyMax) {
      this.history.shift();
    }

    // FPS
    this.frameCount++;
    const now = performance.now();
    if (now - this.fpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTime = now;
    }

    // Memory (if available)
    const perfMemory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (perfMemory) {
      this.memoryMB = perfMemory.usedJSHeapSize / (1024 * 1024);
    }

    // Update display
    if (this.visible && now - this.lastUpdate > 100) {
      this.lastUpdate = now;
      this.updateDisplay();
    }
  }

  /** Toggle profiler overlay */
  toggle(): void {
    this.visible = !this.visible;
    if (this.visible) {
      this.createOverlay();
    } else {
      this.destroyOverlay();
    }
  }

  /** Show/hide */
  show(): void { if (!this.visible) this.toggle(); }
  hide(): void { if (this.visible) this.toggle(); }

  private createOverlay(): void {
    if (this.container) return;

    this.container = document.createElement('div');
    this.container.id = 'profiler-overlay';
    this.container.style.cssText = `
      position:fixed;top:8px;right:8px;width:320px;background:rgba(0,0,0,0.85);
      border:1px solid #444;border-radius:6px;padding:10px;font-family:monospace;
      font-size:11px;color:#ccc;z-index:10000;pointer-events:auto;
      backdrop-filter:blur(4px);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;margin-bottom:8px;';
    header.innerHTML = `
      <span style="font-weight:bold;color:#2ecc71;flex:1;">📊 PROFILER</span>
      <span id="profiler-fps" style="color:#2ecc71;font-size:14px;font-weight:bold;">0 FPS</span>
    `;
    this.container.appendChild(header);

    // Frame time graph canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = 300;
    this.canvas.height = 80;
    this.canvas.style.cssText = 'width:100%;height:80px;background:#111;border-radius:3px;margin-bottom:8px;';
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);

    // Stats grid
    const stats = document.createElement('div');
    stats.id = 'profiler-stats';
    stats.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;';
    this.container.appendChild(stats);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;gap:10px;margin-top:6px;padding-top:6px;border-top:1px solid #333;font-size:9px;';
    legend.innerHTML = `
      <span><span style="color:#e74c3c;">■</span> Physics</span>
      <span><span style="color:#3498db;">■</span> Render</span>
      <span><span style="color:#f39c12;">■</span> Scripts</span>
      <span><span style="color:#555;">■</span> Other</span>
    `;
    this.container.appendChild(legend);

    document.body.appendChild(this.container);
  }

  private destroyOverlay(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
      this.canvas = null;
      this.ctx = null;
    }
  }

  private updateDisplay(): void {
    if (!this.container || !this.ctx || !this.canvas) return;

    const last = this.history[this.history.length - 1];
    if (!last) return;

    // FPS
    const fpsEl = this.container.querySelector('#profiler-fps');
    if (fpsEl) {
      fpsEl.textContent = `${this.fps} FPS`;
      (fpsEl as HTMLElement).style.color = this.fps >= 55 ? '#2ecc71' : this.fps >= 30 ? '#f39c12' : '#e74c3c';
    }

    // Graph
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // 16.67ms line (60fps target)
    const maxMs = 33.33; // scale to 30fps max
    const y60 = h - (16.67 / maxMs) * h;
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y60);
    ctx.lineTo(w, y60);
    ctx.stroke();
    ctx.setLineDash([]);

    // 33.33ms line (30fps)
    ctx.strokeStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.lineTo(w, 1);
    ctx.stroke();

    // Stacked bars
    const barWidth = w / this.historyMax;
    for (let i = 0; i < this.history.length; i++) {
      const f = this.history[i];
      const x = i * barWidth;

      let y = h;
      const sections = [
        { value: f.physics, color: '#e74c3c' },
        { value: f.render, color: '#3498db' },
        { value: f.scripts, color: '#f39c12' },
        { value: f.other, color: '#555' },
      ];

      for (const s of sections) {
        const sh = (s.value / maxMs) * h;
        ctx.fillStyle = s.color;
        ctx.fillRect(x, y - sh, barWidth - 0.5, sh);
        y -= sh;
      }
    }

    // Stats
    const statsEl = this.container.querySelector('#profiler-stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <span style="color:#888;">Frame Time:</span><span style="color:#fff;">${last.total.toFixed(2)} ms</span>
        <span style="color:#e74c3c;">Physics:</span><span>${last.physics.toFixed(2)} ms</span>
        <span style="color:#3498db;">Render:</span><span>${last.render.toFixed(2)} ms</span>
        <span style="color:#f39c12;">Scripts:</span><span>${last.scripts.toFixed(2)} ms</span>
        <span style="color:#888;">Draw Calls:</span><span>${last.drawCalls}</span>
        <span style="color:#888;">Triangles:</span><span>${last.triangles.toLocaleString()}</span>
        <span style="color:#888;">Textures:</span><span>${last.textures}</span>
        <span style="color:#888;">Geometries:</span><span>${last.geometries}</span>
        <span style="color:#888;">Shaders:</span><span>${last.programs}</span>
        <span style="color:#888;">Memory:</span><span>${this.memoryMB.toFixed(1)} MB</span>
      `;
    }
  }

  /** Get averaged stats over the last N frames */
  getAverages(frames = 60): {
    fps: number;
    avgFrameTime: number;
    avgPhysics: number;
    avgRender: number;
    avgScripts: number;
    avgDrawCalls: number;
    avgTriangles: number;
  } {
    const slice = this.history.slice(-frames);
    if (slice.length === 0) {
      return { fps: 0, avgFrameTime: 0, avgPhysics: 0, avgRender: 0, avgScripts: 0, avgDrawCalls: 0, avgTriangles: 0 };
    }
    const n = slice.length;
    return {
      fps: this.fps,
      avgFrameTime: slice.reduce((s, f) => s + f.total, 0) / n,
      avgPhysics: slice.reduce((s, f) => s + f.physics, 0) / n,
      avgRender: slice.reduce((s, f) => s + f.render, 0) / n,
      avgScripts: slice.reduce((s, f) => s + f.scripts, 0) / n,
      avgDrawCalls: slice.reduce((s, f) => s + f.drawCalls, 0) / n,
      avgTriangles: slice.reduce((s, f) => s + f.triangles, 0) / n,
    };
  }

  dispose(): void {
    this.destroyOverlay();
    this.history.length = 0;
  }
}
