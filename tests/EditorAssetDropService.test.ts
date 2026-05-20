import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EditorAssetDropService } from '../client/src/editor/EditorAssetDropService';

describe('EditorAssetDropService', () => {
  it('loads, places, and registers dropped model assets', async () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const group = new THREE.Group();
    group.add(mesh);
    const clip = new THREE.AnimationClip('Idle', 1, []);

    const onSelect = vi.fn();
    const onRefreshHierarchy = vi.fn();
    const onRegisterMixer = vi.fn();
    const service = new EditorAssetDropService({
      loadModel: vi.fn(async () => ({ scene: group, animations: [clip] })),
      scene,
      onSelect,
      onRefreshHierarchy,
      onRegisterMixer,
      resolveDropPoint: () => new THREE.Vector3(3, 4, 5),
    });

    await service.handleAssetDrop({ type: 'model', path: '/models/crate.glb', name: 'crate.glb' }, { clientX: 10, clientY: 20 } as DragEvent);

    expect(group.name).toBe('crate');
    expect(group.position.toArray()).toEqual([3, 4, 5]);
    expect(scene.children).toContain(group);
    expect(onSelect).toHaveBeenCalledWith(group);
    expect(onRefreshHierarchy).toHaveBeenCalledOnce();
    expect(onRegisterMixer).toHaveBeenCalledOnce();
    expect((group as any).animations).toEqual([clip]);
    expect((group as any)._editorMixer).toBeTruthy();
  });
});