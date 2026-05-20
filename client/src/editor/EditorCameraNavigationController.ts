import * as THREE from 'three';

export interface EditorCameraNavigationControllerDeps {
  editorCamera: THREE.PerspectiveCamera;
  orbitControls: {
    target: THREE.Vector3;
    enabled: boolean;
    update: () => void;
  };
  setStatusMessage: (message: string) => void;
}

export class EditorCameraNavigationController {
  private previewingCamera: THREE.PerspectiveCamera | null = null;
  private readonly savedPosition = new THREE.Vector3();
  private readonly savedQuaternion = new THREE.Quaternion();
  private readonly savedOrbitTarget = new THREE.Vector3();
  private savedFov = 60;
  private savedNear = 0.1;
  private savedFar = 5000;

  constructor(private readonly deps: EditorCameraNavigationControllerDeps) {}

  isPreviewing(): boolean {
    return this.previewingCamera !== null;
  }

  focusObject(object: THREE.Object3D | null): void {
    if (!object) return;
    if (this.isPreviewing()) {
      this.exitPreview();
    }

    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1);

    this.deps.orbitControls.target.copy(center);
    this.deps.editorCamera.position.copy(center).add(new THREE.Vector3(size, size * 0.8, size));
    this.deps.orbitControls.update();
  }

  previewCamera(camera: THREE.PerspectiveCamera): void {
    if (this.isPreviewing()) {
      this.exitPreview();
      return;
    }

    this.savedPosition.copy(this.deps.editorCamera.position);
    this.savedQuaternion.copy(this.deps.editorCamera.quaternion);
    this.savedOrbitTarget.copy(this.deps.orbitControls.target);
    this.savedFov = this.deps.editorCamera.fov;
    this.savedNear = this.deps.editorCamera.near;
    this.savedFar = this.deps.editorCamera.far;

    camera.getWorldPosition(this.deps.editorCamera.position);
    camera.getWorldQuaternion(this.deps.editorCamera.quaternion);
    this.deps.editorCamera.fov = camera.fov;
    this.deps.editorCamera.near = camera.near;
    this.deps.editorCamera.far = camera.far;
    this.deps.editorCamera.updateProjectionMatrix();

    const forward = new THREE.Vector3(0, 0, -5).applyQuaternion(this.deps.editorCamera.quaternion);
    this.deps.orbitControls.target.copy(this.deps.editorCamera.position).add(forward);
    this.deps.orbitControls.enabled = false;
    this.deps.orbitControls.update();

    this.previewingCamera = camera;
    this.deps.setStatusMessage('📷 Camera preview — press Escape to exit');
  }

  exitPreview(): void {
    if (!this.isPreviewing()) return;

    this.deps.editorCamera.position.copy(this.savedPosition);
    this.deps.editorCamera.quaternion.copy(this.savedQuaternion);
    this.deps.editorCamera.fov = this.savedFov;
    this.deps.editorCamera.near = this.savedNear;
    this.deps.editorCamera.far = this.savedFar;
    this.deps.editorCamera.updateProjectionMatrix();
    this.deps.orbitControls.target.copy(this.savedOrbitTarget);
    this.deps.orbitControls.enabled = true;
    this.deps.orbitControls.update();

    this.previewingCamera = null;
    this.deps.setStatusMessage('');
  }
}