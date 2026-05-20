import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export class SceneManager {
  private scenes = new Map<string, THREE.Scene>();
  private activeKey: string | null = null;

  get active(): THREE.Scene | null {
    return this.activeKey ? this.scenes.get(this.activeKey) ?? null : null;
  }

  get activeSceneName(): string | null {
    return this.activeKey;
  }

  create(name: string): THREE.Scene {
    const scene = new THREE.Scene();
    scene.name = name;
    this.scenes.set(name, scene);
    return scene;
  }

  get(name: string): THREE.Scene | undefined {
    return this.scenes.get(name);
  }

  setActive(name: string): void {
    if (!this.scenes.has(name)) {
      throw new Error(`Scene "${name}" does not exist`);
    }
    this.activeKey = name;
  }

  remove(name: string): void {
    if (this.activeKey === name) {
      this.activeKey = null;
    }
    this.scenes.delete(name);
  }

  /**
   * Merge static (non-moving) meshes that share the same material into a
   * single draw call per material group. Call once after the scene is fully
   * loaded — do NOT call every frame.
   *
   * Exclusions (mesh is left untouched if any condition is true):
   *   - `mesh.userData._noStatic = true`  (manually excluded)
   *   - `mesh.userData._batched  = true`  (already batched)
   *   - `mesh instanceof THREE.SkinnedMesh` (animated)
   *   - `Array.isArray(mesh.material) && mesh.material.length > 1` (multi-material)
   *
   * @param scene Target scene (defaults to the active scene).
   * @returns Number of draw calls eliminated.
   */
  batchStaticObjects(scene?: THREE.Scene): number {
    const target = scene ?? this.active;
    if (!target) return 0;

    type Group = { meshes: THREE.Mesh[]; material: THREE.Material };
    const groups = new Map<string, Group>();

    target.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (obj instanceof THREE.SkinnedMesh) return;
      if (obj.userData['_noStatic'] || obj.userData['_batched']) return;
      if (Array.isArray(obj.material) && obj.material.length > 1) return;

      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (!mat) return;

      const key = mat.uuid;
      if (!groups.has(key)) groups.set(key, { meshes: [], material: mat });
      groups.get(key)!.meshes.push(obj);
    });

    let savedCalls = 0;

    for (const { meshes, material } of groups.values()) {
      if (meshes.length < 2) continue;

      // Clone each geometry transformed to world space before merging
      const worldGeos: THREE.BufferGeometry[] = [];
      for (const mesh of meshes) {
        mesh.updateWorldMatrix(true, false);
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);
        worldGeos.push(geo);
      }

      const merged = mergeGeometries(worldGeos, false);

      // Dispose temporary world-space clones
      for (const geo of worldGeos) geo.dispose();

      if (!merged) continue;

      // Remove originals from scene
      for (const mesh of meshes) mesh.removeFromParent();

      // Replace with single merged mesh
      const batch = new THREE.Mesh(merged, material);
      batch.name = `_batch_${material.name || material.uuid.slice(0, 8)}`;
      batch.userData['_batched'] = true;
      batch.receiveShadow = true;
      target.add(batch);

      savedCalls += meshes.length - 1;
    }

    return savedCalls;
  }

  /** Add default lighting to a scene */
  addDefaultLighting(scene: THREE.Scene): void {
    const ambient = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 1.5);
    directional.position.set(50, 80, 50);
    directional.castShadow = true;
    directional.shadow.mapSize.set(2048, 2048);
    directional.shadow.camera.near = 0.5;
    directional.shadow.camera.far = 200;
    directional.shadow.camera.left = -50;
    directional.shadow.camera.right = 50;
    directional.shadow.camera.top = 50;
    directional.shadow.camera.bottom = -50;
    scene.add(directional);

    const hemisphere = new THREE.HemisphereLight(0x87ceeb, 0x362907, 0.3);
    scene.add(hemisphere);
  }
}
