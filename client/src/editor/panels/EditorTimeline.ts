import * as THREE from 'three';
import type { EditorApp } from '../EditorApp';

type EasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step';

interface TimelineKeyframe {
  time: number;
  value: number;
  easing: EasingType;
}

interface TimelineTrack {
  name: string;
  property: string;
  keyframes: TimelineKeyframe[];
  color: string;
  expanded: boolean;
  objectUuid?: string;
}

type LoopMode = 'loop' | 'once' | 'pingpong';

interface TimelineState {
  currentTime: number;
  duration: number;
  playing: boolean;
  tracks: TimelineTrack[];
  zoom: number;
  scrollX: number;
  selectedKeyframes: Set<string>; // "trackIdx:keyIdx"
  snap: boolean;
  snapInterval: number;
  loopMode: LoopMode;
  playbackSpeed: number;
  clipboard: { relTime: number; value: number; easing: EasingType; property: string }[];
  pingpongReverse: boolean;
}

export class EditorTimeline {
  private editor: EditorApp;
  public container!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private state: TimelineState;
  private animFrameId = 0;
  private isDragging = false;
  private dragType: 'scrub' | 'keyframe' | 'pan' | 'marquee' | null = null;
  private marqueeStart: { x: number; y: number } | null = null;
  private marqueeEnd: { x: number; y: number } | null = null;
  private contextMenu: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private readonly HEADER_H = 28;
  private readonly TRACK_H = 32;
  private readonly TRACK_H_EXPANDED = 100;
  private LEFT_PANEL_W = 150;
  private isResizingSplitter = false;

  constructor(editor: EditorApp) {
    this.editor = editor;
    this.state = {
      currentTime: 0,
      duration: 10,
      playing: false,
      tracks: [],
      zoom: 1,
      scrollX: 0,
      selectedKeyframes: new Set(),
      snap: true,
      snapInterval: 0.5,
      loopMode: 'loop',
      playbackSpeed: 1,
      clipboard: [],
      pingpongReverse: false,
    };
  }

