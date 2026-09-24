import * as THREE from 'three';
import { InputManager } from './InputManager';
import { AssetManager } from './AssetManager';
import { SceneManager } from './SceneManager';
import { CinematicEngine } from '../cinematics/CinematicEngine';
import { ParticleSystem } from './ParticleSystem';
import { World } from '../ecs/World';
import { RenderSystem } from '../ecs/systems/RenderSystem';
import { PhysicsSystem } from '../ecs/systems/PhysicsSystem';
import { AnimationSystem } from '../ecs/systems/AnimationSystem';
import { AISystem } from '../ecs/systems/AISystem';
import { CharacterControllerSystem } from '../ecs/systems/CharacterControllerSystem';
import { RapierPhysicsEngine } from './RapierPhysics';
import { MaterialLibrary } from './MaterialLibrary';

// New engine subsystems
import { AudioManager } from './AudioManager';
import { EventBus } from './EventBus';
import { TweenManager } from './TweenManager';
import { PostProcessingManager } from './PostProcessing';
import { TimerManager } from './Timer';
import { PrefabManager } from './PrefabManager';
import { UIManager } from './UIManager';
import { DebugOverlay, DebugDraw } from './DebugTools';
import { DialogueManager } from '../gameplay/DialogueSystem';
import { QuestTracker } from '../gameplay/QuestSystem';
import { SaveManager } from './SaveManager';
import { InputActionManager } from './InputActions';
import { PoolManager } from './ObjectPool';
import { SceneTransition } from './SceneTransition';
import { CameraEffects } from './CameraEffects';
import { Localization } from './Localization';

// Extended subsystems
import { LODSystem } from './LODSystem';
import { BillboardManager } from './BillboardSystem';
import { DecalSystem } from './DecalSystem';
import { InstancedRenderer } from './InstancedRenderer';
import { WeatherSystem } from './WeatherSystem';
import { SkySystem } from './SkySystem';
import { NavMesh, NavMeshDebugDraw } from './NavMeshSystem';
import { IKSystem } from './IKSystem';
import { RagdollSystem } from './RagdollSystem';
import { ClothSimulation } from './ClothSimulation';
import { FogSystem } from './FogSystem';
import { TrailManager } from './TrailRenderer';
import { MinimapSystem } from './MinimapSystem';
import { BehaviorTreeManager } from '../gameplay/BehaviorTree';
import { SpawnManager, WaveSystem } from '../gameplay/SpawnSystem';
import { AbilitySystem } from '../gameplay/AbilitySystem';
import { StatusEffectSystem } from '../gameplay/StatusEffectSystem';
import { AchievementSystem } from '../gameplay/AchievementSystem';
import { PerformanceManager, RenderStatsOverlay } from './PerformanceManager';
import { DamagePopupSystem } from '../gameplay/DamagePopup';

export interface EngineConfig {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  shadows?: boolean;
  pixelRatio?: number;
}

export class Engine {
  public renderer: THREE.WebGLRenderer;
  public camera: THREE.PerspectiveCamera;
  public input: InputManager;
  public assets: AssetManager;
  public scenes: SceneManager;
  public cinematics: CinematicEngine;
  public particles: ParticleSystem;
  public world: World;

  // ── New Subsystems ──────────────────────────────────────────────
  public audio: AudioManager;
  public events: EventBus;
  public tweens: TweenManager;
  public postProcessing: PostProcessingManager;
  public timers: TimerManager;
  public prefabs: PrefabManager;
  public ui: UIManager;
  public debugOverlay: DebugOverlay;
  public debugDraw!: DebugDraw; // initialized when scene is set
  public dialogue: DialogueManager;
  public quests: QuestTracker;
  public save: SaveManager;
  public inputActions: InputActionManager;
  public pools: PoolManager;
  public sceneTransition: SceneTransition;
  public cameraEffects: CameraEffects;
  public localization: Localization;

  // Extended subsystems
  public lod: LODSystem;
  public billboards: BillboardManager;
  public decals: DecalSystem;
  public instancing: InstancedRenderer;
  public weather: WeatherSystem;
  public sky!: SkySystem;
  public materialLibrary: MaterialLibrary;

