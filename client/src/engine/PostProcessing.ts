import * as THREE from 'three';

// ─── Post-Processing Pipeline ──────────────────────────────────────
// Composable full-screen post-processing effects.
// Uses multi-pass rendering via WebGLRenderTarget.

// ── Base Effect ────────────────────────────────────────────────────
export abstract class PostEffect {
  public enabled = true;
  abstract get name(): string;
  abstract render(
    renderer: THREE.WebGLRenderer,
    inputTarget: THREE.WebGLRenderTarget,
    outputTarget: THREE.WebGLRenderTarget | null,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): void;
  abstract dispose(): void;
  resize(_width: number, _height: number): void {}
}

// ── Post-Processing Manager ───────────────────────────────────────
export class PostProcessingManager {
  private renderer: THREE.WebGLRenderer;
  private effects: PostEffect[] = [];
  private renderTargetA: THREE.WebGLRenderTarget;
  private renderTargetB: THREE.WebGLRenderTarget;
  private fullscreenQuad: THREE.Mesh;
  private fullscreenScene: THREE.Scene;
  private fullscreenCamera: THREE.OrthographicCamera;
  public enabled = true;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const w = size.x || window.innerWidth;
    const h = size.y || window.innerHeight;

    const params: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    };
    this.renderTargetA = new THREE.WebGLRenderTarget(w, h, params);
    this.renderTargetB = new THREE.WebGLRenderTarget(w, h, params);

    // Full-screen quad
    this.fullscreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fullscreenScene = new THREE.Scene();
    const geo = new THREE.PlaneGeometry(2, 2);
    this.fullscreenQuad = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    this.fullscreenScene.add(this.fullscreenQuad);
  }

  /** Replace the renderer and recreate render targets for the new WebGL context. */
  setRenderer(renderer: THREE.WebGLRenderer): void {
    if (renderer === this.renderer) return;
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const w = Math.max(size.x, 1);
    const h = Math.max(size.y, 1);
    this.renderTargetA.dispose();
    this.renderTargetB.dispose();
    const params: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    };
    this.renderTargetA = new THREE.WebGLRenderTarget(w, h, params);
    this.renderTargetB = new THREE.WebGLRenderTarget(w, h, params);
    // Re-create effect internal targets for the new context
    for (const effect of this.effects) {
      try {
        effect.resize(w, h);
      } catch { /* skip */ }
    }
  }

  addEffect(effect: PostEffect): void {
    // Resize effect to match current render target dimensions
    const w = this.renderTargetA.width;
    const h = this.renderTargetA.height;
    try {
      if (w > 0 && h > 0) effect.resize(w, h);
    } catch (e) {
      console.warn(`[PostProcessing] Failed to resize effect "${effect.name}":`, e);
    }
    this.effects.push(effect);
  }

  removeEffect(name: string): void {
    const idx = this.effects.findIndex((e) => e.name === name);
    if (idx !== -1) {
      this.effects[idx].dispose();
      this.effects.splice(idx, 1);
    }
  }

  getEffect<T extends PostEffect>(name: string): T | undefined {
    return this.effects.find((e) => e.name === name) as T | undefined;
  }

  get hasEffects(): boolean {
    return this.enabled && this.effects.some((e) => e.enabled);
  }

  /** Render scene with all effects applied */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const activeEffects = this.effects.filter((e) => e.enabled);

    if (!this.enabled || activeEffects.length === 0) {
      this.renderer.render(scene, camera);
      return;
    }

    // Render scene to first target
    this.renderer.setRenderTarget(this.renderTargetA);
    this.renderer.render(scene, camera);

    // Ping-pong through effects
    let inputTarget = this.renderTargetA;
    let outputTarget = this.renderTargetB;

    for (let i = 0; i < activeEffects.length; i++) {
      const isLast = i === activeEffects.length - 1;
      activeEffects[i].render(
        this.renderer,
        inputTarget,
        isLast ? null : outputTarget, // null = render to screen
        scene,
        camera,
      );

      // Swap
      [inputTarget, outputTarget] = [outputTarget, inputTarget];
    }

    this.renderer.setRenderTarget(null);
  }

  /** Render a material to a target (or screen if null) */
  renderToScreen(material: THREE.Material, target: THREE.WebGLRenderTarget | null = null): void {
    this.fullscreenQuad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fullscreenScene, this.fullscreenCamera);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderTargetA.setSize(width, height);
    this.renderTargetB.setSize(width, height);
    for (const effect of this.effects) {
      try {
        effect.resize(width, height);
      } catch {
        // Effect may not be fully initialised yet — skip silently
      }
    }
  }

  dispose(): void {
    this.renderTargetA.dispose();
    this.renderTargetB.dispose();
    for (const effect of this.effects) effect.dispose();
    this.effects.length = 0;
  }
}

// ═══════════════════════════════════════════════════════════════════
// BUILT-IN EFFECTS
// ═══════════════════════════════════════════════════════════════════

// ── Bloom ──────────────────────────────────────────────────────────
// Progressive multi-mip bloom (Babylon.js / Unreal-style)
export class BloomEffect extends PostEffect {
  get name() { return 'bloom'; }
  public strength = 1.0;
  public threshold = 0.8;
  public radius = 0.5;

  private static readonly MIP_COUNT = 5;
  private brightPassMaterial: THREE.ShaderMaterial;
  private blurMaterial: THREE.ShaderMaterial;
  private compositeMaterial: THREE.ShaderMaterial;
  private brightTarget: THREE.WebGLRenderTarget;
  private mipTargetsA: THREE.WebGLRenderTarget[] = []; // ping
  private mipTargetsB: THREE.WebGLRenderTarget[] = []; // pong
  private quad: THREE.Mesh;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;

  constructor(width = 512, height = 512) {
    super();
    const params: THREE.RenderTargetOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType };

    // Create progressive mip targets (each half the previous)
    let mw = Math.floor(width / 2), mh = Math.floor(height / 2);
    this.brightTarget = new THREE.WebGLRenderTarget(mw, mh, params);
    for (let i = 0; i < BloomEffect.MIP_COUNT; i++) {
      this.mipTargetsA.push(new THREE.WebGLRenderTarget(mw, mh, params));
      this.mipTargetsB.push(new THREE.WebGLRenderTarget(mw, mh, params));
      mw = Math.max(1, Math.floor(mw / 2));
      mh = Math.max(1, Math.floor(mh / 2));
    }

