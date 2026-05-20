/**
 * WaterPlacementSystem — manages multiple water bodies in a scene.
 * Supports: Ocean, River, Lake, Lava, Shallow water.
 */

import * as THREE from 'three';
import { WaterSystem } from './WaterSystem';

export type WaterBodyType = 'ocean' | 'river' | 'lake' | 'lava' | 'shallow';

export interface WaterBodyHandle {
  id: string;
  type: WaterBodyType;
  dispose(): void;
  update(dt: number, camera: THREE.Camera, renderer: THREE.WebGLRenderer, scene: THREE.Scene): void;
  /** Update wave amplitude, speed, and opacity in real time (only available on ocean/lake). */
  setWaveConfig?: (amplitude: number, speed: number, opacity: number) => void;
}

/* ── Shared GLSL helpers ─────────────────────────────────── */

const LAVA_VERTEX = /* glsl */`
varying vec2 vUv;
varying float vY;
uniform float uTime;
void main() {
  vUv = uv;
  vec3 p = position;
  p.y += sin(p.x * 0.4 + uTime * 0.7) * 0.15 + cos(p.z * 0.35 + uTime * 0.5) * 0.12;
  vY = p.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const LAVA_FRAGMENT = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying float vY;
void main() {
  float n = fract(sin(dot(vUv * 4.0 + uTime * 0.15, vec2(127.1, 311.7))) * 43758.5453);
  vec3 hot  = vec3(1.0, 0.55, 0.0);
  vec3 dark = vec3(0.25, 0.04, 0.0);
  vec3 col  = mix(dark, hot, smoothstep(0.35, 0.65, n));
  col += vec3(0.4, 0.15, 0.0) * smoothstep(0.8, 1.0, n);
  gl_FragColor = vec4(col, 0.97);
}`;

const SHALLOW_VERTEX = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SHALLOW_FRAGMENT = /* glsl */`
uniform float uTime;
varying vec2 vUv;
void main() {
  float ripple = sin((vUv.x + vUv.y) * 20.0 - uTime * 2.0) * 0.03;
  vec3 col = vec3(0.3, 0.7 + ripple, 0.85);
  gl_FragColor = vec4(col, 0.45);
}`;

/* ── Helpers ─────────────────────────────────────────────── */

function makeId(): string {
  return `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
}

/* ── WaterPlacementSystem ────────────────────────────────── */

export class WaterPlacementSystem {
  private scene: THREE.Scene;
  private bodies = new Map<string, WaterBodyHandle>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /* ─────────────────────── Ocean ────────────────────────── */

  addOcean(waterLevel = 0, size = 20000): WaterBodyHandle {
    const ws = new WaterSystem(this.scene, {
      width: size,
      depth: size,
      waterLevel,
      waveAmplitude: 0.8,
      waveSpeed: 0.6,
    });
    const id = makeId();
    const handle: WaterBodyHandle = {
      id,
      type: 'ocean',
      update: (dt, cam, renderer, scene) => ws.update(dt, cam, renderer, scene),
      dispose: () => { ws.dispose(); this.bodies.delete(id); },
      setWaveConfig: (amplitude, speed, opacity) => ws.setConfig({ waveAmplitude: amplitude, waveSpeed: speed, opacity }),
    };
    this.bodies.set(id, handle);
    return handle;
  }

  /* ─────────────────────── Lake ─────────────────────────── */

  addLake(center: THREE.Vector3, radius = 50, waterLevel = 0): WaterBodyHandle {
    const ws = new WaterSystem(this.scene, {
      width: radius * 2,
      depth: radius * 2,
      waterLevel,
      waveAmplitude: 0.1,
      waveSpeed: 0.3,
    });
    ws.getMesh().position.set(center.x, waterLevel, center.z);
    const id = makeId();
    const handle: WaterBodyHandle = {
      id,
      type: 'lake',
      update: (dt, cam, renderer, scene) => ws.update(dt, cam, renderer, scene),
      dispose: () => { ws.dispose(); this.bodies.delete(id); },
      setWaveConfig: (amplitude, speed, opacity) => ws.setConfig({ waveAmplitude: amplitude, waveSpeed: speed, opacity }),
    };
    this.bodies.set(id, handle);
    return handle;
  }

  /* ─────────────────────── River ────────────────────────── */

  addRiver(points: THREE.Vector3[], width = 8): WaterBodyHandle {
    const curve = new THREE.CatmullRomCurve3(points);
    const divisions = Math.max(32, points.length * 16);
    const tubeGeo = new THREE.TubeGeometry(curve, divisions, width * 0.5, 8, false);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x3399cc,
      transparent: true,
      opacity: 0.75,
      roughness: 0.05,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(tubeGeo, mat);
    this.scene.add(mesh);

    const id = makeId();
    const handle: WaterBodyHandle = {
      id,
      type: 'river',
      update: (_dt) => { mat.map?.offset.setX((mat.map.offset.x + _dt * 0.4) % 1); },
      dispose: () => { tubeGeo.dispose(); mat.dispose(); this.scene.remove(mesh); this.bodies.delete(id); },
    };
    this.bodies.set(id, handle);
    return handle;
  }

  /* ─────────────────────── Lava ─────────────────────────── */

  addLava(center: THREE.Vector3, width = 30, depth = 30): WaterBodyHandle {
    const geo = new THREE.PlaneGeometry(width, depth, 32, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: LAVA_VERTEX,
      fragmentShader: LAVA_FRAGMENT,
      uniforms: { uTime: { value: 0 } },
      transparent: false,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(center);
    this.scene.add(mesh);

    let clock = 0;
    const id = makeId();
    const handle: WaterBodyHandle = {
      id,
      type: 'lava',
      update: (dt) => { clock += dt; mat.uniforms.uTime.value = clock; },
      dispose: () => { geo.dispose(); mat.dispose(); this.scene.remove(mesh); this.bodies.delete(id); },
    };
    this.bodies.set(id, handle);
    return handle;
  }

  /* ─────────────────────── Shallow ──────────────────────── */

  addShallow(center: THREE.Vector3, width = 20, depth = 20): WaterBodyHandle {
    const geo = new THREE.PlaneGeometry(width, depth, 16, 16);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SHALLOW_VERTEX,
      fragmentShader: SHALLOW_FRAGMENT,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(center);
    this.scene.add(mesh);

    let clock = 0;
    const id = makeId();
    const handle: WaterBodyHandle = {
      id,
      type: 'shallow',
      update: (dt) => { clock += dt; mat.uniforms.uTime.value = clock; },
      dispose: () => { geo.dispose(); mat.dispose(); this.scene.remove(mesh); this.bodies.delete(id); },
    };
    this.bodies.set(id, handle);
    return handle;
  }

  /* ─────────────────────── Update all ───────────────────── */

  update(dt: number, camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
    for (const body of this.bodies.values()) {
      body.update(dt, camera, renderer, this.scene);
    }
  }

  /** Remove a water body by handle or id */
  remove(idOrHandle: string | WaterBodyHandle): void {
    const id = typeof idOrHandle === 'string' ? idOrHandle : idOrHandle.id;
    this.bodies.get(id)?.dispose();
  }

  dispose(): void {
    for (const body of this.bodies.values()) body.dispose();
    this.bodies.clear();
  }
}
