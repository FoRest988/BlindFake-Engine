// ─── Lighting Manager ───────────────────────────────────────────────
// Centralized light creation, management, shadow configuration,
// and day/night cycle for the engine runtime.

import * as THREE from 'three';

export interface LightEntry {
  name: string;
  light: THREE.Light;
  type: 'directional' | 'point' | 'spot' | 'ambient' | 'hemisphere';
}

export interface DayNightConfig {
  /** Duration of full cycle in seconds */
  cycleDuration: number;
  /** Current time (0 = midnight, 0.5 = noon, 1 = midnight) */
  time: number;
  /** Sun color at noon */
  sunColor: THREE.Color;
  /** Ambient color at noon */
  noonAmbient: THREE.Color;
  /** Ambient color at night */
  nightAmbient: THREE.Color;
  /** Sun intensity at noon */
  maxSunIntensity: number;
  /** Moon intensity at night */
  moonIntensity: number;
}

export class LightingManager {
  private scene: THREE.Scene;
  private lights = new Map<string, LightEntry>();

  // Day/Night
  private dayNight: DayNightConfig | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
  private ambientLight: THREE.AmbientLight | null = null;

  // Shadow defaults — upgraded for Babylon.js-level quality
  private shadowMapSize = 4096;
  private shadowBias = -0.0001;
  private shadowNormalBias = 0.02;
  private shadowNear = 0.5;
  private shadowFar = 500;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // ── Light Creation ─────────────────────────────

  addDirectional(name: string, color = 0xffffff, intensity = 1, position?: THREE.Vector3): THREE.DirectionalLight {
    const light = new THREE.DirectionalLight(color, intensity);
    if (position) light.position.copy(position);
    else light.position.set(5, 10, 7);
    this.setupShadow(light);
    this.register(name, light, 'directional');
    return light;
  }

  addPoint(name: string, color = 0xffffff, intensity = 1, distance = 10, position?: THREE.Vector3): THREE.PointLight {
    const light = new THREE.PointLight(color, intensity, distance);
    if (position) light.position.copy(position);
    light.castShadow = true;
    light.shadow.mapSize.setScalar(this.shadowMapSize / 2);
    this.register(name, light, 'point');
    return light;
  }

  addSpot(name: string, color = 0xffffff, intensity = 1, angle = Math.PI / 6, penumbra = 0.3, position?: THREE.Vector3): THREE.SpotLight {
    const light = new THREE.SpotLight(color, intensity, 0, angle, penumbra);
    if (position) light.position.copy(position);
    else light.position.set(0, 5, 0);
    light.castShadow = true;
    light.shadow.mapSize.setScalar(this.shadowMapSize);
    light.shadow.bias = this.shadowBias;
    this.register(name, light, 'spot');
    return light;
  }

  addAmbient(name: string, color = 0x404040, intensity = 0.5): THREE.AmbientLight {
    const light = new THREE.AmbientLight(color, intensity);
    this.register(name, light, 'ambient');
    return light;
  }

  addHemisphere(name: string, skyColor = 0x87ceeb, groundColor = 0x362907, intensity = 0.6): THREE.HemisphereLight {
    const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
    this.register(name, light, 'hemisphere');
    return light;
  }

  // ── Queries ────────────────────────────────────

  get(name: string): LightEntry | undefined { return this.lights.get(name); }
  getLight(name: string): THREE.Light | undefined { return this.lights.get(name)?.light; }
  getAll(): LightEntry[] { return [...this.lights.values()]; }

  remove(name: string): void {
    const entry = this.lights.get(name);
    if (entry) {
      entry.light.removeFromParent();
      this.lights.delete(name);
    }
  }

  setIntensity(name: string, intensity: number): void {
    const entry = this.lights.get(name);
    if (entry) entry.light.intensity = intensity;
  }

  setColor(name: string, color: THREE.ColorRepresentation): void {
    const entry = this.lights.get(name);
    if (entry) entry.light.color.set(color);
  }

  // ── Shadow Configuration ───────────────────────

  configureShadows(mapSize: number, bias: number, near: number, far: number): void {
    this.shadowMapSize = mapSize;
    this.shadowBias = bias;
    this.shadowNear = near;
    this.shadowFar = far;

    // Apply to existing directional/spot lights
    for (const entry of this.lights.values()) {
      if (entry.type === 'directional' || entry.type === 'spot') {
        this.setupShadow(entry.light as THREE.DirectionalLight | THREE.SpotLight);
      }
    }
  }

