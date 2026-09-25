/**
 * ScriptingSystem — Runtime script component & execution engine.
 * Scripts are written in TypeScript-like syntax and compiled to JS for execution.
 * Provides a sandboxed API for scene manipulation, input, physics, etc.
 */

import * as THREE from 'three';

// ─── Script API (exposed to user scripts) ────────────────────────
export interface ScriptAPI {
  /** The entity's main Object3D */
  object: THREE.Object3D;
  /** Current scene */
  scene: THREE.Scene;
  /** Delta time */
  delta: number;
  /** Elapsed time */
  elapsed: number;
  /** Input helper */
  input: InputAPI;
  /** Spawn a new object */
  spawn: (geometry: string, material?: Record<string, unknown>) => THREE.Mesh;
  /** Find object by name */
  find: (name: string) => THREE.Object3D | undefined;
  /** Log to console */
  log: (...args: unknown[]) => void;
  /** Get/set custom data */
  data: Record<string, unknown>;
  /** Destroy an object */
  destroy: (obj: THREE.Object3D) => void;
  /** Math shortcuts */
  vec3: (x?: number, y?: number, z?: number) => THREE.Vector3;
  color: (hex: number | string) => THREE.Color;
  /** Raycaster */
  raycast: (origin: THREE.Vector3, direction: THREE.Vector3) => THREE.Intersection[];
}

export interface InputAPI {
  isKeyDown: (key: string) => boolean;
  isKeyPressed: (key: string) => boolean;
  mouseX: number;
  mouseY: number;
  isMouseDown: (button?: number) => boolean;
}

// ─── Script Definition ───────────────────────────────────────────
export interface ScriptDefinition {
  id: string;
  name: string;
  code: string;
  enabled: boolean;
}

// ─── Compiled Script ─────────────────────────────────────────────
interface CompiledScript {
  start?: (api: ScriptAPI) => void;
  update?: (api: ScriptAPI) => void;
  onDestroy?: (api: ScriptAPI) => void;
  data: Record<string, unknown>;
  errors: string[];
}

// ─── Input Manager for Scripts ───────────────────────────────────
export class ScriptInputManager {
  private keysDown = new Set<string>();
  private keysPressed = new Set<string>();
  private mouseButtons = new Set<number>();
  public mouseX = 0;
  public mouseY = 0;

  // Store bound handlers so they can be removed in dispose()
  private readonly _onKeyDown: (e: KeyboardEvent) => void;
  private readonly _onKeyUp: (e: KeyboardEvent) => void;
  private readonly _onMouseMove: (e: MouseEvent) => void;
  private readonly _onMouseDown: (e: MouseEvent) => void;
  private readonly _onMouseUp: (e: MouseEvent) => void;

