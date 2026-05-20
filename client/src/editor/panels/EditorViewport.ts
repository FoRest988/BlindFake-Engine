import * as THREE from 'three';
import type { EditorApp } from '../EditorApp';

// ── Render mode types ─────────────────────────────────────────────────────────
export type RenderMode =
  | 'default'
  | 'wireframe'
  | 'albedo'
  | 'normals'
  | 'roughness'
  | 'uv'
  | 'depth'
  | 'ao';

// ── Camera bookmark ───────────────────────────────────────────────────────────
export interface CameraBookmark {
  name: string;
  position: { x: number; y: number; z: number };
  target:   { x: number; y: number; z: number };
  fov:      number;
}

const BOOKMARK_KEY = 'blindfake_cam_bookmarks';
const MAX_BOOKMARKS = 5;

// ── Split viewport sub-view description ──────────────────────────────────────
interface SplitView {
  label: string;
  slot: 'tl' | 'tr' | 'bl' | 'br';
  defaultView: CameraView;
  col: number; // 0 or 1
  row: number; // 0 or 1
}

type CameraView = 'top' | 'front' | 'right' | 'perspective';

const SPLIT_VIEWS: SplitView[] = [
  { label: 'Top',   slot: 'tl', defaultView: 'top',         col: 0, row: 0 },
  { label: 'Front', slot: 'tr', defaultView: 'front',       col: 1, row: 0 },
  { label: 'Right', slot: 'bl', defaultView: 'right',       col: 0, row: 1 },
  { label: 'Persp', slot: 'br', defaultView: 'perspective', col: 1, row: 1 },
];

export class EditorViewport {
  private editor: EditorApp;
  private overlay!: HTMLElement;
  private statsEl!: HTMLElement;
  private snapInfoEl!: HTMLElement;
  private gizmoCanvas: HTMLCanvasElement | null = null;
  private statsIntervalId: ReturnType<typeof setInterval> | null = null;

  // ── Phase 7 additions ──────────────────────────────────────────────────────

  private renderMode: RenderMode = 'default';
  /** Mesh → original material(s) backup for render mode restore */
  private _materialBackup = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  private _profilerVisible = false;
  private _profilerCanvas: HTMLCanvasElement | null = null;
  private _frameTimes: number[] = [];  // last 120 frame durations (ms)
  private _lastFrameTs = 0;
  private _profilerRafId = 0;

  private _safeZoneVisible = false;
  private _safeZoneCanvas: HTMLCanvasElement | null = null;
  private _safeZoneRatio: '16:9' | '4:3' | '21:9' = '16:9';

  private _splitMode = false;
  private _splitContainer: HTMLElement | null = null;
  private _splitCameras = new Map<SplitView['slot'], THREE.Camera>();
  private _splitSlotViews = new Map<SplitView['slot'], CameraView>();
  private _splitActiveSlot: SplitView['slot'] = 'br';
  private _splitCellEls = new Map<SplitView['slot'], HTMLElement>();
  private _splitLabelEls = new Map<SplitView['slot'], HTMLElement>();

  private _bookmarks: CameraBookmark[] = [];

