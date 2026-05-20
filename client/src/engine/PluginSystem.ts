/**
 * PluginSystem â€?Extensible plugin architecture for BlindFake: Phantom.
 * Plugins can register menu items, toolbar buttons, inspector sections,
 * panel tabs, keyboard shortcuts, and lifecycle hooks.
 */

import type { Engine } from './Engine';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
}

export type PluginHook =
  | 'init'
  | 'update'
  | 'editorOpen'
  | 'editorClose'
  | 'sceneLoad'
  | 'sceneSave'
  | 'entityCreate'
  | 'entityDestroy'
  | 'selectionChange';

export interface PluginMenuEntry {
  label: string;
  parent?: string;  // 'File' | 'Edit' | 'View' | 'Window' | 'Help' or custom
  action: () => void;
  shortcut?: string;
}

export interface PluginToolbarButton {
  icon: string;
  tooltip: string;
  action: () => void;
}

export interface PluginPanelTab {
  id: string;
  label: string;
  icon: string;
  render: () => HTMLElement;
}

export interface PluginInspectorSection {
  title: string;
  /** Return HTMLElement to render in inspector, or null to skip */
  render: (object: any) => HTMLElement | null;
  /** Priority (lower = higher in inspector). Default: 100 */
  priority?: number;
}

export interface PluginContext {
  engine: Engine;
  /** Register a hook callback */
  on(hook: PluginHook, callback: (...args: any[]) => void): void;
  /** Register a menu entry */
  addMenuItem(entry: PluginMenuEntry): void;
  /** Register a toolbar button */
  addToolbarButton(btn: PluginToolbarButton): void;
  /** Register a panel tab */
  addPanelTab(tab: PluginPanelTab): void;
  /** Register an inspector section */
  addInspectorSection(section: PluginInspectorSection): void;
  /** Register a keyboard shortcut */
  addKeybind(key: string, modifiers: string[], action: () => void): void;
  /** Log to editor console */
  log(message: string, level?: 'info' | 'warn' | 'error'): void;
}

export type PluginActivate = (ctx: PluginContext) => void | Promise<void>;
export type PluginDeactivate = () => void;

export interface Plugin {
  manifest: PluginManifest;
  activate: PluginActivate;
  deactivate?: PluginDeactivate;
}

interface RegisteredPlugin {
  plugin: Plugin;
  active: boolean;
  hooks: Map<PluginHook, Array<(...args: any[]) => void>>;
  menuEntries: PluginMenuEntry[];
  toolbarButtons: PluginToolbarButton[];
  panelTabs: PluginPanelTab[];
  inspectorSections: PluginInspectorSection[];
  keybinds: Array<{ key: string; modifiers: string[]; action: () => void }>;
}

export class PluginSystem {
  private plugins = new Map<string, RegisteredPlugin>();
  private engine: Engine;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  /** Register a plugin (doesn't activate it) */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.manifest.id)) {
      console.warn(`[PluginSystem] Plugin "${plugin.manifest.id}" already registered`);
      return;
    }
    this.plugins.set(plugin.manifest.id, {
      plugin,
      active: false,
      hooks: new Map(),
      menuEntries: [],
      toolbarButtons: [],
      panelTabs: [],
      inspectorSections: [],
      keybinds: [],
    });
  }

  /** Activate a plugin */
  async activate(pluginId: string): Promise<void> {
    const reg = this.plugins.get(pluginId);
    if (!reg || reg.active) return;

    const ctx: PluginContext = {
      engine: this.engine,
      on: (hook, cb) => {
        if (!reg.hooks.has(hook)) reg.hooks.set(hook, []);
        reg.hooks.get(hook)!.push(cb);
      },
      addMenuItem: (entry) => reg.menuEntries.push(entry),
      addToolbarButton: (btn) => reg.toolbarButtons.push(btn),
      addPanelTab: (tab) => reg.panelTabs.push(tab),
      addInspectorSection: (section) => reg.inspectorSections.push(section),
      addKeybind: (key, modifiers, action) => reg.keybinds.push({ key, modifiers, action }),
      log: (message, level = 'info') => console[level](`[Plugin:${pluginId}] ${message}`),
    };

    await reg.plugin.activate(ctx);
    reg.active = true;
    console.info(`[PluginSystem] Activated: ${reg.plugin.manifest.name} v${reg.plugin.manifest.version}`);
  }

  /** Deactivate a plugin */
  deactivate(pluginId: string): void {
    const reg = this.plugins.get(pluginId);
    if (!reg || !reg.active) return;

    reg.plugin.deactivate?.();
    reg.active = false;
    reg.hooks.clear();
    reg.menuEntries.length = 0;
    reg.toolbarButtons.length = 0;
    reg.panelTabs.length = 0;
    reg.inspectorSections.length = 0;
    reg.keybinds.length = 0;
    console.info(`[PluginSystem] Deactivated: ${reg.plugin.manifest.name}`);
  }

  /** Fire a hook across all active plugins */
  emit(hook: PluginHook, ...args: any[]): void {
    for (const reg of this.plugins.values()) {
      if (!reg.active) continue;
      const handlers = reg.hooks.get(hook);
      if (handlers) {
        for (const h of handlers) {
          try { h(...args); } catch (e) { console.error(`[Plugin:${reg.plugin.manifest.id}] Hook error:`, e); }
        }
      }
    }
  }

  /** Get all active plugin menu entries */
  getMenuEntries(): PluginMenuEntry[] {
    const entries: PluginMenuEntry[] = [];
    for (const reg of this.plugins.values()) {
      if (reg.active) entries.push(...reg.menuEntries);
    }
    return entries;
  }

  /** Get all active plugin toolbar buttons */
  getToolbarButtons(): PluginToolbarButton[] {
    const buttons: PluginToolbarButton[] = [];
    for (const reg of this.plugins.values()) {
      if (reg.active) buttons.push(...reg.toolbarButtons);
    }
    return buttons;
  }

  /** Get all active plugin panel tabs */
  getPanelTabs(): PluginPanelTab[] {
    const tabs: PluginPanelTab[] = [];
    for (const reg of this.plugins.values()) {
      if (reg.active) tabs.push(...reg.panelTabs);
    }
    return tabs;
  }

  /** Get all active plugin inspector sections */
  getInspectorSections(): PluginInspectorSection[] {
    const sections: PluginInspectorSection[] = [];
    for (const reg of this.plugins.values()) {
      if (reg.active) sections.push(...reg.inspectorSections);
    }
    return sections.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /** Get all registered plugin manifests */
  listPlugins(): Array<PluginManifest & { active: boolean }> {
    return Array.from(this.plugins.values()).map(reg => ({
      ...reg.plugin.manifest,
      active: reg.active,
    }));
  }

  /** Unregister everything */
  disposeAll(): void {
    for (const id of this.plugins.keys()) {
      this.deactivate(id);
    }
    this.plugins.clear();
  }
}