  constructor() {
    this._onKeyDown = (e: KeyboardEvent) => {
      if (!this.keysDown.has(e.code)) this.keysPressed.add(e.code);
      this.keysDown.add(e.code);
    };
    this._onKeyUp = (e: KeyboardEvent) => {
      this.keysDown.delete(e.code);
    };
    this._onMouseMove = (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    this._onMouseDown = (e: MouseEvent) => {
      this.mouseButtons.add(e.button);
    };
    this._onMouseUp = (e: MouseEvent) => {
      this.mouseButtons.delete(e.button);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
  }

  isKeyDown(key: string): boolean { return this.keysDown.has(key); }
  isKeyPressed(key: string): boolean { return this.keysPressed.has(key); }
  isMouseDown(button = 0): boolean { return this.mouseButtons.has(button); }

  /** Call at end of frame to clear pressed keys */
  flush(): void {
    this.keysPressed.clear();
  }

  /** Remove all window listeners — call when the scripting runtime is disposed */
  dispose(): void {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.keysDown.clear();
    this.keysPressed.clear();
    this.mouseButtons.clear();
  }

  getAPI(): InputAPI {
    return {
      isKeyDown: (k) => this.isKeyDown(k),
      isKeyPressed: (k) => this.isKeyPressed(k),
      mouseX: this.mouseX,
      mouseY: this.mouseY,
      isMouseDown: (b) => this.isMouseDown(b),
    };
  }
}

// ─── Scripting Runtime ───────────────────────────────────────────
export class ScriptingRuntime {
  private scene: THREE.Scene;
  private inputManager: ScriptInputManager;
  private raycaster = new THREE.Raycaster();
  private scripts = new Map<string, { definition: ScriptDefinition; compiled: CompiledScript; object: THREE.Object3D }>();
  private logs: { level: string; message: string; time: number }[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.inputManager = new ScriptInputManager();
  }

  /** Attach a script to an object */
  attach(object: THREE.Object3D, definition: ScriptDefinition): { errors: string[] } {
    const compiled = this.compile(definition.code);
    this.scripts.set(definition.id, { definition, compiled, object });
    return { errors: compiled.errors };
  }

  /** Detach a script */
  detach(id: string): void {
    const entry = this.scripts.get(id);
    if (entry?.compiled.onDestroy) {
      try {
        entry.compiled.onDestroy(this.createAPI(entry.object, entry.compiled.data, 0, 0));
      } catch (e) {
        this.log('error', `onDestroy error: ${e}`);
      }
    }
    this.scripts.delete(id);
  }

  /** Update a script's code (hot-reload) */
  hotReload(id: string, newCode: string): { errors: string[] } {
    const entry = this.scripts.get(id);
    if (!entry) return { errors: ['Script not found'] };

    const oldData = entry.compiled.data;
    const compiled = this.compile(newCode);
    // Preserve data across reloads
    Object.assign(compiled.data, oldData);
    entry.compiled = compiled;
    entry.definition.code = newCode;
    return { errors: compiled.errors };
  }

  /** Call start() on all scripts */
  start(): void {
    for (const entry of this.scripts.values()) {
      if (!entry.definition.enabled) continue;
      if (entry.compiled.start) {
        try {
          entry.compiled.start(this.createAPI(entry.object, entry.compiled.data, 0, 0));
        } catch (e) {
          this.log('error', `start() error in ${entry.definition.name}: ${e}`);
        }
      }
    }
  }

  /** Call update() on all scripts */
  update(delta: number, elapsed: number): void {
    for (const entry of this.scripts.values()) {
      if (!entry.definition.enabled) continue;
      if (entry.compiled.update) {
        try {
          entry.compiled.update(this.createAPI(entry.object, entry.compiled.data, delta, elapsed));
        } catch (e) {
          this.log('error', `update() error in ${entry.definition.name}: ${e}`);
        }
      }
    }
    this.inputManager.flush();
  }

  /** Get recent logs */
  getLogs(): typeof this.logs {
    return this.logs;
  }

  /** Clear logs */
  clearLogs(): void {
    this.logs.length = 0;
  }

  /** Dispose the runtime — detaches all scripts and removes input listeners */
  dispose(): void {
    for (const entry of this.scripts.values()) {
      if (entry.compiled.onDestroy) {
        try {
          entry.compiled.onDestroy(this.createAPI(entry.object, entry.compiled.data, 0, 0));
        } catch { /* ignore */ }
      }
    }
    this.scripts.clear();
    this.inputManager.dispose();
  }

  // ── Compilation ─────────────────────────────────────
  private compile(code: string): CompiledScript {
    const errors: string[] = [];
    const result: CompiledScript = { data: {}, errors };

    try {
      // Strip TypeScript type annotations for runtime execution
      const jsCode = this.stripTypes(code);

      // Wrap in a module-like function that returns {start, update, onDestroy}
      const wrapped = `
        "use strict";
        return (function() {
          ${jsCode}
          return {
            start: typeof start === 'function' ? start : undefined,
            update: typeof update === 'function' ? update : undefined,
            onDestroy: typeof onDestroy === 'function' ? onDestroy : undefined,
          };
        })();
      `;

      // Use Function constructor (sandboxed — no access to globals except what we pass)
      // eslint-disable-next-line no-new-func -- not actually sandboxed; replaced by LuaHost in rework F4
      const factory = new Function(wrapped);
      const exports = factory();

      result.start = exports.start;
      result.update = exports.update;
      result.onDestroy = exports.onDestroy;
    } catch (e) {
      errors.push(`Compilation error: ${e}`);
    }

    return result;
  }

  /** Strip basic TypeScript type annotations for JS execution */
  private stripTypes(code: string): string {
    return code
      // Remove : Type annotations on variables and parameters
      .replace(/:\s*(?:number|string|boolean|void|any|unknown|never|THREE\.\w+|Record<[^>]+>|Array<[^>]+>|\w+(?:\[\])?)\s*(?=[,=)\];{}])/g, '')
      // Remove interface/type declarations
      .replace(/^(?:export\s+)?(?:interface|type)\s+\w+[^{]*\{[^}]*\}/gm, '')
      // Remove as Type casts
      .replace(/\s+as\s+\w+(?:\.\w+)*/g, '')
      // Remove generic type params on functions 
      .replace(/<(?:number|string|boolean|any|\w+)(?:\s*,\s*(?:number|string|boolean|any|\w+))*>/g, '');
  }

