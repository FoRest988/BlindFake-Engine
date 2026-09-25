import * as THREE from 'three';
import type { CinematicEngine, CinematicTrack, CinematicKeyframe } from './CinematicEngine';

// ═══════════════════════════════════════════════════════════════
// PHASE 13 — Lua Scripting: Extended API, Hot-Reload, Debugger
// ═══════════════════════════════════════════════════════════════

/* ─── Lua API Reference (for autocomplete) ──────────────────── */
export interface LuaAPIEntry {
  label: string;
  detail: string;
  doc: string;
}

export const LUA_API_REFERENCE: Record<string, LuaAPIEntry[]> = {
  scene: [
    { label: 'scene.spawn(name, geom, x, y, z)', detail: '→ object', doc: 'Spawn a new mesh into the scene.' },
    { label: 'scene.find(name)', detail: '→ object | nil', doc: 'Find a scene object by name.' },
    { label: 'scene.destroy(name)', detail: '→ void', doc: 'Remove an object from the scene.' },
    { label: 'scene.setPosition(name, x, y, z)', detail: '→ void', doc: 'Set world position.' },
    { label: 'scene.getPosition(name)', detail: '→ x, y, z', doc: 'Get world position.' },
    { label: 'scene.setRotation(name, x, y, z)', detail: '→ void', doc: 'Set Euler rotation (radians).' },
    { label: 'scene.setScale(name, x, y, z)', detail: '→ void', doc: 'Set uniform or per-axis scale.' },
    { label: 'scene.setVisible(name, visible)', detail: '→ void', doc: 'Show or hide an object.' },
    { label: 'scene.setColor(name, r, g, b)', detail: '→ void', doc: 'Set material color (0..1).' },
    { label: 'scene.findByTag(tag)', detail: '→ table', doc: 'Find all objects with a userData.tag.' },
    { label: 'scene.getChildren(name)', detail: '→ table', doc: 'Get child objects of a parent.' },
  ],
  physics: [
    { label: 'physics.applyForce(name, x, y, z)', detail: '→ void', doc: 'Apply a continuous force to a rigidbody.' },
    { label: 'physics.applyImpulse(name, x, y, z)', detail: '→ void', doc: 'Apply an instant impulse.' },
    { label: 'physics.setVelocity(name, x, y, z)', detail: '→ void', doc: 'Set linear velocity directly.' },
    { label: 'physics.getVelocity(name)', detail: '→ x, y, z', doc: 'Get current linear velocity.' },
    { label: 'physics.raycast(ox, oy, oz, dx, dy, dz, maxDist)', detail: '→ hit, x, y, z, dist', doc: 'Cast a ray and return first hit.' },
    { label: 'physics.setGravity(x, y, z)', detail: '→ void', doc: 'Change global gravity vector.' },
    { label: 'physics.setKinematic(name, kinematic)', detail: '→ void', doc: 'Toggle kinematic mode on a body.' },
  ],
  input: [
    { label: 'input.isKeyDown(code)', detail: '→ bool', doc: 'True while key is held (KeyCode string).' },
    { label: 'input.isKeyPressed(code)', detail: '→ bool', doc: 'True only on the frame key was pressed.' },
    { label: 'input.isKeyReleased(code)', detail: '→ bool', doc: 'True only on the frame key was released.' },
    { label: 'input.getAxis(name)', detail: '→ number', doc: 'Get named axis value (-1..1). Names: Horizontal, Vertical.' },
    { label: 'input.mouseX()', detail: '→ number', doc: 'Mouse X in screen pixels.' },
    { label: 'input.mouseY()', detail: '→ number', doc: 'Mouse Y in screen pixels.' },
    { label: 'input.isMouseDown(btn)', detail: '→ bool', doc: 'True while mouse button is held (0=left).' },
  ],
  audio: [
    { label: 'audio.play(url, volume)', detail: '→ void', doc: 'Play a sound effect once.' },
    { label: 'audio.playMusic(url, fadeIn)', detail: '→ void', doc: 'Play background music with optional fade-in.' },
    { label: 'audio.stopMusic(fadeOut)', detail: '→ void', doc: 'Stop background music with optional fade-out.' },
    { label: 'audio.stop(url)', detail: '→ void', doc: 'Stop a playing sound by URL.' },
    { label: 'audio.setVolume(group, vol)', detail: '→ void', doc: 'Set volume of a group (sfx, music, master).' },
    { label: 'audio.play3D(url, x, y, z, vol)', detail: '→ void', doc: 'Play a 3D positional sound.' },
  ],
  timer: [
    { label: 'timer.after(seconds, fn)', detail: '→ id', doc: 'Call fn once after a delay in seconds.' },
    { label: 'timer.every(seconds, fn)', detail: '→ id', doc: 'Call fn repeatedly at an interval.' },
    { label: 'timer.cancel(id)', detail: '→ void', doc: 'Cancel a timer by its id.' },
    { label: 'timer.getTime()', detail: '→ number', doc: 'Get total elapsed time in seconds.' },
    { label: 'timer.getDelta()', detail: '→ number', doc: 'Get last frame delta time in seconds.' },
  ],
  event: [
    { label: 'event.emit(name, data)', detail: '→ void', doc: 'Broadcast a named event with optional data.' },
    { label: 'event.on(name, fn)', detail: '→ id', doc: 'Subscribe to a named event. Returns subscription id.' },
    { label: 'event.off(id)', detail: '→ void', doc: 'Unsubscribe from an event.' },
    { label: 'event.once(name, fn)', detail: '→ id', doc: 'Subscribe once, auto-removed after first call.' },
  ],
  tween: [
    { label: 'tween.to(name, prop, target, duration, ease)', detail: '→ id', doc: 'Animate an object property to a value.' },
    { label: 'tween.from(name, prop, from, duration, ease)', detail: '→ id', doc: 'Animate from a value to current.' },
    { label: 'tween.cancel(id)', detail: '→ void', doc: 'Cancel a running tween.' },
    { label: 'tween.eases', detail: 'linear|quad|cubic|sine|bounce|elastic', doc: 'Available easing functions.' },
  ],
  debug: [
    { label: 'debug.log(msg)', detail: '→ void', doc: 'Print info to the script log.' },
    { label: 'debug.warn(msg)', detail: '→ void', doc: 'Print warning (yellow) to the script log.' },
    { label: 'debug.error(msg)', detail: '→ void', doc: 'Print error (red) to the script log.' },
    { label: 'debug.drawRay(ox,oy,oz, dx,dy,dz, color, dur)', detail: '→ void', doc: 'Draw a debug ray in the viewport.' },
    { label: 'debug.drawSphere(x,y,z, r, color, dur)', detail: '→ void', doc: 'Draw a debug sphere wireframe.' },
    { label: 'debug.watch(name, value)', detail: '→ void', doc: 'Push a variable to the watch panel.' },
  ],
};

