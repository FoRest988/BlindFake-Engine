/**
 * UIEditorPanel — Visual drag-and-drop UI layout editor.
 *
 * Devs can:
 *  - Drag widgets (Panel, Button, Label, Image, ProgressBar, Slider, Checkbox, Input, Dropdown)
 *  - Position, resize, anchor, style visually
 *  - Import images (PNG/WebP/JPG) for backgrounds / icons
 *  - Bind text & values to named variables (e.g. {{playerName}}, {{health}})
 *  - Assign events (onClick, onHover, onChange) to script functions or blueprint nodes
 *  - Use templates (Main Menu, Pause Menu, Options, HUD, Loading Screen, Inventory)
 *  - Export / import layouts as JSON
 *  - Layouts are loaded at runtime via engine.ui.loadLayout('name')
 */

import type { EditorApp } from './EditorApp';

// ── Data Types ──────────────────────────────────────────────────────────────

export type UIWidgetType =
  | 'panel' | 'button' | 'label' | 'image' | 'progressbar'
  | 'slider' | 'checkbox' | 'textinput' | 'dropdown' | 'divider'
  | 'icon' | 'list';

export type UIAnchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'
  | 'stretch-x' | 'stretch-y' | 'stretch';

export interface UIWidgetDef {
  id: string;
  type: UIWidgetType;
  name: string;
  parentId: string | null;
  x: number; y: number; width: number; height: number;
  anchor: UIAnchor;
  visible: boolean;
  opacity: number;
  zIndex: number;
  // Style
  bgColor: string;
  bgImage: string;           // data URL or asset path
  bgSize: 'cover' | 'contain' | 'stretch' | 'auto';
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  // Text
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontColor: string;
  textAlign: 'left' | 'center' | 'right';
  // Variable binding  — e.g. "{{health}}" replaces with runtime variable
  textVar: string;
  // Widget-specific
  value: number;             // progressbar %, slider value
  minValue: number;
  maxValue: number;
  placeholder: string;       // textinput
  options: string[];          // dropdown options
  checked: boolean;           // checkbox
  // Events
  onClick: string;           // script function name or blueprint event
  onHover: string;
  onChange: string;
  // Custom CSS classes (for advanced users)
  cssClass: string;
  // Children order
  childIds: string[];
}

export interface UILayoutDef {
  name: string;
  description: string;
  canvasWidth: number;
  canvasHeight: number;
  widgets: UIWidgetDef[];
  variables: Record<string, string | number>;
}

// ── Defaults ────────────────────────────────────────────────────────────────

function defaultWidget(type: UIWidgetType, id: string): UIWidgetDef {
  return {
    id, type, name: type + '_' + id.slice(0, 4),
    parentId: null,
    x: 50, y: 50, width: type === 'divider' ? 200 : 150, height: type === 'divider' ? 2 : 40,
    anchor: 'top-left', visible: true, opacity: 1, zIndex: 0,
    bgColor: type === 'panel' ? 'rgba(0,0,0,0.7)' : type === 'button' ? '#3a5' : 'transparent',
    bgImage: '', bgSize: 'cover',
    borderColor: '#555', borderWidth: type === 'button' || type === 'panel' ? 1 : 0,
    borderRadius: type === 'button' ? 6 : type === 'panel' ? 8 : 0,
    text: type === 'label' ? 'Label' : type === 'button' ? 'Button' : '',
    fontFamily: 'system-ui, sans-serif', fontSize: 14, fontWeight: '400', fontColor: '#ffffff',
    textAlign: 'center',
    textVar: '',
    value: type === 'progressbar' ? 65 : type === 'slider' ? 50 : 0,
    minValue: 0, maxValue: 100,
    placeholder: type === 'textinput' ? 'Type here...' : '',
    options: type === 'dropdown' ? ['Option 1', 'Option 2', 'Option 3'] : [],
    checked: false,
    onClick: '', onHover: '', onChange: '',
    cssClass: '',
    childIds: [],
  };
}

function genId(): string { return Math.random().toString(36).slice(2, 10); }

// ── Templates ───────────────────────────────────────────────────────────────

function templateMainMenu(): UILayoutDef {
  const bg = defaultWidget('panel', genId());
  bg.name = 'Background'; bg.x = 0; bg.y = 0; bg.width = 1920; bg.height = 1080; bg.anchor = 'stretch'; bg.bgColor = 'rgba(10,10,30,0.95)';

  const title = defaultWidget('label', genId());
  title.name = 'Title'; title.x = 960; title.y = 200; title.width = 600; title.height = 80; title.anchor = 'top-center';
  title.text = 'My Game'; title.fontSize = 48; title.fontWeight = '700'; title.parentId = bg.id; bg.childIds.push(title.id);

  const btnPlay = defaultWidget('button', genId());
  btnPlay.name = 'PlayBtn'; btnPlay.x = 960; btnPlay.y = 400; btnPlay.width = 300; btnPlay.height = 55; btnPlay.anchor = 'top-center';
  btnPlay.text = 'Play'; btnPlay.fontSize = 20; btnPlay.onClick = 'onPlay'; btnPlay.parentId = bg.id; bg.childIds.push(btnPlay.id);

  const btnOptions = defaultWidget('button', genId());
  btnOptions.name = 'OptionsBtn'; btnOptions.x = 960; btnOptions.y = 480; btnOptions.width = 300; btnOptions.height = 55; btnOptions.anchor = 'top-center';
  btnOptions.text = 'Options'; btnOptions.fontSize = 20; btnOptions.onClick = 'onOptions'; btnOptions.parentId = bg.id; bg.childIds.push(btnOptions.id);

  const btnQuit = defaultWidget('button', genId());
  btnQuit.name = 'QuitBtn'; btnQuit.x = 960; btnQuit.y = 560; btnQuit.width = 300; btnQuit.height = 55; btnQuit.anchor = 'top-center';
  btnQuit.text = 'Quit'; btnQuit.fontSize = 20; btnQuit.bgColor = '#a33'; btnQuit.onClick = 'onQuit'; btnQuit.parentId = bg.id; bg.childIds.push(btnQuit.id);

  return { name: 'MainMenu', description: 'Main menu template', canvasWidth: 1920, canvasHeight: 1080, widgets: [bg, title, btnPlay, btnOptions, btnQuit], variables: {} };
}

function templateHUD(): UILayoutDef {
  const hpBar = defaultWidget('progressbar', genId());
  hpBar.name = 'HealthBar'; hpBar.x = 20; hpBar.y = 20; hpBar.width = 250; hpBar.height = 28;
  hpBar.bgColor = '#600'; hpBar.fontColor = '#fff'; hpBar.text = '{{health}}/{{maxHealth}}'; hpBar.textVar = 'health'; hpBar.value = 75;

  const mpBar = defaultWidget('progressbar', genId());
  mpBar.name = 'ManaBar'; mpBar.x = 20; mpBar.y = 56; mpBar.width = 200; mpBar.height = 22;
  mpBar.bgColor = '#006'; mpBar.fontColor = '#aaf'; mpBar.text = '{{mana}}/{{maxMana}}'; mpBar.textVar = 'mana'; mpBar.value = 100;

  const scoreLabel = defaultWidget('label', genId());
  scoreLabel.name = 'Score'; scoreLabel.x = 1900; scoreLabel.y = 20; scoreLabel.width = 200; scoreLabel.height = 30;
  scoreLabel.anchor = 'top-right'; scoreLabel.text = 'Score: {{score}}'; scoreLabel.textVar = 'score'; scoreLabel.textAlign = 'right'; scoreLabel.fontSize = 18;

  const miniIcon = defaultWidget('image', genId());
  miniIcon.name = 'CrosshairIcon'; miniIcon.x = 960; miniIcon.y = 540; miniIcon.width = 32; miniIcon.height = 32;
  miniIcon.anchor = 'center'; miniIcon.bgColor = 'transparent'; miniIcon.borderWidth = 0;

  return { name: 'HUD', description: 'In-game HUD template', canvasWidth: 1920, canvasHeight: 1080,
    widgets: [hpBar, mpBar, scoreLabel, miniIcon], variables: { health: 75, maxHealth: 100, mana: 100, maxMana: 100, score: 0 } };
}

