/**
 * EditorEventBus — typed wrapper over EventBus for standard editor events.
 *
 * Usage:
 *   import { editorEvents } from './EditorEventBus';
 *
 *   // Subscribe
 *   editorEvents.on('SelectionChanged', ({ object }) => { ... });
 *
 *   // Emit
 *   editorEvents.emit('SelectionChanged', { object: mesh, multi: [] });
 */

import * as THREE from 'three';
import { EventBus } from './EventBus';

// ── Typed event map ───────────────────────────────────────────────────────────

export interface EditorEventMap {
  /** Primary selection changed (null = deselected) */
  SelectionChanged: { object: THREE.Object3D | null; multi: THREE.Object3D[] };

  /** Scene graph was structurally modified (add/remove/rename) */
  SceneModified: { reason?: string };

  /** Play mode started */
  PlayModeEntered: Record<string, never>;

  /** Play mode stopped */
  PlayModeStopped: Record<string, never>;

  /** A preference value was changed */
  PreferenceChanged: { key: string; value: unknown };

  /** An asset was successfully imported into the project */
  AssetImported: { url: string; type: string; name: string };

  /** An asset was removed from the project */
  AssetRemoved: { url: string };

  /** Undo stack changed — consumers should refresh undo/redo button states */
  UndoStackChanged: { canUndo: boolean; canRedo: boolean };

  /** A scene was saved to disk/localStorage */
  SceneSaved: { projectId: string };

  /** A scene was loaded */
  SceneLoaded: { projectId: string };

  /** An entity in the ECS world was selected from the hierarchy */
  EntitySelected: { entityId: number | null };

  /** A transform gizmo drag finished — object moved/rotated/scaled */
  TransformCommitted: { object: THREE.Object3D };

  /** Tab was activated by user */
  TabActivated: { tabId: string };

  /** Console message logged */
  ConsoleMessage: { level: 'log' | 'warn' | 'error'; message: string };
}

export type EditorEventName = keyof EditorEventMap;

// ── Typed event bus ───────────────────────────────────────────────────────────

export class TypedEditorEventBus extends EventBus {
  /**
   * Subscribe to a typed editor event.
   * Returns an unsubscribe function.
   */
  onEditor<K extends EditorEventName>(
    event: K,
    callback: (payload: EditorEventMap[K]) => void,
    context?: unknown,
  ): () => void {
    return this.on(event, callback as (...args: unknown[]) => void, context);
  }

  /**
   * Subscribe once to a typed editor event.
   * Returns an unsubscribe function.
   */
  onceEditor<K extends EditorEventName>(
    event: K,
    callback: (payload: EditorEventMap[K]) => void,
    context?: unknown,
  ): () => void {
    return this.once(event, callback as (...args: unknown[]) => void, context);
  }

  /**
   * Unsubscribe a typed editor event listener.
   */
  offEditor<K extends EditorEventName>(
    event: K,
    callback: (payload: EditorEventMap[K]) => void,
    context?: unknown,
  ): void {
    this.off(event, callback as (...args: unknown[]) => void, context);
  }

  /**
   * Emit a typed editor event.
   */
  emitEditor<K extends EditorEventName>(event: K, payload: EditorEventMap[K]): void {
    this.emit(event, payload);
  }
}

/**
 * Singleton typed editor event bus.
 * Import and use this throughout the editor for decoupled communication.
 */
export const editorEvents = new TypedEditorEventBus();
