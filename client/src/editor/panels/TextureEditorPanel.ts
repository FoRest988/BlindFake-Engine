/**
 * TextureEditorPanel — Full-featured texture editor.
 *
 * Features:
 *  - UV overlay viewer: renders UV islands on top of the loaded texture
 *  - Channel viewer: isolate R / G / B / A channels
 *  - Image adjustments: brightness, contrast, hue-rotate, saturation
 *  - Resize & export (PNG / JPEG)
 *  - Texture paint: brush that writes directly to the canvas texture
 *  - Drag-onto-scene: drag from the panel onto a viewport mesh to assign the texture
 */

import * as THREE from 'three';
import type { EditorApp } from '../EditorApp';

type ChannelMode = 'rgb' | 'r' | 'g' | 'b' | 'a';

interface AdjustmentState {
  brightness: number;  // -100..100
  contrast: number;    // -100..100
  hue: number;         // 0..360
  saturation: number;  // -100..100
}

export class TextureEditorPanel {
  private editor: EditorApp;
  private container: HTMLElement | null = null;

  // Source image
  private sourceImage: HTMLImageElement | null = null;
  private sourceCanvas: HTMLCanvasElement | null = null;   // working copy (mutable)
  private sourceCtx: CanvasRenderingContext2D | null = null;
  private sourceFileName = 'texture';

  // Display canvas
  private displayCanvas!: HTMLCanvasElement;
  private displayCtx!: CanvasRenderingContext2D;

  // UV overlay
  private uvMesh: THREE.Mesh | null = null;
  private showUV = false;

  // Channel mode
  private channelMode: ChannelMode = 'rgb';

  // Adjustments (applied non-destructively on top of source)
  private adj: AdjustmentState = { brightness: 0, contrast: 0, hue: 0, saturation: 0 };

  // Texture paint
  private isPainting = false;
  private paintColor = '#ff0000';
  private paintSize = 16;
  private paintOpacity = 0.8;

  // Export settings
  private exportWidth = 512;
  private exportHeight = 512;

  // Three.js texture output (for live preview + drag-assign)
  private outTexture: THREE.CanvasTexture | null = null;

  // Resize observer
  private resizeObserver: ResizeObserver | null = null;

  constructor(editor: EditorApp) {
    this.editor = editor;
  }

  render(): HTMLElement {
    if (this.container) return this.container;

    this.container = document.createElement('div');
    this.container.className = 'tep-root';
    this.container.style.cssText =
      'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#1a1a1a;color:#ccc;font-family:system-ui,sans-serif;font-size:12px;';

    this._addStyles();
    this._buildUI();
    return this.container;
  }

  private _buildUI(): void {
    if (!this.container) return;

    // ── Header ──────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #333;flex-shrink:0;background:#141414;';
    header.innerHTML = '<span style="font-size:13px;font-weight:600;">🖼️ Texture Editor</span>';

    const loadBtn = this._btn('📁 Load', '#1f6feb', () => this._loadFile());
    const exportBtn = this._btn('📤 Export', '#2a4a2a', () => this._exportTexture());
    const assignBtn = this._btn('🖌️ Assign to Selection', '#3a2a5a', () => this._assignToSelection());
    header.appendChild(loadBtn);
    header.appendChild(exportBtn);
    header.appendChild(assignBtn);
    this.container!.appendChild(header);

    // ── Main area: canvas left + controls right ─────────────────────
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex:1;min-height:0;';
    this.container!.appendChild(body);

    // Canvas area
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText =
      'flex:1;min-width:0;position:relative;background:#111;display:flex;align-items:center;justify-content:center;overflow:hidden;';
    body.appendChild(canvasWrap);

    this.displayCanvas = document.createElement('canvas');
    this.displayCanvas.width = 512;
    this.displayCanvas.height = 512;
    this.displayCanvas.style.cssText =
      'max-width:100%;max-height:100%;image-rendering:pixelated;cursor:crosshair;';
    this.displayCtx = this.displayCanvas.getContext('2d')!;
    canvasWrap.appendChild(this.displayCanvas);

    this._setupPaintEvents();

    // Placeholder when no image loaded
    const placeholder = document.createElement('div');
    placeholder.id = 'tep-placeholder';
    placeholder.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:#444;pointer-events:none;';
    placeholder.innerHTML =
      '<div style="font-size:48px;">🖼️</div><div style="font-size:13px;">Load a texture to begin</div>';
    canvasWrap.appendChild(placeholder);

    // ── Controls sidebar ────────────────────────────────────────────
    const sidebar = document.createElement('div');
    sidebar.style.cssText =
      'width:220px;flex-shrink:0;border-left:1px solid #333;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:10px;';
    body.appendChild(sidebar);

    // Channel viewer
    this._buildSection(sidebar, '📺 Channel', (sec) => {
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
      for (const [ch, label] of [['rgb', 'RGB'], ['r', 'R'], ['g', 'G'], ['b', 'B'], ['a', 'A']] as const) {
        const b = document.createElement('button');
        b.textContent = label;
        b.dataset.ch = ch;
        b.className = 'tep-ch-btn' + (ch === this.channelMode ? ' active' : '');
        b.addEventListener('click', () => {
          this.channelMode = ch;
          sidebar.querySelectorAll('.tep-ch-btn').forEach(el =>
            el.classList.toggle('active', (el as HTMLElement).dataset.ch === ch));
          this._redraw();
        });
        btns.appendChild(b);
      }
      sec.appendChild(btns);
    });

    // UV overlay
    this._buildSection(sidebar, '📐 UV Overlay', (sec) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.addEventListener('change', () => {
        this.showUV = toggle.checked;
        this._redraw();
      });
      const label = document.createElement('label');
      label.textContent = 'Show UV islands';
      label.style.cssText = 'font-size:11px;cursor:pointer;';
      label.prepend(toggle);
      row.appendChild(label);
      sec.appendChild(row);

      const pickBtn = this._btn('Pick from Selection', '#333', () => this._pickUVFromSelection());
      pickBtn.style.cssText += 'width:100%;margin-top:6px;';
      sec.appendChild(pickBtn);
    });

