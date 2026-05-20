/**
 * EditorConsole — Console / Log panel for the editor.
 * Captures console.log/warn/error, custom engine events, and displays
 * them in a filterable, searchable panel at the bottom of the editor.
 */

import type { EditorApp } from '../EditorApp';
import * as THREE from 'three';

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  source?: string;
  count: number; // for collapsed duplicates
  stack?: string;
}

export class EditorConsole {
  private editor: EditorApp;
  private container!: HTMLElement;
  private logContainer!: HTMLElement;
  private filterInput!: HTMLInputElement;
  private commandInput!: HTMLInputElement;
  private logs: LogEntry[] = [];
  private maxLogs = 500;
  private autoScroll = true;
  private commandHistory: string[] = [];
  private historyIndex = -1;

  // Filters
  private showLog = true;
  private showInfo = true;
  private showWarn = true;
  private showError = true;
  private filterText = '';
  private collapseDuplicates = true;

  // Counts for badges
  private counts = { log: 0, info: 0, warn: 0, error: 0 };

  // Original console methods (for restoring)
  private originals: Record<string, (...args: unknown[]) => void> = {};

  // Console commands registry
  private commands: Record<string, { desc: string; fn: (args: string[]) => void }> = {};

  constructor(editor: EditorApp) {
    this.editor = editor;
    this.registerBuiltinCommands();
  }

  render(): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'editor-console';
    this.container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 8px;height:28px;min-height:28px;background:#2d2d2d;border-bottom:1px solid #333;';
    header.innerHTML = `
      <span style="font-size:11px;font-weight:600;color:#ddd;">CONSOLE</span>
      <span style="flex:1;"></span>
      <button data-filter="log" class="console-filter-btn active" title="Messages">
        💬 <span data-count="log">0</span>
      </button>
      <button data-filter="info" class="console-filter-btn active" title="Info">
        ℹ️ <span data-count="info">0</span>
      </button>
      <button data-filter="warn" class="console-filter-btn active" title="Warnings">
        ⚠️ <span data-count="warn">0</span>
      </button>
      <button data-filter="error" class="console-filter-btn active" title="Errors">
        ❌ <span data-count="error">0</span>
      </button>
      <span style="width:1px;height:16px;background:#444;"></span>
      <button data-action="collapse" class="console-filter-btn active" title="Collapse duplicates">
        🔗
      </button>
      <input type="text" placeholder="Filter..." class="console-search" />
      <button data-action="clear" class="console-filter-btn" title="Clear console">
        🗑️
      </button>
    `;
    this.container.appendChild(header);

    // Style filter buttons
    header.querySelectorAll('.console-filter-btn').forEach(btn => {
      (btn as HTMLElement).style.cssText = 'background:none;border:1px solid transparent;color:#888;cursor:pointer;padding:2px 6px;border-radius:3px;font-size:10px;display:flex;align-items:center;gap:3px;';
    });
    header.querySelectorAll('.console-filter-btn.active').forEach(btn => {
      (btn as HTMLElement).style.borderColor = '#555';
      (btn as HTMLElement).style.color = '#ccc';
    });

    const searchInput = header.querySelector('.console-search') as HTMLInputElement;
    searchInput.style.cssText = 'width:120px;padding:2px 6px;background:#1e1e1e;border:1px solid #444;color:#fff;font-size:10px;border-radius:3px;';
    this.filterInput = searchInput;

    // Log area
    this.logContainer = document.createElement('div');
    this.logContainer.className = 'console-log-area';
    this.logContainer.style.cssText = 'flex:1;overflow-y:auto;font-family:monospace;font-size:11px;padding:4px;';
    this.container.appendChild(this.logContainer);

    // Command input bar (like UE Output Log)
    const cmdBar = document.createElement('div');
    cmdBar.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 6px;background:#252525;border-top:1px solid #333;min-height:26px;';
    cmdBar.innerHTML = `<span style="color:#0078d4;font-size:11px;font-weight:600;">❯</span>`;
    this.commandInput = document.createElement('input');
    this.commandInput.type = 'text';
    this.commandInput.placeholder = 'Enter command... (type "help" for list)';
    this.commandInput.style.cssText = 'flex:1;padding:3px 6px;background:#1a1a1a;border:1px solid #444;color:#fff;font-family:monospace;font-size:11px;border-radius:2px;outline:none;';
    this.commandInput.addEventListener('keydown', (e) => this.handleCommandKey(e));
    this.commandInput.addEventListener('focus', () => { this.commandInput.style.borderColor = '#0078d4'; });
    this.commandInput.addEventListener('blur', () => { this.commandInput.style.borderColor = '#444'; });
    cmdBar.appendChild(this.commandInput);
    this.container.appendChild(cmdBar);

