import * as THREE from 'three';
import { PhysicsSystem } from '../ecs/systems/PhysicsSystem';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Engine } from '../engine/Engine';

export interface EditorPlayModeCoordinatorDeps {
  engine: Engine;
  scene: THREE.Scene;
  editorCamera: THREE.PerspectiveCamera;
  orbitControls: OrbitControls;
  transformControls: TransformControls;
  editorCanvas: HTMLCanvasElement;
  onEnterPlayMode: () => void;
  onExitPlayMode: () => void;
  requestStopPlayMode: () => void;
}

export class EditorPlayModeCoordinator {
  private readonly engine: Engine;
  private readonly scene: THREE.Scene;
  private readonly editorCamera: THREE.PerspectiveCamera;
  private readonly orbitControls: OrbitControls;
  private readonly transformControls: TransformControls;
  private readonly editorCanvas: HTMLCanvasElement;
  private readonly onEnterPlayMode: () => void;
  private readonly onExitPlayMode: () => void;
  private readonly requestStopPlayMode: () => void;

  private readonly savedPlayCameraPos = new THREE.Vector3();
  private readonly savedPlayCameraQuat = new THREE.Quaternion();
  private readonly savedPlayOrbitTarget = new THREE.Vector3();
  private readonly playKeys = new Set<string>();
  private readonly playEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private playKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private playKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private playMouseMove: ((e: MouseEvent) => void) | null = null;
  private playPointerLockChange: (() => void) | null = null;
  private playVelocityY = 0;
  private readonly playBodyId = -999999;

  constructor(deps: EditorPlayModeCoordinatorDeps) {
    this.engine = deps.engine;
    this.scene = deps.scene;
    this.editorCamera = deps.editorCamera;
    this.orbitControls = deps.orbitControls;
    this.transformControls = deps.transformControls;
    this.editorCanvas = deps.editorCanvas;
    this.onEnterPlayMode = deps.onEnterPlayMode;
    this.onExitPlayMode = deps.onExitPlayMode;
    this.requestStopPlayMode = deps.requestStopPlayMode;
  }

  enter(): void {
    const runtimeUpdate = this.engine.onUpdate as ((((delta: number, elapsed: number) => void)) & { resetState?: () => void }) | null;
    runtimeUpdate?.resetState?.();

    this.savedPlayCameraPos.copy(this.editorCamera.position);
    this.savedPlayCameraQuat.copy(this.editorCamera.quaternion);
    this.savedPlayOrbitTarget.copy(this.orbitControls.target);

    this.orbitControls.enabled = false;
    this.engine.setMode('play');

    const physics = this.engine.world.getSystem(PhysicsSystem);
    if (physics) {
      physics.scene = this.scene;
      physics.markTerrainDirty();

      const rapier = physics.rapier;
      if (rapier.isReady && !this.engine.onUpdate) {
        const camPos = this.editorCamera.position;
        rapier.createBody(this.playBodyId, {
          type: 'kinematic',
          shape: 'capsule',
          shapeSize: new THREE.Vector3(0.3, 0.7, 0),
          position: camPos.clone(),
          rotation: new THREE.Quaternion(),
          mass: 1,
          friction: 0.5,
          restitution: 0,
        });
        rapier.createCharacterController(this.playBodyId);
      }
    }

    this.onEnterPlayMode();
    this.setupInputHandlers();
  }

  exit(): void {
    this.teardown();
    this.engine.setMode('edit');
    this.orbitControls.enabled = true;

    this.editorCamera.position.copy(this.savedPlayCameraPos);
    this.editorCamera.quaternion.copy(this.savedPlayCameraQuat);
    this.orbitControls.target.copy(this.savedPlayOrbitTarget);
    this.orbitControls.update();

    const physics = this.engine.world.getSystem(PhysicsSystem);
    if (physics) {
      physics.resetAllBodies();
    }

    this.transformControls.getHelper().visible = true;
    this.onExitPlayMode();
  }