  private setupShadow(light: THREE.DirectionalLight | THREE.SpotLight): void {
    light.castShadow = true;
    light.shadow.mapSize.setScalar(this.shadowMapSize);
    light.shadow.bias = this.shadowBias;
    light.shadow.normalBias = this.shadowNormalBias;
    light.shadow.camera.near = this.shadowNear;
    light.shadow.camera.far = this.shadowFar;
    if (light instanceof THREE.DirectionalLight) {
      const cam = light.shadow.camera;
      // Much wider frustum (Babylon.js uses ±100 for main sun)
      cam.left = -80;
      cam.right = 80;
      cam.top = 80;
      cam.bottom = -80;
    }
  }

  // ── Day/Night Cycle ────────────────────────────

  enableDayNight(config?: Partial<DayNightConfig>): void {
    this.dayNight = {
      cycleDuration: config?.cycleDuration ?? 120,
      time: config?.time ?? 0.25,
      sunColor: config?.sunColor ?? new THREE.Color(0xffeedd),
      noonAmbient: config?.noonAmbient ?? new THREE.Color(0x6688aa),
      nightAmbient: config?.nightAmbient ?? new THREE.Color(0x111122),
      maxSunIntensity: config?.maxSunIntensity ?? 1.5,
      moonIntensity: config?.moonIntensity ?? 0.15,
    };

    // Create sun and ambient if not existing
    if (!this.sunLight) {
      this.sunLight = this.addDirectional('__sun', 0xffffff, 1, new THREE.Vector3(10, 20, 10));
    }
    if (!this.ambientLight) {
      this.ambientLight = this.addAmbient('__ambient', 0x404040, 0.5);
    }
  }

  disableDayNight(): void {
    this.dayNight = null;
  }

  setTimeOfDay(t: number): void {
    if (this.dayNight) this.dayNight.time = t % 1;
  }

  getTimeOfDay(): number {
    return this.dayNight?.time ?? 0;
  }

  /** Call once per frame */
  update(dt: number): void {
    if (!this.dayNight || !this.sunLight || !this.ambientLight) return;

    const dn = this.dayNight;
    dn.time = (dn.time + dt / dn.cycleDuration) % 1;

    // Sun angle: at time=0.25 sun rises, 0.5 = noon, 0.75 = sunset
    const sunAngle = (dn.time - 0.25) * Math.PI * 2;
    const sunY = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle);

    this.sunLight.position.set(sunX * 20, Math.max(sunY * 20, -5), 10);

    // Sun intensity based on height
    const dayFactor = Math.max(0, sunY);
    this.sunLight.intensity = dayFactor * dn.maxSunIntensity;

    // Color: warmer at sunrise/sunset
    const horizonFactor = 1 - Math.abs(sunY);
    const sunsetColor = new THREE.Color(0xff6633);
    this.sunLight.color.copy(dn.sunColor).lerp(sunsetColor, horizonFactor * 0.5);

    // Ambient interpolation day/night
    this.ambientLight.color.copy(dn.nightAmbient).lerp(dn.noonAmbient, dayFactor);
    this.ambientLight.intensity = 0.3 + dayFactor * 0.4;

    // Moon at night
    if (sunY < 0) {
      this.sunLight.intensity = dn.moonIntensity;
      this.sunLight.color.set(0x8899bb);
    }
  }

  // ── Presets ────────────────────────────────────

  /** Quick setup for outdoor scenes */
  setupOutdoor(): void {
    this.addDirectional('sun', 0xffeedd, 1.2, new THREE.Vector3(10, 20, 5));
    this.addHemisphere('sky', 0x87ceeb, 0x362907, 0.5);
    this.addAmbient('fill', 0x404050, 0.3);
  }

  /** Quick setup for indoor scenes */
  setupIndoor(): void {
    this.addAmbient('room', 0x505060, 0.6);
    this.addPoint('ceiling', 0xfff5e0, 1.0, 15, new THREE.Vector3(0, 3, 0));
  }

  /** Quick setup for studio / product visualization */
  setupStudio(): void {
    this.addDirectional('key', 0xffffff, 1.0, new THREE.Vector3(5, 8, 5));
    this.addDirectional('fill', 0x8899bb, 0.4, new THREE.Vector3(-5, 5, -3));
    this.addAmbient('base', 0x303040, 0.3);
  }

  // ── Internal ───────────────────────────────────

  private register(name: string, light: THREE.Light, type: LightEntry['type']): void {
    this.remove(name); // remove existing with same name
    this.lights.set(name, { name, light, type });
    this.scene.add(light);
  }

  dispose(): void {
    for (const entry of this.lights.values()) {
      // Free shadow map render targets from VRAM before removing
      if ('shadow' in entry.light) {
        (entry.light as THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight).shadow?.map?.dispose();
      }
      entry.light.removeFromParent();
    }
    this.lights.clear();
    this.sunLight = null;
    this.ambientLight = null;
    this.dayNight = null;
  }
}