  // Advanced systems
  public navMesh: NavMesh;
  public navMeshDebug: NavMeshDebugDraw | null = null;
  public ik: IKSystem;
  public ragdoll: RagdollSystem | null = null;  // Initialized when Rapier is ready
  public clothSims: ClothSimulation[] = [];

  // New gameplay & rendering systems
  public fog!: FogSystem;
  public trails!: TrailManager;
  public minimap: MinimapSystem | null = null;
  public behaviorTrees: BehaviorTreeManager;
  public spawns: SpawnManager;
  public waves: WaveSystem;
  public abilities: AbilitySystem;
  public statusEffects: StatusEffectSystem;
  public achievements: AchievementSystem;
  public damagePopups: DamagePopupSystem | null = null;
  public performance: PerformanceManager;
  public renderStats: RenderStatsOverlay;

  private physicsSystem: PhysicsSystem;

  private clock: THREE.Clock;
  private running = false;
  private animFrameId = 0;
  private boundOnResize = this.onResize.bind(this);
  private fpsCounter = { frames: 0, lastTime: 0, fps: 0 };

  /** User-defined callback that runs each frame before rendering */
  public onUpdate: ((delta: number, elapsed: number) => void) | null = null;

  /** When true, the editor is active — ECS physics/game systems are paused */
  public editorActive = false;

  /** The active viewport canvas — set by EditorApp so templates use the correct canvas for pointer lock / mouse events */
  public viewportCanvas: HTMLCanvasElement | null = null;

  constructor(config: EngineConfig) {
    // Renderer — upgraded with Babylon.js-inspired quality defaults
    this.renderer = new THREE.WebGLRenderer({
      canvas: config.canvas,
      antialias: config.antialias ?? true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,   // eliminates z-fighting at distance
      stencil: false,                 // saves VRAM (re-enable if needed)
    });
    this.renderer.setPixelRatio(config.pixelRatio ?? Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    if (config.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    this.camera.position.set(0, 5, 10);

    // Core systems
    this.clock = new THREE.Clock();
    this.input = new InputManager(config.canvas);
    this.assets = new AssetManager();
    this.assets.initKTX2(this.renderer); // Enable KTX2/Basis Universal compressed textures
    this.scenes = new SceneManager();
    this.cinematics = new CinematicEngine(this);
    this.particles = new ParticleSystem();

    // ECS World
    this.world = new World();
    this.world.addSystem(new RenderSystem(this));
    this.physicsSystem = new PhysicsSystem();
    this.world.addSystem(this.physicsSystem);
    this.world.addSystem(new AnimationSystem(this));
    this.world.addSystem(new CharacterControllerSystem(this));
    this.world.addSystem(new AISystem());

    // New subsystems
    this.audio = new AudioManager();
    this.events = new EventBus();
    this.tweens = new TweenManager();
    this.postProcessing = new PostProcessingManager(this.renderer);
    this.timers = new TimerManager();
    this.prefabs = new PrefabManager();
    this.ui = new UIManager();
    this.debugOverlay = new DebugOverlay();
    this.dialogue = new DialogueManager();
    this.quests = new QuestTracker();
    this.save = new SaveManager();
    this.inputActions = new InputActionManager(this.input);
    this.pools = new PoolManager();
    this.sceneTransition = new SceneTransition();
    this.cameraEffects = new CameraEffects(this.camera);
    this.localization = new Localization();

    // Extended subsystems
    this.lod = new LODSystem(this.camera);
    this.billboards = new BillboardManager();
    this.decals = new DecalSystem();
    this.instancing = new InstancedRenderer();
    this.weather = new WeatherSystem();
    this.materialLibrary = new MaterialLibrary();

    // Advanced systems
    this.navMesh = new NavMesh();
    this.ik = new IKSystem();

    // Gameplay systems
    this.behaviorTrees = new BehaviorTreeManager();
    this.spawns = new SpawnManager();
    this.waves = new WaveSystem(this.spawns);
    this.abilities = new AbilitySystem();
    this.statusEffects = new StatusEffectSystem();
    this.achievements = new AchievementSystem();

    // Performance monitoring & adaptive quality
    this.performance = new PerformanceManager();
    this.performance.init(this);
    this.renderStats = new RenderStatsOverlay(this.performance);

    // Events
    window.addEventListener('resize', this.boundOnResize);
    this.events.on('terrain:applied', () => this.physicsSystem.markTerrainDirty());

    // Initialize Rapier WASM (async, physics starts when ready)
    this.physicsSystem.initRapier();
    // Forward raw Rapier contact events onto the shared EventBus
    this.physicsSystem.rapier.onContact = (event) => {
      this.events.emit('physics:collision', event);
    };
  }

  /** Access the Rapier physics engine for raycasts, forces, joints etc. */
  get physics(): RapierPhysicsEngine { return this.physicsSystem.rapier; }

  /**
   * Batch static (non-moving) meshes in the active scene to reduce draw calls.
   * Thin wrapper over `SceneManager.batchStaticObjects()`.
   *
   * @returns Number of draw calls eliminated.
   */
  batchScene(): number {
    return this.scenes.batchStaticObjects();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.fpsCounter.lastTime = performance.now();
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animFrameId);
  }

  private loop = (): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.loop);