    // Adjustments
    this._buildSection(sidebar, '⚙️ Adjustments', (sec) => {
      this._buildSlider(sec, 'Brightness', -100, 100, this.adj.brightness, (v) => {
        this.adj.brightness = v; this._redraw();
      });
      this._buildSlider(sec, 'Contrast', -100, 100, this.adj.contrast, (v) => {
        this.adj.contrast = v; this._redraw();
      });
      this._buildSlider(sec, 'Hue', 0, 360, this.adj.hue, (v) => {
        this.adj.hue = v; this._redraw();
      });
      this._buildSlider(sec, 'Saturation', -100, 100, this.adj.saturation, (v) => {
        this.adj.saturation = v; this._redraw();
      });
      const applyBtn = this._btn('Apply (Destructive)', '#4a2a1a', () => this._applyAdjustments());
      applyBtn.style.cssText += 'width:100%;margin-top:6px;font-size:10px;';
      sec.appendChild(applyBtn);
      const resetBtn = this._btn('Reset Adjustments', '#333', () => {
        this.adj = { brightness: 0, contrast: 0, hue: 0, saturation: 0 };
        sec.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(el => {
          const field = el.dataset.field!;
          el.value = '0';
          (el.nextElementSibling as HTMLElement).textContent = '0';
        });
        this._redraw();
      });
      resetBtn.style.cssText += 'width:100%;font-size:10px;';
      sec.appendChild(resetBtn);
    });

