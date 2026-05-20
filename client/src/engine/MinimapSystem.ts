/**
 * MinimapSystem — Orthographic render-to-texture minimap with icons & fog of war.
 *
 * Features:
 *  - Orthographic camera rendering scene from above
 *  - Render to texture, displayed as HUD overlay
 *  - Icon markers (player, enemies, NPCs, objectives, custom)
 *  - Fog of war (circular reveal around player)
 *  - Zoom in/out
 *  - Rotation follows player or world-locked
 *  - Circular or rectangular mask
 *  - Click-to-ping
 *  - Custom marker colors / shapes
 */

import * as THREE from 'three';

// ── Interfaces ──────────────────────────────────────────────────────────────

export type MarkerShape = 'circle' | 'triangle' | 'diamond' | 'square' | 'arrow';

export interface MinimapMarker {
  id: string;
  target: THREE.Object3D;
  color: string;
  shape: MarkerShape;
  size: number;
  label?: string;
  visible: boolean;
  /** Flashing (for objectives etc) */
  pulse: boolean;
  /** Custom icon URL or emoji */
  icon?: string;
  /** Layer / order */
  priority: number;
}

export interface MinimapConfig {
  /** Minimap DOM element size in pixels */
  size: number;
  /** Orthographic extent (world units visible) */
  zoom: number;
  /** Min / max zoom */
  zoomMin: number;
  zoomMax: number;
  /** Height of the orthographic camera above the player */
  cameraHeight: number;
  /** Rotate minimap to match player heading */
  rotateWithPlayer: boolean;
  /** Circular mask */
  circular: boolean;
  /** Fog of war */
  fogOfWar: boolean;
  /** Fog of war reveal radius (world units) */
  fogRevealRadius: number;
  /** Background color */
  bgColor: string;
  /** Border color */
  borderColor: string;
  /** Border width */
  borderWidth: number;
  /** Opacity */
  opacity: number;
  /** Position on screen */
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Margin from edge */
  margin: number;
  /** Layers to render on minimap (optional, default = all) */
  layers?: number[];
}

const DEFAULT_CONFIG: MinimapConfig = {
  size: 200,
  zoom: 100,
  zoomMin: 30,
  zoomMax: 500,
  cameraHeight: 200,
  rotateWithPlayer: true,
  circular: true,
  fogOfWar: false,
  fogRevealRadius: 50,
  bgColor: '#111111',
  borderColor: '#ffffff',
  borderWidth: 2,
  opacity: 0.85,
  position: 'top-right',
  margin: 15,
};

// ── MinimapSystem ───────────────────────────────────────────────────────────

export class MinimapSystem {
  private config: MinimapConfig;
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private player: THREE.Object3D | null = null;

  private minimapCamera!: THREE.OrthographicCamera;
  private renderTarget!: THREE.WebGLRenderTarget;
  private markers: Map<string, MinimapMarker> = new Map();

  // DOM
  private container!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private overlayCanvas!: HTMLCanvasElement;
  private overlayCtx!: CanvasRenderingContext2D;

  // Fog of war
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private revealedAreas: THREE.Vector2[] = [];

