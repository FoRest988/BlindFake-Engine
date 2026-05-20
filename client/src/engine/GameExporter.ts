/**
 * GameExporter — Exports the current project as a standalone HTML game.
 * Bundles scene data, assets, engine runtime, and produces a single playable file.
 */

import * as THREE from 'three';
import { SceneSerializer, SerializedScene } from './SceneSerialization';

export interface ExportOptions {
  projectName: string;
  width: number;
  height: number;
  fullscreen: boolean;
  antialias: boolean;
  shadows: boolean;
  toneMapping: 'none' | 'aces' | 'reinhard' | 'cineon';
  backgroundColor: string;
  showFPS: boolean;
  showLoading: boolean;
  physicsEnabled: boolean;
  compressJSON: boolean;
  embedAssets: boolean;
  targetFPS: number;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  projectName: 'My Game',
  width: 1280,
  height: 720,
  fullscreen: true,
  antialias: true,
  shadows: true,
  toneMapping: 'aces',
  backgroundColor: '#000000',
  showFPS: false,
  showLoading: true,
  physicsEnabled: true,
  compressJSON: true,
  embedAssets: true,
  targetFPS: 60,
};

export class GameExporter {
  /**
   * Export the scene as a downloadable standalone HTML file.
   */
  static async exportAsHTML(
    scene: THREE.Scene,
    options: Partial<ExportOptions> = {}
  ): Promise<Blob> {
    const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };
    const sceneData = SceneSerializer.serialize(scene, true);
    const sceneJSON = opts.compressJSON
      ? JSON.stringify(sceneData)
      : JSON.stringify(sceneData, null, 2);

    const html = this.buildHTML(sceneJSON, opts);
    return new Blob([html], { type: 'text/html;charset=utf-8' });
  }

  /**
   * Export scene data as JSON (for loading externally).
   */
  static exportAsJSON(scene: THREE.Scene): Blob {
    const sceneData = SceneSerializer.serialize(scene, true);
    const json = JSON.stringify(sceneData, null, 2);
    return new Blob([json], { type: 'application/json;charset=utf-8' });
  }

  /**
   * Export project as a ZIP folder with: index.html, scene.json, assets/
   */
  static async exportAsFolder(
    scene: THREE.Scene,
    options: Partial<ExportOptions> = {}
  ): Promise<Blob> {
    const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };
    const sceneData = SceneSerializer.serialize(scene, true);
    const sceneJSON = JSON.stringify(sceneData, null, 2);

    // Collect textures as separate files
    const textures = await this.collectTextureData(scene);
    const textureFiles: { path: string; data: Uint8Array }[] = [];
    let textureIndex = 0;
    const textureURLMap = new Map<string, string>();

    for (const [uuid, dataURI] of textures) {
      const ext = dataURI.startsWith('data:image/jpeg') ? '.jpg' : '.png';
      const filename = `texture_${textureIndex}${ext}`;
      textureURLMap.set(uuid, `assets/${filename}`);

      // Convert data URI to binary
      const base64 = dataURI.split(',')[1];
      const binStr = atob(base64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      textureFiles.push({ path: `assets/${filename}`, data: bytes });
      textureIndex++;
    }

    // Build index.html that loads scene.json externally
    const html = this.buildFolderHTML(opts);

    // Build ZIP
    const enc = new TextEncoder();
    const files: { path: string; data: Uint8Array }[] = [
      { path: 'index.html', data: enc.encode(html) },
      { path: 'scene.json', data: enc.encode(sceneJSON) },
      ...textureFiles,
    ];

    return this.createZip(files);
  }

  /**
   * Download a blob as a file.
   */
  static download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Build the standalone HTML string with embedded Three.js runtime.
   */
  private static buildHTML(sceneJSON: string, opts: ExportOptions): string {
    const toneMap: Record<string, string> = {
      none: 'THREE.NoToneMapping',
      aces: 'THREE.ACESFilmicToneMapping',
      reinhard: 'THREE.ReinhardToneMapping',
      cineon: 'THREE.CineonToneMapping',
    };

    // Sanitize project name for use in HTML title (prevent XSS)
    const safeTitle = opts.projectName
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${safeTitle}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:${opts.backgroundColor}}
canvas{display:block}
${opts.showLoading ? `
#loading{position:fixed;inset:0;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:100;transition:opacity 0.5s}
#loading.hide{opacity:0;pointer-events:none}
#loading h1{color:#fff;font-family:sans-serif;margin-bottom:16px}
#loading .bar{width:200px;height:4px;background:#333;border-radius:2px;overflow:hidden}
#loading .fill{height:100%;background:#0078d4;width:0%;transition:width 0.3s}
` : ''}
${opts.showFPS ? `
#fps{position:fixed;top:4px;left:4px;color:#0f0;font:12px monospace;z-index:50;background:rgba(0,0,0,0.5);padding:2px 6px;border-radius:2px}
` : ''}
</style>
</head>
<body>
${opts.showLoading ? '<div id="loading"><h1>Loading...</h1><div class="bar"><div class="fill" id="loadbar"></div></div></div>' : ''}
${opts.showFPS ? '<div id="fps">0 FPS</div>' : ''}
<script type="importmap">
{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}
</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const SCENE_DATA = ${sceneJSON};

