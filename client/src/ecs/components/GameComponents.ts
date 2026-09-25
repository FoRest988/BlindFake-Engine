import * as THREE from 'three';
import { Component } from '../Component';
import { AnimationStateMachine } from '../../engine/AnimationStateMachine';

/** 3D Transform — position, rotation, scale */
export class TransformComponent extends Component {
  public position = new THREE.Vector3();
  public rotation = new THREE.Euler();
  public quaternion = new THREE.Quaternion();
  public scale = new THREE.Vector3(1, 1, 1);

  setPosition(x: number, y: number, z: number): this {
    this.position.set(x, y, z);
    return this;
  }

  setRotation(x: number, y: number, z: number): this {
    this.rotation.set(x, y, z);
    this.quaternion.setFromEuler(this.rotation);
    return this;
  }

  setScale(x: number, y: number, z: number): this {
    this.scale.set(x, y, z);
    return this;
  }
}

/** Renderable 3D object */
export class MeshComponent extends Component {
  public object3D: THREE.Object3D;
  public castShadow: boolean;
  public receiveShadow: boolean;
  public addedToScene = false;

  constructor(object3D: THREE.Object3D, castShadow = true, receiveShadow = true) {
    super();
    this.object3D = object3D;
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    // Apply shadow settings
    object3D.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = castShadow;
        child.receiveShadow = receiveShadow;
      }
    });
  }

  /** Detach the object from the scene when the entity goes away (no more ghost meshes). */
  dispose(): void {
    this.object3D.removeFromParent();
    this.addedToScene = false;
  }
}

/** Animation mixer for skeletal/morph animations */
export class AnimationComponent extends Component {
  public mixer: THREE.AnimationMixer;
  public clips: THREE.AnimationClip[];
  public actions = new Map<string, THREE.AnimationAction>();
  public currentAction?: THREE.AnimationAction;

  constructor(object3D: THREE.Object3D, clips: THREE.AnimationClip[]) {
    super();
    this.mixer = new THREE.AnimationMixer(object3D);
    this.clips = clips;
    for (const clip of clips) {
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
  }

  play(name: string, fadeIn = 0.3): void {
    const action = this.actions.get(name);
    if (!action) return;

    if (this.currentAction && this.currentAction !== action) {
      this.currentAction.fadeOut(fadeIn);
    }

    action.reset().fadeIn(fadeIn).play();
    this.currentAction = action;
  }

  stop(): void {
    this.currentAction?.stop();
    this.currentAction = undefined;
  }
}

/** Animation State Machine component — drives animations via a state graph */
export class StateMachineComponent extends Component {
  public stateMachine: AnimationStateMachine;
  public bound = false;

  constructor(stateMachine: AnimationStateMachine) {
    super();
    this.stateMachine = stateMachine;
  }
}

/**
 * Common collision layer constants (bit flags).
 * Combine with bitwise OR for masks, e.g. `CollisionLayer.Player | CollisionLayer.Enemy`.
 */
export const CollisionLayer = {
  Default:     0x0001,
  Player:      0x0002,
  Enemy:       0x0004,
  PlayerBullet:0x0008,
  EnemyBullet: 0x0010,
  Terrain:     0x0020,
  Trigger:     0x0040,
  Pickup:      0x0080,
  NPC:         0x0100,
  Vehicle:     0x0200,
  Debris:      0x0400,
  All:         0xFFFF,
} as const;

/** Physics body — powered by Rapier 3D */
export class PhysicsBodyComponent extends Component {
  public velocity = new THREE.Vector3();
  public acceleration = new THREE.Vector3();
  public mass = 1;
  public friction = 0.5;
  public restitution = 0;
  public linearDamping = 0.1;
  public angularDamping = 0.1;
  public grounded = false;
  public gravity = true;
  public collider: 'box' | 'sphere' | 'capsule' | 'cylinder' | 'cone' = 'box';
  public colliderSize = new THREE.Vector3(1, 1, 1);
  public bodyType: 'dynamic' | 'kinematic' | 'static' = 'dynamic';
  public lockRotation = false;
  public ccd = false;

  /** Which layer(s) this body belongs to (bit flags). */
  public layer: number = CollisionLayer.Default;
  /** Which layers this body can collide with (bit mask). 0xFFFF = collide with everything. */
  public mask: number = CollisionLayer.All;
  /** If true, detect overlap but don't resolve (useful for triggers/pickups). */
  public isTrigger = false;

  /** Internal: used by character controller system */
  public _useCharacterController = false;
  /** Internal: when true, PhysicsSystem syncs ECS position → Rapier (for respawn / teleport) */
  public _teleport = false;

  /** @deprecated Use bodyType instead */
  get isStatic(): boolean { return this.bodyType === 'static'; }
  set isStatic(v: boolean) { this.bodyType = v ? 'static' : 'dynamic'; }
}

/** Camera controller */
export class CameraFollowComponent extends Component {
  public offset = new THREE.Vector3(0, 5, 10);
  public lookAtOffset = new THREE.Vector3(0, 1.5, 0);
  public smoothSpeed = 5;
  public isActive = true;
}

/** Health & combat */
export class HealthComponent extends Component {
  public current: number;
  public max: number;

  constructor(max = 100) {
    super();
    this.max = max;
    this.current = max;
  }

  get ratio(): number {
    return this.current / this.max;
  }

  damage(amount: number): void {
    this.current = Math.max(0, this.current - amount);
  }

  heal(amount: number): void {
    this.current = Math.min(this.max, this.current + amount);
  }

  get isDead(): boolean {
    return this.current <= 0;
  }
}

/** Network-synced entity */
export class NetworkComponent extends Component {
  public networkId: string;
  public ownerId: string;
  public isLocal: boolean;
  public lastSyncTime = 0;
  public interpolationBuffer: Array<{ time: number; position: THREE.Vector3; rotation: THREE.Quaternion }> = [];

  constructor(networkId: string, ownerId: string, isLocal = false) {
    super();
    this.networkId = networkId;
    this.ownerId = ownerId;
    this.isLocal = isLocal;
  }
}
