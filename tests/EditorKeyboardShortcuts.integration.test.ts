// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { EditorKeyboardShortcuts } from '../client/src/editor/EditorKeyboardShortcuts';

describe('EditorKeyboardShortcuts', () => {
  it('routes keyboard commands to editor actions', () => {
    const deps = {
      onTranslate: vi.fn(),
      onRotate: vi.fn(),
      onScale: vi.fn(),
      onSelectTool: vi.fn(),
      onFocusSelected: vi.fn(),
      onDeleteSelected: vi.fn(),
      onExitCameraPreview: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onSaveScene: vi.fn(),
      onDuplicateSelected: vi.fn(),
      onSelectAll: vi.fn(),
      onTogglePlayMode: vi.fn(),
      onToggleSelectedVisibility: vi.fn(),
      onToggleGrid: vi.fn(),
      onToggleWireframe: vi.fn(),
      onToggleBones: vi.fn(),
    };

    const shortcuts = new EditorKeyboardShortcuts(deps);
    shortcuts.attach();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9' }));

    expect(deps.onTranslate).toHaveBeenCalledOnce();
    expect(deps.onUndo).toHaveBeenCalledOnce();
    expect(deps.onDuplicateSelected).toHaveBeenCalledOnce();
    expect(deps.onTogglePlayMode).toHaveBeenCalledOnce();

    shortcuts.detach();
  });
});