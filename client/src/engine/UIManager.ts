// ─── Game UI System ─────────────────────────────────────────────────
// Complete in-game UI framework: health bars, notifications,
// floating damage, menus, tooltips, modals, loading screens.
// All DOM-based for easy styling with CSS.

export interface UINotification {
  text: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration: number;
}

export interface UIFloatingText {
  text: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
  duration: number;
}

// ── UI Manager ────────────────────────────────────────────────────

export class UIManager {
  private container: HTMLElement;
  private layers = new Map<string, HTMLElement>();
  private healthBars = new Map<string, HealthBarWidget>();
  private notifications: NotificationWidget[] = [];
  private floatingTexts: FloatingTextWidget[] = [];
  private modals: ModalWidget[] = [];
  private loadingScreen: LoadingScreenWidget | null = null;
  private entityLabels = new Map<string, EntityLabelWidget>();
  private tooltipWidget: TooltipWidget | null = null;
  private dialogueWidget: DialogueWidget | null = null;
  private inventories = new Map<string, InventoryWidget>();
  private radialMenu: RadialMenuWidget | null = null;
  private progressBars = new Map<string, ProgressBarWidget>();

  constructor(parentId = 'ui-overlay') {
    this.container = document.getElementById(parentId) ?? document.body;
    this.createDefaultLayers();
  }

  private createDefaultLayers(): void {
    const layerNames = ['world', 'hud', 'notifications', 'modals', 'loading'];
    for (const name of layerNames) {
      const el = document.createElement('div');
      el.className = `ui-layer ui-layer-${name}`;
      el.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
      if (name === 'modals' || name === 'loading') {
        el.style.zIndex = name === 'loading' ? '1000' : '900';
      }
      this.container.appendChild(el);
      this.layers.set(name, el);
    }
  }

  getLayer(name: string): HTMLElement | undefined {
    return this.layers.get(name);
  }

  // ── Health Bars ─────────────────────────────────────────────────

  createHealthBar(id: string, options?: Partial<HealthBarOptions>): HealthBarWidget {
    const bar = new HealthBarWidget(options);
    this.healthBars.set(id, bar);
    this.layers.get('hud')?.appendChild(bar.element);
    return bar;
  }

  updateHealthBar(id: string, current: number, max: number): void {
    this.healthBars.get(id)?.update(current, max);
  }

  removeHealthBar(id: string): void {
    const bar = this.healthBars.get(id);
    if (bar) {
      bar.element.remove();
      this.healthBars.delete(id);
    }
  }

  // ── Notifications ───────────────────────────────────────────────

  notify(text: string, type: UINotification['type'] = 'info', duration = 3): void {
    const widget = new NotificationWidget(text, type, duration);
    this.notifications.push(widget);
    this.layers.get('notifications')?.appendChild(widget.element);

    setTimeout(() => {
      widget.fadeOut();
      setTimeout(() => {
        widget.element.remove();
        const idx = this.notifications.indexOf(widget);
        if (idx !== -1) this.notifications.splice(idx, 1);
      }, 500);
    }, duration * 1000);
  }

  // ── Floating Damage/Text ────────────────────────────────────────

  floatingText(config: UIFloatingText): void {
    const widget = new FloatingTextWidget(config);
    this.floatingTexts.push(widget);
    this.layers.get('world')?.appendChild(widget.element);
  }

  // ── Modals / Menus ──────────────────────────────────────────────

  showModal(options: ModalOptions): ModalWidget {
    const modal = new ModalWidget(options);
    this.modals.push(modal);
    this.layers.get('modals')?.appendChild(modal.element);
    return modal;
  }

  closeModal(modal: ModalWidget): void {
    modal.close();
    const idx = this.modals.indexOf(modal);
    if (idx !== -1) this.modals.splice(idx, 1);
  }

  closeAllModals(): void {
    for (const m of this.modals) m.close();
    this.modals.length = 0;
  }

  // ── Loading Screen ──────────────────────────────────────────────

  showLoading(message = 'Loading...'): LoadingScreenWidget {
    if (this.loadingScreen) {
      this.loadingScreen.setMessage(message);
      return this.loadingScreen;
    }
    this.loadingScreen = new LoadingScreenWidget(message);
    this.layers.get('loading')?.appendChild(this.loadingScreen.element);
    return this.loadingScreen;
  }

  hideLoading(): void {
    if (this.loadingScreen) {
      this.loadingScreen.element.remove();
      this.loadingScreen = null;
    }
  }

  updateLoading(progress: number, message?: string): void {
    this.loadingScreen?.update(progress, message);
  }

  // ── Crosshair ───────────────────────────────────────────────────

  showCrosshair(style: 'dot' | 'cross' | 'circle' = 'cross'): HTMLElement {
    const el = document.createElement('div');
    el.className = `ui-crosshair ui-crosshair-${style}`;
    el.style.cssText = `
      position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
      pointer-events:none;z-index:100;
    `;

    switch (style) {
      case 'dot':
        el.style.cssText += 'width:4px;height:4px;background:#fff;border-radius:50%;';
        break;
      case 'cross':
        el.innerHTML = `
          <div style="position:absolute;width:2px;height:16px;background:#fff;left:50%;top:50%;transform:translate(-50%,-50%);"></div>
          <div style="position:absolute;width:16px;height:2px;background:#fff;left:50%;top:50%;transform:translate(-50%,-50%);"></div>
        `;
        break;
      case 'circle':
        el.style.cssText += 'width:20px;height:20px;border:2px solid #fff;border-radius:50%;';
        break;
    }

    this.layers.get('hud')?.appendChild(el);
    return el;
  }

