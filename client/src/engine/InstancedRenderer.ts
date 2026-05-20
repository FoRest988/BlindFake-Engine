/**
 * InstancedRenderer — Efficiently render thousands of identical objects
 * (grass, trees, rocks, crowds, particles) using GPU instancing.
 * 
 * Usage:
 *   const grass = engine.instancing.createGroup('grass', grassGeometry, grassMaterial, 10000);
 *   grass.addInstance(position, rotation, scale, color);
 *   // In game loop:
 *   engine.instancing.update();
 */

import * as THREE from 'three';

// ── Instance Group ────────────────────────────────────────────────

export interface InstanceData {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  color?: THREE.Color;
  userData?: Record<string, unknown>;
}

export class InstanceGroup {
  public name: string;
  public mesh: THREE.InstancedMesh;
  public maxCount: number;
  public count = 0;
  public frustumCulled = true;
  public castShadow = true;
  public receiveShadow = true;

  private dummy = new THREE.Object3D();
  private colors: THREE.Color[] = [];
  private instanceData: InstanceData[] = [];
  private dirty = false;

  constructor(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    maxCount: number
  ) {
    this.name = name;
    this.maxCount = maxCount;
    this.mesh = new THREE.InstancedMesh(geometry, material, maxCount);
    this.mesh.name = `Instances_${name}`;
    this.mesh.count = 0; // Start with 0 visible
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Enable per-instance colors if material supports it
    if ('vertexColors' in material) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(maxCount * 3), 3
      );
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
  }

  /** Add a new instance. Returns the instance index, or -1 if full. */
  addInstance(
    position: THREE.Vector3,
    rotation?: THREE.Euler,
    scale?: THREE.Vector3,
    color?: THREE.Color
  ): number {
    if (this.count >= this.maxCount) return -1;

    const idx = this.count;
    this.count++;
    this.mesh.count = this.count;

    // Set transform
    this.dummy.position.copy(position);
    if (rotation) this.dummy.rotation.copy(rotation);
    else this.dummy.rotation.set(0, 0, 0);
    if (scale) this.dummy.scale.copy(scale);
    else this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(idx, this.dummy.matrix);

    // Set color
    if (color && this.mesh.instanceColor) {
      this.mesh.setColorAt(idx, color);
      this.colors[idx] = color.clone();
    }

    // Store data
    this.instanceData[idx] = {
      position: position.clone(),
      rotation: rotation?.clone() ?? new THREE.Euler(),
      scale: scale?.clone() ?? new THREE.Vector3(1, 1, 1),
      color: color?.clone(),
    };

    this.dirty = true;
    return idx;
  }

  /** Update an existing instance's transform */
  setTransform(
    index: number,
    position?: THREE.Vector3,
    rotation?: THREE.Euler,
    scale?: THREE.Vector3
  ): void {
    if (index < 0 || index >= this.count) return;

    const data = this.instanceData[index];
    if (position) data.position.copy(position);
    if (rotation) data.rotation.copy(rotation);
    if (scale) data.scale.copy(scale);

    this.dummy.position.copy(data.position);
    this.dummy.rotation.copy(data.rotation);
    this.dummy.scale.copy(data.scale);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
    this.dirty = true;
  }

  /** Update an instance's color */
  setColor(index: number, color: THREE.Color): void {
    if (index < 0 || index >= this.count || !this.mesh.instanceColor) return;
    this.mesh.setColorAt(index, color);
    this.colors[index] = color.clone();
    this.mesh.instanceColor.needsUpdate = true;
  }

  /** Remove an instance by swapping with the last (fast O(1) removal) */
  removeInstance(index: number): void {
    if (index < 0 || index >= this.count) return;

    const lastIdx = this.count - 1;
    if (index !== lastIdx) {
      // Swap with last
      const lastMatrix = new THREE.Matrix4();
      this.mesh.getMatrixAt(lastIdx, lastMatrix);
      this.mesh.setMatrixAt(index, lastMatrix);

      if (this.mesh.instanceColor && this.colors[lastIdx]) {
        this.mesh.setColorAt(index, this.colors[lastIdx]);
        this.colors[index] = this.colors[lastIdx];
      }

      this.instanceData[index] = this.instanceData[lastIdx];
    }

    this.count--;
    this.mesh.count = this.count;
    this.dirty = true;
  }

  /**
   * Place instances randomly within a bounding area.
   * Great for grass, rocks, trees, etc.
   */
  scatter(
    count: number,
    bounds: THREE.Box3,
    options: {
      randomRotationY?: boolean;
      scaleRange?: [number, number];
      colorRange?: [THREE.Color, THREE.Color];
      /** Callback to validate/modify each position before placing */
      filter?: (pos: THREE.Vector3) => THREE.Vector3 | null;
    } = {}
  ): number {
    const { randomRotationY = true, scaleRange, colorRange, filter } = options;
    let placed = 0;

    for (let i = 0; i < count; i++) {
      if (this.count >= this.maxCount) break;

      const pos = new THREE.Vector3(
        THREE.MathUtils.randFloat(bounds.min.x, bounds.max.x),
        THREE.MathUtils.randFloat(bounds.min.y, bounds.max.y),
        THREE.MathUtils.randFloat(bounds.min.z, bounds.max.z)
      );

      const finalPos = filter ? filter(pos) : pos;
      if (!finalPos) continue;

      const rot = randomRotationY
        ? new THREE.Euler(0, Math.random() * Math.PI * 2, 0)
        : undefined;

      let scale: THREE.Vector3 | undefined;
      if (scaleRange) {
        const s = THREE.MathUtils.randFloat(scaleRange[0], scaleRange[1]);
        scale = new THREE.Vector3(s, s, s);
      }

      let color: THREE.Color | undefined;
      if (colorRange) {
        const t = Math.random();
        color = colorRange[0].clone().lerp(colorRange[1], t);
      }

      this.addInstance(finalPos, rot, scale, color);
      placed++;
    }

    return placed;
  }

  /** Apply pending changes to GPU buffers */
  commit(): void {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.castShadow = this.castShadow;
    this.mesh.receiveShadow = this.receiveShadow;
    this.mesh.frustumCulled = this.frustumCulled;
    this.dirty = false;
  }

  /** Clear all instances */
  clear(): void {
    this.count = 0;
    this.mesh.count = 0;
    this.instanceData.length = 0;
    this.colors.length = 0;
    this.dirty = true;
  }

  /** Get instance data at index */
  getData(index: number): InstanceData | undefined {
    return this.instanceData[index];
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    if (Array.isArray(this.mesh.material)) {
      this.mesh.material.forEach(m => m.dispose());
    } else {
      this.mesh.material.dispose();
    }
    this.mesh.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

// ── Instanced Renderer Manager ────────────────────────────────────

export class InstancedRenderer {
  private groups = new Map<string, InstanceGroup>();
  private scene: THREE.Scene | null = null;

  setScene(scene: THREE.Scene): void {
    this.scene = scene;
  }

  /** Create a new instance group */
  createGroup(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    maxCount = 1000
  ): InstanceGroup {
    if (this.groups.has(name)) {
      this.groups.get(name)!.dispose();
    }

    const group = new InstanceGroup(name, geometry, material, maxCount);
    this.groups.set(name, group);

    if (this.scene) {
      this.scene.add(group.mesh);
    }

    return group;
  }

  /** Get a group by name */
  getGroup(name: string): InstanceGroup | undefined {
    return this.groups.get(name);
  }

  /** Remove a group */
  removeGroup(name: string): void {
    const group = this.groups.get(name);
    if (group) {
      group.dispose();
      this.groups.delete(name);
    }
  }

  /** Commit all dirty groups (call once per frame) */
  update(): void {
    for (const group of this.groups.values()) {
      group.commit();
    }
  }

  /** Get total instance counts across all groups */
  getStats(): { groups: number; totalInstances: number; byGroup: Record<string, number> } {
    const byGroup: Record<string, number> = {};
    let total = 0;
    for (const [name, group] of this.groups) {
      byGroup[name] = group.count;
      total += group.count;
    }
    return { groups: this.groups.size, totalInstances: total, byGroup };
  }

  /** Dispose all groups */
  dispose(): void {
    for (const group of this.groups.values()) {
      group.dispose();
    }
    this.groups.clear();
    this.scene = null;
  }
}
