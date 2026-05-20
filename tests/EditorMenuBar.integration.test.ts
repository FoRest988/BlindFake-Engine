// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EditorMenuBar } from '../client/src/editor/panels/EditorMenuBar';

function createEditorStub() {
  const scene = new THREE.Scene();
  const objectA = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  objectA.name = 'ObjectA';
  const objectB = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  objectB.name = 'ObjectB';
  scene.add(objectA, objectB);

  const state = {
    selectedObject: null as THREE.Object3D | null,
    showGrid: true,
    showWireframe: false,
    showBones: false,
  };

  return {
    scene,
    state,
    engine: {
      scenes: { active: scene },
      debugOverlay: { toggle: vi.fn() },
    },
    undo: {
      undoLabel: '',
      redoLabel: '',
      canUndo: false,
      canRedo: false,
      undo: vi.fn(),
      redo: vi.fn(),
    },
    hierarchy: { refresh: vi.fn() },
    statusBar: { setMessage: vi.fn() },
    preferences: { toggle: vi.fn() },
    viewport: { setCameraViewPublic: vi.fn() },
    addPrimitive: vi.fn(),
    addLight: vi.fn(),
    addCamera: vi.fn(),
    addSplinePath: vi.fn(),
    addModel: vi.fn(),
    saveProject: vi.fn(),
    loadProject: vi.fn(),
    duplicateSelected: vi.fn(),
    deleteSelected: vi.fn(),
    focusSelected: vi.fn(),
    toggleWireframe: vi.fn(),
    toggleBones: vi.fn(),
    togglePanel: vi.fn(),
    switchTab: vi.fn(),
    toggleEngineSystems: vi.fn(),
    close: vi.fn(),
    addToSelection: vi.fn(),
    getSceneObjects: vi.fn(() => [objectA, objectB]),
    select: vi.fn((object: THREE.Object3D | null) => {
      state.selectedObject = object;
    }),
  };
}

function openMenu(container: HTMLElement, label: string): void {
  const menuButton = Array.from(container.querySelectorAll('.menubar-item')).find((element) => element.textContent === label) as HTMLElement | undefined;
  if (!menuButton) {
    throw new Error(`Menu ${label} not found`);
  }
  menuButton.click();
}

function clickDropdownItem(labelPart: string): HTMLElement {
  const item = Array.from(document.body.querySelectorAll('.menubar-dropdown-item')).find((element) =>
    element.textContent?.includes(labelPart)
  ) as HTMLElement | undefined;
  if (!item) {
    throw new Error(`Dropdown item containing ${labelPart} not found`);
  }
  item.click();
  return item;
}

describe('EditorMenuBar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('executes file and add menu actions through DOM clicks', () => {
    const editor = createEditorStub();
    const menuBar = new EditorMenuBar(editor as any);
    const container = menuBar.render();
    document.body.appendChild(container);

    openMenu(container, 'File');
    clickDropdownItem('New Scene');

    expect(editor.scene.children).toHaveLength(0);
    expect(editor.select).toHaveBeenCalledWith(null);
    expect(editor.hierarchy.refresh).toHaveBeenCalledOnce();
    expect(editor.statusBar.setMessage).toHaveBeenCalledWith('New scene created');

    openMenu(container, 'Add');
    clickDropdownItem('Cube');

    expect(editor.addPrimitive).toHaveBeenCalledWith('cube');
  });

  it('respects disabled edit actions and routes enabled ones correctly', () => {
    const editor = createEditorStub();
    const menuBar = new EditorMenuBar(editor as any);
    const container = menuBar.render();
    document.body.appendChild(container);

    openMenu(container, 'Edit');
    const disabledFocus = Array.from(document.body.querySelectorAll('.menubar-dropdown-item')).find((element) =>
      element.textContent?.includes('Focus Selected')
    ) as HTMLElement;

    expect(disabledFocus.classList.contains('disabled')).toBe(true);
    disabledFocus.click();
    expect(editor.focusSelected).not.toHaveBeenCalled();

    editor.state.selectedObject = editor.getSceneObjects()[0];

    openMenu(container, 'Edit');
    clickDropdownItem('Focus Selected');
    expect(editor.focusSelected).toHaveBeenCalledOnce();

    openMenu(container, 'Edit');
    clickDropdownItem('Select All');
    expect(editor.select).toHaveBeenCalledWith(editor.getSceneObjects()[0]);
    expect(editor.addToSelection).toHaveBeenCalledWith(editor.getSceneObjects()[1]);
  });
});