  // ── Minimap Frame ───────────────────────────────────────────────

  createMinimap(width = 150, height = 150): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.cssText = `
      position:absolute;bottom:16px;right:16px;
      border:2px solid rgba(255,255,255,0.3);border-radius:8px;
      background:rgba(0,0,0,0.5);pointer-events:auto;
    `;
    this.layers.get('hud')?.appendChild(canvas);
    return canvas;
  }

  // ── Progress Bars ────────────────────────────────────────────────

  createProgressBar(id: string, options?: Partial<ProgressBarOptions>): ProgressBarWidget {
    const bar = new ProgressBarWidget(options);
    this.progressBars.set(id, bar);
    this.layers.get('hud')?.appendChild(bar.element);
    return bar;
  }

  updateProgressBar(id: string, value: number, max = 1): void {
    this.progressBars.get(id)?.update(value, max);
  }

  removeProgressBar(id: string): void {
    const bar = this.progressBars.get(id);
    if (bar) { bar.element.remove(); this.progressBars.delete(id); }
  }

  // ── Entity Labels (world-to-screen) ─────────────────────────────

  createEntityLabel(id: string, text: string, options?: Partial<EntityLabelOptions>): EntityLabelWidget {
    const label = new EntityLabelWidget(text, options);
    this.entityLabels.set(id, label);
    this.layers.get('world')?.appendChild(label.element);
    return label;
  }

  updateEntityLabelPosition(id: string, screenX: number, screenY: number, visible = true): void {
    this.entityLabels.get(id)?.setScreenPosition(screenX, screenY, visible);
  }

  removeEntityLabel(id: string): void {
    const label = this.entityLabels.get(id);
    if (label) { label.element.remove(); this.entityLabels.delete(id); }
  }

  // ── Tooltip ─────────────────────────────────────────────────────

  showTooltip(text: string, screenX: number, screenY: number, options?: Partial<TooltipOptions>): void {
    if (!this.tooltipWidget) {
      this.tooltipWidget = new TooltipWidget();
      this.layers.get('hud')?.appendChild(this.tooltipWidget.element);
    }
    this.tooltipWidget.show(text, screenX, screenY, options);
  }

  hideTooltip(): void {
    this.tooltipWidget?.hide();
  }

  // ── Dialogue System ─────────────────────────────────────────────

  showDialogue(options: DialogueOptions): DialogueWidget {
    if (this.dialogueWidget) this.dialogueWidget.element.remove();
    this.dialogueWidget = new DialogueWidget(options);
    this.layers.get('hud')?.appendChild(this.dialogueWidget.element);
    return this.dialogueWidget;
  }

  hideDialogue(): void {
    if (this.dialogueWidget) {
      this.dialogueWidget.element.remove();
      this.dialogueWidget = null;
    }
  }

  // ── Inventory Grid ──────────────────────────────────────────────

  createInventory(id: string, options: InventoryOptions): InventoryWidget {
    const inv = new InventoryWidget(options);
    this.inventories.set(id, inv);
    this.layers.get('hud')?.appendChild(inv.element);
    return inv;
  }

  getInventory(id: string): InventoryWidget | undefined {
    return this.inventories.get(id);
  }

  removeInventory(id: string): void {
    const inv = this.inventories.get(id);
    if (inv) { inv.element.remove(); this.inventories.delete(id); }
  }

  // ── Radial Menu ─────────────────────────────────────────────────

  showRadialMenu(options: RadialMenuOptions): RadialMenuWidget {
    this.hideRadialMenu();
    this.radialMenu = new RadialMenuWidget(options);
    this.layers.get('hud')?.appendChild(this.radialMenu.element);
    return this.radialMenu;
  }

  hideRadialMenu(): void {
    if (this.radialMenu) {
      this.radialMenu.element.remove();
      this.radialMenu = null;
    }
  }

  // ── Update (call each frame) ────────────────────────────────────

  update(delta: number): void {
    // Update floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      if (this.floatingTexts[i].update(delta)) {
        this.floatingTexts[i].element.remove();
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  // ── Layout System ─────────────────────────────────────────────────
  // Load UI layouts created in the visual UI editor at runtime.
  // Variables in text are resolved via {{varName}} syntax.

  private layouts = new Map<string, UILayoutData>();
  private layoutInstances = new Map<string, HTMLElement>();
  private layoutVariables = new Map<string, Record<string, string | number>>();

  /** Register a layout JSON (from the UI editor export) */
  registerLayout(name: string, data: UILayoutData): void {
    this.layouts.set(name, data);
  }

  /** Load and display a layout by name. Returns the root element. */
  loadLayout(name: string, variables?: Record<string, string | number>): HTMLElement | null {
    const data = this.layouts.get(name);
    if (!data) { console.warn(`UI layout "${name}" not found`); return null; }

    // Remove previous instance if exists
    this.unloadLayout(name);

    const vars = { ...data.variables, ...variables };
    this.layoutVariables.set(name, vars);

    const root = document.createElement('div');
    root.style.cssText = `position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:5000;`;
    root.dataset.uiLayout = name;

    // Build widget map for parent lookup
    const widgetMap = new Map<string, UILayoutWidget>();
    const elMap = new Map<string, HTMLElement>();
    for (const w of data.widgets) widgetMap.set(w.id, w);

    // Render root widgets first
    for (const w of data.widgets) {
      if (!w.parentId) this.renderLayoutWidget(w, root, data, vars, elMap);
    }

    document.body.appendChild(root);
    this.layoutInstances.set(name, root);
    return root;
  }

  private renderLayoutWidget(w: UILayoutWidget, parent: HTMLElement, data: UILayoutData, vars: Record<string, string | number>, elMap: Map<string, HTMLElement>): void {
    const el = document.createElement('div');
    el.dataset.widgetId = w.id;
    el.style.cssText = `position:absolute;left:${w.x}px;top:${w.y}px;width:${w.width}px;height:${w.height}px;opacity:${w.opacity};box-sizing:border-box;pointer-events:auto;`;
    if (w.bgColor && w.bgColor !== 'transparent') el.style.backgroundColor = w.bgColor;
    if (w.bgImage) { el.style.backgroundImage = `url(${w.bgImage})`; el.style.backgroundSize = w.bgSize === 'stretch' ? '100% 100%' : w.bgSize; el.style.backgroundPosition = 'center'; el.style.backgroundRepeat = 'no-repeat'; }
    if (w.borderWidth) el.style.border = `${w.borderWidth}px solid ${w.borderColor}`;
    if (w.borderRadius) el.style.borderRadius = w.borderRadius + 'px';
    if (!w.visible) el.style.display = 'none';
    if (w.cssClass) el.className = w.cssClass;

    // Resolve text variables
    let text = w.text || '';
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }

    switch (w.type) {
      case 'label': case 'button':
        el.style.display = 'flex'; el.style.alignItems = 'center';
        el.style.justifyContent = w.textAlign === 'left' ? 'flex-start' : w.textAlign === 'right' ? 'flex-end' : 'center';
        el.style.fontFamily = w.fontFamily; el.style.fontSize = w.fontSize + 'px'; el.style.fontWeight = w.fontWeight; el.style.color = w.fontColor;
        el.style.padding = '4px 8px'; el.textContent = text;
        if (w.type === 'button') { el.style.cursor = 'pointer'; el.style.userSelect = 'none'; }
        break;
      case 'progressbar': {
        el.style.overflow = 'hidden'; el.style.position = 'relative';
        const bar = document.createElement('div');
        bar.className = 'ui-layout-progress-fill';
        bar.style.cssText = `position:absolute;left:0;top:0;height:100%;width:${w.value ?? 0}%;background:linear-gradient(90deg,#2a6,#4c8);border-radius:${w.borderRadius}px;transition:width 0.3s;`;
        const lbl = document.createElement('div');
        lbl.style.cssText = `position:relative;z-index:1;width:100%;text-align:center;line-height:${w.height}px;font-size:${w.fontSize}px;color:${w.fontColor};`;
        lbl.textContent = text; el.appendChild(bar); el.appendChild(lbl); break;
      }
      case 'slider': {
        el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
        const inp = document.createElement('input'); inp.type = 'range';
        inp.min = String(w.minValue ?? 0); inp.max = String(w.maxValue ?? 100); inp.value = String(w.value ?? 50);
        inp.style.width = '90%'; el.appendChild(inp);
        if (w.onChange) inp.addEventListener('input', () => { this.dispatchLayoutEvent(w.onChange, inp.value); });
        break;
      }
      case 'checkbox': {
        el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.padding = '4px 8px';
        el.style.color = w.fontColor; el.style.fontSize = w.fontSize + 'px';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!w.checked; cb.style.marginRight = '6px';
        const lbl = document.createElement('span'); lbl.textContent = text;
        el.appendChild(cb); el.appendChild(lbl);
        if (w.onChange) cb.addEventListener('change', () => { this.dispatchLayoutEvent(w.onChange, cb.checked); });
        break;
      }
      case 'textinput': {
        const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = w.placeholder || '';
        inp.style.cssText = `width:100%;height:100%;padding:4px;background:#1a1a2e;border:1px solid #555;color:#fff;border-radius:4px;box-sizing:border-box;`;
        el.appendChild(inp);
        if (w.onChange) inp.addEventListener('input', () => { this.dispatchLayoutEvent(w.onChange, inp.value); });
        break;
      }
      case 'dropdown': {
        const sel = document.createElement('select');
        sel.style.cssText = `width:100%;height:100%;padding:4px;background:#1a1a2e;border:1px solid #555;color:#fff;border-radius:4px;box-sizing:border-box;`;
        for (const o of (w.options || [])) { const opt = document.createElement('option'); opt.textContent = o; sel.appendChild(opt); }
        el.appendChild(sel);
        if (w.onChange) sel.addEventListener('change', () => { this.dispatchLayoutEvent(w.onChange, sel.value); });
        break;
      }
      case 'divider':
        el.style.backgroundColor = w.borderColor || '#444'; break;
    }

    // Event handlers
    if (w.onClick) el.addEventListener('click', () => this.dispatchLayoutEvent(w.onClick, w.id));
    if (w.onHover) {
      el.addEventListener('mouseenter', () => this.dispatchLayoutEvent(w.onHover, w.id));
    }

    elMap.set(w.id, el);
    parent.appendChild(el);

    // Render children
    for (const cid of (w.childIds || [])) {
      const child = data.widgets.find(ww => ww.id === cid);
      if (child) this.renderLayoutWidget(child, el, data, vars, elMap);
    }
  }

  /** Remove a displayed layout */
  unloadLayout(name: string): void {
    const el = this.layoutInstances.get(name);
    if (el) { el.remove(); this.layoutInstances.delete(name); }
    this.layoutVariables.delete(name);
  }

  /** Update a variable in a displayed layout (re-renders affected text) */
  setLayoutVariable(layoutName: string, key: string, value: string | number): void {
    const vars = this.layoutVariables.get(layoutName);
    if (!vars) return;
    vars[key] = value;

    const root = this.layoutInstances.get(layoutName);
    const data = this.layouts.get(layoutName);
    if (!root || !data) return;

    // Update all widgets that reference this variable
    for (const w of data.widgets) {
      if (!w.text || !w.text.includes(`{{${key}}}`)) continue;
      const el = root.querySelector(`[data-widget-id="${w.id}"]`) as HTMLElement;
      if (!el) continue;

      let text = w.text;
      for (const [k, v] of Object.entries(vars)) {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
      }

      // Update text content or progress bar
      if (w.type === 'progressbar') {
        const lbl = el.querySelector('div:last-child') as HTMLElement;
        if (lbl) lbl.textContent = text;
        if (w.textVar === key) {
          const fill = el.querySelector('.ui-layout-progress-fill') as HTMLElement;
          if (fill) fill.style.width = `${value}%`;
        }
      } else {
        // Find the text node or element
        if (el.childElementCount === 0) el.textContent = text;
        else {
          const span = el.querySelector('span');
          if (span) span.textContent = text;
        }
      }
    }
  }

  private layoutEventHandlers = new Map<string, (value: any) => void>();

  /** Register a handler for layout events (onClick, onChange, etc.) */
  onLayoutEvent(eventName: string, handler: (value: any) => void): void {
    this.layoutEventHandlers.set(eventName, handler);
  }

  private dispatchLayoutEvent(eventName: string, value: any): void {
    const handler = this.layoutEventHandlers.get(eventName);
    if (handler) handler(value);
    else console.log(`[UI] Event "${eventName}" fired with value:`, value);
  }

  dispose(): void {
    for (const layer of this.layers.values()) {
      layer.remove();
    }
    this.layers.clear();
    this.healthBars.clear();
    this.notifications.length = 0;
    this.floatingTexts.length = 0;
    // Clean up layouts
    for (const el of this.layoutInstances.values()) el.remove();
    this.layoutInstances.clear();
    this.layouts.clear();
    this.layoutVariables.clear();
    this.layoutEventHandlers.clear();
  }
}

