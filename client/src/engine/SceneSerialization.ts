import * as THREE from 'three';

// ─── Scene Serialization ───────────────────────────────────────────
// Export / Import entire scenes as JSON. Supports meshes, lights,
// cameras, groups, materials, transforms, user data.

export interface SerializedObject {
  type: string;
  name: string;
  uuid: string;
  visible: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  userData: Record<string, any>;
  children: SerializedObject[];

  // Mesh specific
  geometry?: SerializedGeometry;
  material?: SerializedMaterial | SerializedMaterial[];

  // Light specific
  light?: SerializedLight;

  // Camera specific
  camera?: SerializedCamera;
}

export interface SerializedGeometry {
  type: string;
  parameters: Record<string, any>;
  // For non-standard geometries (GLTF, custom), store raw buffer attributes
  attributes?: Record<string, { array: number[]; itemSize: number; normalized?: boolean }>;
  index?: number[];
}

export interface SerializedMaterial {
  type: string;
  color?: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  opacity?: number;
  transparent?: boolean;
  wireframe?: boolean;
  side?: number;
  map?: string | null;       // base64 or URL
  normalMap?: string | null;
  // Texture UUID references for project save/load
  mapUuid?: string;
  normalMapUuid?: string;
  roughnessMapUuid?: string;
  metalnessMapUuid?: string;
  emissiveMapUuid?: string;
  aoMapUuid?: string;
  // Persistent texture sources (survive UUID regeneration)
  mapSrc?: string;
  normalMapSrc?: string;
  roughnessMapSrc?: string;
  metalnessMapSrc?: string;
  emissiveMapSrc?: string;
  aoMapSrc?: string;
}

export interface SerializedLight {
  type: string;
  color: string;
  intensity: number;
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  castShadow: boolean;
}

export interface SerializedCamera {
  type: string;
  fov: number;
  near: number;
  far: number;
  aspect: number;
}

export interface SerializedScene {
  version: string;
  name: string;
  background: string | null;
  fog: { color: string; near: number; far: number } | null;
  objects: SerializedObject[];
  metadata: {
    generator: string;
    timestamp: number;
    objectCount: number;
  };
}

export class SceneSerializer {
  static readonly VERSION = '1.0.0';

  // ── Export ─────────────────────────────────────────────────────

  /** Serialize a THREE.Scene to a JSON-compatible object */
  static serialize(scene: THREE.Scene, skipHelpers = true): SerializedScene {
    const objects: SerializedObject[] = [];
    let objectCount = 0;

    for (const child of scene.children) {
      // Skip editor helpers
      if (skipHelpers && (
        child instanceof THREE.GridHelper ||
        child instanceof THREE.AxesHelper ||
        child instanceof THREE.BoxHelper ||
        child instanceof THREE.SkeletonHelper ||
        child instanceof THREE.CameraHelper ||
        child.name.endsWith('_helper')
      )) continue;

      const serialized = this.serializeObject(child);
      if (serialized) {
        objects.push(serialized);
        objectCount++;
      }
    }

    return {
      version: this.VERSION,
      name: scene.name || 'Untitled',
      background: scene.background instanceof THREE.Color ? '#' + scene.background.getHexString() : null,
      fog: scene.fog instanceof THREE.Fog
        ? { color: '#' + scene.fog.color.getHexString(), near: scene.fog.near, far: scene.fog.far }
        : null,
      objects,
      metadata: {
        generator: 'BlindFake: Phantom',
        timestamp: Date.now(),
        objectCount,
      },
    };
  }

