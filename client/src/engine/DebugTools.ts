// ─── Debug Tools ────────────────────────────────────────────────────
// Runtime performance overlay, entity inspector, and debug drawing.

import * as THREE from 'three';

export class DebugOverlay {
  private container: HTMLElement | null = null;
  private visible = false;
  private stats: Record<string, string | number> = {};

  // FPS tracking
  private frames = 0;
  private fpsAccum = 0;
  private fps = 0;
  private frameTimeMin = Infinity;
  private frameTimeMax = 0;
  private frameTimes: number[] = [];

  // Memory
  private memUpdateTimer = 0;
  private memUsed = 0;

  toggle(): void {
    this.visible = !this.visible;
    if (this.visible && !this.container) this.create();
    if (this.container) this.container.style.display = this.visible ? '' : 'none';
  }

  show(): void { this.visible = true; if (!this.container) this.create(); if (this.container) this.container.style.display = ''; }
  hide(): void { this.visible = false; if (this.container) this.container.style.display = 'none'; }

  /** Set a custom stat to display */
  setStat(name: string, value: string | number): void {
    this.stats[name] = value;
  }

  /** Remove a custom stat */
  removeStat(name: string): void {
    delete this.stats[name];
  }

  /** Update the overlay (call each frame) */
  update(delta: number, renderer?: THREE.WebGLRenderer): void {
    if (!this.visible || !this.container) return;

    // FPS
    this.frames++;
    this.fpsAccum += delta;
    this.frameTimes.push(delta * 1000);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    this.frameTimeMin = Math.min(this.frameTimeMin, delta * 1000);
    this.frameTimeMax = Math.max(this.frameTimeMax, delta * 1000);

    if (this.fpsAccum >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsAccum);
      this.frames = 0;
      this.fpsAccum = 0;
      this.frameTimeMin = Infinity;
      this.frameTimeMax = 0;
    }

    // Memory (every 2s)
    this.memUpdateTimer += delta;
    if (this.memUpdateTimer >= 2) {
      this.memUpdateTimer = 0;
      if ((performance as any).memory) {
        this.memUsed = Math.round((performance as any).memory.usedJSHeapSize / 1048576);
      }
    }

    // Build display
    let html = `<div style="color:#0f0;font-weight:bold;">FPS: ${this.fps}</div>`;
    const avgFrame = this.frameTimes.length > 0 ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length : 0;
    html += `<div>Frame: ${avgFrame.toFixed(1)}ms</div>`;

    if (this.memUsed > 0) {
      html += `<div>Memory: ${this.memUsed}MB</div>`;
    }

    if (renderer) {
      const info = renderer.info;
      html += `<div>Draw calls: ${info.render.calls}</div>`;
      html += `<div>Triangles: ${info.render.triangles}</div>`;
      html += `<div>Textures: ${info.memory.textures}</div>`;
      html += `<div>Geometries: ${info.memory.geometries}</div>`;
    }

    // Custom stats
    for (const [name, value] of Object.entries(this.stats)) {
      html += `<div>${name}: ${value}</div>`;
    }

    this.container.innerHTML = html;
  }

  dispose(): void {
    this.container?.remove();
    this.container = null;
  }

  private create(): void {
    this.container = document.createElement('div');
    this.container.id = 'debug-overlay';
    this.container.style.cssText = `
      position:fixed;top:8px;left:8px;padding:8px 12px;
      background:rgba(0,0,0,0.75);color:#ccc;font-family:monospace;
      font-size:11px;line-height:1.5;border-radius:4px;
      z-index:9999;pointer-events:none;min-width:160px;
    `;
    document.body.appendChild(this.container);
  }
}

// ─── Debug Draw ─────────────────────────────────────────────────────
// Runtime debug lines, boxes, spheres, axes, etc.

interface DebugPrimitive {
  mesh: THREE.Object3D;
  lifetime: number;
  elapsed: number;
}

export class DebugDraw {
  private scene: THREE.Scene;
  private primitives: DebugPrimitive[] = [];
  private lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, depthTest: false });

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Draw a line between two points */
  line(from: THREE.Vector3, to: THREE.Vector3, color: number = 0x00ff00, lifetime: number = 0): void {
    const geom = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 999;
    this.addPrimitive(line, lifetime);
  }

  /** Draw a wireframe box */
  box(center: THREE.Vector3, size: THREE.Vector3, color: number = 0x00ff00, lifetime: number = 0): void {
    const geom = new THREE.BoxGeometry(size.x, size.y, size.z);
    const edges = new THREE.EdgesGeometry(geom);
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
    const mesh = new THREE.LineSegments(edges, mat);
    mesh.position.copy(center);
    mesh.renderOrder = 999;
    this.addPrimitive(mesh, lifetime);
  }

  /** Draw a wireframe sphere */
  sphere(center: THREE.Vector3, radius: number, color: number = 0x00ff00, lifetime: number = 0): void {
    const geom = new THREE.SphereGeometry(radius, 12, 8);
    const edges = new THREE.EdgesGeometry(geom);
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
    const mesh = new THREE.LineSegments(edges, mat);
    mesh.position.copy(center);
    mesh.renderOrder = 999;
    this.addPrimitive(mesh, lifetime);
  }

  /** Draw an axis indicator at position */
  axes(position: THREE.Vector3, size: number = 1, lifetime: number = 0): void {
    const axes = new THREE.AxesHelper(size);
    axes.position.copy(position);
    axes.renderOrder = 999;
    this.addPrimitive(axes, lifetime);
  }

  /** Draw a ray */
  ray(origin: THREE.Vector3, direction: THREE.Vector3, length: number = 5, color: number = 0xffff00, lifetime: number = 0): void {
    const end = origin.clone().add(direction.clone().normalize().multiplyScalar(length));
    this.line(origin, end, color, lifetime);
  }

  /** Draw a grid on the XZ plane */
  grid(center: THREE.Vector3, size: number = 10, divisions: number = 10, color: number = 0x444444, lifetime: number = 0): void {
    const grid = new THREE.GridHelper(size, divisions, color, color);
    grid.position.copy(center);
    grid.renderOrder = 999;
    this.addPrimitive(grid, lifetime);
  }

  /** Clear all debug primitives */
  clear(): void {
    for (const p of this.primitives) {
      this.scene.remove(p.mesh);
      if ((p.mesh as any).geometry) (p.mesh as any).geometry.dispose();
    }
    this.primitives.length = 0;
  }

  /** Update (remove expired primitives) */
  update(delta: number): void {
    const toRemove: number[] = [];

    for (let i = 0; i < this.primitives.length; i++) {
      const p = this.primitives[i];
      if (p.lifetime > 0) {
        p.elapsed += delta;
        if (p.elapsed >= p.lifetime) {
          toRemove.push(i);
        }
      }
    }

    // Remove in reverse order
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      const p = this.primitives[idx];
      this.scene.remove(p.mesh);
      if ((p.mesh as any).geometry) (p.mesh as any).geometry.dispose();
      this.primitives.splice(idx, 1);
    }
  }

  dispose(): void {
    this.clear();
    this.lineMaterial.dispose();
  }

  private addPrimitive(mesh: THREE.Object3D, lifetime: number): void {
    // If lifetime is 0, it persists until next clear or frame
    if (lifetime === 0) lifetime = 0.016; // ~1 frame
    this.scene.add(mesh);
    this.primitives.push({ mesh, lifetime, elapsed: 0 });
  }
}
