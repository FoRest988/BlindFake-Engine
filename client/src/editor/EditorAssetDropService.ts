import * as THREE from 'three';
import type { DroppedEditorAsset } from './EditorViewportInputController';

interface LoadedModel {
  scene: THREE.Object3D;
  animations?: THREE.AnimationClip[];
}

export interface EditorAssetDropServiceDeps {
  loadModel: (path: string) => Promise<LoadedModel>;
  scene: THREE.Scene;
  onSelect: (object: THREE.Object3D) => void;
  onRefreshHierarchy: () => void;
  onRegisterMixer: (mixer: THREE.AnimationMixer) => void;
  resolveDropPoint: (event: DragEvent) => THREE.Vector3 | null;
}

export class EditorAssetDropService {
  private readonly deps: EditorAssetDropServiceDeps;

  constructor(deps: EditorAssetDropServiceDeps) {
    this.deps = deps;
  }

  async handleAssetDrop(asset: DroppedEditorAsset, event: DragEvent): Promise<void> {
    if (asset.type !== 'model' || !asset.path) return;
    const model = await this.deps.loadModel(asset.path);
    model.scene.name = asset.name?.replace(/\.[^.]+$/, '') || 'Model';
    model.scene.traverse((child: any) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        mat.needsUpdate = true;
        if (mat.map) { mat.map.colorSpace = THREE.SRGBColorSpace; mat.map.needsUpdate = true; }
        if (mat.emissiveMap) { mat.emissiveMap.colorSpace = THREE.SRGBColorSpace; mat.emissiveMap.needsUpdate = true; }
        if (mat.normalMap) mat.normalMap.needsUpdate = true;
        if (mat.roughnessMap) mat.roughnessMap.needsUpdate = true;
        if (mat.metalnessMap) mat.metalnessMap.needsUpdate = true;
        if (mat.aoMap) mat.aoMap.needsUpdate = true;
      }
    });

    const point = this.deps.resolveDropPoint(event);
    if (point) {
      model.scene.position.copy(point);
    }

    if (model.animations && model.animations.length > 0) {
      (model.scene as any).animations = model.animations;
      const mixer = new THREE.AnimationMixer(model.scene);
      for (const clip of model.animations) {
        const action = mixer.clipAction(clip);
        action.play();
        action.paused = true;
      }
      (model.scene as any)._editorMixer = mixer;
      this.deps.onRegisterMixer(mixer);
    }

    this.deps.scene.add(model.scene);
    this.deps.onSelect(model.scene);
    this.deps.onRefreshHierarchy();
  }
}