    // Brightness extraction with soft knee
    this.brightPassMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, threshold: { value: this.threshold } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float threshold;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          float brightness = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          // Soft knee — gradual ramp instead of hard cutoff
          float knee = threshold * 0.5;
          float soft = brightness - threshold + knee;
          soft = clamp(soft, 0.0, 2.0 * knee);
          soft = soft * soft / (4.0 * knee + 0.00001);
          float contribution = max(soft, brightness - threshold) / max(brightness, 0.00001);
          gl_FragColor = c * max(contribution, 0.0);
        }
      `,
    });

    // 9-tap Gaussian blur (separable, reused at each mip level)
    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, direction: { value: new THREE.Vector2(1, 0) }, resolution: { value: new THREE.Vector2(width, height) } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec2 direction;
        uniform vec2 resolution;
        varying vec2 vUv;
        void main() {
          vec4 color = vec4(0.0);
          vec2 off = direction / resolution;
          color += texture2D(tDiffuse, vUv - 4.0 * off) * 0.0162;
          color += texture2D(tDiffuse, vUv - 3.0 * off) * 0.0540;
          color += texture2D(tDiffuse, vUv - 2.0 * off) * 0.1216;
          color += texture2D(tDiffuse, vUv - 1.0 * off) * 0.1945;
          color += texture2D(tDiffuse, vUv) * 0.2270;
          color += texture2D(tDiffuse, vUv + 1.0 * off) * 0.1945;
          color += texture2D(tDiffuse, vUv + 2.0 * off) * 0.1216;
          color += texture2D(tDiffuse, vUv + 3.0 * off) * 0.0540;
          color += texture2D(tDiffuse, vUv + 4.0 * off) * 0.0162;
          gl_FragColor = color;
        }
      `,
    });

    // Combine original + all mip levels with weighted blend
    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tBloom0: { value: null }, tBloom1: { value: null }, tBloom2: { value: null },
        tBloom3: { value: null }, tBloom4: { value: null },
        strength: { value: this.strength },
        radius: { value: this.radius },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform sampler2D tBloom0;
        uniform sampler2D tBloom1;
        uniform sampler2D tBloom2;
        uniform sampler2D tBloom3;
        uniform sampler2D tBloom4;
        uniform float strength;
        uniform float radius;
        varying vec2 vUv;
        void main() {
          // Weight mip levels: higher mips contribute more for wider bloom
          float w0 = 1.0;
          float w1 = mix(0.5, 1.0, radius);
          float w2 = mix(0.3, 1.0, radius);
          float w3 = mix(0.2, 0.8, radius);
          float w4 = mix(0.1, 0.6, radius);
          float totalWeight = w0 + w1 + w2 + w3 + w4;

          vec4 bloom = (
            texture2D(tBloom0, vUv) * w0 +
            texture2D(tBloom1, vUv) * w1 +
            texture2D(tBloom2, vUv) * w2 +
            texture2D(tBloom3, vUv) * w3 +
            texture2D(tBloom4, vUv) * w4
          ) / totalWeight;

          vec4 original = texture2D(tDiffuse, vUv);
          gl_FragColor = original + bloom * strength;
        }
      `,
    });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.brightPassMaterial);
    this.quadScene.add(this.quad);
  }

  private renderQuad(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.quadScene, this.quadCamera);
  }

  render(renderer: THREE.WebGLRenderer, inputTarget: THREE.WebGLRenderTarget, outputTarget: THREE.WebGLRenderTarget | null): void {
    // Brightness extraction
    this.brightPassMaterial.uniforms.tDiffuse.value = inputTarget.texture;
    this.brightPassMaterial.uniforms.threshold.value = this.threshold;
    this.renderQuad(renderer, this.brightPassMaterial, this.brightTarget);

    // Progressive downsample + blur at each mip level
    let src = this.brightTarget;
    for (let i = 0; i < BloomEffect.MIP_COUNT; i++) {
      const a = this.mipTargetsA[i];
      const b = this.mipTargetsB[i];

      // Downsample (natural filtering via linear interpolation from src → smaller target)
      // Then blur H
      this.blurMaterial.uniforms.tDiffuse.value = src.texture;
      this.blurMaterial.uniforms.direction.value.set(1, 0);
      this.blurMaterial.uniforms.resolution.value.set(a.width, a.height);
      this.renderQuad(renderer, this.blurMaterial, a);

      // Blur V
      this.blurMaterial.uniforms.tDiffuse.value = a.texture;
      this.blurMaterial.uniforms.direction.value.set(0, 1);
      this.renderQuad(renderer, this.blurMaterial, b);

      src = b; // next mip level reads from this
    }

    // Composite all mip levels
    this.compositeMaterial.uniforms.tDiffuse.value = inputTarget.texture;
    this.compositeMaterial.uniforms.tBloom0.value = this.mipTargetsB[0].texture;
    this.compositeMaterial.uniforms.tBloom1.value = this.mipTargetsB[1].texture;
    this.compositeMaterial.uniforms.tBloom2.value = this.mipTargetsB[2].texture;
    this.compositeMaterial.uniforms.tBloom3.value = this.mipTargetsB[3].texture;
    this.compositeMaterial.uniforms.tBloom4.value = this.mipTargetsB[4].texture;
    this.compositeMaterial.uniforms.strength.value = this.strength;
    this.compositeMaterial.uniforms.radius.value = this.radius;
    this.renderQuad(renderer, this.compositeMaterial, outputTarget);
  }

  resize(width: number, height: number): void {
    let mw = Math.floor(width / 2), mh = Math.floor(height / 2);
    this.brightTarget.setSize(mw, mh);
    for (let i = 0; i < BloomEffect.MIP_COUNT; i++) {
      this.mipTargetsA[i].setSize(mw, mh);
      this.mipTargetsB[i].setSize(mw, mh);
      mw = Math.max(1, Math.floor(mw / 2));
      mh = Math.max(1, Math.floor(mh / 2));
    }
  }

  dispose(): void {
    this.brightTarget.dispose();
    for (const t of this.mipTargetsA) t.dispose();
    for (const t of this.mipTargetsB) t.dispose();
    this.brightPassMaterial.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
  }
}

// ── Vignette ──────────────────────────────────────────────────────
export class VignetteEffect extends PostEffect {
  get name() { return 'vignette'; }
  public intensity = 0.5;
  public softness = 0.5;

  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, intensity: { value: this.intensity }, softness: { value: this.softness } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float intensity;
        uniform float softness;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float dist = distance(vUv, vec2(0.5));
          float vignette = smoothstep(0.8, 0.8 - softness, dist * (intensity + softness));
          gl_FragColor = vec4(color.rgb * vignette, color.a);
        }
      `,
    });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, inputTarget: THREE.WebGLRenderTarget, outputTarget: THREE.WebGLRenderTarget | null): void {
    this.material.uniforms.tDiffuse.value = inputTarget.texture;
    this.material.uniforms.intensity.value = this.intensity;
    this.material.uniforms.softness.value = this.softness;
    this.quad.material = this.material;
    renderer.setRenderTarget(outputTarget);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.material.dispose();
  }
}

