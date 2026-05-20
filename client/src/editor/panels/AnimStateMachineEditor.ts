/**
 * AnimStateMachineEditor — Visual node-graph editor for Animation State Machines.
 * Canvas-based graph with draggable state nodes, transition arrows, parameter panel,
 * and inline editing of conditions/durations.
 */

import type { EditorApp } from '../EditorApp';
import {
  AnimationStateMachine,
  type AnimStateMachineDef,
  type AnimState,
  type AnimTransition,
  type AnimParam,
  type TransitionCondition,
  type ConditionOp,
  type AnimParamType,
} from '../../engine/AnimationStateMachine';

// ─── Visual Editor ───────────────────────────────────────────────
export class AnimStateMachineEditor {
  private editor: EditorApp;
  private container: HTMLElement | null = null;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private resizeObserver: ResizeObserver | null = null;

  private sm: AnimationStateMachine;
  private def: AnimStateMachineDef;

  // Interaction
  private panX = 0;
  private panY = 0;
  private zoom = 1;
  private dragging: AnimState | null = null;
  private dragOffX = 0;
  private dragOffY = 0;
  private panning = false;
  private panStartX = 0;
  private panStartY = 0;
  private selectedState: AnimState | null = null;
  private selectedTransition: AnimTransition | null = null;
  private connecting = false;
  private connectFrom: AnimState | null = null;
  private mouseX = 0;
  private mouseY = 0;

  // Node sizes
  private nodeW = 160;
  private nodeH = 50;

  constructor(editor: EditorApp, sm?: AnimationStateMachine) {
    this.editor = editor;
    this.sm = sm ?? AnimationStateMachine.createDefault();
    this.def = this.sm.getDefinition();
  }

  render(): HTMLElement {
    if (this.container) return this.container;

    this.container = document.createElement('div');
    this.container.style.cssText = 'display:flex;width:100%;height:100%;background:#1a1a2e;color:#ccc;font-family:system-ui,sans-serif;font-size:12px;';

    // ── Left: canvas graph ──
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;';
    this.container.appendChild(canvasWrap);

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;cursor:grab;';
    canvasWrap.appendChild(this.canvas);

    // Canvas toolbar
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'position:absolute;top:8px;left:8px;display:flex;gap:4px;z-index:10;';
    toolbar.innerHTML = `
      <button class="asm-btn" data-action="add-state">+ State</button>
      <button class="asm-btn" data-action="fit-view">Fit View</button>
      <button class="asm-btn" data-action="save">💾 Save JSON</button>
      <button class="asm-btn" data-action="load">📂 Load JSON</button>
    `;
    canvasWrap.appendChild(toolbar);

    // Status info
    const info = document.createElement('div');
    info.className = 'asm-info';
    info.style.cssText = 'position:absolute;bottom:8px;left:8px;font-size:10px;color:#666;z-index:10;';
    info.textContent = 'Right-click state to connect | Middle-click to pan | Scroll to zoom';
    canvasWrap.appendChild(info);

    // ── Right: Properties panel ──
    const props = document.createElement('div');
    props.className = 'asm-props';
    props.style.cssText = 'width:280px;border-left:1px solid #333;overflow-y:auto;padding:10px;flex-shrink:0;display:flex;flex-direction:column;gap:10px;';
    this.container.appendChild(props);

    this.addStyles();
    this.initCanvas(canvasWrap);
    this.bindToolbar(toolbar);
    this.updatePropsPanel();
    this.redraw();

    return this.container;
  }

