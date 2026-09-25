import * as THREE from 'three';
import { System } from '../System';
import { TransformComponent, PhysicsBodyComponent, MeshComponent } from '../components/GameComponents';
import { RapierPhysicsEngine, BodyDescriptor } from '../../engine/RapierPhysics';
import type { Entity } from '../Entity';
import { FIXED_DT, GameLoop } from '../../engine/loop/GameLoop';

export class PhysicsSystem extends System {
  public priority = 10;
  public scene: THREE.Scene | null = null;
  public rapier: RapierPhysicsEngine;

  private registeredEntities = new Set<number>();
  /** Fixed-step accumulator: physics runs at FIXED_DT regardless of the frame rate. */
  private readonly loop = new GameLoop();
  private terrainEntityIds = new Set<number>();
  private terrainDirty = true;
  private nextTerrainId = -100000;

  private debugMesh: THREE.LineSegments | null = null;
  public showDebug = false;

  // Pre-allocated instances for post-step transform sync — eliminates per-entity GC pressure
  private _syncPos = new THREE.Vector3();
  private _syncRot = new THREE.Quaternion();
  private _syncVel = new THREE.Vector3();

  constructor() {
    super();
    this.rapier = new RapierPhysicsEngine();
  }

  async initRapier(): Promise<void> {
    await this.rapier.init();
  }

  markTerrainDirty(): void { this.terrainDirty = true; }

  /** Remove all Rapier bodies and reset registration state (call on play-mode exit) */
  resetAllBodies(): void {
    for (const id of this.registeredEntities) {
      this.rapier.removeBody(id);
    }
    this.registeredEntities.clear();
    for (const id of this.terrainEntityIds) {
      this.rapier.removeBody(id);
    }
    this.terrainEntityIds.clear();
    this.terrainDirty = true;
    this.loop.reset();
    // Zero out velocities so next play starts clean
    const entities = this.world.query(TransformComponent, PhysicsBodyComponent);
    for (const entity of entities) {
      entity.get(PhysicsBodyComponent).velocity.set(0, 0, 0);
    }
  }

