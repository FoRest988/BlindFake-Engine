/**
 * EditorPreferences — Preferences/Settings panel for the editor.
 * Persists to localStorage. Covers grid, snap, colors, theme, performance.
 */

import type { EditorApp } from '../EditorApp';

export interface EditorPrefs {
  // Grid
  gridSize: number;
  gridDivisions: number;
  gridColor1: string;
  gridColor2: string;

  // Snap
  snapTranslate: number;
  snapRotate: number; // degrees
  snapScale: number;

  // Camera
  cameraSpeed: number;
  cameraNear: number;
  cameraFar: number;
  cameraFov: number;

  // Appearance
  accentColor: string;
  backgroundColor: string;
  fontSize: number;

  // Performance
  maxFps: number;
  antialiasing: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Shadow quality tier — controls both map size and shadow algorithm. */
  shadowQuality: 'low' | 'medium' | 'high' | 'ultra';

  // Viewport
  showFps: boolean;
  showStats: boolean;
  showAxisHelper: boolean;

  // Auto-save
  autoSaveEnabled: boolean;
  autoSaveInterval: number; // seconds
}

const STORAGE_KEY = 'blindfake_editor_prefs';

const DEFAULT_PREFS: EditorPrefs = {
  gridSize: 200,
  gridDivisions: 200,
  gridColor1: '#444444',
  gridColor2: '#2a2a2a',
  snapTranslate: 0,
  snapRotate: 0,
  snapScale: 0,
  cameraSpeed: 1,
  cameraNear: 0.1,
  cameraFar: 5000,
  cameraFov: 60,
  accentColor: '#0078d4',
  backgroundColor: '#1e1e1e',
  fontSize: 12,
  maxFps: 0,
  antialiasing: true,
  shadows: true,
  shadowMapSize: 2048,
  shadowQuality: 'high',
  showFps: true,
  showStats: true,
  showAxisHelper: true,
  autoSaveEnabled: false,
  autoSaveInterval: 120,
};

export class EditorPreferences {
  private editor: EditorApp;
  private prefs: EditorPrefs;
  private container!: HTMLElement;
  private visible = false;

  constructor(editor: EditorApp) {
    this.editor = editor;
    this.prefs = this.load();
  }

  /** Get current preferences */
  get(): EditorPrefs {
    return { ...this.prefs };
  }

  /** Get a single preference value */
  getValue<K extends keyof EditorPrefs>(key: K): EditorPrefs[K] {
    return this.prefs[key];
  }

  /** Set a single preference value */
  setValue<K extends keyof EditorPrefs>(key: K, value: EditorPrefs[K]): void {
    this.prefs[key] = value;
    this.save();
    this.applyPref(key);
  }

  /** Reset all preferences to defaults */
  resetAll(): void {
    this.prefs = { ...DEFAULT_PREFS };
    this.save();
    this.applyAll();
    if (this.visible) this.refreshPanel();
  }

  render(): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'editor-preferences-panel';
    this.container.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:480px;max-height:80vh;background:#2d2d2d;border:1px solid #444;border-radius:8px;z-index:2000;box-shadow:0 8px 24px rgba(0,0,0,0.6);overflow:hidden;flex-direction:column;';