// ─── Renderer setup ──────────────────
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: ${opts.antialias} });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = ${opts.shadows};
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = ${toneMap[opts.toneMapping] ?? 'THREE.NoToneMapping'};
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;

function resize() {
  const w = ${opts.fullscreen ? 'window.innerWidth' : String(opts.width)};
  const h = ${opts.fullscreen ? 'window.innerHeight' : String(opts.height)};
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ─── Scene reconstruction ────────────
const scene = new THREE.Scene();
if (SCENE_DATA.background) scene.background = new THREE.Color(SCENE_DATA.background);
if (SCENE_DATA.fog) scene.fog = new THREE.Fog(SCENE_DATA.fog.color, SCENE_DATA.fog.near, SCENE_DATA.fog.far);

let camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

// Controls: PointerLock for FPS-style, fallback to Orbit
const pointerLock = new PointerLockControls(camera, document.body);
const orbitControls = new OrbitControls(camera, canvas);
orbitControls.enableDamping = true;
let usePointerLock = false;

// WASD + Sprint + Jump input state
const keys = {};
document.addEventListener('keydown', e => { keys[e.code] = true; });
document.addEventListener('keyup', e => { keys[e.code] = false; });

// Click to enter pointer lock
canvas.addEventListener('click', () => {
  if (!pointerLock.isLocked) {
    pointerLock.lock();
    usePointerLock = true;
    orbitControls.enabled = false;
  }
});
pointerLock.addEventListener('unlock', () => {
  usePointerLock = false;
  orbitControls.enabled = true;
});
scene.add(pointerLock.object);

// Simple FPS crosshair
const crosshair = document.createElement('div');
crosshair.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:8px;height:8px;border:2px solid rgba(255,255,255,0.6);border-radius:50%;z-index:10;pointer-events:none;display:none;';
document.body.appendChild(crosshair);
pointerLock.addEventListener('lock', () => { crosshair.style.display = 'block'; });
pointerLock.addEventListener('unlock', () => { crosshair.style.display = 'none'; });

// Controls reference for scene objects that replace camera
const controls = orbitControls;
controls.enableDamping = true;

function buildObject(data, parent) {
  let obj;
  switch (data.type) {
    case 'Mesh': {
      const geo = buildGeometry(data.geometry);
      const mat = buildMaterial(Array.isArray(data.material) ? data.material[0] : data.material);
      obj = new THREE.Mesh(geo, mat);
      if (${opts.shadows}) { obj.castShadow = true; obj.receiveShadow = true; }
      break;
    }
    case 'DirectionalLight': {
      const l = new THREE.DirectionalLight(data.light?.color || '#ffffff', data.light?.intensity ?? 1);
      if (${opts.shadows} && data.light?.castShadow) {
        l.castShadow = true;
        l.shadow.mapSize.set(2048, 2048);
        l.shadow.camera.near = 0.5;
        l.shadow.camera.far = 500;
        const s = 20;
        l.shadow.camera.left = -s;
        l.shadow.camera.right = s;
        l.shadow.camera.top = s;
        l.shadow.camera.bottom = -s;
      }
      obj = l;
      break;
    }
    case 'PointLight': {
      const l = new THREE.PointLight(data.light?.color || '#ffffff', data.light?.intensity ?? 1, data.light?.distance ?? 0, data.light?.decay ?? 2);
      if (${opts.shadows} && data.light?.castShadow) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); }
      obj = l;
      break;
    }
    case 'SpotLight': {
      const l = new THREE.SpotLight(data.light?.color || '#ffffff', data.light?.intensity ?? 1, data.light?.distance ?? 0, data.light?.angle ?? Math.PI / 3, data.light?.penumbra ?? 0, data.light?.decay ?? 2);
      if (${opts.shadows} && data.light?.castShadow) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); }
      obj = l;
      break;
    }
    case 'AmbientLight': {
      obj = new THREE.AmbientLight(data.light?.color || '#ffffff', data.light?.intensity ?? 0.5);
      break;
    }
    case 'HemisphereLight': {
      obj = new THREE.HemisphereLight(data.light?.color || '#ffffff', '#444444', data.light?.intensity ?? 0.5);
      break;
    }
    case 'PerspectiveCamera': {
      const c = new THREE.PerspectiveCamera(data.camera?.fov ?? 60, window.innerWidth / window.innerHeight, data.camera?.near ?? 0.1, data.camera?.far ?? 1000);
      camera = c;
      controls.object = c;
      obj = c;
      break;
    }
    case 'Group': {
      obj = new THREE.Group();
      break;
    }
    default:
      obj = new THREE.Object3D();
  }

  obj.name = data.name;
  obj.visible = data.visible ?? true;
  obj.position.set(...data.position);
  obj.rotation.set(...data.rotation);
  obj.scale.set(...data.scale);
  if (data.userData) Object.assign(obj.userData, data.userData);
  parent.add(obj);

  if (data.children) {
    for (const child of data.children) buildObject(child, obj);
  }
  return obj;
}

