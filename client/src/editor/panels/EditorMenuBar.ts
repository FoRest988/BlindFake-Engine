import type { EditorApp } from '../EditorApp';
import { SceneSerializer } from '../../engine/SceneSerialization';

/**
 * EditorMenuBar — Full menu bar with File, Edit, View, Add, Window, Help menus.
 * Professional menu system modeled after Unity/Unreal/3ds Max editors.
 */
export class EditorMenuBar {
  private editor: EditorApp;
  private container!: HTMLElement;
  private activeMenu: HTMLElement | null = null;
  private closeListener: (() => void) | null = null;

  constructor(editor: EditorApp) {
    this.editor = editor;
  }

  render(): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'editor-menubar';

    const menus = [
      { label: 'File', getItems: () => this.fileMenu() },
      { label: 'Edit', getItems: () => this.editMenu() },
      { label: 'View', getItems: () => this.viewMenu() },
      { label: 'Add', getItems: () => this.addMenu() },
      { label: 'Window', getItems: () => this.windowMenu() },
      { label: 'Help', getItems: () => this.helpMenu() },
    ];

    for (const menu of menus) {
      const btn = document.createElement('div');
      btn.className = 'menubar-item';
      btn.textContent = menu.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openDropdown(btn, menu.getItems());
      });
      btn.addEventListener('mouseenter', () => {
        if (this.activeMenu) this.openDropdown(btn, menu.getItems());
      });
      this.container.appendChild(btn);
    }

    // Right-align scene name
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    this.container.appendChild(spacer);

    const sceneName = document.createElement('div');
    sceneName.className = 'menubar-scene-name';
    sceneName.textContent = '🏗️ BlindFake: Phantom';
    this.container.appendChild(sceneName);

    return this.container;
  }

  private openDropdown(anchor: HTMLElement, items: MenuItem[]): void {
    this.closeActive();
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'menubar-dropdown';
    menu.style.left = rect.left + 'px';
    menu.style.top = rect.bottom + 'px';

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'menubar-separator';
        menu.appendChild(sep);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'menubar-dropdown-item' + (item.disabled ? ' disabled' : '');
      row.innerHTML = `
        <span class="menubar-dropdown-label">${item.label}</span>
        ${item.shortcut ? `<span class="menubar-dropdown-shortcut">${item.shortcut}</span>` : ''}
      `;
      if (!item.disabled && item.action) {
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeActive();
          item.action!();
        });
      }
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    this.activeMenu = menu;
    anchor.classList.add('active');

    this.closeListener = () => {
      this.closeActive();
    };
    setTimeout(() => document.addEventListener('click', this.closeListener!), 0);
  }

  private closeActive(): void {
    if (this.activeMenu) {
      this.activeMenu.remove();
      this.activeMenu = null;
    }
    this.container.querySelectorAll('.menubar-item.active').forEach(el => el.classList.remove('active'));
    if (this.closeListener) {
      document.removeEventListener('click', this.closeListener);
      this.closeListener = null;
    }
  }

  // ── Menu Definitions ──────────────────────────

  private fileMenu(): MenuItem[] {
    return [
      { label: 'New Scene', shortcut: 'Ctrl+N', action: () => this.newScene() },
      { separator: true },
      { label: '💾 Save Project', shortcut: 'Ctrl+Shift+S', action: () => this.editor.saveProject() },
      { label: '📂 Load Project...', shortcut: 'Ctrl+Shift+O', action: () => this.editor.loadProject() },
      { separator: true },
      { label: 'Save Scene', shortcut: 'Ctrl+S', action: () => this.saveScene() },
      { label: 'Load Scene...', shortcut: 'Ctrl+O', action: () => this.loadScene() },
      { separator: true },
      { label: 'Import Model...', action: () => this.editor.addModel() },
      { separator: true },
      { label: 'Preferences...', action: () => this.editor.preferences.toggle() },
      { separator: true },
      { label: 'Exit to Game', shortcut: 'F9', action: () => this.editor.close() },
    ];
  }

  private editMenu(): MenuItem[] {
    const undo = this.editor.undo;
    return [
      { label: `Undo ${undo.undoLabel}`, shortcut: 'Ctrl+Z', action: () => undo.undo(), disabled: !undo.canUndo },
      { label: `Redo ${undo.redoLabel}`, shortcut: 'Ctrl+Y', action: () => undo.redo(), disabled: !undo.canRedo },
      { separator: true },
      { label: 'Duplicate', shortcut: 'Ctrl+D', action: () => this.editor.duplicateSelected(), disabled: !this.editor.state.selectedObject },
      { label: 'Delete', shortcut: 'Del', action: () => this.editor.deleteSelected(), disabled: !this.editor.state.selectedObject },
      { separator: true },
      { label: 'Select All', shortcut: 'Ctrl+A', action: () => this.selectAll() },
      { label: 'Deselect All', shortcut: 'Esc', action: () => this.editor.select(null) },
      { separator: true },
      { label: 'Focus Selected', shortcut: 'F', action: () => this.editor.focusSelected(), disabled: !this.editor.state.selectedObject },
    ];
  }

  private viewMenu(): MenuItem[] {
    const s = this.editor.state;
    return [
      { label: `${s.showGrid ? '✓ ' : '  '}Grid`, shortcut: 'G', action: () => { s.showGrid = !s.showGrid; } },
      { label: `${s.showWireframe ? '✓ ' : '  '}Wireframe`, shortcut: '1', action: () => { s.showWireframe = !s.showWireframe; this.editor.toggleWireframe(); } },
      { label: `${s.showBones ? '✓ ' : '  '}Bones`, shortcut: '2', action: () => this.editor.toggleBones() },
      { separator: true },
      { label: 'Front View', action: () => this.editor.viewport.setCameraViewPublic('front') },
      { label: 'Right View', action: () => this.editor.viewport.setCameraViewPublic('right') },
      { label: 'Top View', action: () => this.editor.viewport.setCameraViewPublic('top') },
      { label: 'Perspective', action: () => this.editor.viewport.setCameraViewPublic('perspective') },
      { separator: true },
      { label: 'Debug Overlay', shortcut: 'F3', action: () => this.editor.engine.debugOverlay.toggle() },
    ];
  }

  private addMenu(): MenuItem[] {
    return [
      { label: '▣  Cube', action: () => this.editor.addPrimitive('cube') },
      { label: '●  Sphere', action: () => this.editor.addPrimitive('sphere') },
      { label: '▬  Plane', action: () => this.editor.addPrimitive('plane') },
      { label: '⊙  Cylinder', action: () => this.editor.addPrimitive('cylinder') },
      { label: '⬭  Capsule', action: () => this.editor.addPrimitive('capsule') },
      { label: '△  Cone', action: () => this.editor.addPrimitive('cone') },
      { label: '◎  Torus', action: () => this.editor.addPrimitive('torus') },
      { separator: true },
      { label: '☀  Directional Light', action: () => this.editor.addLight('directional') },
      { label: '💡 Point Light', action: () => this.editor.addLight('point') },
      { label: '🔦 Spot Light', action: () => this.editor.addLight('spot') },
      { label: '🌤  Ambient Light', action: () => this.editor.addLight('ambient') },
      { separator: true },
      { label: '📷 Camera', action: () => this.editor.addCamera() },
      { separator: true },
      { label: '�️ Movement Path', action: () => this.editor.addSplinePath('movement') },
      { label: '🧱 Collision Wall', action: () => this.editor.addSplinePath('collision') },
      { label: '🎥 Camera Path', action: () => this.editor.addSplinePath('camera') },
      { separator: true },
      { label: '�📦 Import Model...', action: () => this.editor.addModel() },
    ];
  }

  private windowMenu(): MenuItem[] {
    return [
      { label: 'Hierarchy', action: () => this.editor.togglePanel('hierarchy') },
      { label: 'Inspector', action: () => this.editor.togglePanel('inspector') },
      { label: 'Timeline', action: () => this.editor.togglePanel('timeline') },
      { label: 'Console', action: () => this.editor.togglePanel('console') },
      { separator: true },
      { label: 'Asset Browser', action: () => this.editor.switchTab('scene') },
      { label: 'Visual Script Editor', action: () => this.editor.switchTab('blueprints') },
      { label: '🔨 Modeling & Rigging', action: () => this.editor.switchTab('modeling') },
      { label: '⚙️ Engine Systems', action: () => this.editor.toggleEngineSystems() },
      { separator: true },
      { label: 'Preferences', action: () => this.editor.preferences.toggle() },
    ];
  }

  private helpMenu(): MenuItem[] {
    return [
      { label: 'Keyboard Shortcuts', action: () => this.showShortcuts() },
      { separator: true },
      { label: 'About BlindFake: Phantom', action: () => this.showAbout() },
    ];
  }

  // ── Actions ───────────────────────────────────

  private newScene(): void {
    const scene = this.editor.scene;
    const toRemove = this.editor.getSceneObjects();
    toRemove.forEach(c => scene.remove(c));
    this.editor.select(null);
    this.editor.hierarchy.refresh();
    this.editor.statusBar.setMessage('New scene created');
  }

  private saveScene(): void {
    const scene = this.editor.engine.scenes.active;
    if (scene) {
      SceneSerializer.exportToFile(scene);
      this.editor.statusBar.setMessage('Scene saved');
    }
  }

  private async loadScene(): Promise<void> {
    const scene = this.editor.engine.scenes.active;
    if (!scene) return;
    const data = await SceneSerializer.importFromFile();
    if (data) {
      const loaded = SceneSerializer.deserialize(data);
      const toRemove = scene.children.filter(c => !c.userData.__editorHelper);
      toRemove.forEach(c => scene.remove(c));
      while (loaded.children.length > 0) {
        scene.add(loaded.children[0]);
      }
      this.editor.select(null);
      this.editor.hierarchy.refresh();
      this.editor.statusBar.setMessage('Scene loaded');
    }
  }

  private selectAll(): void {
    const objects = this.editor.getSceneObjects();
    if (objects.length === 0) return;
    this.editor.select(objects[0]);
    for (let i = 1; i < objects.length; i++) {
      this.editor.addToSelection(objects[i]);
    }
  }

  private showShortcuts(): void {
    const overlay = document.createElement('div');
    overlay.className = 'editor-modal-overlay';
    overlay.innerHTML = `
      <div class="editor-modal" style="min-width:500px;">
        <h3>⌨️ Keyboard Shortcuts</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 24px;font-size:12px;max-height:60vh;overflow-y:auto;">
          ${this.shortcutRow('W', 'Translate Tool')}
          ${this.shortcutRow('E', 'Rotate Tool')}
          ${this.shortcutRow('R', 'Scale Tool')}
          ${this.shortcutRow('Q', 'Select Tool')}
          ${this.shortcutRow('F', 'Focus Selected')}
          ${this.shortcutRow('G', 'Toggle Grid')}
          ${this.shortcutRow('1', 'Toggle Wireframe')}
          ${this.shortcutRow('2', 'Toggle Bones')}
          ${this.shortcutRow('Del', 'Delete Selected')}
          ${this.shortcutRow('Ctrl+Z', 'Undo')}
          ${this.shortcutRow('Ctrl+Y', 'Redo')}
          ${this.shortcutRow('Ctrl+D', 'Duplicate')}
          ${this.shortcutRow('Ctrl+S', 'Save Scene')}
          ${this.shortcutRow('Ctrl+A', 'Select All')}
          ${this.shortcutRow('H', 'Toggle Visibility')}
          ${this.shortcutRow('Escape', 'Exit Camera Preview')}
          ${this.shortcutRow('F9', 'Toggle Editor/Game')}
          ${this.shortcutRow('F3', 'Debug Overlay')}
          ${this.shortcutRow('RMB Drag', 'Orbit Camera')}
          ${this.shortcutRow('MMB Drag', 'Pan Camera')}
          ${this.shortcutRow('Scroll', 'Zoom')}
          ${this.shortcutRow('Ctrl+Click', 'Multi-select')}
          ${this.shortcutRow('LMB Drag', 'Marquee Select')}
        </div>
        <div style="margin-top:16px;text-align:right;">
          <button class="inspector-btn inspector-btn-primary" data-close>Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-close]')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  private shortcutRow(key: string, desc: string): string {
    return `
      <div style="padding:4px 0;color:#888;border-bottom:1px solid #333;">${desc}</div>
      <div style="padding:4px 0;color:#fff;font-family:monospace;border-bottom:1px solid #333;">${key}</div>
    `;
  }

  private showAbout(): void {
    const overlay = document.createElement('div');
    overlay.className = 'editor-modal-overlay';
    overlay.innerHTML = `
      <div class="editor-modal" style="text-align:center;">
        <h3 style="font-size:20px;margin-bottom:4px;">BlindFake: <span style='color:#a78bfa;'>Phantom</span></h3>
        <p style="color:#888;font-size:12px;margin:4px 0;">Version 0.2.0 — Phantom Edition</p>
        <p style="color:#666;font-size:11px;margin:8px 0;">A professional 3D/2D game engine built with Three.js</p>
        <p style="color:#555;font-size:10px;margin:12px 0;">TypeScript | Three.js | ECS Architecture | Rapier Physics</p>
        <div style="margin-top:16px;">
          <button class="inspector-btn inspector-btn-primary" data-close>Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-close]')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }
}

interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
}