  private createAPI(object: THREE.Object3D, data: Record<string, unknown>, delta: number, elapsed: number): ScriptAPI {
    const scene = this.scene;
    const raycaster = this.raycaster;
    const log = this.log.bind(this);
    const inputAPI = this.inputManager.getAPI();

    return {
      object,
      scene,
      delta,
      elapsed,
      input: inputAPI,
      data,
      log: (...args: unknown[]) => log('info', args.map(String).join(' ')),
      find: (name: string) => scene.getObjectByName(name),
      vec3: (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z),
      color: (hex: number | string) => new THREE.Color(hex),
      spawn: (geometry: string, matOpts?: Record<string, unknown>) => {
        const geometries: Record<string, THREE.BufferGeometry> = {
          box: new THREE.BoxGeometry(),
          sphere: new THREE.SphereGeometry(0.5, 16, 16),
          cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
          plane: new THREE.PlaneGeometry(1, 1),
          cone: new THREE.ConeGeometry(0.5, 1, 16),
          torus: new THREE.TorusGeometry(0.5, 0.15, 8, 24),
        };
        const geo = geometries[geometry] ?? new THREE.BoxGeometry();
        const mat = new THREE.MeshStandardMaterial(matOpts as THREE.MeshStandardMaterialParameters ?? {});
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
        return mesh;
      },
      destroy: (obj: THREE.Object3D) => {
        obj.removeFromParent();
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material?.dispose();
        }
      },
      raycast: (origin: THREE.Vector3, direction: THREE.Vector3) => {
        raycaster.set(origin, direction.normalize());
        return raycaster.intersectObjects(scene.children, true);
      },
    };
  }

  private log(level: string, message: string): void {
    this.logs.push({ level, message, time: Date.now() });
    if (this.logs.length > 200) this.logs.shift();
  }
}

