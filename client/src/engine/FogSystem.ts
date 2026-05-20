/**
 * FogSystem — Advanced volumetric fog, height fog, distance fog & fog zones.
 *
 * Goes beyond Three.js built-in Fog/FogExp2:
 *  - Height-based fog (thick at ground level, fades with altitude)
 *  - Fog zones (box/sphere volumes with custom fog parameters)
 *  - Animated noise-driven fog density
 *  - Full-screen post-process pass for volumetric look
 *  - Per-zone color, density, height, animation speed
 */

import * as THREE from 'three';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface FogGlobalConfig {
  enabled: boolean;
  color: THREE.Color;
  /** Exponential density for distance fog */
  density: number;
  /** Height below which fog is at full density */
  heightStart: number;
  /** Height above which fog fully fades out */
  heightEnd: number;
  /** Fog noise animation speed (0 = static) */
  noiseSpeed: number;
  /** Noise amplitude – how much density varies spatially */
  noiseAmplitude: number;
  /** Noise frequency (scale of the noise pattern) */
  noiseFrequency: number;
}

export type FogZoneShape = 'box' | 'sphere';

export interface FogZoneConfig {
  id: string;
  shape: FogZoneShape;
  position: THREE.Vector3;
  /** Half-extents for box, radius for sphere (x component) */
  size: THREE.Vector3;
  color: THREE.Color;
  density: number;
  /** Blend distance at edges (soft falloff) */
  edgeSoftness: number;
  /** Height fog within this zone */
  heightStart: number;
  heightEnd: number;
  /** Override noise speed inside the zone (-1 = use global) */
  noiseSpeed: number;
  enabled: boolean;
}

const DEFAULT_GLOBAL: FogGlobalConfig = {
  enabled: true,
  color: new THREE.Color(0xaabbcc),
  density: 0.003,
  heightStart: 0,
  heightEnd: 60,
  noiseSpeed: 0.15,
  noiseAmplitude: 0.35,
  noiseFrequency: 0.8,
};

// ── Shader ──────────────────────────────────────────────────────────────────

const fogVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`;

const fogFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform vec3  fogColor;
uniform float fogDensity;
uniform float fogHeightStart;
uniform float fogHeightEnd;
uniform float noiseSpeed;
uniform float noiseAmplitude;
uniform float noiseFrequency;
uniform float time;
uniform vec3  cameraPosition;
uniform mat4  inverseProjection;
uniform mat4  inverseView;

// Zone uniforms (max 8 zones)
#define MAX_ZONES 8
uniform int   zoneCount;
uniform vec3  zonePositions[MAX_ZONES];
uniform vec3  zoneSizes[MAX_ZONES];
uniform vec3  zoneColors[MAX_ZONES];
uniform float zoneDensities[MAX_ZONES];
uniform float zoneEdgeSoftness[MAX_ZONES];
uniform float zoneHeightStart[MAX_ZONES];
uniform float zoneHeightEnd[MAX_ZONES];
uniform int   zoneShapes[MAX_ZONES]; // 0=box, 1=sphere

varying vec2 vUv;

// Simple 3D value noise
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise3D(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

float linearDepth(float d) {
  float ndc = d * 2.0 - 1.0;
  return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - ndc * (cameraFar - cameraNear));
}

vec3 worldPosFromDepth(float depth, vec2 uv) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = inverseProjection * clip;
  view /= view.w;
  vec4 world = inverseView * view;
  return world.xyz;
}

float heightFog(float y, float hStart, float hEnd) {
  return 1.0 - clamp((y - hStart) / max(hEnd - hStart, 0.001), 0.0, 1.0);
}

float sdfBox(vec3 p, vec3 center, vec3 halfExt) {
  vec3 d = abs(p - center) - halfExt;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

float sdfSphere(vec3 p, vec3 center, float radius) {
  return length(p - center) - radius;
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  float depth = texture2D(tDepth, vUv).r;

  // Skip far plane (skybox)
  if (depth >= 1.0) {
    gl_FragColor = color;
    return;
  }

  float linDepth = linearDepth(depth);
  vec3 worldPos = worldPosFromDepth(depth, vUv);

  // Global distance fog
  float dist = length(worldPos - cameraPosition);
  float distFog = 1.0 - exp(-fogDensity * dist);

  // Global height fog
  float hFog = heightFog(worldPos.y, fogHeightStart, fogHeightEnd);

  // Noise modulation
  vec3 noisePos = worldPos * noiseFrequency + vec3(time * noiseSpeed, 0.0, time * noiseSpeed * 0.7);
  float n = fbm(noisePos);
  float noiseMod = 1.0 + noiseAmplitude * (n - 0.5) * 2.0;

  float globalFactor = clamp(distFog * hFog * noiseMod, 0.0, 1.0);
  vec3  blendColor = fogColor;

  // Fog zones
  for (int i = 0; i < MAX_ZONES; i++) {
    if (i >= zoneCount) break;

    float sdf;
    if (zoneShapes[i] == 1) {
      sdf = sdfSphere(worldPos, zonePositions[i], zoneSizes[i].x);
    } else {
      sdf = sdfBox(worldPos, zonePositions[i], zoneSizes[i]);
    }

    float soft = max(zoneEdgeSoftness[i], 0.001);
    float zoneMask = 1.0 - clamp(sdf / soft, 0.0, 1.0);
    float zoneH = heightFog(worldPos.y, zoneHeightStart[i], zoneHeightEnd[i]);
    float zoneFactor = zoneMask * zoneDensities[i] * zoneH * noiseMod;

    // Blend zone fog on top of global
    globalFactor = max(globalFactor, clamp(zoneFactor, 0.0, 1.0));
    blendColor = mix(blendColor, zoneColors[i], zoneMask * 0.8);
  }

  gl_FragColor = vec4(mix(color.rgb, blendColor, globalFactor), color.a);
}`;