function buildGeometry(geoData) {
  if (!geoData) return new THREE.BoxGeometry(1, 1, 1);
  const p = geoData.parameters || {};
  switch (geoData.type) {
    case 'BoxGeometry': return new THREE.BoxGeometry(p.width, p.height, p.depth, p.widthSegments, p.heightSegments, p.depthSegments);
    case 'SphereGeometry': return new THREE.SphereGeometry(p.radius, p.widthSegments, p.heightSegments);
    case 'CylinderGeometry': return new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments);
    case 'PlaneGeometry': return new THREE.PlaneGeometry(p.width, p.height, p.widthSegments, p.heightSegments);
    case 'ConeGeometry': return new THREE.ConeGeometry(p.radius, p.height, p.radialSegments);
    case 'TorusGeometry': return new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments);
    case 'TorusKnotGeometry': return new THREE.TorusKnotGeometry(p.radius, p.tube, p.tubularSegments, p.radialSegments, p.p, p.q);
    default: {
      if (geoData.attributes) {
        const geo = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(geoData.attributes)) {
          geo.setAttribute(name, new THREE.Float32BufferAttribute(attr.array, attr.itemSize, attr.normalized));
        }
        if (geoData.index) geo.setIndex(geoData.index);
        return geo;
      }
      return new THREE.BoxGeometry(1, 1, 1);
    }
  }
}