// Layout data interface (matches UIEditorPanel export format)
export interface UILayoutWidget {
  id: string; type: string; name: string; parentId: string | null;
  x: number; y: number; width: number; height: number;
  anchor: string; visible: boolean; opacity: number; zIndex: number;
  bgColor: string; bgImage: string; bgSize: string; borderColor: string;
  borderWidth: number; borderRadius: number;
  text: string; fontFamily: string; fontSize: number; fontWeight: string;
  fontColor: string; textAlign: string; textVar: string;
  value?: number; minValue?: number; maxValue?: number;
  placeholder?: string; options?: string[]; checked?: boolean;
  onClick: string; onHover: string; onChange: string;
  cssClass: string; childIds: string[];
}

export interface UILayoutData {
  name: string; description: string;
  canvasWidth: number; canvasHeight: number;
  widgets: UILayoutWidget[];
  variables: Record<string, string | number>;
}

// ═══════════════════════════════════════════════════════════════════
// WIDGETS
// ═══════════════════════════════════════════════════════════════════

// ── Health Bar ────────────────────────────────────────────────────

export interface HealthBarOptions {
  width: number;
  height: number;
  position: 'top-center' | 'bottom-center' | 'below-entity';
  showText: boolean;
  color: string;
  bgColor: string;
  borderColor: string;
}

