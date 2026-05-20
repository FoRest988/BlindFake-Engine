import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  SceneSerializer,
  AssetManifest,
  BuildSystem,
  type BuildConfig,
} from '../client/src/engine/BuildExportSystem';

describe('AssetManifest', () => {
  it('adds and retrieves assets', () => {
    const m = new AssetManifest();
    m.add({ id: 'tex1', type: 'texture', path: '/img/a.png' });
    m.add({ id: 'mod1', type: 'model', path: '/models/b.glb' });
    expect(m.getAll()).toHaveLength(2);
  });

  it('removes assets', () => {
    const m = new AssetManifest();
    m.add({ id: 'a', type: 'texture', path: '/x.png' });
    m.remove('a');
    expect(m.getAll()).toHaveLength(0);
  });

  it('filters by type', () => {
    const m = new AssetManifest();
    m.add({ id: 'tex1', type: 'texture', path: '/a.png' });
    m.add({ id: 'mod1', type: 'model', path: '/b.glb' });
    m.add({ id: 'tex2', type: 'texture', path: '/c.png' });
    expect(m.getByType('texture')).toHaveLength(2);
    expect(m.getByType('model')).toHaveLength(1);
    expect(m.getByType('audio')).toHaveLength(0);
  });

  it('serializes to JSON and back', () => {
    const m1 = new AssetManifest();
    m1.add({ id: 'a', type: 'audio', path: '/sfx.mp3' });
    const json = m1.toJSON();
    const m2 = new AssetManifest();
    m2.fromJSON(json);
    expect(m2.getAll()).toHaveLength(1);
    expect(m2.getAll()[0].id).toBe('a');
  });
});

describe('BuildSystem (config)', () => {
  it('uses defaults when no config given', () => {
    const bs = new BuildSystem();
    const cfg = bs.getConfig();
    expect(cfg.projectName).toBe('MyGame');
    expect(cfg.targetPlatform).toBe('web');
    expect(cfg.antialias).toBe(true);
    expect(cfg.shadows).toBe(true);
  });

  it('accepts partial config overrides', () => {
    const bs = new BuildSystem({ projectName: 'CoolGame', shadows: false });
    const cfg = bs.getConfig();
    expect(cfg.projectName).toBe('CoolGame');
    expect(cfg.shadows).toBe(false);
    expect(cfg.antialias).toBe(true); // default preserved
  });

  it('setConfig updates values', () => {
    const bs = new BuildSystem();
    bs.setConfig({ targetPlatform: 'electron' });
    expect(bs.getConfig().targetPlatform).toBe('electron');
  });

  it('manifest is accessible', () => {
    const bs = new BuildSystem();
    const manifest = bs.getManifest();
    expect(manifest).toBeDefined();
    expect(manifest.getAll()).toHaveLength(0);
  });
});

describe('Build SceneSerializer', () => {
  it('serializes and restores basic scene objects', () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#123456', 0.02);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 3),
      new THREE.MeshStandardMaterial({ color: '#ffaa33', roughness: 0.2, metalness: 0.7 }),
    );
    mesh.name = 'Crate';
    mesh.position.set(2, 4, 6);
    mesh.userData.tag = 'keep';
    mesh.userData.__internal = 'skip';

    const child = new THREE.Group();
    child.name = 'Child';
    mesh.add(child);
    scene.add(mesh);

    const light = new THREE.PointLight('#ffffff', 2, 10, 2);
    light.name = 'Lamp';
    scene.add(light);

    const data = SceneSerializer.serializeScene(scene, 'Level1');
    const restored = new THREE.Scene();
    SceneSerializer.deserializeScene(data, restored);

    expect(data.name).toBe('Level1');
    expect(data.objects).toHaveLength(2);

    const restoredMesh = restored.getObjectByName('Crate') as THREE.Mesh;
    expect(restoredMesh.position.toArray()).toEqual([2, 4, 6]);
    expect(restoredMesh.userData.tag).toBe('keep');
    expect(restoredMesh.userData.__internal).toBeUndefined();
    expect(restoredMesh.getObjectByName('Child')).toBeTruthy();
    expect(restored.fog).toBeInstanceOf(THREE.FogExp2);
    expect(restored.getObjectByName('Lamp')).toBeInstanceOf(THREE.PointLight);
  });

  it('skips editor-only objects during scene serialization', () => {
    const scene = new THREE.Scene();
    const editorOnly = new THREE.Group();
    editorOnly.name = 'EditorOnly';
    editorOnly.userData.__editorOnly = true;
    scene.add(editorOnly);

    const runtimeObject = new THREE.Group();
    runtimeObject.name = 'RuntimeObject';
    scene.add(runtimeObject);

    const data = SceneSerializer.serializeScene(scene, 'Filtered');

    expect(data.objects).toHaveLength(1);
    expect(data.objects[0].name).toBe('RuntimeObject');
  });
});
