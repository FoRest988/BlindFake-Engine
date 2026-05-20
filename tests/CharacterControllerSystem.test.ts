import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CharacterControllerSystem } from '../client/src/ecs/systems/CharacterControllerSystem';
import { TransformComponent, PhysicsBodyComponent, CameraFollowComponent } from '../client/src/ecs/components/GameComponents';
import { CharacterControllerComponent } from '../client/src/ecs/components/GameComponents2D';

describe('CharacterControllerSystem', () => {
  it('jumps on held space while grounded without requiring a second press', () => {
    const transform = new TransformComponent();
    const body = new PhysicsBodyComponent();
    body.grounded = true;
    const controller = new CharacterControllerComponent();

    const entity = {
      id: 1,
      get(type: new (...args: any[]) => unknown) {
        if (type === TransformComponent) return transform;
        if (type === CharacterControllerComponent) return controller;
        if (type === PhysicsBodyComponent) return body;
        throw new Error('Unexpected component lookup');
      },
      tryGet(type: new (...args: any[]) => unknown) {
        if (type === PhysicsBodyComponent) return body;
        return undefined;
      },
    };

    const physicsSystem = {
      rapier: {
        isReady: true,
        isCharacterGrounded: () => true,
        moveCharacter: (_entityId: number, desiredMovement: THREE.Vector3) => desiredMovement.clone(),
        moveCharacterInto: (_entityId: number, desiredMovement: THREE.Vector3, out: THREE.Vector3) => { out.copy(desiredMovement); return true; },
        setBodyTransform: () => {},
      },
    };

    const system = new CharacterControllerSystem({
      camera: { getWorldDirection: (vector: THREE.Vector3) => vector.set(0, 0, -1) },
      input: {
        isKeyDown: (key: string) => key.toLowerCase() === 'space',
        isKeyJustPressed: () => false,
      },
    } as any);

    system.world = {
      query: (...types: unknown[]) => {
        if (types.includes(CameraFollowComponent as any)) return [];
        return [entity];
      },
      getSystem: () => physicsSystem,
    } as any;

    system.update(1 / 60, 0);

    expect(controller.isJumping).toBe(true);
    expect(controller.canJump).toBe(false);
    expect(body.velocity.y).toBeGreaterThan(0);
  });

  it('jumps on the very first frame before Rapier has reported grounded (coyote default)', () => {
    const transform = new TransformComponent();
    const body = new PhysicsBodyComponent();
    body.grounded = false; // Rapier hasn't settled yet
    const controller = new CharacterControllerComponent();

    const entity = {
      id: 2,
      get(type: new (...args: any[]) => unknown) {
        if (type === TransformComponent) return transform;
        if (type === CharacterControllerComponent) return controller;
        if (type === PhysicsBodyComponent) return body;
        throw new Error('Unexpected component lookup');
      },
      tryGet(type: new (...args: any[]) => unknown) {
        if (type === PhysicsBodyComponent) return body;
        return undefined;
      },
    };

    const physicsSystem = {
      rapier: {
        isReady: true,
        isCharacterGrounded: () => false, // still not grounded on first frame
        moveCharacter: (_entityId: number, desiredMovement: THREE.Vector3) => desiredMovement.clone(),
        moveCharacterInto: (_entityId: number, desiredMovement: THREE.Vector3, out: THREE.Vector3) => { out.copy(desiredMovement); return true; },
        setBodyTransform: () => {},
      },
    };

    const system = new CharacterControllerSystem({
      camera: { getWorldDirection: (vector: THREE.Vector3) => vector.set(0, 0, -1) },
      input: {
        isKeyDown: (key: string) => key.toLowerCase() === 'space',
        isKeyJustPressed: (key: string) => key.toLowerCase() === 'space' || key === ' ',
      },
    } as any);

    system.world = {
      query: (...types: unknown[]) => {
        if (types.includes(CameraFollowComponent as any)) return [];
        return [entity];
      },
      getSystem: () => physicsSystem,
    } as any;

    system.update(1 / 60, 0);

    // Even though Rapier says not grounded, the COYOTE_TIME default lets the jump fire
    expect(controller.isJumping).toBe(true);
    expect(body.velocity.y).toBeGreaterThan(0);
  });
});