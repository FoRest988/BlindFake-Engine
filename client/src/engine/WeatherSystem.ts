/**
 * WeatherSystem — Dynamic weather and day/night cycle.
 * Includes rain, snow, fog, wind, clouds, skybox transitions,
 * and a time-of-day system with sun position and lighting changes.
 */

import * as THREE from 'three';

// ── Types ─────────────────────────────────────────────────────────

export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'heavyRain' | 'snow' | 'fog' | 'storm';

export interface WeatherZone {
  id: string;
  name: string;
  weatherType: WeatherType;
  /** Box center position */
  position: THREE.Vector3;
  /** Half-extents of the zone box */
  size: THREE.Vector3;
  /** Priority when overlapping (higher wins) */
  priority: number;
  /** Blend distance at zone edges (metres) */
  blendDistance: number;
  /** Intensity override (0-1) */
  intensity: number;
  /** Debug wireframe helper */
  _helper?: THREE.LineSegments;
}

export interface WeatherConfig {
  type: WeatherType;
  /** Fog density (0 = none, 1 = thick) */
  fogDensity: number;
  fogColor: THREE.Color;
  /** Particle intensity (0-1, maps to particle count/emission rate) */
  particleIntensity: number;
  /** Wind direction and strength */
  windDirection: THREE.Vector3;
  windStrength: number;
  /** Cloud coverage (0-1) */
  cloudCoverage: number;
  /** Ambient light multiplier */
  ambientMultiplier: number;
  /** Sun intensity multiplier */
  sunMultiplier: number;
  /** Transition duration to this weather (seconds) */
  transitionTime: number;
}

// ── Weather Presets ───────────────────────────────────────────────

export const WeatherPresets: Record<WeatherType, WeatherConfig> = {
  clear: {
    type: 'clear',
    fogDensity: 0,
    fogColor: new THREE.Color(0x87ceeb),
    particleIntensity: 0,
    windDirection: new THREE.Vector3(1, 0, 0),
    windStrength: 0.1,
    cloudCoverage: 0.1,
    ambientMultiplier: 1.0,
    sunMultiplier: 1.0,
    transitionTime: 5,
  },
  cloudy: {
    type: 'cloudy',
    fogDensity: 0.1,
    fogColor: new THREE.Color(0x8899aa),
    particleIntensity: 0,
    windDirection: new THREE.Vector3(1, 0, 0.3),
    windStrength: 0.3,
    cloudCoverage: 0.7,
    ambientMultiplier: 0.7,
    sunMultiplier: 0.5,
    transitionTime: 8,
  },
  rain: {
    type: 'rain',
    fogDensity: 0.15,
    fogColor: new THREE.Color(0x667788),
    particleIntensity: 0.5,
    windDirection: new THREE.Vector3(0.5, 0, 0.2),
    windStrength: 0.5,
    cloudCoverage: 0.85,
    ambientMultiplier: 0.5,
    sunMultiplier: 0.3,
    transitionTime: 6,
  },
  heavyRain: {
    type: 'heavyRain',
    fogDensity: 0.3,
    fogColor: new THREE.Color(0x556677),
    particleIntensity: 1.0,
    windDirection: new THREE.Vector3(0.8, 0, 0.4),
    windStrength: 0.8,
    cloudCoverage: 0.95,
    ambientMultiplier: 0.35,
    sunMultiplier: 0.15,
    transitionTime: 4,
  },
  snow: {
    type: 'snow',
    fogDensity: 0.2,
    fogColor: new THREE.Color(0xccccdd),
    particleIntensity: 0.6,
    windDirection: new THREE.Vector3(0.3, 0, 0.1),
    windStrength: 0.2,
    cloudCoverage: 0.8,
    ambientMultiplier: 0.8,
    sunMultiplier: 0.6,
    transitionTime: 10,
  },
  fog: {
    type: 'fog',
    fogDensity: 0.5,
    fogColor: new THREE.Color(0x999999),
    particleIntensity: 0,
    windDirection: new THREE.Vector3(0.1, 0, 0),
    windStrength: 0.05,
    cloudCoverage: 1.0,
    ambientMultiplier: 0.6,
    sunMultiplier: 0.2,
    transitionTime: 8,
  },
  storm: {
    type: 'storm',
    fogDensity: 0.25,
    fogColor: new THREE.Color(0x334455),
    particleIntensity: 0.9,
    windDirection: new THREE.Vector3(1.0, 0, 0.5),
    windStrength: 1.0,
    cloudCoverage: 1.0,
    ambientMultiplier: 0.25,
    sunMultiplier: 0.1,
    transitionTime: 3,
  },
};

