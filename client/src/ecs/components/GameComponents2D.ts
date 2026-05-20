// ─── Extended Game Components ───────────────────────────────────────
// Additional ECS components for 2D, AI, dialogue, inventory, audio.

import * as THREE from 'three';
import { Component } from '../Component';

// ── 2D Sprite Component ─────────────────────────────────────────────

/** Sprite sheet reference for 2D rendering */
export class SpriteComponent extends Component {
  /** Sprite sheet key (registered in assets) */
  public spriteSheet = '';
  /** Current frame index or animation name */
  public frame = 0;
  public animationName = '';
  public animationSpeed = 10; // frames per second
  public animationTimer = 0;
  public loop = true;
  public playing = true;
  public flipX = false;
  public flipY = false;
  public tint = new THREE.Color(1, 1, 1);
  public opacity = 1;
  /** Layer for z-ordering in 2D */
  public layer = 0;
  /** Pixels per unit for sizing */
  public pixelsPerUnit = 16;
  /** Whether this is a UI sprite (skip camera transform) */
  public isUI = false;
  /** Internal: mesh managed by SpriteRenderSystem */
  public _mesh: THREE.Mesh | null = null;
  public _addedToScene = false;
}

// ── AI Components ───────────────────────────────────────────────────

/** Marks an entity as having AI behavior */
export class AIComponent extends Component {
  /** Behavior tree ID to use */
  public behaviorTreeId = '';
  /** FSM current state name */
  public stateName = '';
  /** Detection range for sensing targets */
  public detectionRange = 10;
  /** Attack range */
  public attackRange = 2;
  /** Current target entity ID */
  public targetEntityId: number | null = null;
  /** AI blackboard data — arbitrary key-value store */
  public blackboard = new Map<string, any>();
  /** Patrol waypoints */
  public waypoints: THREE.Vector3[] = [];
  public currentWaypointIndex = 0;
  /** Is this AI active? */
  public enabled = true;
}

/** Pathfinding agent — moves along calculated paths */
export class PathAgentComponent extends Component {
  /** Current path to follow */
  public path: THREE.Vector3[] = [];
  public pathIndex = 0;
  /** Movement speed */
  public speed = 3;
  /** How close to a waypoint to consider it reached */
  public waypointThreshold = 0.5;
  /** Auto-rotate toward movement direction */
  public faceDirection = true;
  /** Recalculate interval in seconds */
  public recalcInterval = 1.0;
  public recalcTimer = 0;
}

// ── Dialogue Components ─────────────────────────────────────────────

/** NPC that can be talked to */
export class DialogueTriggerComponent extends Component {
  /** Dialogue tree ID to start */
  public dialogueTreeId = '';
  /** Interaction range */
  public interactRange = 3;
  /** Can only be triggered once? */
  public oneShot = false;
  public triggered = false;
  /** Display name above NPC */
  public displayName = '';
  /** Whether to show interaction prompt when in range */
  public showPrompt = true;
}

// ── Inventory/Loot Components ───────────────────────────────────────

/** Entity has an inventory */
export class InventoryHolderComponent extends Component {
  /** Inventory size */
  public slots = 20;
  /** Gold/currency */
  public gold = 0;
  /** Reference ID to actual Inventory instance (managed externally) */
  public inventoryId = '';
}

/** Loot drop — item pickup on the ground */
export class LootDropComponent extends Component {
  public itemId = '';
  public quantity = 1;
  /** Pickup range */
  public pickupRange = 2;
  /** Auto-pickup when in range? */
  public autoPickup = false;
  /** Bob animation */
  public bobAmplitude = 0.2;
  public bobSpeed = 2;
  public bobTimer = 0;
}

// ── Audio Component ─────────────────────────────────────────────────

/** Entity that emits spatial audio */
export class AudioSourceComponent extends Component {
  /** Sound key to play */
  public soundKey = '';
  /** Play on spawn? */
  public playOnStart = false;
  /** Loop? */
  public loop = false;
  /** Volume (0-1) */
  public volume = 1;
  /** Max distance for spatial attenuation */
  public maxDistance = 50;
  /** Currently playing? */
  public playing = false;
  /** Has been started? */
  public started = false;
}

// ── Tags / Markers ──────────────────────────────────────────────────

/** Marks entity as player-controlled */
export class PlayerTag extends Component {}

/** Marks entity as an enemy */
export class EnemyTag extends Component {}

/** Marks entity as an NPC */
export class NPCTag extends Component {}

/** Marks entity as a trigger zone */
export class TriggerZoneComponent extends Component {
  public shape: 'box' | 'sphere' = 'box';
  public size = new THREE.Vector3(2, 2, 2);
  public radius = 2;
  /** IDs of entities currently inside */
  public entitiesInside = new Set<number>();
  /** Callback when entity enters */
  public onEnterTag = ''; // or use EventBus
  /** Callback when entity exits */
  public onExitTag = '';
  /** Only trigger for entities with this tag */
  public filterTag = '';
  public enabled = true;
}

// ── Character Controller Component ──────────────────────────────────

export class CharacterControllerComponent extends Component {
  public moveSpeed = 5;
  public runSpeed = 8;
  public jumpForce = 8;
  public rotationSpeed = 10;
  /** Input-driven movement direction (normalized) */
  public moveDirection = new THREE.Vector3();
  public isRunning = false;
  public isJumping = false;
  public canJump = true;
  /** Third-person or first-person */
  public mode: 'first-person' | 'third-person' = 'third-person';
}

// ── Interactable Component ──────────────────────────────────────────

export class InteractableComponent extends Component {
  /** Interaction prompt text */
  public promptText = 'Press E to interact';
  /** Interaction range */
  public range = 3;
  /** Custom action ID */
  public actionId = '';
  /** Whether interaction is currently available */
  public enabled = true;
  /** Has been interacted with */
  public interacted = false;
}

// ── Lifetime/Destroy Component ──────────────────────────────────────

export class LifetimeComponent extends Component {
  public maxLifetime: number;
  public elapsed = 0;

  constructor(maxLifetime: number) {
    super();
    this.maxLifetime = maxLifetime;
  }

  get expired(): boolean {
    return this.elapsed >= this.maxLifetime;
  }
}