const DEFAULT_HEALTHBAR: HealthBarOptions = {
  width: 200,
  height: 20,
  position: 'top-center',
  showText: true,
  color: '#2ecc71',
  bgColor: 'rgba(0,0,0,0.7)',
  borderColor: 'rgba(255,255,255,0.2)',
};

class HealthBarWidget {
  public element: HTMLElement;
  private fill: HTMLElement;
  private text: HTMLElement;
  private options: HealthBarOptions;

  constructor(opts?: Partial<HealthBarOptions>) {
    this.options = { ...DEFAULT_HEALTHBAR, ...opts };
    this.element = document.createElement('div');
    this.element.style.cssText = `
      position:absolute;pointer-events:none;
      width:${this.options.width}px;height:${this.options.height}px;
      background:${this.options.bgColor};border:1px solid ${this.options.borderColor};
      border-radius:${this.options.height / 2}px;overflow:hidden;
    `;

    if (this.options.position === 'top-center') {
      this.element.style.cssText += `top:20px;left:50%;transform:translateX(-50%);`;
    } else if (this.options.position === 'bottom-center') {
      this.element.style.cssText += `bottom:20px;left:50%;transform:translateX(-50%);`;
    }

    this.fill = document.createElement('div');
    this.fill.style.cssText = `
      width:100%;height:100%;background:${this.options.color};
      transition:width 0.3s ease;border-radius:${this.options.height / 2}px;
    `;
    this.element.appendChild(this.fill);

    this.text = document.createElement('span');
    this.text.style.cssText = `
      position:absolute;top:0;left:0;width:100%;height:100%;
      display:flex;align-items:center;justify-content:center;
      font-size:${Math.max(10, this.options.height - 6)}px;
      color:#fff;font-weight:bold;text-shadow:1px 1px 2px rgba(0,0,0,0.8);
    `;
    if (this.options.showText) this.element.appendChild(this.text);
  }