// ── Day/Night Cycle ───────────────────────────────────────────────

export interface DayNightConfig {
  /** Duration of a full day in real seconds */
  dayDuration: number;
  /** Start time (0-24) */
  startHour: number;
  /** Sun color at different times */
  sunColors: { hour: number; color: THREE.Color; intensity: number }[];
  /** Ambient color at different times */
  ambientColors: { hour: number; color: THREE.Color; intensity: number }[];
  /** Sky colors for top/bottom gradient */
  skyColors: { hour: number; top: THREE.Color; bottom: THREE.Color }[];
}

const DEFAULT_DAY_NIGHT: DayNightConfig = {
  dayDuration: 600, // 10 min real = 24h game
  startHour: 8,
  sunColors: [
    { hour: 5, color: new THREE.Color(0xff6633), intensity: 0.2 },
    { hour: 7, color: new THREE.Color(0xffaa55), intensity: 0.7 },
    { hour: 12, color: new THREE.Color(0xffffff), intensity: 1.0 },
    { hour: 17, color: new THREE.Color(0xffaa55), intensity: 0.7 },
    { hour: 19, color: new THREE.Color(0xff4400), intensity: 0.3 },
    { hour: 21, color: new THREE.Color(0x112244), intensity: 0.05 },
    { hour: 4, color: new THREE.Color(0x112244), intensity: 0.05 },
  ],
  ambientColors: [
    { hour: 5, color: new THREE.Color(0x111122), intensity: 0.15 },
    { hour: 7, color: new THREE.Color(0x445566), intensity: 0.4 },
    { hour: 12, color: new THREE.Color(0x667788), intensity: 0.6 },
    { hour: 17, color: new THREE.Color(0x556677), intensity: 0.5 },
    { hour: 19, color: new THREE.Color(0x332244), intensity: 0.25 },
    { hour: 21, color: new THREE.Color(0x0a0a1a), intensity: 0.1 },
    { hour: 4, color: new THREE.Color(0x0a0a1a), intensity: 0.1 },
  ],
  skyColors: [
    { hour: 5, top: new THREE.Color(0x111133), bottom: new THREE.Color(0xff6633) },
    { hour: 7, top: new THREE.Color(0x4488cc), bottom: new THREE.Color(0xffcc88) },
    { hour: 12, top: new THREE.Color(0x3388dd), bottom: new THREE.Color(0x88ccff) },
    { hour: 17, top: new THREE.Color(0x4477bb), bottom: new THREE.Color(0xffaa66) },
    { hour: 19, top: new THREE.Color(0x222255), bottom: new THREE.Color(0xff4400) },
    { hour: 21, top: new THREE.Color(0x050515), bottom: new THREE.Color(0x111122) },
    { hour: 4, top: new THREE.Color(0x050515), bottom: new THREE.Color(0x111122) },
  ],
};

// ── Weather System ────────────────────────────────────────────────

export class WeatherSystem {
  public scene: THREE.Scene | null = null;

  // Current weather state (interpolated)
  private current: WeatherConfig;
  private target: WeatherConfig;
  private transitionProgress = 1; // 1 = fully transitioned
  private transitionDuration = 0;

  // Precipitation particles
  private rainParticles: THREE.Points | null = null;
  private snowParticles: THREE.Points | null = null;
  private particleCount = 5000;
  private rainVelocities: Float32Array | null = null;
  private snowVelocities: Float32Array | null = null;