  updateCamera(delta: number): void {
    if (!this.playKeyDown) return;
    const speed = this.playKeys.has('ShiftLeft') || this.playKeys.has('ShiftRight') ? 30 : 10;
    const move = new THREE.Vector3();

    if (this.playKeys.has('KeyW') || this.playKeys.has('ArrowUp')) move.z -= 1;
    if (this.playKeys.has('KeyS') || this.playKeys.has('ArrowDown')) move.z += 1;
    if (this.playKeys.has('KeyA') || this.playKeys.has('ArrowLeft')) move.x -= 1;
    if (this.playKeys.has('KeyD') || this.playKeys.has('ArrowRight')) move.x += 1;

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * delta);
      move.applyQuaternion(this.editorCamera.quaternion);
      move.y = 0;
    }

    const physics = this.engine.world.getSystem(PhysicsSystem);
    const rapier = physics?.rapier;
    const hasController = rapier?.isReady && rapier.hasBody(this.playBodyId);

    if (hasController) {
      const gravity = -20;
      const grounded = rapier!.isCharacterGrounded(this.playBodyId);
      if (grounded) {
        this.playVelocityY = 0;
        if (this.playKeys.has('Space')) {
          this.playVelocityY = 8;
        }
      } else {
        this.playVelocityY += gravity * delta;
      }
      move.y = this.playVelocityY * delta;

      rapier!.setBodyTransform(this.playBodyId, this.editorCamera.position, new THREE.Quaternion());
      const corrected = rapier!.moveCharacter(this.playBodyId, move);
      this.editorCamera.position.add(corrected);
      rapier!.setBodyTransform(this.playBodyId, this.editorCamera.position, new THREE.Quaternion());
      return;
    }

    if (this.playKeys.has('Space')) move.y += speed * delta;
    if (this.playKeys.has('KeyC') || this.playKeys.has('ControlLeft')) move.y -= speed * delta;
    this.editorCamera.position.add(move);

    const raycaster = new THREE.Raycaster(
      this.editorCamera.position.clone().add(new THREE.Vector3(0, 10, 0)),
      new THREE.Vector3(0, -1, 0),
      0, 100,
    );
    const colliders = this.scene.children.filter(
      (c) => (c as THREE.Mesh).isMesh && (c.userData.isCollider || c.name === 'Terrain' || c.name === 'TerrainGroup'),
    );
    const hits = raycaster.intersectObjects(colliders, true);
    if (hits.length > 0) {
      const groundY = hits[0].point.y + 1.8;
      if (this.editorCamera.position.y < groundY) {
        this.editorCamera.position.y = groundY;
        this.playVelocityY = 0;
      }
    }
  }

  resumeFromPause(): void {
    this.engine.setMode('play');
    const physics = this.engine.world.getSystem(PhysicsSystem);
    if (physics) {
      physics.scene = this.scene;
    }
  }

  teardown(): void {
    if (this.playKeyDown) window.removeEventListener('keydown', this.playKeyDown);
    if (this.playKeyUp) window.removeEventListener('keyup', this.playKeyUp);
    if (this.playMouseMove) document.removeEventListener('mousemove', this.playMouseMove);
    if (this.playPointerLockChange) document.removeEventListener('pointerlockchange', this.playPointerLockChange);
    this.playKeyDown = null;
    this.playKeyUp = null;
    this.playMouseMove = null;
    this.playPointerLockChange = null;
    this.playKeys.clear();
    this.playVelocityY = 0;

    const physics = this.engine.world.getSystem(PhysicsSystem);
    if (physics?.rapier?.isReady) {
      physics.rapier.removeBody(this.playBodyId);
    }
    if (document.pointerLockElement === this.editorCanvas) {
      document.exitPointerLock();
    }
  }

  private setupInputHandlers(): void {
    if (!this.engine.onUpdate) {
      this.playKeys.clear();
      this.playEuler.set(0, 0, 0, 'YXZ');
      this.playVelocityY = 0;
      this.playEuler.setFromQuaternion(this.editorCamera.quaternion, 'YXZ');

      this.playKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Escape') {
          this.requestStopPlayMode();
          return;
        }
        this.playKeys.add(e.code);
      };
      this.playKeyUp = (e: KeyboardEvent) => {
        this.playKeys.delete(e.code);
      };
      this.playMouseMove = (e: MouseEvent) => {
        if (document.pointerLockElement !== this.editorCanvas) return;
        const sensitivity = 0.002;
        this.playEuler.y -= e.movementX * sensitivity;
        this.playEuler.x -= e.movementY * sensitivity;
        this.playEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.playEuler.x));
        this.editorCamera.quaternion.setFromEuler(this.playEuler);
      };
      this.playPointerLockChange = () => {};

      window.addEventListener('keydown', this.playKeyDown);
      window.addEventListener('keyup', this.playKeyUp);
      document.addEventListener('mousemove', this.playMouseMove);
      document.addEventListener('pointerlockchange', this.playPointerLockChange);
      this.editorCanvas.requestPointerLock();
      return;
    }

    this.playKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        this.requestStopPlayMode();
      }
    };
    window.addEventListener('keydown', this.playKeyDown);
  }
}