  // ─── Canvas Init ─────────────────────────────────────
  private initCanvas(wrap: HTMLElement): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    this.ctx = ctx;

    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const dpr = Math.min(window.devicePixelRatio, 2);
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.redraw();
    };
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(wrap);
    requestAnimationFrame(resize);

    // Mouse events
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e));
    this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onRightClick(e); });
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
  }

  // ─── Drawing ─────────────────────────────────────────
  private redraw(): void {
    if (!this.ctx) return;
    const w = this.canvas.width / (Math.min(window.devicePixelRatio, 2));
    const h = this.canvas.height / (Math.min(window.devicePixelRatio, 2));
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // Background grid
    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    this.drawGrid(w, h);
    this.drawTransitions();
    this.drawConnectingLine();
    this.drawStates();

    ctx.restore();
  }

  private drawGrid(w: number, h: number): void {
    const ctx = this.ctx;
    const gridSize = 30;
    const startX = Math.floor(-this.panX / this.zoom / gridSize) * gridSize - gridSize;
    const startY = Math.floor(-this.panY / this.zoom / gridSize) * gridSize - gridSize;
    const endX = startX + w / this.zoom + gridSize * 2;
    const endY = startY + h / this.zoom + gridSize * 2;

    ctx.strokeStyle = '#222244';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = startX; x < endX; x += gridSize) {
      ctx.moveTo(x, startY); ctx.lineTo(x, endY);
    }
    for (let y = startY; y < endY; y += gridSize) {
      ctx.moveTo(startX, y); ctx.lineTo(endX, y);
    }
    ctx.stroke();
  }

  private drawStates(): void {
    const ctx = this.ctx;
    const layer = this.def.layers[0];
    if (!layer) return;

    for (const state of layer.states) {
      const isDefault = state.id === layer.defaultState;
      const isSelected = this.selectedState === state;
      const x = state.editorX;
      const y = state.editorY;

      // Node background
      ctx.fillStyle = isSelected ? '#2a3a5e' : '#252540';
      ctx.strokeStyle = isDefault ? '#f0883e' : isSelected ? '#58a6ff' : '#444466';
      ctx.lineWidth = isDefault ? 2.5 : isSelected ? 2 : 1;

      this.roundRect(x, y, this.nodeW, this.nodeH, 6);
      ctx.fill();
      ctx.stroke();

      // Header bar
      const headerH = 18;
      ctx.fillStyle = isDefault ? '#3a2515' : '#1f1f3a';
      this.roundRectTop(x, y, this.nodeW, headerH, 6);
      ctx.fill();

      // State name
      ctx.fillStyle = isDefault ? '#f0883e' : '#ddd';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(state.name, x + 8, y + 13);

      // Default badge
      if (isDefault) {
        ctx.fillStyle = '#f0883e';
        ctx.font = '8px system-ui';
        ctx.textAlign = 'right';
        ctx.fillText('DEFAULT', x + this.nodeW - 6, y + 13);
      }

      // Clip name
      ctx.fillStyle = '#888';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`🎞 ${state.clipName}`, x + 8, y + 32);

      // Speed / loop info
      ctx.fillStyle = '#666';
      ctx.font = '9px system-ui';
      ctx.fillText(`${state.speed}x ${state.loop ? '🔁' : '▶'}`, x + 8, y + 44);
    }
  }

  private drawTransitions(): void {
    const ctx = this.ctx;
    const layer = this.def.layers[0];
    if (!layer) return;

    for (const trans of layer.transitions) {
      const fromState = trans.fromState === 'any' ? null : layer.states.find(s => s.id === trans.fromState);
      const toState = layer.states.find(s => s.id === trans.toState);
      if (!toState) continue;

      const isSelected = this.selectedTransition === trans;

      let fromX: number, fromY: number;
      if (fromState) {
        fromX = fromState.editorX + this.nodeW;
        fromY = fromState.editorY + this.nodeH / 2;
      } else {
        // "Any State" — draw from top-left corner area
        fromX = toState.editorX - 80;
        fromY = toState.editorY - 30;
      }

      const toX = toState.editorX;
      const toY = toState.editorY + this.nodeH / 2;

      // Arrow line
      ctx.strokeStyle = isSelected ? '#58a6ff' : trans.fromState === 'any' ? '#e67e22' : '#556688';
      ctx.lineWidth = isSelected ? 2.5 : 1.5;

      // Bezier curve
      const midX = (fromX + toX) / 2;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.bezierCurveTo(midX, fromY, midX, toY, toX, toY);
      ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(toY - fromY, toX - fromX);
      const arrowLen = 10;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - arrowLen * Math.cos(angle - 0.4), toY - arrowLen * Math.sin(angle - 0.4));
      ctx.lineTo(toX - arrowLen * Math.cos(angle + 0.4), toY - arrowLen * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fill();

      // Duration label on the middle of the curve
      if (trans.duration > 0) {
        const labelX = (fromX + toX) / 2;
        const labelY = (fromY + toY) / 2 - 8;
        ctx.fillStyle = '#888';
        ctx.font = '9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(`${trans.duration.toFixed(1)}s`, labelX, labelY);
      }

      // "Any" label
      if (trans.fromState === 'any') {
        ctx.fillStyle = '#e67e22';
        ctx.font = 'bold 10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Any', fromX, fromY - 8);
      }
    }
  }

  private drawConnectingLine(): void {
    if (!this.connecting || !this.connectFrom) return;
    const ctx = this.ctx;
    const fromX = this.connectFrom.editorX + this.nodeW;
    const fromY = this.connectFrom.editorY + this.nodeH / 2;
    const mx = (this.mouseX - this.panX) / this.zoom;
    const my = (this.mouseY - this.panY) / this.zoom;

    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(mx, my);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ─── Helpers ─────────────────────────────────────────
  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  private roundRectTop(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  private screenToGraph(sx: number, sy: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const x = (sx - rect.left - this.panX) / this.zoom;
    const y = (sy - rect.top - this.panY) / this.zoom;
    return [x, y];
  }

  private hitTestState(gx: number, gy: number): AnimState | null {
    const layer = this.def.layers[0];
    if (!layer) return null;
    // Reverse order so top-drawn nodes get priority
    for (let i = layer.states.length - 1; i >= 0; i--) {
      const s = layer.states[i];
      if (gx >= s.editorX && gx <= s.editorX + this.nodeW &&
          gy >= s.editorY && gy <= s.editorY + this.nodeH) {
        return s;
      }
    }
    return null;
  }

  private hitTestTransition(gx: number, gy: number): AnimTransition | null {
    const layer = this.def.layers[0];
    if (!layer) return null;

    for (const trans of layer.transitions) {
      const fromState = trans.fromState === 'any' ? null : layer.states.find(s => s.id === trans.fromState);
      const toState = layer.states.find(s => s.id === trans.toState);
      if (!toState) continue;

      let fx: number, fy: number;
      if (fromState) {
        fx = fromState.editorX + this.nodeW;
        fy = fromState.editorY + this.nodeH / 2;
      } else {
        fx = toState.editorX - 80;
        fy = toState.editorY - 30;
      }
      const tx = toState.editorX;
      const ty = toState.editorY + this.nodeH / 2;

      // Check distance to the midpoint of the bezier (rough proximity)
      const mx = (fx + tx) / 2;
      const my = (fy + ty) / 2;
      const dist = Math.sqrt((gx - mx) ** 2 + (gy - my) ** 2);
      if (dist < 20) return trans;
    }
    return null;
  }

  // ─── Mouse Events ────────────────────────────────────
  private onMouseDown(e: MouseEvent): void {
    const [gx, gy] = this.screenToGraph(e.clientX, e.clientY);

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle click or Alt+left: pan
      this.panning = true;
      this.panStartX = e.clientX - this.panX;
      this.panStartY = e.clientY - this.panY;
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button === 0) {
      // Left click: select/drag state
      const state = this.hitTestState(gx, gy);
      if (state) {
        if (this.connecting) {
          // Complete connection
          this.finishConnection(state);
          return;
        }
        this.selectedState = state;
        this.selectedTransition = null;
        this.dragging = state;
        this.dragOffX = gx - state.editorX;
        this.dragOffY = gy - state.editorY;
        this.canvas.style.cursor = 'move';
      } else {
        // Check transition hit
        const trans = this.hitTestTransition(gx, gy);
        if (trans) {
          this.selectedTransition = trans;
          this.selectedState = null;
        } else {
          this.selectedState = null;
          this.selectedTransition = null;
          if (this.connecting) {
            this.connecting = false;
            this.connectFrom = null;
          }
        }
      }
      this.updatePropsPanel();
      this.redraw();
    }
  }

  private onMouseMove(e: MouseEvent): void {
    this.mouseX = e.clientX - this.canvas.getBoundingClientRect().left;
    this.mouseY = e.clientY - this.canvas.getBoundingClientRect().top;

    if (this.panning) {
      this.panX = e.clientX - this.panStartX;
      this.panY = e.clientY - this.panStartY;
      this.redraw();
      return;
    }

    if (this.dragging) {
      const [gx, gy] = this.screenToGraph(e.clientX, e.clientY);
      this.dragging.editorX = gx - this.dragOffX;
      this.dragging.editorY = gy - this.dragOffY;
      this.redraw();
      return;
    }

    if (this.connecting) {
      this.redraw();
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (this.panning) {
      this.panning = false;
      this.canvas.style.cursor = 'grab';
    }
    if (this.dragging) {
      this.dragging = null;
      this.canvas.style.cursor = 'grab';
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const oldZoom = this.zoom;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    this.zoom = Math.max(0.2, Math.min(3, this.zoom * factor));

    // Zoom toward mouse position
    this.panX = mx - (mx - this.panX) * (this.zoom / oldZoom);
    this.panY = my - (my - this.panY) * (this.zoom / oldZoom);

    this.redraw();
  }

  private onRightClick(e: MouseEvent): void {
    const [gx, gy] = this.screenToGraph(e.clientX, e.clientY);
    const state = this.hitTestState(gx, gy);

    if (state) {
      // Start connection from this state
      this.connecting = true;
      this.connectFrom = state;
      this.canvas.style.cursor = 'crosshair';
    } else {
      this.showContextMenu(e.clientX, e.clientY, gx, gy);
    }
  }

  private onDoubleClick(e: MouseEvent): void {
    const [gx, gy] = this.screenToGraph(e.clientX, e.clientY);
    const state = this.hitTestState(gx, gy);
    if (state) {
      const newName = prompt('Rename state:', state.name);
      if (newName && newName.trim()) {
        state.name = newName.trim();
        this.redraw();
        this.updatePropsPanel();
      }
    }
  }

  private finishConnection(targetState: AnimState): void {
    if (!this.connectFrom || this.connectFrom === targetState) {
      this.connecting = false;
      this.connectFrom = null;
      this.canvas.style.cursor = 'grab';
      return;
    }

    const layer = this.def.layers[0];
    if (!layer) return;

    const id = `t_${Date.now()}`;
    layer.transitions.push({
      id,
      fromState: this.connectFrom.id,
      toState: targetState.id,
      conditions: [],
      duration: 0.2,
      exitTime: 0,
      hasExitTime: false,
    });

    this.connecting = false;
    this.connectFrom = null;
    this.canvas.style.cursor = 'grab';
    this.redraw();
    this.updatePropsPanel();
  }

  private showContextMenu(screenX: number, screenY: number, gx: number, gy: number): void {
    // Remove existing menu
    document.querySelectorAll('.asm-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'asm-context-menu';
    menu.style.cssText = `position:fixed;left:${screenX}px;top:${screenY}px;background:#2a2a3a;border:1px solid #444;border-radius:4px;padding:4px 0;z-index:10000;min-width:140px;box-shadow:0 4px 12px #0008;`;

    const items = [
      { label: '+ Add State Here', action: () => this.addState(gx, gy) },
      { label: '+ Add Any-State Transition', action: () => this.addAnyStateTransition() },
      { label: '─', action: null },
      { label: 'Fit to View', action: () => this.fitView() },
    ];

    for (const item of items) {
      if (item.label === '─') {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:#444;margin:2px 0;';
        menu.appendChild(sep);
        continue;
      }
      const btn = document.createElement('div');
      btn.style.cssText = 'padding:6px 14px;cursor:pointer;font-size:11px;color:#ccc;';
      btn.textContent = item.label;
      btn.addEventListener('mouseenter', () => { btn.style.background = '#3a3a5a'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
      btn.addEventListener('click', () => { item.action?.(); menu.remove(); });
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);
    const removeMenu = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener('mousedown', removeMenu);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', removeMenu), 0);
  }

  // ─── State/Transition Management ─────────────────────
  private addState(gx = 200, gy = 200): void {
    const layer = this.def.layers[0];
    if (!layer) return;

    const id = `state_${Date.now()}`;
    const name = `State_${layer.states.length}`;
    layer.states.push({
      id,
      name,
      clipName: '',
      speed: 1,
      loop: true,
      editorX: gx,
      editorY: gy,
    });

    if (layer.states.length === 1) {
      layer.defaultState = id;
    }

    this.redraw();
    this.updatePropsPanel();
  }

  private addAnyStateTransition(): void {
    const layer = this.def.layers[0];
    if (!layer || layer.states.length === 0) return;

    const id = `t_${Date.now()}`;
    layer.transitions.push({
      id,
      fromState: 'any',
      toState: layer.states[0].id,
      conditions: [],
      duration: 0.1,
      exitTime: 0,
      hasExitTime: false,
    });
    this.redraw();
    this.updatePropsPanel();
  }

  private deleteState(state: AnimState): void {
    const layer = this.def.layers[0];
    if (!layer) return;

    layer.states = layer.states.filter(s => s !== state);
    layer.transitions = layer.transitions.filter(t => t.fromState !== state.id && t.toState !== state.id);

    if (layer.defaultState === state.id && layer.states.length > 0) {
      layer.defaultState = layer.states[0].id;
    }

    if (this.selectedState === state) this.selectedState = null;
    this.redraw();
    this.updatePropsPanel();
  }

  private deleteTransition(trans: AnimTransition): void {
    const layer = this.def.layers[0];
    if (!layer) return;

    layer.transitions = layer.transitions.filter(t => t !== trans);
    if (this.selectedTransition === trans) this.selectedTransition = null;
    this.redraw();
    this.updatePropsPanel();
  }

  private fitView(): void {
    const layer = this.def.layers[0];
    if (!layer || layer.states.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of layer.states) {
      minX = Math.min(minX, s.editorX);
      minY = Math.min(minY, s.editorY);
      maxX = Math.max(maxX, s.editorX + this.nodeW);
      maxY = Math.max(maxY, s.editorY + this.nodeH);
    }

    const rect = this.canvas.getBoundingClientRect();
    const padding = 60;
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;
    this.zoom = Math.min(1.5, rect.width / contentW, rect.height / contentH);
    this.panX = (rect.width - contentW * this.zoom) / 2 - (minX - padding) * this.zoom;
    this.panY = (rect.height - contentH * this.zoom) / 2 - (minY - padding) * this.zoom;
    this.redraw();
  }

  // ─── Properties Panel ────────────────────────────────
  private updatePropsPanel(): void {
    const propsEl = this.container?.querySelector('.asm-props') as HTMLElement;
    if (!propsEl) return;
    propsEl.innerHTML = '';

    // Machine name
    this.buildSection(propsEl, '🎛 State Machine', () => {
      const d = document.createElement('div');
      d.innerHTML = `
        <div class="asm-field"><label>Name</label><input type="text" value="${this.def.name}" data-sm-name /></div>
        <div style="font-size:10px;color:#666;margin-top:4px;">Layer: ${this.def.layers[0]?.name ?? 'None'} | States: ${this.def.layers[0]?.states.length ?? 0} | Transitions: ${this.def.layers[0]?.transitions.length ?? 0}</div>
      `;
      d.querySelector('[data-sm-name]')?.addEventListener('change', (e) => {
        this.def.name = (e.target as HTMLInputElement).value;
      });
      return d;
    });

    // Parameters
    this.buildSection(propsEl, '📊 Parameters', () => this.buildParamsUI());

    // Selected state
    if (this.selectedState) {
      this.buildSection(propsEl, `🔷 State: ${this.selectedState.name}`, () => this.buildStateUI(this.selectedState!));
    }

    // Selected transition
    if (this.selectedTransition) {
      this.buildSection(propsEl, '➡️ Transition', () => this.buildTransitionUI(this.selectedTransition!));
    }

    // All transitions list
    this.buildSection(propsEl, '🔗 All Transitions', () => this.buildTransitionListUI());
  }

  private buildSection(parent: HTMLElement, title: string, contentFn: () => HTMLElement): void {
    const section = document.createElement('div');
    section.className = 'asm-section';
    const header = document.createElement('div');
    header.className = 'asm-section-title';
    header.textContent = title;
    section.appendChild(header);
    section.appendChild(contentFn());
    parent.appendChild(section);
  }

  private buildParamsUI(): HTMLElement {
    const div = document.createElement('div');

    for (let i = 0; i < this.def.parameters.length; i++) {
      const p = this.def.parameters[i];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;';

      const typeBadge = document.createElement('span');
      typeBadge.style.cssText = 'font-size:8px;padding:1px 4px;border-radius:2px;background:#333;color:#aaa;min-width:28px;text-align:center;';
      typeBadge.textContent = p.type;
      row.appendChild(typeBadge);

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = p.name;
      nameInput.style.cssText = 'flex:1;background:#222;border:1px solid #444;color:#ccc;padding:2px 4px;font-size:10px;border-radius:2px;min-width:0;';
      nameInput.addEventListener('change', () => { p.name = nameInput.value; });
      row.appendChild(nameInput);

      if (p.type === 'float' || p.type === 'int') {
        const valInput = document.createElement('input');
        valInput.type = 'number';
        valInput.value = String(p.value);
        valInput.step = p.type === 'float' ? '0.1' : '1';
        valInput.style.cssText = 'width:50px;background:#222;border:1px solid #444;color:#ccc;padding:2px 4px;font-size:10px;border-radius:2px;';
        valInput.addEventListener('change', () => { p.value = parseFloat(valInput.value); });
        row.appendChild(valInput);
      } else if (p.type === 'bool' || p.type === 'trigger') {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = p.value === true;
        cb.addEventListener('change', () => { p.value = cb.checked; });
        row.appendChild(cb);
      }

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.style.cssText = 'background:none;border:none;color:#e74c3c;cursor:pointer;font-size:10px;';
      delBtn.addEventListener('click', () => {
        this.def.parameters.splice(i, 1);
        this.updatePropsPanel();
      });
      row.appendChild(delBtn);

      div.appendChild(row);
    }

    // Add parameter buttons
    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:flex;gap:4px;margin-top:6px;';
    for (const type of ['float', 'int', 'bool', 'trigger'] as AnimParamType[]) {
      const btn = document.createElement('button');
      btn.className = 'asm-btn';
      btn.textContent = `+ ${type}`;
      btn.style.fontSize = '9px';
      btn.addEventListener('click', () => {
        this.def.parameters.push({ name: `param_${this.def.parameters.length}`, type, value: type === 'bool' || type === 'trigger' ? false : 0 });
        this.updatePropsPanel();
      });
      addRow.appendChild(btn);
    }
    div.appendChild(addRow);

    return div;
  }

  private buildStateUI(state: AnimState): HTMLElement {
    const div = document.createElement('div');
    const layer = this.def.layers[0];

    div.innerHTML = `
      <div class="asm-field"><label>Name</label><input type="text" value="${state.name}" data-s-name /></div>
      <div class="asm-field"><label>Clip</label><input type="text" value="${state.clipName}" data-s-clip /></div>
      <div class="asm-field"><label>Speed</label><input type="number" value="${state.speed}" step="0.1" min="0" data-s-speed /></div>
      <div class="asm-field"><label>Loop</label><input type="checkbox" ${state.loop ? 'checked' : ''} data-s-loop /></div>
    `;

    div.querySelector('[data-s-name]')?.addEventListener('change', (e) => {
      state.name = (e.target as HTMLInputElement).value;
      this.redraw();
    });
    div.querySelector('[data-s-clip]')?.addEventListener('change', (e) => {
      state.clipName = (e.target as HTMLInputElement).value;
      this.redraw();
    });
    div.querySelector('[data-s-speed]')?.addEventListener('change', (e) => {
      state.speed = parseFloat((e.target as HTMLInputElement).value) || 1;
      this.redraw();
    });
    div.querySelector('[data-s-loop]')?.addEventListener('change', (e) => {
      state.loop = (e.target as HTMLInputElement).checked;
      this.redraw();
    });

    // Set as default / Delete buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:4px;margin-top:8px;';

    if (layer && layer.defaultState !== state.id) {
      const defBtn = document.createElement('button');
      defBtn.className = 'asm-btn';
      defBtn.textContent = '⭐ Set Default';
      defBtn.addEventListener('click', () => {
        layer.defaultState = state.id;
        this.redraw();
        this.updatePropsPanel();
      });
      btnRow.appendChild(defBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'asm-btn';
    delBtn.style.cssText = 'color:#e74c3c;border-color:#e74c3c;';
    delBtn.textContent = '🗑 Delete';
    delBtn.addEventListener('click', () => this.deleteState(state));
    btnRow.appendChild(delBtn);

    div.appendChild(btnRow);
    return div;
  }

  private buildTransitionUI(trans: AnimTransition): HTMLElement {
    const div = document.createElement('div');
    const layer = this.def.layers[0];
    if (!layer) return div;

    const stateOpts = layer.states.map(s => `<option value="${s.id}" ${s.id === trans.fromState ? 'selected' : ''}>${s.name}</option>`).join('');
    const stateOptsTo = layer.states.map(s => `<option value="${s.id}" ${s.id === trans.toState ? 'selected' : ''}>${s.name}</option>`).join('');

    div.innerHTML = `
      <div class="asm-field"><label>From</label><select data-t-from><option value="any" ${trans.fromState === 'any' ? 'selected' : ''}>Any State</option>${stateOpts}</select></div>
      <div class="asm-field"><label>To</label><select data-t-to>${stateOptsTo}</select></div>
      <div class="asm-field"><label>Duration</label><input type="number" value="${trans.duration}" step="0.05" min="0" data-t-dur /></div>
      <div class="asm-field"><label>Has Exit Time</label><input type="checkbox" ${trans.hasExitTime ? 'checked' : ''} data-t-het /></div>
      <div class="asm-field"><label>Exit Time</label><input type="number" value="${trans.exitTime}" step="0.05" min="0" max="1" data-t-et /></div>
    `;

    div.querySelector('[data-t-from]')?.addEventListener('change', (e) => {
      trans.fromState = (e.target as HTMLSelectElement).value;
      this.redraw();
    });
    div.querySelector('[data-t-to]')?.addEventListener('change', (e) => {
      trans.toState = (e.target as HTMLSelectElement).value;
      this.redraw();
    });
    div.querySelector('[data-t-dur]')?.addEventListener('change', (e) => {
      trans.duration = parseFloat((e.target as HTMLInputElement).value) || 0;
      this.redraw();
    });
    div.querySelector('[data-t-het]')?.addEventListener('change', (e) => {
      trans.hasExitTime = (e.target as HTMLInputElement).checked;
    });
    div.querySelector('[data-t-et]')?.addEventListener('change', (e) => {
      trans.exitTime = parseFloat((e.target as HTMLInputElement).value) || 0;
    });

    // Conditions
    const condTitle = document.createElement('div');
    condTitle.style.cssText = 'font-size:10px;font-weight:600;color:#888;margin-top:8px;margin-bottom:4px;';
    condTitle.textContent = 'Conditions';
    div.appendChild(condTitle);

    for (let i = 0; i < trans.conditions.length; i++) {
      const cond = trans.conditions[i];
      div.appendChild(this.buildConditionRow(cond, () => {
        trans.conditions.splice(i, 1);
        this.updatePropsPanel();
      }));
    }

    const addCondBtn = document.createElement('button');
    addCondBtn.className = 'asm-btn';
    addCondBtn.style.cssText = 'width:100%;margin-top:4px;font-size:10px;';
    addCondBtn.textContent = '+ Add Condition';
    addCondBtn.addEventListener('click', () => {
      const paramName = this.def.parameters[0]?.name ?? '';
      trans.conditions.push({ paramName, op: 'greater', threshold: 0 });
      this.updatePropsPanel();
    });
    div.appendChild(addCondBtn);

    // Delete transition
    const delBtn = document.createElement('button');
    delBtn.className = 'asm-btn';
    delBtn.style.cssText = 'width:100%;margin-top:8px;color:#e74c3c;border-color:#e74c3c;';
    delBtn.textContent = '🗑 Delete Transition';
    delBtn.addEventListener('click', () => this.deleteTransition(trans));
    div.appendChild(delBtn);

    return div;
  }

  private buildConditionRow(cond: TransitionCondition, onDelete: () => void): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;background:#1a1a2a;padding:4px;border-radius:3px;';

    const paramSel = document.createElement('select');
    paramSel.style.cssText = 'flex:1;background:#222;border:1px solid #444;color:#ccc;font-size:9px;padding:2px;border-radius:2px;';
    for (const p of this.def.parameters) {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      if (p.name === cond.paramName) opt.selected = true;
      paramSel.appendChild(opt);
    }
    paramSel.addEventListener('change', () => { cond.paramName = paramSel.value; });
    row.appendChild(paramSel);

    const opSel = document.createElement('select');
    opSel.style.cssText = 'background:#222;border:1px solid #444;color:#ccc;font-size:9px;padding:2px;border-radius:2px;';
    const ops: { val: ConditionOp; label: string }[] = [
      { val: 'greater', label: '>' },
      { val: 'less', label: '<' },
      { val: 'equals', label: '==' },
      { val: 'notEquals', label: '!=' },
      { val: 'isTrue', label: 'True' },
      { val: 'isFalse', label: 'False' },
    ];
    for (const op of ops) {
      const opt = document.createElement('option');
      opt.value = op.val;
      opt.textContent = op.label;
      if (op.val === cond.op) opt.selected = true;
      opSel.appendChild(opt);
    }
    opSel.addEventListener('change', () => { cond.op = opSel.value as ConditionOp; });
    row.appendChild(opSel);

    const threshInput = document.createElement('input');
    threshInput.type = 'number';
    threshInput.value = String(cond.threshold ?? 0);
    threshInput.step = '0.1';
    threshInput.style.cssText = 'width:45px;background:#222;border:1px solid #444;color:#ccc;font-size:9px;padding:2px;border-radius:2px;';
    threshInput.addEventListener('change', () => { cond.threshold = parseFloat(threshInput.value); });
    row.appendChild(threshInput);

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.style.cssText = 'background:none;border:none;color:#e74c3c;cursor:pointer;font-size:10px;';
    delBtn.addEventListener('click', onDelete);
    row.appendChild(delBtn);

    return row;
  }

  private buildTransitionListUI(): HTMLElement {
    const div = document.createElement('div');
    const layer = this.def.layers[0];
    if (!layer) return div;

    if (layer.transitions.length === 0) {
      div.innerHTML = '<div style="color:#555;font-size:10px;">No transitions. Right-click a state to create one.</div>';
      return div;
    }

    for (const trans of layer.transitions) {
      const fromName = trans.fromState === 'any' ? 'Any' : (layer.states.find(s => s.id === trans.fromState)?.name ?? '?');
      const toName = layer.states.find(s => s.id === trans.toState)?.name ?? '?';

      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:3px;cursor:pointer;font-size:10px;margin-bottom:2px;background:${this.selectedTransition === trans ? '#2a3a5e' : '#1e1e1e'};border-left:2px solid ${trans.fromState === 'any' ? '#e67e22' : '#3498db'};`;

      row.innerHTML = `<span style="flex:1;">${fromName} → ${toName}</span><span style="color:#666;">${trans.duration.toFixed(1)}s</span>`;
      row.addEventListener('click', () => {
        this.selectedTransition = trans;
        this.selectedState = null;
        this.updatePropsPanel();
        this.redraw();
      });
      div.appendChild(row);
    }

    return div;
  }

  // ─── Toolbar ─────────────────────────────────────────
  private bindToolbar(toolbar: HTMLElement): void {
    toolbar.querySelector('[data-action="add-state"]')?.addEventListener('click', () => this.addState());
    toolbar.querySelector('[data-action="fit-view"]')?.addEventListener('click', () => this.fitView());
    toolbar.querySelector('[data-action="save"]')?.addEventListener('click', () => this.saveJSON());
    toolbar.querySelector('[data-action="load"]')?.addEventListener('click', () => this.loadJSON());
  }

  private saveJSON(): void {
    const json = this.sm.serialize();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.def.name || 'statemachine'}.bfasm`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private loadJSON(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bfasm,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          this.sm = AnimationStateMachine.deserialize(reader.result as string);
          this.def = this.sm.getDefinition();
          this.selectedState = null;
          this.selectedTransition = null;
          this.fitView();
          this.updatePropsPanel();
          this.redraw();
        } catch (e) {
          console.error('Failed to load state machine:', e);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ─── Styles ──────────────────────────────────────────
  private addStyles(): void {
    if (document.getElementById('asm-editor-styles')) return;
    const style = document.createElement('style');
    style.id = 'asm-editor-styles';
    style.textContent = `
      .asm-section { border-bottom:1px solid #333; padding-bottom:8px; }
      .asm-section-title { font-size:10px; font-weight:600; color:#888; text-transform:uppercase; margin-bottom:6px; letter-spacing:0.5px; }
      .asm-btn { padding:4px 10px; border-radius:3px; border:1px solid #444; background:#2a2a3a; color:#ccc; font-size:11px; cursor:pointer; transition:all 0.15s; white-space:nowrap; }
      .asm-btn:hover { background:#3a3a4a; }
      .asm-field { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
      .asm-field label { width:80px; font-size:10px; color:#999; flex-shrink:0; }
      .asm-field input[type="text"], .asm-field input[type="number"] { flex:1; background:#222; border:1px solid #444; color:#ccc; padding:3px 6px; font-size:11px; border-radius:2px; }
      .asm-field select { flex:1; background:#222; border:1px solid #444; color:#ccc; font-size:11px; padding:3px; border-radius:2px; }
    `;
    document.head.appendChild(style);
  }

  /** Get the current state machine instance */
  getStateMachine(): AnimationStateMachine {
    return this.sm;
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.container = null;
  }
}
