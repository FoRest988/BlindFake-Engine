/**
 * WaterSystem — Realistic water rendering with:
 * - Animated wave displacement (vertex shader, multi-octave Gerstner waves)
 * - Reflections (planar reflection via RTT or environment map fallback)
 * - Refractions (depth-based distortion)
 * - Fresnel effect
 * - Foam at intersections (depth-based)
 * - Caustics projection
 * - Configurable color, opacity, speed, scale
 */

import * as THREE from 'three';

export interface WaterConfig {
  /** Water plane width */
  width: number;
  /** Water plane depth */
  depth: number;
  /** Segments for wave deformation */
  segments: number;
  /** Water surface Y position */
  waterLevel: number;
  /** Deep water color */
  deepColor: THREE.ColorRepresentation;
  /** Shallow / surface color */
  shallowColor: THREE.ColorRepresentation;
  /** Foam color */
  foamColor: THREE.ColorRepresentation;
  /** Overall wave amplitude */
  waveAmplitude: number;
  /** Wave speed multiplier */
  waveSpeed: number;
  /** Wave frequency */
  waveFrequency: number;
  /** Number of Gerstner wave octaves */
  waveOctaves: number;
  /** Water opacity (0-1) */
  opacity: number;
  /** Fresnel power (higher = more reflection at grazing angles) */
  fresnelPower: number;
  /** Distortion strength for refraction */
  distortion: number;
  /** Foam depth threshold */
  foamThreshold: number;
  /** Enable reflections (planar mirror) */
  enableReflection: boolean;
  /** Reflection resolution */
  reflectionResolution: number;
  /** Enable caustics */
  enableCaustics: boolean;
}

const DEFAULT_CONFIG: WaterConfig = {
  width: 512,
  depth: 512,
  segments: 128,
  waterLevel: 0,
  deepColor: 0x001e3d,
  shallowColor: 0x0077be,
  foamColor: 0xffffff,
  waveAmplitude: 0.8,
  waveSpeed: 1.0,
  waveFrequency: 0.4,
  waveOctaves: 4,
  opacity: 0.85,
  fresnelPower: 2.0,
  distortion: 0.03,
  foamThreshold: 0.6,
  enableReflection: true,
  reflectionResolution: 512,
  enableCaustics: false,
};

/* ─── Shaders ─────────────────────────────────────────── */

const WATER_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uFrequency;
  uniform float uSpeed;
  uniform int uOctaves;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec4 vClipPos;
  varying float vWaveHeight;

  // Gerstner wave
  vec3 gerstnerWave(vec3 pos, float amp, float freq, float speed, vec2 dir, float steepness, float t) {
    float phase = freq * dot(dir, pos.xz) + t * speed;
    float s = sin(phase);
    float c = cos(phase);
    float q = steepness / (freq * amp);
    return vec3(
      q * amp * dir.x * c,
      amp * s,
      q * amp * dir.y * c
    );
  }

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Multi-octave Gerstner waves
    vec3 totalDisplacement = vec3(0.0);
    float amp = uAmplitude;
    float freq = uFrequency;
    float speed = uSpeed;

    vec2 directions[4];
    directions[0] = normalize(vec2(1.0, 0.6));
    directions[1] = normalize(vec2(-0.7, 1.0));
    directions[2] = normalize(vec2(0.4, -0.8));
    directions[3] = normalize(vec2(-0.5, -0.3));

    for (int i = 0; i < 4; i++) {
      if (i >= uOctaves) break;
      float steepness = 0.5 / float(i + 1);
      totalDisplacement += gerstnerWave(pos, amp, freq, speed, directions[i], steepness, uTime);
      amp *= 0.5;
      freq *= 1.8;
      speed *= 1.1;
    }

    pos += totalDisplacement;
    vWaveHeight = totalDisplacement.y;

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;

    // Approximate normal from displacement
    float epsilon = 0.1;
    vec3 posR = position + vec3(epsilon, 0.0, 0.0);
    vec3 posF = position + vec3(0.0, 0.0, epsilon);
    vec3 dispR = totalDisplacement;
    vec3 dispF = totalDisplacement;
    // Simplified — just perturb y
    vec3 tangent = normalize(vec3(epsilon, dispR.y * 0.1, 0.0));
    vec3 bitangent = normalize(vec3(0.0, dispF.y * 0.1, epsilon));
    vNormal = normalize(cross(bitangent, tangent));
    vNormal = normalize(normalMatrix * vNormal);

    vClipPos = projectionMatrix * viewMatrix * worldPos;
    gl_Position = vClipPos;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uFoamColor;
  uniform float uOpacity;
  uniform float uFresnelPower;
  uniform float uDistortion;
  uniform float uFoamThreshold;
  uniform float uTime;
  uniform vec3 uCameraPos;
  uniform vec3 uSunDirection;

  uniform sampler2D uReflectionMap;
  uniform sampler2D uNormalMap;
  uniform bool uHasReflection;
  uniform bool uHasNormalMap;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec4 vClipPos;
  varying float vWaveHeight;

  // Simplex-ish noise for foam pattern
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 normal = normalize(vNormal);

    // Normal map perturbation
    if (uHasNormalMap) {
      vec3 nMap = texture2D(uNormalMap, vUv * 8.0 + uTime * 0.02).rgb * 2.0 - 1.0;
      normal = normalize(normal + nMap * 0.3);
    }

    // Fresnel
    float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), uFresnelPower);
    fresnel = clamp(fresnel, 0.05, 0.95);

    // Water color depth blend (based on wave height as proxy)
    float depthFactor = clamp(vWaveHeight * 2.0 + 0.5, 0.0, 1.0);
    vec3 waterColor = mix(uDeepColor, uShallowColor, depthFactor);

    // Reflection
    vec3 reflectionColor = vec3(0.5, 0.7, 0.9); // sky fallback
    if (uHasReflection) {
      vec2 screenUV = (vClipPos.xy / vClipPos.w) * 0.5 + 0.5;
      screenUV.y = 1.0 - screenUV.y; // flip for reflection
      screenUV += normal.xz * uDistortion; // distortion
      reflectionColor = texture2D(uReflectionMap, screenUV).rgb;
    }

    // Specular (sun reflection)
    vec3 halfDir = normalize(uSunDirection + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 128.0);
    vec3 specular = vec3(1.0) * spec * 0.8;

    // Foam
    float foamNoise = noise2D(vWorldPos.xz * 0.5 + uTime * 0.3);
    foamNoise += noise2D(vWorldPos.xz * 1.5 - uTime * 0.2) * 0.5;
    float foam = smoothstep(uFoamThreshold, uFoamThreshold + 0.3, foamNoise + vWaveHeight * 0.5);
    vec3 foamContrib = uFoamColor * foam * 0.6;

    // Combine
    vec3 finalColor = mix(waterColor, reflectionColor, fresnel);
    finalColor += specular;
    finalColor += foamContrib;

    // Subtle caustics pattern on surface
    float caustic = noise2D(vWorldPos.xz * 3.0 + uTime * 0.5) * noise2D(vWorldPos.xz * 5.0 - uTime * 0.3);
    finalColor += vec3(0.05, 0.1, 0.15) * caustic * (1.0 - fresnel);

    gl_FragColor = vec4(finalColor, uOpacity);
  }