// ── Color Grading (LUT-less) ─────────────────────────────────────
export class ColorGradingEffect extends PostEffect {
  get name() { return 'colorGrading'; }
  public brightness = 0.0;
  public contrast = 1.0;
  public saturation = 1.0;
  public gamma = 1.0;
  /** RGB tint (multiply) */
  public tint = new THREE.Color(1, 1, 1);

  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        brightness: { value: 0 },
        contrast: { value: 1 },
        saturation: { value: 1 },
        gamma: { value: 1 },
        tint: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float brightness;
        uniform float contrast;
        uniform float saturation;
        uniform float gamma;
        uniform vec3 tint;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          vec3 col = c.rgb;
          // Brightness
          col += brightness;
          // Contrast
          col = (col - 0.5) * contrast + 0.5;
          // Saturation
          float grey = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(grey), col, saturation);
          // Tint
          col *= tint;
          // Gamma
          col = pow(max(col, 0.0), vec3(1.0 / gamma));
          gl_FragColor = vec4(col, c.a);
        }
      `,
    });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, inputTarget: THREE.WebGLRenderTarget, outputTarget: THREE.WebGLRenderTarget | null): void {
    this.material.uniforms.tDiffuse.value = inputTarget.texture;
    this.material.uniforms.brightness.value = this.brightness;
    this.material.uniforms.contrast.value = this.contrast;
    this.material.uniforms.saturation.value = this.saturation;
    this.material.uniforms.gamma.value = this.gamma;
    this.material.uniforms.tint.value = this.tint;
    this.quad.material = this.material;
    renderer.setRenderTarget(outputTarget);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.material.dispose();
  }
}

// ── FXAA (Anti-aliasing) ─────────────────────────────────────────
export class FXAAEffect extends PostEffect {
  get name() { return 'fxaa'; }
  /** Subpixel quality: 0.0 = off, 0.75 = default, 1.0 = max */
  public subpixelQuality = 0.75;
  /** Edge threshold: lower = more edges detected (0.063 low, 0.125 default, 0.333 high) */
  public edgeThreshold = 0.125;
  /** Minimum edge threshold: filters dark edges (0.0312 default) */
  public edgeThresholdMin = 0.0312;
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;

  constructor(width = window.innerWidth, height = window.innerHeight) {
    super();
    // FXAA 3.11 quality — ported from Babylon.js / NVIDIA reference
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(1 / width, 1 / height) },
        subpixelQuality: { value: this.subpixelQuality },
        edgeThreshold: { value: this.edgeThreshold },
        edgeThresholdMin: { value: this.edgeThresholdMin },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float subpixelQuality;
        uniform float edgeThreshold;
        uniform float edgeThresholdMin;
        varying vec2 vUv;

        float FxaaLuma(vec4 rgba) {
          return rgba.y * (0.587 / 0.299) + rgba.x;
        }

        void main() {
          vec2 rcp = resolution;
          vec4 rgbM = texture2D(tDiffuse, vUv);
          float lumaM = FxaaLuma(rgbM);
          float lumaN = FxaaLuma(texture2D(tDiffuse, vUv + vec2(0.0, -rcp.y)));
          float lumaS = FxaaLuma(texture2D(tDiffuse, vUv + vec2(0.0,  rcp.y)));
          float lumaW = FxaaLuma(texture2D(tDiffuse, vUv + vec2(-rcp.x, 0.0)));
          float lumaE = FxaaLuma(texture2D(tDiffuse, vUv + vec2( rcp.x, 0.0)));

          float lumaMin = min(lumaM, min(min(lumaN, lumaS), min(lumaW, lumaE)));
          float lumaMax = max(lumaM, max(max(lumaN, lumaS), max(lumaW, lumaE)));
          float lumaRange = lumaMax - lumaMin;

          // Skip anti-aliasing on very flat areas
          if (lumaRange < max(edgeThresholdMin, lumaMax * edgeThreshold)) {
            gl_FragColor = rgbM;
            return;
          }

          float lumaNW = FxaaLuma(texture2D(tDiffuse, vUv + vec2(-rcp.x, -rcp.y)));
          float lumaNE = FxaaLuma(texture2D(tDiffuse, vUv + vec2( rcp.x, -rcp.y)));
          float lumaSW = FxaaLuma(texture2D(tDiffuse, vUv + vec2(-rcp.x,  rcp.y)));
          float lumaSE = FxaaLuma(texture2D(tDiffuse, vUv + vec2( rcp.x,  rcp.y)));

          float lumaTotal = lumaN + lumaS + lumaW + lumaE;
          float lumaAvg = (1.0 / 12.0) * (2.0 * lumaTotal + lumaNW + lumaNE + lumaSW + lumaSE);
          float subpix = clamp(abs(lumaAvg - lumaM) / lumaRange, 0.0, 1.0);
          subpix = smoothstep(0.0, 1.0, subpix);
          subpix = subpix * subpix * subpixelQuality;

          // Determine edge direction
          float edgeH = abs(-2.0 * lumaW + lumaNW + lumaSW) +
                        abs(-2.0 * lumaM + lumaN + lumaS) * 2.0 +
                        abs(-2.0 * lumaE + lumaNE + lumaSE);
          float edgeV = abs(-2.0 * lumaN + lumaNW + lumaNE) +
                        abs(-2.0 * lumaM + lumaW + lumaE) * 2.0 +
                        abs(-2.0 * lumaS + lumaSW + lumaSE);
          bool isHorizontal = edgeH >= edgeV;

          float luma1 = isHorizontal ? lumaN : lumaW;
          float luma2 = isHorizontal ? lumaS : lumaE;
          float gradient1 = abs(luma1 - lumaM);
          float gradient2 = abs(luma2 - lumaM);
          bool is1Steeper = gradient1 >= gradient2;

          float gradientScaled = 0.25 * max(gradient1, gradient2);
          float stepLength = isHorizontal ? rcp.y : rcp.x;
          float lumaLocalAvg;

          if (is1Steeper) {
            stepLength = -stepLength;
            lumaLocalAvg = 0.5 * (luma1 + lumaM);
          } else {
            lumaLocalAvg = 0.5 * (luma2 + lumaM);
          }

          vec2 currentUv = vUv;
          if (isHorizontal) currentUv.y += stepLength * 0.5;
          else currentUv.x += stepLength * 0.5;

          vec2 offset = isHorizontal ? vec2(rcp.x, 0.0) : vec2(0.0, rcp.y);

          // Walk along the edge (12 iterations — Babylon.js quality level)
          vec2 uv1 = currentUv - offset;
          vec2 uv2 = currentUv + offset;
          float lumaEnd1 = FxaaLuma(texture2D(tDiffuse, uv1)) - lumaLocalAvg;
          float lumaEnd2 = FxaaLuma(texture2D(tDiffuse, uv2)) - lumaLocalAvg;
          bool reached1 = abs(lumaEnd1) >= gradientScaled;
          bool reached2 = abs(lumaEnd2) >= gradientScaled;
          bool reachedBoth = reached1 && reached2;

          if (!reached1) uv1 -= offset;
          if (!reached2) uv2 += offset;

          if (!reachedBoth) {
            // Quality steps: progressively larger (FXAA 3.11 Q=12)
            float QUALITY[10];
            QUALITY[0] = 1.0; QUALITY[1] = 1.0; QUALITY[2] = 1.0;
            QUALITY[3] = 1.0; QUALITY[4] = 1.0; QUALITY[5] = 1.5;
            QUALITY[6] = 2.0; QUALITY[7] = 2.0; QUALITY[8] = 4.0;
            QUALITY[9] = 8.0;
            for (int i = 0; i < 10; i++) {
              if (!reached1) { uv1 -= offset * QUALITY[i]; lumaEnd1 = FxaaLuma(texture2D(tDiffuse, uv1)) - lumaLocalAvg; }
              if (!reached2) { uv2 += offset * QUALITY[i]; lumaEnd2 = FxaaLuma(texture2D(tDiffuse, uv2)) - lumaLocalAvg; }
              reached1 = abs(lumaEnd1) >= gradientScaled;
              reached2 = abs(lumaEnd2) >= gradientScaled;
              if (reached1 && reached2) break;
            }
          }

          float distance1 = isHorizontal ? (vUv.x - uv1.x) : (vUv.y - uv1.y);
          float distance2 = isHorizontal ? (uv2.x - vUv.x) : (uv2.y - vUv.y);
          bool isDirection1 = distance1 < distance2;
          float distanceFinal = min(distance1, distance2);
          float edgeLength = distance1 + distance2;
          float pixelOffset = -distanceFinal / edgeLength + 0.5;

          bool isLumaCenterSmaller = lumaM < lumaLocalAvg;
          bool correctVariation = ((isDirection1 ? lumaEnd1 : lumaEnd2) < 0.0) != isLumaCenterSmaller;

          float finalOffset = correctVariation ? pixelOffset : 0.0;
          finalOffset = max(finalOffset, subpix);

          vec2 finalUv = vUv;
          if (isHorizontal) finalUv.y += finalOffset * stepLength;
          else finalUv.x += finalOffset * stepLength;

          gl_FragColor = texture2D(tDiffuse, finalUv);
        }
      `,
    });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, inputTarget: THREE.WebGLRenderTarget, outputTarget: THREE.WebGLRenderTarget | null): void {
    this.material.uniforms.tDiffuse.value = inputTarget.texture;
    this.material.uniforms.subpixelQuality.value = this.subpixelQuality;
    this.material.uniforms.edgeThreshold.value = this.edgeThreshold;
    this.material.uniforms.edgeThresholdMin.value = this.edgeThresholdMin;
    this.quad.material = this.material;
    renderer.setRenderTarget(outputTarget);
    renderer.render(this.quadScene, this.quadCamera);
  }

  resize(width: number, height: number): void {
    this.material.uniforms.resolution.value.set(1 / width, 1 / height);
  }

  dispose(): void {
    this.material.dispose();
  }
}