  // Day/Night
  public dayNightEnabled = false;
  public dayNightConfig: DayNightConfig = DEFAULT_DAY_NIGHT;
  private timeOfDay = 8; // 0-24 hours
  private sunLight: THREE.DirectionalLight | null = null;
  private ambientLight: THREE.AmbientLight | null = null;

  // Lightning
  private lightningTimer = 0;
  private lightningFlash: THREE.PointLight | null = null;

  // Wind affects particles and can be read by other systems
  public wind = new THREE.Vector3();

  // Follow camera position for particles
  private cameraRef: THREE.Camera | null = null;

  // Weather zones
  private zones: WeatherZone[] = [];
  private showZoneHelpers = false;

  constructor() {
    this.current = { ...WeatherPresets.clear };
    this.target = { ...WeatherPresets.clear };
  }

  init(scene: THREE.Scene, camera: THREE.Camera): void {
    this.scene = scene;
    this.cameraRef = camera;
    this.initRainParticles();
    this.initSnowParticles();
    this.initLightning();
  }

  /** Set the current weather (transitions smoothly) */
  setWeather(type: WeatherType, transitionTime?: number): void {
    const preset = WeatherPresets[type];
    this.target = { ...preset };
    this.transitionDuration = transitionTime ?? preset.transitionTime;
    this.transitionProgress = 0;
  }

  /** Set weather immediately (no transition) */
  setWeatherImmediate(type: WeatherType): void {
    this.current = { ...WeatherPresets[type] };
    this.target = { ...this.current };
    this.transitionProgress = 1;
    this.applyWeather();
  }

  /** Get current time of day (0-24) */
  getTimeOfDay(): number {
    return this.timeOfDay;
  }

  /** Set time of day manually */
  setTimeOfDay(hour: number): void {
    this.timeOfDay = ((hour % 24) + 24) % 24;
  }

  /** Attach sun/ambient lights for day/night cycle control */
  setLights(sun: THREE.DirectionalLight, ambient: THREE.AmbientLight): void {
    this.sunLight = sun;
    this.ambientLight = ambient;
  }

  update(delta: number): void {
    // Weather transition
    if (this.transitionProgress < 1) {
      this.transitionProgress = Math.min(1, this.transitionProgress + delta / this.transitionDuration);
      this.lerpWeather(this.transitionProgress);
    }

    // Day/Night cycle
    if (this.dayNightEnabled) {
      const hoursPerSecond = 24 / this.dayNightConfig.dayDuration;
      this.timeOfDay = (this.timeOfDay + hoursPerSecond * delta) % 24;
      this.updateDayNight();
    }

    // Update wind
    this.wind.copy(this.current.windDirection).multiplyScalar(this.current.windStrength);

    // Update particles
    this.updateRain(delta);
    this.updateSnow(delta);

    // Update fog
    this.updateFog();

    // Lightning during storms
    if (this.current.type === 'storm' || this.target.type === 'storm') {
      this.updateLightning(delta);
    }

    // Zone-based weather
    this.updateZoneWeather();
  }

  // ── Particle Systems ──────────────────────────────────

  private initRainParticles(): void {
    if (!this.scene) return;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    this.rainVelocities = new Float32Array(this.particleCount);

    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
      this.rainVelocities[i] = 15 + Math.random() * 10;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xaaccff,
      size: 0.1,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.rainParticles = new THREE.Points(geometry, material);
    this.rainParticles.visible = false;
    this.rainParticles.frustumCulled = false;
    this.scene.add(this.rainParticles);
  }