    // Texture paint
    this._buildSection(sidebar, '🖌️ Paint', (sec) => {
      // Color picker
      const colorRow = document.createElement('div');
      colorRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = this.paintColor;
      colorInput.style.cssText = 'width:32px;height:24px;padding:0;border:1px solid #555;cursor:pointer;border-radius:3px;background:none;';
      colorInput.addEventListener('input', () => { this.paintColor = colorInput.value; });
      const colorLabel = document.createElement('span');
      colorLabel.style.cssText = 'font-size:11px;';
      colorLabel.textContent = 'Brush Color';
      colorRow.appendChild(colorInput);
      colorRow.appendChild(colorLabel);
      sec.appendChild(colorRow);

      this._buildSlider(sec, 'Size', 1, 64, this.paintSize, (v) => { this.paintSize = v; });
      this._buildSlider(sec, 'Opacity', 0, 100, Math.round(this.paintOpacity * 100), (v) => { this.paintOpacity = v / 100; });

      const clearBtn = this._btn('Clear Paint Layer', '#4a1a1a', () => {
        if (!this.sourceCtx || !this.sourceCanvas) return;
        this.sourceCtx.clearRect(0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
        if (this.sourceImage) {
          this.sourceCtx.drawImage(this.sourceImage, 0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
        }
        this._redraw();
      });
      clearBtn.style.cssText += 'width:100%;margin-top:6px;font-size:10px;';
      sec.appendChild(clearBtn);
    });

    // Resize & export
    this._buildSection(sidebar, '📐 Resize & Export', (sec) => {
      const sizeRow = document.createElement('div');
      sizeRow.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px;';

      const wInput = this._numInput(this.exportWidth, (v) => { this.exportWidth = v; });
      const xLabel = document.createElement('span'); xLabel.textContent = '×'; xLabel.style.color = '#888';
      const hInput = this._numInput(this.exportHeight, (v) => { this.exportHeight = v; });
      sizeRow.appendChild(wInput); sizeRow.appendChild(xLabel); sizeRow.appendChild(hInput);
      sec.appendChild(sizeRow);

      const presets = ['128', '256', '512', '1024', '2048'];
      const presetRow = document.createElement('div');
      presetRow.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;margin-bottom:6px;';
      for (const p of presets) {
        const b = document.createElement('button');
        b.textContent = p;
        b.className = 'tep-btn';
        b.style.fontSize = '9px';
        b.addEventListener('click', () => {
          this.exportWidth = this.exportHeight = parseInt(p);
          (wInput as HTMLInputElement).value = p;
          (hInput as HTMLInputElement).value = p;
        });
        presetRow.appendChild(b);
      }
      sec.appendChild(presetRow);

      const pngBtn = this._btn('📥 PNG', '#1f6feb', () => this._exportTexture('png'));
      const jpgBtn = this._btn('📥 JPEG', '#2a3a2a', () => this._exportTexture('jpeg'));
      const row2 = document.createElement('div');
      row2.style.cssText = 'display:flex;gap:6px;';
      row2.appendChild(pngBtn); row2.appendChild(jpgBtn);
      sec.appendChild(row2);
    });

    // Info
    this._buildSection(sidebar, 'ℹ️ Info', (sec) => {
      const info = document.createElement('div');
      info.id = 'tep-info';
      info.style.cssText = 'font-size:10px;color:#888;line-height:1.6;';
      info.textContent = 'No texture loaded.';
      sec.appendChild(info);
    });

    this._drawCheckerboard();
  }

  // ═══════════════════════════════════════════════════════════════════
  // Load & I/O
  // ═══════════════════════════════════════════════════════════════════

  private _loadFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      this.sourceFileName = file.name.replace(/\.[^.]+$/, '');
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        this.sourceImage = img;
        // Create working canvas copy (same size as image)
        this.sourceCanvas = document.createElement('canvas');
        this.sourceCanvas.width = img.width;
        this.sourceCanvas.height = img.height;
        this.sourceCtx = this.sourceCanvas.getContext('2d')!;
        this.sourceCtx.drawImage(img, 0, 0);

        this.exportWidth = img.width;
        this.exportHeight = img.height;

        // Build Three.js output texture from working canvas
        if (this.outTexture) this.outTexture.dispose();
        this.outTexture = new THREE.CanvasTexture(this.sourceCanvas);
        this.outTexture.wrapS = this.outTexture.wrapT = THREE.RepeatWrapping;

        this._updateInfo();
        this._hidePlaceholder();
        this._redraw();
        URL.revokeObjectURL(url);
      };
      img.src = url;
    };
    input.click();
  }

  /** Load a Three.js texture into the panel (called externally). */
  loadTexture(texture: THREE.Texture, name = 'texture'): void {
    this.sourceFileName = name;
    const canvas = document.createElement('canvas');
    const img = texture.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement | null;
    if (!img) return;
    canvas.width  = (img as HTMLImageElement).width  ?? (img as ImageBitmap).width;
    canvas.height = (img as HTMLImageElement).height ?? (img as ImageBitmap).height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img as CanvasImageSource, 0, 0);

    this.sourceCanvas = canvas;
    this.sourceCtx = ctx;
    this.exportWidth = canvas.width;
    this.exportHeight = canvas.height;

    if (this.outTexture) this.outTexture.dispose();
    this.outTexture = new THREE.CanvasTexture(canvas);
    this.outTexture.wrapS = this.outTexture.wrapT = THREE.RepeatWrapping;

    this._hidePlaceholder();
    this._updateInfo();
    this._redraw();
  }

  private _exportTexture(format: 'png' | 'jpeg' = 'png'): void {
    if (!this.sourceCanvas) return;
    const out = document.createElement('canvas');
    out.width  = this.exportWidth;
    out.height = this.exportHeight;
    const ctx = out.getContext('2d')!;
    // Apply CSS filter for adjustments on the export
    ctx.filter = this._buildCSSFilter();
    ctx.drawImage(this.sourceCanvas, 0, 0, this.exportWidth, this.exportHeight);
    ctx.filter = 'none';

    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ext  = format === 'jpeg' ? 'jpg' : 'png';
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${this.sourceFileName}_edited.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, mime, 0.95);
  }

  private _assignToSelection(): void {
    if (!this.outTexture) return;
    const obj = this.editor.state?.selectedObject;
    if (obj instanceof THREE.Mesh) {
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if ('map' in mat) {
        (mat as THREE.MeshStandardMaterial).map = this.outTexture;
        mat.needsUpdate = true;
      }
    }
  }

  private _pickUVFromSelection(): void {
    const obj = this.editor.state?.selectedObject;
    if (obj instanceof THREE.Mesh) {
      this.uvMesh = obj;
      this.showUV = true;
      const toggle = this.container?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (toggle) toggle.checked = true;
      this._redraw();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Drawing
  // ═══════════════════════════════════════════════════════════════════

  private _redraw(): void {
    if (!this.displayCtx) return;
    const w = this.displayCanvas.width;
    const h = this.displayCanvas.height;

    this.displayCtx.clearRect(0, 0, w, h);
    this._drawCheckerboard();

    if (!this.sourceCanvas) return;

    // Resize display canvas to match source aspect
    const aspect = this.sourceCanvas.width / this.sourceCanvas.height;
    const cw = this.displayCanvas.getBoundingClientRect().width || 512;
    const ch = this.displayCanvas.getBoundingClientRect().height || 512;
    if (cw > 0 && ch > 0) {
      let dw = cw, dh = cw / aspect;
      if (dh > ch) { dh = ch; dw = ch * aspect; }
      this.displayCanvas.width  = Math.max(1, Math.round(dw));
      this.displayCanvas.height = Math.max(1, Math.round(dh));
    }

    // Apply CSS filter for non-destructive adjustments
    this.displayCtx.filter = this._buildCSSFilter();

    // Channel mode
    if (this.channelMode === 'rgb') {
      this.displayCtx.drawImage(this.sourceCanvas, 0, 0, this.displayCanvas.width, this.displayCanvas.height);
    } else {
      this._drawChannel(this.channelMode);
    }

    this.displayCtx.filter = 'none';

    // UV overlay
    if (this.showUV && this.uvMesh) {
      this._drawUVOverlay();
    }

    // Sync output texture
    if (this.outTexture) {
      this.outTexture.needsUpdate = true;
    }
  }

  private _drawCheckerboard(): void {
    if (!this.displayCtx) return;
    const w = this.displayCanvas.width;
    const h = this.displayCanvas.height;
    const sz = 8;
    for (let y = 0; y < h; y += sz) {
      for (let x = 0; x < w; x += sz) {
        this.displayCtx.fillStyle = ((x / sz + y / sz) % 2 === 0) ? '#2a2a2a' : '#1a1a1a';
        this.displayCtx.fillRect(x, y, sz, sz);
      }
    }
  }

  private _buildCSSFilter(): string {
    const bright = this.adj.brightness;
    const cont   = this.adj.contrast;
    const hue    = this.adj.hue;
    const sat    = this.adj.saturation;
    const brightFactor = 1 + bright / 100;
    const contFactor   = 1 + cont   / 100;
    const satFactor    = Math.max(0, 1 + sat / 100);
    return [
      `brightness(${brightFactor.toFixed(3)})`,
      `contrast(${contFactor.toFixed(3)})`,
      `hue-rotate(${hue}deg)`,
      `saturate(${satFactor.toFixed(3)})`,
    ].join(' ');
  }

  private _drawChannel(ch: 'r' | 'g' | 'b' | 'a'): void {
    if (!this.sourceCanvas) return;
    const srcW = this.sourceCanvas.width;
    const srcH = this.sourceCanvas.height;
    const dw   = this.displayCanvas.width;
    const dh   = this.displayCanvas.height;

    // Offscreen canvas at source resolution
    const tmp = document.createElement('canvas');
    tmp.width = srcW; tmp.height = srcH;
    const tCtx = tmp.getContext('2d')!;
    tCtx.drawImage(this.sourceCanvas, 0, 0);

    const id = tCtx.getImageData(0, 0, srcW, srcH);
    const d  = id.data;
    const idx: Record<'r'|'g'|'b'|'a', number> = { r: 0, g: 1, b: 2, a: 3 };
    const ci = idx[ch];
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i + ci];
      if (ch === 'a') {
        d[i] = v; d[i+1] = v; d[i+2] = v; d[i+3] = 255;
      } else {
        d[i]   = ch === 'r' ? v : 0;
        d[i+1] = ch === 'g' ? v : 0;
        d[i+2] = ch === 'b' ? v : 0;
        d[i+3] = 255;
      }
    }
    tCtx.putImageData(id, 0, 0);
    this.displayCtx.drawImage(tmp, 0, 0, dw, dh);
  }

  private _drawUVOverlay(): void {
    if (!this.uvMesh) return;
    const geo = this.uvMesh.geometry as THREE.BufferGeometry;
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
    const indexAttr = geo.index;
    if (!uvAttr) return;

    const dw = this.displayCanvas.width;
    const dh = this.displayCanvas.height;
    this.displayCtx.save();
    this.displayCtx.strokeStyle = 'rgba(0,255,180,0.7)';
    this.displayCtx.lineWidth = 0.8;

    const drawTri = (ai: number, bi: number, ci: number) => {
      const ax = uvAttr.getX(ai) * dw, ay = (1 - uvAttr.getY(ai)) * dh;
      const bx = uvAttr.getX(bi) * dw, by = (1 - uvAttr.getY(bi)) * dh;
      const cx = uvAttr.getX(ci) * dw, cy = (1 - uvAttr.getY(ci)) * dh;
      this.displayCtx.beginPath();
      this.displayCtx.moveTo(ax, ay);
      this.displayCtx.lineTo(bx, by);
      this.displayCtx.lineTo(cx, cy);
      this.displayCtx.closePath();
      this.displayCtx.stroke();
    };

    if (indexAttr) {
      const count = indexAttr.count;
      for (let i = 0; i < count; i += 3) {
        drawTri(indexAttr.getX(i), indexAttr.getX(i + 1), indexAttr.getX(i + 2));
      }
    } else {
      const count = uvAttr.count;
      for (let i = 0; i < count; i += 3) {
        drawTri(i, i + 1, i + 2);
      }
    }
    this.displayCtx.restore();
  }

  // ═══════════════════════════════════════════════════════════════════
  // Adjustments
  // ═══════════════════════════════════════════════════════════════════

  /** Bake adjustments into the source canvas (destructive). */
  private _applyAdjustments(): void {
    if (!this.sourceCanvas || !this.sourceCtx) return;
    const { width, height } = this.sourceCanvas;
    const tmp = document.createElement('canvas');
    tmp.width = width; tmp.height = height;
    const tCtx = tmp.getContext('2d')!;
    tCtx.filter = this._buildCSSFilter();
    tCtx.drawImage(this.sourceCanvas, 0, 0);
    tCtx.filter = 'none';
    this.sourceCtx.clearRect(0, 0, width, height);
    this.sourceCtx.drawImage(tmp, 0, 0);
    // Reset sliders
    this.adj = { brightness: 0, contrast: 0, hue: 0, saturation: 0 };
    if (this.container) {
      this.container.querySelectorAll<HTMLInputElement>('.tep-adj-slider').forEach(el => {
        el.value = '0';
        const disp = el.nextElementSibling as HTMLElement;
        if (disp) disp.textContent = '0';
      });
    }
    this._redraw();
  }

  // ═══════════════════════════════════════════════════════════════════
  // Texture Paint
  // ═══════════════════════════════════════════════════════════════════

  private _setupPaintEvents(): void {
    const getPos = (e: PointerEvent): { x: number; y: number } => {
      const rect = this.displayCanvas.getBoundingClientRect();
      const rx = (e.clientX - rect.left) / rect.width;
      const ry = (e.clientY - rect.top)  / rect.height;
      return {
        x: rx * (this.sourceCanvas?.width  ?? this.displayCanvas.width),
        y: ry * (this.sourceCanvas?.height ?? this.displayCanvas.height),
      };
    };

    this.displayCanvas.addEventListener('pointerdown', (e) => {
      if (!this.sourceCanvas || e.button !== 0) return;
      e.preventDefault();
      this.isPainting = true;
      this.displayCanvas.setPointerCapture(e.pointerId);
      this._paint(getPos(e));
    });

    this.displayCanvas.addEventListener('pointermove', (e) => {
      if (!this.isPainting || !this.sourceCanvas) return;
      this._paint(getPos(e));
    });

    this.displayCanvas.addEventListener('pointerup', (e) => {
      this.isPainting = false;
      this.displayCanvas.releasePointerCapture(e.pointerId);
    });
  }

  private _paint(pos: { x: number; y: number }): void {
    if (!this.sourceCtx) return;
    this.sourceCtx.save();
    this.sourceCtx.globalAlpha = this.paintOpacity;
    this.sourceCtx.fillStyle = this.paintColor;
    this.sourceCtx.beginPath();
    this.sourceCtx.arc(pos.x, pos.y, this.paintSize / 2, 0, Math.PI * 2);
    this.sourceCtx.fill();
    this.sourceCtx.restore();
    this._redraw();
  }

  // ═══════════════════════════════════════════════════════════════════
  // UI Helpers
  // ═══════════════════════════════════════════════════════════════════

  private _btn(label: string, bg: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'tep-btn';
    b.style.background = bg;
    b.addEventListener('click', onClick);
    return b;
  }

  private _numInput(value: number, onChange: (v: number) => void): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'number';
    el.value = String(value);
    el.style.cssText =
      'width:60px;background:#2a2a2a;border:1px solid #444;color:#ccc;padding:2px 4px;border-radius:3px;font-size:11px;';
    el.addEventListener('change', () => {
      const v = parseInt(el.value);
      if (v > 0 && v <= 8192) onChange(v);
    });
    return el;
  }

  private _buildSection(parent: HTMLElement, title: string, build: (sec: HTMLElement) => void): void {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'border-bottom:1px solid #2a2a2a;padding-bottom:10px;';
    const h = document.createElement('div');
    h.style.cssText = 'font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;';
    h.textContent = title;
    wrap.appendChild(h);
    build(wrap);
    parent.appendChild(wrap);
  }

  private _buildSlider(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    value: number,
    onChange: (v: number) => void,
  ): void {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:5px;';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'width:70px;font-size:11px;color:#999;flex-shrink:0;';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'tep-adj-slider';
    slider.dataset.field = label;
    slider.min  = String(min);
    slider.max  = String(max);
    slider.value = String(value);
    slider.style.cssText = 'flex:1;accent-color:#58a6ff;';
    const val = document.createElement('span');
    val.textContent = String(value);
    val.style.cssText = 'width:28px;text-align:right;font-size:10px;color:#aaa;';
    slider.addEventListener('input', () => {
      val.textContent = slider.value;
      onChange(parseInt(slider.value));
    });
    row.appendChild(lbl); row.appendChild(slider); row.appendChild(val);
    parent.appendChild(row);
  }

  private _updateInfo(): void {
    const el = this.container?.querySelector('#tep-info') as HTMLElement;
    if (!el || !this.sourceCanvas) return;
    el.textContent =
      `Name: ${this.sourceFileName}\nSize: ${this.sourceCanvas.width} × ${this.sourceCanvas.height}\nFormat: RGBA8`;
  }

  private _hidePlaceholder(): void {
    const p = this.container?.querySelector('#tep-placeholder') as HTMLElement;
    if (p) p.style.display = 'none';
  }

  private _addStyles(): void {
    if (document.getElementById('tep-styles')) return;
    const style = document.createElement('style');
    style.id = 'tep-styles';
    style.textContent = `
      .tep-btn {
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid #444;
        color: #ccc;
        font-size: 11px;
        cursor: pointer;
        transition: filter 0.15s;
        flex-shrink: 0;
      }
      .tep-btn:hover { filter: brightness(1.2); }
      .tep-ch-btn {
        padding: 3px 8px;
        border-radius: 3px;
        border: 1px solid #444;
        background: #2a2a3a;
        color: #888;
        font-size: 10px;
        cursor: pointer;
        font-weight: 700;
        transition: all 0.15s;
      }
      .tep-ch-btn.active { background: #1f6feb; border-color: #58a6ff; color: #fff; }
      .tep-ch-btn:hover:not(.active) { border-color: #58a6ff; }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public API (used by EditorApp / drag-assign)
  // ═══════════════════════════════════════════════════════════════════

  /** The output Three.js texture (reflects all adjustments after _applyAdjustments). */
  getOutputTexture(): THREE.CanvasTexture | null {
    return this.outTexture;
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    if (this.outTexture) { this.outTexture.dispose(); this.outTexture = null; }
    this.container = null;
  }
}