    this.refreshPanel();
    return this.container;
  }

  toggle(): void {
    this.visible = !this.visible;
    if (this.container) {
      this.container.style.display = this.visible ? 'flex' : 'none';
      if (this.visible) this.refreshPanel();
    }
  }

  private refreshPanel(): void {
    const p = this.prefs;
    this.container.innerHTML = `
      <div style="display:flex;align-items:center;padding:12px 16px;background:#333;border-bottom:1px solid #444;">
        <span style="font-size:14px;font-weight:600;color:#fff;flex:1;">⚙️ Editor Preferences</span>
        <button data-action="reset" style="padding:4px 10px;background:#555;border:none;color:#ccc;border-radius:3px;cursor:pointer;font-size:10px;margin-right:8px;">Reset All</button>
        <button data-action="close" style="background:none;border:none;color:#888;cursor:pointer;font-size:16px;">✕</button>
      </div>
      <div style="overflow-y:auto;padding:12px 16px;flex:1;">
        ${this.section('Grid', [
          this.numberRow('gridSize', 'Size', p.gridSize, 10, 1000, 10),
          this.numberRow('gridDivisions', 'Divisions', p.gridDivisions, 10, 1000, 10),
          this.colorRow('gridColor1', 'Color Primary', p.gridColor1),
          this.colorRow('gridColor2', 'Color Secondary', p.gridColor2),
        ])}
        ${this.section('Snap', [
          this.numberRow('snapTranslate', 'Translate', p.snapTranslate, 0, 10, 0.25),
          this.numberRow('snapRotate', 'Rotate (°)', p.snapRotate, 0, 90, 5),
          this.numberRow('snapScale', 'Scale', p.snapScale, 0, 5, 0.1),
        ])}
        ${this.section('Camera', [
          this.numberRow('cameraSpeed', 'Speed', p.cameraSpeed, 0.1, 10, 0.1),
          this.numberRow('cameraFov', 'FOV', p.cameraFov, 20, 120, 5),
          this.numberRow('cameraNear', 'Near Clip', p.cameraNear, 0.01, 10, 0.1),
          this.numberRow('cameraFar', 'Far Clip', p.cameraFar, 100, 50000, 500),
        ])}
        ${this.section('Appearance', [
          this.colorRow('accentColor', 'Accent Color', p.accentColor),
          this.colorRow('backgroundColor', 'Background', p.backgroundColor),
          this.numberRow('fontSize', 'Font Size', p.fontSize, 8, 20, 1),
        ])}
        ${this.section('Performance', [
          this.boolRow('antialiasing', 'Anti-aliasing', p.antialiasing),
          this.boolRow('shadows', 'Shadows', p.shadows),
          this.selectRow('shadowQuality', 'Shadow Quality', p.shadowQuality, [
            { label: 'Low (512, Basic)', value: 'low' },
            { label: 'Medium (1024, PCF)', value: 'medium' },
            { label: 'High (2048, PCF Soft)', value: 'high' },
            { label: 'Ultra (4096, VSM)', value: 'ultra' },
          ]),
          this.selectRow('shadowMapSize', 'Shadow Map (override)', String(p.shadowMapSize), [
            { label: '512', value: '512' },
            { label: '1024', value: '1024' },
            { label: '2048', value: '2048' },
            { label: '4096', value: '4096' },
          ]),
          this.numberRow('maxFps', 'Max FPS (0=unlimited)', p.maxFps, 0, 240, 10),
        ])}
        ${this.section('Viewport', [
          this.boolRow('showFps', 'Show FPS', p.showFps),
          this.boolRow('showStats', 'Show Stats', p.showStats),
          this.boolRow('showAxisHelper', 'Show Axis Helper', p.showAxisHelper),
        ])}
        ${this.section('Auto-Save', [
          this.boolRow('autoSaveEnabled', 'Enabled', p.autoSaveEnabled),
          this.numberRow('autoSaveInterval', 'Interval (sec)', p.autoSaveInterval, 30, 600, 30),
        ])}
      </div>
    `;

    this.bindEvents();
  }

  private section(title: string, rows: string[]): string {
    return `
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #3a3a3a;">${title}</div>
        ${rows.join('')}
      </div>
    `;
  }

  private numberRow(key: string, label: string, value: number, min: number, max: number, step: number): string {
    return `<div style="display:flex;align-items:center;margin-bottom:4px;">
      <span style="width:130px;color:#888;font-size:11px;">${label}</span>
      <input type="number" data-pref="${key}" value="${value}" min="${min}" max="${max}" step="${step}"
        style="flex:1;padding:3px 6px;background:#1e1e1e;border:1px solid #444;color:#fff;font-size:11px;border-radius:2px;font-family:monospace;" />
    </div>`;
  }

  private colorRow(key: string, label: string, value: string): string {
    return `<div style="display:flex;align-items:center;margin-bottom:4px;">
      <span style="width:130px;color:#888;font-size:11px;">${label}</span>
      <input type="color" data-pref="${key}" value="${value}"
        style="width:40px;height:22px;padding:0;border:1px solid #444;border-radius:2px;cursor:pointer;" />
      <span style="color:#666;font-size:10px;margin-left:6px;">${value}</span>
    </div>`;
  }

  private boolRow(key: string, label: string, value: boolean): string {
    return `<div style="display:flex;align-items:center;margin-bottom:4px;">
      <span style="width:130px;color:#888;font-size:11px;">${label}</span>
      <input type="checkbox" data-pref="${key}" ${value ? 'checked' : ''}
        style="accent-color:#0078d4;" />
    </div>`;
  }

  private selectRow(key: string, label: string, value: string, options: { label: string; value: string }[]): string {
    const opts = options.map(o => `<option value="${o.value}" ${o.value === value ? 'selected' : ''}>${o.label}</option>`).join('');
    return `<div style="display:flex;align-items:center;margin-bottom:4px;">
      <span style="width:130px;color:#888;font-size:11px;">${label}</span>
      <select data-pref="${key}" style="flex:1;padding:3px 6px;background:#1e1e1e;border:1px solid #444;color:#fff;font-size:11px;border-radius:2px;">
        ${opts}
      </select>
    </div>`;
  }

  private bindEvents(): void {
    // Value changes
    this.container.querySelectorAll('[data-pref]').forEach(el => {
      const key = (el as HTMLElement).dataset.pref as keyof EditorPrefs;
      const handler = () => {
        if (el instanceof HTMLInputElement) {
          if (el.type === 'checkbox') {
            this.setValue(key, el.checked as EditorPrefs[typeof key]);
          } else if (el.type === 'number') {
            this.setValue(key, parseFloat(el.value) as EditorPrefs[typeof key]);
          } else {
            this.setValue(key, el.value as EditorPrefs[typeof key]);
          }
        } else if (el instanceof HTMLSelectElement) {
          // Parse as number if the default is a number
          const def = DEFAULT_PREFS[key];
          const val = typeof def === 'number' ? parseFloat(el.value) : el.value;
          this.setValue(key, val as EditorPrefs[typeof key]);
        }
      };
      el.addEventListener('change', handler);
      if (el instanceof HTMLInputElement && el.type === 'number') {
        el.addEventListener('input', handler);
      }
    });

    // Close
    this.container.querySelector('[data-action="close"]')?.addEventListener('click', () => {
      this.toggle();
    });

    // Reset with confirmation
    this.container.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
      if (confirm('Reset all preferences to defaults?')) {
        this.resetAll();
      }
    });
  }

  private applyPref(key: keyof EditorPrefs): void {
    const ed = this.editor;
    const p = this.prefs;

    switch (key) {
      case 'gridSize':
      case 'gridDivisions':
      case 'gridColor1':
      case 'gridColor2':
        ed.updateGrid();
        break;
      case 'snapTranslate':
        ed.state.snapTranslate = p.snapTranslate;
        ed.transformControls.setTranslationSnap(p.snapTranslate || null);
        break;
      case 'snapRotate':
        ed.state.snapRotate = p.snapRotate;
        ed.transformControls.setRotationSnap(p.snapRotate ? THREE.MathUtils.degToRad(p.snapRotate) : null);
        break;
      case 'snapScale':
        ed.state.snapScale = p.snapScale;
        ed.transformControls.setScaleSnap(p.snapScale || null);
        break;
      case 'cameraFov':
        ed.editorCamera.fov = p.cameraFov;
        ed.editorCamera.updateProjectionMatrix();
        break;
      case 'cameraNear':
        ed.editorCamera.near = p.cameraNear;
        ed.editorCamera.updateProjectionMatrix();
        break;
      case 'cameraFar':
        ed.editorCamera.far = p.cameraFar;
        ed.editorCamera.updateProjectionMatrix();
        break;
      case 'shadows':
        ed.engine.renderer.shadowMap.enabled = p.shadows;
        break;
      case 'shadowMapSize': {
        const sz = p.shadowMapSize;
        ed.scene.traverse(child => {
          if ((child as any).isLight && (child as any).shadow) {
            (child as any).shadow.mapSize.width = sz;
            (child as any).shadow.mapSize.height = sz;
          }
        });
        break;
      }
      case 'shadowQuality': {
        const TIERS = {
          low:    { size: 512,  type: THREE.BasicShadowMap },
          medium: { size: 1024, type: THREE.PCFShadowMap },
          high:   { size: 2048, type: THREE.PCFSoftShadowMap },
          ultra:  { size: 4096, type: THREE.VSMShadowMap },
        } as const;
        const tier = TIERS[p.shadowQuality as keyof typeof TIERS] ?? TIERS.high;
        ed.engine.renderer.shadowMap.type = tier.type;
        ed.scene.traverse(child => {
          if ((child as any).isLight && (child as any).shadow) {
            (child as any).shadow.mapSize.width = tier.size;
            (child as any).shadow.mapSize.height = tier.size;
            // Force shadow map to regenerate
            (child as any).shadow.map?.dispose();
            (child as any).shadow.map = null;
          }
        });
        break;
      }
    }
  }

  private applyAll(): void {
    for (const key of Object.keys(this.prefs) as (keyof EditorPrefs)[]) {
      this.applyPref(key);
    }
  }

  private load(): EditorPrefs {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_PREFS };
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
    } catch { /* ignore */ }
  }

  dispose(): void {
    this.visible = false;
  }
}

// THREE import for MathUtils.degToRad
import * as THREE from 'three';