  private static serializeObject(obj: THREE.Object3D): SerializedObject | null {
    const result: SerializedObject = {
      type: obj.type,
      name: obj.name,
      uuid: obj.uuid,
      visible: obj.visible,
      position: [obj.position.x, obj.position.y, obj.position.z],
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      userData: { ...obj.userData },
      children: [],
    };

    // Mesh
    if (obj instanceof THREE.Mesh) {
      result.geometry = this.serializeGeometry(obj.geometry);
      if (Array.isArray(obj.material)) {
        result.material = obj.material.map((m) => this.serializeMaterial(m));
      } else {
        result.material = this.serializeMaterial(obj.material);
      }
    }

    // Light
    if (obj instanceof THREE.Light) {
      result.light = this.serializeLight(obj);
    }

    // Camera
    if (obj instanceof THREE.PerspectiveCamera) {
      result.camera = {
        type: 'PerspectiveCamera',
        fov: obj.fov,
        near: obj.near,
        far: obj.far,
        aspect: obj.aspect,
      };
    }

    // Children (recursive)
    for (const child of obj.children) {
      if (child instanceof THREE.BoxHelper || child instanceof THREE.CameraHelper) continue;
      const serializedChild = this.serializeObject(child);
      if (serializedChild) result.children.push(serializedChild);
    }

    return result;
  }

  private static serializeGeometry(geo: THREE.BufferGeometry): SerializedGeometry {
    const params = (geo as any).parameters ?? {};
    const result: SerializedGeometry = {
      type: geo.type,
      parameters: { ...params },
    };

    // For non-standard geometries (GLTF, custom), save raw buffer attributes
    const isStandardType = [
      'BoxGeometry', 'SphereGeometry', 'PlaneGeometry', 'CylinderGeometry',
      'CapsuleGeometry', 'ConeGeometry', 'TorusGeometry',
    ].includes(geo.type);
    if (!isStandardType || !params || Object.keys(params).length === 0) {
      result.attributes = {};
      for (const name of Object.keys(geo.attributes)) {
        const attr = geo.attributes[name] as THREE.BufferAttribute;
        if (attr && attr.array) {
          result.attributes[name] = {
            array: Array.from(attr.array),
            itemSize: attr.itemSize,
            normalized: attr.normalized || false,
          };
        }
      }
      if (geo.index) {
        result.index = Array.from(geo.index.array);
      }
    }

    return result;
  }

  private static serializeMaterial(mat: THREE.Material): SerializedMaterial {
    const result: SerializedMaterial = { type: mat.type };

    if (mat instanceof THREE.MeshStandardMaterial) {
      result.color = '#' + mat.color.getHexString();
      result.roughness = mat.roughness;
      result.metalness = mat.metalness;
      result.emissive = '#' + mat.emissive.getHexString();
      result.opacity = mat.opacity;
      result.transparent = mat.transparent;
      result.wireframe = mat.wireframe;
      result.side = mat.side;
      // Save texture UUIDs + source URLs for project save/load
      if (mat.map) { result.mapUuid = mat.map.uuid; result.mapSrc = mat.map.image?.src ?? undefined; }
      if (mat.normalMap) { result.normalMapUuid = mat.normalMap.uuid; result.normalMapSrc = mat.normalMap.image?.src ?? undefined; }
      if (mat.roughnessMap) { result.roughnessMapUuid = mat.roughnessMap.uuid; result.roughnessMapSrc = mat.roughnessMap.image?.src ?? undefined; }
      if (mat.metalnessMap) { result.metalnessMapUuid = mat.metalnessMap.uuid; result.metalnessMapSrc = mat.metalnessMap.image?.src ?? undefined; }
      if (mat.emissiveMap) { result.emissiveMapUuid = mat.emissiveMap.uuid; result.emissiveMapSrc = mat.emissiveMap.image?.src ?? undefined; }
      if (mat.aoMap) { result.aoMapUuid = mat.aoMap.uuid; result.aoMapSrc = mat.aoMap.image?.src ?? undefined; }
    } else if (mat instanceof THREE.MeshBasicMaterial) {
      result.color = '#' + mat.color.getHexString();
      result.opacity = mat.opacity;
      result.transparent = mat.transparent;
      result.wireframe = mat.wireframe;
      result.side = mat.side;
    }

    return result;
  }