  constructor(editor: EditorApp) {
    this.editor = editor;
    this._loadBookmarks();

    for (const sv of SPLIT_VIEWS) {
      this._splitSlotViews.set(sv.slot, sv.defaultView);
    }

    // F8 — toggle profiler overlay
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'F8') { e.preventDefault(); this.toggleProfiler(); }
    });
  }

  render(): HTMLElement {
    this.overlay = document.createElement('div');
    this.overlay.className = 'viewport-overlay';
    this.overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:5;';

    // Top-left: camera views + render mode + extra tools
    const topLeft = document.createElement('div');
    topLeft.style.cssText = 'position:absolute;top:8px;left:8px;display:flex;flex-direction:column;gap:4px;';

    // Row 1 — camera presets
    const camRow = document.createElement('div');
    camRow.style.cssText = 'display:flex;gap:4px;pointer-events:auto;';
    camRow.innerHTML = `
      <button class="viewport-cam-btn" data-view="front" title="Front view">Front</button>
      <button class="viewport-cam-btn" data-view="right" title="Right view">Right</button>
      <button class="viewport-cam-btn" data-view="top" title="Top view">Top</button>
      <button class="viewport-cam-btn" data-view="perspective" title="Perspective">Persp</button>
    `;
    topLeft.appendChild(camRow);

    // Row 2 — render mode + tools
    const toolRow = document.createElement('div');
    toolRow.style.cssText = 'display:flex;gap:4px;pointer-events:auto;flex-wrap:wrap;';

    // Render mode dropdown
    const renderModeSelect = document.createElement('select');
    renderModeSelect.title = 'Render Mode';
    renderModeSelect.style.cssText = 'background:#333;border:1px solid #555;color:#ccc;padding:2px 4px;border-radius:3px;font-size:10px;cursor:pointer;';
    const modes: { label: string; value: RenderMode }[] = [
      { label: 'Default',    value: 'default' },
      { label: 'Wireframe',  value: 'wireframe' },
      { label: 'Albedo',     value: 'albedo' },
      { label: 'Normals',    value: 'normals' },
      { label: 'Roughness',  value: 'roughness' },
      { label: 'UV Checker', value: 'uv' },
      { label: 'Depth',      value: 'depth' },
      { label: 'AO',         value: 'ao' },
    ];
    for (const m of modes) {
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      renderModeSelect.appendChild(opt);
    }
    renderModeSelect.addEventListener('change', () => {
      this.setRenderMode(renderModeSelect.value as RenderMode);
    });
    toolRow.appendChild(renderModeSelect);

    // Screenshot button
    const ssBtn = this._makeBtn('📷', 'Capture viewport to PNG');
    ssBtn.addEventListener('click', () => this.captureScreenshot());
    toolRow.appendChild(ssBtn);

    // Safe zone toggle
    const szBtn = this._makeBtn('⬜', 'Safe Zone Overlay (16:9/4:3/21:9)');
    szBtn.addEventListener('click', () => {
      this._safeZoneVisible = !this._safeZoneVisible;
      szBtn.style.background = this._safeZoneVisible ? '#0078d4' : '#333';
      this._updateSafeZone();
    });
    toolRow.appendChild(szBtn);

    // Safe zone ratio selector (hidden until zone active)
    const szRatio = document.createElement('select');
    szRatio.title = 'Safe zone aspect ratio';
    szRatio.style.cssText = 'background:#333;border:1px solid #555;color:#ccc;padding:2px 4px;border-radius:3px;font-size:10px;cursor:pointer;';
    for (const r of ['16:9', '4:3', '21:9']) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      szRatio.appendChild(opt);
    }
    szRatio.addEventListener('change', () => {
      this._safeZoneRatio = szRatio.value as '16:9' | '4:3' | '21:9';
      if (this._safeZoneVisible) this._updateSafeZone();
    });
    toolRow.appendChild(szRatio);

    // Profiler toggle (F8)
    const profBtn = this._makeBtn('📊', 'Performance Profiler (F8)');
    profBtn.addEventListener('click', () => this.toggleProfiler());
    toolRow.appendChild(profBtn);

    // Split viewport toggle
    const splitBtn = this._makeBtn('⊞', '4-Way Split Viewport');
    splitBtn.addEventListener('click', () => {
      this._splitMode = !this._splitMode;
      splitBtn.style.background = this._splitMode ? '#0078d4' : '#333';
      this._updateSplitMode();
    });
    toolRow.appendChild(splitBtn);

    // Row 3 — camera bookmarks
    const bkRow = document.createElement('div');
    bkRow.style.cssText = 'display:flex;gap:4px;pointer-events:auto;';
    this._renderBookmarkRow(bkRow);
    topLeft.appendChild(toolRow);
    topLeft.appendChild(bkRow);

    this.overlay.appendChild(topLeft);

    // Top-right: orientation gizmo AND stats
    const topRight = document.createElement('div');
    topRight.style.cssText = 'position:absolute;top:8px;right:8px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;';

    // Axis gizmo canvas (pointer events enabled for click-to-view)
    this.gizmoCanvas = document.createElement('canvas');
    this.gizmoCanvas.width = 100;
    this.gizmoCanvas.height = 100;
    this.gizmoCanvas.style.cssText = 'pointer-events:auto;cursor:pointer;border-radius:4px;';
    this.gizmoCanvas.title = 'Click axis to change view';
    topRight.appendChild(this.gizmoCanvas);

    // Stats below gizmo
    this.statsEl = document.createElement('div');
    this.statsEl.style.cssText = 'background:rgba(0,0,0,0.6);padding:4px 8px;border-radius:4px;font-size:10px;color:#aaa;font-family:monospace;line-height:1.6;';
    topRight.appendChild(this.statsEl);
    this.overlay.appendChild(topRight);

    // Gizmo click handler
    this.gizmoCanvas.addEventListener('click', (e) => {
      const rect = this.gizmoCanvas!.getBoundingClientRect();
      const x = e.clientX - rect.left - 50; // center-relative
      const y = e.clientY - rect.top - 50;
      this.handleGizmoClick(x, y);
    });

    // Bottom-center: snap / grid info (live values)
    const bottomCenter = document.createElement('div');
    bottomCenter.className = 'viewport-snap-info';
    this.snapInfoEl = bottomCenter;
    this.overlay.appendChild(bottomCenter);

    // Safe zone canvas (initially hidden)
    this._safeZoneCanvas = document.createElement('canvas');
    this._safeZoneCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;display:none;';
    this.overlay.appendChild(this._safeZoneCanvas);

    // Profiler canvas (initially hidden)
    this._profilerCanvas = document.createElement('canvas');
    this._profilerCanvas.style.cssText = 'position:absolute;bottom:40px;right:8px;pointer-events:none;display:none;border-radius:4px;';
    this._profilerCanvas.width = 240;
    this._profilerCanvas.height = 100;
    this.overlay.appendChild(this._profilerCanvas);

    // Bind camera view buttons
    camRow.querySelectorAll('[data-view]').forEach((btn) => {
      (btn as HTMLElement).style.cssText = 'pointer-events:auto;background:#333;border:1px solid #555;color:#ccc;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;';
      btn.addEventListener('click', () => {
        const view = (btn as HTMLElement).dataset.view!;
        this.setCameraView(view);
      });
    });

    this.startStatsLoop();
    return this.overlay;
  }

  private _makeBtn(icon: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = icon;
    btn.title = title;
    btn.style.cssText = 'background:#333;border:1px solid #555;color:#ccc;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:11px;';
    return btn;
  }

  refresh(): void {
    this.updateStats();
  }

  private startStatsLoop(): void {
    this.statsIntervalId = setInterval(() => {
      this.updateStats();
      this.drawGizmo();
    }, 500);
  }

  private updateStats(): void {
    if (!this.statsEl) return;
    const cam = this.editor.camera;
    const scene = this.editor.scene;
    if (!cam || !scene) return;

    let objCount = 0;
    let vertCount = 0;
    let triCount = 0;
    scene.traverse((child) => {
      objCount++;
      if ((child as any).geometry) {
        const geo = (child as any).geometry;
        if (geo.attributes.position) vertCount += geo.attributes.position.count;
        if (geo.index) triCount += geo.index.count / 3;
        else if (geo.attributes.position) triCount += geo.attributes.position.count / 3;
      }
    });

    const info = this.editor.engine.renderer.info;
    const sel = this.editor.state.selectedObject;
    this.statsEl.innerHTML = `
      Objects: ${objCount} | Draw: ${info.render.calls}<br/>
      Verts: ${vertCount.toLocaleString()} | Tris: ${Math.floor(triCount).toLocaleString()}<br/>
      Geo: ${info.memory.geometries} | Tex: ${info.memory.textures}<br/>
      Cam: ${cam.position.x.toFixed(1)}, ${cam.position.y.toFixed(1)}, ${cam.position.z.toFixed(1)}<br/>
      Tool: ${this.editor.state.tool} (${this.editor.state.transformSpace})<br/>
      ${sel ? `Sel: ${sel.name || sel.type}` : ''}
    `;

    // Update snap info bar
    if (this.snapInfoEl) {
      const s = this.editor.state;
      const parts: string[] = [];
      parts.push(`Grid: ${s.showGrid ? 'On' : 'Off'}`);
      if (s.snapTranslate) parts.push(`Move: ${s.snapTranslate}m`);
      if (s.snapRotate) parts.push(`Rot: ${s.snapRotate}°`);
      if (s.snapScale) parts.push(`Scale: ${s.snapScale}`);
      if (!s.snapTranslate && !s.snapRotate && !s.snapScale) parts.push('Snap: Off');
      this.snapInfoEl.textContent = parts.join(' | ');
    }
  }

  /** Public method for external callers (e.g. menu bar) */
  setCameraViewPublic(view: string): void {
    this.setCameraView(view);
  }

  isSplitModeEnabled(): boolean {
    return this._splitMode;
  }

  renderSplitViewports(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const fullW = renderer.domElement.width;
    const fullH = renderer.domElement.height;
    if (fullW <= 0 || fullH <= 0) return;

    const halfW = Math.floor(fullW / 2);
    const halfH = Math.floor(fullH / 2);
    const frame = this._computeSceneFrame();
    this._syncActiveSplitCameraFromEditor();

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, fullW, fullH);
    renderer.clear(true, true, true);

    renderer.setScissorTest(true);
    for (const sv of SPLIT_VIEWS) {
      const x = sv.col * halfW;
      const y = sv.row === 0 ? halfH : 0;
      const w = sv.col === 1 ? fullW - halfW : halfW;
      const h = sv.row === 0 ? fullH - halfH : halfH;

      const view = this._splitSlotViews.get(sv.slot) ?? sv.defaultView;
      const cam = this._getSplitCamera(sv.slot, view, frame.center, frame.dist);
      this._configureCameraForView(cam, view, frame.center, frame.dist, w, h);

      renderer.setViewport(x, y, w, h);
      renderer.setScissor(x, y, w, h);
      renderer.render(scene, cam);
    }

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, fullW, fullH);
  }

  private setCameraView(view: string): void {
    if (this._splitMode && (view === 'top' || view === 'front' || view === 'right' || view === 'perspective')) {
      this._setSplitSlotView(this._splitActiveSlot, view);
      this._syncEditorCameraFromActiveSplit();
      return;
    }

    const cam = this.editor.camera;
    const controls = this.editor.controls;
    if (!cam || !controls) return;

    const tc = this.editor.transformControls;
    const attachedObj = tc.object ?? null;
    if (attachedObj) tc.detach();
    const tcHelper = tc.getHelper();
    const tcParent = tcHelper.parent;
    if (tcParent) tcParent.remove(tcHelper);

    // Calculate scene bounding sphere to adapt distance
    const { center, dist } = this._computeSceneFrame();

    controls.target.copy(center);

    switch (view) {
      case 'front':
        cam.position.set(center.x, center.y + 2, center.z + dist);
        break;
      case 'right':
        cam.position.set(center.x + dist, center.y + 2, center.z);
        break;
      case 'top':
        cam.position.set(center.x, center.y + dist, center.z + 0.01);
        break;
      case 'perspective':
        cam.position.set(center.x + dist * 0.6, center.y + dist * 0.5, center.z + dist * 0.6);
        break;
    }

    controls.update();

    if (tcParent) tcParent.add(tcHelper);
    if (attachedObj) {
      tc.attach(attachedObj);
      tc.getHelper().updateMatrixWorld(true);
    }
  }

  // ── Orientation Gizmo (axis indicator in top-right) ──────────────

  private drawGizmo(): void {
    const canvas = this.gizmoCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cam = this.editor.camera;
    if (!cam) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const len = 30;

    ctx.clearRect(0, 0, w, h);

    // Background circle
    ctx.beginPath();
    ctx.arc(cx, cy, 44, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30,30,30,0.7)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,80,80,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Camera rotation matrix (inverse view direction)
    const mat = new THREE.Matrix4().makeRotationFromEuler(cam.rotation);
    const axes = [
      { dir: new THREE.Vector3(1, 0, 0), color: '#e74c3c', label: 'X', neg: '-X' },
      { dir: new THREE.Vector3(0, 1, 0), color: '#2ecc71', label: 'Y', neg: '-Y' },
      { dir: new THREE.Vector3(0, 0, 1), color: '#3498db', label: 'Z', neg: '-Z' },
    ];

    // Project axis directions to screen space via camera view matrix
    const viewMat = cam.matrixWorldInverse;
    const projected = axes.map(a => {
      const d = a.dir.clone().applyMatrix4(viewMat).normalize();
      return {
        ...a,
        // Screen-space x/y (right-handed: x right, y up → canvas: y down)
        sx: d.x * len,
        sy: -d.y * len,
        depth: d.z,
      };
    });

    // Sort back-to-front for correct overlap
    const sorted = [...projected].sort((a, b) => a.depth - b.depth);

    for (const axis of sorted) {
      // Draw line from center to projected endpoint
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + axis.sx, cy + axis.sy);
      ctx.strokeStyle = axis.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = axis.depth > 0 ? 1 : 0.3;
      ctx.stroke();

      // Draw circle at end
      ctx.beginPath();
      ctx.arc(cx + axis.sx, cy + axis.sy, 8, 0, Math.PI * 2);
      ctx.fillStyle = axis.color;
      ctx.fill();

      // Label
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(axis.depth > 0 ? axis.label : axis.neg, cx + axis.sx, cy + axis.sy);

      ctx.globalAlpha = 1;
    }
  }

  private handleGizmoClick(x: number, y: number): void {
    // Check which axis endpoint is closest
    const cam = this.editor.camera;
    if (!cam) return;

    const len = 30;
    const viewMat = cam.matrixWorldInverse;
    const axes = [
      { dir: new THREE.Vector3(1, 0, 0), view: 'right' },
      { dir: new THREE.Vector3(0, 1, 0), view: 'top' },
      { dir: new THREE.Vector3(0, 0, 1), view: 'front' },
    ];

    let bestDist = 20; // click threshold
    let bestView = '';

    for (const axis of axes) {
      const d = axis.dir.clone().applyMatrix4(viewMat).normalize();
      const sx = d.x * len;
      const sy = -d.y * len;
      const dist = Math.sqrt((x - sx) ** 2 + (y - sy) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        bestView = axis.view;
      }
      // Check negative axis too
      const distNeg = Math.sqrt((x + sx) ** 2 + (y + sy) ** 2);
      if (distNeg < bestDist) {
        bestDist = distNeg;
        bestView = axis.view; // same view for negative (camera looks from opposite side)
      }
    }

    if (bestView) {
      this.setCameraView(bestView);
    }
  }

  dispose(): void {
    if (this.statsIntervalId !== null) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }
    if (this._profilerRafId) cancelAnimationFrame(this._profilerRafId);
    this._restoreDefaultMaterials();
  }

  // ── Phase 7: Render mode overlays ─────────────────────────────────────────

  setRenderMode(mode: RenderMode): void {
    this._restoreDefaultMaterials();
    this.renderMode = mode;

    if (mode === 'default') return;

    const tc = this.editor.transformControls;
    const attachedObj = tc.object ?? null;
    if (attachedObj) tc.detach();
    const tcHelper = tc.getHelper();
    const tcParent = tcHelper.parent;
    if (tcParent) tcParent.remove(tcHelper);

    let overrideMat: THREE.Material | null = null;

    switch (mode) {
      case 'wireframe':
        overrideMat = new THREE.MeshBasicMaterial({ color: 0x88ccff, wireframe: true });
        break;
      case 'albedo':
        // Show only albedo map — swap to MeshBasicMaterial with existing map
        break;
      case 'normals':
        overrideMat = new THREE.MeshNormalMaterial();
        break;
      case 'roughness':
        // Show roughness channel as grey
        overrideMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
        break;
      case 'uv':
        // UV checker uses a procedural canvas texture
        overrideMat = new THREE.MeshBasicMaterial({ map: this._createUVCheckerTexture() });
        break;
      case 'depth':
        overrideMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        break;
      case 'ao':
        // Visualise AO map; fall back to dark base if not present
        overrideMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        break;
    }

    this.editor.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (child.userData.__editorHelper) return;
      if (this._isTransformControlMesh(child)) return;

      // Backup
      this._materialBackup.set(child, child.material);

      if (mode === 'albedo') {
        // Per-mesh: try to extract albedo map
        const src = Array.isArray(child.material) ? child.material[0] : child.material;
        const map = (src as any).map ?? null;
        child.material = new THREE.MeshBasicMaterial({ map, color: 0xffffff });
      } else if (mode === 'roughness') {
        const src = Array.isArray(child.material) ? child.material[0] : child.material;
        const roughness = (src as any).roughness ?? 0.5;
        const c = Math.round(roughness * 255);
        child.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(c / 255, c / 255, c / 255) });
      } else if (mode === 'ao') {
        const src = Array.isArray(child.material) ? child.material[0] : child.material;
        const aoMap = (src as any).aoMap ?? null;
        child.material = new THREE.MeshBasicMaterial({ map: aoMap, color: aoMap ? 0xffffff : 0x444444 });
      } else if (overrideMat) {
        child.material = overrideMat;
      }
    });

    if (tcParent) tcParent.add(tcHelper);
    if (attachedObj) {
      tc.attach(attachedObj);
      tc.getHelper().updateMatrixWorld(true);
    }
  }

  private _restoreDefaultMaterials(): void {
    for (const [mesh, mat] of this._materialBackup) {
      mesh.material = mat;
    }
    this._materialBackup.clear();
  }

  private _createUVCheckerTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const tileSize = size / 8;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#e0e0e0' : '#444';
        ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
      }
    }
    // Grid lines
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * tileSize, 0);
      ctx.lineTo(i * tileSize, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * tileSize);
      ctx.lineTo(size, i * tileSize);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // ── Phase 7: Performance profiler ─────────────────────────────────────────

  toggleProfiler(): void {
    this._profilerVisible = !this._profilerVisible;
    if (!this._profilerCanvas) return;
    this._profilerCanvas.style.display = this._profilerVisible ? 'block' : 'none';
    if (this._profilerVisible) {
      this._runProfilerLoop();
    } else {
      cancelAnimationFrame(this._profilerRafId);
    }
  }

  private _runProfilerLoop(): void {
    const draw = (ts: number) => {
      if (!this._profilerVisible) return;

      const delta = this._lastFrameTs ? ts - this._lastFrameTs : 16.67;
      this._lastFrameTs = ts;
      this._frameTimes.push(delta);
      if (this._frameTimes.length > 120) this._frameTimes.shift();

      this._drawProfiler();
      this._profilerRafId = requestAnimationFrame(draw);
    };
    this._profilerRafId = requestAnimationFrame(draw);
  }

  private _drawProfiler(): void {
    const canvas = this._profilerCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = 'rgba(15,15,20,0.85)';
    ctx.roundRect?.(0, 0, W, H, 4);
    ctx.fill();

    const times = this._frameTimes;
    if (times.length === 0) return;

    const maxMs = Math.max(...times, 33.33);
    const BAR_H = H - 28;
    const barW = W / 120;

    // 16.7ms (60fps) reference line
    const y60 = BAR_H - (16.67 / maxMs) * BAR_H;
    ctx.strokeStyle = 'rgba(0,255,0,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y60);
    ctx.lineTo(W, y60);
    ctx.stroke();
    ctx.setLineDash([]);

    // 33.3ms (30fps) reference line
    const y30 = BAR_H - (33.33 / maxMs) * BAR_H;
    ctx.strokeStyle = 'rgba(255,165,0,0.3)';
    ctx.beginPath();
    ctx.moveTo(0, y30);
    ctx.lineTo(W, y30);
    ctx.stroke();

    // Bars
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      const x = i * barW;
      const h = (t / maxMs) * BAR_H;
      ctx.fillStyle = t > 33.33 ? '#e74c3c' : t > 16.67 ? '#f39c12' : '#2ecc71';
      ctx.fillRect(x, BAR_H - h, barW - 0.5, h);
    }

    // Current FPS + ms
    const last = times[times.length - 1] ?? 16.67;
    const fps = Math.round(1000 / last);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`${fps} FPS  ${last.toFixed(1)} ms`, 6, H - 8);

    // ECS system timings (if any budgeted systems)
    const world = this.editor.engine.world;
    const sysTimings = world.getSystemTimings();
    if (sysTimings.size > 0) {
      let xOff = 90;
      for (const [sys, ms] of sysTimings) {
        const sysName = sys.constructor.name.replace('System', '');
        ctx.fillStyle = '#aaa';
        ctx.font = '9px monospace';
        ctx.fillText(`${sysName}:${ms.toFixed(1)}`, xOff, H - 8);
        xOff += sysName.length * 6 + 30;
        if (xOff > W - 20) break;
      }
    }
  }

  // ── Phase 7: Safe zone overlay ────────────────────────────────────────────

  private _updateSafeZone(): void {
    const canvas = this._safeZoneCanvas;
    if (!canvas) return;

    if (!this._safeZoneVisible) {
      canvas.style.display = 'none';
      return;
    }

    canvas.style.display = 'block';

    // Resize canvas to match overlay
    const w = this.overlay.clientWidth || 1280;
    const h = this.overlay.clientHeight || 720;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    const [rW, rH] = this._safeZoneRatio === '16:9' ? [16, 9]
                   : this._safeZoneRatio === '4:3'  ? [4,  3]
                   : [21, 9]; // 21:9

    // Calculate guide rect centered in viewport
    let guideW = w;
    let guideH = Math.round(w * rH / rW);
    if (guideH > h) { guideH = h; guideW = Math.round(h * rW / rH); }
    const gx = (w - guideW) / 2;
    const gy = (h - guideH) / 2;

    // Darken outside
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, w, gy);                        // top
    ctx.fillRect(0, gy + guideH, w, h - gy - guideH); // bottom
    ctx.fillRect(0, gy, gx, guideH);                  // left
    ctx.fillRect(gx + guideW, gy, w - gx - guideW, guideH); // right

    // Border
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(gx + 0.5, gy + 0.5, guideW - 1, guideH - 1);
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(this._safeZoneRatio, gx + 6, gy + 16);
  }

  // ── Phase 7: Screenshot ───────────────────────────────────────────────────

  captureScreenshot(filename?: string): void {
    const canvas = this.editor.engine.renderer.domElement;
    // Force a render so the canvas contains the latest frame
    try {
      this.editor.engine.renderer.render(this.editor.scene, this.editor.camera);
    } catch { /* in play mode the game renderer owns the canvas — skip */ }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? `viewport_${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/png');
  }

  // ── Phase 7: Camera bookmarks ─────────────────────────────────────────────

  /** Save current camera position as a named bookmark (slot 0–4). */
  saveBookmark(slot: number, name?: string): void {
    const cam = this.editor.camera;
    const controls = this.editor.controls;
    const bk: CameraBookmark = {
      name: name ?? `Bookmark ${slot + 1}`,
      position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      target:   { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      fov:      cam.fov,
    };
    this._bookmarks[slot] = bk;
    this._persistBookmarks();
  }

  /** Restore camera to a saved bookmark. */
  restoreBookmark(slot: number): void {
    const bk = this._bookmarks[slot];
    if (!bk) return;
    const cam = this.editor.camera;
    const controls = this.editor.controls;
    cam.position.set(bk.position.x, bk.position.y, bk.position.z);
    cam.fov = bk.fov;
    cam.updateProjectionMatrix();
    controls.target.set(bk.target.x, bk.target.y, bk.target.z);
    controls.update();
  }

  /** Get all saved bookmarks. */
  getBookmarks(): (CameraBookmark | null)[] {
    const result: (CameraBookmark | null)[] = [];
    for (let i = 0; i < MAX_BOOKMARKS; i++) {
      result.push(this._bookmarks[i] ?? null);
    }
    return result;
  }

  private _renderBookmarkRow(container: HTMLElement): void {
    container.innerHTML = '';
    for (let i = 0; i < MAX_BOOKMARKS; i++) {
      const bk = this._bookmarks[i];
      const slot = i;

      const btn = document.createElement('button');
      btn.title = bk ? `${bk.name} (click=restore, Ctrl+click=save)` : `Save camera to slot ${i + 1} (Ctrl+click)`;
      btn.style.cssText = `background:${bk ? '#1f6feb' : '#333'};border:1px solid #555;color:#ccc;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:10px;min-width:24px;`;
      btn.textContent = `${i + 1}`;

      btn.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
          this.saveBookmark(slot);
          this._renderBookmarkRow(container);
        } else {
          this.restoreBookmark(slot);
        }
      });
      container.appendChild(btn);
    }

    const hint = document.createElement('span');
    hint.textContent = '  Ctrl+click=save';
    hint.style.cssText = 'font-size:9px;color:#555;';
    container.appendChild(hint);
  }

  private _loadBookmarks(): void {
    try {
      const raw = localStorage.getItem(BOOKMARK_KEY);
      if (raw) this._bookmarks = JSON.parse(raw);
    } catch { this._bookmarks = []; }
  }

  private _persistBookmarks(): void {
    try {
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify(this._bookmarks));
    } catch { /* ignore */ }
  }

  // ── Phase 7: 4-way split viewport ────────────────────────────────────────

  private _updateSplitMode(): void {
    // Find the viewport container (parent of the overlay)
    const parent = this.overlay.parentElement;
    if (!parent) return;

    if (!this._splitMode) {
      // Remove split overlay if it exists
      if (this._splitContainer) {
        if (this._splitContainer.parentElement === parent) {
          parent.removeChild(this._splitContainer);
        }
        this._splitContainer = null;
      }
      this._splitCellEls.clear();
      this._splitLabelEls.clear();
      this.editor.controls.enableRotate = true;
      return;
    }

    // Create 2×2 split overlay on top of the viewport
    if (this._splitContainer && this._splitContainer.parentElement === parent) {
      parent.removeChild(this._splitContainer);
    }

    const splitEl = document.createElement('div');
    splitEl.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;z-index:4;pointer-events:none;';

    for (const sv of SPLIT_VIEWS) {
      const cell = document.createElement('div');
      cell.style.cssText = `
        position:relative;
        border:1px solid #333;
        overflow:hidden;
        pointer-events:auto;
      `;
      cell.style.gridColumn = String(sv.col + 1);
      cell.style.gridRow = String(sv.row + 1);

      // Label
      const label = document.createElement('div');
      label.textContent = this._labelForView(this._splitSlotViews.get(sv.slot) ?? sv.defaultView);
      label.style.cssText = 'position:absolute;top:4px;left:6px;font-size:10px;color:#888;z-index:2;pointer-events:none;';
      cell.appendChild(label);
      this._splitLabelEls.set(sv.slot, label);

      cell.addEventListener('click', () => {
        this._splitActiveSlot = sv.slot;
        this._syncEditorCameraFromActiveSplit();
        this._highlightActiveSplitCell();
      });
      cell.classList.add('split-cell');
      cell.dataset.slot = sv.slot;
      this._splitCellEls.set(sv.slot, cell);

      splitEl.appendChild(cell);
    }

    // Separator lines
    const hLine = document.createElement('div');
    hLine.style.cssText = 'position:absolute;top:50%;left:0;right:0;height:1px;background:#333;z-index:11;pointer-events:none;';
    const vLine = document.createElement('div');
    vLine.style.cssText = 'position:absolute;left:50%;top:0;bottom:0;width:1px;background:#333;z-index:11;pointer-events:none;';
    splitEl.appendChild(hLine);
    splitEl.appendChild(vLine);

    parent.appendChild(splitEl);
    this._splitContainer = splitEl;
    this._highlightActiveSplitCell();
    this._syncEditorCameraFromActiveSplit();
  }

  private _isTransformControlMesh(obj: THREE.Object3D): boolean {
    const helper = this.editor.transformControls.getHelper();
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur === helper) return true;
      cur = cur.parent;
    }
    return false;
  }

  private _computeSceneFrame(): { center: THREE.Vector3; dist: number } {
    const box = new THREE.Box3();
    let hasGeometry = false;
    this.editor.scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && !child.userData.__editorHelper && !this._isTransformControlMesh(child)) {
        box.expandByObject(child);
        hasGeometry = true;
      }
    });

    if (!hasGeometry) {
      const center = this.editor.controls?.target?.clone?.() ?? new THREE.Vector3();
      return { center, dist: 20 };
    }

    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const center = Number.isFinite(sphere.center.x) && Number.isFinite(sphere.center.y) && Number.isFinite(sphere.center.z)
      ? sphere.center.clone()
      : new THREE.Vector3();
    const dist = Number.isFinite(sphere.radius) ? Math.max(sphere.radius * 2.5, 20) : 20;
    return { center, dist };
  }

  private _getSplitCamera(slot: SplitView['slot'], view: CameraView, center: THREE.Vector3, dist: number): THREE.Camera {
    const existing = this._splitCameras.get(slot);
    const wantsPerspective = view === 'perspective';

    if (existing) {
      const isPerspective = existing instanceof THREE.PerspectiveCamera;
      if ((wantsPerspective && isPerspective) || (!wantsPerspective && existing instanceof THREE.OrthographicCamera)) {
        return existing;
      }
    }

    const base = this.editor.camera;
    let cam: THREE.Camera;
    if (wantsPerspective) {
      const p = new THREE.PerspectiveCamera(base.fov, base.aspect, base.near, base.far);
      p.position.copy(base.position);
      p.quaternion.copy(base.quaternion);
      cam = p;
    } else {
      const o = new THREE.OrthographicCamera(-20, 20, 20, -20, base.near, base.far);
      o.zoom = 1;
      o.userData.frustumHeight = Math.max(dist, 20);
      this._applyViewPreset(o, view, center, dist);
      cam = o;
    }

    this._splitCameras.set(slot, cam);
    return cam;
  }

  private _configureCameraForView(
    cam: THREE.Camera,
    view: CameraView,
    center: THREE.Vector3,
    _dist: number,
    viewportW: number,
    viewportH: number,
  ): void {
    const base = this.editor.camera;
    const aspect = Math.max(0.0001, viewportW / Math.max(1, viewportH));

    if (cam instanceof THREE.PerspectiveCamera) {
      cam.fov = base.fov;
      cam.near = base.near;
      cam.far = base.far;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
      return;
    }

    if (cam instanceof THREE.OrthographicCamera) {
      const frustumH = Number.isFinite(cam.userData.frustumHeight) ? cam.userData.frustumHeight as number : 40;
      cam.left = (-frustumH * aspect) / 2;
      cam.right = (frustumH * aspect) / 2;
      cam.top = frustumH / 2;
      cam.bottom = -frustumH / 2;
      cam.near = base.near;
      cam.far = base.far;

      if (view === 'top' || view === 'front' || view === 'right') {
        // Keep orthographic panes axis-aligned in split mode (3ds Max style).
        cam.up.set(0, 1, 0);
        if (view === 'top') cam.up.set(0, 0, -1);
      }
      cam.updateProjectionMatrix();
      return;
    }
  }

  private _setSplitSlotView(slot: SplitView['slot'], view: CameraView): void {
    this._splitSlotViews.set(slot, view);
    const frame = this._computeSceneFrame();
    const cam = this._getSplitCamera(slot, view, frame.center, frame.dist);
    this._applyViewPreset(cam, view, frame.center, frame.dist);
    const label = this._splitLabelEls.get(slot);
    if (label) label.textContent = this._labelForView(view);
    this._highlightActiveSplitCell();
  }

  private _applyViewPreset(cam: THREE.Camera, view: CameraView, center: THREE.Vector3, dist: number): void {
    if (cam instanceof THREE.PerspectiveCamera) {
      switch (view) {
        case 'front':
          cam.position.set(center.x, center.y + 2, center.z + dist);
          break;
        case 'right':
          cam.position.set(center.x + dist, center.y + 2, center.z);
          break;
        case 'top':
          cam.position.set(center.x, center.y + dist, center.z + 0.01);
          break;
        case 'perspective':
          cam.position.copy(this.editor.camera.position);
          cam.quaternion.copy(this.editor.camera.quaternion);
          cam.updateProjectionMatrix();
          return;
      }
      cam.lookAt(center);
      cam.updateProjectionMatrix();
      return;
    }

    if (cam instanceof THREE.OrthographicCamera) {
      switch (view) {
        case 'top':
          cam.position.set(center.x, center.y + dist, center.z + 0.01);
          cam.up.set(0, 0, -1);
          break;
        case 'front':
          cam.position.set(center.x, center.y + 2, center.z + dist);
          cam.up.set(0, 1, 0);
          break;
        case 'right':
          cam.position.set(center.x + dist, center.y + 2, center.z);
          cam.up.set(0, 1, 0);
          break;
        case 'perspective':
          break;
      }
      cam.lookAt(center);
      cam.updateProjectionMatrix();
    }
  }

  private _syncEditorCameraFromActiveSplit(): void {
    const controls = this.editor.controls;
    const frame = this._computeSceneFrame();
    const view = this._splitSlotViews.get(this._splitActiveSlot) ?? 'perspective';
    const activeCam = this._getSplitCamera(this._splitActiveSlot, view, frame.center, frame.dist);

    if (activeCam instanceof THREE.PerspectiveCamera) {
      this.editor.camera.position.copy(activeCam.position);
      this.editor.camera.quaternion.copy(activeCam.quaternion);
      this.editor.camera.fov = activeCam.fov;
      controls.enableRotate = true;
      controls.update();
      return;
    }

    if (activeCam instanceof THREE.OrthographicCamera) {
      this.editor.camera.position.copy(activeCam.position);
      this.editor.camera.quaternion.copy(activeCam.quaternion);
      controls.enableRotate = false;
      controls.update();
    }
  }

  private _syncActiveSplitCameraFromEditor(): void {
    if (!this._splitMode) return;
    const view = this._splitSlotViews.get(this._splitActiveSlot) ?? 'perspective';
    const cam = this._splitCameras.get(this._splitActiveSlot);
    if (!cam) return;

    if (view === 'perspective' && cam instanceof THREE.PerspectiveCamera) {
      cam.position.copy(this.editor.camera.position);
      cam.quaternion.copy(this.editor.camera.quaternion);
      cam.fov = this.editor.camera.fov;
      cam.updateProjectionMatrix();
      return;
    }

    if (cam instanceof THREE.OrthographicCamera) {
      cam.position.copy(this.editor.camera.position);
      cam.quaternion.copy(this.editor.camera.quaternion);
      cam.updateProjectionMatrix();
    }
  }

  private _highlightActiveSplitCell(): void {
    for (const [slot, el] of this._splitCellEls) {
      el.style.outline = slot === this._splitActiveSlot ? '1px solid #0078d4' : 'none';
    }
  }

  private _labelForView(view: CameraView): string {
    switch (view) {
      case 'top': return 'Top';
      case 'front': return 'Front';
      case 'right': return 'Right';
      case 'perspective': return 'Persp';
    }
  }
}