  private initSnowParticles(): void {
    if (!this.scene) return;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.particleCount * 3);
    this.snowVelocities = new Float32Array(this.particleCount);

    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 1] = Math.random() * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
      this.snowVelocities[i] = 1 + Math.random() * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.2,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });

    this.snowParticles = new THREE.Points(geometry, material);
    this.snowParticles.visible = false;
    this.snowParticles.frustumCulled = false;
    this.scene.add(this.snowParticles);
  }

  private updateRain(delta: number): void {
    if (!this.rainParticles || !this.rainVelocities) return;

    const isRaining = this.current.type === 'rain' || this.current.type === 'heavyRain' || this.current.type === 'storm';
    this.rainParticles.visible = isRaining && this.current.particleIntensity > 0;

    if (!this.rainParticles.visible) return;

    // Follow camera
    if (this.cameraRef) {
      this.rainParticles.position.x = this.cameraRef.position.x;
      this.rainParticles.position.z = this.cameraRef.position.z;
    }

    const positions = this.rainParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const activeCount = Math.floor(this.particleCount * this.current.particleIntensity);

    for (let i = 0; i < this.particleCount; i++) {
      if (i >= activeCount) {
        positions.setY(i, -100); // hide inactive
        continue;
      }
      let y = positions.getY(i);
      y -= this.rainVelocities[i] * delta;

      // Wind drift
      let x = positions.getX(i) + this.wind.x * delta * 3;
      let z = positions.getZ(i) + this.wind.z * delta * 3;

      if (y < -2) {
        y = 30 + Math.random() * 10;
        x = (Math.random() - 0.5) * 80;
        z = (Math.random() - 0.5) * 80;
      }

      positions.setXYZ(i, x, y, z);
    }
    positions.needsUpdate = true;
  }

  private updateSnow(delta: number): void {
    if (!this.snowParticles || !this.snowVelocities) return;

    const isSnowing = this.current.type === 'snow';
    this.snowParticles.visible = isSnowing && this.current.particleIntensity > 0;

    if (!this.snowParticles.visible) return;

    if (this.cameraRef) {
      this.snowParticles.position.x = this.cameraRef.position.x;
      this.snowParticles.position.z = this.cameraRef.position.z;
    }

    const positions = this.snowParticles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const activeCount = Math.floor(this.particleCount * this.current.particleIntensity);
    const time = performance.now() * 0.001;

    for (let i = 0; i < this.particleCount; i++) {
      if (i >= activeCount) {
        positions.setY(i, -100);
        continue;
      }
      let y = positions.getY(i);
      y -= this.snowVelocities[i] * delta;

      // Swaying motion
      let x = positions.getX(i) + Math.sin(time + i * 0.1) * 0.3 * delta + this.wind.x * delta;
      let z = positions.getZ(i) + Math.cos(time + i * 0.15) * 0.2 * delta + this.wind.z * delta;

      if (y < -1) {
        y = 25 + Math.random() * 5;
        x = (Math.random() - 0.5) * 80;
        z = (Math.random() - 0.5) * 80;
      }

      positions.setXYZ(i, x, y, z);
    }
    positions.needsUpdate = true;
  }

  // ── Fog ────────────────────────────────────────────────

  private updateFog(): void {
    if (!this.scene) return;

    if (this.current.fogDensity > 0.01) {
      if (!this.scene.fog || !(this.scene.fog instanceof THREE.FogExp2)) {
        this.scene.fog = new THREE.FogExp2(this.current.fogColor.getHex(), this.current.fogDensity * 0.02);
      }
      (this.scene.fog as THREE.FogExp2).density = this.current.fogDensity * 0.02;
      (this.scene.fog as THREE.FogExp2).color.copy(this.current.fogColor);
    } else {
      this.scene.fog = null;
    }
  }

  // ── Lightning ──────────────────────────────────────────

  private initLightning(): void {
    if (!this.scene) return;
    this.lightningFlash = new THREE.PointLight(0xccccff, 0, 200);
    this.lightningFlash.position.set(0, 50, 0);
    this.scene.add(this.lightningFlash);
  }

  private updateLightning(delta: number): void {
    if (!this.lightningFlash) return;

    this.lightningTimer -= delta;
    if (this.lightningTimer <= 0) {
      // Random lightning flash
      this.lightningFlash.intensity = 3 + Math.random() * 5;
      this.lightningFlash.position.set(
        (Math.random() - 0.5) * 100,
        30 + Math.random() * 20,
        (Math.random() - 0.5) * 100
      );
      this.lightningTimer = 3 + Math.random() * 10;

      // Quick fade
      setTimeout(() => {
        if (this.lightningFlash) this.lightningFlash.intensity = 0;
      }, 100 + Math.random() * 100);
    }
  }

  // ── Day/Night Cycle ────────────────────────────────────

  private updateDayNight(): void {
    const hour = this.timeOfDay;
    const config = this.dayNightConfig;

    // Sun position (arc across sky)
    if (this.sunLight) {
      const sunAngle = ((hour - 6) / 12) * Math.PI; // 6AM = horizon, 12PM = zenith, 6PM = horizon
      const sunHeight = Math.sin(sunAngle);
      const sunForward = Math.cos(sunAngle);
      this.sunLight.position.set(sunForward * 50, Math.max(0.5, sunHeight * 50), 20);

      // Interpolate sun color/intensity
      const sunData = this.lerpKeyframes(config.sunColors, hour);
      this.sunLight.color.copy(sunData.color);
      this.sunLight.intensity = sunData.intensity * this.current.sunMultiplier;
    }

    // Ambient light
    if (this.ambientLight) {
      const ambData = this.lerpKeyframes(config.ambientColors, hour);
      this.ambientLight.color.copy(ambData.color);
      this.ambientLight.intensity = ambData.intensity * this.current.ambientMultiplier;
    }

    // Sky/background color
    if (this.scene) {
      const skyData = this.lerpSkyKeyframes(config.skyColors, hour);
      this.scene.background = skyData.top;
    }
  }

  private lerpKeyframes(
    keyframes: { hour: number; color: THREE.Color; intensity: number }[],
    hour: number
  ): { color: THREE.Color; intensity: number } {
    if (keyframes.length === 0) return { color: new THREE.Color(1, 1, 1), intensity: 1 };

    const sorted = [...keyframes].sort((a, b) => a.hour - b.hour);
    let prev = sorted[sorted.length - 1];
    let next = sorted[0];

    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].hour > hour) {
        next = sorted[i];
        prev = sorted[(i - 1 + sorted.length) % sorted.length];
        break;
      }
      prev = sorted[i];
      next = sorted[(i + 1) % sorted.length];
    }

    let range = next.hour - prev.hour;
    if (range <= 0) range += 24;
    let progress = hour - prev.hour;
    if (progress < 0) progress += 24;
    const t = range > 0 ? progress / range : 0;

    return {
      color: prev.color.clone().lerp(next.color, t),
      intensity: THREE.MathUtils.lerp(prev.intensity, next.intensity, t),
    };
  }

  private lerpSkyKeyframes(
    keyframes: { hour: number; top: THREE.Color; bottom: THREE.Color }[],
    hour: number
  ): { top: THREE.Color; bottom: THREE.Color } {
    if (keyframes.length === 0) return { top: new THREE.Color(0x87ceeb), bottom: new THREE.Color(0xffffff) };

    const sorted = [...keyframes].sort((a, b) => a.hour - b.hour);
    let prev = sorted[sorted.length - 1];
    let next = sorted[0];

    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].hour > hour) {
        next = sorted[i];
        prev = sorted[(i - 1 + sorted.length) % sorted.length];
        break;
      }
      prev = sorted[i];
      next = sorted[(i + 1) % sorted.length];
    }

    let range = next.hour - prev.hour;
    if (range <= 0) range += 24;
    let progress = hour - prev.hour;
    if (progress < 0) progress += 24;
    const t = range > 0 ? progress / range : 0;

    return {
      top: prev.top.clone().lerp(next.top, t),
      bottom: prev.bottom.clone().lerp(next.bottom, t),
    };
  }

  // ── Weather Interpolation ──────────────────────────────

  private lerpWeather(t: number): void {
    const c = this.current;
    const tgt = this.target;

    c.fogDensity = THREE.MathUtils.lerp(c.fogDensity, tgt.fogDensity, t);
    c.fogColor.lerp(tgt.fogColor, t);
    c.particleIntensity = THREE.MathUtils.lerp(c.particleIntensity, tgt.particleIntensity, t);
    c.windStrength = THREE.MathUtils.lerp(c.windStrength, tgt.windStrength, t);
    c.windDirection.lerp(tgt.windDirection, t);
    c.cloudCoverage = THREE.MathUtils.lerp(c.cloudCoverage, tgt.cloudCoverage, t);
    c.ambientMultiplier = THREE.MathUtils.lerp(c.ambientMultiplier, tgt.ambientMultiplier, t);
    c.sunMultiplier = THREE.MathUtils.lerp(c.sunMultiplier, tgt.sunMultiplier, t);

    if (t >= 1) {
      c.type = tgt.type;
    }

    this.applyWeather();
  }

  private applyWeather(): void {
    this.updateFog();
  }

  /** Get current interpolated weather config */
  getCurrent(): Readonly<WeatherConfig> {
    return this.current;
  }

  // ── Weather Zones ──────────────────────────────────────

  /** Add a weather zone */
  addZone(zone: Omit<WeatherZone, '_helper'>): WeatherZone {
    const z: WeatherZone = { ...zone };
    this.zones.push(z);
    if (this.showZoneHelpers && this.scene) this.createZoneHelper(z);
    return z;
  }

  /** Remove a weather zone by id */
  removeZone(id: string): void {
    const idx = this.zones.findIndex(z => z.id === id);
    if (idx < 0) return;
    const z = this.zones[idx];
    if (z._helper) { z._helper.parent?.remove(z._helper); z._helper.geometry.dispose(); (z._helper.material as THREE.Material).dispose(); }
    this.zones.splice(idx, 1);
  }

  /** Get all zones */
  getZones(): WeatherZone[] {
    return this.zones;
  }

  /** Update a zone's properties */
  updateZone(id: string, partial: Partial<WeatherZone>): void {
    const z = this.zones.find(z2 => z2.id === id);
    if (!z) return;
    if (partial.name !== undefined) z.name = partial.name;
    if (partial.weatherType !== undefined) z.weatherType = partial.weatherType;
    if (partial.position) z.position.copy(partial.position);
    if (partial.size) z.size.copy(partial.size);
    if (partial.priority !== undefined) z.priority = partial.priority;
    if (partial.blendDistance !== undefined) z.blendDistance = partial.blendDistance;
    if (partial.intensity !== undefined) z.intensity = partial.intensity;
    if (z._helper) this.updateZoneHelper(z);
  }

  /** Toggle debug wireframe helpers */
  setShowZoneHelpers(show: boolean): void {
    this.showZoneHelpers = show;
    for (const z of this.zones) {
      if (show && !z._helper && this.scene) {
        this.createZoneHelper(z);
      } else if (!show && z._helper) {
        z._helper.parent?.remove(z._helper);
        z._helper.geometry.dispose();
        (z._helper.material as THREE.Material).dispose();
        z._helper = undefined;
      }
    }
  }

  private createZoneHelper(z: WeatherZone): void {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(geo);
    const colorMap: Record<WeatherType, number> = {
      clear: 0xffff00, cloudy: 0x888888, rain: 0x4488ff,
      heavyRain: 0x2244aa, snow: 0xffffff, fog: 0x999999, storm: 0x8800ff,
    };
    const mat = new THREE.LineBasicMaterial({ color: colorMap[z.weatherType] ?? 0xff00ff, transparent: true, opacity: 0.6 });
    z._helper = new THREE.LineSegments(edges, mat);
    z._helper.position.copy(z.position);
    z._helper.scale.set(z.size.x * 2, z.size.y * 2, z.size.z * 2);
    z._helper.userData._weatherZoneHelper = true;
    this.scene?.add(z._helper);
    geo.dispose();
  }

  private updateZoneHelper(z: WeatherZone): void {
    if (!z._helper) return;
    z._helper.position.copy(z.position);
    z._helper.scale.set(z.size.x * 2, z.size.y * 2, z.size.z * 2);
    const colorMap: Record<WeatherType, number> = {
      clear: 0xffff00, cloudy: 0x888888, rain: 0x4488ff,
      heavyRain: 0x2244aa, snow: 0xffffff, fog: 0x999999, storm: 0x8800ff,
    };
    (z._helper.material as THREE.LineBasicMaterial).color.setHex(colorMap[z.weatherType] ?? 0xff00ff);
  }

  /** Evaluate zones at a given position and return the effective weather type + blend weight */
  evaluateZonesAt(pos: THREE.Vector3): { type: WeatherType; weight: number }[] {
    const results: { type: WeatherType; weight: number; priority: number }[] = [];
    for (const z of this.zones) {
      // Signed distances from zone box faces
      const dx = Math.max(0, Math.abs(pos.x - z.position.x) - z.size.x);
      const dy = Math.max(0, Math.abs(pos.y - z.position.y) - z.size.y);
      const dz = Math.max(0, Math.abs(pos.z - z.position.z) - z.size.z);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist > z.blendDistance) continue; // outside blend range

      const blend = z.blendDistance > 0 ? 1 - (dist / z.blendDistance) : 1;
      results.push({ type: z.weatherType, weight: blend * z.intensity, priority: z.priority });
    }
    // Sort by priority (highest first)
    results.sort((a, b) => b.priority - a.priority);
    return results;
  }

  /** Called each frame to apply zone-based weather at camera position */
  updateZoneWeather(): void {
    if (this.zones.length === 0 || !this.cameraRef) return;

    const camPos = this.cameraRef.position;
    const activeZones = this.evaluateZonesAt(camPos);

    if (activeZones.length > 0) {
      // Use highest-priority zone with strongest blend
      const top = activeZones[0];
      if (top.weight > 0.01) {
        const preset = WeatherPresets[top.type];
        // Blend towards zone's weather
        const t = Math.min(1, top.weight * 0.1); // smooth blend per frame
        this.current.fogDensity = THREE.MathUtils.lerp(this.current.fogDensity, preset.fogDensity, t);
        this.current.fogColor.lerp(preset.fogColor, t);
        this.current.particleIntensity = THREE.MathUtils.lerp(this.current.particleIntensity, preset.particleIntensity * top.weight, t);
        this.current.windStrength = THREE.MathUtils.lerp(this.current.windStrength, preset.windStrength, t);
        this.current.cloudCoverage = THREE.MathUtils.lerp(this.current.cloudCoverage, preset.cloudCoverage, t);
        this.current.ambientMultiplier = THREE.MathUtils.lerp(this.current.ambientMultiplier, preset.ambientMultiplier, t);
        this.current.sunMultiplier = THREE.MathUtils.lerp(this.current.sunMultiplier, preset.sunMultiplier, t);
        this.applyWeather();
      }
    }
  }

  dispose(): void {
    for (const z of this.zones) {
      if (z._helper) { z._helper.parent?.remove(z._helper); z._helper.geometry.dispose(); (z._helper.material as THREE.Material).dispose(); }
    }
    this.zones.length = 0;
    if (this.rainParticles) {
      this.rainParticles.geometry.dispose();
      (this.rainParticles.material as THREE.Material).dispose();
      this.rainParticles.parent?.remove(this.rainParticles);
    }
    if (this.snowParticles) {
      this.snowParticles.geometry.dispose();
      (this.snowParticles.material as THREE.Material).dispose();
      this.snowParticles.parent?.remove(this.snowParticles);
    }
    if (this.lightningFlash) {
      this.lightningFlash.parent?.remove(this.lightningFlash);
    }
    this.scene = null;
  }
}
