import * as THREE from 'three';
import { AddObjectCommand, RemoveObjectCommand, UndoManager } from './UndoManager';
import type { SplinePath } from '../engine/SplinePathSystem';

export type EditorPrimitiveType = 'cube' | 'sphere' | 'plane' | 'cylinder' | 'capsule' | 'cone' | 'torus';
export type EditorLightType = 'directional' | 'point' | 'spot' | 'ambient';
export type EditorSplinePathType = 'movement' | 'collision' | 'camera' | 'generic';

export interface EditorSceneEditingServiceDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  undo: UndoManager;
  getSelectedObject: () => THREE.Object3D | null;
  select: (object: THREE.Object3D | null) => void;
  refreshHierarchy: () => void;
  isLocked: (object: THREE.Object3D) => boolean;
  createSplinePath: (config: {
    name: string;
    points: THREE.Vector3[];
    closed: boolean;
    type: EditorSplinePathType;
  }) => SplinePath;
  loadModelFromFiles: (files: FileList | File[]) => Promise<{
    scene: THREE.Group;
    animations?: THREE.AnimationClip[];
  }>;
  registerMixer: (mixer: THREE.AnimationMixer) => void;
  unregisterMixer: (mixer: THREE.AnimationMixer) => void;
}

export class EditorSceneEditingService {
  constructor(private readonly deps: EditorSceneEditingServiceDeps) {}