/* ─── Lua Debugger ───────────────────────────────────────────── */
export interface LuaBreakpoint {
  line: number;
  enabled: boolean;
  condition?: string;   // optional expression string (evaluated in JS)
}

export interface LuaWatchEntry {
  expr: string;
  lastValue: string;
}

export interface LuaCallStackFrame {
  fn: string;
  line: number;
}

export class LuaDebugger {
  private breakpoints = new Map<number, LuaBreakpoint>(); // line → bp
  private watches: LuaWatchEntry[] = [];
  private _callStack: LuaCallStackFrame[] = [];
  private _stepMode = false;
  private _paused = false;
  private _locals: Record<string, unknown> = {};

  /** Fired when execution pauses at a breakpoint or step. */
  onPause?: (line: number, locals: Record<string, unknown>, callStack: LuaCallStackFrame[]) => void;
  /** Fired after each "line" execution in step mode. */
  onStep?: (line: number) => void;

  setBreakpoint(line: number, enabled = true, condition?: string): void {
    this.breakpoints.set(line, { line, enabled, condition });
  }

  clearBreakpoint(line: number): void {
    this.breakpoints.delete(line);
  }

  clearAllBreakpoints(): void {
    this.breakpoints.clear();
  }

  hasBreakpoint(line: number): boolean {
    return this.breakpoints.get(line)?.enabled ?? false;
  }

  getAllBreakpoints(): LuaBreakpoint[] {
    return Array.from(this.breakpoints.values());
  }

  addWatch(expr: string): void {
    if (!this.watches.find(w => w.expr === expr)) {
      this.watches.push({ expr, lastValue: '?' });
    }
  }

  removeWatch(expr: string): void {
    this.watches = this.watches.filter(w => w.expr !== expr);
  }

  getWatches(): LuaWatchEntry[] {
    return this.watches;
  }

  setStepMode(enabled: boolean): void {
    this._stepMode = enabled;
    if (!enabled) this._paused = false;
  }

  get stepMode(): boolean { return this._stepMode; }
  get paused(): boolean { return this._paused; }

  /** Called by the interpreter before executing a "line". Returns true if execution should pause. */
  checkLine(line: number, locals: Record<string, unknown> = {}): boolean {
    this._locals = locals;
    const bp = this.breakpoints.get(line);
    const shouldBreak = this._stepMode || (bp?.enabled ?? false);

    if (shouldBreak) {
      this._paused = true;
      this.onPause?.(line, locals, this._callStack);
      this.onStep?.(line);

      // Update watches with current locals
      for (const w of this.watches) {
        const val = locals[w.expr];
        w.lastValue = val !== undefined ? String(val) : '(undefined)';
      }
      return true;
    }
    return false;
  }

  resume(): void {
    this._paused = false;
  }

  pushFrame(fn: string, line: number): void {
    this._callStack.push({ fn, line });
  }

  popFrame(): void {
    this._callStack.pop();
  }

  getCallStack(): LuaCallStackFrame[] {
    return [...this._callStack];
  }

  getLocals(): Record<string, unknown> {
    return { ...this._locals };
  }
}

/* ─── Hot-Reload Manager ─────────────────────────────────────── */
export class LuaHotReloadManager {
  private scripts = new Map<string, { code: string; mtime: number; autoReload: boolean }>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private readonly CHECK_MS = 500;