    this.bindEvents(header);
    this.interceptConsole();
    return this.container;
  }

  private bindEvents(header: HTMLElement): void {
    // Filter toggles
    header.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = (btn as HTMLElement).dataset.filter as LogLevel;
        this.toggleFilter(filter);
        (btn as HTMLElement).classList.toggle('active');
        const isActive = (btn as HTMLElement).classList.contains('active');
        (btn as HTMLElement).style.borderColor = isActive ? '#555' : 'transparent';
        (btn as HTMLElement).style.color = isActive ? '#ccc' : '#555';
        this.refreshView();
      });
    });

    // Clear
    header.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
      this.clear();
    });

    // Collapse toggle
    header.querySelector('[data-action="collapse"]')?.addEventListener('click', (e) => {
      this.collapseDuplicates = !this.collapseDuplicates;
      const btn = (e.currentTarget as HTMLElement);
      btn.classList.toggle('active', this.collapseDuplicates);
      btn.style.borderColor = this.collapseDuplicates ? '#555' : 'transparent';
      this.refreshView();
    });

    // Search filter
    this.filterInput.addEventListener('input', () => {
      this.filterText = this.filterInput.value.toLowerCase();
      this.refreshView();
    });
  }

  /** Intercept native console methods */
  private interceptConsole(): void {
    const levels: LogLevel[] = ['log', 'info', 'warn', 'error'];
    for (const level of levels) {
      this.originals[level] = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        // Call original
        this.originals[level](...args);
        // Capture
        const message = args.map(a => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a, null, 2); } catch { return String(a); }
        }).join(' ');

        this.push(level, message, level === 'error' ? new Error().stack : undefined);
      };
    }

    // Capture unhandled errors
    window.addEventListener('error', (e) => {
      this.push('error', `${e.message} (${e.filename}:${e.lineno})`, e.error?.stack);
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.push('error', `Unhandled Promise: ${e.reason}`, e.reason?.stack);
    });
  }

  /** Restore original console methods */
  restoreConsole(): void {
    for (const [level, fn] of Object.entries(this.originals)) {
      (console as unknown as Record<string, unknown>)[level] = fn;
    }
  }

  /** Add a log entry */
  push(level: LogLevel, message: string, stack?: string, source?: string): void {
    this.counts[level]++;

    // Collapse duplicates
    if (this.collapseDuplicates && this.logs.length > 0) {
      const last = this.logs[this.logs.length - 1];
      if (last.level === level && last.message === message) {
        last.count++;
        last.timestamp = Date.now();
        this.updateCountBadges();
        this.refreshView();
        return;
      }
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      source,
      count: 1,
      stack,
    };
    this.logs.push(entry);

    // Cap log count
    if (this.logs.length > this.maxLogs) {
      this.logs.splice(0, this.logs.length - this.maxLogs);
    }

    this.updateCountBadges();
    this.appendLogEntry(entry);
  }

  /** Engine-level log (bypasses console interception) */
  log(message: string, source?: string): void { this.push('log', message, undefined, source); }
  info(message: string, source?: string): void { this.push('info', message, undefined, source); }
  warn(message: string, source?: string): void { this.push('warn', message, undefined, source); }
  error(message: string, source?: string): void { this.push('error', message, new Error().stack, source); }

  private toggleFilter(level: LogLevel): void {
    switch (level) {
      case 'log': this.showLog = !this.showLog; break;
      case 'info': this.showInfo = !this.showInfo; break;
      case 'warn': this.showWarn = !this.showWarn; break;
      case 'error': this.showError = !this.showError; break;
    }
  }

  private isVisible(entry: LogEntry): boolean {
    if (entry.level === 'log' && !this.showLog) return false;
    if (entry.level === 'info' && !this.showInfo) return false;
    if (entry.level === 'warn' && !this.showWarn) return false;
    if (entry.level === 'error' && !this.showError) return false;
    if (this.filterText && !entry.message.toLowerCase().includes(this.filterText)) return false;
    return true;
  }

  private appendLogEntry(entry: LogEntry): void {
    if (!this.logContainer) return;
    if (!this.isVisible(entry)) return;

    const row = this.createLogRow(entry);
    this.logContainer.appendChild(row);

    if (this.autoScroll) {
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
  }

  private createLogRow(entry: LogEntry): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;padding:2px 4px;border-bottom:1px solid #2a2a2a;gap:6px;word-break:break-word;';

    const colors: Record<LogLevel, string> = {
      log: '#bbb',
      info: '#3498db',
      warn: '#f39c12',
      error: '#e74c3c',
    };
    const icons: Record<LogLevel, string> = {
      log: '💬',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
    };

    if (entry.level === 'error') row.style.background = '#3d1111';
    else if (entry.level === 'warn') row.style.background = '#3d3311';

    const time = new Date(entry.timestamp);
    const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`;

    row.innerHTML = `
      <span style="color:#555;min-width:55px;font-size:9px;">${timeStr}</span>
      <span style="min-width:16px;">${icons[entry.level]}</span>
      <span style="color:${colors[entry.level]};flex:1;white-space:pre-wrap;">${this.escapeHtml(entry.message)}</span>
      ${entry.count > 1 ? `<span style="background:#444;color:#ccc;padding:0 6px;border-radius:8px;font-size:9px;min-width:20px;text-align:center;">${entry.count}</span>` : ''}
      ${entry.source ? `<span style="color:#666;font-size:9px;">${this.escapeHtml(entry.source)}</span>` : ''}
    `;

    // Click to expand stack trace
    if (entry.stack) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        const existing = row.querySelector('.console-stack');
        if (existing) {
          existing.remove();
        } else {
          const stackEl = document.createElement('div');
          stackEl.className = 'console-stack';
          stackEl.style.cssText = 'color:#888;font-size:9px;padding:4px 0 4px 70px;white-space:pre-wrap;';
          stackEl.textContent = entry.stack!;
          row.appendChild(stackEl);
        }
      });
    }

    return row;
  }

  private refreshView(): void {
    if (!this.logContainer) return;
    this.logContainer.innerHTML = '';
    for (const entry of this.logs) {
      if (this.isVisible(entry)) {
        this.logContainer.appendChild(this.createLogRow(entry));
      }
    }
    if (this.autoScroll) {
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
  }

  private updateCountBadges(): void {
    if (!this.container) return;
    for (const level of ['log', 'info', 'warn', 'error'] as LogLevel[]) {
      const badge = this.container.querySelector(`[data-count="${level}"]`);
      if (badge) badge.textContent = String(this.counts[level]);
    }
  }

  clear(): void {
    this.logs.length = 0;
    this.counts = { log: 0, info: 0, warn: 0, error: 0 };
    this.updateCountBadges();
    if (this.logContainer) this.logContainer.innerHTML = '';
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Get all logs (for exporting/debugging) */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  // ── Command System ──

  /** Register a console command */
  registerCommand(name: string, desc: string, fn: (args: string[]) => void): void {
    this.commands[name.toLowerCase()] = { desc, fn };
  }

  private registerBuiltinCommands(): void {
    this.registerCommand('help', 'List all available commands', () => {
      this.push('info', '── Available Commands ──');
      for (const [name, cmd] of Object.entries(this.commands).sort((a, b) => a[0].localeCompare(b[0]))) {
        this.push('info', `  ${name} — ${cmd.desc}`);
      }
    });

    this.registerCommand('clear', 'Clear the console', () => {
      this.clear();
    });

    this.registerCommand('scene.list', 'List all objects in the scene', () => {
      const objs = this.editor.getSceneObjects();
      this.push('info', `Scene objects (${objs.length}):`);
      const listObj = (o: THREE.Object3D, depth: number) => {
        const indent = '  '.repeat(depth);
        this.push('info', `${indent}${o.name || 'Unnamed'} [${o.type}] uuid:${o.uuid.substring(0, 8)}`);
        o.children.forEach(c => listObj(c, depth + 1));
      };
      objs.forEach(o => listObj(o, 1));
    });

    this.registerCommand('scene.stats', 'Show scene statistics', () => {
      let meshes = 0, lights = 0, cameras = 0, triangles = 0, vertices = 0;
      this.editor.scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          meshes++;
          const geo = (obj as THREE.Mesh).geometry;
          if (geo.index) triangles += geo.index.count / 3;
          else if (geo.attributes.position) triangles += geo.attributes.position.count / 3;
          if (geo.attributes.position) vertices += geo.attributes.position.count;
        }
        if ((obj as THREE.Light).isLight) lights++;
        if ((obj as THREE.Camera).isCamera) cameras++;
      });
      this.push('info', `Meshes: ${meshes} | Lights: ${lights} | Cameras: ${cameras}`);
      this.push('info', `Triangles: ${Math.floor(triangles).toLocaleString()} | Vertices: ${vertices.toLocaleString()}`);
    });

    this.registerCommand('select', 'Select object by name (select <name>)', (args) => {
      const name = args.join(' ');
      if (!name) { this.push('warn', 'Usage: select <object name>'); return; }
      let found: THREE.Object3D | null = null;
      this.editor.scene.traverse(o => { if (o.name === name && !found) found = o; });
      if (found) { this.editor.select(found); this.push('info', `Selected: ${name}`); }
      else this.push('warn', `Object "${name}" not found`);
    });

    this.registerCommand('fps', 'Show current FPS', () => {
      const info = this.editor.engine.renderer.info;
      this.push('info', `Render calls: ${info.render.calls} | Triangles: ${info.render.triangles} | Programs: ${info.programs?.length ?? '?'}`);
    });

    this.registerCommand('gc', 'Force garbage collection of Three.js resources', () => {
      const info = this.editor.engine.renderer.info;
      const before = { geo: info.memory.geometries, tex: info.memory.textures };
      this.editor.engine.renderer.info.reset();
      this.push('info', `Memory — Geometries: ${before.geo} | Textures: ${before.tex}`);
    });

    this.registerCommand('cam.reset', 'Reset editor camera to default position', () => {
      this.editor.editorCamera.position.set(15, 12, 15);
      this.editor.editorCamera.lookAt(0, 0, 0);
      this.editor.orbitControls.target.set(0, 0, 0);
      this.editor.orbitControls.update();
      this.push('info', 'Camera reset to default position');
    });

    this.registerCommand('cam.pos', 'Show/set camera position (cam.pos [x y z])', (args) => {
      if (args.length >= 3) {
        const [x, y, z] = args.map(Number);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          this.editor.editorCamera.position.set(x, y, z);
          this.editor.orbitControls.update();
          this.push('info', `Camera position set to (${x}, ${y}, ${z})`);
        } else this.push('warn', 'Invalid numbers. Usage: cam.pos x y z');
      } else {
        const p = this.editor.editorCamera.position;
        this.push('info', `Camera at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
      }
    });

    this.registerCommand('obj.prop', 'Get/set property on selected object (obj.prop <key> [value])', (args) => {
      const obj = this.editor.state.selectedObject;
      if (!obj) { this.push('warn', 'No object selected'); return; }
      if (args.length === 0) { this.push('warn', 'Usage: obj.prop <key> [value]'); return; }
      const key = args[0];
      if (args.length === 1) {
        const val = (obj as unknown as Record<string, unknown>)[key];
        this.push('info', `${obj.name}.${key} = ${JSON.stringify(val)}`);
      } else {
        this.push('warn', 'Setting properties via console requires eval — use Inspector instead');
      }
    });

    this.registerCommand('wireframe', 'Toggle wireframe mode', () => {
      this.editor.state.showWireframe = !this.editor.state.showWireframe;
      this.editor.toggleWireframe();
      this.push('info', `Wireframe: ${this.editor.state.showWireframe ? 'ON' : 'OFF'}`);
    });

    this.registerCommand('grid', 'Toggle grid visibility', () => {
      this.editor.state.showGrid = !this.editor.state.showGrid;
      this.push('info', `Grid: ${this.editor.state.showGrid ? 'ON' : 'OFF'}`);
    });
  }

  private handleCommandKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      const cmd = this.commandInput.value.trim();
      if (!cmd) return;
      this.commandHistory.push(cmd);
      this.historyIndex = this.commandHistory.length;
      this.push('log', `> ${cmd}`);
      this.executeCommand(cmd);
      this.commandInput.value = '';
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.commandInput.value = this.commandHistory[this.historyIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
        this.commandInput.value = this.commandHistory[this.historyIndex];
      } else {
        this.historyIndex = this.commandHistory.length;
        this.commandInput.value = '';
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const partial = this.commandInput.value.toLowerCase();
      if (!partial) return;
      const matches = Object.keys(this.commands).filter(c => c.startsWith(partial));
      if (matches.length === 1) {
        this.commandInput.value = matches[0];
      } else if (matches.length > 1) {
        this.push('info', `Suggestions: ${matches.join(', ')}`);
      }
    }
    e.stopPropagation(); // Don't trigger editor shortcuts
  }

  private executeCommand(input: string): void {
    const parts = input.split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);
    const cmd = this.commands[name];
    if (cmd) {
      try { cmd.fn(args); }
      catch (err) { this.push('error', `Command error: ${err}`); }
    } else {
      this.push('warn', `Unknown command: "${name}". Type "help" for available commands.`);
    }
  }

  dispose(): void {
    this.restoreConsole();
    this.logs.length = 0;
  }
}