function buildMaterial(matData) {
  if (!matData) return new THREE.MeshStandardMaterial({ color: 0xcccccc });
  const c = matData.color ? new THREE.Color(matData.color) : new THREE.Color(0xcccccc);
  const props = {
    color: c,
    roughness: matData.roughness ?? 0.5,
    metalness: matData.metalness ?? 0,
    opacity: matData.opacity ?? 1,
    transparent: matData.transparent ?? false,
    wireframe: matData.wireframe ?? false,
    side: matData.side ?? THREE.FrontSide,
  };
  if (matData.emissive) props.emissive = new THREE.Color(matData.emissive);

  const loader = new THREE.TextureLoader();
  let mat;
  switch (matData.type) {
    case 'MeshPhysicalMaterial': mat = new THREE.MeshPhysicalMaterial(props); break;
    case 'MeshBasicMaterial': mat = new THREE.MeshBasicMaterial({ color: c, wireframe: matData.wireframe }); break;
    case 'MeshToonMaterial': mat = new THREE.MeshToonMaterial({ color: c }); break;
    default: mat = new THREE.MeshStandardMaterial(props);
  }

  // Load embedded textures
  if (matData.map && typeof matData.map === 'string' && matData.map.startsWith('data:')) {
    mat.map = loader.load(matData.map);
    mat.map.colorSpace = THREE.SRGBColorSpace;
  }
  if (matData.normalMap && typeof matData.normalMap === 'string' && matData.normalMap.startsWith('data:')) {
    mat.normalMap = loader.load(matData.normalMap);
  }

  return mat;
}

// Build scene from data — async batched to allow progress bar repaints
let totalObjects = SCENE_DATA.objects.length;
let loadedObjects = 0;

function buildBatch(startIdx) {
  const BATCH = 5;
  const end = Math.min(startIdx + BATCH, totalObjects);
  for (let i = startIdx; i < end; i++) {
    buildObject(SCENE_DATA.objects[i], scene);
    loadedObjects++;
  }
  ${opts.showLoading ? `
  const pct = Math.round((loadedObjects / totalObjects) * 100);
  document.getElementById('loadbar').style.width = pct + '%';
  ` : ''}
  if (end < totalObjects) {
    requestAnimationFrame(function() { buildBatch(end); });
  } else {
    finishLoading();
  }
}

function finishLoading() {

// Add default light if none
const hasLight = scene.children.some(c =>
  c instanceof THREE.DirectionalLight || c instanceof THREE.PointLight || c instanceof THREE.SpotLight
);
if (!hasLight) {
  scene.add(new THREE.AmbientLight(0x404040, 1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.5);
  dl.position.set(5, 10, 7);
  scene.add(dl);
}

resize();
window.addEventListener('resize', resize);

${opts.showLoading ? `
document.getElementById('loading').classList.add('hide');
setTimeout(function() { document.getElementById('loading').remove(); }, 600);
` : ''}

// ─── Game Loop ───────────────────────
const clock = new THREE.Clock();
${opts.showFPS ? `
let frames = 0, fpsTime = 0;
const fpsEl = document.getElementById('fps');
` : ''}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  // WASD + Pointer Lock movement
  if (usePointerLock && pointerLock.isLocked) {
    const speed = keys['ShiftLeft'] ? 20 : 10;
    const moveVec = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp']) moveVec.z -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) moveVec.z += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) moveVec.x -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) moveVec.x += 1;
    if (keys['Space']) moveVec.y += 1;
    if (keys['KeyC'] || keys['ControlLeft']) moveVec.y -= 1;
    if (moveVec.length() > 0) {
      moveVec.normalize().multiplyScalar(speed * dt);
      pointerLock.moveRight(moveVec.x);
      pointerLock.moveForward(-moveVec.z);
      camera.position.y += moveVec.y * speed * dt;
    }
  } else {
    orbitControls.update();
  }

  ${opts.showFPS ? `
  frames++;
  fpsTime += dt;
  if (fpsTime >= 1) {
    fpsEl.textContent = Math.round(frames / fpsTime) + ' FPS';
    frames = 0;
    fpsTime = 0;
  }
  ` : ''}

  renderer.render(scene, camera);
}
animate();

} // end finishLoading

