/**
 * BuildExportSystem — Packages the game project for distribution:
 * - Bundles assets (textures, models, audio) into optimized blobs
 * - Generates standalone HTML with embedded JS
 * - Scene serialization / deserialization
 * - Asset manifest generation
 * - Export to ZIP download
 */

import * as THREE from 'three';
import { ElectronExporter } from './ElectronExporter';

/* ─── Types ─────────────────────────────────────────── */

export interface AssetRef {
  id: string;
  type: 'texture' | 'model' | 'audio' | 'script' | 'scene' | 'material' | 'prefab';
  path: string;
  size?: number;
}

export interface SceneData {
  name: string;
  objects: SerializedObject[];
  environment?: {
    fog?: { color: string; density: number };
    ambient?: { color: string; intensity: number };
    skyColor?: string;
  };
}

export interface SerializedObject {
  uuid: string;
  name: string;
  type: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
  userData: Record<string, unknown>;
  children: SerializedObject[];
  // Type-specific
  geometry?: string;
  material?: SerializedMaterial;
  light?: {
    type: string;
    color: string;
    intensity: number;
    distance?: number;
    decay?: number;
    angle?: number;
    penumbra?: number;
    castShadow: boolean;
  };
  camera?: {
    type: string;
    fov?: number;
    near: number;
    far: number;
  };
}

export interface SerializedMaterial {
  type: string;
  color?: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  transparent?: boolean;
  map?: string;
  normalMap?: string;
  roughnessMap?: string;
  metalnessMap?: string;
}

export interface BuildConfig {
  projectName: string;
  version: string;
  entryScene: string;
  resolution: { width: number; height: number };
  antialias: boolean;
  shadows: boolean;
  physics: boolean;
  includeEditor: boolean;
  compressionLevel: 'none' | 'medium' | 'high';
  targetPlatform: 'web' | 'electron' | 'mobile';
}

export interface BuildResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  files: { name: string; data: Blob; size: number }[];
  totalSize: number;
  buildTime: number;
}

/* ─── Scene Serializer ─────────────────────────────── */

export class SceneSerializer {

  /** Serialize a Three.js scene to JSON-safe data */
  static serializeScene(scene: THREE.Scene, name: string = 'Untitled'): SceneData {
    const data: SceneData = {
      name,
      objects: [],
    };

    // Environment
    if (scene.fog instanceof THREE.FogExp2) {
      data.environment = {
        fog: { color: '#' + scene.fog.color.getHexString(), density: scene.fog.density },
      };
    }

    // Serialize children (skip helpers, cameras used by editor)
    for (const child of scene.children) {
      if (child.userData.__editorOnly) continue;
      const serialized = this.serializeObject(child);
      if (serialized) data.objects.push(serialized);
    }

    return data;
  }

  /** Deserialize scene data back to Three.js objects */
  static deserializeScene(data: SceneData, scene: THREE.Scene): void {
    // Environment
    if (data.environment?.fog) {
      scene.fog = new THREE.FogExp2(data.environment.fog.color, data.environment.fog.density);
    }
    if (data.environment?.ambient) {
      const ambient = new THREE.AmbientLight(data.environment.ambient.color, data.environment.ambient.intensity);
      scene.add(ambient);
    }

    // Rebuild objects
    for (const objData of data.objects) {
      const obj = this.deserializeObject(objData);
      if (obj) scene.add(obj);
    }
  }

  private static serializeObject(obj: THREE.Object3D): SerializedObject | null {
    const data: SerializedObject = {
      uuid: obj.uuid,
      name: obj.name,
      type: obj.type,
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      visible: obj.visible,
      userData: {},
      children: [],
    };

    // Copy serializable userData only
    for (const [key, value] of Object.entries(obj.userData)) {
      if (key.startsWith('__')) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
        data.userData[key] = value;
      }
    }