  /** Called when a script needs to be reloaded. */
  onReload?: (id: string, newCode: string) => void;
  /** Called when a save is detected (even without change). */
  onSave?: (id: string) => void;

  register(id: string, code: string, autoReload = true): void {
    this.scripts.set(id, { code, mtime: Date.now(), autoReload });
  }

  unregister(id: string): void {
    this.scripts.delete(id);
  }

  /**
   * Update the stored code for a script.
   * If the code changed, fires `onReload` if autoReload is true.
   */
  update(id: string, newCode: string): boolean {
    const entry = this.scripts.get(id);
    if (!entry) { this.register(id, newCode); return true; }

    const changed = entry.code !== newCode;
    entry.code = newCode;
    entry.mtime = Date.now();
    this.onSave?.(id);

    if (changed && entry.autoReload) {
      this.onReload?.(id, newCode);
    }
    return changed;
  }

  getCode(id: string): string | undefined {
    return this.scripts.get(id)?.code;
  }

  getLastModified(id: string): number {
    return this.scripts.get(id)?.mtime ?? 0;
  }

  /** Start background polling (simulates file watcher in browser context). */
  startPolling(getLatestCode: (id: string) => string | null): void {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(() => {
      for (const [id, entry] of this.scripts) {
        const latest = getLatestCode(id);
        if (latest !== null && latest !== entry.code) {
          this.update(id, latest);
        }
      }
    }, this.CHECK_MS);
  }

  stopPolling(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  dispose(): void {
    this.stopPolling();
    this.scripts.clear();
  }
}

/* ─── Extended Lua API for interpreter ──────────────────────── */

/** Log callback type used by the extended interpreter. */
export type LuaLogFn = (level: 'info' | 'warn' | 'error', msg: string) => void;

/** Minimal game context passed to the Lua interpreter (Phase 13). */
export interface LuaGameContext {
  scene?: THREE.Scene;
  delta?: number;
  elapsed?: number;
  log?: LuaLogFn;
  /** Accumulated debug draw calls for the viewport. */
  debugDraws?: Array<{ type: 'ray' | 'sphere'; args: number[]; color: string; duration: number }>;
  /** Emitted events (collected for the event bus). */
  emittedEvents?: Array<{ name: string; data: unknown }>;
  /** Registered event listeners. */
  eventListeners?: Map<string, Array<(data: unknown) => void>>;
  /** Active timers. */
  timers?: Map<number, { fn: () => void; interval: number; remaining: number; repeat: boolean }>;
  /** Active tweens. */
  tweens?: Map<number, { obj: THREE.Object3D; prop: string; from: number; to: number; elapsed: number; duration: number; ease: string }>;
  /** Watch panel entries: name → current value string */
  watchPanel?: Map<string, string>;
}

/* ─── Extended Lua Script Templates ─────────────────────────── */
export const EXTENDED_LUA_TEMPLATES: Record<string, string> = {
  'Lua: Hello World': `-- Lua Hello World
function start()
  debug.log("Hello from Lua!")
  scene.spawn("cube_1", "box", 0, 1, 0)
end

function update()
  if input.isKeyDown("Space") then
    debug.log("Space held! t=" .. timer.getTime())
  end
end
`,
  'Lua: Orbit Object': `-- Lua: Orbit an object around a point
local angle = 0
local radius = 5
local speed = 1.5

function update()
  angle = angle + timer.getDelta() * speed
  local x = math.cos(angle) * radius
  local z = math.sin(angle) * radius
  scene.setPosition("Cube", x, 1, z)
end
`,
  'Lua: Events Demo': `-- Lua: Event Bus demo
function start()
  event.on("playerDied", function(data)
    debug.warn("Player died! Score: " .. tostring(data))
  end)
  timer.after(2, function()
    event.emit("playerDied", 42)
  end)
end
`,
  'Lua: Tween Demo': `-- Lua: Tween position
function start()
  scene.spawn("box1", "box", -3, 1, 0)
  timer.after(1, function()
    tween.to("box1", "position.x", 3, 2, "sine")
    debug.log("Tween started!")
  end)
end
`,
  'Lua: Raycast': `-- Lua: Raycast from origin
function update()
  if input.isKeyPressed("KeyR") then
    local hit, x, y, z, dist = physics.raycast(0, 10, 0, 0, -1, 0, 50)
    if hit then
      debug.log("Hit at " .. x .. ", " .. y .. ", " .. z .. " dist=" .. dist)
      debug.drawRay(0, 10, 0, 0, -1, 0, "#ff0000", 1)
    end
  end
end
`,
  'Lua: Patrol AI': `-- Lua: Simple patrol with events
local waypoints = {{0,0},{5,0},{5,5},{0,5}}
local idx = 1
local speed = 3

function start()
  scene.spawn("enemy", "sphere", 0, 0.5, 0)
  debug.log("Patrol started")
end

function update()
  local dt = timer.getDelta()
  local wp = waypoints[idx]
  local ex, _, ez = scene.getPosition("enemy")
  local dx = wp[1] - ex
  local dz = wp[2] - ez
  local dist = math.sqrt(dx*dx + dz*dz)
  if dist < 0.3 then
    idx = (idx % #waypoints) + 1
    event.emit("waypointReached", idx)
  else
    scene.setPosition("enemy", ex + dx/dist*speed*dt, 0.5, ez + dz/dist*speed*dt)
  end
end
`,
};

/**
 * Lua Script Runner for Cinematics
 *
 * Executes Lua scripts to build cinematic tracks.
 * Uses fengari-web for Lua execution in the browser.
 *
 * Example Lua script:
 * ```lua
 * cinematic.name = "Intro"
 * cinematic.duration = 15
 *
 * -- camera moves from behind to front
 * keyframe(0, {
 *   camera_pos = {0, 10, 30},
 *   camera_look = {0, 2, 0},
 *   camera_fov = 50,
 *   letterbox = true,
 *   subtitle = "The world was cruel...",
 *   speaker = "Narrator"
 * })
 * ```
 */
export class LuaScriptRunner {
  private cinematicEngine: CinematicEngine;
  private fengari: any = null;

