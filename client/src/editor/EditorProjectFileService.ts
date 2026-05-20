import * as THREE from 'three';
import { SceneSerializer, type SerializedScene } from '../engine/SceneSerialization';

export interface EditorProjectGraphData {
  nodes?: unknown[];
  connections?: unknown[];
  variables?: unknown[];
  comments?: unknown[];
}

export interface EditorProjectFileData {
  version: string;
  engine: string;
  timestamp: number;
  scene: SerializedScene;
  textures: Record<string, { data: string; flipY: boolean; colorSpace: string }>;
  blueprints: EditorProjectGraphData;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
  };
}

export interface EditorProjectApplyDeps {
  scene: THREE.Scene;
  getSceneObjects: () => THREE.Object3D[];
  graph: EditorProjectGraphData;
  camera: THREE.PerspectiveCamera;
  orbitTarget: THREE.Vector3;
  createTexture?: (dataUrl: string) => THREE.Texture;
}

export class EditorProjectFileService {
  createProjectData(scene: THREE.Scene, graph: EditorProjectGraphData, camera: THREE.PerspectiveCamera, orbitTarget: THREE.Vector3): EditorProjectFileData {
    return {
      version: '1.0.0',
      engine: 'BlindFake',
      timestamp: Date.now(),
      scene: SceneSerializer.serialize(scene),
      textures: this.captureTextures(scene),
      blueprints: {
        nodes: graph.nodes || [],
        connections: graph.connections || [],
        variables: graph.variables || [],
        comments: graph.comments || [],
      },
      camera: {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [orbitTarget.x, orbitTarget.y, orbitTarget.z],
      },
    };
  }

  applyProjectData(project: EditorProjectFileData, deps: EditorProjectApplyDeps): void {
    deps.getSceneObjects().forEach((object) => deps.scene.remove(object));

    const textureCache = new Map<string, THREE.Texture>();
    for (const [uuid, entry] of Object.entries(project.textures || {})) {
      const texture = (deps.createTexture ?? ((dataUrl: string) => new THREE.TextureLoader().load(dataUrl)))(entry.data);
      texture.colorSpace = entry.colorSpace || THREE.SRGBColorSpace;
      texture.flipY = entry.flipY ?? true;
      texture.needsUpdate = true;
      textureCache.set(uuid, texture);
    }

    const loaded = SceneSerializer.deserialize(project.scene, undefined, textureCache);
    while (loaded.children.length > 0) {
      deps.scene.add(loaded.children[0]);
    }

    deps.graph.nodes = project.blueprints?.nodes || [];
    deps.graph.connections = project.blueprints?.connections || [];
    deps.graph.variables = project.blueprints?.variables || [];
    deps.graph.comments = project.blueprints?.comments || [];
    deps.camera.position.set(...project.camera.position);
    deps.orbitTarget.set(...project.camera.target);
  }

  private captureTextures(scene: THREE.Scene): Record<string, { data: string; flipY: boolean; colorSpace: string }> {
    const textureMap: Record<string, { data: string; flipY: boolean; colorSpace: string }> = {};
    scene.traverse((obj: THREE.Object3D) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        const textures = [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.emissiveMap, mat.aoMap];
        for (const tex of textures) {
          if (!tex || textureMap[tex.uuid]) continue;
          try {
            const img = tex.image;
            if (!img) continue;
            const w = img.width || img.naturalWidth || 256;
            const h = img.height || img.naturalHeight || 256;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            ctx.drawImage(img, 0, 0, w, h);
            textureMap[tex.uuid] = {
              data: canvas.toDataURL('image/png'),
              flipY: tex.flipY,
              colorSpace: tex.colorSpace,
            };
          } catch {
            // Ignore non-drawable textures.
          }
        }
      }
    });
    return textureMap;
  }
}