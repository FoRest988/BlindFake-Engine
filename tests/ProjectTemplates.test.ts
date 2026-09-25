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
    mode: 'edit',
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
    engine.mode = 'play';
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

    engine.mode = 'play';
    transform?.position.copy(firstCoin!.position);
    resettableUpdate?.(1 / 60, 0);

    expect(firstCoin?.visible).toBe(false);

    resettableUpdate?.resetState?.();

    expect(firstCoin?.visible).toBe(true);
    expect(transform?.position.toArray()).toEqual([0, 4, 0]);
  });

});