  update(current: number, max: number): void {
    const ratio = Math.max(0, Math.min(1, current / max));
    this.fill.style.width = `${ratio * 100}%`;

    // Color transitions
    if (ratio > 0.5) this.fill.style.background = '#2ecc71';
    else if (ratio > 0.25) this.fill.style.background = '#f39c12';
    else this.fill.style.background = '#e74c3c';

    this.text.textContent = `${Math.ceil(current)} / ${max}`;
  }

  setScreenPosition(x: number, y: number): void {
    this.element.style.left = `${x - this.options.width / 2}px`;
    this.element.style.top = `${y}px`;
    this.element.style.transform = 'none';
  }
}

// ── Notification ──────────────────────────────────────────────────

class NotificationWidget {
  public element: HTMLElement;

  constructor(text: string, type: UINotification['type'], _duration: number) {
    this.element = document.createElement('div');
    const colors = { info: '#3498db', success: '#2ecc71', warning: '#f39c12', error: '#e74c3c' };
    const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
    this.element.style.cssText = `
      pointer-events:auto;padding:10px 16px;margin:8px 16px;
      background:rgba(0,0,0,0.85);border-left:4px solid ${colors[type]};
      border-radius:4px;color:#fff;font-size:13px;position:relative;
      animation:slideInRight 0.3s ease;max-width:350px;float:right;clear:both;
    `;
    this.element.textContent = `${icons[type]} ${text}`;
  }

  fadeOut(): void {
    this.element.style.transition = 'opacity 0.5s';
    this.element.style.opacity = '0';
  }
}

// ── Floating Text (Damage Numbers etc.) ───────────────────────────

class FloatingTextWidget {
  public element: HTMLElement;
  private elapsed = 0;
  private duration: number;
  private startX: number;
  private startY: number;

  constructor(config: UIFloatingText) {
    this.duration = config.duration;
    this.startX = config.x;
    this.startY = config.y;

    this.element = document.createElement('div');
    this.element.textContent = config.text;
    this.element.style.cssText = `
      position:absolute;pointer-events:none;
      font-size:${config.fontSize}px;font-weight:bold;
      color:${config.color};text-shadow:2px 2px 4px rgba(0,0,0,0.8);
      left:${config.x}px;top:${config.y}px;
      transform:translate(-50%,-50%);
      transition:none;white-space:nowrap;
    `;
  }

  /** Returns true when finished */
  update(delta: number): boolean {
    this.elapsed += delta;
    const t = this.elapsed / this.duration;
    if (t >= 1) return true;

    // Rise up and fade out
    const y = this.startY - t * 50;
    const opacity = 1 - t;
    const scale = 1 + t * 0.3;

    this.element.style.top = `${y}px`;
    this.element.style.opacity = String(opacity);
    this.element.style.transform = `translate(-50%,-50%) scale(${scale})`;

    return false;
  }
}

// ── Modal ─────────────────────────────────────────────────────────

export interface ModalOptions {
  title: string;
  content: string;
  buttons?: { text: string; action: () => void; primary?: boolean }[];
  onClose?: () => void;
  width?: number;
}

class ModalWidget {
  public element: HTMLElement;
  private options: ModalOptions;

  constructor(options: ModalOptions) {
    this.options = options;
    this.element = document.createElement('div');
    this.element.style.cssText = `
      position:absolute;top:0;left:0;width:100%;height:100%;
      display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,0.6);pointer-events:auto;z-index:999;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background:#1e1e1e;border:1px solid #444;border-radius:8px;
      padding:24px;min-width:${options.width ?? 300}px;max-width:500px;
      color:#fff;box-shadow:0 8px 32px rgba(0,0,0,0.5);
    `;

    const title = document.createElement('h3');
    title.style.cssText = 'margin:0 0 12px;font-size:16px;color:#fff;';
    title.textContent = options.title;
    modal.appendChild(title);

    const content = document.createElement('div');
    content.style.cssText = 'margin-bottom:16px;font-size:13px;color:#ccc;line-height:1.5;';
    content.textContent = options.content;
    modal.appendChild(content);

    if (options.buttons && options.buttons.length > 0) {
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
      for (const btn of options.buttons) {
        const el = document.createElement('button');
        el.textContent = btn.text;
        el.style.cssText = `
          padding:6px 16px;border:1px solid #555;border-radius:4px;
          cursor:pointer;font-size:12px;
          ${btn.primary ? 'background:#0078d4;color:#fff;border-color:#0078d4;' : 'background:#333;color:#ccc;'}
        `;
        el.addEventListener('click', () => {
          btn.action();
          this.close();
        });
        btnRow.appendChild(el);
      }
      modal.appendChild(btnRow);
    }

    this.element.appendChild(modal);

    // Close on backdrop click
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.close();
    });
  }

  close(): void {
    this.options.onClose?.();
    this.element.remove();
  }
}