function templateOptions(): UILayoutDef {
  const bg = defaultWidget('panel', genId());
  bg.name = 'OptionsPanel'; bg.x = 460; bg.y = 140; bg.width = 1000; bg.height = 800; bg.bgColor = 'rgba(20,20,40,0.95)'; bg.borderRadius = 12;

  const title = defaultWidget('label', genId());
  title.name = 'Title'; title.x = 500; title.y = 30; title.width = 400; title.height = 50;
  title.text = 'Options'; title.fontSize = 32; title.fontWeight = '700'; title.parentId = bg.id; bg.childIds.push(title.id);

  const volLabel = defaultWidget('label', genId());
  volLabel.name = 'VolumeLabel'; volLabel.x = 60; volLabel.y = 120; volLabel.width = 200; volLabel.height = 30;
  volLabel.text = 'Master Volume'; volLabel.textAlign = 'left'; volLabel.parentId = bg.id; bg.childIds.push(volLabel.id);

  const volSlider = defaultWidget('slider', genId());
  volSlider.name = 'VolumeSlider'; volSlider.x = 300; volSlider.y = 120; volSlider.width = 400; volSlider.height = 30;
  volSlider.value = 80; volSlider.onChange = 'onVolumeChange'; volSlider.parentId = bg.id; bg.childIds.push(volSlider.id);

  const sfxLabel = defaultWidget('label', genId());
  sfxLabel.name = 'SFXLabel'; sfxLabel.x = 60; sfxLabel.y = 180; sfxLabel.width = 200; sfxLabel.height = 30;
  sfxLabel.text = 'SFX Volume'; sfxLabel.textAlign = 'left'; sfxLabel.parentId = bg.id; bg.childIds.push(sfxLabel.id);

  const sfxSlider = defaultWidget('slider', genId());
  sfxSlider.name = 'SFXSlider'; sfxSlider.x = 300; sfxSlider.y = 180; sfxSlider.width = 400; sfxSlider.height = 30;
  sfxSlider.value = 100; sfxSlider.onChange = 'onSFXChange'; sfxSlider.parentId = bg.id; bg.childIds.push(sfxSlider.id);

  const fullscreenCb = defaultWidget('checkbox', genId());
  fullscreenCb.name = 'Fullscreen'; fullscreenCb.x = 60; fullscreenCb.y = 260; fullscreenCb.width = 300; fullscreenCb.height = 30;
  fullscreenCb.text = 'Fullscreen'; fullscreenCb.onChange = 'onFullscreenToggle'; fullscreenCb.parentId = bg.id; bg.childIds.push(fullscreenCb.id);

  const resDropdown = defaultWidget('dropdown', genId());
  resDropdown.name = 'Resolution'; resDropdown.x = 60; resDropdown.y = 320; resDropdown.width = 300; resDropdown.height = 36;
  resDropdown.options = ['1920x1080', '1280x720', '2560x1440', '3840x2160']; resDropdown.onChange = 'onResChange';
  resDropdown.parentId = bg.id; bg.childIds.push(resDropdown.id);

  const backBtn = defaultWidget('button', genId());
  backBtn.name = 'BackBtn'; backBtn.x = 400; backBtn.y = 700; backBtn.width = 200; backBtn.height = 50;
  backBtn.text = 'Back'; backBtn.onClick = 'onBack'; backBtn.parentId = bg.id; bg.childIds.push(backBtn.id);

  return { name: 'Options', description: 'Options menu template', canvasWidth: 1920, canvasHeight: 1080,
    widgets: [bg, title, volLabel, volSlider, sfxLabel, sfxSlider, fullscreenCb, resDropdown, backBtn],
    variables: { masterVolume: 80, sfxVolume: 100 } };
}

function templateLoading(): UILayoutDef {
  const bg = defaultWidget('panel', genId());
  bg.name = 'LoadingBg'; bg.x = 0; bg.y = 0; bg.width = 1920; bg.height = 1080; bg.anchor = 'stretch'; bg.bgColor = '#0a0a1a';

  const title = defaultWidget('label', genId());
  title.name = 'LoadingText'; title.x = 960; title.y = 460; title.width = 400; title.height = 50; title.anchor = 'center';
  title.text = 'Loading...'; title.fontSize = 28; title.parentId = bg.id; bg.childIds.push(title.id);

  const bar = defaultWidget('progressbar', genId());
  bar.name = 'LoadingBar'; bar.x = 560; bar.y = 540; bar.width = 800; bar.height = 24;
  bar.value = 0; bar.textVar = 'loadProgress'; bar.text = '{{loadProgress}}%'; bar.bgColor = '#222'; bar.parentId = bg.id; bg.childIds.push(bar.id);

  const tip = defaultWidget('label', genId());
  tip.name = 'Tip'; tip.x = 960; tip.y = 600; tip.width = 600; tip.height = 30; tip.anchor = 'top-center';
  tip.text = '{{loadingTip}}'; tip.textVar = 'loadingTip'; tip.fontSize = 13; tip.fontColor = '#888'; tip.parentId = bg.id; bg.childIds.push(tip.id);

  return { name: 'Loading', description: 'Loading screen template', canvasWidth: 1920, canvasHeight: 1080,
    widgets: [bg, title, bar, tip], variables: { loadProgress: 0, loadingTip: 'Tip: Press W to move forward' } };
}

function templatePauseMenu(): UILayoutDef {
  const overlay = defaultWidget('panel', genId());
  overlay.name = 'PauseOverlay'; overlay.x = 0; overlay.y = 0; overlay.width = 1920; overlay.height = 1080;
  overlay.anchor = 'stretch'; overlay.bgColor = 'rgba(0,0,0,0.6)';

  const box = defaultWidget('panel', genId());
  box.name = 'PauseBox'; box.x = 660; box.y = 290; box.width = 600; box.height = 500;
  box.bgColor = 'rgba(20,20,40,0.95)'; box.borderRadius = 12; box.parentId = overlay.id; overlay.childIds.push(box.id);

  const title = defaultWidget('label', genId());
  title.name = 'PauseTitle'; title.x = 300; title.y = 40; title.width = 300; title.height = 50;
  title.text = 'Paused'; title.fontSize = 36; title.fontWeight = '700'; title.parentId = box.id; box.childIds.push(title.id);

  const resume = defaultWidget('button', genId());
  resume.name = 'ResumeBtn'; resume.x = 150; resume.y = 140; resume.width = 300; resume.height = 55;
  resume.text = 'Resume'; resume.onClick = 'onResume'; resume.parentId = box.id; box.childIds.push(resume.id);

  const options = defaultWidget('button', genId());
  options.name = 'OptionsBtn'; options.x = 150; options.y = 220; options.width = 300; options.height = 55;
  options.text = 'Options'; options.onClick = 'onOptions'; options.parentId = box.id; box.childIds.push(options.id);

  const quit = defaultWidget('button', genId());
  quit.name = 'QuitBtn'; quit.x = 150; quit.y = 300; quit.width = 300; quit.height = 55;
  quit.text = 'Quit to Menu'; quit.bgColor = '#a33'; quit.onClick = 'onQuitToMenu'; quit.parentId = box.id; box.childIds.push(quit.id);

  return { name: 'PauseMenu', description: 'Pause menu template', canvasWidth: 1920, canvasHeight: 1080,
    widgets: [overlay, box, title, resume, options, quit], variables: {} };
}

// ── Widget Palette Defs ─────────────────────────────────────────────────────

const WIDGET_PALETTE: { type: UIWidgetType; icon: string; label: string }[] = [
  { type: 'panel', icon: '▣', label: 'Panel' },
  { type: 'button', icon: '🔘', label: 'Button' },
  { type: 'label', icon: '🅰️', label: 'Label' },
  { type: 'image', icon: '🖼️', label: 'Image' },
  { type: 'progressbar', icon: '📊', label: 'Progress Bar' },
  { type: 'slider', icon: '🎚️', label: 'Slider' },
  { type: 'checkbox', icon: '☑️', label: 'Checkbox' },
  { type: 'textinput', icon: '📝', label: 'Text Input' },
  { type: 'dropdown', icon: '📋', label: 'Dropdown' },
  { type: 'divider', icon: '➖', label: 'Divider' },
];