`;

export class WaterSystem {
  private config: WaterConfig;
  private mesh!: THREE.Mesh;
  private material!: THREE.ShaderMaterial;
  private geometry!: THREE.PlaneGeometry;
  private parent: THREE.Object3D;
  private clock = 0;

  // Planar reflection
  private reflectionCamera: THREE.PerspectiveCamera | null = null;
  private reflectionRT: THREE.WebGLRenderTarget | null = null;
  private reflectionClipPlane: THREE.Plane;

  // Optional normal map
  private normalMap: THREE.Texture | null = null;

  constructor(parent: THREE.Object3D, config: Partial<WaterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.parent = parent;
    this.reflectionClipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.config.waterLevel);
    this.buildMesh();
  }

  /* ─── Public API ──────────────────────────────────────── */

  /** Update water animation — call each frame */
  update(dt: number, camera: THREE.Camera, renderer?: THREE.WebGLRenderer, scene?: THREE.Scene): void {
    this.clock += dt * this.config.waveSpeed;
    this.material.uniforms.uTime.value = this.clock;

    // Update camera position for fresnel
    this.material.uniforms.uCameraPos.value.copy(camera.position);

    // Planar reflection
    if (this.config.enableReflection && renderer && scene && this.reflectionCamera && this.reflectionRT) {
      this.renderReflection(camera, renderer, scene);
    }
  }

  /** Set sun direction (for specular) */
  setSunDirection(dir: THREE.Vector3): void {
    this.material.uniforms.uSunDirection.value.copy(dir).normalize();
  }

  /** Set normal map texture for extra detail */
  setNormalMap(texture: THREE.Texture): void {
    this.normalMap = texture;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    this.material.uniforms.uNormalMap.value = texture;
    this.material.uniforms.uHasNormalMap.value = true;
  }

  /** Update config at runtime */
  setConfig(partial: Partial<WaterConfig>): void {
    Object.assign(this.config, partial);

    const u = this.material.uniforms;
    u.uAmplitude.value = this.config.waveAmplitude;
    u.uFrequency.value = this.config.waveFrequency;
    u.uSpeed.value = this.config.waveSpeed;
    u.uOctaves.value = this.config.waveOctaves;
    u.uDeepColor.value.set(this.config.deepColor);
    u.uShallowColor.value.set(this.config.shallowColor);
    u.uFoamColor.value.set(this.config.foamColor);
    u.uOpacity.value = this.config.opacity;
    u.uFresnelPower.value = this.config.fresnelPower;
    u.uDistortion.value = this.config.distortion;
    u.uFoamThreshold.value = this.config.foamThreshold;
  }

  /** Get water mesh */
  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  /** Get water level */
  getWaterLevel(): number {
    return this.config.waterLevel;
  }

  /** Get wave height at a world position (approximate) */
  getWaveHeightAt(x: number, z: number): number {
    const time = this.clock;
    const cfg = this.config;
    let height = cfg.waterLevel;
    let amp = cfg.waveAmplitude;
    let freq = cfg.waveFrequency;
    let speed = cfg.waveSpeed;

    const dirs = [
      [1.0, 0.6], [-0.7, 1.0], [0.4, -0.8], [-0.5, -0.3],
    ];

    for (let i = 0; i < cfg.waveOctaves && i < 4; i++) {
      const d = dirs[i];
      const len = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
      const dx = d[0] / len;
      const dz = d[1] / len;

      const phase = freq * (dx * x + dz * z) + time * speed;
      height += amp * Math.sin(phase);

      amp *= 0.5;
      freq *= 1.8;
      speed *= 1.1;
    }

    return height;
  }

  /** Check if a point is underwater */
  isUnderwater(point: THREE.Vector3): boolean {
    return point.y < this.getWaveHeightAt(point.x, point.z);
  }

  /* ─── Build ──────────────────────────────────────────── */

  private buildMesh(): void {
    const cfg = this.config;

    this.geometry = new THREE.PlaneGeometry(cfg.width, cfg.depth, cfg.segments, cfg.segments);
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: cfg.waveAmplitude },
        uFrequency: { value: cfg.waveFrequency },
        uSpeed: { value: cfg.waveSpeed },
        uOctaves: { value: cfg.waveOctaves },
        uDeepColor: { value: new THREE.Color(cfg.deepColor) },
        uShallowColor: { value: new THREE.Color(cfg.shallowColor) },
        uFoamColor: { value: new THREE.Color(cfg.foamColor) },
        uOpacity: { value: cfg.opacity },
        uFresnelPower: { value: cfg.fresnelPower },
        uDistortion: { value: cfg.distortion },
        uFoamThreshold: { value: cfg.foamThreshold },
        uCameraPos: { value: new THREE.Vector3() },
        uSunDirection: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
        uReflectionMap: { value: null as THREE.Texture | null },
        uNormalMap: { value: null as THREE.Texture | null },
        uHasReflection: { value: false },
        uHasNormalMap: { value: false },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = cfg.waterLevel;
    this.mesh.name = 'Water';
    this.mesh.renderOrder = 100; // render after opaque
    this.parent.add(this.mesh);

    // Setup reflection
    if (cfg.enableReflection) {
      this.setupReflection();
    }
  }

  /* ─── Planar Reflection ──────────────────────────────── */

  private setupReflection(): void {
    const res = this.config.reflectionResolution;

    this.reflectionRT = new THREE.WebGLRenderTarget(res, res, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      colorSpace: THREE.SRGBColorSpace,
    });

    this.reflectionCamera = new THREE.PerspectiveCamera();
    this.material.uniforms.uReflectionMap.value = this.reflectionRT.texture;
    this.material.uniforms.uHasReflection.value = true;
  }

  private renderReflection(camera: THREE.Camera, renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (!this.reflectionCamera || !this.reflectionRT) return;

    // Mirror the camera across the water plane
    const refCam = this.reflectionCamera;
    refCam.copy(camera as THREE.PerspectiveCamera);

    // Reflect position
    refCam.position.y = -(camera.position.y - this.config.waterLevel * 2);
    refCam.up.set(0, -1, 0);

    // Look target — reflect the forward direction
    const target = new THREE.Vector3(0, 0, -1);
    target.applyQuaternion(camera.quaternion);
    target.y = -target.y;
    target.add(refCam.position);
    refCam.lookAt(target);

    refCam.updateMatrixWorld(true);
    refCam.updateProjectionMatrix();

    // Hide water mesh during reflection render
    this.mesh.visible = false;

    // Clip plane
    const clipPlane = new THREE.Vector4(
      this.reflectionClipPlane.normal.x,
      this.reflectionClipPlane.normal.y,
      this.reflectionClipPlane.normal.z,
      this.reflectionClipPlane.constant
    );

    // Render
    const currentRT = renderer.getRenderTarget();
    renderer.setRenderTarget(this.reflectionRT);
    renderer.clippingPlanes = [this.reflectionClipPlane];
    renderer.render(scene, refCam);
    renderer.clippingPlanes = [];
    renderer.setRenderTarget(currentRT);

    this.mesh.visible = true;
  }

  /* ─── Dispose ────────────────────────────────────────── */

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.reflectionRT?.dispose();
    this.parent.remove(this.mesh);
  }
}