// ── Loading Screen ────────────────────────────────────────────────

class LoadingScreenWidget {
  public element: HTMLElement;
  private progressBar: HTMLElement;
  private messageEl: HTMLElement;
  private percentEl: HTMLElement;

  constructor(message: string) {
    this.element = document.createElement('div');
    this.element.style.cssText = `
      position:absolute;top:0;left:0;width:100%;height:100%;
      background:#111;display:flex;flex-direction:column;
      align-items:center;justify-content:center;pointer-events:auto;
      z-index:1000;
    `;

    // Logo area
    const logo = document.createElement('div');
    logo.style.cssText = 'font-size:32px;font-weight:bold;color:#fff;margin-bottom:40px;letter-spacing:4px;';
    logo.textContent = 'BLINDFAKE';
    this.element.appendChild(logo);

    // Progress container
    const container = document.createElement('div');
    container.style.cssText = 'width:300px;height:4px;background:#333;border-radius:2px;overflow:hidden;margin-bottom:16px;';

    this.progressBar = document.createElement('div');
    this.progressBar.style.cssText = 'width:0%;height:100%;background:#0078d4;transition:width 0.3s ease;border-radius:2px;';
    container.appendChild(this.progressBar);
    this.element.appendChild(container);

    // Message
    this.messageEl = document.createElement('div');
    this.messageEl.style.cssText = 'color:#888;font-size:12px;';
    this.messageEl.textContent = message;
    this.element.appendChild(this.messageEl);

    // Percent
    this.percentEl = document.createElement('div');
    this.percentEl.style.cssText = 'color:#666;font-size:11px;margin-top:8px;';
    this.percentEl.textContent = '0%';
    this.element.appendChild(this.percentEl);
  }

  update(progress: number, message?: string): void {
    const pct = Math.max(0, Math.min(100, progress));
    this.progressBar.style.width = `${pct}%`;
    this.percentEl.textContent = `${Math.round(pct)}%`;
    if (message) this.messageEl.textContent = message;
  }

  setMessage(message: string): void {
    this.messageEl.textContent = message;
  }
}

// ── Progress Bar ──────────────────────────────────────────────────

export interface ProgressBarOptions {
  width: number;
  height: number;
  color: string;
  bgColor: string;
  label: string;
  position: { x: number; y: number };
  showPercent: boolean;
}

const DEFAULT_PROGRESSBAR: ProgressBarOptions = {
  width: 200, height: 8, color: '#0078d4', bgColor: 'rgba(0,0,0,0.7)',
  label: '', position: { x: 50, y: 50 }, showPercent: true,
};

class ProgressBarWidget {
  public element: HTMLElement;
  private fill: HTMLElement;
  private label: HTMLElement;

  constructor(opts?: Partial<ProgressBarOptions>) {
    const o = { ...DEFAULT_PROGRESSBAR, ...opts };
    this.element = document.createElement('div');
    this.element.style.cssText = `position:absolute;left:${o.position.x}%;top:${o.position.y}%;transform:translate(-50%,-50%);pointer-events:none;text-align:center;`;

    this.label = document.createElement('div');
    this.label.style.cssText = 'color:#fff;font-size:11px;margin-bottom:4px;text-shadow:1px 1px 2px #000;';
    this.label.textContent = o.label;
    if (o.label) this.element.appendChild(this.label);

    const bar = document.createElement('div');
    bar.style.cssText = `width:${o.width}px;height:${o.height}px;background:${o.bgColor};border-radius:${o.height / 2}px;overflow:hidden;`;
    this.fill = document.createElement('div');
    this.fill.style.cssText = `width:0%;height:100%;background:${o.color};transition:width 0.2s ease;border-radius:${o.height / 2}px;`;
    bar.appendChild(this.fill);
    this.element.appendChild(bar);
  }

  update(value: number, max = 1): void {
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    this.fill.style.width = `${pct}%`;
  }
}

// ── Entity Label (world-to-screen) ────────────────────────────────

export interface EntityLabelOptions {
  color: string;
  fontSize: number;
  background: string;
  icon: string;
  offsetY: number;
}

class EntityLabelWidget {
  public element: HTMLElement;

  constructor(text: string, opts?: Partial<EntityLabelOptions>) {
    const o = { color: '#fff', fontSize: 12, background: 'rgba(0,0,0,0.6)', icon: '', offsetY: -20, ...opts };
    this.element = document.createElement('div');
    this.element.style.cssText = `position:absolute;pointer-events:none;white-space:nowrap;padding:2px 8px;border-radius:3px;background:${o.background};color:${o.color};font-size:${o.fontSize}px;transform:translate(-50%,${o.offsetY}px);text-shadow:1px 1px 2px #000;display:none;`;
    this.element.textContent = (o.icon ? o.icon + ' ' : '') + text;
  }

  setScreenPosition(x: number, y: number, visible: boolean): void {
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
    this.element.style.display = visible ? 'block' : 'none';
  }

  setText(text: string): void {
    this.element.textContent = text;
  }
}

// ── Tooltip ───────────────────────────────────────────────────────