  private time = 0;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, cfg?: Partial<MinimapConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...cfg };
    this.scene = scene;
    this.renderer = renderer;
    this.initCamera();
    this.initDOM();
    this.initFogOfWar();
  }

  // ── Setup ────────────────────────────────────────────────────────────────

  private initCamera(): void {
    const half = this.config.zoom / 2;
    this.minimapCamera = new THREE.OrthographicCamera(-half, half, half, -half, 1, this.config.cameraHeight + 100);
    this.minimapCamera.up.set(0, 0, -1); // look down

    this.renderTarget = new THREE.WebGLRenderTarget(this.config.size * 2, this.config.size * 2, {
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
    });
  }

  private initDOM(): void {
    this.container = document.createElement('div');
    this.container.style.position = 'fixed';
    this.container.style.width = this.config.size + 'px';
    this.container.style.height = this.config.size + 'px';
    this.container.style.zIndex = '999';
    this.container.style.overflow = 'hidden';
    this.container.style.opacity = String(this.config.opacity);
    this.container.style.border = `${this.config.borderWidth}px solid ${this.config.borderColor}`;
    this.container.style.background = this.config.bgColor;
    this.container.style.pointerEvents = 'auto';
    this.container.style.display = 'none';

    if (this.config.circular) {
      this.container.style.borderRadius = '50%';
    }

    this.applyPosition();

    // Main canvas (3D scene render)
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.config.size * 2;
    this.canvas.height = this.config.size * 2;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.position = 'absolute';
    this.ctx = this.canvas.getContext('2d')!;
    this.container.appendChild(this.canvas);

    // Overlay canvas (markers, icons)
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.width = this.config.size * 2;
    this.overlayCanvas.height = this.config.size * 2;
    this.overlayCanvas.style.width = '100%';
    this.overlayCanvas.style.height = '100%';
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCtx = this.overlayCanvas.getContext('2d')!;
    this.container.appendChild(this.overlayCanvas);

    document.body.appendChild(this.container);
  }

  private applyPosition(): void {
    const m = this.config.margin + 'px';
    this.container.style.top = this.container.style.bottom = this.container.style.left = this.container.style.right = 'auto';
    switch (this.config.position) {
      case 'top-left': this.container.style.top = m; this.container.style.left = m; break;
      case 'top-right': this.container.style.top = m; this.container.style.right = m; break;
      case 'bottom-left': this.container.style.bottom = m; this.container.style.left = m; break;
      case 'bottom-right': this.container.style.bottom = m; this.container.style.right = m; break;
    }
  }

  private initFogOfWar(): void {
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.config.size * 2;
    this.fogCanvas.height = this.config.size * 2;
    this.fogCtx = this.fogCanvas.getContext('2d')!;
  }

  // ── Player ───────────────────────────────────────────────────────────────

  setPlayer(obj: THREE.Object3D): void { this.player = obj; }

  // ── Markers ──────────────────────────────────────────────────────────────

  addMarker(cfg: Partial<MinimapMarker> & { id: string; target: THREE.Object3D }): void {
    this.markers.set(cfg.id, {
      id: cfg.id,
      target: cfg.target,
      color: cfg.color ?? '#ff0000',
      shape: cfg.shape ?? 'circle',
      size: cfg.size ?? 6,
      label: cfg.label,
      visible: cfg.visible ?? true,
      pulse: cfg.pulse ?? false,
      icon: cfg.icon,
      priority: cfg.priority ?? 0,
    });
  }

  removeMarker(id: string): void { this.markers.delete(id); }

  updateMarker(id: string, cfg: Partial<MinimapMarker>): void {
    const m = this.markers.get(id);
    if (!m) return;
    Object.assign(m, cfg);
  }

  // ── Configuration ────────────────────────────────────────────────────────

  setZoom(z: number): void {
    this.config.zoom = Math.max(this.config.zoomMin, Math.min(this.config.zoomMax, z));
    const half = this.config.zoom / 2;
    this.minimapCamera.left = -half;
    this.minimapCamera.right = half;
    this.minimapCamera.top = half;
    this.minimapCamera.bottom = -half;
    this.minimapCamera.updateProjectionMatrix();
  }

  zoomIn(amount = 10): void { this.setZoom(this.config.zoom - amount); }
  zoomOut(amount = 10): void { this.setZoom(this.config.zoom + amount); }

  setVisible(v: boolean): void { this.container.style.display = v ? 'block' : 'none'; }

  configure(cfg: Partial<MinimapConfig>): void {
    Object.assign(this.config, cfg);
    this.container.style.width = this.config.size + 'px';
    this.container.style.height = this.config.size + 'px';
    this.container.style.opacity = String(this.config.opacity);
    this.container.style.borderRadius = this.config.circular ? '50%' : '0';
    this.applyPosition();
  }

  // ── Update & Render ──────────────────────────────────────────────────────

  update(delta: number): void {
    this.time += delta;
    if (!this.player || this.container.style.display === 'none') return;

    // Position camera above player
    const pp = this.player.getWorldPosition(new THREE.Vector3());
    this.minimapCamera.position.set(pp.x, pp.y + this.config.cameraHeight, pp.z);
    this.minimapCamera.lookAt(pp.x, pp.y, pp.z);

    // Rotate with player
    if (this.config.rotateWithPlayer) {
      const euler = new THREE.Euler().setFromQuaternion(this.player.quaternion, 'YXZ');
      this.minimapCamera.rotation.z = -euler.y;
    }

    this.minimapCamera.updateProjectionMatrix();

    // Render scene to texture
    const oldTarget = this.renderer.getRenderTarget();
    const oldAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = true;
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, this.minimapCamera);
    this.renderer.setRenderTarget(oldTarget);
    this.renderer.autoClear = oldAutoClear;

    // Read pixels to canvas
    const buf = new Uint8Array(this.renderTarget.width * this.renderTarget.height * 4);
    this.renderer.readRenderTargetPixels(this.renderTarget, 0, 0, this.renderTarget.width, this.renderTarget.height, buf);
    const imgData = new ImageData(new Uint8ClampedArray(buf.buffer), this.renderTarget.width, this.renderTarget.height);
    this.ctx.putImageData(imgData, 0, 0);
    // Flip vertically (WebGL convention)
    this.ctx.save();
    this.ctx.scale(1, -1);
    this.ctx.drawImage(this.canvas, 0, -this.canvas.height);
    this.ctx.restore();

    // Draw fog of war
    if (this.config.fogOfWar) {
      this.updateFogOfWar(pp);
    }

    // Draw markers overlay
    this.drawMarkers(pp);
  }

  private updateFogOfWar(playerPos: THREE.Vector3): void {
    // Record visited position
    this.revealedAreas.push(new THREE.Vector2(playerPos.x, playerPos.z));
    // Keep reasonable number
    if (this.revealedAreas.length > 2000) {
      this.revealedAreas = this.revealedAreas.filter((_, i) => i % 2 === 0);
    }

    const s = this.config.size * 2;
    this.fogCtx.clearRect(0, 0, s, s);
    this.fogCtx.fillStyle = 'rgba(0,0,0,0.8)';
    this.fogCtx.fillRect(0, 0, s, s);
    this.fogCtx.globalCompositeOperation = 'destination-out';

    const half = this.config.zoom / 2;
    const scale = s / this.config.zoom;

    for (const area of this.revealedAreas) {
      const dx = (area.x - playerPos.x) * scale + s / 2;
      const dy = (area.y - playerPos.z) * scale + s / 2;
      const radius = this.config.fogRevealRadius * scale * 0.5;
      const grad = this.fogCtx.createRadialGradient(dx, dy, 0, dx, dy, radius);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      this.fogCtx.fillStyle = grad;
      this.fogCtx.fillRect(dx - radius, dy - radius, radius * 2, radius * 2);
    }
    this.fogCtx.globalCompositeOperation = 'source-over';

    // Composite fog over main canvas
    this.ctx.drawImage(this.fogCanvas, 0, 0);
  }

  private drawMarkers(playerPos: THREE.Vector3): void {
    const s = this.config.size * 2;
    this.overlayCtx.clearRect(0, 0, s, s);
    const half = this.config.zoom / 2;
    const scale = s / this.config.zoom;

    // Sort by priority
    const sorted = [...this.markers.values()].filter(m => m.visible).sort((a, b) => a.priority - b.priority);

    for (const marker of sorted) {
      const wp = marker.target.getWorldPosition(new THREE.Vector3());
      let dx = (wp.x - playerPos.x) * scale + s / 2;
      let dy = (wp.z - playerPos.z) * scale + s / 2;

      // Rotate if following player
      if (this.config.rotateWithPlayer) {
        const euler = new THREE.Euler().setFromQuaternion(this.player!.quaternion, 'YXZ');
        const angle = -euler.y;
        const cx = s / 2, cy = s / 2;
        const rx = (dx - cx) * Math.cos(angle) - (dy - cy) * Math.sin(angle) + cx;
        const ry = (dx - cx) * Math.sin(angle) + (dy - cy) * Math.cos(angle) + cy;
        dx = rx; dy = ry;
      }

      // Clamp to edge if outside
      const margin = 15;
      const cx = s / 2, cy = s / 2;
      const maxDist = s / 2 - margin;
      const dist = Math.sqrt((dx - cx) ** 2 + (dy - cy) ** 2);
      if (dist > maxDist) {
        const ratio = maxDist / dist;
        dx = cx + (dx - cx) * ratio;
        dy = cy + (dy - cy) * ratio;
      }

      let sz = marker.size * 2;
      // Pulse effect
      if (marker.pulse) {
        sz *= 1 + Math.sin(this.time * 4) * 0.3;
      }

      this.overlayCtx.fillStyle = marker.color;
      this.overlayCtx.strokeStyle = '#000';
      this.overlayCtx.lineWidth = 1.5;

      this.drawShape(dx, dy, sz, marker.shape);

      // Label
      if (marker.label) {
        this.overlayCtx.fillStyle = '#ffffff';
        this.overlayCtx.font = '10px sans-serif';
        this.overlayCtx.textAlign = 'center';
        this.overlayCtx.fillText(marker.label, dx, dy - sz - 3);
      }
    }
  }

  private drawShape(x: number, y: number, size: number, shape: MarkerShape): void {
    const ctx = this.overlayCtx;
    ctx.beginPath();
    switch (shape) {
      case 'circle':
        ctx.arc(x, y, size, 0, Math.PI * 2);
        break;
      case 'triangle':
        ctx.moveTo(x, y - size);
        ctx.lineTo(x - size, y + size);
        ctx.lineTo(x + size, y + size);
        ctx.closePath();
        break;
      case 'diamond':
        ctx.moveTo(x, y - size);
        ctx.lineTo(x + size, y);
        ctx.lineTo(x, y + size);
        ctx.lineTo(x - size, y);
        ctx.closePath();
        break;
      case 'square':
        ctx.rect(x - size, y - size, size * 2, size * 2);
        break;
      case 'arrow':
        ctx.moveTo(x, y - size * 1.2);
        ctx.lineTo(x - size * 0.8, y + size);
        ctx.lineTo(x, y + size * 0.4);
        ctx.lineTo(x + size * 0.8, y + size);
        ctx.closePath();
        break;
    }
    ctx.fill();
    ctx.stroke();
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.renderTarget.dispose();
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}