if (totalObjects === 0) {
  finishLoading();
} else {
  buildBatch(0);
}
</script>
</body>
</html>`;
  }

  /**
   * Collect embedded textures from the scene as base64 data URIs.
   */
  static async collectTextureData(scene: THREE.Scene): Promise<Map<string, string>> {
    const textures = new Map<string, string>();
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (mat instanceof THREE.MeshStandardMaterial) {
            if (mat.map?.image) textures.set(mat.map.uuid, this.imageToDataURI(mat.map.image));
            if (mat.normalMap?.image) textures.set(mat.normalMap.uuid, this.imageToDataURI(mat.normalMap.image));
            if (mat.roughnessMap?.image) textures.set(mat.roughnessMap.uuid, this.imageToDataURI(mat.roughnessMap.image));
            if (mat.metalnessMap?.image) textures.set(mat.metalnessMap.uuid, this.imageToDataURI(mat.metalnessMap.image));
            if (mat.aoMap?.image) textures.set(mat.aoMap.uuid, this.imageToDataURI(mat.aoMap.image));
            if (mat.emissiveMap?.image) textures.set(mat.emissiveMap.uuid, this.imageToDataURI(mat.emissiveMap.image));
          }
        }
      }
    });
    return textures;
  }

  private static imageToDataURI(image: HTMLImageElement | ImageBitmap | HTMLCanvasElement): string {
    const canvas = document.createElement('canvas');
    canvas.width = image instanceof HTMLCanvasElement ? image.width : (image as HTMLImageElement).naturalWidth ?? (image as ImageBitmap).width;
    canvas.height = image instanceof HTMLCanvasElement ? image.height : (image as HTMLImageElement).naturalHeight ?? (image as ImageBitmap).height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image as CanvasImageSource, 0, 0);
    return canvas.toDataURL('image/png');
  }

  /**
   * Build an HTML file for folder export that loads scene.json externally.
   */
  private static buildFolderHTML(opts: ExportOptions): string {
    const toneMap: Record<string, string> = {
      none: 'THREE.NoToneMapping',
      aces: 'THREE.ACESFilmicToneMapping',
      reinhard: 'THREE.ReinhardToneMapping',
      cineon: 'THREE.CineonToneMapping',
    };
    const safeTitle = opts.projectName
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${safeTitle}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:${opts.backgroundColor}}
canvas{display:block}
#loading{position:fixed;inset:0;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:100;transition:opacity 0.5s}
#loading.hide{opacity:0;pointer-events:none}
#loading h1{color:#fff;font-family:sans-serif;margin-bottom:16px}
#loading .bar{width:200px;height:4px;background:#333;border-radius:2px;overflow:hidden}
#loading .fill{height:100%;background:#0078d4;width:0%;transition:width 0.3s}
</style>
</head>
<body>
<div id="loading"><h1>Loading...</h1><div class="bar"><div class="fill" id="loadbar"></div></div></div>
<script type="importmap">
{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}
</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// Load scene data from external file
const response = await fetch('scene.json');
const SCENE_DATA = await response.json();

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: ${opts.antialias} });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = ${opts.shadows};
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = ${toneMap[opts.toneMapping] ?? 'THREE.NoToneMapping'};
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
if (SCENE_DATA.background) scene.background = new THREE.Color(SCENE_DATA.background);
if (SCENE_DATA.fog) scene.fog = new THREE.Fog(SCENE_DATA.fog.color, SCENE_DATA.fog.near, SCENE_DATA.fog.far);

let camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

const orbitControls = new OrbitControls(camera, canvas);
orbitControls.enableDamping = true;
const pointerLock = new PointerLockControls(camera, document.body);
let usePointerLock = false;
const keys = {};
document.addEventListener('keydown', e => { keys[e.code] = true; });
document.addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('click', () => { if (!pointerLock.isLocked) { pointerLock.lock(); usePointerLock = true; orbitControls.enabled = false; } });
pointerLock.addEventListener('unlock', () => { usePointerLock = false; orbitControls.enabled = true; });
scene.add(pointerLock.object);

function resize() {
  const w = ${opts.fullscreen ? 'window.innerWidth' : String(opts.width)};
  const h = ${opts.fullscreen ? 'window.innerHeight' : String(opts.height)};
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function buildGeometry(geoData) {
  if (!geoData) return new THREE.BoxGeometry(1,1,1);
  const p = geoData.parameters || {};
  switch (geoData.type) {
    case 'BoxGeometry': return new THREE.BoxGeometry(p.width,p.height,p.depth);
    case 'SphereGeometry': return new THREE.SphereGeometry(p.radius,p.widthSegments,p.heightSegments);
    case 'CylinderGeometry': return new THREE.CylinderGeometry(p.radiusTop,p.radiusBottom,p.height,p.radialSegments);
    case 'PlaneGeometry': return new THREE.PlaneGeometry(p.width,p.height);
    case 'ConeGeometry': return new THREE.ConeGeometry(p.radius,p.height,p.radialSegments);
    case 'TorusGeometry': return new THREE.TorusGeometry(p.radius,p.tube,p.radialSegments,p.tubularSegments);
    default: {
      if (geoData.attributes) {
        const geo = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(geoData.attributes))
          geo.setAttribute(name, new THREE.Float32BufferAttribute(attr.array, attr.itemSize, attr.normalized));
        if (geoData.index) geo.setIndex(geoData.index);
        return geo;
      }
      return new THREE.BoxGeometry(1,1,1);
    }
  }
}

function buildMaterial(matData) {
  if (!matData) return new THREE.MeshStandardMaterial({ color: 0xcccccc });
  const c = matData.color ? new THREE.Color(matData.color) : new THREE.Color(0xcccccc);
  const props = { color: c, roughness: matData.roughness ?? 0.5, metalness: matData.metalness ?? 0, opacity: matData.opacity ?? 1, transparent: matData.transparent ?? false };
  const loader = new THREE.TextureLoader();
  let mat = new THREE.MeshStandardMaterial(props);
  if (matData.map && typeof matData.map === 'string') {
    mat.map = loader.load(matData.map.startsWith('data:') ? matData.map : matData.map);
    mat.map.colorSpace = THREE.SRGBColorSpace;
  }
  return mat;
}

function buildObject(data, parent) {
  let obj;
  switch (data.type) {
    case 'Mesh': obj = new THREE.Mesh(buildGeometry(data.geometry), buildMaterial(Array.isArray(data.material) ? data.material[0] : data.material)); obj.castShadow=true; obj.receiveShadow=true; break;
    case 'DirectionalLight': { const l = new THREE.DirectionalLight(data.light?.color || '#fff', data.light?.intensity ?? 1); if (data.light?.castShadow) { l.castShadow=true; l.shadow.mapSize.set(2048,2048); } obj=l; break; }
    case 'PointLight': obj = new THREE.PointLight(data.light?.color || '#fff', data.light?.intensity ?? 1, data.light?.distance ?? 0); break;
    case 'SpotLight': obj = new THREE.SpotLight(data.light?.color || '#fff', data.light?.intensity ?? 1); break;
    case 'AmbientLight': obj = new THREE.AmbientLight(data.light?.color || '#fff', data.light?.intensity ?? 0.5); break;
    case 'HemisphereLight': obj = new THREE.HemisphereLight(data.light?.color || '#fff', '#444', data.light?.intensity ?? 0.5); break;
    case 'PerspectiveCamera': { const c2 = new THREE.PerspectiveCamera(data.camera?.fov ?? 60, window.innerWidth/window.innerHeight, 0.1, 1000); camera=c2; orbitControls.object=c2; obj=c2; break; }
    case 'Group': obj = new THREE.Group(); break;
    default: obj = new THREE.Object3D();
  }
  obj.name = data.name;
  obj.visible = data.visible ?? true;
  obj.position.set(...data.position);
  obj.rotation.set(...data.rotation);
  obj.scale.set(...data.scale);
  if (data.userData) Object.assign(obj.userData, data.userData);
  parent.add(obj);
  if (data.children) for (const child of data.children) buildObject(child, obj);
  return obj;
}

let loaded = 0;
for (const objData of SCENE_DATA.objects) {
  buildObject(objData, scene);
  loaded++;
  document.getElementById('loadbar').style.width = Math.round((loaded/SCENE_DATA.objects.length)*100)+'%';
}

const hasLight = scene.children.some(c => c instanceof THREE.DirectionalLight || c instanceof THREE.PointLight || c instanceof THREE.SpotLight);
if (!hasLight) { scene.add(new THREE.AmbientLight(0x404040,1)); const dl=new THREE.DirectionalLight(0xffffff,1.5); dl.position.set(5,10,7); scene.add(dl); }

resize();
window.addEventListener('resize', resize);
setTimeout(() => { document.getElementById('loading').classList.add('hide'); setTimeout(() => document.getElementById('loading').remove(), 600); }, 300);

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (usePointerLock && pointerLock.isLocked) {
    const speed = keys['ShiftLeft'] ? 20 : 10;
    const mv = new THREE.Vector3();
    if (keys['KeyW']) mv.z -= 1; if (keys['KeyS']) mv.z += 1;
    if (keys['KeyA']) mv.x -= 1; if (keys['KeyD']) mv.x += 1;
    if (keys['Space']) mv.y += 1;
    if (mv.length() > 0) { mv.normalize().multiplyScalar(speed*dt); pointerLock.moveRight(mv.x); pointerLock.moveForward(-mv.z); camera.position.y += mv.y*speed*dt; }
  } else { orbitControls.update(); }
  renderer.render(scene, camera);
}
animate();
</script>
</body>
</html>`;
  }

  /**
   * Minimal ZIP file writer (no external dependency).
   * Supports stored (uncompressed) entries — sufficient for scene data + textures.
   */
  private static createZip(files: { path: string; data: Uint8Array }[]): Blob {
    const enc = new TextEncoder();
    const localHeaders: Uint8Array[] = [];
    const centralHeaders: Uint8Array[] = [];
    let offset = 0;

    for (const file of files) {
      const pathBytes = enc.encode(file.path);
      const crc = this.crc32(file.data);

      // Local file header (30 bytes + path + data)
      const local = new Uint8Array(30 + pathBytes.length + file.data.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);   // signature
      lv.setUint16(4, 20, true);            // version needed
      lv.setUint16(6, 0, true);             // flags
      lv.setUint16(8, 0, true);             // compression: stored
      lv.setUint16(10, 0, true);            // mod time
      lv.setUint16(12, 0, true);            // mod date
      lv.setUint32(14, crc, true);          // crc32
      lv.setUint32(18, file.data.length, true); // compressed size
      lv.setUint32(22, file.data.length, true); // uncompressed size
      lv.setUint16(26, pathBytes.length, true); // path length
      lv.setUint16(28, 0, true);            // extra field length
      local.set(pathBytes, 30);
      local.set(file.data, 30 + pathBytes.length);
      localHeaders.push(local);

      // Central directory entry (46 bytes + path)
      const central = new Uint8Array(46 + pathBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);   // signature
      cv.setUint16(4, 20, true);            // version made by
      cv.setUint16(6, 20, true);            // version needed
      cv.setUint16(8, 0, true);             // flags
      cv.setUint16(10, 0, true);            // compression: stored
      cv.setUint16(12, 0, true);            // mod time
      cv.setUint16(14, 0, true);            // mod date
      cv.setUint32(16, crc, true);          // crc32
      cv.setUint32(20, file.data.length, true); // compressed size
      cv.setUint32(24, file.data.length, true); // uncompressed size
      cv.setUint16(28, pathBytes.length, true); // path length
      cv.setUint16(30, 0, true);            // extra field length
      cv.setUint16(32, 0, true);            // comment length
      cv.setUint16(34, 0, true);            // disk number start
      cv.setUint16(36, 0, true);            // internal attributes
      cv.setUint32(38, 0, true);            // external attributes
      cv.setUint32(42, offset, true);       // local header offset
      central.set(pathBytes, 46);
      centralHeaders.push(central);

      offset += local.length;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const c of centralHeaders) centralDirSize += c.length;

    // End of central directory (22 bytes)
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);     // signature
    ev.setUint16(4, 0, true);              // disk number
    ev.setUint16(6, 0, true);              // central dir disk
    ev.setUint16(8, files.length, true);   // entries on disk
    ev.setUint16(10, files.length, true);  // total entries
    ev.setUint32(12, centralDirSize, true);// central dir size
    ev.setUint32(16, centralDirOffset, true);// central dir offset
    ev.setUint16(20, 0, true);             // comment length

    return new Blob([...localHeaders, ...centralHeaders, eocd].map(b => new Uint8Array(b.buffer as ArrayBuffer)), { type: 'application/zip' });
  }

  /** CRC32 computation for ZIP entries */
  private static crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
}