  private static serializeLight(light: THREE.Light): SerializedLight {
    const result: SerializedLight = {
      type: light.type,
      color: '#' + light.color.getHexString(),
      intensity: light.intensity,
      castShadow: light.castShadow,
    };

    if (light instanceof THREE.PointLight) {
      result.distance = light.distance;
      result.decay = light.decay;
    } else if (light instanceof THREE.SpotLight) {
      result.distance = light.distance;
      result.decay = light.decay;
      result.angle = light.angle;
      result.penumbra = light.penumbra;
    }

    return result;
  }

  // ── Import ─────────────────────────────────────────────────────

  /** Deserialize a JSON scene back into THREE.Scene */
  static deserialize(data: SerializedScene, targetScene?: THREE.Scene, textures?: Map<string, THREE.Texture>): THREE.Scene {
    const scene = targetScene ?? new THREE.Scene();
    scene.name = data.name;

    if (data.background) {
      scene.background = new THREE.Color(data.background);
    }
    if (data.fog) {
      scene.fog = new THREE.Fog(data.fog.color, data.fog.near, data.fog.far);
    }

    for (const objData of data.objects) {
      const obj = this.deserializeObject(objData, textures);
      if (obj) scene.add(obj);
    }

    return scene;
  }

  private static deserializeObject(data: SerializedObject, textures?: Map<string, THREE.Texture>): THREE.Object3D | null {
    let obj: THREE.Object3D;

    if (data.light) {
      obj = this.deserializeLight(data.light);
    } else if (data.camera) {
      obj = this.deserializeCamera(data.camera);
    } else if (data.geometry && data.material) {
      obj = this.deserializeMesh(data, textures);
    } else {
      obj = new THREE.Group();
    }

    obj.name = data.name;
    obj.visible = data.visible;
    obj.position.set(...data.position);
    obj.rotation.set(...data.rotation);
    obj.scale.set(...data.scale);
    Object.assign(obj.userData, data.userData);

    // Children
    for (const childData of data.children) {
      const child = this.deserializeObject(childData, textures);
      if (child) obj.add(child);
    }

    return obj;
  }

  private static deserializeMesh(data: SerializedObject, textures?: Map<string, THREE.Texture>): THREE.Mesh {
    const geo = this.deserializeGeometry(data.geometry!);
    const mat = Array.isArray(data.material)
      ? data.material.map((m) => this.deserializeMaterial(m, textures))
      : this.deserializeMaterial(data.material!, textures);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private static deserializeGeometry(data: SerializedGeometry): THREE.BufferGeometry {
    // If we have saved buffer attributes (GLTF/custom geometry), rebuild from those
    if (data.attributes && Object.keys(data.attributes).length > 0) {
      const geo = new THREE.BufferGeometry();
      for (const [name, attrData] of Object.entries(data.attributes)) {
        const arr = new Float32Array(attrData.array);
        geo.setAttribute(name, new THREE.BufferAttribute(arr, attrData.itemSize, attrData.normalized));
      }
      if (data.index) {
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(data.index), 1));
      }
      geo.computeBoundingSphere();
      return geo;
    }