  render(): HTMLElement {
    this.container = document.createElement('div');
    this.container.style.cssText = 'display:flex;flex-direction:column;height:100%;';

    // Controls bar
    const controls = document.createElement('div');
    controls.className = 'timeline-controls';
    controls.style.cssText = 'display:flex;flex-wrap:nowrap;align-items:center;gap:4px 6px;padding:4px 8px;background:#1a1a1a;border-bottom:1px solid #333;min-height:30px;overflow-x:auto;overflow-y:hidden;flex-shrink:0;scrollbar-width:thin;';

    controls.innerHTML = `
      <button class="inspector-btn" data-tl="play" title="Play/Pause (Space)">▶</button>
      <button class="inspector-btn" data-tl="stop" title="Stop">⏹</button>
      <button class="inspector-btn" data-tl="start" title="Go to start">⏮</button>
      <button class="inspector-btn" data-tl="end" title="Go to end">⏭</button>
      <select data-tl="loop-mode" style="background:#2a2a3a;border:1px solid #444;color:#ccc;font-size:10px;padding:2px;border-radius:2px;cursor:pointer;" title="Loop mode">
        <option value="loop">🔁 Loop</option>
        <option value="once">1️⃣ Once</option>
        <option value="pingpong">🏓 Ping-Pong</option>
      </select>
      <span style="color:#888;font-size:10px;margin:0 2px;">|</span>
      <span style="color:#888;font-size:10px;">Spd:</span>
      <select data-tl="speed" style="background:#2a2a3a;border:1px solid #444;color:#ccc;font-size:10px;padding:2px;border-radius:2px;cursor:pointer;" title="Playback speed">
        <option value="0.25">0.25x</option>
        <option value="0.5">0.5x</option>
        <option value="1" selected>1x</option>
        <option value="1.5">1.5x</option>
        <option value="2">2x</option>
      </select>
      <span style="color:#888;font-size:10px;margin:0 2px;">|</span>
      <span style="color:#888;font-size:10px;">Time:</span>
      <input class="inspector-input" type="number" step="0.1" min="0" value="0" style="width:60px;" data-tl="time" />
      <span style="color:#888;font-size:10px;">/ </span>
      <input class="inspector-input" type="number" step="1" min="1" value="10" style="width:50px;" data-tl="duration" />
      <span style="color:#888;font-size:10px;margin:0 2px;">|</span>
      <button class="inspector-btn" data-tl="add-key" title="Add Keyframe (K)">🔑 Key</button>
      <button class="inspector-btn" data-tl="add-track" title="Add Track">+ Track</button>
      <button class="inspector-btn" data-tl="load-sel" title="Load tracks from selected object" style="color:#e67e22;">🎯 Sel</button>
      <button class="inspector-btn" data-tl="create-clip" title="Create animation clip from timeline tracks" style="color:#2ecc71;">📋 Clip</button>
      <span style="color:#888;font-size:10px;margin:0 2px;">|</span>
      <button class="inspector-btn" data-tl="copy" title="Copy keyframes (Ctrl+C)">📋</button>
      <button class="inspector-btn" data-tl="paste" title="Paste keyframes (Ctrl+V)">📌</button>
      <button class="inspector-btn" data-tl="delete" title="Delete keyframes (Del)" style="color:#e74c3c;">🗑</button>
      <span style="flex:1;"></span>
      <label style="font-size:10px;color:#888;"><input class="inspector-checkbox" type="checkbox" data-tl="snap" checked /> Snap</label>
      <button class="inspector-btn" data-tl="zoom-in" title="Zoom In">🔍+</button>
      <button class="inspector-btn" data-tl="zoom-out" title="Zoom Out">🔍−</button>
    `;
    this.container.appendChild(controls);

    // Horizontal resize handle between controls and canvas
    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = 'height:4px;background:#333;cursor:ns-resize;flex-shrink:0;';
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = controls.offsetHeight;
      const onMove = (ev: MouseEvent) => {
        const newH = Math.max(30, Math.min(120, startH + ev.clientY - startY));
        controls.style.maxHeight = newH + 'px';
        controls.style.flexWrap = 'wrap';
        controls.style.overflowY = 'auto';
        this.resizeCanvas();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    this.container.appendChild(resizeHandle);

    // Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'flex:1;width:100%;min-height:0;cursor:default;';
    this.container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;

    this.bindControls(controls);
    this.bindCanvasEvents();

    // Auto resize
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(this.container);

    requestAnimationFrame(() => this.resizeCanvas());

    return this.container;
  }

  refresh(): void {
    this.draw();
  }

  /** Add tracks from an external source (e.g. AnimationClip). */
  addTracks(tracks: { name: string; property: string; color: string; keyframes: { time: number; value: number; easing?: EasingType }[]; objectUuid?: string }[]): void {
    for (const t of tracks) {
      this.state.tracks.push({
        name: t.name,
        property: t.property,
        color: t.color,
        keyframes: t.keyframes.map(kf => ({ time: kf.time, value: kf.value, easing: kf.easing || 'linear' })),
        expanded: false,
        objectUuid: t.objectUuid,
      });
    }
    this.draw();
  }

  /** Set timeline duration (extends if needed). */
  setDuration(d: number): void {
    this.state.duration = Math.max(this.state.duration, d);
    const dInput = this.container?.querySelector('[data-tl="duration"]') as HTMLInputElement | null;
    if (dInput) dInput.value = String(Math.round(this.state.duration));
  }

  /** Get current duration */
  getDuration(): number {
    return this.state.duration;
  }

  /** Get number of tracks */
  getTrackCount(): number {
    return this.state.tracks.length;
  }

  // --- Load tracks from selected object ---
  loadTracksFromSelected(): void {
    const obj = this.editor.state.selectedObject;
    if (!obj) return;

    this.state.tracks = [
      { name: `${obj.name || 'Object'} Pos X`, property: 'position.x', color: '#e74c3c', keyframes: [{ time: 0, value: obj.position.x, easing: 'linear' }], expanded: true, objectUuid: obj.uuid },
      { name: `${obj.name || 'Object'} Pos Y`, property: 'position.y', color: '#2ecc71', keyframes: [{ time: 0, value: obj.position.y, easing: 'linear' }], expanded: true, objectUuid: obj.uuid },
      { name: `${obj.name || 'Object'} Pos Z`, property: 'position.z', color: '#3498db', keyframes: [{ time: 0, value: obj.position.z, easing: 'linear' }], expanded: true, objectUuid: obj.uuid },
      { name: `${obj.name || 'Object'} Rot X`, property: 'rotation.x', color: '#f39c12', keyframes: [{ time: 0, value: THREE.MathUtils.radToDeg(obj.rotation.x), easing: 'linear' }], expanded: true, objectUuid: obj.uuid },
      { name: `${obj.name || 'Object'} Rot Y`, property: 'rotation.y', color: '#e67e22', keyframes: [{ time: 0, value: THREE.MathUtils.radToDeg(obj.rotation.y), easing: 'linear' }], expanded: true, objectUuid: obj.uuid },
      { name: `${obj.name || 'Object'} Rot Z`, property: 'rotation.z', color: '#d35400', keyframes: [{ time: 0, value: THREE.MathUtils.radToDeg(obj.rotation.z), easing: 'linear' }], expanded: true, objectUuid: obj.uuid },
      { name: `${obj.name || 'Object'} Scale X`, property: 'scale.x', color: '#9b59b6', keyframes: [{ time: 0, value: obj.scale.x, easing: 'linear' }], expanded: true, objectUuid: obj.uuid },
      { name: `${obj.name || 'Object'} Scale Y`, property: 'scale.y', color: '#8e44ad', keyframes: [{ time: 0, value: obj.scale.y, easing: 'linear' }], expanded: true, objectUuid: obj.uuid },
      { name: `${obj.name || 'Object'} Scale Z`, property: 'scale.z', color: '#7d3c98', keyframes: [{ time: 0, value: obj.scale.z, easing: 'linear' }], expanded: true, objectUuid: obj.uuid },
    ];
    this.draw();
    this.editor.statusBar.setMessage(`Timeline: loaded tracks for "${obj.name || 'Object'}"`);
  }

  /** Apply current timeline values to scene objects by interpolating keyframes */
  private applyToScene(): void {
    const t = this.state.currentTime;
    for (const track of this.state.tracks) {
      if (!track.objectUuid || track.keyframes.length === 0) continue;
      let obj: THREE.Object3D | undefined;
      this.editor.scene.traverse(child => {
        if (child.uuid === track.objectUuid) obj = child;
      });
      if (!obj) continue;

      // Interpolate value at current time with easing
      const kfs = track.keyframes;
      let value: number;
      if (t <= kfs[0].time) {
        value = kfs[0].value;
      } else if (t >= kfs[kfs.length - 1].time) {
        value = kfs[kfs.length - 1].value;
      } else {
        let i = 0;
        while (i < kfs.length - 1 && kfs[i + 1].time < t) i++;
        const a = kfs[i], b = kfs[i + 1];
        const linear = (t - a.time) / (b.time - a.time);
        const alpha = this.applyEasing(linear, b.easing);
        value = a.value + (b.value - a.value) * alpha;
      }

      // Apply to object property
      const parts = track.property.split('.');
      if (parts.length === 2) {
        const [group, axis] = parts;
        const target = (obj as any)[group];
        if (target !== undefined) {
          if (group === 'rotation') {
            target[axis] = THREE.MathUtils.degToRad(value);
          } else {
            target[axis] = value;
          }
        }
      }
    }
  }

  /** Apply easing function to a linear t value (0..1) */
  private applyEasing(t: number, easing: EasingType): number {
    switch (easing) {
      case 'ease-in': return t * t;
      case 'ease-out': return t * (2 - t);
      case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      case 'step': return t < 1 ? 0 : 1;
      default: return t; // linear
    }
  }

  // --- Demo tracks for testing ---
  loadDemoTracks(): void {
    const obj = this.editor.state.selectedObject;
    if (obj) {
      this.loadTracksFromSelected();
      return;
    }
    this.state.tracks = [
      {
        name: 'Pos X', property: 'position.x', color: '#e74c3c',
        keyframes: [{ time: 0, value: 0, easing: 'linear' }, { time: 3, value: 5, easing: 'ease-in-out' }, { time: 7, value: -2, easing: 'ease-out' }, { time: 10, value: 0, easing: 'linear' }],
        expanded: true,
      },
      {
        name: 'Pos Y', property: 'position.y', color: '#2ecc71',
        keyframes: [{ time: 0, value: 0, easing: 'linear' }, { time: 2, value: 4, easing: 'ease-in' }, { time: 5, value: 1, easing: 'ease-out' }, { time: 10, value: 0, easing: 'linear' }],
        expanded: true,
      },
      {
        name: 'Pos Z', property: 'position.z', color: '#3498db',
        keyframes: [{ time: 0, value: 0, easing: 'linear' }, { time: 5, value: -8, easing: 'ease-in-out' }, { time: 10, value: 0, easing: 'linear' }],
        expanded: true,
      },
      {
        name: 'Rot Y', property: 'rotation.y', color: '#e67e22',
        keyframes: [{ time: 0, value: 0, easing: 'linear' }, { time: 10, value: 360, easing: 'ease-in-out' }],
        expanded: true,
      },
    ];
    this.draw();
  }

  // --- Drawing ---

  private resizeCanvas(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private draw(): void {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    const ctx = this.ctx;
    if (!ctx || w === 0) return;

    // Background
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, w, h);

    // Left panel bg
    ctx.fillStyle = '#252525';
    ctx.fillRect(0, 0, this.LEFT_PANEL_W, h);

    // Header
    this.drawHeader(ctx, w);

    // Tracks
    let yOff = this.HEADER_H;
    this.state.tracks.forEach((track, i) => {
      const th = this.getTrackHeight(i);
      this.drawTrack(ctx, track, i, yOff, w, th);
      yOff += th;
    });

    // Playhead
    this.drawPlayhead(ctx, w, h);

    // Marquee selection overlay
    if (this.marqueeStart && this.marqueeEnd) {
      const mx = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
      const my = Math.min(this.marqueeStart.y, this.marqueeEnd.y);
      const mw = Math.abs(this.marqueeEnd.x - this.marqueeStart.x);
      const mh = Math.abs(this.marqueeEnd.y - this.marqueeStart.y);
      ctx.fillStyle = 'rgba(88, 166, 255, 0.15)';
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeStyle = 'rgba(88, 166, 255, 0.6)';
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.setLineDash([]);
    }

    // Separator (draggable splitter)
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.LEFT_PANEL_W, 0);
    ctx.lineTo(this.LEFT_PANEL_W, h);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  private drawHeader(ctx: CanvasRenderingContext2D, w: number): void {
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, w, this.HEADER_H);

    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(0, this.HEADER_H);
    ctx.lineTo(w, this.HEADER_H);
    ctx.stroke();

    // Time ruler
    const timelineW = w - this.LEFT_PANEL_W;
    const pixPerSec = (timelineW / this.state.duration) * this.state.zoom;

    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';

    const step = this.getTickStep(pixPerSec);
    for (let t = 0; t <= this.state.duration; t += step) {
      const x = this.LEFT_PANEL_W + (t * pixPerSec) - this.state.scrollX;
      if (x < this.LEFT_PANEL_W || x > w) continue;

      ctx.fillStyle = '#888';
      ctx.fillText(t.toFixed(step < 1 ? 1 : 0) + 's', x, 12);

      ctx.strokeStyle = '#333';
      ctx.beginPath();
      ctx.moveTo(x, 16);
      ctx.lineTo(x, this.HEADER_H);
      ctx.stroke();
    }
  }