// ── FogSystem Class ─────────────────────────────────────────────────────────

export class FogSystem {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  private global: FogGlobalConfig;
  private zones: Map<string, FogZoneConfig> = new Map();
  private time = 0;

  // Post-process resources
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private depthTarget: THREE.WebGLRenderTarget | null = null;
  private fullscreenQuad!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private fogScene!: THREE.Scene;
  private fogCamera!: THREE.OrthographicCamera;

  // Zone debug helpers
  private debugHelpers: Map<string, THREE.Object3D> = new Map();
  private debugVisible = false;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.global = { ...DEFAULT_GLOBAL, color: DEFAULT_GLOBAL.color.clone() };
    this.initPass();
  }

  // ── Setup ────────────────────────────────────────────────────────────────

  private initPass(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    const w = Math.max(size.x, 1);
    const h = Math.max(size.y, 1);

    this.renderTarget = new THREE.WebGLRenderTarget(w, h);
    this.depthTarget = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
    });
    this.depthTarget.depthTexture = new THREE.DepthTexture(w, h);
    this.depthTarget.depthTexture.format = THREE.DepthFormat;
    this.depthTarget.depthTexture.type = THREE.UnsignedIntType;

    const mat = new THREE.ShaderMaterial({
      vertexShader: fogVert,
      fragmentShader: fogFrag,
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        cameraNear: { value: this.camera.near },
        cameraFar: { value: this.camera.far },
        fogColor: { value: this.global.color },
        fogDensity: { value: this.global.density },
        fogHeightStart: { value: this.global.heightStart },
        fogHeightEnd: { value: this.global.heightEnd },
        noiseSpeed: { value: this.global.noiseSpeed },
        noiseAmplitude: { value: this.global.noiseAmplitude },
        noiseFrequency: { value: this.global.noiseFrequency },
        time: { value: 0 },
        cameraPosition: { value: new THREE.Vector3() },
        inverseProjection: { value: new THREE.Matrix4() },
        inverseView: { value: new THREE.Matrix4() },
        // Zones
        zoneCount: { value: 0 },
        zonePositions: { value: new Array(8).fill(null).map(() => new THREE.Vector3()) },
        zoneSizes: { value: new Array(8).fill(null).map(() => new THREE.Vector3(10, 10, 10)) },
        zoneColors: { value: new Array(8).fill(null).map(() => new THREE.Color(0xffffff)) },
        zoneDensities: { value: new Float32Array(8) },
        zoneEdgeSoftness: { value: new Float32Array(8).fill(5) },
        zoneHeightStart: { value: new Float32Array(8) },
        zoneHeightEnd: { value: new Float32Array(8).fill(50) },
        zoneShapes: { value: new Int32Array(8) },
      },
      depthWrite: false,
      depthTest: false,
    });

    const geo = new THREE.PlaneGeometry(2, 2);
    this.fullscreenQuad = new THREE.Mesh(geo, mat);
    this.fogScene = new THREE.Scene();
    this.fogScene.add(this.fullscreenQuad);
    this.fogCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  // ── Configuration ────────────────────────────────────────────────────────

  configure(cfg: Partial<FogGlobalConfig>): void {
    if (cfg.enabled !== undefined) this.global.enabled = cfg.enabled;
    if (cfg.color) this.global.color.copy(cfg.color);
    if (cfg.density !== undefined) this.global.density = cfg.density;
    if (cfg.heightStart !== undefined) this.global.heightStart = cfg.heightStart;
    if (cfg.heightEnd !== undefined) this.global.heightEnd = cfg.heightEnd;
    if (cfg.noiseSpeed !== undefined) this.global.noiseSpeed = cfg.noiseSpeed;
    if (cfg.noiseAmplitude !== undefined) this.global.noiseAmplitude = cfg.noiseAmplitude;
    if (cfg.noiseFrequency !== undefined) this.global.noiseFrequency = cfg.noiseFrequency;
  }

  getConfig(): Readonly<FogGlobalConfig> { return this.global; }

  // ── Zones ────────────────────────────────────────────────────────────────

  addZone(cfg: Partial<FogZoneConfig> & { id: string }): void {
    const zone: FogZoneConfig = {
      id: cfg.id,
      shape: cfg.shape ?? 'box',
      position: cfg.position?.clone() ?? new THREE.Vector3(),
      size: cfg.size?.clone() ?? new THREE.Vector3(10, 10, 10),
      color: cfg.color?.clone() ?? this.global.color.clone(),
      density: cfg.density ?? 0.5,
      edgeSoftness: cfg.edgeSoftness ?? 5,
      heightStart: cfg.heightStart ?? -100,
      heightEnd: cfg.heightEnd ?? 100,
      noiseSpeed: cfg.noiseSpeed ?? -1,
      enabled: cfg.enabled ?? true,
    };
    this.zones.set(cfg.id, zone);
    if (this.debugVisible) this.buildDebugHelper(zone);
  }

  removeZone(id: string): void {
    this.zones.delete(id);
    const h = this.debugHelpers.get(id);
    if (h) { this.scene.remove(h); this.debugHelpers.delete(id); }
  }

  getZone(id: string): FogZoneConfig | undefined { return this.zones.get(id); }

  updateZone(id: string, cfg: Partial<FogZoneConfig>): void {
    const z = this.zones.get(id);
    if (!z) return;
    if (cfg.position) z.position.copy(cfg.position);
    if (cfg.size) z.size.copy(cfg.size);
    if (cfg.color) z.color.copy(cfg.color);
    if (cfg.density !== undefined) z.density = cfg.density;
    if (cfg.edgeSoftness !== undefined) z.edgeSoftness = cfg.edgeSoftness;
    if (cfg.heightStart !== undefined) z.heightStart = cfg.heightStart;
    if (cfg.heightEnd !== undefined) z.heightEnd = cfg.heightEnd;
    if (cfg.shape) z.shape = cfg.shape;
    if (cfg.enabled !== undefined) z.enabled = cfg.enabled;
    if (cfg.noiseSpeed !== undefined) z.noiseSpeed = cfg.noiseSpeed;
  }

  // ── Presets ──────────────────────────────────────────────────────────────

  preset(name: 'clear' | 'light' | 'medium' | 'thick' | 'horror' | 'underwater'): void {
    const presets: Record<string, Partial<FogGlobalConfig>> = {
      clear: { density: 0.0005, heightEnd: 200, noiseAmplitude: 0.1 },
      light: { density: 0.002, heightEnd: 80, noiseAmplitude: 0.2 },
      medium: { density: 0.005, heightEnd: 50, noiseAmplitude: 0.35, color: new THREE.Color(0xaabbcc) },
      thick: { density: 0.015, heightEnd: 30, noiseAmplitude: 0.5, color: new THREE.Color(0x888899) },
      horror: { density: 0.02, heightEnd: 20, noiseAmplitude: 0.7, noiseSpeed: 0.3, color: new THREE.Color(0x222222) },
      underwater: { density: 0.025, heightEnd: 200, noiseAmplitude: 0.4, noiseSpeed: 0.2, color: new THREE.Color(0x004466) },
    };
    this.configure(presets[name] ?? presets.medium);
  }

  // ── Debug Helpers ────────────────────────────────────────────────────────

  setDebugVisible(v: boolean): void {
    this.debugVisible = v;
    if (v) {
      this.zones.forEach(z => this.buildDebugHelper(z));
    } else {
      this.debugHelpers.forEach(h => this.scene.remove(h));
      this.debugHelpers.clear();
    }
  }

  private buildDebugHelper(zone: FogZoneConfig): void {
    const old = this.debugHelpers.get(zone.id);
    if (old) this.scene.remove(old);

    let geo: THREE.BufferGeometry;
    if (zone.shape === 'sphere') {
      geo = new THREE.SphereGeometry(zone.size.x, 16, 12);
    } else {
      geo = new THREE.BoxGeometry(zone.size.x * 2, zone.size.y * 2, zone.size.z * 2);
    }
    const mat = new THREE.MeshBasicMaterial({ color: zone.color, wireframe: true, transparent: true, opacity: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(zone.position);
    mesh.name = `fogZone_${zone.id}`;
    this.scene.add(mesh);
    this.debugHelpers.set(zone.id, mesh);
  }

  // ── Render Pass ──────────────────────────────────────────────────────────

  /** Call this instead of renderer.render(scene, camera) to inject fog post-pass */
  render(): void {
    if (!this.global.enabled || !this.depthTarget || !this.renderTarget) {
      return;
    }

    const size = this.renderer.getSize(new THREE.Vector2());
    if (this.depthTarget.width !== size.x || this.depthTarget.height !== size.y) {
      this.depthTarget.setSize(size.x, size.y);
      this.renderTarget.setSize(size.x, size.y);
    }

    // Render scene to depth + color
    const oldTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.depthTarget);
    this.renderer.render(this.scene, this.camera);

    const u = this.fullscreenQuad.material.uniforms;
    u.tDiffuse.value = this.depthTarget.texture;
    u.tDepth.value = this.depthTarget.depthTexture;
    u.cameraNear.value = this.camera.near;
    u.cameraFar.value = this.camera.far;
    u.fogColor.value = this.global.color;
    u.fogDensity.value = this.global.density;
    u.fogHeightStart.value = this.global.heightStart;
    u.fogHeightEnd.value = this.global.heightEnd;
    u.noiseSpeed.value = this.global.noiseSpeed;
    u.noiseAmplitude.value = this.global.noiseAmplitude;
    u.noiseFrequency.value = this.global.noiseFrequency;
    u.time.value = this.time;
    u.cameraPosition.value.copy(this.camera.position);
    u.inverseProjection.value.copy(this.camera.projectionMatrixInverse);
    u.inverseView.value.copy(this.camera.matrixWorld);

    // Upload zone data
    const enabledZones = [...this.zones.values()].filter(z => z.enabled).slice(0, 8);
    u.zoneCount.value = enabledZones.length;
    for (let i = 0; i < enabledZones.length; i++) {
      const z = enabledZones[i];
      (u.zonePositions.value as THREE.Vector3[])[i].copy(z.position);
      (u.zoneSizes.value as THREE.Vector3[])[i].copy(z.size);
      (u.zoneColors.value as THREE.Color[])[i].copy(z.color);
      (u.zoneDensities.value as Float32Array)[i] = z.density;
      (u.zoneEdgeSoftness.value as Float32Array)[i] = z.edgeSoftness;
      (u.zoneHeightStart.value as Float32Array)[i] = z.heightStart;
      (u.zoneHeightEnd.value as Float32Array)[i] = z.heightEnd;
      (u.zoneShapes.value as Int32Array)[i] = z.shape === 'sphere' ? 1 : 0;
    }

    // Render fog fullscreen pass to screen
    this.renderer.setRenderTarget(oldTarget);
    this.renderer.render(this.fogScene, this.fogCamera);
  }

  // ── Update ───────────────────────────────────────────────────────────────

  update(delta: number): void {
    this.time += delta;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.renderTarget?.dispose();
    this.depthTarget?.dispose();
    this.fullscreenQuad.geometry.dispose();
    this.fullscreenQuad.material.dispose();
    this.debugHelpers.forEach(h => this.scene.remove(h));
  }
}