  /** Phase 13: Debugger instance. Attach before calling execute(). */
  debugger: LuaDebugger | null = null;

  /** Phase 13: Hot-reload manager. */
  hotReload = new LuaHotReloadManager();

  /** Phase 13: Game context for extended API calls. */
  gameContext: LuaGameContext = {};

  constructor(cinematicEngine: CinematicEngine) {
    this.cinematicEngine = cinematicEngine;
  }

  private async loadFengari(): Promise<void> {
    if (this.fengari) return;
    // Fengari-web provides Lua 5.3 in the browser
    try {
      this.fengari = await import('fengari-web');
    } catch {
      console.warn('Fengari not available, using fallback JSON cinematic parser');
    }
  }

  /** Execute a Lua cinematic script and return the built track */
  execute(luaCode: string): CinematicTrack | null {
    // Fallback: If fengari isn't loaded, try parsing with the simple interpreter
    return this.executeWithInterpreter(luaCode);
  }

  /**
   * Phase 13: Execute a general-purpose Lua game script (non-cinematic).
   * Handles the extended game API: scene, physics, input, audio, timer, event, tween, debug.
   * Returns a log of output messages.
   */
  executeGameScript(luaCode: string, ctx: LuaGameContext = {}): { logs: Array<{ level: string; msg: string }>; errors: string[] } {
    const logs: Array<{ level: string; msg: string }> = [];
    const errors: string[] = [];

    this.gameContext = ctx;
    if (!ctx.timers) ctx.timers = new Map();
    if (!ctx.tweens) ctx.tweens = new Map();
    if (!ctx.eventListeners) ctx.eventListeners = new Map();
    if (!ctx.emittedEvents) ctx.emittedEvents = [];
    if (!ctx.debugDraws) ctx.debugDraws = [];
    if (!ctx.watchPanel) ctx.watchPanel = new Map();

    const log: LuaLogFn = (level, msg) => {
      logs.push({ level, msg });
      ctx.log?.(level, msg);
    };

    try {
      this._runGameScript(luaCode, ctx, log);
    } catch (e) {
      const msg = String(e);
      errors.push(msg);
      log('error', msg);
    }

    return { logs, errors };
  }

  /**
   * Advance all active timers and tweens by `delta` seconds.
   * Call this each game frame when using the extended API.
   */
  tickTimers(delta: number): void {
    const ctx = this.gameContext;
    if (!ctx.timers) return;

    for (const [id, t] of ctx.timers) {
      t.remaining -= delta;
      if (t.remaining <= 0) {
        try { t.fn(); } catch { /* ignore timer errors */ }
        if (t.repeat) {
          t.remaining = t.interval;
        } else {
          ctx.timers.delete(id);
        }
      }
    }

    // Tick tweens
    if (!ctx.tweens) return;
    for (const [id, tw] of ctx.tweens) {
      tw.elapsed += delta;
      const progress = Math.min(tw.elapsed / tw.duration, 1);
      const eased = this._applyEase(tw.ease, progress);
      const current = tw.from + (tw.to - tw.from) * eased;

      // Apply to THREE.Object3D property via dotted path
      if (tw.obj) {
        const parts = tw.prop.split('.');
        let target: any = tw.obj;
        for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
        if (target) target[parts[parts.length - 1]] = current;
      }

      if (progress >= 1) ctx.tweens.delete(id);
    }
  }

  private _tweenIdCounter = 1;
  private _timerIdCounter = 1;

  private _applyEase(ease: string, t: number): number {
    switch (ease) {
      case 'quad':    return t * t;
      case 'cubic':   return t * t * t;
      case 'sine':    return 1 - Math.cos(t * Math.PI / 2);
      case 'bounce':  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      case 'elastic': {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
      }
      default: return t; // linear
    }
  }

