import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EditorCameraNavigationController } from '../client/src/editor/EditorCameraNavigationController';

describe('EditorCameraNavigationController', () => {
  it('focuses the editor camera on an object', () => {
    const editorCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
    const orbitControls = {
      target: new THREE.Vector3(),
      enabled: true,
      update: vi.fn(),
    };
    const controller = new EditorCameraNavigationController({
      editorCamera,
      orbitControls,
      setStatusMessage: vi.fn(),
    });

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    mesh.position.set(4, 1, -3);

    controller.focusObject(mesh);

    expect(orbitControls.target.toArray()).toEqual([4, 1, -3]);
    expect(orbitControls.update).toHaveBeenCalledOnce();
    expect(editorCamera.position.x).toBeGreaterThan(4);
  });

  it('previews a camera and restores editor state on exit', () => {
    const editorCamera = new THREE.PerspectiveCamera(75, 1, 0.5, 2000);
    editorCamera.position.set(1, 2, 3);
    const orbitControls = {
      target: new THREE.Vector3(4, 5, 6),
      enabled: true,
      update: vi.fn(),
    };
    const setStatusMessage = vi.fn();
    const controller = new EditorCameraNavigationController({
      editorCamera,
      orbitControls,
      setStatusMessage,
    });

    const previewCamera = new THREE.PerspectiveCamera(40, 1.5, 0.2, 800);
    previewCamera.position.set(10, 20, 30);
    previewCamera.lookAt(0, 0, 0);
    previewCamera.updateMatrixWorld(true);

    controller.previewCamera(previewCamera);

    expect(controller.isPreviewing()).toBe(true);
    expect(orbitControls.enabled).toBe(false);
    expect(editorCamera.position.toArray()).toEqual([10, 20, 30]);
    expect(editorCamera.fov).toBe(40);

    controller.exitPreview();

    expect(controller.isPreviewing()).toBe(false);
    expect(orbitControls.enabled).toBe(true);
    expect(editorCamera.position.toArray()).toEqual([1, 2, 3]);
    expect(editorCamera.fov).toBe(75);
    expect(orbitControls.target.toArray()).toEqual([4, 5, 6]);
    expect(setStatusMessage).toHaveBeenLastCalledWith('');
  });
});