/**
 * ElectronExporter �?Generates a complete Electron desktop app package.
 *
 * Produces a ZIP containing:
 *   package.json   �?Electron app manifest with electron-builder config
 *   main.js        �?Electron main process entry
 *   preload.js     �?Secure preload bridge
 *   index.html     �?Game runtime (reuses GameExporter HTML)
 *   scene.json     �?Serialized scene data
 *   textures/      �?Embedded texture files
 *
 * Users extract, run `npm install && npm start` to play,
 * or `npm run dist` to build a distributable.
 */

import * as THREE from 'three';
import { GameExporter, type ExportOptions } from './GameExporter';
import { SceneSerializer, type BuildConfig } from './BuildExportSystem';

/* ─── Types ─────────────────────────────────────────── */

export interface ElectronExportOptions {
  projectName: string;
  version: string;
  author: string;
  description: string;
  width: number;
  height: number;
  fullscreen: boolean;
  antialias: boolean;
  shadows: boolean;
  toneMapping: 'none' | 'aces' | 'reinhard' | 'cineon';
  backgroundColor: string;
  /** Target OS for electron-builder: win, mac, linux, or all */
  targetOS: 'win' | 'mac' | 'linux' | 'all';
  /** Show FPS counter in title bar */
  showFPS: boolean;
  /** Enable DevTools in production build */
  devTools: boolean;
}

const DEFAULT_OPTIONS: ElectronExportOptions = {
  projectName: 'MyGame',
  version: '1.0.0',
  author: '',
  description: 'Game made with BlindFake: Phantom',
  width: 1280,
  height: 720,
  fullscreen: false,
  antialias: true,
  shadows: true,
  toneMapping: 'aces',
  backgroundColor: '#000000',
  targetOS: 'all',
  showFPS: false,
  devTools: false,
};

/* ─── Exporter ──────────────────────────────────────── */

export class ElectronExporter {

  /**
   * Export a scene as a ready-to-run Electron app (ZIP).
   */
  static async exportAsElectronApp(
    scene: THREE.Scene,
    options: Partial<ElectronExportOptions> = {},
  ): Promise<Blob> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Serialize scene
    const sceneData = SceneSerializer.serializeScene(scene, opts.projectName);
    const sceneJSON = JSON.stringify(sceneData, null, 2);

    // Collect textures
    const textureMap = await GameExporter.collectTextureData(scene);
    const textureFiles: { path: string; data: Uint8Array }[] = [];
    const enc = new TextEncoder();
    for (const [uuid, dataURI] of textureMap.entries()) {
      textureFiles.push({ path: `textures/${uuid}.png`, data: this.dataURItoUint8Array(dataURI) });
    }

    // Generate all files
    const files: { path: string; data: Uint8Array }[] = [
      { path: 'package.json', data: enc.encode(this.generatePackageJson(opts)) },
      { path: 'main.js', data: enc.encode(this.generateMainJs(opts)) },
      { path: 'preload.js', data: enc.encode(this.generatePreloadJs()) },
      { path: 'index.html', data: enc.encode(this.generateIndexHtml(opts)) },
      { path: 'scene.json', data: enc.encode(sceneJSON) },
      { path: 'README.md', data: enc.encode(this.generateReadme(opts)) },
      ...textureFiles,
    ];

