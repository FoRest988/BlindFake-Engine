import * as THREE from 'three';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { EditorState } from './EditorApp';

export interface EditorSelectionControllerDeps {
  scene: THREE.Scene;
  state: EditorState;
  camera: THREE.PerspectiveCamera;
  transformControls: TransformControls;
  refreshHierarchy: () => void;
  refreshInspector: () => void;
  isLocked: (object: THREE.Object3D) => boolean;
  isEditorHelper: (object: THREE.Object3D) => boolean;
  isTransformControlChild: (object: THREE.Object3D) => boolean;
}

export class EditorSelectionController {
  private readonly scene: THREE.Scene;
  private readonly state: EditorState;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly transformControls: TransformControls;
  private readonly refreshHierarchy: () => void;
  private readonly refreshInspector: () => void;
  private readonly isLocked: (object: THREE.Object3D) => boolean;
  private readonly isEditorHelper: (object: THREE.Object3D) => boolean;
  private readonly isTransformControlChild: (object: THREE.Object3D) => boolean;
  private readonly selectionBoxes = new Map<string, THREE.BoxHelper>();
  private readonly selectedObjects = new Set<THREE.Object3D>();
  private readonly boneHelpers: THREE.SkeletonHelper[] = [];
  private selectionBox: THREE.BoxHelper | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly mouse = new THREE.Vector2();

  constructor(deps: EditorSelectionControllerDeps) {
    this.scene = deps.scene;
    this.state = deps.state;
    this.camera = deps.camera;
    this.transformControls = deps.transformControls;
    this.refreshHierarchy = deps.refreshHierarchy;
    this.refreshInspector = deps.refreshInspector;
    this.isLocked = deps.isLocked;
    this.isEditorHelper = deps.isEditorHelper;
    this.isTransformControlChild = deps.isTransformControlChild;
  }

  getSelectedObjects(): ReadonlySet<THREE.Object3D> {
    return this.selectedObjects;
  }

  hasSelectedObject(object: THREE.Object3D): boolean {
    return this.selectedObjects.has(object);
  }

  getPrimarySelectionBox(): THREE.BoxHelper | null {
    return this.selectionBox;
  }

  getSelectionBoxes(): ReadonlyMap<string, THREE.BoxHelper> {
    return this.selectionBoxes;
  }

  getBoneHelpers(): readonly THREE.SkeletonHelper[] {
    return this.boneHelpers;
  }

  select(object: THREE.Object3D | null): void {
    this.clearSelectionBoxes();
    this.clearPrimarySelectionBox();
    this.clearBoneHelpers();
    this.state.selectedObject = object;

    if (object) {
      if (this.state.tool !== 'select' && !this.isLocked(object)) {
        this.transformControls.attach(object);
      } else {
        this.transformControls.detach();
      }
      this.selectionBox = new THREE.BoxHelper(object, 0x0078d4);
      this.scene.add(this.selectionBox);
      this.rebuildBoneHelpers(object);
    } else {
      this.transformControls.detach();
    }

    this.refreshHierarchy();
    this.refreshInspector();
  }

  addToSelection(object: THREE.Object3D): void {
    if (this.state.selectedObject && !this.selectedObjects.has(this.state.selectedObject)) {
      this.selectedObjects.add(this.state.selectedObject);
      this.ensureSelectionBox(this.state.selectedObject, 0x0078d4);
    }
    this.selectedObjects.add(object);
    this.ensureSelectionBox(object, 0x0078d4);
    this.state.selectedObject = object;
    if (this.state.tool !== 'select') {
      this.transformControls.attach(object);
    }
    this.clearPrimarySelectionBox();
    this.selectionBox = new THREE.BoxHelper(object, 0x00ff88);
    this.scene.add(this.selectionBox);
    this.refreshHierarchy();
    this.refreshInspector();
  }

  removeFromSelection(object: THREE.Object3D): void {
    this.selectedObjects.delete(object);
    const box = this.selectionBoxes.get(object.uuid);
    if (box) {
      this.scene.remove(box);
      this.selectionBoxes.delete(object.uuid);
    }
    if (this.state.selectedObject === object) {
      const remaining = Array.from(this.selectedObjects);
      if (remaining.length > 0) {
        this.state.selectedObject = remaining[remaining.length - 1];
        this.transformControls.attach(this.state.selectedObject);
      } else {
        this.select(null);
        return;
      }
    }
    this.refreshHierarchy();
    this.refreshInspector();
  }

  clearForPlayMode(): void {
    this.clearPrimarySelectionBox();
    this.clearSelectionBoxes();
    this.clearBoneHelpers();
    this.state.selectedObject = null;
    this.refreshHierarchy();
    this.refreshInspector();
  }

  setBonesVisible(visible: boolean): void {
    for (const helper of this.boneHelpers) {
      helper.visible = visible;
    }
    if (visible && this.state.selectedObject && this.boneHelpers.length === 0) {
      this.rebuildBoneHelpers(this.state.selectedObject);
    }
  }

