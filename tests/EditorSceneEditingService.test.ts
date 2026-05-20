import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { UndoManager } from '../client/src/editor/UndoManager';
import { EditorSceneEditingService } from '../client/src/editor/EditorSceneEditingService';

describe('EditorSceneEditingService', () => {
  it('adds uniquely named primitives and cameras without redundant helpers', () => {
    const scene = new THREE.Scene();
    const selected: { current: THREE.Object3D | null } = { current: null };
    const service = new EditorSceneEditingService({
      scene,
      camera: new THREE.PerspectiveCamera(),
      undo: new UndoManager(),
      getSelectedObject: () => selected.current,
      select: (object) => { selected.current = object; },
      refreshHierarchy: vi.fn(),
      isLocked: () => false,
      createSplinePath: vi.fn() as any,
      loadModelFromFiles: vi.fn() as any,
      registerMixer: vi.fn(),
      unregisterMixer: vi.fn(),
    });

    const cube = service.addPrimitive('cube');
    const duplicateCube = service.addPrimitive('cube');
    const camera = service.addCamera();

    expect(cube.name).toBe('Cube');
    expect(duplicateCube.name).toBe('Cube_2');
    expect(camera.name).toBe('Camera');
    expect(scene.children.some(child => child instanceof THREE.CameraHelper)).toBe(false);
  });

  it('duplicates animation-bearing objects and unregisters mixers on delete', () => {
    const scene = new THREE.Scene();
    const selected: { current: THREE.Object3D | null } = { current: null };
    const registerMixer = vi.fn();
    const unregisterMixer = vi.fn();
    const service = new EditorSceneEditingService({
      scene,
      camera: new THREE.PerspectiveCamera(),
      undo: new UndoManager(),
      getSelectedObject: () => selected.current,
      select: (object) => { selected.current = object; },
      refreshHierarchy: vi.fn(),
      isLocked: () => false,
      createSplinePath: vi.fn() as any,
      loadModelFromFiles: vi.fn() as any,
      registerMixer,
      unregisterMixer,
    });

    const original = new THREE.Group();
    original.name = 'Hero';
    (original as any).animations = [new THREE.AnimationClip('Idle', 1, [])];
    (original as any)._editorMixer = new THREE.AnimationMixer(original);
    scene.add(original);
    selected.current = original;

    const clone = service.duplicateSelected();

    expect(clone).toBeTruthy();
    expect(clone?.name).toBe('Hero_copy');
    expect(clone?.position.x).toBe(2);
    expect(registerMixer).toHaveBeenCalledOnce();
    expect((clone as any)._editorMixer).toBeTruthy();

    selected.current = original;
    service.deleteSelected();

    expect(unregisterMixer).toHaveBeenCalledOnce();
    expect(scene.children).not.toContain(original);
  });
});