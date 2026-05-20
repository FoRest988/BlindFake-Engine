/**
 * KeybindEditor — Custom keyboard shortcut configuration panel.
 * Allows users to view and rebind editor keyboard shortcuts.
 */

import type { EditorKeyboardShortcutsDeps } from './EditorKeyboardShortcuts';

export interface KeybindEntry {
  id: string;
  label: string;
  category: string;
  key: string;
  modifiers: string[]; // 'ctrl', 'shift', 'alt'
  action: () => void;
}

const STORAGE_KEY = 'blindfake_keybinds';

export class KeybindEditor {
  private bindings: Map<string, KeybindEntry> = new Map();
  private container: HTMLElement | null = null;
  private listeningFor: string | null = null;

  constructor() {
    this.loadCustomBindings();
  }

  /** Register a default keybind */
  register(entry: KeybindEntry): void {
    // Load saved override if any
    const saved = this.getSavedBindings();
    if (saved[entry.id]) {
      entry.key = saved[entry.id].key;
      entry.modifiers = saved[entry.id].modifiers;
    }
    this.bindings.set(entry.id, entry);
  }

  /** Check if a keyboard event matches any binding */
  handleKeyDown(e: KeyboardEvent): boolean {
    for (const b of this.bindings.values()) {
      const keyMatch = e.key.toLowerCase() === b.key.toLowerCase();
      const ctrl = b.modifiers.includes('ctrl') === (e.ctrlKey || e.metaKey);
      const shift = b.modifiers.includes('shift') === e.shiftKey;
      const alt = b.modifiers.includes('alt') === e.altKey;

      if (keyMatch && ctrl && shift && alt) {
        e.preventDefault();
        b.action();
        return true;
      }
    }
    return false;
  }

  /** Render the keybind editor UI */
  render(): HTMLElement {
    this.container = document.createElement('div');
    this.container.style.cssText = 'padding:12px;color:#ccc;font-size:12px;max-height:500px;overflow-y:auto;';

    this.container.innerHTML = `
      <div style="font-size:14px;font-weight:600;margin-bottom:12px;">⌨️ Keyboard Shortcuts</div>
      <div style="margin-bottom:8px;font-size:10px;color:#666;">Click on a shortcut to rebind it. Press Escape to cancel.</div>
      <input type="text" class="kb-search" placeholder="Search shortcuts..." style="width:100%;padding:6px 8px;background:#2a2a3a;border:1px solid #444;color:#ccc;border-radius:4px;margin-bottom:12px;box-sizing:border-box;font-size:11px;" />
      <div class="kb-list"></div>
      <div style="margin-top:12px;">
        <button class="kb-reset-all" style="padding:4px 12px;background:#2a2a3a;border:1px solid #444;color:#888;border-radius:3px;cursor:pointer;font-size:11px;">Reset All to Defaults</button>
      </div>
    `;

    this.renderList();
    this.bindEvents();
    return this.container;
  }

  private renderList(filter = ''): void {
    if (!this.container) return;
    const list = this.container.querySelector('.kb-list') as HTMLElement;
    if (!list) return;

    const entries = Array.from(this.bindings.values());
    const categories = [...new Set(entries.map(e => e.category))];

    let html = '';
    for (const cat of categories) {
      const items = entries.filter(e => e.category === cat && (filter === '' || e.label.toLowerCase().includes(filter)));
      if (items.length === 0) continue;
      html += `<div style="font-size:10px;font-weight:600;color:#666;text-transform:uppercase;margin:8px 0 4px;letter-spacing:0.5px;">${cat}</div>`;
      for (const item of items) {
        const shortcut = this.formatShortcut(item);
        const listening = this.listeningFor === item.id;
        html += `
          <div class="kb-row" data-id="${item.id}" style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;border-radius:3px;cursor:pointer;${listening ? 'background:#1f6feb22;' : ''}">
            <span style="font-size:11px;">${item.label}</span>
            <span class="kb-shortcut" style="background:#2a2a3a;padding:2px 8px;border-radius:3px;font-family:monospace;font-size:10px;color:${listening ? '#58a6ff' : '#888'};min-width:60px;text-align:center;">
              ${listening ? 'Press keys...' : shortcut}
            </span>
          </div>
        `;
      }
    }
    list.innerHTML = html;

    // Bind row clicks
    list.querySelectorAll('.kb-row').forEach(row => {
      row.addEventListener('click', () => {
        this.listeningFor = (row as HTMLElement).dataset.id!;
        this.renderList(filter);
      });
    });
  }