  private getTrackHeight(index: number): number {
    return this.state.tracks[index]?.expanded ? this.TRACK_H_EXPANDED : this.TRACK_H;
  }

  private getTrackY(index: number): number {
    let y = this.HEADER_H;
    for (let i = 0; i < index; i++) y += this.getTrackHeight(i);
    return y;
  }

  private drawTrack(ctx: CanvasRenderingContext2D, track: TimelineTrack, index: number, y: number, w: number, h: number): void {
    const isEven = index % 2 === 0;

    // Track background
    ctx.fillStyle = isEven ? '#1e1e1e' : '#222';
    ctx.fillRect(this.LEFT_PANEL_W, y, w - this.LEFT_PANEL_W, h);

    // Left label
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, y, this.LEFT_PANEL_W, h);

    ctx.fillStyle = track.color;
    ctx.fillRect(0, y, 3, h);

    ctx.fillStyle = '#ccc';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    const arrow = track.expanded ? '▼' : '▶';
    const labelText = track.name.length > 16 ? track.name.substring(0, 15) + '…' : track.name;
    ctx.fillText(`${arrow} ${labelText}`, 12, y + this.TRACK_H / 2 + 4);

    // Keyframes & interpolation curves
    const timelineW = w - this.LEFT_PANEL_W;
    const pixPerSec = (timelineW / this.state.duration) * this.state.zoom;