export interface TooltipOptions {
  title: string;
  description: string;
  color: string;
}

class TooltipWidget {
  public element: HTMLElement;
  private titleEl: HTMLElement;
  private descEl: HTMLElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.style.cssText = 'position:absolute;pointer-events:none;background:#1a1a2e;border:1px solid #444;border-radius:6px;padding:8px 12px;max-width:250px;box-shadow:0 4px 12px #0008;display:none;z-index:500;';
    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = 'font-size:13px;font-weight:bold;color:#fff;margin-bottom:4px;';
    this.descEl = document.createElement('div');
    this.descEl.style.cssText = 'font-size:11px;color:#aaa;line-height:1.4;';
    this.element.appendChild(this.titleEl);
    this.element.appendChild(this.descEl);
  }

  show(text: string, x: number, y: number, opts?: Partial<TooltipOptions>): void {
    this.titleEl.textContent = opts?.title ?? text;
    this.titleEl.style.color = opts?.color ?? '#fff';
    this.descEl.textContent = opts?.description ?? '';
    this.descEl.style.display = opts?.description ? 'block' : 'none';
    this.element.style.left = `${x + 12}px`;
    this.element.style.top = `${y + 12}px`;
    this.element.style.display = 'block';
  }

  hide(): void {
    this.element.style.display = 'none';
  }
}

// ── Dialogue System ───────────────────────────────────────────────

export interface DialogueOptions {
  speaker: string;
  text: string;
  portrait?: string;
  choices?: { text: string; callback: () => void }[];
  onComplete?: () => void;
  typewriterSpeed?: number;
}

class DialogueWidget {
  public element: HTMLElement;
  private textEl: HTMLElement;
  private choicesEl: HTMLElement;
  private options: DialogueOptions;
  private typewriterTimer: number | null = null;

  constructor(options: DialogueOptions) {
    this.options = options;
    this.element = document.createElement('div');
    this.element.style.cssText = 'position:absolute;bottom:40px;left:50%;transform:translateX(-50%);width:80%;max-width:700px;background:rgba(10,10,25,0.92);border:1px solid #334;border-radius:10px;padding:16px 20px;pointer-events:auto;box-shadow:0 8px 32px #000a;';

    // Speaker name
    const speaker = document.createElement('div');
    speaker.style.cssText = 'font-size:14px;font-weight:bold;color:#58a6ff;margin-bottom:6px;';
    speaker.textContent = options.speaker;
    this.element.appendChild(speaker);

    // Portrait + text row
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;align-items:flex-start;';

    if (options.portrait) {
      const portrait = document.createElement('img');
      portrait.src = options.portrait;
      portrait.style.cssText = 'width:64px;height:64px;border-radius:50%;border:2px solid #444;flex-shrink:0;object-fit:cover;';
      row.appendChild(portrait);
    }

    this.textEl = document.createElement('div');
    this.textEl.style.cssText = 'flex:1;font-size:13px;color:#ddd;line-height:1.6;min-height:40px;';
    row.appendChild(this.textEl);
    this.element.appendChild(row);

    // Choices
    this.choicesEl = document.createElement('div');
    this.choicesEl.style.cssText = 'margin-top:12px;display:flex;flex-direction:column;gap:6px;';
    this.element.appendChild(this.choicesEl);

    // Typewriter effect
    this.typewriterEffect(options.text, options.typewriterSpeed ?? 30);

    // Click to skip typewriter
    this.element.addEventListener('click', () => {
      if (this.typewriterTimer !== null) {
        clearInterval(this.typewriterTimer);
        this.typewriterTimer = null;
        this.textEl.textContent = options.text;
        this.showChoices();
      } else if (!options.choices || options.choices.length === 0) {
        options.onComplete?.();
      }
    });
  }

  private typewriterEffect(text: string, speed: number): void {
    let i = 0;
    this.textEl.textContent = '';
    this.typewriterTimer = window.setInterval(() => {
      this.textEl.textContent += text[i];
      i++;
      if (i >= text.length) {
        if (this.typewriterTimer !== null) clearInterval(this.typewriterTimer);
        this.typewriterTimer = null;
        this.showChoices();
      }
    }, speed);
  }