const TEMPLATES: { name: string; icon: string; factory: () => UILayoutDef }[] = [
  { name: 'Main Menu', icon: '🎮', factory: templateMainMenu },
  { name: 'HUD', icon: '🎯', factory: templateHUD },
  { name: 'Options', icon: '⚙️', factory: templateOptions },
  { name: 'Pause Menu', icon: '⏸️', factory: templatePauseMenu },
  { name: 'Loading Screen', icon: '⏳', factory: templateLoading },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ██ UIEditorPanel
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class UIEditorPanel {
  private editor: EditorApp;
  private container: HTMLElement;
  private layout: UILayoutDef;
  private selectedId: string | null = null;
  private canvasEl!: HTMLDivElement;
  private propsPanel!: HTMLDivElement;
  private hierarchyPanel!: HTMLDivElement;
  private varsPanel!: HTMLDivElement;
  private canvasScale = 0.55;
  private dragState: { widgetId: string; startX: number; startY: number; origX: number; origY: number } | null = null;
  private resizeState: { widgetId: string; handle: string; startX: number; startY: number; origW: number; origH: number; origX: number; origY: number } | null = null;
  private savedLayouts: Map<string, UILayoutDef> = new Map();
  private canvasWrapper!: HTMLDivElement;
  private centerEl!: HTMLDivElement;
  private clipboard: UIWidgetDef | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _initialized = false;

  constructor(editor: EditorApp) {
    this.editor = editor;
    this.container = document.createElement('div');
    this.container.className = 'ui-editor-root';
    this.layout = { name: 'Untitled', description: '', canvasWidth: 1920, canvasHeight: 1080, widgets: [], variables: {} };
    this.loadSavedLayouts();
  }

  // ── Entry ────────────────────────────────────────────────────────────────

  render(): HTMLElement {
    if (this._initialized) {
      this.syncToolbarFields();
      this.refreshAll();
      return this.container;
    }

    this.container.innerHTML = '';
    this.container.style.cssText = 'display:flex;width:100%;height:100%;background:#1a1a2e;color:#ccc;font-family:system-ui,sans-serif;font-size:12px;overflow:hidden;user-select:none;';

    // ─ Left Panel: palette + hierarchy ─
    const left = document.createElement('div');
    left.style.cssText = 'width:220px;border-right:1px solid #333;display:flex;flex-direction:column;flex-shrink:0;overflow-y:auto;';
    this.container.appendChild(left);

    // Toolbar
    left.appendChild(this.buildToolbar());
    // Widget Palette
    left.appendChild(this.buildPalette());
    // Hierarchy
    this.hierarchyPanel = document.createElement('div');
    this.hierarchyPanel.style.cssText = 'flex:1;overflow-y:auto;padding:6px;border-top:1px solid #333;';
    left.appendChild(this.hierarchyPanel);

    // ─ Center: scrollable canvas area ─
    const center = document.createElement('div');
    center.style.cssText = 'flex:1;overflow:auto;position:relative;background:#111;';
    this.centerEl = center;
    this.container.appendChild(center);

    // Scroll-pad: centers canvas when small, scrolls when large
    const scrollPad = document.createElement('div');
    scrollPad.style.cssText = 'min-width:100%;min-height:100%;display:flex;align-items:center;justify-content:center;padding:60px;box-sizing:border-box;';
    center.appendChild(scrollPad);

    this.canvasWrapper = document.createElement('div');
    this.canvasWrapper.style.cssText = 'position:relative;box-shadow:0 0 40px rgba(0,0,0,0.8);flex-shrink:0;';
    this.canvasWrapper.style.width = (this.layout.canvasWidth * this.canvasScale) + 'px';
    this.canvasWrapper.style.height = (this.layout.canvasHeight * this.canvasScale) + 'px';
    scrollPad.appendChild(this.canvasWrapper);

    this.canvasEl = document.createElement('div');
    this.canvasEl.style.cssText = `width:${this.layout.canvasWidth}px;height:${this.layout.canvasHeight}px;position:relative;background:#0a0a1a;transform-origin:top left;transform:scale(${this.canvasScale});`;
    this.canvasWrapper.appendChild(this.canvasEl);

    // Ctrl+Wheel = zoom, regular wheel = native scroll/pan
    center.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        this.canvasScale = Math.max(0.15, Math.min(1.5, this.canvasScale + (e.deltaY > 0 ? -0.05 : 0.05)));
        this.canvasEl.style.transform = `scale(${this.canvasScale})`;
        this.canvasWrapper.style.width = (this.layout.canvasWidth * this.canvasScale) + 'px';
        this.canvasWrapper.style.height = (this.layout.canvasHeight * this.canvasScale) + 'px';
      }
    }, { passive: false });

    // Middle-mouse-button drag to pan
    center.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const scrollX = center.scrollLeft, scrollY = center.scrollTop;
        const onMove = (ev: MouseEvent) => {
          center.scrollLeft = scrollX - (ev.clientX - startX);
          center.scrollTop = scrollY - (ev.clientY - startY);
        };
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }
    });

    // ─ Right Panel: properties + variables ─
    const right = document.createElement('div');
    right.style.cssText = 'width:280px;border-left:1px solid #333;display:flex;flex-direction:column;flex-shrink:0;overflow-y:auto;';
    this.container.appendChild(right);

    this.propsPanel = document.createElement('div');
    this.propsPanel.style.cssText = 'flex:1;overflow-y:auto;padding:8px;';
    right.appendChild(this.propsPanel);

    this.varsPanel = document.createElement('div');
    this.varsPanel.style.cssText = 'border-top:1px solid #333;padding:8px;max-height:200px;overflow-y:auto;';
    right.appendChild(this.varsPanel);

    // Click empty canvas deselect
    this.canvasEl.addEventListener('mousedown', (e) => {
      if (e.target === this.canvasEl) { this.selectedId = null; this.refreshAll(); }
    });

    // Keyboard shortcuts (Delete, Ctrl+C/V/D)
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this.container.offsetParent) return;
      // Don't intercept when typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Delete' && this.selectedId) {
        this.removeWidget(this.selectedId); e.preventDefault();
      }
      if (e.ctrlKey && e.key === 'c' && this.selectedId) {
        const w = this.findWidget(this.selectedId);
        if (w) this.clipboard = JSON.parse(JSON.stringify(w));
        e.preventDefault();
      }
      if (e.ctrlKey && e.key === 'v' && this.clipboard) {
        const clone: UIWidgetDef = JSON.parse(JSON.stringify(this.clipboard));
        clone.id = genId(); clone.name = clone.name + '_paste';
        clone.x += 30; clone.y += 30; clone.childIds = []; clone.parentId = null;
        this.layout.widgets.push(clone);
        this.selectedId = clone.id; this.refreshAll(); e.preventDefault();
      }
      if (e.ctrlKey && e.key === 'd' && this.selectedId) {
        this.duplicateWidget(this.selectedId); e.preventDefault();
      }
    };
    document.addEventListener('keydown', this._keyHandler);

    this._initialized = true;
    this.syncToolbarFields();
    this.refreshAll();
    return this.container;
  }

  private syncToolbarFields(): void {
    const nameInput = this.container.querySelector('[data-field="layout-name"]') as HTMLInputElement | null;
    const widthInput = this.container.querySelector('[data-field="canvas-w"]') as HTMLInputElement | null;
    const heightInput = this.container.querySelector('[data-field="canvas-h"]') as HTMLInputElement | null;
    if (nameInput) nameInput.value = this.layout.name;
    if (widthInput) widthInput.value = String(this.layout.canvasWidth);
    if (heightInput) heightInput.value = String(this.layout.canvasHeight);
  }

  dispose(): void {
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    this._initialized = false;
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────

  private buildToolbar(): HTMLElement {
    const bar = document.createElement('div');
    bar.style.cssText = 'padding:8px;border-bottom:1px solid #333;display:flex;flex-direction:column;gap:4px;';

    bar.innerHTML = `
      <div style="font-size:14px;font-weight:600;margin-bottom:4px;">🎨 UI Editor</div>
      <div style="display:flex;gap:3px;flex-wrap:wrap;">
        <button class="uie-btn uie-primary" data-action="new">New</button>
        <button class="uie-btn" data-action="save">Save</button>
        <button class="uie-btn" data-action="load">Load</button>
        <button class="uie-btn" data-action="export">Export</button>
        <button class="uie-btn" data-action="import">Import</button>
      </div>
      <div style="margin-top:4px;">
        <label style="font-size:10px;color:#888;">Templates</label>
        <div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:2px;" data-container="templates"></div>
      </div>
      <div style="margin-top:4px;">
        <label style="font-size:10px;color:#888;">Layout Name</label>
        <input type="text" data-field="layout-name" value="${this.layout.name}"
          style="width:100%;padding:3px 6px;background:#222;border:1px solid #444;color:#fff;border-radius:4px;font-size:11px;margin-top:2px;" />
      </div>
      <div style="margin-top:2px;">
        <label style="font-size:10px;color:#888;">Canvas</label>
        <div style="display:flex;gap:4px;align-items:center;margin-top:2px;">
          <input type="number" data-field="canvas-w" value="${this.layout.canvasWidth}" style="width:60px;padding:2px;background:#222;border:1px solid #444;color:#fff;border-radius:3px;font-size:10px;" />
          <span style="font-size:10px;">×</span>
          <input type="number" data-field="canvas-h" value="${this.layout.canvasHeight}" style="width:60px;padding:2px;background:#222;border:1px solid #444;color:#fff;border-radius:3px;font-size:10px;" />
        </div>
      </div>
      <div style="display:flex;gap:3px;margin-top:4px;">
        <button class="uie-btn" data-action="import-image" title="Import image for use in widgets">📷 Add Image</button>
        <button class="uie-btn" data-action="preview" title="Preview in browser">▶ Preview</button>
      </div>
      <style>
        .uie-btn { padding:3px 8px;background:#333;border:1px solid #555;color:#ccc;border-radius:4px;cursor:pointer;font-size:10px; }
        .uie-btn:hover { background:#444; }
        .uie-primary { background:#2a6;color:#fff;border-color:#2a6; }
        .uie-primary:hover { background:#3b7; }
        .uie-widget-el { position:absolute;box-sizing:border-box;cursor:move;outline:none; }
        .uie-widget-el.selected { outline:2px solid #4af !important; }
        .uie-widget-el .uie-resize { position:absolute;width:8px;height:8px;background:#4af;border:1px solid #fff;z-index:999; }
        .uie-widget-el .uie-resize.nw { top:-4px;left:-4px;cursor:nw-resize; }
        .uie-widget-el .uie-resize.ne { top:-4px;right:-4px;cursor:ne-resize; }
        .uie-widget-el .uie-resize.sw { bottom:-4px;left:-4px;cursor:sw-resize; }
        .uie-widget-el .uie-resize.se { bottom:-4px;right:-4px;cursor:se-resize; }
        .uie-hier-item { padding:3px 6px;cursor:pointer;border-radius:3px;font-size:11px;display:flex;align-items:center;gap:4px; }
        .uie-hier-item:hover { background:#333; }
        .uie-hier-item.selected { background:#2a6;color:#fff; }
        .uie-prop-row { display:flex;align-items:center;gap:6px;margin-bottom:4px; }
        .uie-prop-row label { width:80px;font-size:10px;color:#999;flex-shrink:0; }
        .uie-prop-row input, .uie-prop-row select, .uie-prop-row textarea { flex:1;padding:2px 4px;background:#222;border:1px solid #444;color:#fff;border-radius:3px;font-size:11px; }
        .uie-prop-row input[type="color"] { width:30px;height:22px;padding:0;border:none;cursor:pointer; }
        .uie-prop-row input[type="checkbox"] { flex:none;width:16px;height:16px; }
      </style>
    `;

    // Template buttons
    const tplContainer = bar.querySelector('[data-container="templates"]')!;
    for (const tpl of TEMPLATES) {
      const btn = document.createElement('button');
      btn.className = 'uie-btn';
      btn.textContent = tpl.icon + ' ' + tpl.name;
      btn.title = 'Load ' + tpl.name + ' template';
      btn.onclick = () => { this.layout = tpl.factory(); this.selectedId = null; this.refreshAll(); };
      tplContainer.appendChild(btn);
    }

    // Actions
    bar.querySelector('[data-action="new"]')?.addEventListener('click', () => {
      this.layout = { name: 'Untitled', description: '', canvasWidth: 1920, canvasHeight: 1080, widgets: [], variables: {} };
      this.selectedId = null; this.refreshAll();
    });

    bar.querySelector('[data-action="save"]')?.addEventListener('click', () => this.saveLayout());
    bar.querySelector('[data-action="load"]')?.addEventListener('click', () => this.showLoadDialog());
    bar.querySelector('[data-action="export"]')?.addEventListener('click', () => this.exportJSON());
    bar.querySelector('[data-action="import"]')?.addEventListener('click', () => this.importJSON());
    bar.querySelector('[data-action="import-image"]')?.addEventListener('click', () => this.importImage());
    bar.querySelector('[data-action="preview"]')?.addEventListener('click', () => this.openPreview());

    bar.querySelector('[data-field="layout-name"]')?.addEventListener('change', (e) => {
      this.layout.name = (e.target as HTMLInputElement).value;
    });
    bar.querySelector('[data-field="canvas-w"]')?.addEventListener('change', (e) => {
      this.layout.canvasWidth = parseInt((e.target as HTMLInputElement).value) || 1920;
      this.refreshAll();
    });
    bar.querySelector('[data-field="canvas-h"]')?.addEventListener('change', (e) => {
      this.layout.canvasHeight = parseInt((e.target as HTMLInputElement).value) || 1080;
      this.refreshAll();
    });

    return bar;
  }

  // ── Palette ──────────────────────────────────────────────────────────────

  private buildPalette(): HTMLElement {
    const pal = document.createElement('div');
    pal.style.cssText = 'padding:6px;border-bottom:1px solid #333;';
    pal.innerHTML = '<div style="font-size:10px;color:#888;margin-bottom:4px;">Widgets (click to add)</div>';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:3px;';
    for (const wp of WIDGET_PALETTE) {
      const btn = document.createElement('button');
      btn.className = 'uie-btn';
      btn.style.cssText = 'text-align:left;padding:4px 6px;';
      btn.textContent = wp.icon + ' ' + wp.label;
      btn.onclick = () => this.addWidget(wp.type);
      grid.appendChild(btn);
    }
    pal.appendChild(grid);
    return pal;
  }

  // ── Add / Remove Widget ──────────────────────────────────────────────────

  private addWidget(type: UIWidgetType): void {
    const w = defaultWidget(type, genId());
    // If there's a selected panel, make it a child
    if (this.selectedId) {
      const parent = this.findWidget(this.selectedId);
      if (parent && parent.type === 'panel') {
        w.parentId = parent.id;
        parent.childIds.push(w.id);
        w.x = 20; w.y = 20 + parent.childIds.length * 50;
      }
    }
    this.layout.widgets.push(w);
    this.selectedId = w.id;
    this.refreshAll();
  }

  private removeWidget(id: string): void {
    const w = this.findWidget(id);
    if (!w) return;
    // Remove from parent's childIds
    if (w.parentId) {
      const parent = this.findWidget(w.parentId);
      if (parent) parent.childIds = parent.childIds.filter(c => c !== id);
    }
    // Recursively remove children
    for (const cid of w.childIds) this.removeWidget(cid);
    this.layout.widgets = this.layout.widgets.filter(ww => ww.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.refreshAll();
  }

  private duplicateWidget(id: string): void {
    const w = this.findWidget(id);
    if (!w) return;
    const clone: UIWidgetDef = JSON.parse(JSON.stringify(w));
    clone.id = genId();
    clone.name = w.name + '_copy';
    clone.x += 20;
    clone.y += 20;
    clone.childIds = [];
    this.layout.widgets.push(clone);
    if (clone.parentId) {
      const parent = this.findWidget(clone.parentId);
      if (parent) parent.childIds.push(clone.id);
    }
    this.selectedId = clone.id;
    this.refreshAll();
  }

  private findWidget(id: string): UIWidgetDef | undefined {
    return this.layout.widgets.find(w => w.id === id);
  }

  // ── Refresh All Views ────────────────────────────────────────────────────

  private refreshAll(): void {
    this.renderCanvas();
    this.renderHierarchy();
    this.renderProperties();
    this.renderVariables();
  }

  // ── Canvas Render ────────────────────────────────────────────────────────

  private renderCanvas(): void {
    this.canvasEl.innerHTML = '';
    this.canvasEl.style.width = this.layout.canvasWidth + 'px';
    this.canvasEl.style.height = this.layout.canvasHeight + 'px';
    this.canvasEl.style.transform = `scale(${this.canvasScale})`;
    // Sync wrapper dimensions to fix ghosting / resolution change visual bugs
    if (this.canvasWrapper) {
      this.canvasWrapper.style.width = (this.layout.canvasWidth * this.canvasScale) + 'px';
      this.canvasWrapper.style.height = (this.layout.canvasHeight * this.canvasScale) + 'px';
    }

    // Render root widgets (no parent), then children recursively
    const rootWidgets = this.layout.widgets.filter(w => !w.parentId);
    for (const w of rootWidgets) {
      this.renderWidgetOnCanvas(w, this.canvasEl);
    }
  }

  private renderWidgetOnCanvas(w: UIWidgetDef, parent: HTMLElement): void {
    const el = document.createElement('div');
    el.className = 'uie-widget-el' + (this.selectedId === w.id ? ' selected' : '');
    el.dataset.widgetId = w.id;

    // Position & size
    el.style.left = w.x + 'px';
    el.style.top = w.y + 'px';
    el.style.width = w.width + 'px';
    el.style.height = w.height + 'px';
    el.style.zIndex = String(w.zIndex);
    el.style.opacity = String(w.opacity);
    if (!w.visible) el.style.display = 'none';

    // Style
    el.style.backgroundColor = w.bgColor;
    if (w.bgImage) {
      el.style.backgroundImage = `url(${w.bgImage})`;
      el.style.backgroundSize = w.bgSize === 'stretch' ? '100% 100%' : w.bgSize;
      el.style.backgroundPosition = 'center';
      el.style.backgroundRepeat = 'no-repeat';
    }
    if (w.borderWidth) el.style.border = `${w.borderWidth}px solid ${w.borderColor}`;
    if (w.borderRadius) el.style.borderRadius = w.borderRadius + 'px';

    // Content based on type
    el.appendChild(this.buildWidgetContent(w));

    // Drag to move
    el.addEventListener('mousedown', (e) => this.onWidgetMouseDown(e, w.id));

    // Resize handles (only when selected)
    if (this.selectedId === w.id) {
      for (const corner of ['nw', 'ne', 'sw', 'se']) {
        const handle = document.createElement('div');
        handle.className = `uie-resize ${corner}`;
        handle.addEventListener('mousedown', (e) => { e.stopPropagation(); this.startResize(e, w.id, corner); });
        el.appendChild(handle);
      }
    }

    parent.appendChild(el);

    // Render children inside this element
    for (const cid of w.childIds) {
      const child = this.findWidget(cid);
      if (child) this.renderWidgetOnCanvas(child, el);
    }
  }

  private buildWidgetContent(w: UIWidgetDef): HTMLElement {
    const content = document.createElement('div');
    content.style.cssText = `width:100%;height:100%;display:flex;align-items:center;justify-content:${w.textAlign === 'left' ? 'flex-start' : w.textAlign === 'right' ? 'flex-end' : 'center'};padding:4px 8px;box-sizing:border-box;overflow:hidden;pointer-events:none;`;
    content.style.fontFamily = w.fontFamily;
    content.style.fontSize = w.fontSize + 'px';
    content.style.fontWeight = w.fontWeight;
    content.style.color = w.fontColor;

    switch (w.type) {
      case 'label':
        content.textContent = w.text || 'Label';
        break;
      case 'button':
        content.textContent = w.text || 'Button';
        content.style.cursor = 'pointer';
        content.style.justifyContent = 'center';
        break;
      case 'image':
        if (w.bgImage) {
          content.innerHTML = '';
        } else {
          content.innerHTML = '<span style="color:#666;font-size:20px;">🖼️</span>';
          content.style.justifyContent = 'center';
        }
        break;
      case 'progressbar': {
        content.style.padding = '0'; content.style.position = 'relative'; content.style.flexDirection = 'column';
        const track = document.createElement('div');
        track.style.cssText = `position:absolute;left:0;top:0;height:100%;width:${w.value}%;background:linear-gradient(90deg,#2a6,#4c8);border-radius:${w.borderRadius}px;transition:width 0.3s;`;
        const txt = document.createElement('div');
        txt.style.cssText = 'position:relative;z-index:1;width:100%;text-align:center;font-size:11px;';
        txt.textContent = w.text || `${Math.round(w.value)}%`;
        content.appendChild(track); content.appendChild(txt);
        break;
      }
      case 'slider': {
        content.style.padding = '0'; content.style.flexDirection = 'column'; content.style.justifyContent = 'center';
        const slider = document.createElement('input');
        slider.type = 'range'; slider.min = String(w.minValue); slider.max = String(w.maxValue); slider.value = String(w.value);
        slider.style.cssText = 'width:90%;pointer-events:none;';
        content.appendChild(slider);
        break;
      }
      case 'checkbox': {
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = w.checked;
        cb.style.cssText = 'pointer-events:none;margin-right:6px;';
        const lbl = document.createElement('span'); lbl.textContent = w.text || 'Checkbox';
        content.style.justifyContent = 'flex-start';
        content.appendChild(cb); content.appendChild(lbl);
        break;
      }
      case 'textinput': {
        const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = w.placeholder;
        inp.style.cssText = 'width:100%;padding:4px;background:#1a1a2e;border:1px solid #555;color:#fff;border-radius:4px;pointer-events:none;font-size:12px;';
        content.appendChild(inp);
        break;
      }
      case 'dropdown': {
        const sel = document.createElement('select');
        sel.style.cssText = 'width:100%;padding:4px;background:#1a1a2e;border:1px solid #555;color:#fff;border-radius:4px;pointer-events:none;font-size:12px;';
        for (const opt of w.options) { const o = document.createElement('option'); o.textContent = opt; sel.appendChild(o); }
        content.appendChild(sel);
        break;
      }
      case 'divider':
        content.style.padding = '0';
        content.innerHTML = `<div style="width:100%;height:100%;background:${w.borderColor || '#444'};"></div>`;
        break;
      case 'panel':
        // Panels are just containers, show faint label
        if (w.text) {
          const lbl = document.createElement('div');
          lbl.style.cssText = 'position:absolute;top:4px;left:8px;font-size:10px;color:#888;pointer-events:none;';
          lbl.textContent = w.text; content.appendChild(lbl);
        }
        break;
    }
    return content;
  }

  // ── Drag / Resize ─────────────────────────────────────────────────────────

  private onWidgetMouseDown(e: MouseEvent, id: string): void {
    e.stopPropagation();
    this.selectedId = id;
    this.refreshAll();

    const w = this.findWidget(id);
    if (!w) return;
    this.dragState = { widgetId: id, startX: e.clientX, startY: e.clientY, origX: w.x, origY: w.y };

    const onMove = (ev: MouseEvent) => {
      if (!this.dragState) return;
      const dx = (ev.clientX - this.dragState.startX) / this.canvasScale;
      const dy = (ev.clientY - this.dragState.startY) / this.canvasScale;
      const ww = this.findWidget(this.dragState.widgetId);
      if (ww) { ww.x = Math.round(this.dragState.origX + dx); ww.y = Math.round(this.dragState.origY + dy); this.renderCanvas(); }
    };
    const onUp = () => { this.dragState = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); this.refreshAll(); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  private startResize(e: MouseEvent, id: string, handle: string): void {
    const w = this.findWidget(id);
    if (!w) return;
    this.resizeState = { widgetId: id, handle, startX: e.clientX, startY: e.clientY, origW: w.width, origH: w.height, origX: w.x, origY: w.y };

    const onMove = (ev: MouseEvent) => {
      if (!this.resizeState) return;
      const dx = (ev.clientX - this.resizeState.startX) / this.canvasScale;
      const dy = (ev.clientY - this.resizeState.startY) / this.canvasScale;
      const ww = this.findWidget(this.resizeState.widgetId);
      if (!ww) return;

      if (this.resizeState.handle.includes('e')) ww.width = Math.max(10, Math.round(this.resizeState.origW + dx));
      if (this.resizeState.handle.includes('s')) ww.height = Math.max(10, Math.round(this.resizeState.origH + dy));
      if (this.resizeState.handle.includes('w')) { ww.x = Math.round(this.resizeState.origX + dx); ww.width = Math.max(10, Math.round(this.resizeState.origW - dx)); }
      if (this.resizeState.handle.includes('n')) { ww.y = Math.round(this.resizeState.origY + dy); ww.height = Math.max(10, Math.round(this.resizeState.origH - dy)); }
      this.renderCanvas();
    };
    const onUp = () => { this.resizeState = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); this.refreshAll(); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Hierarchy ────────────────────────────────────────────────────────────

  private renderHierarchy(): void {
    this.hierarchyPanel.innerHTML = '<div style="font-size:10px;color:#888;margin-bottom:4px;">Hierarchy</div>';
    const roots = this.layout.widgets.filter(w => !w.parentId);
    for (const w of roots) this.renderHierarchyItem(w, this.hierarchyPanel, 0);
  }

  private renderHierarchyItem(w: UIWidgetDef, parent: HTMLElement, depth: number): void {
    const item = document.createElement('div');
    item.className = 'uie-hier-item' + (this.selectedId === w.id ? ' selected' : '');
    item.style.paddingLeft = (6 + depth * 14) + 'px';
    const typeIcon = WIDGET_PALETTE.find(p => p.type === w.type)?.icon ?? '?';
    item.innerHTML = `<span>${typeIcon}</span> <span style="flex:1;">${w.name}</span>`;
    item.onclick = () => { this.selectedId = w.id; this.refreshAll(); };

    // Context menu
    item.oncontextmenu = (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY, w.id);
    };

    parent.appendChild(item);
    for (const cid of w.childIds) {
      const child = this.findWidget(cid);
      if (child) this.renderHierarchyItem(child, parent, depth + 1);
    }
  }

  private showContextMenu(x: number, y: number, widgetId: string): void {
    const existing = document.querySelector('.uie-ctx-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'uie-ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:#2a2a3a;border:1px solid #555;border-radius:6px;padding:4px 0;z-index:9999;min-width:120px;box-shadow:0 4px 12px rgba(0,0,0,0.5);`;

    const items = [
      { label: '📋 Duplicate', action: () => this.duplicateWidget(widgetId) },
      { label: '⬆ Move Up', action: () => this.moveWidgetOrder(widgetId, -1) },
      { label: '⬇ Move Down', action: () => this.moveWidgetOrder(widgetId, 1) },
      { label: '🗑️ Delete', action: () => this.removeWidget(widgetId) },
    ];

    for (const it of items) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:5px 12px;cursor:pointer;font-size:11px;color:#ccc;';
      row.textContent = it.label;
      row.onmouseenter = () => { row.style.background = '#3a3a5a'; };
      row.onmouseleave = () => { row.style.background = 'transparent'; };
      row.onclick = () => { menu.remove(); it.action(); };
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    const close = (e: Event) => {
      if (menu.contains(e.target as Node)) return; // Don't close when clicking inside menu
      menu.remove(); document.removeEventListener('mousedown', close);
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
  }

  private moveWidgetOrder(id: string, dir: number): void {
    const idx = this.layout.widgets.findIndex(w => w.id === id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= this.layout.widgets.length) return;
    const tmp = this.layout.widgets[idx];
    this.layout.widgets[idx] = this.layout.widgets[newIdx];
    this.layout.widgets[newIdx] = tmp;
    this.refreshAll();
  }

  // ── Properties Panel ─────────────────────────────────────────────────────

  private renderProperties(): void {
    this.propsPanel.innerHTML = '';
    if (!this.selectedId) {
      this.propsPanel.innerHTML = '<div style="color:#666;padding:20px;text-align:center;font-size:11px;">Select a widget to edit properties</div>';
      return;
    }
    const w = this.findWidget(this.selectedId);
    if (!w) return;

    const h = (label: string) => {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:10px;color:#4af;margin:8px 0 4px;font-weight:600;border-bottom:1px solid #333;padding-bottom:2px;';
      d.textContent = label;
      return d;
    };

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:6px;';
    const typeIcon = WIDGET_PALETTE.find(p => p.type === w.type)?.icon ?? '?';
    header.textContent = `${typeIcon} ${w.type.toUpperCase()}`;
    this.propsPanel.appendChild(header);

    // Identity
    this.propsPanel.appendChild(h('Identity'));
    this.propsPanel.appendChild(this.propRow('Name', 'text', w.name, v => { w.name = v as string; this.renderHierarchy(); }));
    this.propsPanel.appendChild(this.propRow('ID', 'text', w.id, () => {}, true));
    this.propsPanel.appendChild(this.propRow('Visible', 'checkbox', w.visible, v => { w.visible = v as boolean; this.renderCanvas(); }));

    // Transform
    this.propsPanel.appendChild(h('Transform'));
    this.propsPanel.appendChild(this.propRow('X', 'number', w.x, v => { w.x = v as number; this.renderCanvas(); }));
    this.propsPanel.appendChild(this.propRow('Y', 'number', w.y, v => { w.y = v as number; this.renderCanvas(); }));
    this.propsPanel.appendChild(this.propRow('Width', 'number', w.width, v => { w.width = Math.max(10, v as number); this.renderCanvas(); }));
    this.propsPanel.appendChild(this.propRow('Height', 'number', w.height, v => { w.height = Math.max(10, v as number); this.renderCanvas(); }));
    this.propsPanel.appendChild(this.propRow('Anchor', 'select', w.anchor, v => { w.anchor = v as UIAnchor; }, false,
      ['top-left','top-center','top-right','center-left','center','center-right','bottom-left','bottom-center','bottom-right','stretch-x','stretch-y','stretch']));
    this.propsPanel.appendChild(this.propRow('Z-Index', 'number', w.zIndex, v => { w.zIndex = v as number; this.renderCanvas(); }));
    this.propsPanel.appendChild(this.propRow('Opacity', 'range', w.opacity, v => { w.opacity = v as number; this.renderCanvas(); }, false, undefined, { min: 0, max: 1, step: 0.05 }));

    // Appearance
    this.propsPanel.appendChild(h('Appearance'));
    this.propsPanel.appendChild(this.propRow('BG Color', 'color', w.bgColor, v => { w.bgColor = v as string; this.renderCanvas(); }));
    this.propsPanel.appendChild(this.propRow('BG Image', 'text', w.bgImage ? '(set)' : '', () => this.pickImageForWidget(w), true));
    this.propsPanel.appendChild(this.propRowBtn('Set BG Image', () => this.pickImageForWidget(w)));
    if (w.bgImage) this.propsPanel.appendChild(this.propRowBtn('Clear BG Image', () => { w.bgImage = ''; this.refreshAll(); }));
    this.propsPanel.appendChild(this.propRow('BG Size', 'select', w.bgSize, v => { w.bgSize = v as any; this.renderCanvas(); }, false, ['cover','contain','stretch','auto']));
    this.propsPanel.appendChild(this.propRow('Border Color', 'color', w.borderColor, v => { w.borderColor = v as string; this.renderCanvas(); }));
    this.propsPanel.appendChild(this.propRow('Border Width', 'number', w.borderWidth, v => { w.borderWidth = v as number; this.renderCanvas(); }));
    this.propsPanel.appendChild(this.propRow('Border Radius', 'number', w.borderRadius, v => { w.borderRadius = v as number; this.renderCanvas(); }));

    // Text (for types that have text)
    if (['label', 'button', 'checkbox', 'panel', 'progressbar'].includes(w.type)) {
      this.propsPanel.appendChild(h('Text'));
      this.propsPanel.appendChild(this.propRow('Text', 'text', w.text, v => { w.text = v as string; this.renderCanvas(); }));
      this.propsPanel.appendChild(this.propRow('Font', 'text', w.fontFamily, v => { w.fontFamily = v as string; this.renderCanvas(); }));
      this.propsPanel.appendChild(this.propRow('Size', 'number', w.fontSize, v => { w.fontSize = v as number; this.renderCanvas(); }));
      this.propsPanel.appendChild(this.propRow('Weight', 'select', w.fontWeight, v => { w.fontWeight = v as string; this.renderCanvas(); }, false, ['300','400','500','600','700','900']));
      this.propsPanel.appendChild(this.propRow('Color', 'color', w.fontColor, v => { w.fontColor = v as string; this.renderCanvas(); }));
      this.propsPanel.appendChild(this.propRow('Align', 'select', w.textAlign, v => { w.textAlign = v as any; this.renderCanvas(); }, false, ['left','center','right']));
    }

    // Variable binding
    this.propsPanel.appendChild(h('Data Binding'));
    this.propsPanel.appendChild(this.propRow('Text Var', 'text', w.textVar, v => { w.textVar = v as string; }));
    const varHelp = document.createElement('div');
    varHelp.style.cssText = 'font-size:9px;color:#666;padding:2px 0;';
    varHelp.textContent = 'Use {{varName}} in text. Var name auto-links at runtime.';
    this.propsPanel.appendChild(varHelp);

    // Widget-specific
    if (w.type === 'progressbar' || w.type === 'slider') {
      this.propsPanel.appendChild(h('Value'));
      this.propsPanel.appendChild(this.propRow('Value', 'number', w.value, v => { w.value = v as number; this.renderCanvas(); }));
      this.propsPanel.appendChild(this.propRow('Min', 'number', w.minValue, v => { w.minValue = v as number; }));
      this.propsPanel.appendChild(this.propRow('Max', 'number', w.maxValue, v => { w.maxValue = v as number; }));
    }
    if (w.type === 'textinput') {
      this.propsPanel.appendChild(h('Input'));
      this.propsPanel.appendChild(this.propRow('Placeholder', 'text', w.placeholder, v => { w.placeholder = v as string; this.renderCanvas(); }));
    }
    if (w.type === 'dropdown') {
      this.propsPanel.appendChild(h('Options'));
      this.propsPanel.appendChild(this.propRow('Options', 'textarea', w.options.join('\n'), v => { w.options = (v as string).split('\n').filter(Boolean); this.renderCanvas(); }));
    }
    if (w.type === 'checkbox') {
      this.propsPanel.appendChild(this.propRow('Checked', 'checkbox', w.checked, v => { w.checked = v as boolean; this.renderCanvas(); }));
    }

    // Events
    this.propsPanel.appendChild(h('Events'));
    this.propsPanel.appendChild(this.propRow('onClick', 'text', w.onClick, v => { w.onClick = v as string; }));
    this.propsPanel.appendChild(this.propRow('onHover', 'text', w.onHover, v => { w.onHover = v as string; }));
    this.propsPanel.appendChild(this.propRow('onChange', 'text', w.onChange, v => { w.onChange = v as string; }));
    const evHelp = document.createElement('div');
    evHelp.style.cssText = 'font-size:9px;color:#666;padding:2px 0;';
    evHelp.textContent = 'Function name from your scripts or blueprint event.';
    this.propsPanel.appendChild(evHelp);

    // CSS class (advanced)
    this.propsPanel.appendChild(h('Advanced'));
    this.propsPanel.appendChild(this.propRow('CSS Class', 'text', w.cssClass, v => { w.cssClass = v as string; }));

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'uie-btn';
    delBtn.style.cssText = 'width:100%;margin-top:12px;background:#a33;color:#fff;border-color:#a33;padding:6px;';
    delBtn.textContent = '🗑️ Delete Widget';
    delBtn.onclick = () => this.removeWidget(w.id);
    this.propsPanel.appendChild(delBtn);
  }

  private propRow(label: string, type: string, value: any, onChange: (v: any) => void, disabled = false, options?: string[], range?: { min: number; max: number; step: number }): HTMLElement {
    const row = document.createElement('div');
    row.className = 'uie-prop-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    row.appendChild(lbl);

    if (type === 'select' && options) {
      const sel = document.createElement('select');
      for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt; if (opt === String(value)) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => onChange(sel.value);
      if (disabled) sel.disabled = true;
      row.appendChild(sel);
    } else if (type === 'checkbox') {
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !!value;
      cb.onchange = () => onChange(cb.checked);
      if (disabled) cb.disabled = true;
      row.appendChild(cb);
    } else if (type === 'color') {
      const ci = document.createElement('input');
      ci.type = 'color';
      // Convert rgba/named to hex for color input
      ci.value = this.toHex(value);
      ci.oninput = () => onChange(ci.value);
      row.appendChild(ci);
      // Also show text
      const ti = document.createElement('input');
      ti.type = 'text'; ti.value = value;
      ti.style.cssText = 'width:80px;';
      ti.onchange = () => { onChange(ti.value); ci.value = this.toHex(ti.value); };
      row.appendChild(ti);
    } else if (type === 'textarea') {
      const ta = document.createElement('textarea');
      ta.value = value; ta.rows = 3;
      ta.style.cssText = 'flex:1;padding:4px;background:#222;border:1px solid #444;color:#fff;border-radius:3px;font-size:11px;resize:vertical;';
      ta.onchange = () => onChange(ta.value);
      row.appendChild(ta);
    } else if (type === 'range') {
      const ri = document.createElement('input');
      ri.type = 'range';
      ri.min = String(range?.min ?? 0); ri.max = String(range?.max ?? 100); ri.step = String(range?.step ?? 1);
      ri.value = String(value);
      const disp = document.createElement('span');
      disp.style.cssText = 'font-size:10px;width:30px;text-align:right;';
      disp.textContent = String(value);
      ri.oninput = () => { onChange(parseFloat(ri.value)); disp.textContent = ri.value; };
      row.appendChild(ri); row.appendChild(disp);
    } else {
      const inp = document.createElement('input');
      inp.type = type === 'number' ? 'number' : 'text';
      inp.value = String(value);
      inp.onchange = () => onChange(type === 'number' ? parseFloat(inp.value) || 0 : inp.value);
      if (disabled) inp.disabled = true;
      row.appendChild(inp);
    }
    return row;
  }

  private propRowBtn(label: string, onClick: () => void): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:4px;';
    const btn = document.createElement('button');
    btn.className = 'uie-btn';
    btn.style.cssText = 'width:100%;';
    btn.textContent = label;
    btn.onclick = onClick;
    row.appendChild(btn);
    return row;
  }

  private toHex(color: string): string {
    if (color.startsWith('#') && (color.length === 7 || color.length === 4)) return color;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // ── Variables Panel ──────────────────────────────────────────────────────

  private renderVariables(): void {
    this.varsPanel.innerHTML = '';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:10px;color:#4af;font-weight:600;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;';
    title.innerHTML = '<span>Variables</span>';
    const addBtn = document.createElement('button');
    addBtn.className = 'uie-btn';
    addBtn.textContent = '+ Add';
    addBtn.onclick = () => { this.layout.variables['newVar'] = ''; this.renderVariables(); };
    title.appendChild(addBtn);
    this.varsPanel.appendChild(title);

    for (const [key, val] of Object.entries(this.layout.variables)) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;margin-bottom:3px;align-items:center;';
      const nameInp = document.createElement('input');
      nameInp.style.cssText = 'width:70px;padding:2px 4px;background:#222;border:1px solid #444;color:#fff;border-radius:3px;font-size:10px;';
      nameInp.value = key;
      nameInp.onchange = () => {
        const newKey = nameInp.value.trim();
        if (newKey && newKey !== key) {
          this.layout.variables[newKey] = this.layout.variables[key];
          delete this.layout.variables[key];
          this.renderVariables();
        }
      };
      const valInp = document.createElement('input');
      valInp.style.cssText = 'flex:1;padding:2px 4px;background:#222;border:1px solid #444;color:#fff;border-radius:3px;font-size:10px;';
      valInp.value = String(val);
      valInp.onchange = () => { this.layout.variables[key] = valInp.value; };
      const delBtn = document.createElement('button');
      delBtn.className = 'uie-btn';
      delBtn.style.cssText = 'padding:1px 4px;color:#f88;font-size:10px;';
      delBtn.textContent = '×';
      delBtn.onclick = () => { delete this.layout.variables[key]; this.renderVariables(); };
      row.appendChild(nameInp); row.appendChild(valInp); row.appendChild(delBtn);
      this.varsPanel.appendChild(row);
    }
  }

  // ── Image Import ─────────────────────────────────────────────────────────

  private importImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.png,.jpg,.jpeg,.webp,.svg,.gif';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // If a widget is selected, set as its bgImage
        if (this.selectedId) {
          const w = this.findWidget(this.selectedId);
          if (w) { w.bgImage = dataUrl; this.refreshAll(); return; }
        }
        // Otherwise create a new image widget
        const w = defaultWidget('image', genId());
        w.bgImage = dataUrl;
        w.width = 200; w.height = 200;
        w.name = file.name.replace(/\.[^.]+$/, '');
        this.layout.widgets.push(w);
        this.selectedId = w.id;
        this.refreshAll();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  private pickImageForWidget(w: UIWidgetDef): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.png,.jpg,.jpeg,.webp,.svg,.gif';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { w.bgImage = reader.result as string; this.refreshAll(); };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  // ── Save / Load / Export / Import ────────────────────────────────────────

  private saveLayout(): void {
    this.savedLayouts.set(this.layout.name, JSON.parse(JSON.stringify(this.layout)));
    try { localStorage.setItem('blindfake_ui_layouts', JSON.stringify(Object.fromEntries(this.savedLayouts))); } catch {}
    alert(`Layout "${this.layout.name}" saved!`);
  }

  private loadSavedLayouts(): void {
    try {
      const raw = localStorage.getItem('blindfake_ui_layouts');
      if (raw) {
        const data = JSON.parse(raw) as Record<string, UILayoutDef>;
        for (const [k, v] of Object.entries(data)) this.savedLayouts.set(k, v);
      }
    } catch {}
  }

  private showLoadDialog(): void {
    if (this.savedLayouts.size === 0) { alert('No saved layouts'); return; }
    const names = [...this.savedLayouts.keys()];
    const name = prompt('Load layout:\n\n' + names.join('\n') + '\n\nEnter name:');
    if (name && this.savedLayouts.has(name)) {
      this.layout = JSON.parse(JSON.stringify(this.savedLayouts.get(name)!));
      this.selectedId = null;
      this.refreshAll();
    }
  }

  private exportJSON(): void {
    const json = JSON.stringify(this.layout, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.layout.name.replace(/\s+/g, '_') + '.ui.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  private importJSON(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string) as UILayoutDef;
          if (data.widgets && data.canvasWidth) {
            this.layout = data;
            this.selectedId = null;
            this.refreshAll();
          }
        } catch { alert('Invalid UI layout JSON'); }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ── Preview ──────────────────────────────────────────────────────────────

  private openPreview(): void {
    const win = window.open('', '_blank', 'width=960,height=540');
    if (!win) return;
    win.document.title = this.layout.name + ' — UI Preview';
    win.document.body.style.cssText = 'margin:0;background:#0a0a1a;overflow:hidden;font-family:system-ui,sans-serif;';

    const container = win.document.createElement('div');
    container.style.cssText = `position:relative;width:100vw;height:100vh;`;
    win.document.body.appendChild(container);

    // Render widgets as real HTML
    const renderWidget = (w: UIWidgetDef, parent: HTMLElement) => {
      const el = win!.document.createElement('div');
      el.style.cssText = `position:absolute;left:${w.x}px;top:${w.y}px;width:${w.width}px;height:${w.height}px;opacity:${w.opacity};box-sizing:border-box;`;
      if (w.bgColor && w.bgColor !== 'transparent') el.style.backgroundColor = w.bgColor;
      if (w.bgImage) { el.style.backgroundImage = `url(${w.bgImage})`; el.style.backgroundSize = w.bgSize === 'stretch' ? '100% 100%' : w.bgSize; el.style.backgroundPosition = 'center'; }
      if (w.borderWidth) el.style.border = `${w.borderWidth}px solid ${w.borderColor}`;
      if (w.borderRadius) el.style.borderRadius = w.borderRadius + 'px';
      if (!w.visible) el.style.display = 'none';

      // Resolve text with variables
      let text = w.text;
      for (const [k, v] of Object.entries(this.layout.variables)) {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
      }

      switch (w.type) {
        case 'label':
        case 'button':
          el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = w.textAlign === 'left' ? 'flex-start' : w.textAlign === 'right' ? 'flex-end' : 'center';
          el.style.fontFamily = w.fontFamily; el.style.fontSize = w.fontSize + 'px'; el.style.fontWeight = w.fontWeight; el.style.color = w.fontColor;
          el.style.padding = '4px 8px';
          el.textContent = text;
          if (w.type === 'button') el.style.cursor = 'pointer';
          break;
        case 'progressbar': {
          el.style.position = 'relative'; el.style.overflow = 'hidden';
          const bar = win!.document.createElement('div');
          bar.style.cssText = `position:absolute;left:0;top:0;height:100%;width:${w.value}%;background:linear-gradient(90deg,#2a6,#4c8);border-radius:${w.borderRadius}px;`;
          const lbl = win!.document.createElement('div');
          lbl.style.cssText = `position:relative;z-index:1;width:100%;text-align:center;line-height:${w.height}px;font-size:11px;color:${w.fontColor};`;
          lbl.textContent = text; el.appendChild(bar); el.appendChild(lbl); break;
        }
        case 'slider': {
          el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
          const s = win!.document.createElement('input'); s.type = 'range'; s.min = String(w.minValue); s.max = String(w.maxValue); s.value = String(w.value);
          s.style.width = '90%'; el.appendChild(s); break;
        }
        case 'checkbox': {
          el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.padding = '4px 8px'; el.style.color = w.fontColor; el.style.fontSize = w.fontSize + 'px';
          const cb = win!.document.createElement('input'); cb.type = 'checkbox'; cb.checked = w.checked; cb.style.marginRight = '6px';
          el.appendChild(cb); const lbl = win!.document.createElement('span'); lbl.textContent = text; el.appendChild(lbl); break;
        }
        case 'textinput': {
          const inp = win!.document.createElement('input'); inp.type = 'text'; inp.placeholder = w.placeholder;
          inp.style.cssText = `width:100%;height:100%;padding:4px;background:#1a1a2e;border:1px solid #555;color:#fff;border-radius:4px;box-sizing:border-box;`;
          el.appendChild(inp); break;
        }
        case 'dropdown': {
          const sel = win!.document.createElement('select');
          sel.style.cssText = `width:100%;height:100%;padding:4px;background:#1a1a2e;border:1px solid #555;color:#fff;border-radius:4px;box-sizing:border-box;`;
          for (const o of w.options) { const opt = win!.document.createElement('option'); opt.textContent = o; sel.appendChild(opt); }
          el.appendChild(sel); break;
        }
        case 'divider':
          el.style.backgroundColor = w.borderColor || '#444'; break;
      }

      parent.appendChild(el);
      for (const cid of w.childIds) { const child = this.findWidget(cid); if (child) renderWidget(child, el); }
    };

    const roots = this.layout.widgets.filter(w => !w.parentId);
    for (const w of roots) renderWidget(w, container);
  }

  // ── Get layout for engine runtime ────────────────────────────────────────

  getLayout(): UILayoutDef {
    return JSON.parse(JSON.stringify(this.layout));
  }

  getAllSavedLayouts(): Map<string, UILayoutDef> {
    return new Map(this.savedLayouts);
  }
}