  handleViewportClick(event: MouseEvent, viewportContainer: HTMLElement | null): void {
    if (!viewportContainer) return;
    const rect = viewportContainer.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const selectables: THREE.Object3D[] = [];
    this.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (this.isEditorHelper(child)) return;
      if (this.isTransformControlChild(child)) return;
      selectables.push(child);
    });

    const intersects = this.raycaster.intersectObjects(selectables, false);
    if (intersects.length === 0) {
      this.select(null);
      return;
    }

    let target = intersects[0].object;
    while (target.parent && target.parent !== this.scene) {
      target = target.parent;
    }

    if (event.ctrlKey) {
      if (this.selectedObjects.has(target)) {
        this.removeFromSelection(target);
      } else {
        this.addToSelection(target);
      }
      return;
    }

    this.select(target);
  }

  handleMarqueeSelect(startX: number, startY: number, endX: number, endY: number, viewportContainer: HTMLElement | null): void {
    if (!viewportContainer) return;
    const rect = viewportContainer.getBoundingClientRect();
    const ndcLeft = ((Math.min(startX, endX) - rect.left) / rect.width) * 2 - 1;
    const ndcRight = ((Math.max(startX, endX) - rect.left) / rect.width) * 2 - 1;
    const ndcTop = -((Math.min(startY, endY) - rect.top) / rect.height) * 2 + 1;
    const ndcBottom = -((Math.max(startY, endY) - rect.top) / rect.height) * 2 + 1;
    if (Math.abs(ndcRight - ndcLeft) < 0.01 && Math.abs(ndcTop - ndcBottom) < 0.01) return;

    const selected: THREE.Object3D[] = [];
    const seen = new Set<string>();
    this.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (this.isEditorHelper(child)) return;
      if (this.isTransformControlChild(child)) return;
      const pos = new THREE.Vector3();
      child.getWorldPosition(pos);
      pos.project(this.camera);

      let inside = false;
      if (pos.x >= ndcLeft && pos.x <= ndcRight && pos.y >= ndcBottom && pos.y <= ndcTop && pos.z > -1 && pos.z < 1) {
        inside = true;
      } else {
        const box = new THREE.Box3().setFromObject(child);
        const corners = [
          new THREE.Vector3(box.min.x, box.min.y, box.min.z),
          new THREE.Vector3(box.max.x, box.min.y, box.min.z),
          new THREE.Vector3(box.min.x, box.max.y, box.min.z),
          new THREE.Vector3(box.max.x, box.max.y, box.min.z),
          new THREE.Vector3(box.min.x, box.min.y, box.max.z),
          new THREE.Vector3(box.max.x, box.min.y, box.max.z),
          new THREE.Vector3(box.min.x, box.max.y, box.max.z),
          new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        ];
        for (const corner of corners) {
          corner.project(this.camera);
          if (corner.x >= ndcLeft && corner.x <= ndcRight && corner.y >= ndcBottom && corner.y <= ndcTop && corner.z > -1 && corner.z < 1) {
            inside = true;
            break;
          }
        }
      }

      if (!inside) return;
      let target: THREE.Object3D = child;
      while (target.parent && target.parent !== this.scene) {
        target = target.parent;
      }
      if (!seen.has(target.uuid)) {
        seen.add(target.uuid);
        selected.push(target);
      }
    });

    if (selected.length === 0) {
      this.select(null);
      return;
    }
    if (selected.length === 1) {
      this.select(selected[0]);
      return;
    }

    this.select(selected[0]);
    this.selectedObjects.add(selected[0]);
    for (let i = 1; i < selected.length; i++) {
      this.selectedObjects.add(selected[i]);
      this.ensureSelectionBox(selected[i], 0x0078d4);
    }
    if (this.state.tool !== 'select') {
      this.transformControls.attach(selected[0]);
    }
    this.refreshHierarchy();
  }

  private ensureSelectionBox(object: THREE.Object3D, color: number): void {
    if (this.selectionBoxes.has(object.uuid)) return;
    const box = new THREE.BoxHelper(object, color);
    this.scene.add(box);
    this.selectionBoxes.set(object.uuid, box);
  }

  private clearSelectionBoxes(): void {
    for (const box of this.selectionBoxes.values()) {
      this.scene.remove(box);
    }
    this.selectionBoxes.clear();
    this.selectedObjects.clear();
  }

  private clearPrimarySelectionBox(): void {
    if (!this.selectionBox) return;
    this.scene.remove(this.selectionBox);
    this.selectionBox = null;
  }

  private clearBoneHelpers(): void {
    for (const helper of this.boneHelpers) {
      this.scene.remove(helper);
    }
    this.boneHelpers.length = 0;
  }

  private rebuildBoneHelpers(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh && child.skeleton) {
        const helper = new THREE.SkeletonHelper(child);
        helper.visible = this.state.showBones;
        this.scene.add(helper);
        this.boneHelpers.push(helper);
      }
    });
  }
}