    // Material
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
      const mat = obj.material;
      data.material = {
        type: 'MeshStandardMaterial',
        color: '#' + mat.color.getHexString(),
        roughness: mat.roughness,
        metalness: mat.metalness,
        emissive: '#' + mat.emissive.getHexString(),
        emissiveIntensity: mat.emissiveIntensity,
        opacity: mat.opacity,
        transparent: mat.transparent,
      };
    }

    // Light
    if (obj instanceof THREE.Light) {
      data.light = {
        type: obj.type,
        color: '#' + obj.color.getHexString(),
        intensity: obj.intensity,
        castShadow: obj.castShadow,
      };
      if (obj instanceof THREE.PointLight) {
        data.light.distance = obj.distance;
        data.light.decay = obj.decay;
      }
      if (obj instanceof THREE.SpotLight) {
        data.light.angle = obj.angle;
        data.light.penumbra = obj.penumbra;
        data.light.distance = obj.distance;
      }
    }

    // Camera
    if (obj instanceof THREE.PerspectiveCamera) {
      data.camera = {
        type: 'PerspectiveCamera',
        fov: obj.fov,
        near: obj.near,
        far: obj.far,
      };
    }

    // Geometry type
    if (obj instanceof THREE.Mesh && obj.geometry) {
      data.geometry = obj.geometry.type;
    }

    // Children
    for (const child of obj.children) {
      if (child.userData.__editorOnly) continue;
      const childData = this.serializeObject(child);
      if (childData) data.children.push(childData);
    }

    return data;
  }

  private static deserializeObject(data: SerializedObject): THREE.Object3D | null {
    let obj: THREE.Object3D;

    if (data.light) {
      obj = this.createLight(data);
    } else if (data.camera) {
      obj = this.createCamera(data);
    } else if (data.geometry) {
      obj = this.createMesh(data);
    } else {
      obj = new THREE.Group();
    }

    obj.name = data.name;
    obj.position.set(...data.position);
    obj.rotation.set(...data.rotation);
    obj.scale.set(...data.scale);
    obj.visible = data.visible;
    Object.assign(obj.userData, data.userData);

    for (const childData of data.children) {
      const child = this.deserializeObject(childData);
      if (child) obj.add(child);
    }

    return obj;
  }

  private static createLight(data: SerializedObject): THREE.Light {
    const { light } = data;
    if (!light) return new THREE.AmbientLight();

    switch (light.type) {
      case 'DirectionalLight': {
        const l = new THREE.DirectionalLight(light.color, light.intensity);
        l.castShadow = light.castShadow;
        return l;
      }
      case 'PointLight': {
        const l = new THREE.PointLight(light.color, light.intensity, light.distance, light.decay);
        l.castShadow = light.castShadow;
        return l;
      }
      case 'SpotLight': {
        const l = new THREE.SpotLight(light.color, light.intensity, light.distance, light.angle, light.penumbra);
        l.castShadow = light.castShadow;
        return l;
      }
      default:
        return new THREE.AmbientLight(light.color, light.intensity);
    }
  }

  private static createCamera(data: SerializedObject): THREE.Camera {
    const { camera } = data;
    if (!camera) return new THREE.PerspectiveCamera();
    return new THREE.PerspectiveCamera(camera.fov ?? 75, 16 / 9, camera.near, camera.far);
  }

  private static createMesh(data: SerializedObject): THREE.Mesh {
    let geo: THREE.BufferGeometry;
    switch (data.geometry) {
      case 'BoxGeometry': geo = new THREE.BoxGeometry(); break;
      case 'SphereGeometry': geo = new THREE.SphereGeometry(); break;
      case 'CylinderGeometry': geo = new THREE.CylinderGeometry(); break;
      case 'PlaneGeometry': geo = new THREE.PlaneGeometry(); break;
      case 'ConeGeometry': geo = new THREE.ConeGeometry(); break;
      case 'TorusGeometry': geo = new THREE.TorusGeometry(); break;
      default: geo = new THREE.BoxGeometry(); break;
    }

    let mat: THREE.Material;
    if (data.material) {
      mat = new THREE.MeshStandardMaterial({
        color: data.material.color,
        roughness: data.material.roughness ?? 0.5,
        metalness: data.material.metalness ?? 0,
        emissive: data.material.emissive,
        emissiveIntensity: data.material.emissiveIntensity ?? 0,
        opacity: data.material.opacity ?? 1,
        transparent: data.material.transparent ?? false,
      });
    } else {
      mat = new THREE.MeshStandardMaterial();
    }

    return new THREE.Mesh(geo, mat);
  }
}

/* ─── Asset Manifest ───────────────────────────────── */

export class AssetManifest {
  private assets: Map<string, AssetRef> = new Map();

  add(ref: AssetRef): void {
    this.assets.set(ref.id, ref);
  }

  remove(id: string): void {
    this.assets.delete(id);
  }

  getAll(): AssetRef[] {
    return Array.from(this.assets.values());
  }

  getByType(type: AssetRef['type']): AssetRef[] {
    return this.getAll().filter(a => a.type === type);
  }

  toJSON(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }

  fromJSON(json: string): void {
    this.assets.clear();
    const items: AssetRef[] = JSON.parse(json);
    for (const item of items) {
      this.assets.set(item.id, item);
    }
  }
}

/* ─── Build System ─────────────────────────────────── */

export class BuildSystem {
  private config: BuildConfig;
  private manifest: AssetManifest;

