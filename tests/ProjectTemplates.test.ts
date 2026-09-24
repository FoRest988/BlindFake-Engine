// @vitest-environment jsdom

import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyTemplate } from '../client/src/ProjectTemplates';
import { PhysicsBodyComponent, TransformComponent } from '../client/src/ecs/components/GameComponents';
import { CharacterControllerComponent } from '../client/src/ecs/components/GameComponents2D';

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: vi.fn(() => ({
      fillStyle: '#000000',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(),
      putImageData: vi.fn(),
      createImageData: vi.fn(),
    })),
    configurable: true,
  });
});

function createEngineStub() {
  const canvas = document.createElement('canvas');
  canvas.requestPointerLock = vi.fn();
  document.body.appendChild(canvas);

  const overlay = document.createElement('div');
  overlay.id = 'ui-overlay';
  document.body.appendChild(overlay);

  const createEntity = (name: string) => {
    const components = new Map<unknown, unknown>();
    return {
      name,
      add(component: unknown) {
        components.set((component as { constructor: unknown }).constructor, component);
        return this;
      },
      addTag() {
        return this;
      },
      get<T>(type: new (...args: any[]) => T): T {
        return components.get(type) as T;
      },
    };
  };

  return {
    viewportCanvas: canvas,
    renderer: { domElement: canvas },
    camera: new THREE.PerspectiveCamera(),
    world: {
      createEntity: vi.fn((name: string) => createEntity(name)),
      getSystem: vi.fn(() => ({ markTerrainDirty: vi.fn() })),
    },
    input: {
      isKeyDown: vi.fn(() => false),
      isKeyJustPressed: vi.fn(() => false),
      isMouseButtonDown: vi.fn(() => false),
      isPointerLocked: false,
      mouseDeltaX: 0,
      mouseDeltaY: 0,
      scrollDelta: 0,
    },
    editorActive: true,
  } as any;
}

