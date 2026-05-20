/**
 * SceneGizmos — Editor viewport widgets:
 * - Orientation gizmo (cube showing XYZ + click to snap camera)
 * - Grid plane with customizable size/divisions
 * - Axis indicator at origin
 * - Camera frustum visualization for selected cameras
 * - Light helpers (directional arrow, point sphere, spot cone)
 * - Measurement tool (distance between two points)
 * - Snap-to-grid indicator
 */

import * as THREE from 'three';

export interface GizmoConfig {
  /** Show the orientation cube */
  showOrientationCube: boolean;
  /** Show origin axis */
  showAxisIndicator: boolean;
  /** Show light helpers */
  showLightHelpers: boolean;
  /** Show camera helpers */
  showCameraHelpers: boolean;
  /** Orientation cube size in pixels */
  orientationCubeSize: number;
  /** Axis indicator length */
  axisLength: number;
}

const DEFAULT_CONFIG: GizmoConfig = {
  showOrientationCube: true,
  showAxisIndicator: true,
  showLightHelpers: true,
  showCameraHelpers: true,
  orientationCubeSize: 100,
  axisLength: 50,
};

export class SceneGizmos {
  private config: GizmoConfig;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private domElement: HTMLElement;

  // Orientation cube (rendered in separate overlay)
  private cubeScene!: THREE.Scene;
  private cubeCamera!: THREE.PerspectiveCamera;
  private cubeRenderer: THREE.WebGLRenderer | null = null;
  private cubeCanvas!: HTMLCanvasElement;
  private cubeMesh!: THREE.Mesh;

  // Scene helpers
  private axisHelper: THREE.Object3D | null = null;
  private lightHelpers = new Map<THREE.Light, THREE.Object3D>();
  private cameraHelpers = new Map<THREE.Camera, THREE.CameraHelper>();

  // Measurement
  private measurePoints: THREE.Vector3[] = [];
  private measureLine: THREE.Line | null = null;
  private measureLabel: HTMLDivElement | null = null;
  private isMeasuring = false;

  // Callbacks
  private onCameraSnap?: (direction: THREE.Vector3) => void;

  constructor(scene: THREE.Scene, camera: THREE.Camera, domElement: HTMLElement, config: Partial<GizmoConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;

    this.buildOrientationCube();
    if (this.config.showAxisIndicator) this.buildAxisIndicator();
  }

  /** Set callback when user clicks orientation cube face */
  setOnCameraSnap(cb: (direction: THREE.Vector3) => void): void {
    this.onCameraSnap = cb;
  }

  /** Update gizmos each frame */
  update(): void {
    this.updateOrientationCube();
    this.updateHelpers();
  }

  /** Scan scene and add helpers for lights/cameras */
  refreshHelpers(): void {
    // Remove outdated helpers
    for (const [light, helper] of this.lightHelpers) {
      if (!light.parent) {
        this.scene.remove(helper);
        this.lightHelpers.delete(light);
      }
    }
    for (const [cam, helper] of this.cameraHelpers) {
      if (!cam.parent) {
        this.scene.remove(helper);
        this.cameraHelpers.delete(cam);
      }
    }

    if (!this.config.showLightHelpers && !this.config.showCameraHelpers) return;

    this.scene.traverse((child) => {
      // Light helpers
      if (this.config.showLightHelpers && child instanceof THREE.Light && !this.lightHelpers.has(child)) {
        const helper = this.createLightHelper(child);
        if (helper) {
          this.scene.add(helper);
          this.lightHelpers.set(child, helper);
        }
      }

      // Camera helpers
      if (this.config.showCameraHelpers && child instanceof THREE.PerspectiveCamera && child !== this.camera && !this.cameraHelpers.has(child)) {
        const helper = new THREE.CameraHelper(child);
        this.scene.add(helper);
        this.cameraHelpers.set(child, helper);
      }
    });
  }

  /* ─── Measurement Tool ───────────────────────────────── */

  /** Start measuring mode */
  startMeasure(): void {
    this.isMeasuring = true;
    this.measurePoints = [];
    this.clearMeasureLine();
    this.domElement.style.cursor = 'crosshair';
  }

  /** Add a measure point (call from click handler) */
  addMeasurePoint(worldPos: THREE.Vector3): void {
    if (!this.isMeasuring) return;

    this.measurePoints.push(worldPos.clone());

    if (this.measurePoints.length === 2) {
      this.drawMeasureLine();
      this.isMeasuring = false;
      this.domElement.style.cursor = '';
    }
  }

