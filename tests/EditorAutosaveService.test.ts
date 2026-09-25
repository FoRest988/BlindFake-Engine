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
    const onSaved = vi.fn();
    const service = new EditorAutosaveService({
      projectId: 'proj-1',
      getPreferences: () => ({ autoSaveEnabled: true, autoSaveInterval: 30 }),
      getActiveScene: () => scene,
      serializeScene: () => ({ version: '1.0.0', name: 'Test', background: null, fog: null, objects: [], metadata: { generator: 'test', timestamp: 1, objectCount: 0 } }),
      restoreScene: vi.fn(),
      setStatusMessage,
      onSaved,
      storage,
      now: () => 12345,
    });

    service.perform();

    expect(storage.setItem).toHaveBeenCalledWith('blindfake_autosave:proj-1', expect.any(String));
    expect(storage.setItem).toHaveBeenCalledWith('blindfake_autosave_time:proj-1', '12345');
    expect(service.getLastAutosave()).toBe(12345);
    expect(setStatusMessage).toHaveBeenCalledWith('Autosaved');
    expect(onSaved).toHaveBeenCalledWith(expect.stringContaining('"name":"Test"'));
  });

  it('restores recent autosaves when confirmed', () => {
    const storage = createMemoryStorage();
    const scene = new THREE.Scene();
    const restoreScene = vi.fn();
    const setStatusMessage = vi.fn();
    const saved = { version: '1.0.0', name: 'Restore', background: null, fog: null, objects: [], metadata: { generator: 'test', timestamp: 1, objectCount: 0 } };
    storage.setItem('blindfake_autosave:proj-1', JSON.stringify(saved));
    storage.setItem('blindfake_autosave_time:proj-1', '55000');

    const service = new EditorAutosaveService({
      projectId: 'proj-1',
      getPreferences: () => ({ autoSaveEnabled: true, autoSaveInterval: 30 }),
      getActiveScene: () => scene,
      serializeScene: vi.fn() as any,
      restoreScene,
      setStatusMessage,
      storage,
      confirmRestore: () => true,
      now: () => 60000,
    });

    service.offerRestore();

    expect(restoreScene).toHaveBeenCalledOnce();
    expect(restoreScene).toHaveBeenCalledWith(saved);
    expect(setStatusMessage).toHaveBeenCalledWith('Autosave restored');
  });

  it('never offers another project\'s autosave', () => {
    const storage = createMemoryStorage();
    storage.setItem('blindfake_autosave:other', '{}');
    storage.setItem('blindfake_autosave_time:other', '55000');
    const confirmRestore = vi.fn(() => true);
    const restoreScene = vi.fn();

    const service = new EditorAutosaveService({
      projectId: 'proj-1',
      getPreferences: () => ({ autoSaveEnabled: true, autoSaveInterval: 30 }),
      getActiveScene: () => new THREE.Scene(),
      serializeScene: vi.fn() as any,
      restoreScene,
      setStatusMessage: vi.fn(),
      storage,
      confirmRestore,
      now: () => 60000,
    });

    service.offerRestore();

    expect(confirmRestore).not.toHaveBeenCalled();
    expect(restoreScene).not.toHaveBeenCalled();
  });
});