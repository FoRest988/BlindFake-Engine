export interface EditorKeyboardShortcutsDeps {
  onTranslate: () => void;
  onRotate: () => void;
  onScale: () => void;
  onSelectTool: () => void;
  onFocusSelected: () => void;
  onDeleteSelected: () => void;
  onExitCameraPreview: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSaveScene: () => void;
  onDuplicateSelected: () => void;
  onSelectAll: () => void;
  onTogglePlayMode: () => void;
  onToggleSelectedVisibility: () => void;
  onToggleGrid: () => void;
  onToggleWireframe: () => void;
  onToggleBones: () => void;
}

// Import KeybindEditor lazily to avoid circular refs — we only need its type here
import type { KeybindEditor } from './KeybindEditor';

export class EditorKeyboardShortcuts {
  private readonly deps: EditorKeyboardShortcutsDeps;
  private _keybindEditor: KeybindEditor | null = null;

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'F11') {
      e.preventDefault();
      return;
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    // When a KeybindEditor is connected, delegate to it first.
    // It handles any user-defined rebindings and returns true if handled.
    if (this._keybindEditor && this._keybindEditor.handleKeyDown(e)) return;

    switch (e.key.toLowerCase()) {
      case 'w': this.deps.onTranslate(); break;
      case 'e': this.deps.onRotate(); break;
      case 'r': this.deps.onScale(); break;
      case 'q': this.deps.onSelectTool(); break;
      case 'f': this.deps.onFocusSelected(); break;
      case 'delete':
      case 'backspace': this.deps.onDeleteSelected(); break;
      case 'escape': this.deps.onExitCameraPreview(); break;
      case 'z':
        if (e.ctrlKey && e.shiftKey) {
          e.preventDefault();
          this.deps.onRedo();
        } else if (e.ctrlKey) {
          e.preventDefault();
          this.deps.onUndo();
        }
        break;
      case 'y':
        if (e.ctrlKey) {
          e.preventDefault();
          this.deps.onRedo();
        }
        break;
      case 's':
        if (e.ctrlKey) {
          e.preventDefault();
          this.deps.onSaveScene();
        }
        break;
      case 'd':
        if (e.ctrlKey) {
          e.preventDefault();
          this.deps.onDuplicateSelected();
        }
        break;
      case 'a':
        if (e.ctrlKey) {
          e.preventDefault();
          this.deps.onSelectAll();
        }
        break;
      case 'f9':
        e.preventDefault();
        this.deps.onTogglePlayMode();
        break;
      case 'h': this.deps.onToggleSelectedVisibility(); break;
      case 'g': this.deps.onToggleGrid(); break;
      case '1': this.deps.onToggleWireframe(); break;
      case '2': this.deps.onToggleBones(); break;
    }
  };

  constructor(deps: EditorKeyboardShortcutsDeps) {
    this.deps = deps;
  }

  /**
   * Connect a KeybindEditor so that user-defined rebindings take effect.
   * After calling this, the KeybindEditor will be consulted on every keydown
   * event before the built-in switch/case handler.
   *
   * @example
   *   const kb = new KeybindEditor();
   *   kb.registerAll(deps);
   *   shortcuts.useKeybindEditor(kb);
   */
  useKeybindEditor(kb: KeybindEditor): void {
    this._keybindEditor = kb;
  }

  attach(): void {
    window.addEventListener('keydown', this.onKey);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKey);
  }
}