  /** Get current measurement distance */
  getMeasureDistance(): number | null {
    if (this.measurePoints.length < 2) return null;
    return this.measurePoints[0].distanceTo(this.measurePoints[1]);
  }

  /** Clear measurement */
  clearMeasure(): void {
    this.measurePoints = [];
    this.clearMeasureLine();
    this.isMeasuring = false;
    this.domElement.style.cursor = '';
  }

  private drawMeasureLine(): void {
    this.clearMeasureLine();

    const points = this.measurePoints;
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false });
    this.measureLine = new THREE.Line(geo, mat);
    this.measureLine.renderOrder = 9999;
    this.measureLine.name = '_measure_helper';
    this.scene.add(this.measureLine);

    // Label
    const dist = points[0].distanceTo(points[1]);
    this.measureLabel = document.createElement('div');
    this.measureLabel.style.cssText = 'position:absolute;background:rgba(0,0,0,0.8);color:#ffff00;padding:2px 6px;font-size:11px;border-radius:3px;pointer-events:none;z-index:100;font-family:monospace;';
    this.measureLabel.textContent = `${dist.toFixed(2)} units`;
    this.domElement.appendChild(this.measureLabel);

    // Position label at midpoint
    const mid = points[0].clone().add(points[1]).multiplyScalar(0.5);
    this.updateLabelPosition(mid);
  }

  private updateLabelPosition(worldPos: THREE.Vector3): void {
    if (!this.measureLabel) return;

    const vec = worldPos.clone().project(this.camera);
    const rect = this.domElement.getBoundingClientRect();
    const x = (vec.x * 0.5 + 0.5) * rect.width;
    const y = (-vec.y * 0.5 + 0.5) * rect.height;

    this.measureLabel.style.left = x + 'px';
    this.measureLabel.style.top = (y - 20) + 'px';
  }

  private clearMeasureLine(): void {
    if (this.measureLine) {
      this.scene.remove(this.measureLine);
      this.measureLine.geometry.dispose();
      (this.measureLine.material as THREE.Material).dispose();
      this.measureLine = null;
    }
    if (this.measureLabel) {
      this.measureLabel.remove();
      this.measureLabel = null;
    }
  }

  /* ─── Orientation Cube ───────────────────────────────── */

  private buildOrientationCube(): void {
    if (!this.config.showOrientationCube) return;

    const size = this.config.orientationCubeSize;

    // Create overlay canvas
    this.cubeCanvas = document.createElement('canvas');
    this.cubeCanvas.width = size;
    this.cubeCanvas.height = size;
    this.cubeCanvas.style.cssText = `position:absolute;top:8px;right:8px;width:${size}px;height:${size}px;z-index:50;cursor:pointer;border-radius:4px;`;
    this.domElement.style.position = 'relative';
    this.domElement.appendChild(this.cubeCanvas);

    // Mini scene
    this.cubeScene = new THREE.Scene();
    this.cubeCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.cubeCamera.position.set(0, 0, 3);

    // Build labeled cube
    const cubeGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const materials = [
      this.createFaceMaterial('X+', '#cc3333'), // right
      this.createFaceMaterial('X-', '#993333'), // left
      this.createFaceMaterial('Y+', '#33cc33'), // top
      this.createFaceMaterial('Y-', '#339933'), // bottom
      this.createFaceMaterial('Z+', '#3333cc'), // front
      this.createFaceMaterial('Z-', '#333399'), // back
    ];
    this.cubeMesh = new THREE.Mesh(cubeGeo, materials);
    this.cubeScene.add(this.cubeMesh);

    // Axis lines on cube
    const axisGroup = new THREE.Group();
    const lineLen = 1.0;
    axisGroup.add(this.createAxisLine(new THREE.Vector3(lineLen, 0, 0), 0xff4444));
    axisGroup.add(this.createAxisLine(new THREE.Vector3(0, lineLen, 0), 0x44ff44));
    axisGroup.add(this.createAxisLine(new THREE.Vector3(0, 0, lineLen), 0x4444ff));
    this.cubeScene.add(axisGroup);

    // Ambient light
    this.cubeScene.add(new THREE.AmbientLight(0xffffff, 1));

    try {
      this.cubeRenderer = new THREE.WebGLRenderer({
        canvas: this.cubeCanvas,
        antialias: true,
        alpha: true,
      });
      this.cubeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.cubeRenderer.setSize(size, size, false);
    } catch {
      return; // WebGL context limit
    }

    // Click handler — snap camera to face direction
    this.cubeCanvas.addEventListener('click', (e) => {
      const rect = this.cubeCanvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x, y), this.cubeCamera);
      const hits = raycaster.intersectObject(this.cubeMesh);

      if (hits.length > 0 && hits[0].face) {
        const faceIndex = hits[0].face.materialIndex;
        const directions = [
          new THREE.Vector3(1, 0, 0),   // X+
          new THREE.Vector3(-1, 0, 0),  // X-
          new THREE.Vector3(0, 1, 0),   // Y+
          new THREE.Vector3(0, -1, 0),  // Y-
          new THREE.Vector3(0, 0, 1),   // Z+
          new THREE.Vector3(0, 0, -1),  // Z-
        ];
        this.onCameraSnap?.(directions[faceIndex]);
      }
    });
  }

  private updateOrientationCube(): void {
    if (!this.cubeRenderer || !this.cubeMesh) return;

    // Mirror main camera rotation (not position)
    const q = this.camera.quaternion.clone().invert();
    this.cubeMesh.quaternion.copy(q);

    this.cubeRenderer.render(this.cubeScene, this.cubeCamera);
  }

  private createFaceMaterial(label: string, bgColor: string): THREE.MeshBasicMaterial {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 128, 128);

    ctx.strokeStyle = '#ffffff33';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, 124, 124);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 64, 64);

    const tex = new THREE.CanvasTexture(canvas);
    return new THREE.MeshBasicMaterial({ map: tex });
  }

  private createAxisLine(to: THREE.Vector3, color: number): THREE.Line {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), to]);
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
    return new THREE.Line(geo, mat);
  }

  /* ─── Axis Indicator ─────────────────────────────────── */

  private buildAxisIndicator(): void {
    const len = this.config.axisLength;
    const group = new THREE.Group();
    group.name = '_axis_indicator_helper';

    // X axis — red
    group.add(this.createArrow(new THREE.Vector3(len, 0, 0), 0xff4444, 'X'));
    // Y axis — green
    group.add(this.createArrow(new THREE.Vector3(0, len, 0), 0x44ff44, 'Y'));
    // Z axis — blue
    group.add(this.createArrow(new THREE.Vector3(0, 0, len), 0x4444ff, 'Z'));

    this.axisHelper = group;
    this.scene.add(group);
  }

  private createArrow(dir: THREE.Vector3, color: number, _label: string): THREE.ArrowHelper {
    const length = dir.length();
    return new THREE.ArrowHelper(dir.clone().normalize(), new THREE.Vector3(), length, color, length * 0.1, length * 0.06);
  }

  /* ─── Light Helpers ──────────────────────────────────── */

  private createLightHelper(light: THREE.Light): THREE.Object3D | null {
    if (light instanceof THREE.DirectionalLight) {
      return new THREE.DirectionalLightHelper(light, 2, 0xffff44);
    }
    if (light instanceof THREE.PointLight) {
      return new THREE.PointLightHelper(light, 1, 0xffaa00);
    }
    if (light instanceof THREE.SpotLight) {
      return new THREE.SpotLightHelper(light, 0xff8800);
    }
    if (light instanceof THREE.HemisphereLight) {
      return new THREE.HemisphereLightHelper(light, 2);
    }
    return null;
  }

  private updateHelpers(): void {
    for (const helper of this.lightHelpers.values()) {
      if ('update' in helper && typeof (helper as { update: () => void }).update === 'function') {
        (helper as { update: () => void }).update();
      }
    }
    for (const helper of this.cameraHelpers.values()) {
      helper.update();
    }

    // Update measurement label position
    if (this.measureLabel && this.measurePoints.length === 2) {
      const mid = this.measurePoints[0].clone().add(this.measurePoints[1]).multiplyScalar(0.5);
      this.updateLabelPosition(mid);
    }
  }

  /* ─── Config ─────────────────────────────────────────── */

  setConfig(partial: Partial<GizmoConfig>): void {
    Object.assign(this.config, partial);
    
    if (this.axisHelper) {
      this.axisHelper.visible = this.config.showAxisIndicator;
    }
    if (this.cubeCanvas) {
      this.cubeCanvas.style.display = this.config.showOrientationCube ? '' : 'none';
    }
  }

  /* ─── Dispose ────────────────────────────────────────── */

  dispose(): void {
    this.cubeRenderer?.dispose();
    this.cubeCanvas?.remove();

    if (this.axisHelper) this.scene.remove(this.axisHelper);

    for (const h of this.lightHelpers.values()) this.scene.remove(h);
    for (const h of this.cameraHelpers.values()) this.scene.remove(h);
    this.lightHelpers.clear();
    this.cameraHelpers.clear();

    this.clearMeasureLine();
  }
}
