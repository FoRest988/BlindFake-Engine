import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { World } from '../client/src/ecs/World';
import { Component } from '../client/src/ecs/Component';
import { MeshComponent, TransformComponent } from '../client/src/ecs/components/GameComponents';

describe('World entity removal disposes components', () => {
  it('removeEntity removes the MeshComponent object from the scene', () => {
    const world = new World();
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);

    const entity = world.createEntity('crate');
    entity.add(new TransformComponent()).add(new MeshComponent(mesh));
    expect(scene.children).toContain(mesh);

    world.removeEntity(entity.id);
    world.update(0.016, 0);

    expect(scene.children).not.toContain(mesh);
    expect(world.entityCount).toBe(0);
  });

  it('calls dispose() on every component when the entity is removed or the world is cleared', () => {
    const disposed: string[] = [];
    class Resource extends Component {
      constructor(private readonly label: string) { super(); }
      dispose(): void { disposed.push(this.label); }
    }
    const world = new World();
    const a = world.createEntity();
    a.add(new Resource('a'));
    const b = world.createEntity();
    b.add(new Resource('b'));

    world.removeEntity(a.id);
    world.update(0.016, 0);
    expect(disposed).toEqual(['a']);

    world.clear();
    expect(disposed).toEqual(['a', 'b']);
  });

  it('entity.remove(type) disposes the removed component', () => {
    const disposed: string[] = [];
    class Resource extends Component {
      dispose(): void { disposed.push('r'); }
    }
    const world = new World();
    const e = world.createEntity();
    e.add(new Resource());
    e.remove(Resource);
    expect(disposed).toEqual(['r']);
  });
});