// ── Shared vertex shader ──────────────────────────────────────────
const FULLSCREEN_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// ── Depth of Field (DOF) ─────────────────────────────────────────
export class DOFEffect extends PostEffect {
  get name() { return 'dof'; }
  public focusDistance = 10.0;
  public focusRange = 5.0;
  public bokehStrength = 1.0;
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private depthTarget: THREE.WebGLRenderTarget;
  private depthMaterial: THREE.MeshDepthMaterial;

  constructor(width = window.innerWidth, height = window.innerHeight) {
    super();

    this.depthTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    this.depthTarget.depthTexture = new THREE.DepthTexture(width, height);
    this.depthTarget.depthTexture.format = THREE.DepthFormat;
    this.depthTarget.depthTexture.type = THREE.UnsignedIntType;

    this.depthMaterial = new THREE.MeshDepthMaterial();
    this.depthMaterial.depthPacking = THREE.RGBADepthPacking;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        resolution: { value: new THREE.Vector2(1 / width, 1 / height) },
        focusDistance: { value: this.focusDistance },
        focusRange: { value: this.focusRange },
        bokehStrength: { value: this.bokehStrength },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 2000.0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 resolution;
        uniform float focusDistance;
        uniform float focusRange;
        uniform float bokehStrength;
        uniform float cameraNear;
        uniform float cameraFar;
        varying vec2 vUv;

        float readDepth(sampler2D depthSampler, vec2 coord) {
          float fragCoordZ = texture2D(depthSampler, coord).x;
          float viewZ = (cameraNear * cameraFar) / (cameraFar - fragCoordZ * (cameraFar - cameraNear));
          return viewZ;
        }

        void main() {
          float depth = readDepth(tDepth, vUv);
          float coc = abs(depth - focusDistance) / focusRange;
          coc = clamp(coc * bokehStrength, 0.0, 1.0);

          vec3 color = vec3(0.0);
          float total = 0.0;
          float blurRadius = coc * 6.0;

          for (float x = -3.0; x <= 3.0; x += 1.0) {
            for (float y = -3.0; y <= 3.0; y += 1.0) {
              vec2 offset = vec2(x, y) * resolution * blurRadius;
              float w = 1.0 - length(vec2(x, y)) / 4.24;
              if (w > 0.0) {
                color += texture2D(tDiffuse, vUv + offset).rgb * w;
                total += w;
              }
            }
          }
          gl_FragColor = vec4(color / max(total, 1.0), 1.0);
        }
      `,
    });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quad);
  }

  render(
    renderer: THREE.WebGLRenderer,
    inputTarget: THREE.WebGLRenderTarget,
    outputTarget: THREE.WebGLRenderTarget | null,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): void {
    // Render depth pass
    const originalOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget(this.depthTarget);
    renderer.render(scene, camera);
    scene.overrideMaterial = originalOverride;

    // Update uniforms
    if (camera instanceof THREE.PerspectiveCamera) {
      this.material.uniforms.cameraNear.value = camera.near;
      this.material.uniforms.cameraFar.value = camera.far;
    }
    this.material.uniforms.tDiffuse.value = inputTarget.texture;
    this.material.uniforms.tDepth.value = this.depthTarget.depthTexture;
    this.material.uniforms.focusDistance.value = this.focusDistance;
    this.material.uniforms.focusRange.value = this.focusRange;
    this.material.uniforms.bokehStrength.value = this.bokehStrength;

    renderer.setRenderTarget(outputTarget);
    renderer.render(this.quadScene, this.quadCamera);
  }

  resize(width: number, height: number): void {
    this.material.uniforms.resolution.value.set(1 / width, 1 / height);
    this.depthTarget.setSize(width, height);
  }

  dispose(): void {
    this.material.dispose();
    this.depthTarget.dispose();
    this.depthMaterial.dispose();
  }
}

// ── Motion Blur ──────────────────────────────────────────────────
export class MotionBlurEffect extends PostEffect {
  get name() { return 'motionBlur'; }
  public strength = 0.5;
  public samples = 8;
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private prevViewProjection = new THREE.Matrix4();
  private hasPrev = false;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        velocityScale: { value: this.strength },
        samples: { value: this.samples },
        prevViewProjection: { value: new THREE.Matrix4() },
        viewProjectionInverse: { value: new THREE.Matrix4() },
        resolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float velocityScale;
        uniform int samples;
        uniform mat4 prevViewProjection;
        uniform mat4 viewProjectionInverse;
        uniform vec2 resolution;
        varying vec2 vUv;

        void main() {
          // Reconstruct world position from UV + depth (approximate with ndc)
          vec4 ndcPos = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);

          // Approximate velocity from camera movement
          vec4 worldPos = viewProjectionInverse * ndcPos;
          worldPos /= worldPos.w;
          vec4 prevClip = prevViewProjection * worldPos;
          prevClip /= prevClip.w;
          vec2 velocity = (ndcPos.xy - prevClip.xy) * 0.5 * velocityScale;

          // Clamp velocity
          float speed = length(velocity * resolution);
          if (speed > 50.0) velocity *= 50.0 / speed;

          vec3 color = vec3(0.0);
          for (int i = 0; i < 16; i++) {
            if (i >= samples) break;
            float t = float(i) / float(samples) - 0.5;
            color += texture2D(tDiffuse, vUv + velocity * t).rgb;
          }
          gl_FragColor = vec4(color / float(samples), 1.0);
        }
      `,
    });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quad);
  }

  render(
    renderer: THREE.WebGLRenderer,
    inputTarget: THREE.WebGLRenderTarget,
    outputTarget: THREE.WebGLRenderTarget | null,
    _scene: THREE.Scene,
    camera: THREE.Camera,
  ): void {
    const viewProj = new THREE.Matrix4();
    viewProj.multiplyMatrices(
      (camera as THREE.PerspectiveCamera).projectionMatrix,
      camera.matrixWorldInverse,
    );
    const viewProjInv = viewProj.clone().invert();

    if (!this.hasPrev) {
      this.prevViewProjection.copy(viewProj);
      this.hasPrev = true;
    }

    this.material.uniforms.tDiffuse.value = inputTarget.texture;
    this.material.uniforms.velocityScale.value = this.strength;
    this.material.uniforms.samples.value = this.samples;
    this.material.uniforms.prevViewProjection.value.copy(this.prevViewProjection);
    this.material.uniforms.viewProjectionInverse.value.copy(viewProjInv);

    renderer.setRenderTarget(outputTarget);
    renderer.render(this.quadScene, this.quadCamera);

    this.prevViewProjection.copy(viewProj);
  }

  resize(width: number, height: number): void {
    this.material.uniforms.resolution.value.set(width, height);
  }

  dispose(): void {
    this.material.dispose();
  }
}

