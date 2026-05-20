// ─── Material Library & Instance System ─────────────────────────────
// Manages saved materials, instances, custom shaders, and auto-setup.

import * as THREE from 'three';

export interface MaterialDefinition {
  id: string;
  name: string;
  type: 'standard' | 'physical' | 'shader' | 'toon' | 'basic';
  properties: Record<string, unknown>;
  texturePaths: Record<string, string>;
  customShader?: { vertex: string; fragment: string; uniforms: Record<string, unknown> };
  tags: string[];
  thumbnail?: string;
}

export interface MaterialInstanceDef {
  id: string;
  name: string;
  baseMaterialId: string;
  overrides: Record<string, unknown>;
}

const DEFAULT_VERT = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewDir;

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DEFAULT_FRAG = `
uniform vec3 baseColor;
uniform float roughness;
uniform float metalness;
uniform float opacity;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  vec3 norm = normalize(vNormal);
  float NdotL = max(dot(norm, normalize(vec3(1.0, 1.0, 0.5))), 0.0);
  vec3 diffuse = baseColor * (0.3 + 0.7 * NdotL);

  // Fresnel
  float fresnel = pow(1.0 - max(dot(norm, vViewDir), 0.0), 3.0);
  vec3 spec = mix(vec3(0.04), baseColor, metalness) * fresnel * (1.0 - roughness);

  gl_FragColor = vec4(diffuse + spec, opacity);
}
`;

export class MaterialLibrary {
  private materials = new Map<string, MaterialDefinition>();
  private instances = new Map<string, MaterialInstanceDef>();
  private liveCache = new Map<string, THREE.Material>();

  // ── Library CRUD ──────────────────────────────────────────────────

  saveMaterial(def: MaterialDefinition): void {
    this.materials.set(def.id, def);
    this.liveCache.delete(def.id);
  }

  getMaterialDef(id: string): MaterialDefinition | undefined {
    return this.materials.get(id);
  }

  removeMaterial(id: string): void {
    const cached = this.liveCache.get(id);
    if (cached) {
      cached.dispose();
      this.liveCache.delete(id);
    }
    this.materials.delete(id);
  }

  getAllMaterials(): MaterialDefinition[] {
    return Array.from(this.materials.values());
  }

  findByTag(tag: string): MaterialDefinition[] {
    return this.getAllMaterials().filter(m => m.tags.includes(tag));
  }

  // ── Instances ─────────────────────────────────────────────────────

