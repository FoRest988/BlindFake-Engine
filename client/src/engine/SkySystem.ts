/**
 * SkySystem — Comprehensive skybox and environment management.
 * Features:
 * - Procedural sky (sun position, atmospheric scattering)
 * - HDRI environment maps
 * - Cubemap skybox (6 faces)
 * - Gradient sky (2-3 color)
 * - Day/night cycle with automatic sun movement
 * - Environment map for PBR reflections
 */

import * as THREE from 'three';

export type SkyMode = 'procedural' | 'hdri' | 'cubemap' | 'gradient' | 'color';

export interface ProceduralSkyConfig {
  turbidity: number;        // atmospheric haze 1-20
  rayleigh: number;         // scattering coefficient 0-4
  mieCoefficient: number;   // 0-0.1
  mieDirectionalG: number;  // 0-1
  sunElevation: number;     // degrees above horizon
  sunAzimuth: number;       // degrees around Y axis
  exposure: number;         // 0-2
}

export interface GradientSkyConfig {
  topColor: number;
  middleColor?: number;
  bottomColor: number;
}

export interface DayNightConfig {
  enabled: boolean;
  /** Speed multiplier (1 = 1 real second = 1 game minute) */
  speed: number;
  /** Current time of day in hours (0-24) */
  time: number;
  /** Sun color at different times */
  dawnColor: number;
  dayColor: number;
  duskColor: number;
  nightColor: number;
  /** Ambient light intensity: [night, day] */
  ambientRange: [number, number];
}

const DEFAULT_PROCEDURAL: ProceduralSkyConfig = {
  turbidity: 10,
  rayleigh: 2,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
  sunElevation: 45,
  sunAzimuth: 180,
  exposure: 0.5,
};

const DEFAULT_DAYNIGHT: DayNightConfig = {
  enabled: false,
  speed: 1,
  time: 12,
  dawnColor: 0xff7733,
  dayColor: 0xffffff,
  duskColor: 0xff4500,
  nightColor: 0x1a1a3a,
  ambientRange: [0.05, 0.4],
};

export class SkySystem {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private mode: SkyMode = 'color';
  private proceduralConfig: ProceduralSkyConfig;
  private dayNight: DayNightConfig;

  // Sky objects
  private skyMesh: THREE.Mesh | null = null;
  private sunLight: THREE.DirectionalLight | null = null;
  private ambientLight: THREE.AmbientLight | null = null;
  private pmremGenerator: THREE.PMREMGenerator;