describe('ProjectTemplates', () => {
  it('populates the 2d template with attached scripts on traversal landmarks', () => {
    const engine = createEngineStub();
    const scene = new THREE.Scene();

    const result = applyTemplate(engine, scene, '2d');

    expect(result.updateFn).toBeTypeOf('function');
    expect(scene.getObjectByName('Runner')?.userData.__luaScript).toContain('Runner Controller');
    expect(scene.getObjectByName('Battery_0')?.userData.__luaScript).toContain('Power Battery');
    expect(scene.getObjectByName('CheckpointTower')?.userData.__luaScript).toContain('Checkpoint Tower');
    expect(scene.getObjectByName('SignalDoor')?.userData.__luaScript).toContain('Signal Door');
    expect(scene.getObjectByName('LiftPlatform_0')?.userData.__luaScript).toContain('Lift Platform');
    expect(scene.getObjectByName('ExitBeacon')?.userData.__luaScript).toContain('Exit Beacon');
  });

  it('populates the default 3D template with attached scripts on route landmarks', () => {
    const engine = createEngineStub();
    const scene = new THREE.Scene();

    const result = applyTemplate(engine, scene, '3d');

    expect(result.updateFn).toBeTypeOf('function');
    expect(scene.getObjectByName('CampTerminal')?.userData.__luaScript).toContain('Camp Terminal');
    expect(scene.getObjectByName('SurveyBeacon')?.userData.__luaScript).toContain('Survey Beacon');
    expect(scene.getObjectByName('AncientGate')?.userData.__luaScript).toContain('Ancient Gate');
    expect(scene.getObjectByName('Windmill_0')?.userData.__luaScript).toContain('Windmill Landmark');
    expect(scene.getObjectByName('EnergyCrystal_0')?.userData.__luaScript).toContain('Energy Crystal');
  });

  it('populates the FPS template with attached scripts on key gameplay objects', () => {
    const engine = createEngineStub();
    const scene = new THREE.Scene();

    const result = applyTemplate(engine, scene, 'fps');

    expect(result.updateFn).toBeTypeOf('function');
    expect(scene.getObjectByName('HealStation')?.userData.__luaScript).toContain('Heal Station');
    expect(scene.getObjectByName('AmmoCrate')?.userData.__luaScript).toContain('Ammo Crate');
    expect(scene.getObjectByName('ExtractionTerminal')?.userData.__luaScript).toContain('Extraction Terminal');
    expect(scene.getObjectByName('HazardDrone_0')?.userData.__luaScript).toContain('Patrol Hazard Drone');
    expect(scene.getObjectByName('TargetDummy_0')?.userData.__luaScript).toContain('Armored Target Dummy');
  });

  it('moves forward in the FPS template when W is pressed', () => {
    const engine = createEngineStub();
    const scene = new THREE.Scene();

    const result = applyTemplate(engine, scene, 'fps');
    const startZ = engine.camera.position.z;

    engine.editorActive = false;
    engine.input.isKeyDown = vi.fn((key: string) => key === 'w');
    result.updateFn?.(0.1, 0);

    // Initial yaw = Math.PI so camera faces +Z (toward arena). W adds forward=(0,0,+1).
    expect(engine.camera.position.z).toBeGreaterThan(startZ);
  });

  it('configures the platformer3d template with a kinematic character controller and pointer lock camera capture', () => {
    const engine = createEngineStub();
    const scene = new THREE.Scene();

    const result = applyTemplate(engine, scene, 'platformer3d');
    const playerEntity = engine.world.createEntity.mock.results[0]?.value;
    const playerBody = playerEntity?.get(PhysicsBodyComponent) as PhysicsBodyComponent | undefined;
    const controller = playerEntity?.get(CharacterControllerComponent) as CharacterControllerComponent | undefined;

    expect(result.updateFn).toBeTypeOf('function');
    expect(scene.getObjectByName('CheckpointBeacon')?.userData.__luaScript).toContain('Checkpoint Beacon');
    expect(scene.getObjectByName('BouncePad')?.userData.__luaScript).toContain('Bounce Pad');
    expect(scene.getObjectByName('HazardSpinner')?.userData.__luaScript).toContain('Hazard Spinner');
    expect(playerBody?.bodyType).toBe('kinematic');
    expect(playerBody?._useCharacterController).toBe(true);
    expect(controller?.jumpForce).toBeGreaterThan(0);

    // Pointer lock is now requested via a document-level mousedown listener
    // that checks e.target === the active viewport canvas.
    engine.editorActive = false;
    const event = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(event, 'target', { value: engine.viewportCanvas });
    document.dispatchEvent(event);
    expect(engine.viewportCanvas.requestPointerLock).toHaveBeenCalledOnce();
  });

  it('resets platformer3d runtime state between play sessions', () => {
    const engine = createEngineStub();
    const scene = new THREE.Scene();

    const result = applyTemplate(engine, scene, 'platformer3d');
    const playerEntity = engine.world.createEntity.mock.results[0]?.value;
    const transform = playerEntity?.get(TransformComponent) as TransformComponent | undefined;
    const resettableUpdate = result.updateFn as ((((delta: number, elapsed: number) => void)) & { resetState?: () => void }) | null;
    const firstCoin = scene.getObjectByName('Coin_0') as THREE.Mesh | undefined;

    expect(resettableUpdate?.resetState).toBeTypeOf('function');
    expect(transform).toBeDefined();
    expect(firstCoin?.visible).toBe(true);

    engine.editorActive = false;
    transform?.position.copy(firstCoin!.position);
    resettableUpdate?.(1 / 60, 0);

    expect(firstCoin?.visible).toBe(false);

    resettableUpdate?.resetState?.();

    expect(firstCoin?.visible).toBe(true);
    expect(transform?.position.toArray()).toEqual([0, 4, 0]);
  });

  it('populates the topdown2d template with attached scripts on mission-critical objects', () => {
    const engine = createEngineStub();
    const scene = new THREE.Scene();

    const result = applyTemplate(engine, scene, 'topdown2d');

    expect(result.updateFn).toBeTypeOf('function');
    expect(scene.getObjectByName('Courier')?.userData.__luaScript).toContain('Courier Controller');
    expect(scene.getObjectByName('CommandRelay')?.userData.__luaScript).toContain('Command Relay');
    expect(scene.getObjectByName('ExtractionPad')?.userData.__luaScript).toContain('Extraction Pad');
    expect(scene.getObjectByName('PatrolDrone_0')?.userData.__luaScript).toContain('Patrol Drone');
    expect(scene.getObjectByName('DataShard_0')?.userData.__luaScript).toContain('Data Shard');
  });

  it('populates the mainmenu template with attached scripts on key presentation objects', () => {
    const engine = createEngineStub();
    const scene = new THREE.Scene();

    const result = applyTemplate(engine, scene, 'mainmenu');

    expect(result.updateFn).toBeTypeOf('function');
    expect(scene.getObjectByName('MenuCameraRig')?.userData.__luaScript).toContain('Menu Camera Rig');
    expect(scene.getObjectByName('MenuPortal')?.userData.__luaScript).toContain('Menu Portal');
    expect(scene.getObjectByName('TitleMonolith')?.userData.__luaScript).toContain('Title Monolith');
    expect(scene.getObjectByName('PLAY_Pedestal')?.userData.__luaScript).toContain('Menu Pedestal');
  });

  it('populates the fighting template with fighter meshes and arena objects', () => {
    const engine = createEngineStub();
    const scene = new THREE.Scene();

    const result = applyTemplate(engine, scene, 'fighting');

    expect(result.updateFn).toBeTypeOf('function');
    expect(scene.getObjectByName('Fighter_P1')?.userData.__luaScript).toContain('Fighter');
    expect(scene.getObjectByName('Fighter_P2')?.userData.__luaScript).toContain('Fighter');
    expect(scene.getObjectByName('ArenaFloor')).toBeDefined();
    expect(scene.getObjectByName('Stand_P1')).toBeDefined();
    expect(scene.getObjectByName('Stand_P2')).toBeDefined();
  });

  it('populates the racing template with checkpoints, cars, and boost pads', () => {
    const engine = createEngineStub();
    const scene = new THREE.Scene();

    const result = applyTemplate(engine, scene, 'racing');

    expect(result.updateFn).toBeTypeOf('function');
    expect(scene.getObjectByName('Checkpoint_0')?.userData.__luaScript).toContain('Checkpoint');
    expect(scene.getObjectByName('Car_Player')?.userData.__luaScript).toContain('Player Car');
    expect(scene.getObjectByName('AICar_0')?.userData.__luaScript).toContain('AI Racer');
    expect(scene.getObjectByName('BoostPad_0')?.userData.__luaScript).toContain('Boost Pad');
    expect(scene.getObjectByName('StartLine')?.userData.__luaScript).toContain('Start');
    expect(scene.getObjectByName('PitStop')?.userData.__luaScript).toContain('Pit Stop');
  });

  it('populates the puzzle template with interactive puzzle objects and a player', () => {
    const engine = createEngineStub();
    const scene = new THREE.Scene();

    const result = applyTemplate(engine, scene, 'puzzle');

    expect(result.updateFn).toBeTypeOf('function');
    expect(scene.getObjectByName('PressurePlate_0')?.userData.__luaScript).toContain('Pressure Plate');
    expect(scene.getObjectByName('PuzzleDoor_0')?.userData.__luaScript).toContain('Puzzle Door');
    expect(scene.getObjectByName('KeyPickup_0')?.userData.__luaScript).toContain('Key Pickup');
    expect(scene.getObjectByName('LockMechanism_0')?.userData.__luaScript).toContain('Lock Mechanism');
    expect(scene.getObjectByName('MovingPlatform_0')?.userData.__luaScript).toContain('Moving Platform');
    expect(scene.getObjectByName('ExitPortal')?.userData.__luaScript).toContain('Exit Portal');
    expect(scene.getObjectByName('HintScroll_0')?.userData.__luaScript).toContain('Hint Scroll');
  });
});