// ─── Default Script Templates ────────────────────────────────────
export const SCRIPT_TEMPLATES: Record<string, string> = {
  'Empty': `// Script: Empty
function start(api) {
  api.log('Script started!');
}

function update(api) {
  // Called every frame
}
`,
  'Rotate': `// Script: Rotate Object
function update(api) {
  api.object.rotation.y += api.delta * 1.0;
}
`,
  'Follow Mouse': `// Script: Follow Mouse on XZ Plane
function update(api) {
  const speed = 5;
  if (api.input.isKeyDown('KeyW')) api.object.position.z -= speed * api.delta;
  if (api.input.isKeyDown('KeyS')) api.object.position.z += speed * api.delta;
  if (api.input.isKeyDown('KeyA')) api.object.position.x -= speed * api.delta;
  if (api.input.isKeyDown('KeyD')) api.object.position.x += speed * api.delta;
}
`,
  'Oscillate': `// Script: Oscillate Position
function start(api) {
  api.data.startY = api.object.position.y;
}

function update(api) {
  api.object.position.y = api.data.startY + Math.sin(api.elapsed * 2) * 0.5;
}
`,
  'Spawner': `// Script: Click to Spawn
function update(api) {
  if (api.input.isKeyPressed('Space')) {
    const box = api.spawn('sphere', { color: 0xff4444 });
    box.position.copy(api.object.position);
    box.position.y += 2;
    api.log('Spawned a sphere!');
  }
}
`,
  'Look At Camera': `// Script: Look At Main Camera
function update(api) {
  const cam = api.find('MainCamera') || api.scene.children.find(
    c => c.type === 'PerspectiveCamera'
  );
  if (cam) api.object.lookAt(cam.position);
}
`,
  'Third Person Controller': `// Script: Third Person Controller (WASD + Jump)
function start(api) {
  api.data.speed = 8;
  api.data.jumpForce = 12;
  api.data.grounded = true;
  api.data.velocityY = 0;
  api.data.gravity = -25;
}

function update(api) {
  const obj = api.object;
  const dt = api.delta;
  const input = api.input;
  const dir = { x: 0, z: 0 };

  if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) dir.z -= 1;
  if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) dir.z += 1;
  if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) dir.x -= 1;
  if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) dir.x += 1;

  const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
  if (len > 0) { dir.x /= len; dir.z /= len; }

  obj.position.x += dir.x * api.data.speed * dt;
  obj.position.z += dir.z * api.data.speed * dt;

  // Gravity + Jump
  if (input.isKeyPressed('Space') && api.data.grounded) {
    api.data.velocityY = api.data.jumpForce;
    api.data.grounded = false;
  }
  api.data.velocityY += api.data.gravity * dt;
  obj.position.y += api.data.velocityY * dt;
  if (obj.position.y <= 1) { obj.position.y = 1; api.data.velocityY = 0; api.data.grounded = true; }
}
`,
  'Health System': `// Script: Health System (damage, heal, death)
function start(api) {
  api.data.maxHealth = 100;
  api.data.health = 100;
  api.data.dead = false;
}

function update(api) {
  // Press H to heal, press K to take damage
  if (api.input.isKeyPressed('KeyH')) {
    api.data.health = Math.min(api.data.maxHealth, api.data.health + 25);
    api.log('Healed! HP: ' + api.data.health);
  }
  if (api.input.isKeyPressed('KeyK')) {
    api.data.health = Math.max(0, api.data.health - 30);
    api.log('Damaged! HP: ' + api.data.health);
    if (api.data.health <= 0 && !api.data.dead) {
      api.data.dead = true;
      api.log('DEAD!');
      api.object.visible = false;
    }
  }
}
`,
  'Projectile': `// Script: Projectile Shooter (click to fire)
function start(api) {
  api.data.fireRate = 0.3;
  api.data.lastFire = 0;
  api.data.speed = 30;
}

function update(api) {
  if (api.elapsed - api.data.lastFire > api.data.fireRate && api.input.isKeyDown('KeyF')) {
    api.data.lastFire = api.elapsed;
    const bullet = api.spawn('sphere', { color: 0xffaa00, radius: 0.15 });
    bullet.position.copy(api.object.position);
    bullet.position.y += 1;

    const forward = { x: 0, y: 0, z: -api.data.speed };
    bullet.userData._vel = forward;
    api.log('Fire!');
  }

  // Move all bullets
  api.scene.traverse(child => {
    if (child.userData._vel) {
      child.position.z += child.userData._vel.z * api.delta;
      if (Math.abs(child.position.z) > 100) child.removeFromParent();
    }
  });
}
`,
  'Door / Trigger': `// Script: Door / Trigger Zone
function start(api) {
  api.data.open = false;
  api.data.triggerDist = 3;
  api.data.openY = api.object.position.y + 3;
  api.data.closedY = api.object.position.y;
}

function update(api) {
  const player = api.find('Player');
  if (!player) return;

  const dx = player.position.x - api.object.position.x;
  const dz = player.position.z - api.object.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  const shouldOpen = dist < api.data.triggerDist;
  const targetY = shouldOpen ? api.data.openY : api.data.closedY;
  api.object.position.y += (targetY - api.object.position.y) * 5 * api.delta;

  if (shouldOpen && !api.data.open) { api.data.open = true; api.log('Door opened'); }
  if (!shouldOpen && api.data.open) { api.data.open = false; api.log('Door closed'); }
}
`,
  'Enemy Patrol': `// Script: Enemy AI Patrol (walks between waypoints)
function start(api) {
  const pos = api.object.position;
  api.data.waypoints = [
    { x: pos.x, z: pos.z },
    { x: pos.x + 10, z: pos.z },
    { x: pos.x + 10, z: pos.z - 10 },
    { x: pos.x, z: pos.z - 10 },
  ];
  api.data.waypointIdx = 0;
  api.data.speed = 3;
}

function update(api) {
  const wp = api.data.waypoints[api.data.waypointIdx];
  const obj = api.object;
  const dx = wp.x - obj.position.x;
  const dz = wp.z - obj.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist < 0.3) {
    api.data.waypointIdx = (api.data.waypointIdx + 1) % api.data.waypoints.length;
  } else {
    obj.position.x += (dx / dist) * api.data.speed * api.delta;
    obj.position.z += (dz / dist) * api.data.speed * api.delta;
    obj.lookAt(obj.position.x + dx, obj.position.y, obj.position.z + dz);
  }
}
`,
  'Pickup Item': `// Script: Collectible Pickup (bobbing + auto-collect)
function start(api) {
  api.data.baseY = api.object.position.y;
  api.data.collected = false;
  api.data.collectDist = 2;
}

function update(api) {
  if (api.data.collected) return;

  // Bobbing animation
  api.object.position.y = api.data.baseY + Math.sin(api.elapsed * 3) * 0.3;
  api.object.rotation.y += api.delta * 2;

  // Auto-collect when player is near
  const player = api.find('Player');
  if (!player) return;
  const dx = player.position.x - api.object.position.x;
  const dz = player.position.z - api.object.position.z;
  if (Math.sqrt(dx * dx + dz * dz) < api.data.collectDist) {
    api.data.collected = true;
    api.object.visible = false;
    api.log('Item collected!');
  }
}
`,
  'Timer / Cooldown': `// Script: Timer & Cooldown example
function start(api) {
  api.data.cooldown = 0;
  api.data.cooldownMax = 3;
  api.data.count = 0;
}

function update(api) {
  if (api.data.cooldown > 0) {
    api.data.cooldown -= api.delta;
    // Visual feedback: scale down during cooldown
    const t = api.data.cooldown / api.data.cooldownMax;
    api.object.scale.setScalar(0.5 + 0.5 * (1 - t));
    return;
  }

  api.object.scale.setScalar(1);

  if (api.input.isKeyPressed('KeyE')) {
    api.data.count++;
    api.data.cooldown = api.data.cooldownMax;
    api.log('Action #' + api.data.count + '! Cooldown: ' + api.data.cooldownMax + 's');
  }
}
`,
};
