// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EditorProjectFileService } from '../client/src/editor/EditorProjectFileService';

describe('EditorProjectFileService', () => {
  it('creates project data with scene, graph, and camera state', () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ffaa33' }));
    mesh.name = 'Crate';
    scene.add(mesh);

    const camera = new THREE.PerspectiveCamera();
    camera.position.set(4, 5, 6);
    const target = new THREE.Vector3(1, 2, 3);
    const service = new EditorProjectFileService();

    const project = service.createProjectData(scene, { nodes: [{ id: 'n1' }] }, camera, target);

    expect(project.scene.objects).toHaveLength(1);
    expect(project.blueprints.nodes).toEqual([{ id: 'n1' }]);
    expect(project.camera.position).toEqual([4, 5, 6]);
    expect(project.camera.target).toEqual([1, 2, 3]);
  });

  it('applies project data back into scene and graph', () => {
    const targetScene = new THREE.Scene();
    targetScene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    const sourceScene = new THREE.Scene();
    const loadedMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: '#00ff00' }));
    loadedMesh.name = 'LoadedMesh';
    sourceScene.add(loadedMesh);

    const service = new EditorProjectFileService();
    const project = service.createProjectData(sourceScene, { nodes: [{ id: 'graph' }], variables: [{ id: 'v1' }] }, new THREE.PerspectiveCamera(), new THREE.Vector3(7, 8, 9));
    const graph = { nodes: [], connections: [], variables: [], comments: [] };
    const camera = new THREE.PerspectiveCamera();
    const orbitTarget = new THREE.Vector3();

    service.applyProjectData(project, {
      scene: targetScene,
      getSceneObjects: () => [...targetScene.children],
      graph,
      camera,
      orbitTarget,
      createTexture: () => new THREE.Texture(),
    });

    expect(targetScene.getObjectByName('LoadedMesh')).toBeTruthy();
    expect(targetScene.children).toHaveLength(1);
    expect(graph.nodes).toEqual([{ id: 'graph' }]);
    expect(graph.variables).toEqual([{ id: 'v1' }]);
    expect(orbitTarget.toArray()).toEqual([7, 8, 9]);
  });
});