// ── Chromatic Aberration ─────────────────────────────────────────
export class ChromaticAberrationEffect extends PostEffect {
  get name() { return 'chromaticAberration'; }
  public strength = 0.003;
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        strength: { value: this.strength },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float strength;
        varying vec2 vUv;

        void main() {
          vec2 dir = vUv - 0.5;
          float dist = length(dir);
          vec2 offset = dir * dist * strength;

          float r = texture2D(tDiffuse, vUv + offset).r;
          float g = texture2D(tDiffuse, vUv).g;
          float b = texture2D(tDiffuse, vUv - offset).b;
          float a = texture2D(tDiffuse, vUv).a;

          gl_FragColor = vec4(r, g, b, a);
        }
      `,
    });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, inputTarget: THREE.WebGLRenderTarget, outputTarget: THREE.WebGLRenderTarget | null): void {
    this.material.uniforms.tDiffuse.value = inputTarget.texture;
    this.material.uniforms.strength.value = this.strength;
    renderer.setRenderTarget(outputTarget);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.material.dispose();
  }
}

// ── SSAO (Screen-Space Ambient Occlusion) ────────────────────────
// Hemisphere kernel sampling + edge-aware bilateral blur (Babylon.js-inspired)
export class SSAOEffect extends PostEffect {
  get name() { return 'ssao'; }
  public radius = 0.5;
  public intensity = 1.0;
  public bias = 0.025;
  public kernelSize = 32;

  private material: THREE.ShaderMaterial;
  private blurHMaterial: THREE.ShaderMaterial;
  private blurVMaterial: THREE.ShaderMaterial;
  private aoTarget: THREE.WebGLRenderTarget;
  private blurTarget: THREE.WebGLRenderTarget;
  private depthTarget: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private depthMaterial: THREE.MeshDepthMaterial;
  private noiseTexture: THREE.DataTexture;
  private kernelTexture: THREE.DataTexture;

  constructor(width = 512, height = 512) {
    super();
    const params: THREE.RenderTargetOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType };

    this.aoTarget = new THREE.WebGLRenderTarget(width, height, params);
    this.blurTarget = new THREE.WebGLRenderTarget(width, height, params);
    this.depthTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
    });
    this.depthTarget.depthTexture = new THREE.DepthTexture(width, height);

    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });

    // Generate hemisphere kernel (32 samples, cosine-weighted, accelerating distribution)
    const kernelSize = 32;
    const kernelData = new Float32Array(kernelSize * 4);
    for (let i = 0; i < kernelSize; i++) {
      // Random point in unit hemisphere (cosine-weighted)
      const phi = Math.random() * Math.PI * 2;
      const cosTheta = Math.random();
      const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
      let x = sinTheta * Math.cos(phi);
      let y = sinTheta * Math.sin(phi);
      let z = cosTheta; // hemisphere oriented along +Z

      // Accelerating interpolation — samples closer to origin for small i
      let scale = (i + 1) / kernelSize;
      scale = 0.1 + 0.9 * scale * scale; // lerp(0.1, 1.0, scale²)
      kernelData[i * 4 + 0] = x * scale;
      kernelData[i * 4 + 1] = y * scale;
      kernelData[i * 4 + 2] = z * scale;
      kernelData[i * 4 + 3] = 0;
    }
    this.kernelTexture = new THREE.DataTexture(kernelData, kernelSize, 1, THREE.RGBAFormat, THREE.FloatType);
    this.kernelTexture.needsUpdate = true;

    // Generate noise texture (4x4 random rotation vectors for TBN)
    const noiseSize = 4;
    const noiseData = new Float32Array(noiseSize * noiseSize * 4);
    for (let i = 0; i < noiseSize * noiseSize; i++) {
      const angle = Math.random() * Math.PI * 2;
      noiseData[i * 4 + 0] = Math.cos(angle);
      noiseData[i * 4 + 1] = Math.sin(angle);
      noiseData[i * 4 + 2] = 0;
      noiseData[i * 4 + 3] = 1;
    }
    this.noiseTexture = new THREE.DataTexture(noiseData, noiseSize, noiseSize, THREE.RGBAFormat, THREE.FloatType);
    this.noiseTexture.wrapS = this.noiseTexture.wrapT = THREE.RepeatWrapping;
    this.noiseTexture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        tNoise: { value: this.noiseTexture },
        tKernel: { value: this.kernelTexture },
        resolution: { value: new THREE.Vector2(width, height) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        projMatrix: { value: new THREE.Matrix4() },
        invProjMatrix: { value: new THREE.Matrix4() },
        radius: { value: this.radius },
        intensity: { value: this.intensity },
        bias: { value: this.bias },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform sampler2D tNoise;
        uniform sampler2D tKernel;
        uniform vec2 resolution;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform mat4 projMatrix;
        uniform mat4 invProjMatrix;
        uniform float radius;
        uniform float intensity;
        uniform float bias;
        varying vec2 vUv;

        float linearDepth(float d) {
          return cameraNear * cameraFar / (cameraFar - d * (cameraFar - cameraNear));
        }

        vec3 viewPosFromDepth(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          vec4 view = invProjMatrix * clip;
          return view.xyz / view.w;
        }

        void main() {
          float rawDepth = texture2D(tDepth, vUv).x;
          if (rawDepth >= 1.0) {
            gl_FragColor = vec4(1.0);
            return;
          }

          vec3 fragPos = viewPosFromDepth(vUv);

          // Reconstruct normal from view-space position (cross of screen derivatives)
          vec3 dFdxPos = dFdx(fragPos);
          vec3 dFdyPos = dFdy(fragPos);
          vec3 normal = normalize(cross(dFdxPos, dFdyPos));

          // TBN matrix from noise texture — rotates kernel around normal
          vec2 noiseScale = resolution / 4.0;
          vec3 randomVec = texture2D(tNoise, vUv * noiseScale).xyz;
          vec3 tangent = normalize(randomVec - normal * dot(randomVec, normal));
          vec3 bitangent = cross(normal, tangent);
          mat3 TBN = mat3(tangent, bitangent, normal);

          // Sample hemisphere kernel (32 samples)
          float occlusion = 0.0;
          for (int i = 0; i < 32; i++) {
            // Read kernel sample from data texture
            vec3 kernelSample = texture2D(tKernel, vec2((float(i) + 0.5) / 32.0, 0.5)).xyz;
            vec3 samplePos = fragPos + TBN * kernelSample * radius;

            // Project to screen space
            vec4 offset = projMatrix * vec4(samplePos, 1.0);
            offset.xy = offset.xy / offset.w * 0.5 + 0.5;

            // Sample depth at projected position
            float sampleDepth = viewPosFromDepth(offset.xy).z;

            // Range-aware occlusion check with smooth falloff
            float rangeCheck = smoothstep(0.0, 1.0, radius / abs(fragPos.z - sampleDepth));
            occlusion += (sampleDepth >= samplePos.z + bias ? 1.0 : 0.0) * rangeCheck;
          }

          occlusion = 1.0 - (occlusion / 32.0) * intensity;
          gl_FragColor = vec4(vec3(occlusion), 1.0);
        }
      `,
    });

    // Bilateral blur (edge-preserving) — horizontal pass
    const bilateralBlurShader = (dx: string, dy: string) => /* glsl */`
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform vec2 resolution;
      uniform float cameraNear;
      uniform float cameraFar;
      varying vec2 vUv;

      float linearDepth(float d) {
        return cameraNear * cameraFar / (cameraFar - d * (cameraFar - cameraNear));
      }

      void main() {
        vec2 texelSize = 1.0 / resolution;
        float centerDepth = linearDepth(texture2D(tDepth, vUv).x);
        float centerAO = texture2D(tDiffuse, vUv).r;

        float totalAO = centerAO;
        float totalWeight = 1.0;

        // 9-tap bilateral blur with depth-aware weighting
        float sigma = 4.0;
        float depthThreshold = 0.1;

        for (int i = -4; i <= 4; i++) {
          if (i == 0) continue;
          vec2 offset = vec2(${dx}, ${dy}) * float(i) * texelSize;
          float sampleAO = texture2D(tDiffuse, vUv + offset).r;
          float sampleDepth = linearDepth(texture2D(tDepth, vUv + offset).x);

          // Gaussian spatial weight
          float w = exp(-float(i * i) / (2.0 * sigma * sigma));
          // Depth-aware weight — preserve edges where depth changes sharply
          float depthDiff = abs(centerDepth - sampleDepth);
          w *= exp(-depthDiff * depthDiff / (2.0 * depthThreshold * depthThreshold));

          totalAO += sampleAO * w;
          totalWeight += w;
        }

        gl_FragColor = vec4(vec3(totalAO / totalWeight), 1.0);
      }
    `;

    this.blurHMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        resolution: { value: new THREE.Vector2(width, height) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: bilateralBlurShader('1.0', '0.0'),
    });

    this.blurVMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        resolution: { value: new THREE.Vector2(width, height) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: bilateralBlurShader('0.0', '1.0'),
    });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, inputTarget: THREE.WebGLRenderTarget, outputTarget: THREE.WebGLRenderTarget | null, scene: THREE.Scene, camera: THREE.Camera): void {
    // Render depth
    const origOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget(this.depthTarget);
    renderer.render(scene, camera);
    scene.overrideMaterial = origOverride;

    // Update camera matrices
    if (camera instanceof THREE.PerspectiveCamera) {
      this.material.uniforms.cameraNear.value = camera.near;
      this.material.uniforms.cameraFar.value = camera.far;
      this.material.uniforms.projMatrix.value.copy(camera.projectionMatrix);
      this.material.uniforms.invProjMatrix.value.copy(camera.projectionMatrixInverse);
      this.blurHMaterial.uniforms.cameraNear.value = camera.near;
      this.blurHMaterial.uniforms.cameraFar.value = camera.far;
      this.blurVMaterial.uniforms.cameraNear.value = camera.near;
      this.blurVMaterial.uniforms.cameraFar.value = camera.far;
    }

    // SSAO pass — output AO to aoTarget
    this.material.uniforms.tDiffuse.value = inputTarget.texture;
    this.material.uniforms.tDepth.value = this.depthTarget.depthTexture;
    this.material.uniforms.radius.value = this.radius;
    this.material.uniforms.intensity.value = this.intensity;
    this.material.uniforms.bias.value = this.bias;
    this.quad.material = this.material;
    renderer.setRenderTarget(this.aoTarget);
    renderer.render(this.quadScene, this.quadCamera);

    // Bilateral blur H — aoTarget → blurTarget
    this.blurHMaterial.uniforms.tDiffuse.value = this.aoTarget.texture;
    this.blurHMaterial.uniforms.tDepth.value = this.depthTarget.depthTexture;
    this.quad.material = this.blurHMaterial;
    renderer.setRenderTarget(this.blurTarget);
    renderer.render(this.quadScene, this.quadCamera);

    // Bilateral blur V — blurTarget → aoTarget (reuse)
    this.blurVMaterial.uniforms.tDiffuse.value = this.blurTarget.texture;
    this.blurVMaterial.uniforms.tDepth.value = this.depthTarget.depthTexture;
    this.quad.material = this.blurVMaterial;
    renderer.setRenderTarget(this.aoTarget);
    renderer.render(this.quadScene, this.quadCamera);

    // Composite: multiply AO with scene color → output
    // Simple multiply in fragment: read input color * AO
    this.quad.material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: inputTarget.texture }, tAO: { value: this.aoTarget.texture } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform sampler2D tAO;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float ao = texture2D(tAO, vUv).r;
          gl_FragColor = vec4(color.rgb * ao, color.a);
        }
      `,
    });
    renderer.setRenderTarget(outputTarget);
    renderer.render(this.quadScene, this.quadCamera);
  }

  resize(width: number, height: number): void {
    this.aoTarget.setSize(width, height);
    this.blurTarget.setSize(width, height);
    this.depthTarget.setSize(width, height);
    this.material.uniforms.resolution.value.set(width, height);
    this.blurHMaterial.uniforms.resolution.value.set(width, height);
    this.blurVMaterial.uniforms.resolution.value.set(width, height);
  }

  dispose(): void {
    this.aoTarget.dispose();
    this.blurTarget.dispose();
    this.depthTarget.dispose();
    this.material.dispose();
    this.blurHMaterial.dispose();
    this.blurVMaterial.dispose();
    this.noiseTexture.dispose();
    this.kernelTexture.dispose();
  }
}

// ── SSR (Screen-Space Reflections) ───────────────────────────────
export class SSREffect extends PostEffect {
  get name() { return 'ssr'; }
  public maxSteps = 50;
  public maxDistance = 100;
  public thickness = 0.5;
  public intensity = 0.8;

  private material: THREE.ShaderMaterial;
  private depthTarget: THREE.WebGLRenderTarget;
  private depthMaterial: THREE.MeshDepthMaterial;
  private quad: THREE.Mesh;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;

  constructor(width = 512, height = 512) {
    super();
    this.depthTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.FloatType,
    });
    this.depthTarget.depthTexture = new THREE.DepthTexture(width, height);

    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        resolution: { value: new THREE.Vector2(width, height) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        projMatrix: { value: new THREE.Matrix4() },
        invProjMatrix: { value: new THREE.Matrix4() },
        maxSteps: { value: this.maxSteps },
        maxDist: { value: this.maxDistance },
        thickness: { value: this.thickness },
        intensity: { value: this.intensity },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 resolution;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform mat4 projMatrix;
        uniform mat4 invProjMatrix;
        uniform float maxDist;
        uniform float thickness;
        uniform float intensity;
        uniform int maxSteps;
        varying vec2 vUv;

        float linearDepth(float d) {
          return cameraNear * cameraFar / (cameraFar + d * (cameraNear - cameraFar));
        }

        vec3 viewPosFromDepth(vec2 uv, float depth) {
          vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          vec4 viewPos = invProjMatrix * clip;
          return viewPos.xyz / viewPos.w;
        }

        void main() {
          vec4 baseColor = texture2D(tDiffuse, vUv);
          float depth = texture2D(tDepth, vUv).x;

          if (depth >= 1.0) {
            gl_FragColor = baseColor;
            return;
          }

          // Simple screen-space ray march for reflections
          vec3 viewPos = viewPosFromDepth(vUv, depth);
          vec3 normal = normalize(cross(dFdx(viewPos), dFdy(viewPos)));
          vec3 viewDir = normalize(viewPos);
          vec3 reflDir = reflect(viewDir, normal);

          vec3 startPos = viewPos;
          float stepSize = maxDist / float(maxSteps);
          vec3 reflColor = vec3(0.0);
          float reflWeight = 0.0;

          for (int i = 1; i <= 50; i++) {
            if (i > maxSteps) break;
            vec3 samplePos = startPos + reflDir * stepSize * float(i);
            vec4 projected = projMatrix * vec4(samplePos, 1.0);
            projected.xyz /= projected.w;
            vec2 sUv = projected.xy * 0.5 + 0.5;

            if (sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0) break;

            float sampleDepth = texture2D(tDepth, sUv).x;
            float sampleLinear = linearDepth(sampleDepth);
            float rayLinear = linearDepth(projected.z * 0.5 + 0.5);

            if (rayLinear > sampleLinear && rayLinear - sampleLinear < thickness) {
              reflColor = texture2D(tDiffuse, sUv).rgb;
              float fade = 1.0 - float(i) / float(maxSteps);
              reflWeight = fade * intensity;
              break;
            }
          }

          gl_FragColor = vec4(mix(baseColor.rgb, reflColor, reflWeight), baseColor.a);
        }
      `,
    });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, inputTarget: THREE.WebGLRenderTarget, outputTarget: THREE.WebGLRenderTarget | null, scene: THREE.Scene, camera: THREE.Camera): void {
    // Render depth
    const origOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget(this.depthTarget);
    renderer.render(scene, camera);
    scene.overrideMaterial = origOverride;

    this.material.uniforms.tDiffuse.value = inputTarget.texture;
    this.material.uniforms.tDepth.value = this.depthTarget.depthTexture;
    if (camera instanceof THREE.PerspectiveCamera) {
      this.material.uniforms.cameraNear.value = camera.near;
      this.material.uniforms.cameraFar.value = camera.far;
      this.material.uniforms.projMatrix.value.copy(camera.projectionMatrix);
      this.material.uniforms.invProjMatrix.value.copy(camera.projectionMatrixInverse);
    }
    this.material.uniforms.maxSteps.value = this.maxSteps;
    this.material.uniforms.maxDist.value = this.maxDistance;
    this.material.uniforms.thickness.value = this.thickness;
    this.material.uniforms.intensity.value = this.intensity;

    this.quad.material = this.material;
    renderer.setRenderTarget(outputTarget);
    renderer.render(this.quadScene, this.quadCamera);
  }

  resize(width: number, height: number): void {
    this.depthTarget.setSize(width, height);
    this.material.uniforms.resolution.value.set(width, height);
  }

  dispose(): void {
    this.depthTarget.dispose();
    this.material.dispose();
  }
}

