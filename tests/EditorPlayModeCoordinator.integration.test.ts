// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EditorPlayModeCoordinator } from '../client/src/editor/EditorPlayModeCoordinator';

function createPhysicsSystem() {
  const state = { hasBody: false };
  return {
    enabled: false,
    scene: null as THREE.Scene | null,
    markTerrainDirty: vi.fn(),
    resetAllBodies: vi.fn(),
    rapier: {
      isReady: true,
      createBody: vi.fn(() => { state.hasBody = true; }),
      createCharacterController: vi.fn(),
      hasBody: vi.fn(() => state.hasBody),
      isCharacterGrounded: vi.fn(() => true),
      setBodyTransform: vi.fn(),
      moveCharacter: vi.fn(() => new THREE.Vector3(1, 0, 0)),
      removeBody: vi.fn(() => { state.hasBody = false; }),
    },
  };
}

describe('EditorPlayModeCoordinator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(document, 'pointerLockElement', {
      value: null,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document, 'exitPointerLock', {
      value: vi.fn(() => {
        (document as any).pointerLockElement = null;
      }),
      configurable: true,
    });
  });

  it('toggles engine and physics state across enter and exit', () => {
    const scene = new THREE.Scene();
    const editorCamera = new THREE.PerspectiveCamera();
    editorCamera.position.set(3, 4, 5);
    const orbitControls = { enabled: true, target: new THREE.Vector3(1, 2, 3), update: vi.fn() } as any;
    const helper = { visible: true };
    const transformControls = { getHelper: () => helper } as any;
    const canvas = document.createElement('canvas');
    canvas.requestPointerLock = vi.fn(() => {
      (document as any).pointerLockElement = canvas;
    });

    const physics = createPhysicsSystem();
    const engine = {
      editorActive: true,
      onUpdate: null,
      world: { getSystem: vi.fn(() => physics) },
    } as any;
    const onEnterPlayMode = vi.fn();
    const onExitPlayMode = vi.fn();

    const coordinator = new EditorPlayModeCoordinator({
      engine,
      scene,
      editorCamera,
      orbitControls,
      transformControls,
      editorCanvas: canvas,
      onEnterPlayMode,
      onExitPlayMode,
      requestStopPlayMode: vi.fn(),
    });

    coordinator.enter();
    editorCamera.position.set(20, 30, 40);
    orbitControls.target.set(9, 9, 9);
    coordinator.exit();

    expect(engine.editorActive).toBe(true);
    expect(physics.enabled).toBe(false);
    expect(physics.markTerrainDirty).toHaveBeenCalledOnce();
    expect(physics.resetAllBodies).toHaveBeenCalledOnce();
    expect(physics.rapier.createBody).toHaveBeenCalledOnce();
    expect(physics.rapier.removeBody).toHaveBeenCalledOnce();
    expect(onEnterPlayMode).toHaveBeenCalledOnce();
    expect(onExitPlayMode).toHaveBeenCalledOnce();
    expect(orbitControls.update).toHaveBeenCalledOnce();
    expect(editorCamera.position.toArray()).toEqual([3, 4, 5]);
    expect(helper.visible).toBe(true);
  });

  it('requests stop when Escape is pressed during play mode', () => {
    const physics = createPhysicsSystem();
    const requestStopPlayMode = vi.fn();
    const canvas = document.createElement('canvas');
    canvas.requestPointerLock = vi.fn();

    const coordinator = new EditorPlayModeCoordinator({
      engine: {
        editorActive: true,
        onUpdate: null,
        world: { getSystem: vi.fn(() => physics) },
      } as any,
      scene: new THREE.Scene(),
      editorCamera: new THREE.PerspectiveCamera(),
      orbitControls: { enabled: true, target: new THREE.Vector3(), update: vi.fn() } as any,
      transformControls: { getHelper: () => ({ visible: true }) } as any,
      editorCanvas: canvas,
      onEnterPlayMode: vi.fn(),
      onExitPlayMode: vi.fn(),
      requestStopPlayMode,
    });

    coordinator.enter();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    coordinator.teardown();

    expect(requestStopPlayMode).toHaveBeenCalledOnce();
  });

  it('calls the active runtime reset hook when entering play mode', () => {
    const physics = createPhysicsSystem();
    const resetState = vi.fn();
    const runtimeUpdate = Object.assign(vi.fn(), { resetState });

    const coordinator = new EditorPlayModeCoordinator({
      engine: {
        editorActive: true,
        onUpdate: runtimeUpdate,
        world: { getSystem: vi.fn(() => physics) },
      } as any,
      scene: new THREE.Scene(),
      editorCamera: new THREE.PerspectiveCamera(),
      orbitControls: { enabled: true, target: new THREE.Vector3(), update: vi.fn() } as any,
      transformControls: { getHelper: () => ({ visible: true }) } as any,
      editorCanvas: document.createElement('canvas'),
      onEnterPlayMode: vi.fn(),
      onExitPlayMode: vi.fn(),
      requestStopPlayMode: vi.fn(),
    });

    coordinator.enter();

    expect(resetState).toHaveBeenCalledOnce();
  });
});