  // Current environment map
  private envMap: THREE.Texture | null = null;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.proceduralConfig = { ...DEFAULT_PROCEDURAL };
    this.dayNight = { ...DEFAULT_DAYNIGHT };
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);
    this.pmremGenerator.compileEquirectangularShader();
  }

  // ─── Mode Setters ──────────────────────────────

  setColorBackground(color: number): void {
    this.clearSky();
    this.mode = 'color';
    this.scene.background = new THREE.Color(color);
  }

  setGradientSky(config: GradientSkyConfig): void {
    this.clearSky();
    this.mode = 'gradient';

    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#' + new THREE.Color(config.topColor).getHexString());
    if (config.middleColor !== undefined) {
      gradient.addColorStop(0.5, '#' + new THREE.Color(config.middleColor).getHexString());
    }
    gradient.addColorStop(1, '#' + new THREE.Color(config.bottomColor).getHexString());

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;

    // Create a sky dome using the gradient
    const geo = new THREE.SphereGeometry(500, 32, 16);
    const mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false });
    this.skyMesh = new THREE.Mesh(geo, mat);
    this.skyMesh.name = '__sky_gradient';
    this.skyMesh.renderOrder = -1;
    this.scene.add(this.skyMesh);
  }

  setProceduralSky(config?: Partial<ProceduralSkyConfig>): void {
    this.clearSky();
    this.mode = 'procedural';
    if (config) Object.assign(this.proceduralConfig, config);

    // Create a procedural sky dome using vertex colors for atmospheric scattering
    const geo = new THREE.SphereGeometry(1000, 64, 32);
    const colors = new Float32Array(geo.attributes.position.count * 3);

    this.computeAtmosphericColors(geo, colors);

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
    });

    this.skyMesh = new THREE.Mesh(geo, mat);
    this.skyMesh.name = '__sky_procedural';
    this.skyMesh.renderOrder = -1;
    this.scene.add(this.skyMesh);

    // Update sun position
    this.updateSunPosition();
    this.generatePMREM();
  }

  setHDRI(texture: THREE.Texture): void {
    this.clearSky();
    this.mode = 'hdri';

    // Generate environment map from HDRI
    const envMap = this.pmremGenerator.fromEquirectangular(texture).texture;
    this.envMap = envMap;
    this.scene.background = texture;
    this.scene.environment = envMap;

    texture.mapping = THREE.EquirectangularReflectionMapping;
  }

  setCubemap(textures: THREE.CubeTexture): void {
    this.clearSky();
    this.mode = 'cubemap';

    this.scene.background = textures;
    const envMap = this.pmremGenerator.fromCubemap(textures).texture;
    this.envMap = envMap;
    this.scene.environment = envMap;
  }

  // ─── Procedural Sky Internals ──────────────────

  private computeAtmosphericColors(geo: THREE.SphereGeometry, colors: Float32Array): void {
    const cfg = this.proceduralConfig;
    const sunDir = new THREE.Vector3();
    const elevRad = THREE.MathUtils.degToRad(cfg.sunElevation);
    const aziRad = THREE.MathUtils.degToRad(cfg.sunAzimuth);
    sunDir.set(
      Math.cos(elevRad) * Math.sin(aziRad),
      Math.sin(elevRad),
      Math.cos(elevRad) * Math.cos(aziRad),
    ).normalize();

    const pos = new THREE.Vector3();
    const sunColor = new THREE.Color(0xffee88);
    const nightColor = new THREE.Color(0x0a0a2a);

    for (let i = 0; i < geo.attributes.position.count; i++) {
      pos.fromBufferAttribute(geo.attributes.position, i).normalize();

      // Height-based gradient
      const height = pos.y;
      const sunDot = Math.max(0, pos.dot(sunDir));

      // Rayleigh scattering (blue for zenith, warm near horizon)
      const rayleigh = cfg.rayleigh * Math.max(0, height);
      const r = 0.1 + 0.3 * (1 - rayleigh) + sunDot * 0.4;
      const g = 0.2 + 0.3 * rayleigh + sunDot * 0.3;
      const b = 0.4 + 0.5 * rayleigh + sunDot * 0.1;

      // Mie scattering (sun glow)
      const mie = Math.pow(sunDot, 32) * cfg.mieCoefficient * 100;

      // Horizon haze from turbidity
      const haze = Math.exp(-Math.abs(height) * cfg.turbidity * 0.5);

      // Sunrise/sunset color at horizon
      const horizonFactor = Math.exp(-height * height * 10);
      const horizonR = sunColor.r * horizonFactor * 0.5;
      const horizonG = sunColor.g * horizonFactor * 0.3;
      const horizonB = sunColor.b * horizonFactor * 0.1;

      // Night sky blend based on sun elevation
      const nightFactor = Math.max(0, 1 - cfg.sunElevation / 15);

      const finalR = THREE.MathUtils.lerp(r + mie + horizonR + haze * 0.2, nightColor.r, nightFactor);
      const finalG = THREE.MathUtils.lerp(g + mie * 0.5 + horizonG + haze * 0.1, nightColor.g, nightFactor);
      const finalB = THREE.MathUtils.lerp(b + mie * 0.2 + horizonB, nightColor.b, nightFactor);

      const exposure = cfg.exposure;
      colors[i * 3] = Math.min(1, finalR * exposure);
      colors[i * 3 + 1] = Math.min(1, finalG * exposure);
      colors[i * 3 + 2] = Math.min(1, finalB * exposure);
    }
  }

  private updateSunPosition(): void {
    const cfg = this.proceduralConfig;
    const elevRad = THREE.MathUtils.degToRad(cfg.sunElevation);
    const aziRad = THREE.MathUtils.degToRad(cfg.sunAzimuth);
    const dist = 200;

    const sunPos = new THREE.Vector3(
      Math.cos(elevRad) * Math.sin(aziRad) * dist,
      Math.sin(elevRad) * dist,
      Math.cos(elevRad) * Math.cos(aziRad) * dist,
    );

    if (!this.sunLight) {
      this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
      this.sunLight.name = '__sky_sun';
      this.sunLight.castShadow = true;
      // Babylon.js-quality shadow defaults
      this.sunLight.shadow.mapSize.set(4096, 4096);
      this.sunLight.shadow.bias = -0.0001;
      this.sunLight.shadow.normalBias = 0.02;
      this.sunLight.shadow.camera.far = 500;
      const s = 80;
      this.sunLight.shadow.camera.left = -s;
      this.sunLight.shadow.camera.right = s;
      this.sunLight.shadow.camera.top = s;
      this.sunLight.shadow.camera.bottom = -s;
      this.scene.add(this.sunLight);
    }

    if (!this.ambientLight) {
      this.ambientLight = new THREE.AmbientLight(0x404060, 0.3);
      this.ambientLight.name = '__sky_ambient';
      this.scene.add(this.ambientLight);
    }

    this.sunLight.position.copy(sunPos);
    this.sunLight.intensity = Math.max(0, Math.sin(elevRad)) * 1.5;

    // Sun color temperature based on elevation
    const t = cfg.sunElevation / 90;
    if (t > 0.1) {
      this.sunLight.color.set(0xffffff).lerp(new THREE.Color(0xffee88), 1 - t);
    } else {
      this.sunLight.color.set(0xff6633);
    }
  }

  private generatePMREM(): void {
    // For procedural sky, render to a cube texture for environment reflections
    if (this.skyMesh) {
      const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(512);
      const cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeRenderTarget);
      cubeCamera.position.set(0, 0, 0);
      cubeCamera.update(this.renderer, this.scene);

      this.envMap = this.pmremGenerator.fromCubemap(cubeRenderTarget.texture).texture;
      this.scene.environment = this.envMap;
      cubeRenderTarget.dispose();
    }
  }

  // ─── Day/Night Cycle ───────────────────────────

  configureDayNight(config: Partial<DayNightConfig>): void {
    Object.assign(this.dayNight, config);
  }

  setTimeOfDay(hours: number): void {
    this.dayNight.time = hours % 24;
    if (this.mode === 'procedural') {
      this.applyTimeOfDay();
    }
  }

  update(delta: number): void {
    if (!this.dayNight.enabled) return;

    // Advance time
    this.dayNight.time += (delta * this.dayNight.speed) / 60; // speed=1 means 1 real second = 1 game minute
    if (this.dayNight.time >= 24) this.dayNight.time -= 24;

    if (this.mode === 'procedural') {
      this.applyTimeOfDay();
    }
  }

  private applyTimeOfDay(): void {
    const t = this.dayNight.time;

    // Sun elevation: rises at 6, peaks at 12, sets at 18
    const sunAngle = ((t - 6) / 12) * 180; // 0° at sunrise, 180° at sunset
    const elevation = Math.sin(THREE.MathUtils.degToRad(Math.max(0, Math.min(180, sunAngle)))) * 80;

    this.proceduralConfig.sunElevation = elevation;
    this.proceduralConfig.sunAzimuth = 180 + (t - 12) * 15; // rotates

    // Adjust exposure based on time
    if (t >= 6 && t <= 18) {
      this.proceduralConfig.exposure = 0.5;
    } else {
      this.proceduralConfig.exposure = 0.15;
    }

    // Rebuild sky colors
    if (this.skyMesh) {
      const geo = this.skyMesh.geometry as THREE.SphereGeometry;
      const colorAttr = geo.getAttribute('color');
      if (colorAttr) {
        this.computeAtmosphericColors(geo, colorAttr.array as Float32Array);
        colorAttr.needsUpdate = true;
      }
    }

    this.updateSunPosition();

    // Ambient
    if (this.ambientLight) {
      const [nightAmbient, dayAmbient] = this.dayNight.ambientRange;
      const isDay = t >= 6 && t <= 18;
      this.ambientLight.intensity = isDay
        ? THREE.MathUtils.lerp(nightAmbient, dayAmbient, Math.sin(((t - 6) / 12) * Math.PI))
        : nightAmbient;
    }
  }

  // ─── Getters / Utility ─────────────────────────

  getMode(): SkyMode { return this.mode; }
  getProceduralConfig(): ProceduralSkyConfig { return { ...this.proceduralConfig }; }
  getDayNightConfig(): DayNightConfig { return { ...this.dayNight }; }
  getEnvironmentMap(): THREE.Texture | null { return this.envMap; }
  getSunLight(): THREE.DirectionalLight | null { return this.sunLight; }
  getTimeOfDay(): number { return this.dayNight.time; }

  private clearSky(): void {
    if (this.skyMesh) {
      this.scene.remove(this.skyMesh);
      this.skyMesh.geometry.dispose();
      (this.skyMesh.material as THREE.Material).dispose();
      this.skyMesh = null;
    }
    this.scene.background = null;
    this.scene.environment = null;
  }

  dispose(): void {
    this.clearSky();
    if (this.sunLight) this.scene.remove(this.sunLight);
    if (this.ambientLight) this.scene.remove(this.ambientLight);
    this.pmremGenerator.dispose();
    this.envMap?.dispose();
  }
}