    return this.createZip(files);
  }

  /**
   * Export and trigger download.
   */
  static async exportAndDownload(
    scene: THREE.Scene,
    options: Partial<ElectronExportOptions> = {},
  ): Promise<void> {
    const blob = await this.exportAsElectronApp(scene, options);
    const name = (options.projectName ?? 'MyGame').replace(/[^a-zA-Z0-9_-]/g, '_');
    GameExporter.download(blob, `${name}-electron.zip`);
  }

  /* ── File Generators ──────────────────────────────── */

  private static generatePackageJson(opts: ElectronExportOptions): string {
    const safeName = opts.projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const buildTargets: string[] = [];
    if (opts.targetOS === 'all' || opts.targetOS === 'win') buildTargets.push('"win"');
    if (opts.targetOS === 'all' || opts.targetOS === 'mac') buildTargets.push('"mac"');
    if (opts.targetOS === 'all' || opts.targetOS === 'linux') buildTargets.push('"linux"');

    return JSON.stringify({
      name: safeName,
      version: opts.version,
      description: opts.description,
      author: opts.author,
      main: 'main.js',
      scripts: {
        start: 'electron .',
        dist: 'electron-builder',
        'dist:win': 'electron-builder --win',
        'dist:mac': 'electron-builder --mac',
        'dist:linux': 'electron-builder --linux',
      },
      devDependencies: {
        electron: '^33.0.0',
        'electron-builder': '^25.0.0',
      },
      build: {
        appId: `com.blindfake.${safeName}`,
        productName: opts.projectName,
        files: [
          'main.js',
          'preload.js',
          'index.html',
          'scene.json',
          'textures/**/*',
        ],
        win: {
          target: 'nsis',
          icon: 'icon.ico',
        },
        mac: {
          target: 'dmg',
          icon: 'icon.icns',
        },
        linux: {
          target: 'AppImage',
          icon: 'icon.png',
        },
      },
    }, null, 2);
  }

  private static generateMainJs(opts: ElectronExportOptions): string {
    return `// BlindFake: Phantom �?Electron Main Process
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: ${opts.width},
    height: ${opts.height},
    fullscreen: ${opts.fullscreen},
    fullscreenable: true,
    autoHideMenuBar: true,
    backgroundColor: '${opts.backgroundColor}',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile('index.html');

  ${opts.devTools ? "win.webContents.openDevTools({ mode: 'detach' });" : '// DevTools disabled in production'}

  ${opts.showFPS ? `
  // FPS counter in title bar
  let frames = 0;
  setInterval(() => {
    win.setTitle(\`${opts.projectName.replace(/'/g, "\\'")} �?\${frames} FPS\`);
    frames = 0;
  }, 1000);
  win.webContents.on('paint', () => frames++);
  ` : ''}

  // F11 fullscreen toggle
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
`;
  }

  private static generatePreloadJs(): string {
    return `// BlindFake: Phantom �?Preload Script
// Secure bridge between renderer and main process.
// contextIsolation is enabled, nodeIntegration is disabled.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('blindfake', {
  platform: process.platform,
  version: process.env.npm_package_version || '1.0.0',
});
`;
  }

  private static generateIndexHtml(opts: ElectronExportOptions): string {
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

    // For Electron, load Three.js from node_modules or CDN fallback
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob:; connect-src 'self';">
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
<div id="loading"><h1>Loading�?/h1><div class="bar"><div class="fill" id="loadbar"></div></div></div>
<script type="importmap">
{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}
</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// Load scene data from external file
const response = await fetch('./scene.json');
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
canvas.addEventListener('click', () => {
  if (!pointerLock.isLocked) { pointerLock.lock(); usePointerLock = true; orbitControls.enabled = false; }
});
pointerLock.addEventListener('unlock', () => { usePointerLock = false; orbitControls.enabled = true; });
scene.add(pointerLock.object);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function buildGeometry(geoData) {
  if (!geoData) return new THREE.BoxGeometry(1,1,1);
  const p = geoData.parameters || {};
  switch (geoData.type) {
    case 'BoxGeometry': return new THREE.BoxGeometry(p.width,p.height,p.depth,p.widthSegments,p.heightSegments,p.depthSegments);
    case 'SphereGeometry': return new THREE.SphereGeometry(p.radius,p.widthSegments,p.heightSegments);
    case 'CylinderGeometry': return new THREE.CylinderGeometry(p.radiusTop,p.radiusBottom,p.height,p.radialSegments);
    case 'PlaneGeometry': return new THREE.PlaneGeometry(p.width,p.height,p.widthSegments,p.heightSegments);
    case 'ConeGeometry': return new THREE.ConeGeometry(p.radius,p.height,p.radialSegments);
    case 'TorusGeometry': return new THREE.TorusGeometry(p.radius,p.tube,p.radialSegments,p.tubularSegments);
    case 'TorusKnotGeometry': return new THREE.TorusKnotGeometry(p.radius,p.tube,p.tubularSegments,p.radialSegments,p.p,p.q);
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
  const props = {
    color: c, roughness: matData.roughness ?? 0.5, metalness: matData.metalness ?? 0,
    opacity: matData.opacity ?? 1, transparent: matData.transparent ?? false,
    wireframe: matData.wireframe ?? false, side: matData.side ?? THREE.FrontSide,
  };
  if (matData.emissive) props.emissive = new THREE.Color(matData.emissive);
  const loader = new THREE.TextureLoader();
  let mat;
  switch (matData.type) {
    case 'MeshPhysicalMaterial': mat = new THREE.MeshPhysicalMaterial(props); break;
    case 'MeshBasicMaterial': mat = new THREE.MeshBasicMaterial({ color: c, wireframe: matData.wireframe }); break;
    default: mat = new THREE.MeshStandardMaterial(props);
  }
  if (matData.map && typeof matData.map === 'string' && matData.map.startsWith('data:')) {
    mat.map = loader.load(matData.map); mat.map.colorSpace = THREE.SRGBColorSpace;
  }
  if (matData.normalMap && typeof matData.normalMap === 'string' && matData.normalMap.startsWith('data:')) {
    mat.normalMap = loader.load(matData.normalMap);
  }
  return mat;
}

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
      const l = new THREE.DirectionalLight(data.light?.color || '#fff', data.light?.intensity ?? 1);
      if (data.light?.castShadow) { l.castShadow = true; l.shadow.mapSize.set(2048,2048); const s=20; l.shadow.camera.left=-s; l.shadow.camera.right=s; l.shadow.camera.top=s; l.shadow.camera.bottom=-s; }
      obj = l; break;
    }
    case 'PointLight': { obj = new THREE.PointLight(data.light?.color || '#fff', data.light?.intensity ?? 1, data.light?.distance ?? 0, data.light?.decay ?? 2); break; }
    case 'SpotLight': { obj = new THREE.SpotLight(data.light?.color || '#fff', data.light?.intensity ?? 1, data.light?.distance ?? 0, data.light?.angle ?? Math.PI/3, data.light?.penumbra ?? 0); break; }
    case 'AmbientLight': { obj = new THREE.AmbientLight(data.light?.color || '#fff', data.light?.intensity ?? 0.5); break; }
    case 'HemisphereLight': { obj = new THREE.HemisphereLight(data.light?.color || '#fff', '#444', data.light?.intensity ?? 0.5); break; }
    case 'PerspectiveCamera': {
      const c2 = new THREE.PerspectiveCamera(data.camera?.fov ?? 60, window.innerWidth/window.innerHeight, data.camera?.near ?? 0.1, data.camera?.far ?? 1000);
      camera = c2; orbitControls.object = c2; obj = c2; break;
    }
    case 'Group': { obj = new THREE.Group(); break; }
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

// Build scene
let loaded = 0;
for (const objData of SCENE_DATA.objects) {
  buildObject(objData, scene);
  loaded++;
  document.getElementById('loadbar').style.width = Math.round((loaded / SCENE_DATA.objects.length) * 100) + '%';
}

const hasLight = scene.children.some(c => c instanceof THREE.DirectionalLight || c instanceof THREE.PointLight || c instanceof THREE.SpotLight);
if (!hasLight) {
  scene.add(new THREE.AmbientLight(0x404040, 1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(5, 10, 7); scene.add(dl);
}

resize();
window.addEventListener('resize', resize);

setTimeout(() => {
  document.getElementById('loading')?.classList.add('hide');
  setTimeout(() => document.getElementById('loading')?.remove(), 600);
}, 300);

// Game loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (usePointerLock && pointerLock.isLocked) {
    const speed = keys['ShiftLeft'] ? 20 : 10;
    const mv = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp']) mv.z -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) mv.z += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) mv.x -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) mv.x += 1;
    if (keys['Space']) mv.y += 1;
    if (keys['KeyC'] || keys['ControlLeft']) mv.y -= 1;
    if (mv.length() > 0) {
      mv.normalize().multiplyScalar(speed * dt);
      pointerLock.moveRight(mv.x);
      pointerLock.moveForward(-mv.z);
      camera.position.y += mv.y * speed * dt;
    }
  } else {
    orbitControls.update();
  }
  renderer.render(scene, camera);
}
animate();
</script>
</body>
</html>`;
  }

  private static generateReadme(opts: ElectronExportOptions): string {
    return `# ${opts.projectName}

${opts.description}

Built with [BlindFake: Phantom](https://github.com/FoRest988/BlindFake-Engine).

## Quick Start

\`\`\`bash
npm install
npm start
\`\`\`

## Build Distributable

\`\`\`bash
# All platforms
npm run dist

# Specific platform
npm run dist:win
npm run dist:mac
npm run dist:linux
\`\`\`

The output will be in the \`dist/\` folder.

## Requirements

- Node.js 18+
- npm 9+

## App Icons

Replace the icon files to customize:
- \`icon.ico\` �?Windows
- \`icon.icns\` �?macOS
- \`icon.png\` �?Linux (256x256 recommended)
`;
  }

  /* ── Utilities ────────────────────────────────────── */

  private static dataURItoUint8Array(dataURI: string): Uint8Array {
    const base64 = dataURI.split(',')[1];
    if (!base64) return new Uint8Array(0);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Minimal ZIP file builder (no external dependency).
   * Supports Store (no compression) for simplicity.
   */
  private static createZip(files: { path: string; data: Uint8Array }[]): Blob {
    const entries: Uint8Array[] = [];
    const centralDir: Uint8Array[] = [];
    let offset = 0;

    for (const file of files) {
      const pathBytes = new TextEncoder().encode(file.path);
      const crc = this.crc32(file.data);

      // Local file header (30 + pathLen + dataLen)
      const local = new Uint8Array(30 + pathBytes.length + file.data.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);   // signature
      lv.setUint16(4, 20, true);            // version needed
      lv.setUint16(6, 0, true);             // flags
      lv.setUint16(8, 0, true);             // compression: store
      lv.setUint16(10, 0, true);            // mod time
      lv.setUint16(12, 0, true);            // mod date
      lv.setUint32(14, crc, true);          // crc-32
      lv.setUint32(18, file.data.length, true); // compressed size
      lv.setUint32(22, file.data.length, true); // uncompressed size
      lv.setUint16(26, pathBytes.length, true); // filename length
      lv.setUint16(28, 0, true);            // extra field length
      local.set(pathBytes, 30);
      local.set(file.data, 30 + pathBytes.length);
      entries.push(local);

      // Central directory header (46 + pathLen)
      const central = new Uint8Array(46 + pathBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);   // signature
      cv.setUint16(4, 20, true);            // version made by
      cv.setUint16(6, 20, true);            // version needed
      cv.setUint16(8, 0, true);             // flags
      cv.setUint16(10, 0, true);            // compression
      cv.setUint16(12, 0, true);            // mod time
      cv.setUint16(14, 0, true);            // mod date
      cv.setUint32(16, crc, true);          // crc-32
      cv.setUint32(20, file.data.length, true);
      cv.setUint32(24, file.data.length, true);
      cv.setUint16(28, pathBytes.length, true);
      cv.setUint16(30, 0, true);            // extra length
      cv.setUint16(32, 0, true);            // comment length
      cv.setUint16(34, 0, true);            // disk start
      cv.setUint16(36, 0, true);            // internal attrs
      cv.setUint32(38, 0, true);            // external attrs
      cv.setUint32(42, offset, true);       // local header offset
      central.set(pathBytes, 46);
      centralDir.push(central);

      offset += local.length;
    }

    const cdOffset = offset;
    const cdSize = centralDir.reduce((s, c) => s + c.length, 0);

    // End of central directory (22 bytes)
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...entries, ...centralDir, eocd].map(a => a.buffer as ArrayBuffer), { type: 'application/zip' });
  }

  /** CRC-32 (ISO 3309) */
  private static crc32Table: Uint32Array | null = null;
  private static crc32(data: Uint8Array): number {
    if (!this.crc32Table) {
      this.crc32Table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        this.crc32Table[i] = c;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc = this.crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
}