    const p = data.parameters;
    switch (data.type) {
      case 'BoxGeometry': return new THREE.BoxGeometry(p.width, p.height, p.depth);
      case 'SphereGeometry': return new THREE.SphereGeometry(p.radius, p.widthSegments, p.heightSegments);
      case 'PlaneGeometry': return new THREE.PlaneGeometry(p.width, p.height);
      case 'CylinderGeometry': return new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments);
      case 'CapsuleGeometry': return new THREE.CapsuleGeometry(p.radius, p.length, p.capSegments, p.radialSegments);
      case 'ConeGeometry': return new THREE.ConeGeometry(p.radius, p.height, p.radialSegments);
      case 'TorusGeometry': return new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments);
      default: return new THREE.BoxGeometry(1, 1, 1);
    }
  }

  private static deserializeMaterial(data: SerializedMaterial, textures?: Map<string, THREE.Texture>): THREE.Material {
    if (data.type === 'MeshBasicMaterial') {
      return new THREE.MeshBasicMaterial({
        color: data.color,
        opacity: data.opacity ?? 1,
        transparent: data.transparent ?? false,
        wireframe: data.wireframe ?? false,
        side: (data.side ?? THREE.FrontSide) as THREE.Side,
      });
    }

    const mat = new THREE.MeshStandardMaterial({
      color: data.color ?? '#888888',
      roughness: data.roughness ?? 0.6,
      metalness: data.metalness ?? 0,
      emissive: data.emissive ?? '#000000',
      opacity: data.opacity ?? 1,
      transparent: data.transparent ?? false,
      wireframe: data.wireframe ?? false,
      side: (data.side ?? 0) as THREE.Side,
    });

    // Restore textures from cache or reload from source
    const loader = new THREE.TextureLoader();
    const restoreTex = (uuid?: string, src?: string): THREE.Texture | null => {
      if (uuid && textures?.has(uuid)) return textures.get(uuid)!;
      if (src) { try { return loader.load(src); } catch { /* texture unavailable */ } }
      return null;
    };
    const m = restoreTex(data.mapUuid, data.mapSrc); if (m) mat.map = m;
    const n = restoreTex(data.normalMapUuid, data.normalMapSrc); if (n) mat.normalMap = n;
    const r = restoreTex(data.roughnessMapUuid, data.roughnessMapSrc); if (r) mat.roughnessMap = r;
    const me = restoreTex(data.metalnessMapUuid, data.metalnessMapSrc); if (me) mat.metalnessMap = me;
    const em = restoreTex(data.emissiveMapUuid, data.emissiveMapSrc); if (em) mat.emissiveMap = em;
    const ao = restoreTex(data.aoMapUuid, data.aoMapSrc); if (ao) mat.aoMap = ao;
    if (mat.map || mat.normalMap || mat.roughnessMap || mat.metalnessMap || mat.emissiveMap || mat.aoMap) {
      mat.needsUpdate = true;
    }

    return mat;
  }

  private static deserializeLight(data: SerializedLight): THREE.Light {
    switch (data.type) {
      case 'DirectionalLight': {
        const l = new THREE.DirectionalLight(data.color, data.intensity);
        l.castShadow = data.castShadow;
        return l;
      }
      case 'PointLight': {
        const l = new THREE.PointLight(data.color, data.intensity, data.distance, data.decay);
        l.castShadow = data.castShadow;
        return l;
      }
      case 'SpotLight': {
        const l = new THREE.SpotLight(data.color, data.intensity, data.distance, data.angle, data.penumbra, data.decay);
        l.castShadow = data.castShadow;
        return l;
      }
      case 'AmbientLight':
        return new THREE.AmbientLight(data.color, data.intensity);
      case 'HemisphereLight':
        return new THREE.HemisphereLight(data.color, undefined, data.intensity);
      default:
        return new THREE.AmbientLight(data.color, data.intensity);
    }
  }

  private static deserializeCamera(data: SerializedCamera): THREE.PerspectiveCamera {
    return new THREE.PerspectiveCamera(data.fov, data.aspect, data.near, data.far);
  }

  // ── File I/O Helpers ──────────────────────────────────────────

  /** Export scene to a downloadable JSON file */
  static exportToFile(scene: THREE.Scene, filename = 'scene.json'): void {
    const data = this.serialize(scene);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Import scene from a file dialog */
  static async importFromFile(): Promise<SerializedScene> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { reject(new Error('No file selected')); return; }
        const text = await file.text();
        try {
          const data = JSON.parse(text) as SerializedScene;
          if (!data.version || !data.objects) throw new Error('Invalid scene file');
          resolve(data);
        } catch (e) {
          reject(e);
        }
      };
      input.click();
    });
  }
}
