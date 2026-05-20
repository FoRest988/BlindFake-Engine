import * as THREE from 'three';

export interface ParticleEmitterConfig {
  maxParticles: number;
  emitRate: number;   // particles per second
  lifetime: [number, number]; // min/max lifetime
  speed: [number, number];
  direction: THREE.Vector3;
  spread: number;     // cone angle in radians
  size: [number, number]; // start size, end size
  color: THREE.Color;
  colorEnd?: THREE.Color;
  opacity: [number, number]; // start, end
  gravity?: THREE.Vector3;
  texture?: THREE.Texture;
  blending?: THREE.Blending;
  worldSpace?: boolean;
}

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  sizeEnd: number;
  active: boolean;
}

export class ParticleEmitter {
  public config: ParticleEmitterConfig;
  public position = new THREE.Vector3();
  public active = true;

  private particles: Particle[] = [];
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private points: THREE.Points;
  private emitAccumulator = 0;

  private positionArray: Float32Array;
  private sizeArray: Float32Array;
  private colorArray: Float32Array;

  constructor(config: ParticleEmitterConfig) {
    this.config = config;
    const max = config.maxParticles;

    // Pre-allocate particles
    for (let i = 0; i < max; i++) {
      this.particles.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 0,
        size: 0,
        sizeEnd: 0,
        active: false,
      });
    }

    // Buffers
    this.positionArray = new Float32Array(max * 3);
    this.sizeArray = new Float32Array(max);
    this.colorArray = new Float32Array(max * 4);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positionArray, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizeArray, 1));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colorArray, 4));

    this.material = new THREE.PointsMaterial({
      size: 1,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: config.blending ?? THREE.AdditiveBlending,
      map: config.texture ?? null,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  get object3D(): THREE.Points {
    return this.points;
  }

  update(delta: number): void {
    if (!this.active) return;

    // Emit new particles
    this.emitAccumulator += delta * this.config.emitRate;
    while (this.emitAccumulator >= 1) {
      this.emit();
      this.emitAccumulator--;
    }

    // Update particles
    const gravity = this.config.gravity ?? new THREE.Vector3(0, 0, 0);
    const colorStart = this.config.color;
    const colorEnd = this.config.colorEnd ?? colorStart;
    let visibleCount = 0;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.life -= delta;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }

      const t = 1 - p.life / p.maxLife; // 0 to 1

      // Physics
      p.velocity.x += gravity.x * delta;
      p.velocity.y += gravity.y * delta;
      p.velocity.z += gravity.z * delta;
      p.position.x += p.velocity.x * delta;
      p.position.y += p.velocity.y * delta;
      p.position.z += p.velocity.z * delta;

      // Write to buffers
      const idx3 = visibleCount * 3;
      const idx4 = visibleCount * 4;
      this.positionArray[idx3] = p.position.x;
      this.positionArray[idx3 + 1] = p.position.y;
      this.positionArray[idx3 + 2] = p.position.z;

      this.sizeArray[visibleCount] = THREE.MathUtils.lerp(p.size, p.sizeEnd, t);

      // Lerp color
      this.colorArray[idx4] = THREE.MathUtils.lerp(colorStart.r, colorEnd.r, t);
      this.colorArray[idx4 + 1] = THREE.MathUtils.lerp(colorStart.g, colorEnd.g, t);
      this.colorArray[idx4 + 2] = THREE.MathUtils.lerp(colorStart.b, colorEnd.b, t);
      this.colorArray[idx4 + 3] = THREE.MathUtils.lerp(
        this.config.opacity[0],
        this.config.opacity[1],
        t
      );

      visibleCount++;
    }

    // Update geometry
    this.geometry.setDrawRange(0, visibleCount);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private emit(): void {
    const p = this.particles.find((p) => !p.active);
    if (!p) return;

    p.active = true;
    p.maxLife = THREE.MathUtils.randFloat(this.config.lifetime[0], this.config.lifetime[1]);
    p.life = p.maxLife;
    p.size = this.config.size[0];
    p.sizeEnd = this.config.size[1];

    // Position at emitter
    p.position.copy(this.position);

    // Direction with spread
    const dir = this.config.direction.clone().normalize();
    const speed = THREE.MathUtils.randFloat(this.config.speed[0], this.config.speed[1]);

    // Apply random spread
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * this.config.spread;
    const sinPhi = Math.sin(phi);
    p.velocity.set(
      dir.x + sinPhi * Math.cos(theta),
      dir.y + sinPhi * Math.sin(theta),
      dir.z + sinPhi * Math.cos(theta + Math.PI / 3)
    );
    p.velocity.normalize().multiplyScalar(speed);
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class ParticleSystem {
  private emitters = new Map<string, ParticleEmitter>();

  createEmitter(name: string, config: ParticleEmitterConfig): ParticleEmitter {
    const emitter = new ParticleEmitter(config);
    this.emitters.set(name, emitter);
    return emitter;
  }

  getEmitter(name: string): ParticleEmitter | undefined {
    return this.emitters.get(name);
  }

  removeEmitter(name: string): void {
    const emitter = this.emitters.get(name);
    if (emitter) {
      emitter.dispose();
      this.emitters.delete(name);
    }
  }

  update(delta: number): void {
    for (const emitter of this.emitters.values()) {
      emitter.update(delta);
    }
  }

  dispose(): void {
    for (const emitter of this.emitters.values()) {
      emitter.dispose();
    }
    this.emitters.clear();
  }

  /** Preset: Fire particles */
  static firePreset(): ParticleEmitterConfig {
    return {
      maxParticles: 500,
      emitRate: 80,
      lifetime: [0.5, 1.5],
      speed: [2, 5],
      direction: new THREE.Vector3(0, 1, 0),
      spread: 0.4,
      size: [2, 0.1],
      color: new THREE.Color(1, 0.6, 0),
      colorEnd: new THREE.Color(1, 0, 0),
      opacity: [0.8, 0],
      gravity: new THREE.Vector3(0, 2, 0),
      blending: THREE.AdditiveBlending,
    };
  }

  /** Preset: Dust/Debris particles */
  static debrisPreset(): ParticleEmitterConfig {
    return {
      maxParticles: 200,
      emitRate: 30,
      lifetime: [1, 3],
      speed: [3, 8],
      direction: new THREE.Vector3(0, 1, 0),
      spread: 1.2,
      size: [0.5, 0.2],
      color: new THREE.Color(0.6, 0.5, 0.4),
      colorEnd: new THREE.Color(0.3, 0.3, 0.3),
      opacity: [0.6, 0],
      gravity: new THREE.Vector3(0, -10, 0),
      blending: THREE.NormalBlending,
    };
  }

  /** Preset: Magic/Energy particles */
  static magicPreset(): ParticleEmitterConfig {
    return {
      maxParticles: 300,
      emitRate: 50,
      lifetime: [0.8, 2],
      speed: [1, 3],
      direction: new THREE.Vector3(0, 1, 0),
      spread: Math.PI,
      size: [1, 0],
      color: new THREE.Color(0.3, 0.5, 1),
      colorEnd: new THREE.Color(0.8, 0.2, 1),
      opacity: [1, 0],
      gravity: new THREE.Vector3(0, 0.5, 0),
      blending: THREE.AdditiveBlending,
    };
  }
}