  private bindEvents(): void {
    if (!this.container) return;

    // Search
    const search = this.container.querySelector('.kb-search') as HTMLInputElement;
    search?.addEventListener('input', () => this.renderList(search.value.toLowerCase()));

    // Key capture
    const onKey = (e: KeyboardEvent) => {
      if (!this.listeningFor) return;
      if (e.key === 'Escape') {
        this.listeningFor = null;
        this.renderList();
        return;
      }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      e.preventDefault();
      const entry = this.bindings.get(this.listeningFor);
      if (entry) {
        entry.key = e.key;
        entry.modifiers = [];
        if (e.ctrlKey || e.metaKey) entry.modifiers.push('ctrl');
        if (e.shiftKey) entry.modifiers.push('shift');
        if (e.altKey) entry.modifiers.push('alt');
        this.saveBindings();
      }
      this.listeningFor = null;
      this.renderList();
    };
    window.addEventListener('keydown', onKey);

    // Reset all
    this.container.querySelector('.kb-reset-all')?.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      this.loadCustomBindings();
      this.renderList();
    });
  }

  private formatShortcut(entry: KeybindEntry): string {
    const parts: string[] = [];
    if (entry.modifiers.includes('ctrl')) parts.push('Ctrl');
    if (entry.modifiers.includes('shift')) parts.push('Shift');
    if (entry.modifiers.includes('alt')) parts.push('Alt');
    parts.push(entry.key.length === 1 ? entry.key.toUpperCase() : entry.key);
    return parts.join('+');
  }

  private saveBindings(): void {
    const data: Record<string, { key: string; modifiers: string[] }> = {};
    for (const [id, entry] of this.bindings) {
      data[id] = { key: entry.key, modifiers: entry.modifiers };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  private getSavedBindings(): Record<string, { key: string; modifiers: string[] }> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  private loadCustomBindings(): void {
    // Will apply overrides when register() is called
  }

  /**
   * Register all standard editor keyboard shortcuts derived from an
   * `EditorKeyboardShortcutsDeps` object.
   *
   * After calling this, the KeybindEditor UI will display every action and
   * users can rebind them. Saved overrides are applied immediately to the
   * deps callbacks via `handleKeyDown`.
   *
   * @example
   *   keybindEditor.registerAll(deps);
   *   editorKeyboardShortcuts.useKeybindEditor(keybindEditor);
   */
  registerAll(deps: EditorKeyboardShortcutsDeps): void {
    const shortcuts: Array<Omit<KeybindEntry, 'action'> & { action: () => void }> = [
      // ── Transform tools ──
      { id: 'translate',         label: 'Translate Tool',        category: 'Transform', key: 'w',      modifiers: [],          action: deps.onTranslate },
      { id: 'rotate',            label: 'Rotate Tool',           category: 'Transform', key: 'e',      modifiers: [],          action: deps.onRotate },
      { id: 'scale',             label: 'Scale Tool',            category: 'Transform', key: 'r',      modifiers: [],          action: deps.onScale },
      { id: 'select_tool',       label: 'Select Tool',           category: 'Transform', key: 'q',      modifiers: [],          action: deps.onSelectTool },
      // ── Selection ──
      { id: 'focus_selected',    label: 'Focus Selected',        category: 'Selection', key: 'f',      modifiers: [],          action: deps.onFocusSelected },
      { id: 'delete_selected',   label: 'Delete Selected',       category: 'Selection', key: 'Delete', modifiers: [],          action: deps.onDeleteSelected },
      { id: 'select_all',        label: 'Select All',            category: 'Selection', key: 'a',      modifiers: ['ctrl'],    action: deps.onSelectAll },
      { id: 'duplicate',         label: 'Duplicate',             category: 'Selection', key: 'd',      modifiers: ['ctrl'],    action: deps.onDuplicateSelected },
      // ── Undo / Redo ──
      { id: 'undo',              label: 'Undo',                  category: 'History',   key: 'z',      modifiers: ['ctrl'],    action: deps.onUndo },
      { id: 'redo_z',            label: 'Redo',                  category: 'History',   key: 'z',      modifiers: ['ctrl', 'shift'], action: deps.onRedo },
      { id: 'redo_y',            label: 'Redo (Alt)',            category: 'History',   key: 'y',      modifiers: ['ctrl'],    action: deps.onRedo },
      // ── File ──
      { id: 'save_scene',        label: 'Save Scene',            category: 'File',      key: 's',      modifiers: ['ctrl'],    action: deps.onSaveScene },
      // ── Playback ──
      { id: 'toggle_play',       label: 'Toggle Play Mode',      category: 'Playback',  key: 'F9',     modifiers: [],          action: deps.onTogglePlayMode },
      // ── Viewport ──
      { id: 'exit_cam_preview',  label: 'Exit Camera Preview',   category: 'Viewport',  key: 'Escape', modifiers: [],          action: deps.onExitCameraPreview },
      { id: 'toggle_visibility', label: 'Toggle Visibility',     category: 'Viewport',  key: 'h',      modifiers: [],          action: deps.onToggleSelectedVisibility },
      { id: 'toggle_grid',       label: 'Toggle Grid',           category: 'Viewport',  key: 'g',      modifiers: [],          action: deps.onToggleGrid },
      { id: 'toggle_wireframe',  label: 'Toggle Wireframe',      category: 'Viewport',  key: '1',      modifiers: [],          action: deps.onToggleWireframe },
      { id: 'toggle_bones',      label: 'Toggle Bones',          category: 'Viewport',  key: '2',      modifiers: [],          action: deps.onToggleBones },
    ];

    for (const s of shortcuts) {
      this.register(s);
    }
  }
}