    this.performance.frameStart();
    const delta = Math.min(this.clock.getDelta(), 0.1); // Cap delta to prevent spiral
    const elapsed = this.clock.elapsedTime;
    const activeScene = this.scenes.active;

    this.updateFpsCounter();
    this.prepareActiveScene(activeScene);
    this.world.update(delta, elapsed);
    if (!this.editorActive) this.updateRuntimeSystems(delta);
    this.updateAlwaysOnSystems(delta);

    // User game logic callback (runs before render, after ECS)
    if (this.onUpdate) {
      this.onUpdate(delta, elapsed);
    }

    this.renderActiveScene(activeScene);

    this.performance.frameEnd();

    // Flush input at end of frame so justPressed is available during update
    this.input.update();
  };

  private updateFpsCounter(): void {
    this.fpsCounter.frames++;
    const now = performance.now();
    if (now - this.fpsCounter.lastTime >= 1000) {
      this.fpsCounter.fps = this.fpsCounter.frames;
      this.fpsCounter.frames = 0;
      this.fpsCounter.lastTime = now;
    }
  }

  private prepareActiveScene(activeScene: THREE.Scene | null): void {
    if (!activeScene) return;

    if (this.physicsSystem.scene !== activeScene) {
      this.physicsSystem.scene = activeScene;
      this.physicsSystem.markTerrainDirty();
    }
    if (!this.sky) {
      this.sky = new SkySystem(activeScene, this.renderer);
    }
    if (!this.fog) {
      this.fog = new FogSystem(activeScene, this.camera, this.renderer);
      this.trails = new TrailManager(activeScene);
    }
  }

  private updateRuntimeSystems(delta: number): void {
    this.cinematics.update(delta);
    this.particles.update(delta);
    this.tweens.update(delta);
    this.timers.update(delta);
    this.dialogue.update(delta);
    this.quests.update(delta);
    this.audio.updateListener(this.camera);
    this.audio.updateZones(this.camera.position);
    this.inputActions.update(delta);
    this.sceneTransition.update(delta);
    this.cameraEffects.update(delta);
    this.weather.update(delta);
    if (this.sky) this.sky.update(delta);
    this.ik.update(delta);
    if (this.ragdoll) this.ragdoll.update();
    for (const cloth of this.clothSims) cloth.update(delta);

    this.behaviorTrees.update(delta);
    this.spawns.update(delta);
    this.waves.update(delta);
    this.abilities.update(delta);
    this.statusEffects.update(delta);
    if (this.fog) this.fog.update(delta);
    if (this.trails) this.trails.update(delta, this.camera);
    if (this.minimap) this.minimap.update(delta);
    if (this.damagePopups) this.damagePopups.update(delta);
  }

  private updateAlwaysOnSystems(delta: number): void {
    this.lod.update();
    this.billboards.update(delta, this.camera);
    this.debugOverlay.update(delta, this.renderer);
    if (this.debugDraw) this.debugDraw.update(delta);
  }

  private renderActiveScene(scene: THREE.Scene | null): void {
    if (!scene) return;

    this.optimizeFrame(scene);

    if (!this.debugDraw) {
      this.debugDraw = new DebugDraw(scene);
    }

    if (this.postProcessing.hasEffects) {
      this.postProcessing.render(scene, this.camera);
    } else {
      this.renderer.render(scene, this.camera);
    }

    this.restoreAfterRender();
  }

  get fps(): number {
    return this.fpsCounter.fps;
  }

  // ── Per-frame rendering optimizations (Babylon.js-inspired) ──

  /** Shadow distance cutoff — objects beyond this distance won't cast shadows */
  public shadowCastDistance = 100;
  /** Max lights that cast shadows per frame (sorted by distance) */
  public maxShadowLights = 4;

  private _tempVec = new THREE.Vector3();
  private _shadowRestoreList: { obj: THREE.Object3D; original: boolean }[] = [];

  /** Optimise the scene before rendering: shadow culling, light budget */
  private optimizeFrame(scene: THREE.Scene): void {
    const camPos = this.camera.position;

    // ── 1) Shadow distance culling ──
    // Temporarily disable castShadow on meshes far from camera
    this._shadowRestoreList.length = 0;
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && obj.castShadow) {
        const dist = this._tempVec.setFromMatrixPosition(obj.matrixWorld).distanceTo(camPos);
        if (dist > this.shadowCastDistance) {
          this._shadowRestoreList.push({ obj, original: true });
          obj.castShadow = false;
        }
      }
    });

    // ── 2) Light shadow budget ──
    // Only the N closest shadow-casting lights get to actually cast shadows
    const shadowLights: { light: THREE.Light; dist: number; original: boolean }[] = [];
    scene.traverse((obj) => {
      const l = obj as THREE.Light;
      if (l.isLight && l.castShadow) {
        const dist = l.position.distanceTo(camPos);
        shadowLights.push({ light: l, dist, original: true });
      }
    });

    if (shadowLights.length > this.maxShadowLights) {
      shadowLights.sort((a, b) => a.dist - b.dist);
      for (let i = this.maxShadowLights; i < shadowLights.length; i++) {
        shadowLights[i].light.castShadow = false;
      }
    }
  }

  /** Restore shadows after render (called by loop after render) */
  private restoreAfterRender(): void {
    for (const entry of this._shadowRestoreList) {
      entry.obj.castShadow = entry.original;
    }
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postProcessing.resize(w, h);
  }

  dispose(): void {
    this.stop();
    this.disposeCoreSystems();
    this.disposeRenderingSystems();
    this.disposeOptionalSystems();
    this.renderer.dispose();
    window.removeEventListener('resize', this.boundOnResize);
  }

  private disposeCoreSystems(): void {
    this.input.dispose();
    this.assets.dispose();
    this.particles.dispose();
    this.postProcessing.dispose();
    this.audio.dispose();
    this.ui.dispose();
    this.debugOverlay.dispose();
    if (this.debugDraw) this.debugDraw.dispose();
    this.timers.cancelAll();
    this.inputActions.destroy();
    this.sceneTransition.cancel();
    this.cameraEffects.dispose();
    this.pools.dispose();
    this.weather.dispose();
  }

  private disposeRenderingSystems(): void {
    this.lod.dispose();
    this.billboards.dispose();
    this.decals.dispose();
    this.instancing.dispose();
    this.performance.dispose();
    this.renderStats.dispose();
  }

  private disposeOptionalSystems(): void {
    if (this.ragdoll) this.ragdoll.dispose();
    for (const cloth of this.clothSims) cloth.dispose();
    if (this.minimap) this.minimap.dispose();
    if (this.damagePopups) this.damagePopups.dispose();
    if (this.sky) this.sky.dispose();
    if (this.fog) this.fog.dispose();
    if (this.trails) this.trails.dispose();
  }

  /** Create a minimap overlay — only call this if your game needs one */
  createMinimap(cfg?: Parameters<typeof MinimapSystem['prototype']['configure']>[0]): MinimapSystem {
    const scene = this.scenes.active;
    if (!scene) throw new Error('Cannot create minimap before a scene is active');
    if (this.minimap) this.minimap.dispose();
    this.minimap = new MinimapSystem(scene, this.renderer, cfg);
    return this.minimap;
  }

  /** Create the damage popup system — only call this if your game needs floating numbers */
  createDamagePopups(cfg?: ConstructorParameters<typeof DamagePopupSystem>[2]): DamagePopupSystem {
    const scene = this.scenes.active;
    if (!scene) throw new Error('Cannot create damage popups before a scene is active');
    if (this.damagePopups) this.damagePopups.dispose();
    this.damagePopups = new DamagePopupSystem(scene, this.camera, cfg);
    return this.damagePopups;
  }
}