  constructor(config?: Partial<BuildConfig>) {
    this.config = {
      projectName: config?.projectName ?? 'MyGame',
      version: config?.version ?? '1.0.0',
      entryScene: config?.entryScene ?? 'main',
      resolution: config?.resolution ?? { width: 1280, height: 720 },
      antialias: config?.antialias ?? true,
      shadows: config?.shadows ?? true,
      physics: config?.physics ?? false,
      includeEditor: config?.includeEditor ?? false,
      compressionLevel: config?.compressionLevel ?? 'medium',
      targetPlatform: config?.targetPlatform ?? 'web',
    };
    this.manifest = new AssetManifest();
  }

  getConfig(): Readonly<BuildConfig> { return this.config; }
  setConfig(partial: Partial<BuildConfig>): void { Object.assign(this.config, partial); }
  getManifest(): AssetManifest { return this.manifest; }

  /** Scan a scene and collect asset references */
  collectAssets(scene: THREE.Scene): void {
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        // Check material textures
        const mat = obj.material;
        if (mat instanceof THREE.MeshStandardMaterial) {
          if (mat.map?.image?.src) {
            this.manifest.add({ id: `tex_${mat.map.uuid}`, type: 'texture', path: mat.map.image.src });
          }
          if (mat.normalMap?.image?.src) {
            this.manifest.add({ id: `tex_${mat.normalMap.uuid}`, type: 'texture', path: mat.normalMap.image.src });
          }
        }
      }
    });
  }

  /** Build the project — generates files */
  async build(scene: THREE.Scene): Promise<BuildResult> {
    const start = performance.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    const files: { name: string; data: Blob; size: number }[] = [];

    // Electron target: delegate to ElectronExporter
    if (this.config.targetPlatform === 'electron') {
      try {
        const blob = await ElectronExporter.exportAsElectronApp(scene, {
          projectName: this.config.projectName,
          version: this.config.version,
          width: this.config.resolution.width,
          height: this.config.resolution.height,
          antialias: this.config.antialias,
          shadows: this.config.shadows,
        });
        files.push({ name: `${this.config.projectName}-electron.zip`, data: blob, size: blob.size });
        const buildTime = performance.now() - start;
        return { success: true, errors, warnings, files, totalSize: blob.size, buildTime };
      } catch (e) {
        errors.push(`Electron export failed: ${e instanceof Error ? e.message : String(e)}`);
        return { success: false, errors, warnings, files, totalSize: 0, buildTime: performance.now() - start };
      }
    }

    // 1) Serialize scene
    const sceneData = SceneSerializer.serializeScene(scene, this.config.entryScene);
    const sceneJson = JSON.stringify(sceneData);
    const sceneBlob = new Blob([sceneJson], { type: 'application/json' });
    files.push({ name: 'scene.json', data: sceneBlob, size: sceneBlob.size });

    // 2) Asset manifest
    this.collectAssets(scene);
    const manifestJson = this.manifest.toJSON();
    const manifestBlob = new Blob([manifestJson], { type: 'application/json' });
    files.push({ name: 'manifest.json', data: manifestBlob, size: manifestBlob.size });

    // 3) Build config
    const configBlob = new Blob([JSON.stringify(this.config, null, 2)], { type: 'application/json' });
    files.push({ name: 'build.json', data: configBlob, size: configBlob.size });

    // 4) Generate runtime HTML
    const html = this.generateRuntimeHTML(sceneJson);
    const htmlBlob = new Blob([html], { type: 'text/html' });
    files.push({ name: 'index.html', data: htmlBlob, size: htmlBlob.size });

    // 5) Collect textures as data URLs
    try {
      const textures = await this.collectTextureBlobs(scene);
      for (const tex of textures) {
        files.push(tex);
      }
    } catch {
      warnings.push('Some textures could not be exported');
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const buildTime = performance.now() - start;

    return {
      success: errors.length === 0,
      errors,
      warnings,
      files,
      totalSize,
      buildTime,
    };
  }

  /** Download build result as individual files or as a ZIP (if JSZip-like lib available) */
  async downloadResult(result: BuildResult): Promise<void> {
    // Simple download: just download the HTML
    const htmlFile = result.files.find(f => f.name === 'index.html');
    if (htmlFile) {
      const url = URL.createObjectURL(htmlFile.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.config.projectName}.html`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  /** Quick export — serialize scene to JSON and trigger download */
  exportSceneJSON(scene: THREE.Scene, filename: string = 'scene.json'): void {
    const data = SceneSerializer.serializeScene(scene);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Import scene from JSON */
  importSceneJSON(json: string, scene: THREE.Scene): boolean {
    try {
      const data: SceneData = JSON.parse(json);
      SceneSerializer.deserializeScene(data, scene);
      return true;
    } catch {
      return false;
    }
  }

  /* ── Private helpers ──────────────────────────────── */

  private generateRuntimeHTML(sceneJson: string): string {
    const c = this.config;
    const safeProjectName = c.projectName.replace(/[<>&"']/g, '');
    // Safely embed JSON in a script tag by escaping forward slashes
    const escapedJson = sceneJson.replace(/<\//g, '<\\/');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeProjectName} v${c.version}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { overflow: hidden; background: #000; }
canvas { display: block; width: 100vw; height: 100vh; }
#loading { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); color: #fff; font-family: sans-serif; font-size: 24px; }
</style>
</head>
<body>
<div id="loading">Loading...</div>
<script type="importmap">
{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js" } }
</script>
<script type="module">
import * as THREE from 'three';

const sceneData = JSON.parse('${escapedJson}');

const renderer = new THREE.WebGLRenderer({ antialias: ${c.antialias} });
renderer.setSize(${c.resolution.width}, ${c.resolution.height});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
${c.shadows ? 'renderer.shadowMap.enabled = true;\nrenderer.shadowMap.type = THREE.PCFSoftShadowMap;' : ''}
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, ${c.resolution.width}/${c.resolution.height}, 0.1, 1000);
camera.position.set(0, 5, 10);
camera.lookAt(0, 0, 0);

// Rebuild scene from serialized data
function loadScene(data) {
  if (data.environment) {
    if (data.environment.fog) scene.fog = new THREE.FogExp2(data.environment.fog.color, data.environment.fog.density);
    if (data.environment.ambient) scene.add(new THREE.AmbientLight(data.environment.ambient.color, data.environment.ambient.intensity));
  }
  for (const objData of data.objects) {
    const obj = rebuildObject(objData);
    if (obj) scene.add(obj);
  }
}

function rebuildObject(data) {
  let obj;
  if (data.light) {
    switch(data.light.type) {
      case 'DirectionalLight': obj = new THREE.DirectionalLight(data.light.color, data.light.intensity); break;
      case 'PointLight': obj = new THREE.PointLight(data.light.color, data.light.intensity, data.light.distance, data.light.decay); break;
      case 'SpotLight': obj = new THREE.SpotLight(data.light.color, data.light.intensity); break;
      default: obj = new THREE.AmbientLight(data.light.color, data.light.intensity);
    }
    obj.castShadow = data.light.castShadow;
  } else if (data.geometry) {
    let geo;
    switch(data.geometry) {
      case 'BoxGeometry': geo = new THREE.BoxGeometry(); break;
      case 'SphereGeometry': geo = new THREE.SphereGeometry(); break;
      case 'CylinderGeometry': geo = new THREE.CylinderGeometry(); break;
      case 'PlaneGeometry': geo = new THREE.PlaneGeometry(); break;
      default: geo = new THREE.BoxGeometry();
    }
    const mat = data.material ? new THREE.MeshStandardMaterial({
      color: data.material.color, roughness: data.material.roughness, metalness: data.material.metalness,
      emissive: data.material.emissive, opacity: data.material.opacity, transparent: data.material.transparent
    }) : new THREE.MeshStandardMaterial();
    obj = new THREE.Mesh(geo, mat);
  } else {
    obj = new THREE.Group();
  }
  obj.name = data.name;
  obj.position.set(...data.position);
  obj.rotation.set(...data.rotation);
  obj.scale.set(...data.scale);
  obj.visible = data.visible;
  for (const child of data.children) { const c = rebuildObject(child); if(c) obj.add(c); }
  return obj;
}

loadScene(sceneData);

// Fallback lights if scene has none
if (!scene.children.some(c => c instanceof THREE.Light)) {
  scene.add(new THREE.AmbientLight(0x404040, 1));
  const dir = new THREE.DirectionalLight(0xffffff, 1);
  dir.position.set(5, 10, 5);
  scene.add(dir);
}

document.getElementById('loading').remove();

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
<${'/'}script>
</body>
</html>`;
  }

  private async collectTextureBlobs(scene: THREE.Scene): Promise<{ name: string; data: Blob; size: number }[]> {
    const textures: { name: string; data: Blob; size: number }[] = [];
    const seen = new Set<string>();

    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = obj.material;
      if (!(mat instanceof THREE.MeshStandardMaterial)) return;

      const maps = [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap, mat.emissiveMap];
      for (const map of maps) {
        if (!map || seen.has(map.uuid)) continue;
        seen.add(map.uuid);

        if (map.image instanceof HTMLCanvasElement) {
          map.image.toBlob((blob) => {
            if (blob) {
              textures.push({ name: `textures/${map.uuid}.png`, data: blob, size: blob.size });
            }
          });
        }
      }
    });

    return textures;
  }
}