  addPrimitive(type: EditorPrimitiveType): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    switch (type) {
      case 'cube': geometry = new THREE.BoxGeometry(1, 1, 1); break;
      case 'sphere': geometry = new THREE.SphereGeometry(0.5, 32, 32); break;
      case 'plane': geometry = new THREE.PlaneGeometry(10, 10); break;
      case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
      case 'capsule': geometry = new THREE.CapsuleGeometry(0.3, 0.8, 8, 16); break;
      case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 32); break;
      case 'torus': geometry = new THREE.TorusGeometry(0.5, 0.2, 16, 32); break;
    }

    const material = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = this.uniqueName(type.charAt(0).toUpperCase() + type.slice(1));
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (type === 'plane') {
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = false;
    }

    this.deps.undo.execute(new AddObjectCommand(this.deps.scene, mesh));
    this.deps.select(mesh);
    this.deps.refreshHierarchy();
    return mesh;
  }

  addLight(type: EditorLightType): THREE.Light {
    let light: THREE.Light;
    switch (type) {
      case 'directional':
        light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(10, 20, 10);
        (light as THREE.DirectionalLight).castShadow = true;
        break;
      case 'point':
        light = new THREE.PointLight(0xffffff, 1, 50);
        light.position.set(0, 5, 0);
        break;
      case 'spot':
        light = new THREE.SpotLight(0xffffff, 1);
        light.position.set(0, 10, 0);
        break;
      case 'ambient':
        light = new THREE.AmbientLight(0x404040, 0.5);
        break;
    }
    light.name = this.uniqueName(type.charAt(0).toUpperCase() + type.slice(1) + 'Light');
    this.deps.undo.execute(new AddObjectCommand(this.deps.scene, light));
    this.deps.select(light);
    this.deps.refreshHierarchy();
    return light;
  }

  addCamera(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    camera.name = this.uniqueName('Camera');
    camera.position.set(0, 5, 10);

    this.deps.undo.execute(new AddObjectCommand(this.deps.scene, camera));
    this.deps.select(camera);
    this.deps.refreshHierarchy();
    return camera;
  }

  addSplinePath(type: EditorSplinePathType = 'movement'): SplinePath {
    const name = `Spline_${type}_${Date.now().toString(36)}`;
    const cameraPosition = this.deps.camera.position;
    const cameraDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(this.deps.camera.quaternion);
    const center = cameraPosition.clone().add(cameraDirection.multiplyScalar(5));
    const points = [
      new THREE.Vector3(center.x - 3, 0, center.z),
      new THREE.Vector3(center.x, 0, center.z - 3),
      new THREE.Vector3(center.x + 3, 0, center.z),
      new THREE.Vector3(center.x, 0, center.z + 3),
    ];

    const path = this.deps.createSplinePath({
      name,
      points,
      closed: type === 'collision',
      type,
    });

    if (type === 'collision') {
      path.generateCollisionWall(3);
    }

    this.deps.refreshHierarchy();
    return path;
  }

  async addModel(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf,.bin,.png,.jpg,.jpeg';
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) return;
      await this.importModelFiles(files);
    };
    input.click();
  }

  async importModelFiles(files: FileList | File[]): Promise<THREE.Group | null> {
    const normalizedFiles = Array.isArray(files) ? files : Array.from(files);
    if (normalizedFiles.length === 0) return null;

    try {
      const model = await this.deps.loadModelFromFiles(Array.isArray(files) ? normalizedFiles : files);
      const modelFile = normalizedFiles.find(file => {
        const name = file.name.toLowerCase();
        return name.endsWith('.glb') || name.endsWith('.gltf');
      });
      model.scene.name = (modelFile || normalizedFiles[0]).name.replace(/\.[^.]+$/, '');

      model.scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.castShadow = true;
        child.receiveShadow = true;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          material.needsUpdate = true;
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          const srgbMaps: (THREE.Texture | null)[] = [material.map, material.emissiveMap];
          for (const texture of srgbMaps) {
            if (!texture) continue;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;
          }

          const linearMaps: (THREE.Texture | null)[] = [material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap];
          for (const texture of linearMaps) {
            if (!texture) continue;
            texture.needsUpdate = true;
          }
        }
      });

      if (model.animations && model.animations.length > 0) {
        (model.scene as any).animations = model.animations;
        const mixer = new THREE.AnimationMixer(model.scene);
        for (const clip of model.animations) {
          mixer.clipAction(clip).play();
        }
        this.deps.registerMixer(mixer);
        (model.scene as any)._editorMixer = mixer;
      }

      this.deps.scene.add(model.scene);
      this.deps.select(model.scene);
      this.deps.refreshHierarchy();
      return model.scene;
    } catch (error) {
      console.error('Failed to load model:', error);
      return null;
    }
  }

  deleteSelected(): void {
    const selectedObject = this.deps.getSelectedObject();
    if (!selectedObject) return;
    if (this.deps.isLocked(selectedObject)) return;

    const mixer = (selectedObject as any)._editorMixer as THREE.AnimationMixer | undefined;
    if (mixer) {
      mixer.stopAllAction();
      this.deps.unregisterMixer(mixer);
    }

    this.deps.select(null);
    this.deps.undo.execute(new RemoveObjectCommand(selectedObject));
    this.deps.refreshHierarchy();
  }

  duplicateSelected(): THREE.Object3D | null {
    const selectedObject = this.deps.getSelectedObject();
    if (!selectedObject) return null;
    if (this.deps.isLocked(selectedObject)) return null;

    const clone = selectedObject.clone(true);
    clone.name = this.uniqueName(`${selectedObject.name || selectedObject.type}_copy`);
    clone.position.x += 2;

    const animations = (selectedObject as any).animations as THREE.AnimationClip[] | undefined;
    if (animations && animations.length > 0) {
      (clone as any).animations = animations;
      const mixer = new THREE.AnimationMixer(clone);
      for (const clip of animations) {
        mixer.clipAction(clip).play();
      }
      this.deps.registerMixer(mixer);
      (clone as any)._editorMixer = mixer;
    }

    this.deps.undo.execute(new AddObjectCommand(this.deps.scene, clone));
    this.deps.select(clone);
    this.deps.refreshHierarchy();
    return clone;
  }

  private uniqueName(base: string): string {
    const names = new Set<string>();
    this.deps.scene.traverse((object) => names.add(object.name));
    if (!names.has(base)) return base;

    let index = 2;
    while (names.has(`${base}_${index}`)) {
      index++;
    }
    return `${base}_${index}`;
  }
}