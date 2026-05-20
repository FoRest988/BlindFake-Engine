/**
 * ScriptEditorPanel — TypeScript / Lua code editor with Monaco loaded from CDN.
 * Phase 13 additions:
 * - Lua mode toggle (TypeScript ↔ Lua)
 * - Monaco language: 'lua' in Lua mode
 * - Lua autocomplete popup for the extended game API
 * - Lua debugger panel (breakpoints, watches, call stack)
 * - Hot-reload indicator with last-save timestamp
 */

import type { EditorApp } from '../EditorApp';
import * as THREE from 'three';
import { ScriptingRuntime, ScriptInputManager, SCRIPT_TEMPLATES, type ScriptDefinition } from '../../engine/ScriptingSystem';
import {
  LuaScriptRunner, LuaDebugger, LuaHotReloadManager,
  LUA_API_REFERENCE, EXTENDED_LUA_TEMPLATES,
  type LuaBreakpoint, type LuaWatchEntry,
} from '../../cinematics/LuaScriptRunner';

// Monaco types (minimal, loaded at runtime)
interface MonacoEditor {
  create(container: HTMLElement, options: Record<string, unknown>): MonacoEditorInstance;
  defineTheme(name: string, data: Record<string, unknown>): void;
  setTheme(name: string): void;
  setModelLanguage?(model: unknown, language: string): void;
}
interface MonacoEditorInstance {
  getValue(): string;
  setValue(value: string): void;
  onDidChangeModelContent(cb: () => void): void;
  layout(): void;
  dispose(): void;
  addCommand(keybinding: number, handler: () => void): void;
  getModel(): MonacoEditorModel | null;
  deltaDecorations(old: string[], newDecos: MonacoDecoration[]): string[];
  onMouseDown(cb: (e: MonacoMouseEvent) => void): void;
}
interface MonacoEditorModel {
  getLineCount(): number;
}
interface MonacoDecoration {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  options: { isWholeLine?: boolean; className?: string; glyphMarginClassName?: string };
}
interface MonacoMouseEvent {
  target: { type: number; position: { lineNumber: number } | null };
}
interface MonacoKeyMod { CtrlCmd: number; Shift: number; }
interface MonacoKeyCode { KeyS: number; }

declare const monaco: {
  editor: MonacoEditor & {
    setModelLanguage(model: MonacoEditorModel, language: string): void;
  };
  KeyMod: MonacoKeyMod;
  KeyCode: MonacoKeyCode;
  languages: {
    registerCompletionItemProvider(
      lang: string,
      provider: {
        triggerCharacters?: string[];
        provideCompletionItems(model: unknown, position: unknown): { suggestions: MonacoCompletionItem[] };
      }
    ): void;
  };
};

interface MonacoCompletionItem {
  label: string;
  kind: number;
  insertText: string;
  detail?: string;
  documentation?: string;
}

export class ScriptEditorPanel {
  private editor: EditorApp;
  private container: HTMLElement | null = null;
  private monacoEditor: MonacoEditorInstance | null = null;
  private monacoLoaded = false;
  private runtime: ScriptingRuntime | null = null;
  private fallbackTextarea: HTMLTextAreaElement | null = null;

  private scripts: ScriptDefinition[] = [];
  private activeScript: ScriptDefinition | null = null;
  private activeSceneScriptObject: THREE.Object3D | null = null;
  private scriptListEl: HTMLElement | null = null;
  private logEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private editorContainer: HTMLElement | null = null;

  // ─── Phase 13: Lua mode ──────────────────────────────────────
  private luaMode = false;
  private luaRunner: LuaScriptRunner | null = null;
  private luaDebugger = new LuaDebugger();
  private luaHotReload = new LuaHotReloadManager();
  private luaDecorationIds: string[] = [];
  private luaDebugPanel: HTMLElement | null = null;
  private luaWatchInputEl: HTMLElement | null = null;
  private luaBreakpointListEl: HTMLElement | null = null;
  private luaWatchListEl: HTMLElement | null = null;
  private luaCallStackEl: HTMLElement | null = null;
  private hotReloadStatusEl: HTMLElement | null = null;
  private modeToggleBtn: HTMLButtonElement | null = null;
  private autocompletePopup: HTMLElement | null = null;
  private _lastHotReloadTime = 0;

  constructor(editor: EditorApp) {
    this.editor = editor;

    // Hot-reload wiring
    this.luaHotReload.onReload = (id, newCode) => {
      this._lastHotReloadTime = Date.now();
      this.appendLog('info', `[Lua] Hot-reloaded "${id}" at ${new Date(this._lastHotReloadTime).toLocaleTimeString()}`);
      this._updateHotReloadStatus(true);
      if (this.luaRunner) {
        const ctx = { scene: this.editor.scene, elapsed: 0, delta: 0 };
        const result = this.luaRunner.executeGameScript(newCode, ctx);
        for (const e of result.errors) this.showErrors([e]);
        for (const l of result.logs) this.appendLog(l.level as 'info' | 'warn' | 'error', l.msg);
      }
    };

    // Debugger pause → update panel
    this.luaDebugger.onPause = (line, locals, callStack) => {
      this._refreshDebugPanel(line, locals, callStack);
    };
  }