  private syncTerrainColliders(): void {
    if (!this.scene || !this.rapier.isReady) return;

    for (const id of this.terrainEntityIds) {
      this.rapier.removeBody(id);
    }
    this.terrainEntityIds.clear();

    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && obj.userData.isCollider) {
        const id = this.nextTerrainId--;
        this.rapier.addTrimeshBody(id, obj as THREE.Mesh);
        this.terrainEntityIds.add(id);
      }
    });

    this.terrainDirty = false;
  }

  update(delta: number, _elapsed: number): void {
    if (!this.rapier.isReady) return;

    if (this.terrainDirty) this.syncTerrainColliders();

    const entities = this.world.query(TransformComponent, PhysicsBodyComponent);

    // Register new entities
    for (const entity of entities) {
      if (!this.registeredEntities.has(entity.id)) {
        this.registerEntity(entity);
      }
    }

    // Unregister removed entities
    const currentIds = new Set(entities.map(e => e.id));
    for (const id of this.registeredEntities) {
      if (!currentIds.has(id)) {
        this.rapier.removeBody(id);
        this.registeredEntities.delete(id);
      }
    }

    // Pre-step: sync kinematic bodies from ECS → Rapier
    for (const entity of entities) {
      const body = entity.get(PhysicsBodyComponent);
      if (body.bodyType === 'kinematic' && !body._useCharacterController) {
        const t = entity.get(TransformComponent);
        this.rapier.setBodyTransform(entity.id, t.position, t.quaternion);
      }
      // Sync velocity from component → Rapier for dynamic bodies
      // This allows game logic (templates, scripts) to set body.velocity and have it take effect
      if (body.bodyType === 'dynamic') {
        // Teleport: force-sync position when game logic has moved the body (respawn etc.)
        if (body._teleport) {
          const t = entity.get(TransformComponent);
          this.rapier.setBodyTransform(entity.id, t.position, t.quaternion);
          body._teleport = false;
        }
        this.rapier.setLinearVelocity(entity.id, body.velocity);
      }
    }

    // Step physics at a fixed rate so results do not depend on the frame rate
    const steps = this.loop.advance(delta);
    for (let i = 0; i < steps; i++) this.rapier.step(FIXED_DT);

    // Post-step: sync dynamic bodies from Rapier → ECS (zero allocation via *Into methods)
    for (const entity of entities) {
      const body = entity.get(PhysicsBodyComponent);
      if (body.bodyType === 'dynamic') {
        const t = entity.get(TransformComponent);
        if (this.rapier.getBodyPositionInto(entity.id, this._syncPos)) {
          t.position.copy(this._syncPos);
        }
        if (!body.lockRotation && this.rapier.getBodyRotationInto(entity.id, this._syncRot)) {
          t.quaternion.copy(this._syncRot);
          t.rotation.setFromQuaternion(this._syncRot);
        }
        // Keep velocity in component for game logic access
        this.rapier.getLinearVelocityInto(entity.id, this._syncVel);
        body.velocity.copy(this._syncVel);
      }
    }

    // Debug rendering
    if (this.showDebug && this.scene) {
      this.updateDebugRender();
    } else if (this.debugMesh) {
      this.debugMesh.removeFromParent();
      this.debugMesh.geometry.dispose();
      (this.debugMesh.material as THREE.Material).dispose();
      this.debugMesh = null;
    }
  }

  private registerEntity(entity: Entity): void {
    const t = entity.get(TransformComponent);
    const body = entity.get(PhysicsBodyComponent);

    // Character controllers use kinematic bodies internally
    const bodyType = body._useCharacterController ? 'kinematic' : body.bodyType;

    // Convert colliderSize depending on shape type
    const shapeSize = new THREE.Vector3();
    switch (body.collider) {
      case 'sphere':
        shapeSize.set(body.colliderSize.x * 0.5, 0, 0);
        break;
      case 'capsule': {
        const radius = body.colliderSize.x * 0.5;
        const halfH = Math.max(0.01, (body.colliderSize.y * 0.5) - radius);
        shapeSize.set(radius, halfH, 0);
        break;
      }
      case 'cylinder':
      case 'cone':
        shapeSize.set(body.colliderSize.x * 0.5, body.colliderSize.y * 0.5, 0);
        break;
      default: // box
        shapeSize.set(body.colliderSize.x * 0.5, body.colliderSize.y * 0.5, body.colliderSize.z * 0.5);
        break;
    }

    const desc: BodyDescriptor = {
      type: bodyType,
      shape: body.collider,
      shapeSize,
      position: t.position.clone(),
      rotation: t.quaternion.clone(),
      mass: body.mass,
      friction: body.friction,
      restitution: body.restitution,
      linearDamping: body.linearDamping,
      angularDamping: body.angularDamping,
      gravityScale: body.gravity ? 1 : 0,
      isSensor: body.isTrigger,
      layer: body.layer,
      mask: body.mask,
      ccd: body.ccd,
      lockRotation: body.lockRotation,
    };

    this.rapier.createBody(entity.id, desc);

    if (body._useCharacterController) {
      this.rapier.createCharacterController(entity.id);
    }

    if (body.velocity.lengthSq() > 0 && !body._useCharacterController) {
      this.rapier.setLinearVelocity(entity.id, body.velocity);
    }

    this.registeredEntities.add(entity.id);
  }

  private updateDebugRender(): void {
    const data = this.rapier.getDebugRender();
    if (!data || !this.scene) return;

    if (!this.debugMesh) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false });
      this.debugMesh = new THREE.LineSegments(geo, mat);
      this.debugMesh.frustumCulled = false;
      this.debugMesh.renderOrder = 9999;
      this.scene.add(this.debugMesh);
    }

    const geo = this.debugMesh.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 4));
  }

  destroy(): void {
    if (this.debugMesh) {
      this.debugMesh.removeFromParent();
      this.debugMesh.geometry.dispose();
      (this.debugMesh.material as THREE.Material).dispose();
    }
    this.rapier.dispose();
  }
}