// ── Volumetric Light (God Rays) ──────────────────────────────────
export class VolumetricLightEffect extends PostEffect {
  get name() { return 'volumetricLight'; }
  public exposure = 0.3;
  public decay = 0.96;
  public density = 0.9;
  public weight = 0.5;
  public samples = 60;
  public lightPosition = new THREE.Vector2(0.5, 0.5); // screen-space

  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        lightPos: { value: this.lightPosition },
        exposure: { value: this.exposure },
        decay: { value: this.decay },
        density: { value: this.density },
        weight: { value: this.weight },
        numSamples: { value: this.samples },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 lightPos;
        uniform float exposure;
        uniform float decay;
        uniform float density;
        uniform float weight;
        uniform int numSamples;
        varying vec2 vUv;

        void main() {
          vec2 texCoord = vUv;
          vec2 deltaTexCoord = (texCoord - lightPos);
          deltaTexCoord *= 1.0 / float(numSamples) * density;

          vec4 color = texture2D(tDiffuse, texCoord);
          vec4 sample_;
          float illuminationDecay = 1.0;

          for (int i = 0; i < 100; i++) {
            if (i >= numSamples) break;
            texCoord -= deltaTexCoord;
            sample_ = texture2D(tDiffuse, texCoord);
            sample_ *= illuminationDecay * weight;
            color += sample_;
            illuminationDecay *= decay;
          }

          gl_FragColor = color * exposure;
        }
      `,
    });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quad);
  }

  /** Update light position from a 3D world position and camera */
  updateLightPosition(worldPos: THREE.Vector3, camera: THREE.Camera): void {
    const ndc = worldPos.clone().project(camera);
    this.lightPosition.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
  }

  render(renderer: THREE.WebGLRenderer, inputTarget: THREE.WebGLRenderTarget, outputTarget: THREE.WebGLRenderTarget | null): void {
    this.material.uniforms.tDiffuse.value = inputTarget.texture;
    this.material.uniforms.lightPos.value = this.lightPosition;
    this.material.uniforms.exposure.value = this.exposure;
    this.material.uniforms.decay.value = this.decay;
    this.material.uniforms.density.value = this.density;
    this.material.uniforms.weight.value = this.weight;
    this.material.uniforms.numSamples.value = this.samples;
    this.quad.material = this.material;
    renderer.setRenderTarget(outputTarget);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.material.dispose();
  }
}

// ── Film Grain ───────────────────────────────────────────────────
export class FilmGrainEffect extends PostEffect {
  get name() { return 'filmGrain'; }
  public intensity = 0.15;
  public speed = 1.0;

  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private elapsed = 0;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        intensity: { value: this.intensity },
        time: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float intensity;
        uniform float time;
        varying vec2 vUv;

        float rand(vec2 co) {
          return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          float noise = rand(vUv + time) * 2.0 - 1.0;
          color.rgb += noise * intensity;
          gl_FragColor = color;
        }
      `,
    });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, inputTarget: THREE.WebGLRenderTarget, outputTarget: THREE.WebGLRenderTarget | null): void {
    this.elapsed += 0.016 * this.speed;
    this.material.uniforms.tDiffuse.value = inputTarget.texture;
    this.material.uniforms.intensity.value = this.intensity;
    this.material.uniforms.time.value = this.elapsed;
    this.quad.material = this.material;
    renderer.setRenderTarget(outputTarget);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.material.dispose();
  }
}