  private showChoices(): void {
    if (!this.options.choices || this.options.choices.length === 0) return;
    this.choicesEl.innerHTML = '';
    for (const choice of this.options.choices) {
      const btn = document.createElement('button');
      btn.textContent = choice.text;
      btn.style.cssText = 'background:#1f2a44;border:1px solid #445;border-radius:6px;padding:8px 14px;color:#ccc;font-size:12px;cursor:pointer;text-align:left;transition:all 0.15s;';
      btn.addEventListener('mouseenter', () => { btn.style.background = '#2a3a5e'; btn.style.borderColor = '#58a6ff'; btn.style.color = '#fff'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#1f2a44'; btn.style.borderColor = '#445'; btn.style.color = '#ccc'; });
      btn.addEventListener('click', (e) => { e.stopPropagation(); choice.callback(); });
      this.choicesEl.appendChild(btn);
    }
  }
}

// ── Inventory Grid ────────────────────────────────────────────────

export interface InventoryOptions {
  rows: number;
  cols: number;
  slotSize: number;
  position: { x: string; y: string };
  title: string;
  draggable: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  icon: string;
  count: number;
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  tooltip?: string;
}

const RARITY_COLORS: Record<string, string> = {
  common: '#888', uncommon: '#2ecc71', rare: '#3498db', epic: '#9b59b6', legendary: '#f39c12',
};

class InventoryWidget {
  public element: HTMLElement;
  private slots: (InventoryItem | null)[];
  private slotElements: HTMLElement[] = [];
  private options: InventoryOptions;
  public onSlotClick?: (index: number, item: InventoryItem | null) => void;

  constructor(options: InventoryOptions) {
    this.options = options;
    this.slots = new Array(options.rows * options.cols).fill(null);

    this.element = document.createElement('div');
    this.element.style.cssText = `position:absolute;${options.position.x};${options.position.y};background:rgba(15,15,30,0.92);border:1px solid #334;border-radius:8px;padding:12px;pointer-events:auto;box-shadow:0 8px 24px #000a;`;

    // Title
    const title = document.createElement('div');
    title.style.cssText = 'font-size:13px;font-weight:bold;color:#ccc;margin-bottom:8px;display:flex;align-items:center;gap:8px;';
    title.textContent = options.title;
    
    if (options.draggable) {
      title.style.cursor = 'move';
      let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;
      title.addEventListener('mousedown', (e) => {
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        origX = this.element.offsetLeft; origY = this.element.offsetTop;
        const onMove = (ev: MouseEvent) => {
          if (!dragging) return;
          this.element.style.left = `${origX + ev.clientX - startX}px`;
          this.element.style.top = `${origY + ev.clientY - startY}px`;
          this.element.style.right = 'auto'; this.element.style.bottom = 'auto';
        };
        const onUp = () => { dragging = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }
    this.element.appendChild(title);

    // Grid
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${options.cols},${options.slotSize}px);gap:3px;`;

    for (let i = 0; i < options.rows * options.cols; i++) {
      const slot = document.createElement('div');
      slot.style.cssText = `width:${options.slotSize}px;height:${options.slotSize}px;background:#1a1a2e;border:1px solid #333;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;font-size:${options.slotSize * 0.5}px;transition:border-color 0.15s;`;
      slot.addEventListener('mouseenter', () => { slot.style.borderColor = '#58a6ff'; });
      slot.addEventListener('mouseleave', () => { slot.style.borderColor = this.slots[i]?.rarity ? RARITY_COLORS[this.slots[i]!.rarity!] : '#333'; });
      slot.addEventListener('click', () => { this.onSlotClick?.(i, this.slots[i]); });
      this.slotElements.push(slot);
      grid.appendChild(slot);
    }

    this.element.appendChild(grid);
  }

  setItem(index: number, item: InventoryItem | null): void {
    if (index < 0 || index >= this.slots.length) return;
    this.slots[index] = item;
    this.renderSlot(index);
  }

  getItem(index: number): InventoryItem | null {
    return this.slots[index] ?? null;
  }

  private renderSlot(index: number): void {
    const slot = this.slotElements[index];
    const item = this.slots[index];
    if (!slot) return;

    if (!item) {
      slot.innerHTML = '';
      slot.style.borderColor = '#333';
      return;
    }

    slot.style.borderColor = item.rarity ? RARITY_COLORS[item.rarity] : '#555';
    slot.innerHTML = `<span title="${item.name}">${item.icon}</span>`;
    if (item.count > 1) {
      const count = document.createElement('span');
      count.style.cssText = 'position:absolute;bottom:1px;right:3px;font-size:9px;color:#fff;text-shadow:1px 1px 2px #000;';
      count.textContent = String(item.count);
      slot.appendChild(count);
    }
  }
}

// ── Radial Menu ───────────────────────────────────────────────────

export interface RadialMenuOptions {
  items: { icon: string; label: string; action: () => void }[];
  x: number;
  y: number;
  radius?: number;
}

class RadialMenuWidget {
  public element: HTMLElement;

  constructor(options: RadialMenuOptions) {
    const radius = options.radius ?? 80;
    this.element = document.createElement('div');
    this.element.style.cssText = `position:absolute;left:${options.x}px;top:${options.y}px;pointer-events:auto;z-index:800;`;

    // Center dot
    const center = document.createElement('div');
    center.style.cssText = 'position:absolute;left:-8px;top:-8px;width:16px;height:16px;background:#333;border:2px solid #58a6ff;border-radius:50%;';
    this.element.appendChild(center);

    const count = options.items.length;
    for (let i = 0; i < count; i++) {
      const item = options.items[i];
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const ix = Math.cos(angle) * radius;
      const iy = Math.sin(angle) * radius;

      const btn = document.createElement('div');
      btn.style.cssText = `position:absolute;left:${ix - 28}px;top:${iy - 28}px;width:56px;height:56px;background:rgba(20,20,40,0.9);border:1px solid #445;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all 0.15s;`;
      btn.innerHTML = `<span style="font-size:20px;">${item.icon}</span><span style="font-size:8px;color:#aaa;margin-top:2px;">${item.label}</span>`;
      btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(40,60,100,0.95)'; btn.style.borderColor = '#58a6ff'; btn.style.transform = 'scale(1.15)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(20,20,40,0.9)'; btn.style.borderColor = '#445'; btn.style.transform = 'scale(1)'; });
      btn.addEventListener('click', () => item.action());
      this.element.appendChild(btn);
    }
  }
}