  render(): HTMLElement {
    if (this.container) return this.container;

    this.container = document.createElement('div');
    this.container.style.cssText = 'display:flex;width:100%;height:100%;background:#1e1e1e;color:#ccc;font-family:system-ui,sans-serif;font-size:12px;';

    // ── Left: Script list ──
    const left = document.createElement('div');
    left.style.cssText = 'width:200px;border-right:1px solid #333;display:flex;flex-direction:column;flex-shrink:0;';

    const leftHeader = document.createElement('div');
    leftHeader.style.cssText = 'padding:8px;border-bottom:1px solid #333;display:flex;align-items:center;gap:4px;';
    leftHeader.innerHTML = '<span style="font-weight:600;font-size:13px;">📜 Scripts</span><span style="flex:1;"></span>';

    const addBtn = document.createElement('button');
    addBtn.className = 'se-btn';
    addBtn.textContent = '+';
    addBtn.title = 'New Script';
    addBtn.addEventListener('click', () => this.showNewScriptMenu(addBtn));
    leftHeader.appendChild(addBtn);
    left.appendChild(leftHeader);

    this.scriptListEl = document.createElement('div');
    this.scriptListEl.style.cssText = 'flex:1;overflow-y:auto;padding:4px;';
    left.appendChild(this.scriptListEl);
    this.container.appendChild(left);

    // ── Center: Editor + toolbar ──
    const center = document.createElement('div');
    center.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'padding:4px 8px;border-bottom:1px solid #333;display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;';
    toolbar.innerHTML = `
      <button class="se-btn" data-action="save" title="Save & hot-reload (Ctrl+S)">💾 Save</button>
      <button class="se-btn" data-action="run" title="Run start()">▶ Run</button>
      <button class="se-btn" data-action="stop" title="Stop script">⏹ Stop</button>
      <button class="se-btn" data-action="attach" title="Attach to selected object">🔗 Attach</button>
      <div style="width:1px;height:16px;background:#444;margin:0 2px;"></div>
      <button class="se-btn se-lua-btn" data-action="runLua" title="Run as Lua script">🌙 Run Lua</button>
      <button class="se-btn se-lua-btn" data-action="debugLua" title="Toggle Lua debugger panel">🐛 Debug</button>
      <span style="flex:1;"></span>
      <span class="se-hotreload-badge" style="font-size:9px;padding:2px 5px;border-radius:3px;background:#1a3a1a;color:#4caf50;display:none;">⚡ Reloaded</span>
      <span class="se-status" style="font-size:10px;color:#666;">No script</span>
    `;

    // Mode toggle button
    this.modeToggleBtn = document.createElement('button');
    this.modeToggleBtn.className = 'se-btn';
    this.modeToggleBtn.style.cssText = 'background:#23345a;border-color:#3a5080;color:#7eb8ff;font-size:10px;';
    this.modeToggleBtn.textContent = 'TS';
    this.modeToggleBtn.title = 'Toggle TypeScript / Lua mode';
    this.modeToggleBtn.addEventListener('click', () => this._toggleLuaMode());
    toolbar.insertBefore(this.modeToggleBtn, toolbar.firstChild);

    this.hotReloadStatusEl = toolbar.querySelector('.se-hotreload-badge') as HTMLElement;

    center.appendChild(toolbar);

    // Error display
    this.errorEl = document.createElement('div');
    this.errorEl.style.cssText = 'display:none;padding:6px 10px;background:#2d1515;border-bottom:1px solid #5a2020;color:#e74c3c;font-size:11px;max-height:60px;overflow-y:auto;';
    center.appendChild(this.errorEl);

    // Monaco container
    this.editorContainer = document.createElement('div');
    this.editorContainer.style.cssText = 'flex:1;min-height:0;position:relative;';
    center.appendChild(this.editorContainer);

    // Lua debugger panel (hidden by default)
    this.luaDebugPanel = this._buildLuaDebugPanel();
    center.appendChild(this.luaDebugPanel);

    // Log output
    this.logEl = document.createElement('div');
    this.logEl.style.cssText = 'height:120px;border-top:1px solid #333;overflow-y:auto;padding:4px 8px;font-family:monospace;font-size:11px;background:#111;color:#aaa;flex-shrink:0;';
    this.logEl.innerHTML = '<div style="color:#555;">Script output will appear here...</div>';
    center.appendChild(this.logEl);

    this.container.appendChild(center);

    this.addStyles();
    this.bindToolbar(toolbar);
    this.loadMonaco();
    this.updateScriptList();

    return this.container;
  }

  private async loadMonaco(): Promise<void> {
    if (this.monacoLoaded) {
      if (!this.monacoEditor) this.initMonacoEditor();
      return;
    }

    // Check if already loaded
    if (typeof monaco !== 'undefined') {
      this.monacoLoaded = true;
      this.initMonacoEditor();
      return;
    }

    // Show loading state
    if (this.editorContainer) {
      this.editorContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;">Loading editor...</div>';
    }

    // Load Monaco from CDN
    const loaderScript = document.createElement('script');
    loaderScript.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js';
    loaderScript.onload = () => {
      const require = (window as any).require;
      require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
      require(['vs/editor/editor.main'], () => {
        this.monacoLoaded = true;
        this.initMonacoEditor();
      });
    };
    loaderScript.onerror = () => {
      // Fallback: use a simple textarea
      this.createFallbackEditor();
    };
    document.head.appendChild(loaderScript);
  }