  /**
   * Simple line-by-line game script executor.
   * Builds a sandbox object and evaluates each statement against it.
   */
  private _runGameScript(code: string, ctx: LuaGameContext, log: LuaLogFn): void {
    const scene = ctx.scene;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- legacy regex Lua runner, replaced by LuaHost in rework F4
    const _self = this;
    let _timerIdSeq = this._timerIdCounter;
    let _tweenIdSeq = this._tweenIdCounter;

    // ─── API sandbox objects ────────────────────────────────────
    const _scene = {
      spawn: (objName: string, geom: string, x = 0, y = 0, z = 0) => {
        if (!scene) return null;
        const geos: Record<string, () => THREE.BufferGeometry> = {
          box: () => new THREE.BoxGeometry(),
          sphere: () => new THREE.SphereGeometry(0.5, 16, 16),
          cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
          plane: () => new THREE.PlaneGeometry(2, 2),
          cone: () => new THREE.ConeGeometry(0.5, 1, 16),
        };
        const geo = (geos[geom] ?? geos.box)();
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x4488cc }));
        mesh.name = objName;
        mesh.position.set(x, y, z);
        scene.add(mesh);
        return mesh;
      },
      find: (name: string) => scene?.getObjectByName(name) ?? null,
      destroy: (name: string) => { const o = scene?.getObjectByName(name); o?.removeFromParent(); },
      setPosition: (name: string, x: number, y: number, z: number) => { const o = scene?.getObjectByName(name); if (o) o.position.set(x, y, z); },
      getPosition: (name: string): [number, number, number] => { const o = scene?.getObjectByName(name); return o ? [o.position.x, o.position.y, o.position.z] : [0, 0, 0]; },
      setRotation: (name: string, x: number, y: number, z: number) => { const o = scene?.getObjectByName(name); if (o) o.rotation.set(x, y, z); },
      setScale: (name: string, x: number, y: number, z: number) => { const o = scene?.getObjectByName(name); if (o) o.scale.set(x, y, z); },
      setVisible: (name: string, v: boolean) => { const o = scene?.getObjectByName(name); if (o) o.visible = v; },
      setColor: (name: string, r: number, g: number, b: number) => {
        const o = scene?.getObjectByName(name);
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
          o.material.color.setRGB(r, g, b);
        }
      },
      findByTag: (tag: string) => {
        const res: THREE.Object3D[] = [];
        scene?.traverse(o => { if (o.userData.tag === tag) res.push(o); });
        return res;
      },
      getChildren: (name: string) => {
        const o = scene?.getObjectByName(name);
        return o ? o.children : [];
      },
    };

    const _physics = {
      applyForce: (name: string, x: number, y: number, z: number) => {
        const o = scene?.getObjectByName(name);
        if (o) { if (!o.userData._vel) o.userData._vel = { x: 0, y: 0, z: 0 }; o.userData._vel.x += x; o.userData._vel.y += y; o.userData._vel.z += z; }
      },
      applyImpulse: (name: string, x: number, y: number, z: number) => {
        const o = scene?.getObjectByName(name);
        if (o) { if (!o.userData._vel) o.userData._vel = { x: 0, y: 0, z: 0 }; o.userData._vel.x += x * 0.1; o.userData._vel.y += y * 0.1; o.userData._vel.z += z * 0.1; }
      },
      setVelocity: (name: string, x: number, y: number, z: number) => {
        const o = scene?.getObjectByName(name);
        if (o) o.userData._vel = { x, y, z };
      },
      getVelocity: (name: string): [number, number, number] => {
        const o = scene?.getObjectByName(name);
        const v = o?.userData._vel;
        return v ? [v.x, v.y, v.z] : [0, 0, 0];
      },
      raycast: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist = 100): [boolean, number, number, number, number] => {
        if (!scene) return [false, 0, 0, 0, 0];
        const rc = new THREE.Raycaster(new THREE.Vector3(ox, oy, oz), new THREE.Vector3(dx, dy, dz).normalize(), 0, maxDist);
        const hits = rc.intersectObjects(scene.children, true);
        if (hits.length > 0) return [true, hits[0].point.x, hits[0].point.y, hits[0].point.z, hits[0].distance];
        return [false, 0, 0, 0, 0];
      },
      setGravity: (_x: number, _y: number, _z: number) => { log('info', `[physics] setGravity(${_x}, ${_y}, ${_z}) — hook into physics engine`); },
      setKinematic: (name: string, k: boolean) => { const o = scene?.getObjectByName(name); if (o) o.userData._kinematic = k; },
    };

    const _input = {
      isKeyDown: (_key: string) => false,
      isKeyPressed: (_key: string) => false,
      isKeyReleased: (_key: string) => false,
      getAxis: (name: string) => name === 'Horizontal' ? 0 : name === 'Vertical' ? 0 : 0,
      mouseX: () => 0,
      mouseY: () => 0,
      isMouseDown: (_btn = 0) => false,
    };

    const _audio = {
      play: (url: string, vol = 1) => { log('info', `[audio] play("${url}", ${vol})`); },
      playMusic: (url: string, fadeIn = 0) => { log('info', `[audio] playMusic("${url}", fadeIn=${fadeIn})`); },
      stopMusic: (fadeOut = 0) => { log('info', `[audio] stopMusic(fadeOut=${fadeOut})`); },
      stop: (url: string) => { log('info', `[audio] stop("${url}")`); },
      setVolume: (group: string, vol: number) => { log('info', `[audio] setVolume("${group}", ${vol})`); },
      play3D: (url: string, x: number, y: number, z: number, vol = 1) => { log('info', `[audio] play3D("${url}", ${x},${y},${z}, ${vol})`); },
    };

    const _timer = {
      after: (seconds: number, fn: () => void): number => {
        const id = _timerIdSeq++;
        ctx.timers!.set(id, { fn, interval: seconds, remaining: seconds, repeat: false });
        return id;
      },
      every: (seconds: number, fn: () => void): number => {
        const id = _timerIdSeq++;
        ctx.timers!.set(id, { fn, interval: seconds, remaining: seconds, repeat: true });
        return id;
      },
      cancel: (id: number) => { ctx.timers!.delete(id); },
      getTime: () => ctx.elapsed ?? 0,
      getDelta: () => ctx.delta ?? 0,
    };

    const _event = {
      emit: (name: string, data: unknown = null) => {
        ctx.emittedEvents!.push({ name, data });
        const listeners = ctx.eventListeners!.get(name) ?? [];
        for (const fn of listeners) { try { fn(data); } catch { /* ignore */ } }
      },
      on: (name: string, fn: (data: unknown) => void): number => {
        if (!ctx.eventListeners!.has(name)) ctx.eventListeners!.set(name, []);
        ctx.eventListeners!.get(name)!.push(fn);
        return _timerIdSeq++;
      },
      once: (name: string, fn: (data: unknown) => void): number => {
        const wrapper = (data: unknown) => { fn(data); _event.off(-1); };
        return _event.on(name, wrapper);
      },
      off: (_id: number) => { /* simplified */ },
    };

    const _tween = {
      to: (name: string, prop: string, target: number, duration: number, ease = 'linear'): number => {
        const obj = scene?.getObjectByName(name);
        if (!obj) return -1;
        const parts = prop.split('.');
        let src: any = obj;
        for (let i = 0; i < parts.length; i++) src = src?.[parts[i]];
        const from = typeof src === 'number' ? src : 0;
        const id = _tweenIdSeq++;
        ctx.tweens!.set(id, { obj, prop, from, to: target, elapsed: 0, duration, ease });
        return id;
      },
      from: (name: string, prop: string, from: number, duration: number, ease = 'linear'): number => {
        const obj = scene?.getObjectByName(name);
        if (!obj) return -1;
        const parts = prop.split('.');
        let src: any = obj;
        for (let i = 0; i < parts.length; i++) src = src?.[parts[i]];
        const to = typeof src === 'number' ? src : 0;
        const id = _tweenIdSeq++;
        ctx.tweens!.set(id, { obj, prop, from, to, elapsed: 0, duration, ease });
        return id;
      },
      cancel: (id: number) => { ctx.tweens!.delete(id); },
    };

    const _debug = {
      log: (msg: unknown) => log('info', String(msg)),
      warn: (msg: unknown) => log('warn', String(msg)),
      error: (msg: unknown) => log('error', String(msg)),
      drawRay: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, color = '#ffffff', dur = 0) => {
        ctx.debugDraws!.push({ type: 'ray', args: [ox, oy, oz, dx, dy, dz], color, duration: dur });
      },
      drawSphere: (x: number, y: number, z: number, r: number, color = '#ffffff', dur = 0) => {
        ctx.debugDraws!.push({ type: 'sphere', args: [x, y, z, r], color, duration: dur });
      },
      watch: (name: string, value: unknown) => {
        ctx.watchPanel!.set(name, String(value));
      },
    };

    // ─── Parse & execute game script lines ────────────────────
    this._parseAndRunGameScript(code, {
      scene: _scene, physics: _physics, input: _input,
      audio: _audio, timer: _timer, event: _event,
      tween: _tween, debug: _debug,
      print: (v: unknown) => log('info', String(v)),
      tostring: (v: unknown) => String(v),
      tonumber: (v: unknown) => Number(v),
      math: Math,
    });

    this._timerIdCounter = _timerIdSeq;
    this._tweenIdCounter = _tweenIdSeq;
  }

  /**
   * Execute game-API Lua script using a JS-based Lua-like evaluator.
   * Handles: function declarations, global calls, table constructors, if/else, while/for, math.*
   */
  private _parseAndRunGameScript(code: string, sandbox: Record<string, unknown>): void {
    // Build a JS function that executes the script in the sandbox
    // We translate the most common Lua patterns to JS
    const jsCode = this._luaToJS(code);
    try {
      const keys = Object.keys(sandbox);
      const vals = Object.values(sandbox);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func -- legacy regex Lua runner, replaced by LuaHost in rework F4
      const fn = new Function(...keys, jsCode);
      fn(...vals);
    } catch (e) {
      throw new Error(`Script execution error: ${e}`);
    }
  }

  /**
   * Phase 13: Lua → JS transpiler for game scripts.
   * Translates common Lua patterns to equivalent JS.
   */
  private _luaToJS(lua: string): string {
    let js = lua;

    // Comments: -- → //
    js = js.replace(/--\[\[[\s\S]*?\]\]/g, '/* $& */');
    js = js.replace(/--(.*)$/gm, '//$1');

    // String: single → double (basic)
    // (handled by keeping as-is, both work in JS)

    // Boolean literals
    js = js.replace(/\btrue\b/g, 'true').replace(/\bfalse\b/g, 'false');
    js = js.replace(/\bnil\b/g, 'null');

    // not → !
    js = js.replace(/\bnot\s+/g, '!');

    // and / or
    js = js.replace(/\band\b/g, '&&');
    js = js.replace(/\bor\b/g, '||');

    // ~= → !==
    js = js.replace(/~=/g, '!==');

    // String concat .. → +
    js = js.replace(/\.\./g, '+');

    // # (length operator) → .length  — simple cases only
    js = js.replace(/#(\w+)/g, '$1.length');

    // local var = → let var =
    js = js.replace(/\blocal\s+(\w+)\s*=/g, 'let $1 =');
    js = js.replace(/\blocal\s+(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*=/g, 'let [$1, $2, $3, $4] =');
    js = js.replace(/\blocal\s+(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*=/g, 'let [$1, $2, $3] =');
    js = js.replace(/\blocal\s+(\w+)\s*,\s*(\w+)\s*=/g, 'let [$1, $2] =');

    // Table constructor: { {a, b}, {c, d} } (arrays stay as-is)
    // function declarations
    js = js.replace(/\bfunction\s+(\w+)\s*\(/g, 'function $1(');
    js = js.replace(/\bfunction\s*\(/g, 'function(');

    // if ... then → if (...) {
    js = js.replace(/\bif\s+(.*?)\s+then\b/g, (_, cond) => `if (${cond}) {`);
    // elseif → } else if
    js = js.replace(/\belseif\s+(.*?)\s+then\b/g, (_, cond) => `} else if (${cond}) {`);
    // else → } else {
    js = js.replace(/\belse\b/g, '} else {');
    // end → }
    js = js.replace(/\bend\b/g, '}');

    // while ... do → while (...) {
    js = js.replace(/\bwhile\s+(.*?)\s+do\b/g, (_, cond) => `while (${cond}) {`);

    // for i = a, b, c do  (numeric)
    js = js.replace(/\bfor\s+(\w+)\s*=\s*([\w.]+)\s*,\s*([\w.]+)\s*,\s*([\w.+-]+)\s+do\b/g,
      (_, v, s, e, step) => `for (let ${v} = ${s}; ${v} <= ${e}; ${v} += ${step}) {`);
    js = js.replace(/\bfor\s+(\w+)\s*=\s*([\w.]+)\s*,\s*([\w.]+)\s+do\b/g,
      (_, v, s, e) => `for (let ${v} = ${s}; ${v} <= ${e}; ${v}++) {`);

    // for k, v in ipairs(t) do
    js = js.replace(/\bfor\s+(\w+)\s*,\s*(\w+)\s+in\s+ipairs\s*\(\s*(\w+)\s*\)\s+do\b/g,
      (_, k, v, t) => `for (let [${k}, ${v}] of (${t}??[]).entries()) {`);

    // tostring → String, tonumber → Number
    js = js.replace(/\btostring\b/g, 'String');
    js = js.replace(/\btonumber\b/g, 'Number');

    // math.* — already available via sandbox.math = Math
    js = js.replace(/\bmath\./g, 'math.');

    // table.insert(t, v) → t.push(v)
    js = js.replace(/\btable\.insert\s*\(\s*(\w+)\s*,\s*([^)]+)\)/g, '$1.push($2)');
    // table.remove(t, i) → t.splice(i-1, 1)
    js = js.replace(/\btable\.remove\s*\(\s*(\w+)\s*,\s*([^)]+)\)/g, '$1.splice($2-1, 1)');
    // #table → table.length
    js = js.replace(/#(\w+)/g, '$1.length');

    // print → debug.log (if used)
    js = js.replace(/\bprint\s*\(/g, 'debug.log(');

    // Lua's multi-return: local a, b, c = fn() → let [a, b, c] = fn()
    js = js.replace(/\blet\s+\[(\w+(?:\s*,\s*\w+)*)\]\s*=/g, 'let [$1] =');

    // Lua self. → this.  (limited use, skip for safety)

    return js;
  }

  /**
   * Simple Lua-like interpreter for cinematic scripts.
   * This handles the core cinematic DSL without requiring full Lua runtime.
   * Supports: cinematic.name, cinematic.duration, keyframe() calls
   */
  private executeWithInterpreter(script: string): CinematicTrack | null {
    const track: CinematicTrack = {
      name: 'Untitled',
      duration: 10,
      keyframes: [],
    };

    const lines = script.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (trimmed.startsWith('--') || trimmed === '') continue;

      // cinematic.name = "..."
      const nameMatch = trimmed.match(/^cinematic\.name\s*=\s*["'](.+?)["']/);
      if (nameMatch) {
        track.name = nameMatch[1];
        continue;
      }

      // cinematic.duration = N
      const durMatch = trimmed.match(/^cinematic\.duration\s*=\s*([\d.]+)/);
      if (durMatch) {
        track.duration = parseFloat(durMatch[1]);
        continue;
      }

      // cinematic.loop = true/false
      const loopMatch = trimmed.match(/^cinematic\.loop\s*=\s*(true|false)/);
      if (loopMatch) {
        track.loop = loopMatch[1] === 'true';
        continue;
      }
    }

    // Parse keyframe blocks
    const keyframeRegex = /keyframe\s*\(\s*([\d.]+)\s*,\s*\{([^}]*)\}\s*\)/gs;
    let match;
    while ((match = keyframeRegex.exec(script)) !== null) {
      const time = parseFloat(match[1]);
      const propsStr = match[2];
      const kf = this.parseKeyframeProps(time, propsStr);
      track.keyframes.push(kf);
    }

    // Sort keyframes by time
    track.keyframes.sort((a, b) => a.time - b.time);

    return track.keyframes.length > 0 ? track : null;
  }

  private parseKeyframeProps(time: number, propsStr: string): CinematicKeyframe {
    const kf: CinematicKeyframe = { time };

    // camera_pos = {x, y, z}
    const posMatch = propsStr.match(/camera_pos\s*=\s*\{\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\}/);
    if (posMatch) {
      kf.cameraPosition = new THREE.Vector3(
        parseFloat(posMatch[1]),
        parseFloat(posMatch[2]),
        parseFloat(posMatch[3])
      );
    }

    // camera_look = {x, y, z}
    const lookMatch = propsStr.match(/camera_look\s*=\s*\{\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\}/);
    if (lookMatch) {
      kf.cameraLookAt = new THREE.Vector3(
        parseFloat(lookMatch[1]),
        parseFloat(lookMatch[2]),
        parseFloat(lookMatch[3])
      );
    }

    // camera_fov = N
    const fovMatch = propsStr.match(/camera_fov\s*=\s*([\d.]+)/);
    if (fovMatch) {
      kf.cameraFov = parseFloat(fovMatch[1]);
    }

    // subtitle = "..."
    const subMatch = propsStr.match(/subtitle\s*=\s*["']([^"']*)["']/);
    if (subMatch) {
      kf.subtitle = subMatch[1];
    }

    // speaker = "..."
    const speakerMatch = propsStr.match(/speaker\s*=\s*["']([^"']*)["']/);
    if (speakerMatch) {
      kf.subtitleSpeaker = speakerMatch[1];
    }

    // letterbox = true/false
    const lbMatch = propsStr.match(/letterbox\s*=\s*(true|false)/);
    if (lbMatch) {
      kf.letterbox = lbMatch[1] === 'true';
    }

    // event = "..."
    const eventMatch = propsStr.match(/event\s*=\s*["']([^"']*)["']/);
    if (eventMatch) {
      kf.event = eventMatch[1];
    }

    // fade_color = "#..."
    const fadeColorMatch = propsStr.match(/fade_color\s*=\s*["']([^"']*)["']/);
    if (fadeColorMatch) {
      kf.fadeColor = fadeColorMatch[1];
    }

    // fade_alpha = N
    const fadeAlphaMatch = propsStr.match(/fade_alpha\s*=\s*([\d.]+)/);
    if (fadeAlphaMatch) {
      kf.fadeAlpha = parseFloat(fadeAlphaMatch[1]);
    }

    return kf;
  }
}

/** Serialize a CinematicTrack back to Lua script format */
export function trackToLua(track: CinematicTrack): string {
  let lua = `-- BlindFake Cinematic Script\n`;
  lua += `-- Generated by Cinematic Editor\n\n`;
  lua += `cinematic.name = "${track.name}"\n`;
  lua += `cinematic.duration = ${track.duration}\n`;
  if (track.loop) lua += `cinematic.loop = true\n`;
  lua += `\n`;

  for (const kf of track.keyframes) {
    lua += `keyframe(${kf.time}, {\n`;
    if (kf.cameraPosition) {
      lua += `  camera_pos = {${kf.cameraPosition.x}, ${kf.cameraPosition.y}, ${kf.cameraPosition.z}},\n`;
    }
    if (kf.cameraLookAt) {
      lua += `  camera_look = {${kf.cameraLookAt.x}, ${kf.cameraLookAt.y}, ${kf.cameraLookAt.z}},\n`;
    }
    if (kf.cameraFov !== undefined) {
      lua += `  camera_fov = ${kf.cameraFov},\n`;
    }
    if (kf.letterbox !== undefined) {
      lua += `  letterbox = ${kf.letterbox},\n`;
    }
    if (kf.subtitle !== undefined) {
      lua += `  subtitle = "${kf.subtitle}",\n`;
    }
    if (kf.subtitleSpeaker) {
      lua += `  speaker = "${kf.subtitleSpeaker}",\n`;
    }
    if (kf.event) {
      lua += `  event = "${kf.event}",\n`;
    }
    if (kf.fadeColor) {
      lua += `  fade_color = "${kf.fadeColor}",\n`;
    }
    if (kf.fadeAlpha !== undefined) {
      lua += `  fade_alpha = ${kf.fadeAlpha},\n`;
    }
    lua += `})\n\n`;
  }

  return lua;
}

