import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EditorSelectionController } from '../client/src/editor/EditorSelectionController';

describe('EditorSelectionController', () => {
  it('manages primary and multi-selection state', () => {
    const scene = new THREE.Scene();
    const state = {
      selectedObject: null,
      tool: 'translate',
      transformSpace: 'world',
      pivotMode: 'center',
      isPlaying: false,
      snapTranslate: 0,
      snapRotate: 0,
      snapScale: 0,
      showGrid: true,
      showWireframe: false,
      showBones: false,
      showBoundingBoxes: false,
      timelineMode: 'cinematic',
      edgeScale: false,
    } as const as any;
    const transformControls = {
      attach: vi.fn(),
      detach: vi.fn(),
    } as any;

    const controller = new EditorSelectionController({
      scene,
      state,
      camera: new THREE.PerspectiveCamera(),
      transformControls,
      refreshHierarchy: vi.fn(),
      refreshInspector: vi.fn(),
      isLocked: () => false,
      isEditorHelper: () => false,
      isTransformControlChild: () => false,
    });

    const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const b = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    a.name = 'A';
    b.name = 'B';
    scene.add(a, b);

    controller.select(a);
    controller.addToSelection(b);

    expect(state.selectedObject).toBe(b);
    expect(controller.getSelectedObjects().has(a)).toBe(true);
    expect(controller.getSelectedObjects().has(b)).toBe(true);
    expect(controller.getSelectionBoxes().size).toBe(2);

    controller.removeFromSelection(b);

    expect(controller.getSelectedObjects().has(b)).toBe(false);
  });
});