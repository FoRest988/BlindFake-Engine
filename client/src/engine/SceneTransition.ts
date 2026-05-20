// ─── Scene Transitions ──────────────────────────────────────────────
// Professional scene change effects: fade, crossfade, wipe, slide.

export type TransitionType = 'fade' | 'fadeWhite' | 'wipeLeft' | 'wipeRight' | 'wipeUp' | 'wipeDown' | 'circle' | 'pixelate';

export interface TransitionConfig {
  type: TransitionType;
  duration: number; // total seconds (half out + half in)
  color?: string; // for fade transitions
  onMidpoint?: () => void; // called at the midpoint (scene switch happens here)
}

export class SceneTransition {
  private overlay: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private active = false;
  private config: TransitionConfig | null = null;
  private elapsed = 0;
  private phase: 'out' | 'in' = 'out';
  private midpointCalled = false;
  private resolve: (() => void) | null = null;

  get isActive(): boolean {
    return this.active;
  }

  /** Start a transition. Returns a promise that resolves when complete. */
  start(config: TransitionConfig): Promise<void> {
    if (this.active) return Promise.resolve();

    return new Promise<void>((resolve) => {
      this.config = config;
      this.elapsed = 0;
      this.phase = 'out';
      this.active = true;
      this.midpointCalled = false;
      this.resolve = resolve;
      this.createOverlay(config);
    });
  }

  /** Convenience: fade to black, call fn, fade back */
  async fadeThrough(fn: () => void | Promise<void>, duration = 1, color = '#000'): Promise<void> {
    await this.start({
      type: 'fade',
      duration,
      color,
      onMidpoint: fn as () => void,
    });
  }

  /** Update each frame */
  update(delta: number): void {
    if (!this.active || !this.config) return;

    this.elapsed += delta;
    const halfDuration = this.config.duration / 2;

    if (this.phase === 'out') {
      const progress = Math.min(1, this.elapsed / halfDuration);
      this.renderTransition(progress, 'out');

      if (progress >= 1) {
        if (!this.midpointCalled) {
          this.midpointCalled = true;
          this.config.onMidpoint?.();
        }
        this.phase = 'in';
        this.elapsed = 0;
      }
    } else {
      const progress = Math.min(1, this.elapsed / halfDuration);
      this.renderTransition(progress, 'in');

      if (progress >= 1) {
        this.complete();
      }
    }
  }

  /** Force finish immediately */
  cancel(): void {
    this.complete();
  }

  // ── Rendering ─────────────────────────────────────────────────

  private renderTransition(progress: number, phase: 'out' | 'in'): void {
    if (!this.config) return;

    // For 'in' phase, invert progress (1→0)
    const t = phase === 'in' ? 1 - progress : progress;

    switch (this.config.type) {
      case 'fade':
      case 'fadeWhite':
        this.renderFade(t);
        break;
      case 'wipeLeft':
      case 'wipeRight':
      case 'wipeUp':
      case 'wipeDown':
        this.renderWipe(t);
        break;
      case 'circle':
        this.renderCircle(t);
        break;
      case 'pixelate':
        this.renderPixelate(t);
        break;
    }
  }

  private renderFade(t: number): void {
    if (this.overlay) {
      const eased = this.easeInOutCubic(t);
      this.overlay.style.opacity = String(eased);
    }
  }

  private renderWipe(t: number): void {
    if (!this.ctx || !this.canvas || !this.config) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const eased = this.easeInOutCubic(t);

    this.ctx.clearRect(0, 0, w, h);
    this.ctx.fillStyle = this.config.color ?? '#000';

    switch (this.config.type) {
      case 'wipeLeft':
        this.ctx.fillRect(0, 0, w * eased, h);
        break;
      case 'wipeRight':
        this.ctx.fillRect(w * (1 - eased), 0, w * eased, h);
        break;
      case 'wipeUp':
        this.ctx.fillRect(0, 0, w, h * eased);
        break;
      case 'wipeDown':
        this.ctx.fillRect(0, h * (1 - eased), w, h * eased);
        break;
    }
  }

  private renderCircle(t: number): void {
    if (!this.ctx || !this.canvas || !this.config) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const maxRadius = Math.sqrt(w * w + h * h) / 2;
    const eased = this.easeInOutCubic(t);
    const radius = maxRadius * eased;

    this.ctx.clearRect(0, 0, w, h);

    // Fill everything, then cut out a circle
    this.ctx.fillStyle = this.config.color ?? '#000';
    this.ctx.fillRect(0, 0, w, h);
    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.beginPath();
    this.ctx.arc(w / 2, h / 2, maxRadius - radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.globalCompositeOperation = 'source-over';
  }

  private renderPixelate(t: number): void {
    if (!this.ctx || !this.canvas || !this.config) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const eased = this.easeInOutCubic(t);
    const blockSize = Math.max(1, Math.floor(eased * 40));

    this.ctx.clearRect(0, 0, w, h);

    // Grid of blocks with alpha based on progress
    this.ctx.fillStyle = this.config.color ?? '#000';
    this.ctx.globalAlpha = eased;

    for (let x = 0; x < w; x += blockSize) {
      for (let y = 0; y < h; y += blockSize) {
        // Randomize slightly per block for a dissolve feel
        const noise = ((x * 1327 + y * 2657) % 100) / 100;
        if (noise < eased) {
          this.ctx.fillRect(x, y, blockSize, blockSize);
        }
      }
    }
    this.ctx.globalAlpha = 1;
  }

  // ── Helpers ───────────────────────────────────────────────────

  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  private createOverlay(config: TransitionConfig): void {
    this.destroyOverlay();

    const useCanvas = config.type !== 'fade' && config.type !== 'fadeWhite';

    if (useCanvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      this.canvas.style.cssText = `
        position:fixed;top:0;left:0;width:100%;height:100%;
        z-index:10000;pointer-events:none;
      `;
      this.ctx = this.canvas.getContext('2d');
      document.body.appendChild(this.canvas);
    } else {
      this.overlay = document.createElement('div');
      this.overlay.style.cssText = `
        position:fixed;top:0;left:0;width:100%;height:100%;
        z-index:10000;pointer-events:none;opacity:0;
        background:${config.type === 'fadeWhite' ? '#fff' : config.color ?? '#000'};
      `;
      document.body.appendChild(this.overlay);
    }
  }

  private destroyOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }

  private complete(): void {
    this.active = false;
    this.destroyOverlay();
    this.resolve?.();
    this.resolve = null;
    this.config = null;
  }
}
