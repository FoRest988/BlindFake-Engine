import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SceneSerializer } from '../client/src/engine/SceneSerialization';

describe('SceneSerialization', () => {
  it('round-trips transforms, userData and fog/background', () => {
    const scene = new THREE.Scene();
    scene.name = 'Main';
    scene.background = new THREE.Color('#112233');
    scene.fog = new THREE.Fog('#445566', 5, 50);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 3, 4),
      new THREE.MeshStandardMaterial({ color: '#ff8844' }),
    );
    mesh.name = 'Crate';
    mesh.position.set(4, 5, 6);
    mesh.rotation.set(0.1, 0.2, 0.3);
    mesh.scale.set(2, 2, 2);
    mesh.userData.pickup = true;
    scene.add(mesh);

    const data = SceneSerializer.serialize(scene);
    const restored = SceneSerializer.deserialize(data);
    const restoredMesh = restored.getObjectByName('Crate') as THREE.Mesh;

    expect(restored.name).toBe('Main');
    expect((restored.background as THREE.Color).getHexString()).toBe('112233');
    expect(restored.fog).toBeInstanceOf(THREE.Fog);
    expect(restoredMesh.position.toArray()).toEqual([4, 5, 6]);
    expect(restoredMesh.scale.toArray()).toEqual([2, 2, 2]);
    expect(restoredMesh.userData.pickup).toBe(true);
  });

  it('reuses provided texture cache during deserialize', () => {
    const scene = new THREE.Scene();
    const originalTexture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: originalTexture });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    scene.add(mesh);

    const data = SceneSerializer.serialize(scene);
    const textureCache = new Map<string, THREE.Texture>();
    const replacementTexture = new THREE.Texture();
    const serializedMaterial = data.objects[0].material as { mapUuid?: string };
    textureCache.set(serializedMaterial.mapUuid!, replacementTexture);

    const restored = SceneSerializer.deserialize(data, undefined, textureCache);
    const restoredMesh = restored.children[0] as THREE.Mesh;
    const restoredMaterial = restoredMesh.material as THREE.MeshStandardMaterial;

    expect(restoredMaterial.map).toBe(replacementTexture);
  });
});