  private initMonacoEditor(): void {
    if (!this.editorContainer) return;
    this.editorContainer.innerHTML = '';

    // Define dark theme
    monaco.editor.defineTheme('blindfake-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6A9955' },
        { token: 'keyword', foreground: '569CD6' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'type', foreground: '4EC9B0' },
      ],
      colors: {
        'editor.background': '#1a1a2e',
        'editor.lineHighlightBackground': '#222244',
        'editorCursor.foreground': '#58a6ff',
      },
    });

    this.monacoEditor = monaco.editor.create(this.editorContainer, {
      value: this.activeScript?.code ?? '// Select or create a script\n',
      language: this.luaMode ? 'lua' : 'typescript',
      theme: 'blindfake-dark',
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      glyphMargin: true,        // Phase 13: needed for breakpoint markers
      renderWhitespace: 'selection',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: 'on',
    });

    // Ctrl+S to save
    this.monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      this.saveScript();
    });

    // Phase 13: gutter click → toggle breakpoint (onMouseDown may not exist in all Monaco builds)
    if (typeof this.monacoEditor.onMouseDown === 'function') {
      this.monacoEditor.onMouseDown((e) => {
        if (e.target.type === 3 /* GUTTER_GLYPH_MARGIN */ && e.target.position) {
          const line = e.target.position.lineNumber;
          if (this.luaDebugger.hasBreakpoint(line)) {
            this.luaDebugger.clearBreakpoint(line);
          } else {
            this.luaDebugger.setBreakpoint(line);
          }
          this._refreshBreakpointDecorations();
          this._refreshBreakpointList();
        }
      });
    }

    // Phase 13: register Lua autocomplete
    this._registerLuaAutocomplete();
  }

  // ─── Phase 13: Lua mode toggle ─────────────────────────────
  private _toggleLuaMode(): void {
    this.luaMode = !this.luaMode;
    if (this.modeToggleBtn) {
      this.modeToggleBtn.textContent = this.luaMode ? 'LUA' : 'TS';
      this.modeToggleBtn.style.background = this.luaMode ? '#2a3a1a' : '#23345a';
      this.modeToggleBtn.style.borderColor = this.luaMode ? '#5a8030' : '#3a5080';
      this.modeToggleBtn.style.color = this.luaMode ? '#a0d060' : '#7eb8ff';
    }

    // Switch Monaco language
    if (this.monacoEditor) {
      const model = this.monacoEditor.getModel();
      if (model) monaco.editor.setModelLanguage(model, this.luaMode ? 'lua' : 'typescript');
    }

    // Show/hide Lua-specific toolbar buttons
    this.container?.querySelectorAll<HTMLElement>('.se-lua-btn').forEach(btn => {
      btn.style.display = this.luaMode ? '' : 'none';
    });

    this.appendLog('info', `Mode: ${this.luaMode ? '🌙 Lua' : '⟨TS⟩ TypeScript'}`);
  }

  // ─── Phase 13: Lua autocomplete ─────────────────────────────
  private _registerLuaAutocomplete(): void {
    if (typeof monaco === 'undefined' || !monaco.languages?.registerCompletionItemProvider) return;

    monaco.languages.registerCompletionItemProvider('lua', {
      triggerCharacters: ['.'],
      provideCompletionItems: (_model, _position) => {
        const suggestions: MonacoCompletionItem[] = [];
        const COMPLETION_KIND_FUNCTION = 1;
        const COMPLETION_KIND_MODULE = 8;

        // Top-level namespaces
        for (const ns of Object.keys(LUA_API_REFERENCE)) {
          suggestions.push({ label: ns, kind: COMPLETION_KIND_MODULE, insertText: ns, detail: 'BlindFake API' });
        }

        // Flattened method suggestions
        for (const [ns, entries] of Object.entries(LUA_API_REFERENCE)) {
          for (const entry of entries) {
            suggestions.push({
              label: entry.label,
              kind: COMPLETION_KIND_FUNCTION,
              insertText: entry.label.replace(`${ns}.`, ''),
              detail: entry.detail,
              documentation: entry.doc,
            });
          }
        }

        // Lua keywords
        const keywords = ['function', 'local', 'if', 'then', 'else', 'elseif', 'end', 'for', 'while', 'do', 'repeat', 'until', 'return', 'break', 'and', 'or', 'not', 'nil', 'true', 'false', 'math', 'table', 'string', 'tostring', 'tonumber', 'ipairs', 'pairs'];
        for (const kw of keywords) {
          suggestions.push({ label: kw, kind: 14, insertText: kw, detail: 'Lua keyword' });
        }

        return { suggestions };
      },
    });
  }

  // ─── Phase 13: Lua debug panel ──────────────────────────────
  private _buildLuaDebugPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.style.cssText = 'display:none;flex-direction:column;border-top:1px solid #444;background:#161620;font-size:11px;max-height:200px;overflow:hidden;';
    panel.className = 'lua-debug-panel';

    // Panel header with tabs
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;gap:2px;padding:4px 6px;border-bottom:1px solid #333;background:#1a1a28;align-items:center;';
    header.innerHTML = `
      <span style="font-size:10px;color:#e76b;font-weight:600;">🐛 Lua Debugger</span>
      <button class="se-btn lua-dbg-btn" data-dbg="step" title="Step" style="font-size:10px;">→ Step</button>
      <button class="se-btn lua-dbg-btn" data-dbg="resume" title="Resume" style="font-size:10px;">▶ Resume</button>
      <button class="se-btn lua-dbg-btn" data-dbg="stepMode" title="Toggle step mode" style="font-size:10px;">⏸ Step Mode</button>
      <button class="se-btn lua-dbg-btn" data-dbg="clearBp" title="Clear all breakpoints" style="font-size:10px;">✕ Clear BPs</button>
      <span style="flex:1;"></span>
      <span class="lua-dbg-status" style="font-size:10px;color:#666;">Idle</span>
    `;
    panel.appendChild(header);

    // Body: 3 columns
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex:1;overflow:hidden;';

    // Breakpoints column
    const bpCol = document.createElement('div');
    bpCol.style.cssText = 'flex:1;border-right:1px solid #333;overflow-y:auto;padding:4px;';
    bpCol.innerHTML = '<div style="color:#888;font-size:9px;padding:2px 4px;text-transform:uppercase;">Breakpoints</div>';
    this.luaBreakpointListEl = document.createElement('div');
    bpCol.appendChild(this.luaBreakpointListEl);
    body.appendChild(bpCol);

    // Watches column
    const watchCol = document.createElement('div');
    watchCol.style.cssText = 'flex:1;border-right:1px solid #333;overflow-y:auto;padding:4px;';
    watchCol.innerHTML = '<div style="color:#888;font-size:9px;padding:2px 4px;text-transform:uppercase;">Watches</div>';
    this.luaWatchListEl = document.createElement('div');
    watchCol.appendChild(this.luaWatchListEl);

    // Watch input row
    const watchInput = document.createElement('div');
    watchInput.style.cssText = 'display:flex;gap:4px;padding:2px 4px;';
    const watchInputField = document.createElement('input');
    watchInputField.type = 'text';
    watchInputField.placeholder = 'expr...';
    watchInputField.style.cssText = 'flex:1;background:#111;border:1px solid #444;color:#ccc;padding:2px 4px;font-size:10px;border-radius:2px;';
    const watchAddBtn = document.createElement('button');
    watchAddBtn.className = 'se-btn';
    watchAddBtn.textContent = '+';
    watchAddBtn.addEventListener('click', () => {
      const expr = watchInputField.value.trim();
      if (expr) { this.luaDebugger.addWatch(expr); watchInputField.value = ''; this._refreshWatchList(); }
    });
    watchInput.appendChild(watchInputField);
    watchInput.appendChild(watchAddBtn);
    watchCol.appendChild(watchInput);
    body.appendChild(watchCol);

    // Call stack column
    const stackCol = document.createElement('div');
    stackCol.style.cssText = 'flex:1;overflow-y:auto;padding:4px;';
    stackCol.innerHTML = '<div style="color:#888;font-size:9px;padding:2px 4px;text-transform:uppercase;">Call Stack</div>';
    this.luaCallStackEl = document.createElement('div');
    stackCol.appendChild(this.luaCallStackEl);
    body.appendChild(stackCol);

    panel.appendChild(body);

    // Bind debugger toolbar buttons
    header.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-dbg]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.dbg;
      const statusEl = header.querySelector('.lua-dbg-status') as HTMLElement;
      if (action === 'resume') {
        this.luaDebugger.resume();
        if (statusEl) statusEl.textContent = 'Running';
      } else if (action === 'step') {
        this.luaDebugger.setStepMode(true);
        this.luaDebugger.resume();
        if (statusEl) statusEl.textContent = 'Stepping';
      } else if (action === 'stepMode') {
        const newMode = !this.luaDebugger.stepMode;
        this.luaDebugger.setStepMode(newMode);
        btn.style.background = newMode ? '#3a2a10' : '';
        if (statusEl) statusEl.textContent = newMode ? 'Step Mode ON' : 'Idle';
      } else if (action === 'clearBp') {
        this.luaDebugger.clearAllBreakpoints();
        this._refreshBreakpointDecorations();
        this._refreshBreakpointList();
      }
    });

    return panel;
  }

  private _toggleLuaDebugPanel(): void {
    if (!this.luaDebugPanel) return;
    const visible = this.luaDebugPanel.style.display !== 'none';
    this.luaDebugPanel.style.display = visible ? 'none' : 'flex';
  }

  private _refreshBreakpointDecorations(): void {
    if (!this.monacoEditor || typeof this.monacoEditor.deltaDecorations !== 'function') return;
    const bps = this.luaDebugger.getAllBreakpoints();
    const decorations: MonacoDecoration[] = bps
      .filter(bp => bp.enabled)
      .map(bp => ({
        range: { startLineNumber: bp.line, startColumn: 1, endLineNumber: bp.line, endColumn: 1 },
        options: { isWholeLine: true, className: 'lua-bp-line', glyphMarginClassName: 'lua-bp-glyph' },
      }));
    this.luaDecorationIds = this.monacoEditor.deltaDecorations(this.luaDecorationIds, decorations);
  }

  private _refreshBreakpointList(): void {
    if (!this.luaBreakpointListEl) return;
    const bps = this.luaDebugger.getAllBreakpoints();
    this.luaBreakpointListEl.innerHTML = bps.length === 0
      ? '<div style="color:#555;padding:4px;">No breakpoints</div>'
      : bps.map(bp => `<div style="display:flex;align-items:center;gap:4px;padding:2px 4px;color:${bp.enabled ? '#f66' : '#666'};">
          <span>●</span><span>Line ${bp.line}</span>
          <button class="se-btn" style="font-size:9px;padding:1px 4px;margin-left:auto;" data-bp-line="${bp.line}">✕</button>
        </div>`).join('');
    this.luaBreakpointListEl.querySelectorAll('[data-bp-line]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.luaDebugger.clearBreakpoint(Number((btn as HTMLElement).dataset.bpLine));
        this._refreshBreakpointDecorations();
        this._refreshBreakpointList();
      });
    });
  }

  private _refreshWatchList(): void {
    if (!this.luaWatchListEl) return;
    const watches = this.luaDebugger.getWatches();
    this.luaWatchListEl.innerHTML = watches.length === 0
      ? '<div style="color:#555;padding:4px;">No watches</div>'
      : watches.map(w => `<div style="padding:2px 4px;display:flex;gap:4px;">
          <span style="color:#8af;">${w.expr}</span>
          <span style="color:#aaa;">= ${w.lastValue}</span>
          <button class="se-btn" style="font-size:9px;padding:1px 4px;margin-left:auto;" data-watch="${w.expr}">✕</button>
        </div>`).join('');
    this.luaWatchListEl.querySelectorAll('[data-watch]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.luaDebugger.removeWatch((btn as HTMLElement).dataset.watch!);
        this._refreshWatchList();
      });
    });
  }

  private _refreshDebugPanel(pausedLine: number, locals: Record<string, unknown>, callStack: Array<{ fn: string; line: number }>): void {
    // Highlight paused line
    if (this.monacoEditor && typeof this.monacoEditor.deltaDecorations === 'function') {
      const pauseDecoration: MonacoDecoration = {
        range: { startLineNumber: pausedLine, startColumn: 1, endLineNumber: pausedLine, endColumn: 1 },
        options: { isWholeLine: true, className: 'lua-paused-line', glyphMarginClassName: 'lua-paused-glyph' },
      };
      this.luaDecorationIds = this.monacoEditor.deltaDecorations(this.luaDecorationIds, [pauseDecoration]);
    }

    // Update watches with current locals
    this._refreshWatchList();

    // Update call stack
    if (this.luaCallStackEl) {
      this.luaCallStackEl.innerHTML = callStack.length === 0
        ? '<div style="color:#555;padding:4px;">(empty)</div>'
        : callStack.map(f => `<div style="padding:2px 4px;color:#bbb;">${f.fn} <span style="color:#666;">:${f.line}</span></div>`).join('');
    }

    // Update debug panel status
    const statusEl = this.luaDebugPanel?.querySelector('.lua-dbg-status') as HTMLElement | null;
    if (statusEl) statusEl.textContent = `Paused @ line ${pausedLine}`;

    // Show current locals in watch list
    for (const [k, v] of Object.entries(locals)) {
      if (!this.luaDebugger.getWatches().find(w => w.expr === k)) {
        this.luaDebugger.addWatch(k);
      }
    }
    this._refreshWatchList();
  }

  private _updateHotReloadStatus(active: boolean): void {
    if (!this.hotReloadStatusEl) return;
    if (active) {
      this.hotReloadStatusEl.style.display = '';
      this.hotReloadStatusEl.textContent = `⚡ Reloaded ${new Date().toLocaleTimeString()}`;
      setTimeout(() => { if (this.hotReloadStatusEl) this.hotReloadStatusEl.style.display = 'none'; }, 3000);
    } else {
      this.hotReloadStatusEl.style.display = 'none';
    }
  }

  // ─── Phase 13: Run Lua script ────────────────────────────────
  private runLuaScript(): void {
    if (!this.luaRunner) {
      // LuaScriptRunner requires a CinematicEngine — create minimal stub
      this.luaRunner = new LuaScriptRunner({ play: () => {}, stop: () => {}, pause: () => {} } as any);
      this.luaRunner.debugger = this.luaDebugger;
    }

    const code = this.getEditorValue();
    const ctx = {
      scene: this.editor.scene,
      elapsed: 0,
      delta: 0,
    };

    const result = this.luaRunner.executeGameScript(code, ctx);
    this.clearErrors();

    for (const l of result.logs) {
      this.appendLog(l.level as 'info' | 'warn' | 'error', `[Lua] ${l.msg}`);
    }
    if (result.errors.length > 0) {
      this.showErrors(result.errors.map(e => `[Lua] ${e}`));
    } else {
      this.appendLog('info', '[Lua] Script executed.');
      // Register for hot-reload
      const id = this.activeScript?.id ?? 'lua_adhoc';
      this.luaHotReload.register(id, code);
      this._updateHotReloadStatus(false);
    }
  }

  private createFallbackEditor(): void {
    if (!this.editorContainer) return;
    this.editorContainer.innerHTML = '';

    const textarea = document.createElement('textarea');
    textarea.style.cssText = 'width:100%;height:100%;background:#1a1a2e;color:#ddd;border:none;outline:none;resize:none;padding:12px;font-family:monospace;font-size:13px;tab-size:2;';
    textarea.value = this.activeScript?.code ?? '// Select or create a script\n';
    textarea.spellcheck = false;

    // Tab key support
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        this.saveScript();
      }
    });

    // Store reference for getValue/setValue
    this.fallbackTextarea = textarea;
    this.editorContainer.appendChild(textarea);
  }

  private getEditorValue(): string {
    if (this.monacoEditor) return this.monacoEditor.getValue();
    return this.fallbackTextarea?.value ?? '';
  }

  private setEditorValue(value: string): void {
    if (this.monacoEditor) { this.monacoEditor.setValue(value); return; }
    if (this.fallbackTextarea) this.fallbackTextarea.value = value;
  }

  // ─── Script Management ─────────────────────────────
  private createScript(name: string, template = 'Empty'): ScriptDefinition {
    const script: ScriptDefinition = {
      id: `script_${Date.now()}`,
      name,
      code: SCRIPT_TEMPLATES[template] ?? SCRIPT_TEMPLATES['Empty'],
      enabled: true,
    };
    this.scripts.push(script);
    this.selectScript(script);
    this.updateScriptList();
    return script;
  }

  private selectScript(script: ScriptDefinition): void {
    this.activeSceneScriptObject = null;
    this.activeScript = script;
    this.setEditorValue(script.code);
    this.clearErrors();
    this.updateStatus(`Editing: ${script.name}`);
    this.updateScriptList();
  }

  private selectSceneScriptObject(obj: THREE.Object3D): void {
    this.activeScript = null;
    this.activeSceneScriptObject = obj;
    this.editor.select(obj);
    this.setEditorValue(this.getSceneScriptCode(obj));
    this.clearErrors();
    this.updateStatus(`Attached: ${this.getSceneScriptLabel(obj)}`);
    this.updateScriptList();
  }

  private deleteScript(script: ScriptDefinition): void {
    const idx = this.scripts.indexOf(script);
    if (idx !== -1) this.scripts.splice(idx, 1);
    if (this.activeScript === script) {
      this.activeScript = this.scripts[0] ?? null;
      this.setEditorValue(this.activeScript?.code ?? '// No script selected\n');
    }
    if (this.runtime) this.runtime.detach(script.id);
    this.updateScriptList();
  }

  private saveScript(): void {
    if (this.activeScript) {
      this.activeScript.code = this.getEditorValue();

      // Phase 13: Lua mode hot-reload
      if (this.luaMode) {
        const changed = this.luaHotReload.update(this.activeScript.id, this.activeScript.code);
        if (changed) {
          this._updateHotReloadStatus(true);
        } else {
          this.appendLog('info', '[Lua] Script saved (no changes).');
        }
        return;
      }

      // Hot-reload if runtime is active
      if (this.runtime) {
        const result = this.runtime.hotReload(this.activeScript.id, this.activeScript.code);
        if (result.errors.length > 0) {
          this.showErrors(result.errors);
        } else {
          this.clearErrors();
          this.appendLog('info', 'Script hot-reloaded successfully.');
        }
      } else {
        this.appendLog('info', 'Script saved.');
      }
      return;
    }

    if (!this.activeSceneScriptObject) return;
    this.activeSceneScriptObject.userData.__luaScript = this.getEditorValue();
    this.clearErrors();
    this.appendLog('info', `Updated attached script on "${this.getSceneScriptLabel(this.activeSceneScriptObject)}".`);
    this.updateStatus(`Attached: ${this.getSceneScriptLabel(this.activeSceneScriptObject)}`);
    this.updateScriptList();
  }

  // ─── Runtime ───────────────────────────────────────
  private runScript(): void {
    const currentScript = this.getCurrentScriptDefinition();
    if (!currentScript) return;
    this.saveScript();

    // Create runtime if needed
    if (!this.runtime) {
      this.runtime = new ScriptingRuntime(this.editor.scene);
    }

    const selected = this.editor.state.selectedObject;
    const obj = this.activeSceneScriptObject ?? selected ?? this.editor.scene;

    const result = this.runtime.attach(obj, currentScript);
    if (result.errors.length > 0) {
      this.showErrors(result.errors);
      return;
    }

    this.clearErrors();
    this.runtime.start();
    this.appendLog('info', `Running "${currentScript.name}" on ${(obj.name) || 'scene root'}`);
    this.updateStatus(`▶ Running: ${currentScript.name}`);

    // Start update loop
    this.startUpdateLoop();
  }

  private stopScript(): void {
    const currentScript = this.getCurrentScriptDefinition();
    if (!this.runtime || !currentScript) return;
    this.runtime.detach(currentScript.id);
    this.appendLog('info', `Stopped "${currentScript.name}"`);
    this.updateStatus(this.activeSceneScriptObject
      ? `Attached: ${this.getSceneScriptLabel(this.activeSceneScriptObject)}`
      : `Editing: ${currentScript.name}`);
  }

  private attachToSelected(): void {
    const selected = this.editor.state.selectedObject;
    if (!selected || !this.activeScript) {
      this.appendLog('warn', 'Select an object and a script first.');
      return;
    }
    selected.userData.__luaScript = this.activeScript.code;
    this.appendLog('info', `Script "${this.activeScript.name}" attached to "${this.getSceneScriptLabel(selected)}"`);
    this.selectSceneScriptObject(selected);
  }

  private updateLoopId = 0;
  private startUpdateLoop(): void {
    if (this.updateLoopId) return;
    let lastTime = performance.now();
    const loop = () => {
      this.updateLoopId = requestAnimationFrame(loop);
      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      if (this.runtime) {
        this.runtime.update(delta, now / 1000);

        // Flush logs to UI
        for (const log of this.runtime.getLogs()) {
          this.appendLog(log.level, log.message);
        }
        this.runtime.clearLogs();
      }
    };
    loop();
  }

  // ─── UI Helpers ────────────────────────────────────
  private updateScriptList(): void {
    if (!this.scriptListEl) return;
    this.scriptListEl.innerHTML = '';

    // Also show scripts attached to scene objects
    const sceneScripts: { name: string; obj: THREE.Object3D }[] = [];
    this.editor.scene.traverse((obj) => {
      if (obj.userData.__luaScript) {
        sceneScripts.push({ name: obj.name || 'Object', obj });
      }
    });

    if (this.scripts.length === 0 && sceneScripts.length === 0) {
      this.scriptListEl.innerHTML = '<div style="color:#555;padding:12px;font-size:11px;text-align:center;">No scripts yet.<br>Click + to create one.</div>';
      return;
    }

    // Show scene-attached scripts first
    if (sceneScripts.length > 0) {
      const header = document.createElement('div');
      header.style.cssText = 'padding:4px 8px;font-size:9px;color:#58a6ff;text-transform:uppercase;letter-spacing:0.5px;';
      header.textContent = 'Scene Objects';
      this.scriptListEl.appendChild(header);

      for (const { name, obj } of sceneScripts) {
        const item = document.createElement('div');
        const isActive = this.activeSceneScriptObject === obj;
        item.style.cssText = `padding:6px 8px;border-radius:4px;cursor:pointer;font-size:11px;margin-bottom:2px;display:flex;align-items:center;gap:6px;${isActive ? 'background:#23403d;border-left:2px solid #42d392;' : ''}`;
        item.innerHTML = `<span>🔗</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>`;
        item.addEventListener('click', () => {
          this.selectSceneScriptObject(obj);
        });
        this.scriptListEl.appendChild(item);
      }
    }

    if (this.scripts.length > 0 && sceneScripts.length > 0) {
      const header = document.createElement('div');
      header.style.cssText = 'padding:4px 8px;font-size:9px;color:#f0ad4e;text-transform:uppercase;letter-spacing:0.5px;margin-top:6px;';
      header.textContent = 'Project Scripts';
      this.scriptListEl.appendChild(header);
    }

    for (const script of this.scripts) {
      const item = document.createElement('div');
      const isActive = script === this.activeScript;
      item.style.cssText = `padding:6px 8px;border-radius:4px;cursor:pointer;font-size:11px;margin-bottom:2px;display:flex;align-items:center;gap:6px;${isActive ? 'background:#2a3a5e;border-left:2px solid #58a6ff;' : ''}`;
      item.innerHTML = `<span>${script.enabled ? '📜' : '⏸'}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${script.name}</span>`;

      item.addEventListener('click', () => this.selectScript(script));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showScriptContextMenu(e.clientX, e.clientY, script);
      });
      this.scriptListEl.appendChild(item);
    }
  }

  private showNewScriptMenu(anchor: HTMLElement): void {
    document.querySelectorAll('.se-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'se-context-menu';
    const rect = anchor.getBoundingClientRect();
    menu.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.bottom + 2}px;background:#2a2a3a;border:1px solid #444;border-radius:4px;padding:4px 0;z-index:10000;min-width:180px;box-shadow:0 4px 12px #0008;`;

    // TypeScript templates
    const tsHeader = document.createElement('div');
    tsHeader.style.cssText = 'padding:3px 12px;font-size:9px;color:#7eb8ff;text-transform:uppercase;letter-spacing:0.5px;';
    tsHeader.textContent = 'TypeScript';
    menu.appendChild(tsHeader);

    for (const [name] of Object.entries(SCRIPT_TEMPLATES)) {
      const item = document.createElement('div');
      item.style.cssText = 'padding:5px 12px;cursor:pointer;font-size:11px;color:#ccc;';
      item.textContent = `📄 ${name}`;
      item.addEventListener('mouseenter', () => { item.style.background = '#3a3a5a'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      item.addEventListener('click', () => {
        this.createScript(name, name);
        menu.remove();
      });
      menu.appendChild(item);
    }

    // Lua templates
    const luaHeader = document.createElement('div');
    luaHeader.style.cssText = 'padding:3px 12px;font-size:9px;color:#a0d060;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;border-top:1px solid #333;';
    luaHeader.textContent = 'Lua (Phase 13)';
    menu.appendChild(luaHeader);

    for (const [name, code] of Object.entries(EXTENDED_LUA_TEMPLATES)) {
      const item = document.createElement('div');
      item.style.cssText = 'padding:5px 12px;cursor:pointer;font-size:11px;color:#ccc;';
      item.textContent = `🌙 ${name.replace('Lua: ', '')}`;
      item.addEventListener('mouseenter', () => { item.style.background = '#2a3a1a'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      item.addEventListener('click', () => {
        const script = this.createScript(name, 'Empty');
        script.code = code;
        this.setEditorValue(code);
        if (!this.luaMode) this._toggleLuaMode();
        menu.remove();
      });
      menu.appendChild(item);
    }

    document.body.appendChild(menu);
    setTimeout(() => {
      const removeFn = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('mousedown', removeFn); } };
      document.addEventListener('mousedown', removeFn);
    }, 0);
  }

  private showScriptContextMenu(x: number, y: number, script: ScriptDefinition): void {
    document.querySelectorAll('.se-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'se-context-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:#2a2a3a;border:1px solid #444;border-radius:4px;padding:4px 0;z-index:10000;min-width:140px;box-shadow:0 4px 12px #0008;`;

    const items = [
      { label: '✏️ Rename', action: () => { const n = prompt('New name:', script.name); if (n) { script.name = n; this.updateScriptList(); } } },
      { label: script.enabled ? '⏸ Disable' : '▶ Enable', action: () => { script.enabled = !script.enabled; this.updateScriptList(); } },
      { label: '📋 Duplicate', action: () => { const dup = this.createScript(script.name + ' (Copy)'); dup.code = script.code; this.setEditorValue(dup.code); } },
      { label: '🗑 Delete', action: () => this.deleteScript(script) },
    ];

    for (const item of items) {
      const el = document.createElement('div');
      el.style.cssText = 'padding:5px 12px;cursor:pointer;font-size:11px;color:#ccc;';
      el.textContent = item.label;
      el.addEventListener('mouseenter', () => { el.style.background = '#3a3a5a'; });
      el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; });
      el.addEventListener('click', () => { item.action(); menu.remove(); });
      menu.appendChild(el);
    }

    document.body.appendChild(menu);
    setTimeout(() => {
      const removeFn = (ev: MouseEvent) => { if (!menu.contains(ev.target as Node)) { menu.remove(); document.removeEventListener('mousedown', removeFn); } };
      document.addEventListener('mousedown', removeFn);
    }, 0);
  }

  private showErrors(errors: string[]): void {
    if (!this.errorEl) return;
    this.errorEl.style.display = 'block';
    this.errorEl.innerHTML = errors.map(e => `<div>❌ ${e}</div>`).join('');
  }

  private clearErrors(): void {
    if (!this.errorEl) return;
    this.errorEl.style.display = 'none';
    this.errorEl.innerHTML = '';
  }

  private appendLog(level: string, message: string): void {
    if (!this.logEl) return;
    // Clear placeholder
    if (this.logEl.children.length === 1 && this.logEl.firstElementChild?.textContent?.includes('Script output')) {
      this.logEl.innerHTML = '';
    }
    const colors: Record<string, string> = { info: '#aaa', warn: '#f39c12', error: '#e74c3c' };
    const line = document.createElement('div');
    line.style.cssText = `color:${colors[level] ?? '#aaa'};margin-bottom:1px;`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${message}`;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private updateStatus(text: string): void {
    const el = this.container?.querySelector('.se-status');
    if (el) el.textContent = text;
  }

  private bindToolbar(toolbar: HTMLElement): void {
    toolbar.querySelector('[data-action="save"]')?.addEventListener('click', () => this.saveScript());
    toolbar.querySelector('[data-action="run"]')?.addEventListener('click', () => this.runScript());
    toolbar.querySelector('[data-action="stop"]')?.addEventListener('click', () => this.stopScript());
    toolbar.querySelector('[data-action="attach"]')?.addEventListener('click', () => this.attachToSelected());
    // Phase 13: Lua buttons
    toolbar.querySelector('[data-action="runLua"]')?.addEventListener('click', () => this.runLuaScript());
    toolbar.querySelector('[data-action="debugLua"]')?.addEventListener('click', () => this._toggleLuaDebugPanel());
    // Hide Lua buttons initially (only shown in Lua mode)
    toolbar.querySelectorAll<HTMLElement>('.se-lua-btn').forEach(btn => { btn.style.display = 'none'; });
  }

  private addStyles(): void {
    if (document.getElementById('se-editor-styles')) return;
    const style = document.createElement('style');
    style.id = 'se-editor-styles';
    style.textContent = `
      .se-btn { padding:4px 10px; border-radius:3px; border:1px solid #444; background:#2a2a3a; color:#ccc; font-size:11px; cursor:pointer; transition:all 0.15s; white-space:nowrap; }
      .se-btn:hover { background:#3a3a4a; }
      .lua-bp-line { background: rgba(255,50,50,0.12) !important; }
      .lua-bp-glyph::before { content:'●'; color:#f44; font-size:12px; }
      .lua-paused-line { background: rgba(255,165,0,0.18) !important; }
      .lua-paused-glyph::before { content:'▶'; color:#fa0; font-size:12px; }
    `;
    document.head.appendChild(style);
  }

  private getCurrentScriptDefinition(): ScriptDefinition | null {
    if (this.activeScript) return this.activeScript;
    if (!this.activeSceneScriptObject) return null;
    return {
      id: this.getSceneScriptId(this.activeSceneScriptObject),
      name: this.getSceneScriptLabel(this.activeSceneScriptObject),
      code: this.getEditorValue(),
      enabled: true,
    };
  }

  private getSceneScriptCode(obj: THREE.Object3D): string {
    return typeof obj.userData.__luaScript === 'string'
      ? obj.userData.__luaScript
      : '// Attached script is empty\n';
  }

  private getSceneScriptId(obj: THREE.Object3D): string {
    return `scene_script_${obj.uuid}`;
  }

  private getSceneScriptLabel(obj: THREE.Object3D): string {
    return obj.name || 'Object';
  }

  dispose(): void {
    if (this.updateLoopId) cancelAnimationFrame(this.updateLoopId);
    this.updateLoopId = 0;
    this.monacoEditor?.dispose();
    this.monacoEditor = null;
    this.fallbackTextarea = null;
    this.editorContainer = null;
    this.scriptListEl = null;
    this.logEl = null;
    this.errorEl = null;
    this.container = null;
    document.getElementById('se-editor-styles')?.remove();
  }
}
