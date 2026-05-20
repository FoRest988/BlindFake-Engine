import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EditorAutosaveService } from '../client/src/editor/EditorAutosaveService';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

describe('EditorAutosaveService', () => {
  it('writes autosave data and status message', () => {
    const storage = createMemoryStorage();
    const scene = new THREE.Scene();
    const setStatusMessage = vi.fn();
    const service = new EditorAutosaveService({
      getPreferences: () => ({ autoSaveEnabled: true, autoSaveInterval: 30 }),
      getActiveScene: () => scene,
      serializeScene: () => ({ version: '1.0.0', name: 'Test', background: null, fog: null, objects: [], metadata: { generator: 'test', timestamp: 1, objectCount: 0 } }),
      deserializeScene: vi.fn(),
      rebuildHierarchy: vi.fn(),
      setStatusMessage,
      storage,
      now: () => 12345,
    });

    service.perform();

    expect(storage.setItem).toHaveBeenCalledWith('blindfake_autosave', expect.any(String));
    expect(storage.setItem).toHaveBeenCalledWith('blindfake_autosave_time', '12345');
    expect(service.getLastAutosave()).toBe(12345);
    expect(setStatusMessage).toHaveBeenCalledWith('Autosaved');
  });

  it('restores recent autosaves when confirmed', () => {
    const storage = createMemoryStorage();
    const scene = new THREE.Scene();
    const rebuildHierarchy = vi.fn();
    const deserializeScene = vi.fn();
    const setStatusMessage = vi.fn();
    storage.setItem('blindfake_autosave', JSON.stringify({ version: '1.0.0', name: 'Restore', background: null, fog: null, objects: [], metadata: { generator: 'test', timestamp: 1, objectCount: 0 } }));
    storage.setItem('blindfake_autosave_time', '55000');

    const service = new EditorAutosaveService({
      getPreferences: () => ({ autoSaveEnabled: true, autoSaveInterval: 30 }),
      getActiveScene: () => scene,
      serializeScene: vi.fn() as any,
      deserializeScene,
      rebuildHierarchy,
      setStatusMessage,
      storage,
      confirmRestore: () => true,
      now: () => 60000,
    });

    service.offerRestore();

    expect(deserializeScene).toHaveBeenCalledOnce();
    expect(rebuildHierarchy).toHaveBeenCalledOnce();
    expect(setStatusMessage).toHaveBeenCalledWith('Autosave restored');
  });
});