  createInstance(name: string, baseMaterialId: string, overrides: Record<string, unknown> = {}): MaterialInstanceDef {
    const id = `inst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const inst: MaterialInstanceDef = { id, name, baseMaterialId, overrides };
    this.instances.set(id, inst);
    return inst;
  }

  getInstances(baseMaterialId: string): MaterialInstanceDef[] {
    return Array.from(this.instances.values()).filter(i => i.baseMaterialId === baseMaterialId);
  }

  removeInstance(id: string): void {
    this.instances.delete(id);
    this.liveCache.delete(id);
  }

  // ── Build THREE.Material from definition ──────────────────────────

  buildMaterial(def: MaterialDefinition, textureLoader?: THREE.TextureLoader): THREE.Material {
    const cached = this.liveCache.get(def.id);
    if (cached) return cached;

    let mat: THREE.Material;

    if (def.type === 'shader' && def.customShader) {
      mat = this.buildShaderMaterial(def);
    } else {
      mat = this.buildStandardMaterial(def, textureLoader);
    }

    mat.name = def.name;
    this.liveCache.set(def.id, mat);
    return mat;
  }

  buildInstanceMaterial(inst: MaterialInstanceDef, textureLoader?: THREE.TextureLoader): THREE.Material | null {
    const baseDef = this.materials.get(inst.baseMaterialId);
    if (!baseDef) return null;

    const mergedDef: MaterialDefinition = {
      ...baseDef,
      id: inst.id,
      name: inst.name,
      properties: { ...baseDef.properties, ...inst.overrides },
    };

    return this.buildMaterial(mergedDef, textureLoader);
  }

  private buildStandardMaterial(def: MaterialDefinition, textureLoader?: THREE.TextureLoader): THREE.Material {
    const props = def.properties;
    const loader = textureLoader ?? new THREE.TextureLoader();

    const loadTex = (path: string, srgb = false): THREE.Texture | undefined => {
      if (!path) return undefined;
      const tex = loader.load(path);
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    };

    const textures: Record<string, THREE.Texture | undefined> = {};
    for (const [key, path] of Object.entries(def.texturePaths)) {
      const isSrgb = key === 'map' || key === 'emissiveMap';
      textures[key] = loadTex(path, isSrgb);
    }

    switch (def.type) {
      case 'physical': {
        const mat = new THREE.MeshPhysicalMaterial({
          color: props.color as number ?? 0xcccccc,
          roughness: props.roughness as number ?? 0.5,
          metalness: props.metalness as number ?? 0,
          clearcoat: props.clearcoat as number ?? 0,
          clearcoatRoughness: props.clearcoatRoughness as number ?? 0,
          transmission: props.transmission as number ?? 0,
          ior: props.ior as number ?? 1.5,
          thickness: props.thickness as number ?? 0,
          sheen: props.sheen as number ?? 0,
          sheenRoughness: props.sheenRoughness as number ?? 0.5,
          sheenColor: new THREE.Color(props.sheenColor as number ?? 0xffffff),
          attenuationColor: new THREE.Color(props.attenuationColor as number ?? 0xffffff),
          attenuationDistance: props.attenuationDistance as number ?? Infinity,
          specularIntensity: props.specularIntensity as number ?? 1,
          specularColor: new THREE.Color(props.specularColor as number ?? 0xffffff),
          iridescence: props.iridescence as number ?? 0,
          iridescenceIOR: props.iridescenceIOR as number ?? 1.3,
          anisotropy: props.anisotropy as number ?? 0,
          anisotropyRotation: props.anisotropyRotation as number ?? 0,
          opacity: props.opacity as number ?? 1,
          transparent: (props.opacity as number ?? 1) < 1 || (props.transmission as number ?? 0) > 0,
        });
        if (textures.map) mat.map = textures.map;
        if (textures.normalMap) mat.normalMap = textures.normalMap;
        if (textures.roughnessMap) mat.roughnessMap = textures.roughnessMap;
        if (textures.metalnessMap) mat.metalnessMap = textures.metalnessMap;
        if (textures.aoMap) mat.aoMap = textures.aoMap;
        if (textures.emissiveMap) mat.emissiveMap = textures.emissiveMap;
        if (textures.displacementMap) mat.displacementMap = textures.displacementMap;
        if (textures.clearcoatMap) mat.clearcoatMap = textures.clearcoatMap;
        if (textures.clearcoatNormalMap) mat.clearcoatNormalMap = textures.clearcoatNormalMap;
        if (textures.clearcoatRoughnessMap) mat.clearcoatRoughnessMap = textures.clearcoatRoughnessMap;
        if (textures.transmissionMap) mat.transmissionMap = textures.transmissionMap;
        if (textures.thicknessMap) mat.thicknessMap = textures.thicknessMap;
        if (textures.sheenColorMap) mat.sheenColorMap = textures.sheenColorMap;
        if (textures.sheenRoughnessMap) mat.sheenRoughnessMap = textures.sheenRoughnessMap;
        if (textures.iridescenceMap) mat.iridescenceMap = textures.iridescenceMap;
        if (textures.anisotropyMap) mat.anisotropyMap = textures.anisotropyMap;
        if (props.emissive) mat.emissive = new THREE.Color(props.emissive as number);
        if (props.emissiveIntensity) mat.emissiveIntensity = props.emissiveIntensity as number;
        if (props.normalScale) mat.normalScale = new THREE.Vector2(props.normalScale as number, props.normalScale as number);
        if (props.displacementScale) mat.displacementScale = props.displacementScale as number;
        if (props.side != null) mat.side = props.side as THREE.Side;
        if (props.flatShading) mat.flatShading = true;
        return mat;
      }
      case 'toon': {
        const mat = new THREE.MeshToonMaterial({
          color: props.color as number ?? 0xcccccc,
        });
        if (textures.map) mat.map = textures.map;
        if (textures.normalMap) mat.normalMap = textures.normalMap;
        return mat;
      }
      case 'basic': {
        return new THREE.MeshBasicMaterial({
          color: props.color as number ?? 0xcccccc,
          wireframe: props.wireframe as boolean ?? false,
        });
      }
      default: {
        const mat = new THREE.MeshStandardMaterial({
          color: props.color as number ?? 0xcccccc,
          roughness: props.roughness as number ?? 0.5,
          metalness: props.metalness as number ?? 0,
          opacity: props.opacity as number ?? 1,
          transparent: (props.opacity as number ?? 1) < 1,
        });
        if (textures.map) mat.map = textures.map;
        if (textures.normalMap) mat.normalMap = textures.normalMap;
        if (textures.roughnessMap) mat.roughnessMap = textures.roughnessMap;
        if (textures.metalnessMap) mat.metalnessMap = textures.metalnessMap;
        if (textures.aoMap) mat.aoMap = textures.aoMap;
        if (textures.emissiveMap) mat.emissiveMap = textures.emissiveMap;
        if (textures.displacementMap) mat.displacementMap = textures.displacementMap;
        if (props.emissive) mat.emissive = new THREE.Color(props.emissive as number);
        if (props.emissiveIntensity) mat.emissiveIntensity = props.emissiveIntensity as number;
        if (props.normalScale) mat.normalScale = new THREE.Vector2(props.normalScale as number, props.normalScale as number);
        if (props.displacementScale) mat.displacementScale = props.displacementScale as number;
        if (props.side != null) mat.side = props.side as THREE.Side;
        if (props.flatShading) mat.flatShading = true;
        if (props.wireframe) mat.wireframe = true;
        return mat;
      }
    }
  }

  private buildShaderMaterial(def: MaterialDefinition): THREE.ShaderMaterial {
    const shader = def.customShader!;
    const uniforms: Record<string, THREE.IUniform> = {};

    for (const [key, val] of Object.entries(shader.uniforms)) {
      if (typeof val === 'number') {
        uniforms[key] = { value: val };
      } else if (Array.isArray(val) && val.length === 3) {
        uniforms[key] = { value: new THREE.Vector3(val[0], val[1], val[2]) };
      } else if (Array.isArray(val) && val.length === 4) {
        uniforms[key] = { value: new THREE.Vector4(val[0], val[1], val[2], val[3]) };
      } else {
        uniforms[key] = { value: val };
      }
    }

    return new THREE.ShaderMaterial({
      vertexShader: shader.vertex || DEFAULT_VERT,
      fragmentShader: shader.fragment || DEFAULT_FRAG,
      uniforms,
      lights: false,
      transparent: (def.properties.transparent as boolean) ?? false,
      side: (def.properties.side as THREE.Side) ?? THREE.FrontSide,
    });
  }

  // ── Auto-Setup from Texture Folder ────────────────────────────────

  autoSetupFromTextures(texturePaths: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    const lowerPaths = texturePaths.map(p => ({ path: p, lower: p.toLowerCase() }));

    const patterns: [string, RegExp[]][] = [
      ['map', [/basecolor|albedo|diffuse|color(?!space)/i, /_col\b/i, /_d\b/i]],
      ['normalMap', [/normal/i, /_n\b/i, /_nrm\b/i, /_nor\b/i]],
      ['roughnessMap', [/roughness/i, /_r\b/i, /_rough\b/i]],
      ['metalnessMap', [/metaln?i?c?|metalness/i, /_m\b/i, /_met\b/i]],
      ['aoMap', [/ambient.?occ|_ao\b/i, /occ/i]],
      ['emissiveMap', [/emissive|emission/i, /_e\b/i]],
      ['displacementMap', [/height|displacement|disp/i, /_h\b/i]],
      ['clearcoatMap', [/clearcoat(?!rough|normal)/i]],
      ['clearcoatNormalMap', [/clearcoat.*normal/i]],
      ['clearcoatRoughnessMap', [/clearcoat.*rough/i]],
      ['transmissionMap', [/transmission/i]],
      ['thicknessMap', [/thickness/i]],
      ['sheenColorMap', [/sheen.*col/i]],
      ['sheenRoughnessMap', [/sheen.*rough/i]],
    ];

    for (const [slot, regexes] of patterns) {
      for (const { path, lower } of lowerPaths) {
        if (regexes.some(r => r.test(lower))) {
          if (!result[slot]) {
            result[slot] = path;
            break;
          }
        }
      }
    }

    return result;
  }

  // ── Extract definition from existing THREE.Material ───────────────

  extractDefinition(mat: THREE.Material, name?: string): MaterialDefinition {
    const id = `mat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const def: MaterialDefinition = {
      id,
      name: name ?? mat.name ?? 'Unnamed Material',
      type: 'standard',
      properties: {},
      texturePaths: {},
      tags: [],
    };

    if (mat instanceof THREE.MeshPhysicalMaterial) {
      def.type = 'physical';
      def.properties = {
        color: mat.color.getHex(),
        roughness: mat.roughness,
        metalness: mat.metalness,
        clearcoat: mat.clearcoat,
        clearcoatRoughness: mat.clearcoatRoughness,
        transmission: mat.transmission,
        ior: mat.ior,
        thickness: mat.thickness,
        sheen: mat.sheen,
        sheenRoughness: mat.sheenRoughness,
        sheenColor: mat.sheenColor.getHex(),
        specularIntensity: mat.specularIntensity,
        specularColor: mat.specularColor.getHex(),
        iridescence: mat.iridescence,
        iridescenceIOR: mat.iridescenceIOR,
        anisotropy: mat.anisotropy,
        anisotropyRotation: mat.anisotropyRotation,
        emissive: mat.emissive.getHex(),
        emissiveIntensity: mat.emissiveIntensity,
        opacity: mat.opacity,
        side: mat.side,
        flatShading: mat.flatShading,
      };
    } else if (mat instanceof THREE.MeshStandardMaterial) {
      def.type = 'standard';
      def.properties = {
        color: mat.color.getHex(),
        roughness: mat.roughness,
        metalness: mat.metalness,
        emissive: mat.emissive.getHex(),
        emissiveIntensity: mat.emissiveIntensity,
        opacity: mat.opacity,
        side: mat.side,
        flatShading: mat.flatShading,
        wireframe: mat.wireframe,
        normalScale: mat.normalScale.x,
        displacementScale: mat.displacementScale,
      };
    } else if (mat instanceof THREE.MeshToonMaterial) {
      def.type = 'toon';
      def.properties = { color: mat.color.getHex() };
    } else if (mat instanceof THREE.MeshBasicMaterial) {
      def.type = 'basic';
      def.properties = { color: mat.color.getHex(), wireframe: mat.wireframe };
    }

    return def;
  }

  // ── Serialization ─────────────────────────────────────────────────

  serialize(): string {
    return JSON.stringify({
      materials: Array.from(this.materials.values()),
      instances: Array.from(this.instances.values()),
    });
  }

  deserialize(json: string): void {
    const data = JSON.parse(json);
    this.materials.clear();
    this.instances.clear();
    this.liveCache.clear();

    for (const m of data.materials ?? []) {
      this.materials.set(m.id, m);
    }
    for (const i of data.instances ?? []) {
      this.instances.set(i.id, i);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  get defaultVertexShader(): string { return DEFAULT_VERT; }
  get defaultFragmentShader(): string { return DEFAULT_FRAG; }

  clearCache(): void {
    for (const mat of this.liveCache.values()) {
      mat.dispose();
    }
    this.liveCache.clear();
  }
}