    // Draw easing curves between keyframes
    if (track.keyframes.length > 1) {
      for (let ki = 0; ki < track.keyframes.length - 1; ki++) {
        const a = track.keyframes[ki];
        const b = track.keyframes[ki + 1];
        const x1 = this.LEFT_PANEL_W + (a.time * pixPerSec) - this.state.scrollX;
        const x2 = this.LEFT_PANEL_W + (b.time * pixPerSec) - this.state.scrollX;
        if (x2 < this.LEFT_PANEL_W || x1 > w) continue;

        ctx.strokeStyle = track.color + '60';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const steps = Math.max(10, Math.floor((x2 - x1) / 3));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const eased = this.applyEasing(t, b.easing);
          const px = x1 + (x2 - x1) * t;
          // Map value range to track height for mini curve
          const valRange = Math.abs(b.value - a.value) || 1;
          const normalizedA = 0.5;
          const normalizedEased = normalizedA + (eased - 0.5);
          const py = y + this.TRACK_H * (1 - normalizedEased * 0.6 - 0.2);
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    // Draw keyframe diamonds
    track.keyframes.forEach((kf, ki) => {
      const x = this.LEFT_PANEL_W + (kf.time * pixPerSec) - this.state.scrollX;
      if (x < this.LEFT_PANEL_W - 10 || x > w + 10) return;

      const key = `${index}:${ki}`;
      const isSelected = this.state.selectedKeyframes.has(key);

      // Diamond shape
      ctx.save();
      ctx.translate(x, y + this.TRACK_H / 2);
      ctx.rotate(Math.PI / 4);
      const size = isSelected ? 6 : 5;
      ctx.fillStyle = isSelected ? '#fff' : track.color;
      ctx.fillRect(-size, -size, size * 2, size * 2);
      if (isSelected) {
        ctx.strokeStyle = '#58a6ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(-size, -size, size * 2, size * 2);
      }
      ctx.restore();

      // Easing indicator icon (small letter near keyframe)
      if (kf.easing !== 'linear') {
        ctx.save();
        ctx.fillStyle = '#888';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        const label = kf.easing === 'ease-in' ? 'i' : kf.easing === 'ease-out' ? 'o' : kf.easing === 'ease-in-out' ? '~' : 's';
        ctx.fillText(label, x, y + this.TRACK_H / 2 - 9);
        ctx.restore();
      }
    });

    // Bottom border
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(0, y + h);
    ctx.lineTo(w, y + h);
    ctx.stroke();

    // --- Expanded Curve Editor ---
    if (track.expanded && h > this.TRACK_H && track.keyframes.length >= 1) {
      const curveTop = y + this.TRACK_H;
      const curveH = h - this.TRACK_H;
      const pad = 6;

      // Curve area background
      ctx.fillStyle = '#1a1a2a';
      ctx.fillRect(this.LEFT_PANEL_W, curveTop, w - this.LEFT_PANEL_W, curveH);

      // Value range
      let minVal = Infinity, maxVal = -Infinity;
      for (const kf of track.keyframes) { minVal = Math.min(minVal, kf.value); maxVal = Math.max(maxVal, kf.value); }
      const valPad = Math.abs(maxVal - minVal) * 0.15 || 1;
      minVal -= valPad; maxVal += valPad;
      const valRange = maxVal - minVal || 1;

      const valToY = (v: number) => curveTop + pad + (1 - (v - minVal) / valRange) * (curveH - pad * 2);

      // Grid lines
      ctx.strokeStyle = '#2a2a3a';
      ctx.lineWidth = 0.5;
      for (let g = 0; g <= 4; g++) {
        const gy = curveTop + pad + g * (curveH - pad * 2) / 4;
        ctx.beginPath(); ctx.moveTo(this.LEFT_PANEL_W, gy); ctx.lineTo(w, gy); ctx.stroke();
      }

      // Value labels on left edge
      ctx.fillStyle = '#666';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      for (let g = 0; g <= 4; g++) {
        const v = maxVal - g * valRange / 4;
        const gy = curveTop + pad + g * (curveH - pad * 2) / 4;
        ctx.fillText(v.toFixed(1), this.LEFT_PANEL_W - 4, gy + 3);
      }

      // Draw interpolated curve
      if (track.keyframes.length > 1) {
        ctx.strokeStyle = track.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
        for (let ki = 0; ki < sorted.length - 1; ki++) {
          const ka = sorted[ki], kb = sorted[ki + 1];
          const kx1 = this.LEFT_PANEL_W + (ka.time * pixPerSec) - this.state.scrollX;
          const kx2 = this.LEFT_PANEL_W + (kb.time * pixPerSec) - this.state.scrollX;
          const segSteps = Math.max(20, Math.floor(Math.abs(kx2 - kx1) / 2));
          for (let s = 0; s <= segSteps; s++) {
            const t = s / segSteps;
            const eased = this.applyEasing(t, kb.easing);
            const val = ka.value + (kb.value - ka.value) * eased;
            const px = kx1 + (kx2 - kx1) * t;
            const py = valToY(val);
            if (ki === 0 && s === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      // Draw keyframe dots on curve
      for (let ki = 0; ki < track.keyframes.length; ki++) {
        const kf = track.keyframes[ki];
        const kx = this.LEFT_PANEL_W + (kf.time * pixPerSec) - this.state.scrollX;
        const ky = valToY(kf.value);
        if (kx < this.LEFT_PANEL_W - 10 || kx > w + 10) continue;

        const key = `${index}:${ki}`;
        const isSel = this.state.selectedKeyframes.has(key);
        ctx.beginPath();
        ctx.arc(kx, ky, isSel ? 5 : 4, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? '#fff' : track.color;
        ctx.fill();
        if (isSel) { ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }

        // Value text
        ctx.fillStyle = '#aaa';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(kf.value.toFixed(2), kx, ky - 8);
      }

      // Expand indicator — left panel
      ctx.fillStyle = '#666';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('▼ curve', 12, curveTop + 12);
    }
  }

  private drawPlayhead(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const timelineW = w - this.LEFT_PANEL_W;
    const pixPerSec = (timelineW / this.state.duration) * this.state.zoom;
    const x = this.LEFT_PANEL_W + (this.state.currentTime * pixPerSec) - this.state.scrollX;

    if (x < this.LEFT_PANEL_W || x > w) return;

    // Playhead line
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.lineWidth = 1;

    // Playhead triangle
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(x - 6, 0);
    ctx.lineTo(x + 6, 0);
    ctx.lineTo(x, 8);
    ctx.closePath();
    ctx.fill();
  }

  private getTickStep(pixPerSec: number): number {
    if (pixPerSec > 200) return 0.1;
    if (pixPerSec > 80) return 0.5;
    if (pixPerSec > 40) return 1;
    if (pixPerSec > 15) return 2;
    return 5;
  }

  // --- Events ---

  private bindControls(controls: HTMLElement): void {
    controls.querySelector('[data-tl="play"]')?.addEventListener('click', () => this.togglePlay());
    controls.querySelector('[data-tl="stop"]')?.addEventListener('click', () => this.stop());
    controls.querySelector('[data-tl="start"]')?.addEventListener('click', () => { this.state.currentTime = 0; this.state.pingpongReverse = false; this.draw(); });
    controls.querySelector('[data-tl="end"]')?.addEventListener('click', () => { this.state.currentTime = this.state.duration; this.draw(); });

    controls.querySelector('[data-tl="time"]')?.addEventListener('input', (e) => {
      this.state.currentTime = Math.max(0, Math.min(this.state.duration, parseFloat((e.target as HTMLInputElement).value) || 0));
      this.draw();
    });
    controls.querySelector('[data-tl="duration"]')?.addEventListener('input', (e) => {
      this.state.duration = Math.max(1, parseFloat((e.target as HTMLInputElement).value) || 10);
      this.draw();
    });

    controls.querySelector('[data-tl="add-key"]')?.addEventListener('click', () => this.addKeyframeAtCurrentTime());
    controls.querySelector('[data-tl="add-track"]')?.addEventListener('click', () => this.addTrack());
    controls.querySelector('[data-tl="load-sel"]')?.addEventListener('click', () => this.loadTracksFromSelected());
    controls.querySelector('[data-tl="create-clip"]')?.addEventListener('click', () => this.createClipFromTimeline());
    controls.querySelector('[data-tl="copy"]')?.addEventListener('click', () => this.copySelectedKeyframes());
    controls.querySelector('[data-tl="paste"]')?.addEventListener('click', () => this.pasteKeyframes());
    controls.querySelector('[data-tl="delete"]')?.addEventListener('click', () => this.deleteSelectedKeyframes());
    controls.querySelector('[data-tl="snap"]')?.addEventListener('change', (e) => {
      this.state.snap = (e.target as HTMLInputElement).checked;
    });
    controls.querySelector('[data-tl="loop-mode"]')?.addEventListener('change', (e) => {
      this.state.loopMode = (e.target as HTMLSelectElement).value as LoopMode;
    });
    controls.querySelector('[data-tl="speed"]')?.addEventListener('change', (e) => {
      this.state.playbackSpeed = parseFloat((e.target as HTMLSelectElement).value);
    });
    controls.querySelector('[data-tl="zoom-in"]')?.addEventListener('click', () => {
      this.state.zoom = Math.min(10, this.state.zoom * 1.3);
      this.draw();
    });
    controls.querySelector('[data-tl="zoom-out"]')?.addEventListener('click', () => {
      this.state.zoom = Math.max(0.2, this.state.zoom / 1.3);
      this.draw();
    });

    // Keyboard shortcuts
    this.container.setAttribute('tabindex', '0');
    this.container.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  private bindCanvasEvents(): void {
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => {
      // Cursor change when near splitter
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (!this.isDragging && !this.isResizingSplitter) {
        this.canvas.style.cursor = Math.abs(x - this.LEFT_PANEL_W) < 4 ? 'col-resize' : 'default';
      }
      this.onMouseMove(e);
    });
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        this.state.zoom = Math.max(0.2, Math.min(10, this.state.zoom * factor));
      } else {
        this.state.scrollX += e.deltaX || e.deltaY;
        this.state.scrollX = Math.max(0, this.state.scrollX);
      }
      this.draw();
    }, { passive: false });
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button === 2) return; // right click handled by contextmenu
    this.dismissContextMenu();
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Splitter drag
    if (Math.abs(x - this.LEFT_PANEL_W) < 4) {
      this.isResizingSplitter = true;
      this.canvas.style.cursor = 'col-resize';
      return;
    }

    // Click on left panel label area to toggle track expand
    if (x <= this.LEFT_PANEL_W && y > this.HEADER_H) {
      for (let ti = 0; ti < this.state.tracks.length; ti++) {
        const ty = this.getTrackY(ti);
        if (y >= ty && y < ty + this.TRACK_H) {
          this.state.tracks[ti].expanded = !this.state.tracks[ti].expanded;
          this.draw();
          return;
        }
      }
    }

    if (x > this.LEFT_PANEL_W) {
      // Check if clicking on a keyframe
      const kf = this.hitTestKeyframe(x, y);
      if (kf) {
        const key = `${kf.trackIndex}:${kf.keyIndex}`;
        if (e.shiftKey) {
          // Toggle selection with Shift
          if (this.state.selectedKeyframes.has(key)) {
            this.state.selectedKeyframes.delete(key);
          } else {
            this.state.selectedKeyframes.add(key);
          }
        } else if (!this.state.selectedKeyframes.has(key)) {
          // Single select (replace)
          this.state.selectedKeyframes.clear();
          this.state.selectedKeyframes.add(key);
        }
        this.isDragging = true;
        this.dragType = 'keyframe';
        this.draw();
        return;
      }

      if (e.altKey) {
        // Marquee selection
        this.isDragging = true;
        this.dragType = 'marquee';
        this.marqueeStart = { x, y };
        this.marqueeEnd = { x, y };
        if (!e.shiftKey) this.state.selectedKeyframes.clear();
        return;
      }

      // Scrubbing
      this.isDragging = true;
      this.dragType = 'scrub';
      this.scrubToX(x);
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.isResizingSplitter) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      this.LEFT_PANEL_W = Math.max(80, Math.min(300, x));
      this.draw();
      return;
    }
    if (!this.isDragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.dragType === 'scrub') {
      this.scrubToX(x);
    } else if (this.dragType === 'keyframe' && this.state.selectedKeyframes.size > 0) {
      // Move all selected keyframes
      const time = this.xToTime(x);
      // For multi-move, calculate delta from the first selected
      const firstKey = [...this.state.selectedKeyframes][0];
      const [ti, ki] = firstKey.split(':').map(Number);
      const currentTime = this.state.tracks[ti]?.keyframes[ki]?.time;
      if (currentTime === undefined) return;

      const snapped = this.state.snap ? Math.round(time / this.state.snapInterval) * this.state.snapInterval : time;
      const delta = snapped - currentTime;

      for (const key of this.state.selectedKeyframes) {
        const [trackIdx, keyIdx] = key.split(':').map(Number);
        const track = this.state.tracks[trackIdx];
        if (track) {
          track.keyframes[keyIdx].time = Math.max(0, Math.min(this.state.duration, track.keyframes[keyIdx].time + delta));
        }
      }
      this.draw();
    } else if (this.dragType === 'marquee') {
      this.marqueeEnd = { x, y };
      this.draw();
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (this.isResizingSplitter) {
      this.isResizingSplitter = false;
      this.canvas.style.cursor = 'default';
      return;
    }
    if (this.dragType === 'marquee' && this.marqueeStart && this.marqueeEnd) {
      // Select all keyframes within the marquee
      const mx1 = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
      const my1 = Math.min(this.marqueeStart.y, this.marqueeEnd.y);
      const mx2 = Math.max(this.marqueeStart.x, this.marqueeEnd.x);
      const my2 = Math.max(this.marqueeStart.y, this.marqueeEnd.y);

      const w = this.canvas.width / (window.devicePixelRatio || 1);
      const timelineW = w - this.LEFT_PANEL_W;
      const pixPerSec = (timelineW / this.state.duration) * this.state.zoom;

      for (let ti = 0; ti < this.state.tracks.length; ti++) {
        const track = this.state.tracks[ti];
        const trackY = this.getTrackY(ti) + this.TRACK_H / 2;
        for (let ki = 0; ki < track.keyframes.length; ki++) {
          const kf = track.keyframes[ki];
          const kx = this.LEFT_PANEL_W + (kf.time * pixPerSec) - this.state.scrollX;
          if (kx >= mx1 && kx <= mx2 && trackY >= my1 && trackY <= my2) {
            this.state.selectedKeyframes.add(`${ti}:${ki}`);
          }
        }
      }
      this.marqueeStart = null;
      this.marqueeEnd = null;
      this.draw();
    }
    this.isDragging = false;
    this.dragType = null;
  }

  private hitTestKeyframe(mx: number, my: number): { trackIndex: number; keyIndex: number } | null {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const timelineW = w - this.LEFT_PANEL_W;
    const pixPerSec = (timelineW / this.state.duration) * this.state.zoom;

    for (let ti = 0; ti < this.state.tracks.length; ti++) {
      const track = this.state.tracks[ti];
      const trackY = this.getTrackY(ti) + this.TRACK_H / 2;
      for (let ki = 0; ki < track.keyframes.length; ki++) {
        const kf = track.keyframes[ki];
        const x = this.LEFT_PANEL_W + (kf.time * pixPerSec) - this.state.scrollX;
        const dx = mx - x;
        const dy = my - trackY;
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
          return { trackIndex: ti, keyIndex: ki };
        }
      }
    }
    return null;
  }

  private scrubToX(x: number): void {
    this.state.currentTime = Math.max(0, Math.min(this.state.duration, this.xToTime(x)));
    this.applyToScene();
    this.updateTimeInput();
    this.draw();
  }

  private xToTime(x: number): number {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const timelineW = w - this.LEFT_PANEL_W;
    const pixPerSec = (timelineW / this.state.duration) * this.state.zoom;
    return ((x - this.LEFT_PANEL_W) + this.state.scrollX) / pixPerSec;
  }

  private updateTimeInput(): void {
    const input = this.container?.querySelector('[data-tl="time"]') as HTMLInputElement;
    if (input) input.value = this.state.currentTime.toFixed(2);
  }

  // --- Playback ---

  private togglePlay(): void {
    this.state.playing = !this.state.playing;
    const btn = this.container?.querySelector('[data-tl="play"]');
    if (btn) btn.textContent = this.state.playing ? '⏸' : '▶';

    if (this.state.playing) {
      let last = performance.now();
      const tick = (now: number) => {
        if (!this.state.playing) return;
        const dt = ((now - last) / 1000) * this.state.playbackSpeed;
        last = now;

        if (this.state.loopMode === 'pingpong') {
          if (this.state.pingpongReverse) {
            this.state.currentTime -= dt;
            if (this.state.currentTime <= 0) {
              this.state.currentTime = 0;
              this.state.pingpongReverse = false;
            }
          } else {
            this.state.currentTime += dt;
            if (this.state.currentTime >= this.state.duration) {
              this.state.currentTime = this.state.duration;
              this.state.pingpongReverse = true;
            }
          }
        } else {
          this.state.currentTime += dt;
          if (this.state.currentTime >= this.state.duration) {
            if (this.state.loopMode === 'loop') {
              this.state.currentTime = 0;
            } else {
              this.state.currentTime = this.state.duration;
              this.state.playing = false;
              if (btn) btn.textContent = '▶';
            }
          }
        }

        this.applyToScene();
        this.updateTimeInput();
        this.draw();
        if (this.state.playing) this.animFrameId = requestAnimationFrame(tick);
      };
      this.animFrameId = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(this.animFrameId);
    }
  }

  private stop(): void {
    this.state.playing = false;
    this.state.currentTime = 0;
    this.state.pingpongReverse = false;
    cancelAnimationFrame(this.animFrameId);
    const btn = this.container?.querySelector('[data-tl="play"]');
    if (btn) btn.textContent = '▶';
    this.updateTimeInput();
    this.draw();
  }

  /** Create a THREE.AnimationClip from the current timeline tracks */
  private createClipFromTimeline(): void {
    if (this.state.tracks.length === 0) {
      this.editor.statusBar.setMessage('No tracks in timeline to convert');
      return;
    }

    const clipName = prompt('Enter clip name:', 'TimelineClip') || 'TimelineClip';

    // Group tracks by objectUuid
    const byObj = new Map<string, TimelineTrack[]>();
    for (const t of this.state.tracks) {
      const uuid = t.objectUuid || '_global';
      if (!byObj.has(uuid)) byObj.set(uuid, []);
      byObj.get(uuid)!.push(t);
    }

    const keyframeTracks: THREE.KeyframeTrack[] = [];

    for (const [uuid, tracks] of byObj) {
      // Find the scene object to get its name
      let objName = 'Object';
      if (uuid !== '_global') {
        this.editor.scene.traverse((c) => {
          if (c.uuid === uuid) objName = c.name || 'Object';
        });
      }

      // Group tracks by base property (position, rotation, scale)
      const posXTrack = tracks.find(t => t.property === 'position.x');
      const posYTrack = tracks.find(t => t.property === 'position.y');
      const posZTrack = tracks.find(t => t.property === 'position.z');
      const rotXTrack = tracks.find(t => t.property === 'rotation.x');
      const rotYTrack = tracks.find(t => t.property === 'rotation.y');
      const rotZTrack = tracks.find(t => t.property === 'rotation.z');
      const scXTrack = tracks.find(t => t.property === 'scale.x');
      const scYTrack = tracks.find(t => t.property === 'scale.y');
      const scZTrack = tracks.find(t => t.property === 'scale.z');

      // Position track
      if (posXTrack || posYTrack || posZTrack) {
        const allTimes = new Set<number>();
        [posXTrack, posYTrack, posZTrack].forEach(t => t?.keyframes.forEach(k => allTimes.add(k.time)));
        const timesArr = [...allTimes].sort((a, b) => a - b);
        const values: number[] = [];
        for (const time of timesArr) {
          values.push(
            this.interpolateTrack(posXTrack, time),
            this.interpolateTrack(posYTrack, time),
            this.interpolateTrack(posZTrack, time),
          );
        }
        keyframeTracks.push(new THREE.VectorKeyframeTrack(`${objName}.position`, timesArr, values));
      }

      // Rotation track (convert degrees to radians for quaternion)
      if (rotXTrack || rotYTrack || rotZTrack) {
        const allTimes = new Set<number>();
        [rotXTrack, rotYTrack, rotZTrack].forEach(t => t?.keyframes.forEach(k => allTimes.add(k.time)));
        const timesArr = [...allTimes].sort((a, b) => a - b);
        const values: number[] = [];
        for (const time of timesArr) {
          const rx = THREE.MathUtils.degToRad(this.interpolateTrack(rotXTrack, time));
          const ry = THREE.MathUtils.degToRad(this.interpolateTrack(rotYTrack, time));
          const rz = THREE.MathUtils.degToRad(this.interpolateTrack(rotZTrack, time));
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
          values.push(q.x, q.y, q.z, q.w);
        }
        keyframeTracks.push(new THREE.QuaternionKeyframeTrack(`${objName}.quaternion`, timesArr, values));
      }

      // Scale track
      if (scXTrack || scYTrack || scZTrack) {
        const allTimes = new Set<number>();
        [scXTrack, scYTrack, scZTrack].forEach(t => t?.keyframes.forEach(k => allTimes.add(k.time)));
        const timesArr = [...allTimes].sort((a, b) => a - b);
        const values: number[] = [];
        for (const time of timesArr) {
          values.push(
            this.interpolateTrack(scXTrack, time, 1),
            this.interpolateTrack(scYTrack, time, 1),
            this.interpolateTrack(scZTrack, time, 1),
          );
        }
        keyframeTracks.push(new THREE.VectorKeyframeTrack(`${objName}.scale`, timesArr, values));
      }
    }

    if (keyframeTracks.length === 0) {
      this.editor.statusBar.setMessage('No keyframes to convert');
      return;
    }

    const clip = new THREE.AnimationClip(clipName, this.state.duration, keyframeTracks);
    // Store the clip on the editor's animation panel
    this.editor.animationEditor.addExternalClip(clip);
    this.editor.statusBar.setMessage(`Created clip "${clipName}" with ${keyframeTracks.length} tracks`);
  }

  /** Helper: interpolate a value from a timeline track at a given time (with easing) */
  private interpolateTrack(track: TimelineTrack | undefined, time: number, defaultVal = 0): number {
    if (!track || track.keyframes.length === 0) return defaultVal;
    if (track.keyframes.length === 1) return track.keyframes[0].value;

    const kfs = track.keyframes.sort((a, b) => a.time - b.time);
    if (time <= kfs[0].time) return kfs[0].value;
    if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

    for (let i = 0; i < kfs.length - 1; i++) {
      if (time >= kfs[i].time && time <= kfs[i + 1].time) {
        const linear = (time - kfs[i].time) / (kfs[i + 1].time - kfs[i].time);
        const t = this.applyEasing(linear, kfs[i + 1].easing);
        return kfs[i].value + (kfs[i + 1].value - kfs[i].value) * t;
      }
    }
    return kfs[kfs.length - 1].value;
  }

  // --- Track/Keyframe management ---

  private addTrack(): void {
    const obj = this.editor.state.selectedObject;
    const properties = [
      'position.x', 'position.y', 'position.z',
      'rotation.x', 'rotation.y', 'rotation.z',
      'scale.x', 'scale.y', 'scale.z',
    ];
    // Filter out already-used properties for this object
    const usedProps = new Set(this.state.tracks
      .filter(t => t.objectUuid === obj?.uuid)
      .map(t => t.property));
    const available = properties.filter(p => !usedProps.has(p));

    if (available.length === 0) {
      this.editor.statusBar.setMessage('All properties already have tracks');
      return;
    }

    const prop = available[0]; // Pick the first available
    const objName = obj?.name || 'Object';
    const colors = ['#e74c3c', '#2ecc71', '#3498db', '#e67e22', '#9b59b6', '#1abc9c', '#f39c12'];

    let initValue = 0;
    if (obj) {
      const parts = prop.split('.');
      const raw = (obj as any)[parts[0]]?.[parts[1]];
      if (raw !== undefined) {
        initValue = parts[0] === 'rotation' ? THREE.MathUtils.radToDeg(raw) : raw;
      }
    }

    this.state.tracks.push({
      name: `${objName} ${prop}`,
      property: prop,
      keyframes: [{ time: 0, value: initValue, easing: 'linear' as EasingType }],
      color: colors[this.state.tracks.length % colors.length],
      expanded: true,
      objectUuid: obj?.uuid,
    });
    this.draw();
  }

  private addKeyframeAtCurrentTime(): void {
    if (this.state.tracks.length === 0) {
      this.loadDemoTracks();
      return;
    }
    // Add keyframe to all tracks at current time, sampling current object values
    this.state.tracks.forEach((track) => {
      const exists = track.keyframes.find((k) => Math.abs(k.time - this.state.currentTime) < 0.01);
      if (!exists) {
        let value = 0;
        // Try to read current value from scene object
        if (track.objectUuid) {
          let obj: THREE.Object3D | undefined;
          this.editor.scene.traverse(child => {
            if (child.uuid === track.objectUuid) obj = child;
          });
          if (obj) {
            const parts = track.property.split('.');
            if (parts.length === 2) {
              const raw = (obj as any)[parts[0]]?.[parts[1]];
              if (raw !== undefined) {
                value = parts[0] === 'rotation' ? THREE.MathUtils.radToDeg(raw) : raw;
              }
            }
          }
        }
        track.keyframes.push({ time: this.state.currentTime, value, easing: 'linear' });
        track.keyframes.sort((a, b) => a.time - b.time);
      }
    });
    this.draw();
    this.editor.statusBar.setMessage('Keyframe added');
  }

  // ── Multi-select, Copy/Paste/Delete ──────────────────────────

  private copySelectedKeyframes(): void {
    if (this.state.selectedKeyframes.size === 0) return;
    const minTime = Math.min(...[...this.state.selectedKeyframes].map(k => {
      const [ti, ki] = k.split(':').map(Number);
      return this.state.tracks[ti]?.keyframes[ki]?.time ?? 0;
    }));
    this.state.clipboard = [];
    for (const key of this.state.selectedKeyframes) {
      const [ti, ki] = key.split(':').map(Number);
      const track = this.state.tracks[ti];
      const kf = track?.keyframes[ki];
      if (kf) {
        this.state.clipboard.push({
          relTime: kf.time - minTime,
          value: kf.value,
          easing: kf.easing,
          property: track.property,
        });
      }
    }
    this.editor.statusBar.setMessage(`Copied ${this.state.clipboard.length} keyframe(s)`);
  }

  private pasteKeyframes(): void {
    if (this.state.clipboard.length === 0) return;
    const baseTime = this.state.currentTime;
    for (const item of this.state.clipboard) {
      const track = this.state.tracks.find(t => t.property === item.property);
      if (track) {
        const time = Math.max(0, Math.min(this.state.duration, baseTime + item.relTime));
        // Remove existing keyframe at this time
        track.keyframes = track.keyframes.filter(k => Math.abs(k.time - time) > 0.01);
        track.keyframes.push({ time, value: item.value, easing: item.easing });
        track.keyframes.sort((a, b) => a.time - b.time);
      }
    }
    this.draw();
    this.editor.statusBar.setMessage(`Pasted ${this.state.clipboard.length} keyframe(s)`);
  }

  private deleteSelectedKeyframes(): void {
    if (this.state.selectedKeyframes.size === 0) return;
    // Sort in reverse so deleting by index doesn't shift others
    const sorted = [...this.state.selectedKeyframes]
      .map(k => k.split(':').map(Number) as [number, number])
      .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    for (const [ti, ki] of sorted) {
      const track = this.state.tracks[ti];
      if (track && track.keyframes.length > 1) {
        track.keyframes.splice(ki, 1);
      }
    }
    this.state.selectedKeyframes.clear();
    this.draw();
    this.editor.statusBar.setMessage('Keyframe(s) deleted');
  }

  private setEasingOnSelected(easing: EasingType): void {
    for (const key of this.state.selectedKeyframes) {
      const [ti, ki] = key.split(':').map(Number);
      const track = this.state.tracks[ti];
      if (track?.keyframes[ki]) {
        track.keyframes[ki].easing = easing;
      }
    }
    this.draw();
    this.editor.statusBar.setMessage(`Set easing to ${easing}`);
  }

  // ── Context Menu ──────────────────────────────────────────────

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    this.dismissContextMenu();
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if right-clicking on a keyframe
    const kf = this.hitTestKeyframe(x, y);
    if (kf) {
      const key = `${kf.trackIndex}:${kf.keyIndex}`;
      if (!this.state.selectedKeyframes.has(key)) {
        this.state.selectedKeyframes.clear();
        this.state.selectedKeyframes.add(key);
        this.draw();
      }
    }

    if (this.state.selectedKeyframes.size === 0) return;

    const menu = document.createElement('div');
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;background:#2a2a3a;border:1px solid #555;border-radius:4px;padding:4px 0;z-index:10000;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,0.5);font-size:11px;color:#ccc;font-family:system-ui,sans-serif;`;

    const items: { label: string; action: () => void; separator?: boolean }[] = [
      { label: '📋 Copy (Ctrl+C)', action: () => this.copySelectedKeyframes() },
      { label: '📌 Paste (Ctrl+V)', action: () => this.pasteKeyframes() },
      { label: '🗑 Delete (Del)', action: () => this.deleteSelectedKeyframes() },
      { label: '', action: () => {}, separator: true },
      { label: '━ Linear', action: () => this.setEasingOnSelected('linear') },
      { label: '╭ Ease In', action: () => this.setEasingOnSelected('ease-in') },
      { label: '╮ Ease Out', action: () => this.setEasingOnSelected('ease-out') },
      { label: '∿ Ease In-Out', action: () => this.setEasingOnSelected('ease-in-out') },
      { label: '▪ Step', action: () => this.setEasingOnSelected('step') },
      { label: '', action: () => {}, separator: true },
      { label: '✦ Select All', action: () => this.selectAllKeyframes() },
      { label: '✖ Deselect All', action: () => { this.state.selectedKeyframes.clear(); this.draw(); } },
    ];

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:#444;margin:4px 0;';
        menu.appendChild(sep);
        continue;
      }
      const row = document.createElement('div');
      row.style.cssText = 'padding:4px 12px;cursor:pointer;transition:background 0.1s;';
      row.textContent = item.label;
      row.addEventListener('mouseenter', () => { row.style.background = '#3a3a5a'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
      row.addEventListener('click', () => {
        item.action();
        this.dismissContextMenu();
      });
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    this.contextMenu = menu;

    // Auto dismiss on click elsewhere
    const dismissHandler = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        this.dismissContextMenu();
        document.removeEventListener('mousedown', dismissHandler);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', dismissHandler), 10);
  }

  private dismissContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  private selectAllKeyframes(): void {
    this.state.selectedKeyframes.clear();
    for (let ti = 0; ti < this.state.tracks.length; ti++) {
      for (let ki = 0; ki < this.state.tracks[ti].keyframes.length; ki++) {
        this.state.selectedKeyframes.add(`${ti}:${ki}`);
      }
    }
    this.draw();
  }

  // ── Keyboard Shortcuts ────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        this.togglePlay();
        break;
      case 'k':
      case 'K':
        this.addKeyframeAtCurrentTime();
        break;
      case 'Delete':
      case 'Backspace':
        this.deleteSelectedKeyframes();
        break;
      case 'a':
        if (e.ctrlKey) { e.preventDefault(); this.selectAllKeyframes(); }
        break;
      case 'c':
        if (e.ctrlKey) this.copySelectedKeyframes();
        break;
      case 'v':
        if (e.ctrlKey) this.pasteKeyframes();
        break;
      case 'Home':
        this.state.currentTime = 0;
        this.draw();
        break;
      case 'End':
        this.state.currentTime = this.state.duration;
        this.draw();
        break;
      case 'ArrowLeft':
        this.state.currentTime = Math.max(0, this.state.currentTime - (e.shiftKey ? 1 : 0.1));
        this.applyToScene();
        this.updateTimeInput();
        this.draw();
        break;
      case 'ArrowRight':
        this.state.currentTime = Math.min(this.state.duration, this.state.currentTime + (e.shiftKey ? 1 : 0.1));
        this.applyToScene();
        this.updateTimeInput();
        this.draw();
        break;
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.animFrameId);
    this.state.playing = false;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.contextMenu?.remove();
    this.contextMenu = null;
  }
}
