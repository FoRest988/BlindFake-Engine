/**
 * LayoutPresets — Save and restore editor panel layouts.
 * Comes with built-in presets (Default, Wide, Tall, Animation, Scripting)
 * and supports user-created custom presets.
 */

export interface LayoutPreset {
  id: string;
  name: string;
  icon: string;
  builtin: boolean;
  panels: {
    hierarchy: boolean;
    inspector: boolean;
    timeline: boolean;
    console: boolean;
    assetBrowser: boolean;
  };
  sizes?: {
    leftWidth?: number;
    rightWidth?: number;
    bottomHeight?: number;
  };
}

const STORAGE_KEY = 'blindfake_layout_presets';
const ACTIVE_KEY = 'blindfake_layout_active';

const BUILTIN_PRESETS: LayoutPreset[] = [
  {
    id: 'default', name: 'Default', icon: '🖥️', builtin: true,
    panels: { hierarchy: true, inspector: true, timeline: true, console: true, assetBrowser: true },
    sizes: { leftWidth: 220, rightWidth: 280, bottomHeight: 180 },
  },
  {
    id: 'wide', name: 'Wide Viewport', icon: '🖼️', builtin: true,
    panels: { hierarchy: true, inspector: true, timeline: false, console: false, assetBrowser: false },
    sizes: { leftWidth: 180, rightWidth: 240, bottomHeight: 0 },
  },
  {
    id: 'animation', name: 'Animation', icon: '🎬', builtin: true,
    panels: { hierarchy: true, inspector: true, timeline: true, console: false, assetBrowser: false },
    sizes: { leftWidth: 200, rightWidth: 300, bottomHeight: 250 },
  },
  {
    id: 'scripting', name: 'Scripting', icon: '📜', builtin: true,
    panels: { hierarchy: false, inspector: false, timeline: false, console: true, assetBrowser: false },
    sizes: { leftWidth: 0, rightWidth: 0, bottomHeight: 300 },
  },
  {
    id: 'compact', name: 'Compact', icon: '📱', builtin: true,
    panels: { hierarchy: true, inspector: false, timeline: false, console: false, assetBrowser: false },
    sizes: { leftWidth: 200, rightWidth: 0, bottomHeight: 0 },
  },
];

export class LayoutPresets {
  private presets: LayoutPreset[];
  private activePresetId: string;
  private onApply: (preset: LayoutPreset) => void;

  constructor(onApply: (preset: LayoutPreset) => void) {
    this.onApply = onApply;
    this.presets = [...BUILTIN_PRESETS, ...this.loadCustomPresets()];
    this.activePresetId = localStorage.getItem(ACTIVE_KEY) || 'default';
  }

  /** Get all presets */
  getAll(): LayoutPreset[] {
    return this.presets;
  }

  /** Get active preset */
  getActive(): LayoutPreset {
    return this.presets.find(p => p.id === this.activePresetId) || BUILTIN_PRESETS[0];
  }

  /** Apply a preset */
  apply(presetId: string): void {
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) return;
    this.activePresetId = presetId;
    localStorage.setItem(ACTIVE_KEY, presetId);
    this.onApply(preset);
  }

  /** Save current layout as a custom preset */
  saveCustom(name: string, panels: LayoutPreset['panels'], sizes?: LayoutPreset['sizes']): LayoutPreset {
    const preset: LayoutPreset = {
      id: 'custom_' + Date.now(),
      name,
      icon: '⭐',
      builtin: false,
      panels,
      sizes,
    };
    this.presets.push(preset);
    this.persistCustom();
    return preset;
  }

  /** Delete a custom preset */
  deletePreset(id: string): void {
    this.presets = this.presets.filter(p => p.id !== id || p.builtin);
    this.persistCustom();
  }

  /** Render preset selector UI */
  render(): HTMLElement {
    const container = document.createElement('div');
    container.style.cssText = 'padding:8px;';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;';

    for (const preset of this.presets) {
      const card = document.createElement('div');
      const isActive = preset.id === this.activePresetId;
      card.style.cssText = `padding:8px;border:1px solid ${isActive ? '#58a6ff' : '#333'};border-radius:6px;cursor:pointer;text-align:center;background:${isActive ? '#1f6feb11' : '#2a2a3a'};transition:all 0.15s;position:relative;`;
      card.innerHTML = `
        <div style="font-size:20px;">${preset.icon}</div>
        <div style="font-size:10px;margin-top:4px;color:${isActive ? '#58a6ff' : '#ccc'};">${preset.name}</div>
        ${!preset.builtin ? '<button class="lp-del" style="position:absolute;top:2px;right:4px;background:none;border:none;color:#666;cursor:pointer;font-size:12px;">&times;</button>' : ''}
      `;

      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('lp-del')) {
          this.deletePreset(preset.id);
          container.replaceWith(this.render());
          return;
        }
        this.apply(preset.id);
        container.replaceWith(this.render());
      });

      grid.appendChild(card);
    }

    container.appendChild(grid);

    // Save current as custom
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '+ Save Current Layout';
    saveBtn.style.cssText = 'margin-top:8px;width:100%;padding:6px;border:1px solid #444;background:#2a2a3a;color:#ccc;border-radius:4px;cursor:pointer;font-size:11px;';
    saveBtn.addEventListener('click', () => {
      const name = prompt('Layout name:');
      if (name) {
        const active = this.getActive();
        this.saveCustom(name, active.panels, active.sizes);
        container.replaceWith(this.render());
      }
    });
    container.appendChild(saveBtn);

    return container;
  }

  private loadCustomPresets(): LayoutPreset[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  private persistCustom(): void {
    const custom = this.presets.filter(p => !p.builtin);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
  }
}
