import type { EditorApp } from '../EditorApp';
import * as THREE from 'three';

export type ViewportShadingMode = 'lit' | 'unlit' | 'wireframe' | 'solid' | 'normals';

export class EditorToolbar {
  private editor: EditorApp;
  private container!: HTMLElement;
  private shadingMode: ViewportShadingMode = 'lit';
  private shadingDropdown: HTMLElement | null = null;

  constructor(editor: EditorApp) {
    this.editor = editor;
  }

  render(): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'editor-toolbar';
    this.rebuild();
    return this.container;
  }

  refresh(): void {
    this.rebuild();
  }

  private rebuild(): void {
    // Clean up any open dropdown before rebuilding DOM
    if (this.shadingDropdown) {
      this.shadingDropdown.remove();
      this.shadingDropdown = null;
    }
    const s = this.editor.state;
    this.container.innerHTML = `
      <!-- Transform tools -->
      <div class="toolbar-group">
        <button class="toolbar-btn ${s.tool === 'select' ? 'active' : ''}" data-tool="select" title="Select (Q)">🔍</button>
        <button class="toolbar-btn ${s.tool === 'translate' ? 'active' : ''}" data-tool="translate" title="Translate (W)">✥</button>
        <button class="toolbar-btn ${s.tool === 'rotate' ? 'active' : ''}" data-tool="rotate" title="Rotate (E)">↻</button>
        <button class="toolbar-btn ${s.tool === 'scale' ? 'active' : ''}" data-tool="scale" title="Scale (R)">⇲</button>
      </div>

      <!-- Transform space -->
      <div class="toolbar-group">
        <button class="toolbar-btn toolbar-btn-text ${s.transformSpace === 'world' ? 'active' : ''}" data-space="world" title="World Space">🌐 World</button>
        <button class="toolbar-btn toolbar-btn-text ${s.transformSpace === 'local' ? 'active' : ''}" data-space="local" title="Local Space">📐 Local</button>
      </div>

      <!-- Pivot -->
      <div class="toolbar-group">
        <button class="toolbar-btn toolbar-btn-text ${s.pivotMode === 'center' ? 'active' : ''}" data-pivot="center" title="Center Pivot">⊙ Center</button>
        <button class="toolbar-btn toolbar-btn-text ${s.pivotMode === 'origin' ? 'active' : ''}" data-pivot="origin" title="Origin Pivot">⊕ Pivot</button>
        <button class="toolbar-btn toolbar-btn-text ${s.edgeScale ? 'active' : ''}" data-action="edge-scale" title="Edge Scale (scale from one side)">↔ Edge</button>
      </div>

      <!-- Snap -->
      <div class="toolbar-group">
        <button class="toolbar-btn ${s.snapTranslate ? 'active' : ''}" data-action="toggle-snap" title="Toggle Snap">🧲</button>
        <button class="toolbar-btn toolbar-btn-text" data-toggle="grid" title="Toggle Grid (G)" ${s.showGrid ? 'style="color:#0078d4;"' : ''}>▦</button>
        <button class="toolbar-btn ${s.showBones ? 'active' : ''}" data-toggle="bones" title="Toggle Bones (2)">🦴</button>
      </div>

      <!-- Viewport Shading -->
      <div class="toolbar-group">
        <button class="toolbar-btn toolbar-btn-text" data-action="shading-dropdown" title="Viewport Shading Mode">
          ${this.getShadingIcon()} ${this.getShadingLabel()} ▾
        </button>
      </div>

      <!-- Play (centered, Unreal-style) -->
      <div class="toolbar-group" style="margin-left:auto;">
        <button class="toolbar-btn toolbar-btn-play" data-action="play" title="Play (F9)" ${s.isPlaying ? 'style="background:#2ecc71;color:#fff;"' : ''}>▶ Play</button>
        <button class="toolbar-btn toolbar-btn-pause" data-action="pause" title="Pause" ${s.isPlaying ? '' : 'style="opacity:0.4;"'}>⏸</button>
        <button class="toolbar-btn toolbar-btn-stop" data-action="stop" title="Stop" ${s.isPlaying ? 'style="background:#e74c3c;color:#fff;"' : 'style="opacity:0.4;"'}>■ Stop</button>
      </div>

      <!-- Right side -->
      <div class="toolbar-group" style="margin-left:auto;">
        <button class="toolbar-btn" data-toggle="debug" title="Debug Overlay (F3)">📊</button>
        <button class="toolbar-btn toolbar-btn-text" data-action="toggle-console" title="Toggle Console">🖥 Console</button>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Tools
    this.container.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.editor.setTool((btn as HTMLElement).dataset.tool as any);
      });
    });

    // Space
    this.container.querySelectorAll('[data-space]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.editor.setTransformSpace((btn as HTMLElement).dataset.space as any);
      });
    });

    // Pivot mode
    this.container.querySelectorAll('[data-pivot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.editor.state.pivotMode = (btn as HTMLElement).dataset.pivot as any;
        this.refresh();
      });
    });

    // Edge scale toggle
    this.container.querySelector('[data-action="edge-scale"]')?.addEventListener('click', () => {
      this.editor.state.edgeScale = !this.editor.state.edgeScale;
      this.refresh();
    });

    // Toggle snap
    this.container.querySelector('[data-action="toggle-snap"]')?.addEventListener('click', () => {
      const prefs = this.editor.preferences.get();
      if (this.editor.state.snapTranslate) {
        // Turn off snap
        this.editor.state.snapTranslate = 0;
        this.editor.state.snapRotate = 0;
        this.editor.state.snapScale = 0;
        this.editor.transformControls.setTranslationSnap(null);
        this.editor.transformControls.setRotationSnap(null);
        this.editor.transformControls.setScaleSnap(null);
      } else {
        // Restore snap from preferences (default to 0.5/15/0.1 if prefs are 0)
        const st = prefs.snapTranslate || 0.5;
        const sr = prefs.snapRotate || 15;
        const ss = prefs.snapScale || 0.1;
        this.editor.state.snapTranslate = st;
        this.editor.state.snapRotate = sr;
        this.editor.state.snapScale = ss;
        this.editor.transformControls.setTranslationSnap(st);
        this.editor.transformControls.setRotationSnap(THREE.MathUtils.degToRad(sr));
        this.editor.transformControls.setScaleSnap(ss);
      }
      this.refresh();
    });

    // Toggles
    this.container.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const toggle = (btn as HTMLElement).dataset.toggle!;
        switch (toggle) {
          case 'grid':
            this.editor.state.showGrid = !this.editor.state.showGrid;
            break;
          case 'bones':
            this.editor.toggleBones();
            break;
          case 'debug':
            this.editor.engine.debugOverlay.toggle();
            break;
        }
        this.refresh();
      });
    });

    // Viewport shading dropdown
    this.container.querySelector('[data-action="shading-dropdown"]')?.addEventListener('click', (e) => {
      this.showShadingDropdown(e as MouseEvent);
    });

    // Play/Pause/Stop
    this.container.querySelector('[data-action="play"]')?.addEventListener('click', () => {
      const wasPlaying = this.editor.playMode.isPlaying() || this.editor.playMode.isPaused();
      this.editor.playMode.togglePlayPause();
      this.editor.state.isPlaying = this.editor.playMode.isPlaying();
      if (!wasPlaying && this.editor.playMode.isPlaying()) {
        this.editor.enterPlayMode();
      } else if (this.editor.playMode.isPlaying()) {
        // Resume from pause — re-enable game systems
        this.editor.resumePlayMode();
      }
      this.refresh();
    });

    this.container.querySelector('[data-action="pause"]')?.addEventListener('click', () => {
      if (this.editor.playMode.isPlaying()) {
        this.editor.playMode.togglePlayPause();
        this.editor.state.isPlaying = false;
        this.editor.engine.editorActive = true; // Pause game systems
        this.refresh();
      }
    });

    this.container.querySelector('[data-action="stop"]')?.addEventListener('click', () => {
      const wasActive = !this.editor.playMode.isStopped();
      this.editor.playMode.stop();
      this.editor.state.isPlaying = false;
      if (wasActive) {
        this.editor.exitPlayMode();
      }
      this.refresh();
    });

    // Toggle console
    this.container.querySelector('[data-action="toggle-console"]')?.addEventListener('click', () => {
      const consoleEl = document.querySelector('.editor-console') as HTMLElement;
      if (consoleEl) {
        consoleEl.style.display = consoleEl.style.display === 'none' ? '' : 'none';
      }
    });
  }

  // ── Viewport Shading ──

  private getShadingIcon(): string {
    const icons: Record<ViewportShadingMode, string> = {
      lit: '☀️', unlit: '🌑', wireframe: '◇', solid: '⬜', normals: '🌈',
    };
    return icons[this.shadingMode];
  }

  private getShadingLabel(): string {
    const labels: Record<ViewportShadingMode, string> = {
      lit: 'Lit', unlit: 'Unlit', wireframe: 'Wireframe', solid: 'Solid', normals: 'Normals',
    };
    return labels[this.shadingMode];
  }

  private showShadingDropdown(e: MouseEvent): void {
    // Remove existing
    if (this.shadingDropdown) { this.shadingDropdown.remove(); this.shadingDropdown = null; return; }
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 2) + 'px';

    const modes: { mode: ViewportShadingMode; icon: string; label: string; desc: string }[] = [
      { mode: 'lit', icon: '☀️', label: 'Lit', desc: 'Full lighting and materials' },
      { mode: 'unlit', icon: '🌑', label: 'Unlit', desc: 'No lighting, base color only' },
      { mode: 'wireframe', icon: '◇', label: 'Wireframe', desc: 'Show mesh wireframes' },
      { mode: 'solid', icon: '⬜', label: 'Solid', desc: 'Flat gray, no textures' },
      { mode: 'normals', icon: '🌈', label: 'Normals', desc: 'Visualize surface normals' },
    ];

    for (const m of modes) {
      const item = document.createElement('div');
      item.className = 'context-menu-item';
      item.style.cssText = 'display:flex;align-items:center;gap:8px;';
      if (m.mode === this.shadingMode) item.style.background = '#0078d4';
      item.innerHTML = `<span>${m.icon}</span><span style="flex:1">${m.label}<br><span style="font-size:9px;color:#888;">${m.desc}</span></span>`;
      item.addEventListener('click', () => {
        this.setShadingMode(m.mode);
        menu.remove();
        this.shadingDropdown = null;
      });
      menu.appendChild(item);
    }

    document.body.appendChild(menu);
    this.shadingDropdown = menu;

    const closeMenu = () => {
      menu.remove();
      this.shadingDropdown = null;
      document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  private setShadingMode(mode: ViewportShadingMode): void {
    this.shadingMode = mode;

    // Temporarily detach TransformControls and remove helper from scene to avoid
    // traversing gizmo internals (which causes clone() errors on MeshNormalMaterial)
    const tc = this.editor.transformControls;
    const attachedObj = tc.object ?? null;
    if (attachedObj) tc.detach();
    const tcHelper = tc.getHelper();
    const tcHelperParent = tcHelper.parent;
    if (tcHelperParent) tcHelperParent.remove(tcHelper);

    // Collect meshes first (avoid mutation during traverse)
    const meshes: THREE.Mesh[] = [];
    this.editor.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && !obj.userData.__editorOnly && !obj.userData.__editorHelper) {
        meshes.push(obj);
      }
    });

    // Apply override materials
    for (const obj of meshes) {
      // Store original material if not already saved
      if (!obj.userData.__origMaterial && mode !== 'lit') {
        obj.userData.__origMaterial = obj.material;
      }

      switch (mode) {
        case 'lit':
          // Restore original materials
          if (obj.userData.__origMaterial) {
            obj.material = obj.userData.__origMaterial;
            delete obj.userData.__origMaterial;
          }
          if (obj.material && !Array.isArray(obj.material)) {
            (obj.material as THREE.MeshStandardMaterial).wireframe = false;
          }
          break;
        case 'unlit': {
          const origMat = obj.userData.__origMaterial || obj.material;
          const color = (origMat as THREE.MeshStandardMaterial).color?.clone?.() ?? new THREE.Color(0xcccccc);
          const map = (origMat as THREE.MeshStandardMaterial).map;
          obj.material = new THREE.MeshBasicMaterial({ color, map, wireframe: false });
          break;
        }
        case 'wireframe':
          if (obj.userData.__origMaterial) {
            obj.material = obj.userData.__origMaterial;
            delete obj.userData.__origMaterial;
          }
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m: THREE.Material) => { (m as THREE.MeshStandardMaterial).wireframe = true; });
          } else {
            (obj.material as THREE.MeshStandardMaterial).wireframe = true;
          }
          break;
        case 'solid':
          obj.material = new THREE.MeshLambertMaterial({ color: 0x888888, wireframe: false });
          break;
        case 'normals':
          obj.material = new THREE.MeshNormalMaterial({ wireframe: false });
          break;
      }
    }

    // Restore TransformControls helper and re-attach
    if (tcHelperParent) tcHelperParent.add(tcHelper);
    if (attachedObj) tc.attach(attachedObj);

    // Update wireframe state
    this.editor.state.showWireframe = mode === 'wireframe';
    this.refresh();
  }

  getShadingMode(): ViewportShadingMode {
    return this.shadingMode;
  }

  dispose(): void {
    if (this.shadingDropdown) {
      this.shadingDropdown.remove();
      this.shadingDropdown = null;
    }
  }
}