// ── Tone Mapping (Babylon.js-inspired: Reinhard / Hable / ACES) ──
export type ToneMappingMode = 'reinhard' | 'hable' | 'aces';

export class ToneMappingEffect extends PostEffect {
  get name() { return 'toneMapping'; }
  public mode: ToneMappingMode = 'aces';
  public exposure = 1.0;

  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        exposure: { value: this.exposure },
        mode: { value: 2 }, // 0=reinhard, 1=hable, 2=aces
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float exposure;
        uniform int mode;
        varying vec2 vUv;

        // Reinhard (simple luminance-based)
        vec3 tonemapReinhard(vec3 x) {
          return x / (1.0 + x);
        }

        // Hable / Uncharted 2 filmic curve
        vec3 hablePartial(vec3 x) {
          float A = 0.15; float B = 0.50; float C = 0.10;
          float D = 0.20; float E = 0.02; float F = 0.30;
          return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
        }
        vec3 tonemapHable(vec3 v) {
          float W = 11.2; // linear white point
          vec3 curr = hablePartial(v * 2.0);
          vec3 whiteScale = vec3(1.0) / hablePartial(vec3(W));
          return curr * whiteScale;
        }

        // ACES Filmic (fitted)
        vec3 tonemapACES(vec3 v) {
          float a = 2.51; float b = 0.03;
          float c = 2.43; float d = 0.59; float e = 0.14;
          return clamp((v * (a * v + b)) / (v * (c * v + d) + e), 0.0, 1.0);
        }

        void main() {
          vec4 texel = texture2D(tDiffuse, vUv);
          vec3 col = texel.rgb * exposure;

          if (mode == 0) col = tonemapReinhard(col);
          else if (mode == 1) col = tonemapHable(col);
          else col = tonemapACES(col);

          // sRGB gamma
          col = pow(col, vec3(1.0 / 2.2));
          gl_FragColor = vec4(col, texel.a);
        }
      `,
    });

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quadScene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, inputTarget: THREE.WebGLRenderTarget, outputTarget: THREE.WebGLRenderTarget | null): void {
    const modeMap: Record<ToneMappingMode, number> = { reinhard: 0, hable: 1, aces: 2 };
    this.material.uniforms.tDiffuse.value = inputTarget.texture;
    this.material.uniforms.exposure.value = this.exposure;
    this.material.uniforms.mode.value = modeMap[this.mode];
    this.quad.material = this.material;
    renderer.setRenderTarget(outputTarget);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.material.dispose();
  }
}
