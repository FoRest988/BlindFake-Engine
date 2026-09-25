import * as THREE from 'three';
import type { EditorApp } from '../EditorApp';
import { BloomEffect, VignetteEffect, ColorGradingEffect, FXAAEffect, DOFEffect, MotionBlurEffect, ChromaticAberrationEffect, SSAOEffect, SSREffect, VolumetricLightEffect, FilmGrainEffect, ToneMappingEffect } from '../../engine/PostProcessing';
import type { ToneMappingMode } from '../../engine/PostProcessing';

export class EngineSystemsPanel {
  private editor: EditorApp;
  private container: HTMLElement;
  private _renderContent: (() => void) | null = null;
  /** Timers/observers owned by the currently rendered section; run before it is replaced. */
  private _sectionCleanups: Array<() => void> = [];

  // Spline drawing state
  private _drawingSpline = false;
  private _drawingPoints: THREE.Vector3[] = [];
  private _drawingType: 'movement' | 'collision' | 'camera' | 'generic' = 'movement';
  private _drawingPreviewLine: THREE.Line | null = null;
  private _drawingPreviewSpheres: THREE.Mesh[] = [];
  private _drawClickHandler: ((e: MouseEvent) => void) | null = null;
  private _drawKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _drawContextHandler: ((e: MouseEvent) => void) | null = null;

  constructor(editor: EditorApp) {
    this.editor = editor;
    this.container = document.createElement('div');
    this.container.style.cssText = 'display:flex;flex:1;overflow:hidden;width:100%;height:100%;background:#1e1e1e;';
  }

  refresh(): void {
    if (this._renderContent) this._renderContent();
  }

  private runSectionCleanups(): void {
    for (const fn of this._sectionCleanups.splice(0)) fn();
  }

  /** Stop timers and observers owned by the rendered section. */
  dispose(): void {
    this.runSectionCleanups();
  }

  render(): HTMLElement {
    this.runSectionCleanups();
    this.container.innerHTML = '';

    // Sidebar with system list
    const sidebar = document.createElement('div');
    sidebar.style.cssText = 'width:200px;background:#252526;border-right:1px solid #333;overflow-y:auto;padding:8px 0;';

    const systems = [
      { id: 'weather', icon: '🌦️', label: 'Weather' },
      { id: 'postprocess', icon: '✨', label: 'Post Processing' },
      { id: 'performance', icon: '⚡', label: 'Performance' },
      { id: 'particles', icon: '🔥', label: 'Particles' },
      { id: 'camera', icon: '📷', label: 'Camera Effects' },
      { id: 'audio', icon: '🔊', label: 'Audio' },
      { id: 'lod', icon: '🔍', label: 'LOD System' },
      { id: 'splines', icon: '➰', label: 'Spline Paths' },
      { id: 'ecsystems', icon: '🧩', label: 'ECS Systems' },
    ];

    const content = document.createElement('div');
    content.style.cssText = 'flex:1;overflow-y:auto;padding:16px;color:#ccc;';

    let activeSystem = 'weather';

    const renderSidebar = () => {
      sidebar.innerHTML = '';
      const title = document.createElement('div');
      title.style.cssText = 'padding:8px 12px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;';
      title.textContent = 'Engine Systems';
      sidebar.appendChild(title);

      systems.forEach(sys => {
        const item = document.createElement('div');
        item.style.cssText = `padding:6px 12px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;${activeSystem === sys.id ? 'background:#37373d;color:#fff;' : 'color:#bbb;'}`;
        item.innerHTML = `<span>${sys.icon}</span><span>${sys.label}</span>`;
        item.addEventListener('click', () => { activeSystem = sys.id; renderSidebar(); renderContent(); });
        sidebar.appendChild(item);
      });
    };

    const renderContent = () => {
      this.runSectionCleanups();
      content.innerHTML = '';
      switch (activeSystem) {
        case 'weather': this.renderWeather(content); break;
        case 'postprocess': this.renderPostProcessing(content); break;
        case 'performance': this.renderPerformance(content); break;
        case 'particles': this.renderParticles(content); break;
        case 'camera': this.renderCameraEffects(content); break;
        case 'audio': this.renderAudio(content); break;
        case 'lod': this.renderLOD(content); break;
        case 'splines': this.renderSplines(content); break;
        case 'ecsystems': this.renderEcSystems(content); break;
      }
    };

    renderSidebar();
    renderContent();
    this._renderContent = renderContent;

    this.container.appendChild(sidebar);
    this.container.appendChild(content);
    return this.container;
  }

  // ── Helpers ──
  private section(parent: HTMLElement, title: string): HTMLElement {
    const h = document.createElement('div');
    h.style.cssText = 'font-size:14px;font-weight:600;color:#e0e0e0;margin:16px 0 8px;border-bottom:1px solid #444;padding-bottom:4px;';
    h.textContent = title;
    parent.appendChild(h);
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    parent.appendChild(div);
    return div;
  }

  private row(parent: HTMLElement, label: string): HTMLElement {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const lbl = document.createElement('label');
    lbl.style.cssText = 'width:140px;font-size:12px;color:#aaa;flex-shrink:0;';
    lbl.textContent = label;
    r.appendChild(lbl);
    parent.appendChild(r);
    return r;
  }

  private addSelect(parent: HTMLElement, label: string, options: string[], value: string, onChange: (v: string) => void): HTMLSelectElement {
    const r = this.row(parent, label);
    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1;background:#333;color:#ccc;border:1px solid #555;padding:3px 6px;border-radius:3px;font-size:12px;';
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      if (o === value) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    r.appendChild(sel);
    return sel;
  }

  private addSlider(parent: HTMLElement, label: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void): HTMLInputElement {
    const r = this.row(parent, label);
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = String(min); slider.max = String(max); slider.step = String(step); slider.value = String(value);
    slider.style.cssText = 'flex:1;accent-color:#0078d4;';
    const valSpan = document.createElement('span');
    valSpan.style.cssText = 'width:50px;text-align:right;font-size:11px;color:#888;';
    valSpan.textContent = String(value);
    slider.addEventListener('input', () => { const v = parseFloat(slider.value); valSpan.textContent = v.toFixed(step < 1 ? 2 : 0); onChange(v); });
    r.appendChild(slider);
    r.appendChild(valSpan);
    return slider;
  }

  private addCheckbox(parent: HTMLElement, label: string, checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
    const r = this.row(parent, label);
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = checked;
    cb.style.cssText = 'accent-color:#0078d4;';
    cb.addEventListener('change', () => onChange(cb.checked));
    r.appendChild(cb);
    return cb;
  }

  private addButton(parent: HTMLElement, label: string, onClick: () => void, bgColor?: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `padding:6px 14px;background:${bgColor || '#0078d4'};color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;margin:4px 2px;`;
    btn.addEventListener('click', onClick);
    parent.appendChild(btn);
    return btn;
  }

  private addColor(parent: HTMLElement, label: string, hex: string, onChange: (v: string) => void): HTMLInputElement {
    const r = this.row(parent, label);
    const inp = document.createElement('input');
    inp.type = 'color'; inp.value = hex;
    inp.style.cssText = 'width:40px;height:24px;border:none;background:none;cursor:pointer;';
    inp.addEventListener('input', () => onChange(inp.value));
    r.appendChild(inp);
    return inp;
  }

  private addNumber(parent: HTMLElement, label: string, value: number, step: number, onChange: (v: number) => void): HTMLInputElement {
    const r = this.row(parent, label);
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = String(value); inp.step = String(step);
    inp.style.cssText = 'width:80px;background:#333;color:#ccc;border:1px solid #555;padding:3px 6px;border-radius:3px;font-size:12px;';
    inp.addEventListener('change', () => onChange(parseFloat(inp.value) || 0));
    r.appendChild(inp);
    return inp;
  }

  // ── Weather System ──
  private renderWeather(parent: HTMLElement): void {
    const weather = this.editor.engine.weather;

    const header = document.createElement('div');
    header.style.cssText = 'font-size:18px;font-weight:600;color:#e0e0e0;margin-bottom:4px;';
    header.textContent = '🌦️ Weather System';
    parent.appendChild(header);
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:#888;margin-bottom:12px;';
    desc.textContent = 'Configure global weather, day/night cycle, and area-based weather zones.';
    parent.appendChild(desc);

    // Initialize weather if not done
    const initSec = this.section(parent, 'Initialization');
    let weatherInitialized = false;
    const initWeather = () => {
      if (weatherInitialized) return;
      weather.init(this.editor.scene, this.editor.editorCamera);
      let sun: THREE.DirectionalLight | undefined;
      let ambient: THREE.AmbientLight | undefined;
      this.editor.scene.traverse(obj => {
        if (!sun && obj instanceof THREE.DirectionalLight) sun = obj;
        if (!ambient && obj instanceof THREE.AmbientLight) ambient = obj;
      });
      if (!sun) {
        sun = new THREE.DirectionalLight(0xffffff, 1);
        sun.position.set(50, 80, 30);
        this.editor.scene.add(sun);
      }
      if (!ambient) {
        ambient = new THREE.AmbientLight(0x404060, 0.6);
        this.editor.scene.add(ambient);
      }
      weather.setLights(sun!, ambient!);
      weatherInitialized = true;
    };
    this.addButton(initSec, '▶ Initialize Weather', initWeather);

    // Global weather type
    const typeSec = this.section(parent, 'Global Weather (Default)');
    const types = ['clear', 'cloudy', 'rain', 'heavyRain', 'snow', 'fog', 'storm'];
    this.addSelect(typeSec, 'Type', types, 'clear', v => { initWeather(); weather.setWeather(v as any, 2); });
    this.addButton(typeSec, 'Apply Immediately', () => {
      initWeather();
      const sel = typeSec.querySelector('select') as HTMLSelectElement;
      if (sel) weather.setWeatherImmediate(sel.value as any);
    });

    // Day/Night
    const dnSec = this.section(parent, 'Day / Night Cycle');
    this.addCheckbox(dnSec, 'Enable Cycle', weather.dayNightEnabled, v => { weather.dayNightEnabled = v; });
    this.addSlider(dnSec, 'Time of Day (h)', 0, 24, 0.5, 12, v => weather.setTimeOfDay(v));

    // Wind
    const windSec = this.section(parent, 'Wind');
    this.addSlider(windSec, 'Wind X', -10, 10, 0.1, weather.wind.x, v => weather.wind.setX(v));
    this.addSlider(windSec, 'Wind Y', -10, 10, 0.1, weather.wind.y, v => weather.wind.setY(v));
    this.addSlider(windSec, 'Wind Z', -10, 10, 0.1, weather.wind.z, v => weather.wind.setZ(v));

    // ── Weather Zones ──
    const zoneSec = this.section(parent, 'Weather Zones');
    const zoneDesc = document.createElement('div');
    zoneDesc.style.cssText = 'font-size:10px;color:#777;margin-bottom:8px;';
    zoneDesc.textContent = 'Area-based weather overrides. Place boxes in the scene — weather transitions as the camera enters each zone.';
    zoneSec.appendChild(zoneDesc);

    // Show helpers toggle
    this.addCheckbox(zoneSec, 'Show Zone Wireframes', false, v => { initWeather(); weather.setShowZoneHelpers(v); });

    // Zone list container
    const zoneList = document.createElement('div');
    zoneList.style.cssText = 'margin-top:8px;';
    zoneSec.appendChild(zoneList);

    let nextZoneId = weather.getZones().length + 1;

    const refreshZoneList = () => {
      zoneList.innerHTML = '';
      const zones = weather.getZones();

      if (zones.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:11px;color:#666;padding:8px;text-align:center;';
        empty.textContent = 'No weather zones. Click "+ Add Zone" to create one.';
        zoneList.appendChild(empty);
        return;
      }

      for (const zone of zones) {
        const card = document.createElement('div');
        card.style.cssText = 'background:#2a2a2a;border:1px solid #444;border-radius:4px;padding:8px;margin-bottom:6px;';

        // Zone header
        const zHead = document.createElement('div');
        zHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';
        const zTitle = document.createElement('span');
        zTitle.style.cssText = 'font-size:12px;font-weight:600;color:#ddd;';
        zTitle.textContent = `🌐 ${zone.name}`;
        const delBtn = document.createElement('button');
        delBtn.style.cssText = 'background:#c62828;color:white;border:none;border-radius:3px;padding:2px 8px;font-size:10px;cursor:pointer;';
        delBtn.textContent = '✕ Remove';
        delBtn.addEventListener('click', () => { weather.removeZone(zone.id); refreshZoneList(); });
        zHead.appendChild(zTitle);
        zHead.appendChild(delBtn);
        card.appendChild(zHead);

        // Weather type
        this.addSelect(card, 'Weather', types, zone.weatherType, v => {
          weather.updateZone(zone.id, { weatherType: v as any });
        });

        // Position
        const posRow = this.row(card, 'Position');
        for (const axis of ['x', 'y', 'z'] as const) {
          const inp = document.createElement('input');
          inp.type = 'number'; inp.value = String(zone.position[axis]); inp.step = '1';
          inp.style.cssText = 'width:50px;background:#333;color:#ccc;border:1px solid #555;padding:2px 4px;border-radius:3px;font-size:11px;margin-right:4px;';
          inp.title = axis.toUpperCase();
          inp.addEventListener('change', () => {
            zone.position[axis] = parseFloat(inp.value) || 0;
            weather.updateZone(zone.id, { position: zone.position });
          });
          posRow.appendChild(inp);
        }

        // Size
        const sizeRow = this.row(card, 'Size (half)');
        for (const axis of ['x', 'y', 'z'] as const) {
          const inp = document.createElement('input');
          inp.type = 'number'; inp.value = String(zone.size[axis]); inp.step = '1'; inp.min = '1';
          inp.style.cssText = 'width:50px;background:#333;color:#ccc;border:1px solid #555;padding:2px 4px;border-radius:3px;font-size:11px;margin-right:4px;';
          inp.title = axis.toUpperCase();
          inp.addEventListener('change', () => {
            zone.size[axis] = Math.max(1, parseFloat(inp.value) || 1);
            weather.updateZone(zone.id, { size: zone.size });
          });
          sizeRow.appendChild(inp);
        }

        // Priority, blend, intensity
        this.addNumber(card, 'Priority', zone.priority, 1, v => weather.updateZone(zone.id, { priority: v }));
        this.addSlider(card, 'Blend Distance', 0, 50, 1, zone.blendDistance, v => weather.updateZone(zone.id, { blendDistance: v }));
        this.addSlider(card, 'Intensity', 0, 1, 0.05, zone.intensity, v => weather.updateZone(zone.id, { intensity: v }));

        zoneList.appendChild(card);
      }
    };

    this.addButton(zoneSec, '+ Add Zone', () => {
      initWeather();
      const camPos = this.editor.editorCamera?.position;
      weather.addZone({
        id: `zone_${nextZoneId++}`,
        name: `Zone ${nextZoneId - 1}`,
        weatherType: 'rain',
        position: new THREE.Vector3(camPos?.x ?? 0, camPos?.y ?? 5, camPos?.z ?? 0),
        size: new THREE.Vector3(20, 20, 20),
        priority: 1,
        blendDistance: 10,
        intensity: 1,
      });
      refreshZoneList();
    });

    refreshZoneList();
  }

  // ── Post Processing ──
  private renderPostProcessing(parent: HTMLElement): void {
    const pp = this.editor.engine.postProcessing;

    const header = document.createElement('div');
    header.style.cssText = 'font-size:18px;font-weight:600;color:#e0e0e0;margin-bottom:4px;';
    header.textContent = '✨ Post Processing';
    parent.appendChild(header);
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:#888;margin-bottom:12px;';
    desc.textContent = 'Screen-space effects: Bloom, vignette, color grading, FXAA.';
    parent.appendChild(desc);

    const globalSec = this.section(parent, 'Global');
    this.addCheckbox(globalSec, 'Enable Post Processing', pp.enabled, v => { pp.enabled = v; });

    // Bloom
    const bloomSec = this.section(parent, 'Bloom');
    const existingBloom = pp.getEffect<BloomEffect>('bloom');

    const bloomStrength = this.addSlider(bloomSec, 'Strength', 0, 3, 0.05, existingBloom?.strength ?? 1, v => {
      const b = pp.getEffect<BloomEffect>('bloom');
      if (b) b.strength = v;
    });
    const bloomThreshold = this.addSlider(bloomSec, 'Threshold', 0, 2, 0.05, existingBloom?.threshold ?? 0.8, v => {
      const b = pp.getEffect<BloomEffect>('bloom');
      if (b) b.threshold = v;
    });
    const bloomRadius = this.addSlider(bloomSec, 'Radius', 0, 2, 0.05, existingBloom?.radius ?? 0.4, v => {
      const b = pp.getEffect<BloomEffect>('bloom');
      if (b) b.radius = v;
    });

    this.addButton(bloomSec, existingBloom ? '🔄 Remove Bloom' : '➕ Add Bloom', () => {
      if (pp.getEffect('bloom')) {
        pp.removeEffect('bloom');
      } else {
        const bloom = new BloomEffect();
        bloom.strength = parseFloat(bloomStrength.value);
        bloom.threshold = parseFloat(bloomThreshold.value);
        bloom.radius = parseFloat(bloomRadius.value);
        pp.addEffect(bloom);
      }
      this.refresh();
    });

    // Vignette
    const vigSec = this.section(parent, 'Vignette');
    const existingVig = pp.getEffect<VignetteEffect>('vignette');
    this.addSlider(vigSec, 'Intensity', 0, 2, 0.05, existingVig?.intensity ?? 0.5, v => {
      const vig = pp.getEffect<VignetteEffect>('vignette');
      if (vig) vig.intensity = v;
    });
    this.addSlider(vigSec, 'Softness', 0, 2, 0.05, existingVig?.softness ?? 0.5, v => {
      const vig = pp.getEffect<VignetteEffect>('vignette');
      if (vig) vig.softness = v;
    });
    this.addButton(vigSec, existingVig ? '🔄 Remove Vignette' : '➕ Add Vignette', () => {
      if (pp.getEffect('vignette')) {
        pp.removeEffect('vignette');
      } else {
        pp.addEffect(new VignetteEffect());
      }
      this.refresh();
    });

    // Color Grading
    const cgSec = this.section(parent, 'Color Grading');
    const existingCG = pp.getEffect<ColorGradingEffect>('colorGrading');
    this.addSlider(cgSec, 'Brightness', -1, 1, 0.05, existingCG?.brightness ?? 0, v => {
      const cg = pp.getEffect<ColorGradingEffect>('colorGrading');
      if (cg) cg.brightness = v;
    });
    this.addSlider(cgSec, 'Contrast', 0, 3, 0.05, existingCG?.contrast ?? 1, v => {
      const cg = pp.getEffect<ColorGradingEffect>('colorGrading');
      if (cg) cg.contrast = v;
    });
    this.addSlider(cgSec, 'Saturation', 0, 3, 0.05, existingCG?.saturation ?? 1, v => {
      const cg = pp.getEffect<ColorGradingEffect>('colorGrading');
      if (cg) cg.saturation = v;
    });
    this.addSlider(cgSec, 'Gamma', 0.1, 3, 0.05, existingCG?.gamma ?? 1, v => {
      const cg = pp.getEffect<ColorGradingEffect>('colorGrading');
      if (cg) cg.gamma = v;
    });
    this.addButton(cgSec, existingCG ? '🔄 Remove Color Grading' : '➕ Add Color Grading', () => {
      if (pp.getEffect('colorGrading')) {
        pp.removeEffect('colorGrading');
      } else {
        pp.addEffect(new ColorGradingEffect());
      }
      this.refresh();
    });

    // FXAA
    const fxaaSec = this.section(parent, 'Anti-Aliasing');
    const existingFXAA = pp.getEffect('fxaa');
    this.addButton(fxaaSec, existingFXAA ? '🔄 Remove FXAA' : '➕ Add FXAA', () => {
      if (pp.getEffect('fxaa')) {
        pp.removeEffect('fxaa');
      } else {
        pp.addEffect(new FXAAEffect());
      }
      this.refresh();
    });

    // Depth of Field
    const dofSec = this.section(parent, 'Depth of Field');
    const existingDOF = pp.getEffect<DOFEffect>('dof');
    this.addButton(dofSec, existingDOF ? '🔄 Remove DOF' : '➕ Add DOF', () => {
      if (pp.getEffect('dof')) {
        pp.removeEffect('dof');
      } else {
        pp.addEffect(new DOFEffect());
      }
      this.refresh();
    });
    if (existingDOF) {
      this.addSlider(dofSec, 'Focus Distance', 0.1, 100, 0.1, existingDOF.focusDistance, v => { existingDOF.focusDistance = v; });
      this.addSlider(dofSec, 'Focus Range', 0.5, 50, 0.1, existingDOF.focusRange, v => { existingDOF.focusRange = v; });
      this.addSlider(dofSec, 'Bokeh Strength', 0, 3, 0.05, existingDOF.bokehStrength, v => { existingDOF.bokehStrength = v; });
    }

    // Motion Blur
    const mbSec = this.section(parent, 'Motion Blur');
    const existingMB = pp.getEffect<MotionBlurEffect>('motionBlur');
    this.addButton(mbSec, existingMB ? '🔄 Remove Motion Blur' : '➕ Add Motion Blur', () => {
      if (pp.getEffect('motionBlur')) {
        pp.removeEffect('motionBlur');
      } else {
        pp.addEffect(new MotionBlurEffect());
      }
      this.refresh();
    });
    if (existingMB) {
      this.addSlider(mbSec, 'Strength', 0, 2, 0.05, existingMB.strength, v => { existingMB.strength = v; });
      this.addSlider(mbSec, 'Samples', 2, 16, 1, existingMB.samples, v => { existingMB.samples = Math.round(v); });
    }

    // Chromatic Aberration
    const caSec = this.section(parent, 'Chromatic Aberration');
    const existingCA = pp.getEffect<ChromaticAberrationEffect>('chromaticAberration');
    this.addButton(caSec, existingCA ? '🔄 Remove Chromatic Ab.' : '➕ Add Chromatic Ab.', () => {
      if (pp.getEffect('chromaticAberration')) {
        pp.removeEffect('chromaticAberration');
      } else {
        pp.addEffect(new ChromaticAberrationEffect());
      }
      this.refresh();
    });
    if (existingCA) {
      this.addSlider(caSec, 'Strength', 0, 0.02, 0.0005, existingCA.strength, v => { existingCA.strength = v; });
    }

    // SSAO
    const ssaoSec = this.section(parent, 'SSAO');
    const existingSSAO = pp.getEffect<SSAOEffect>('ssao');
    this.addButton(ssaoSec, existingSSAO ? '🔄 Remove SSAO' : '➕ Add SSAO', () => {
      if (pp.getEffect('ssao')) {
        pp.removeEffect('ssao');
      } else {
        pp.addEffect(new SSAOEffect());
      }
      this.refresh();
    });
    if (existingSSAO) {
      this.addSlider(ssaoSec, 'Radius', 0.05, 2, 0.05, existingSSAO.radius, v => { existingSSAO.radius = v; });
      this.addSlider(ssaoSec, 'Intensity', 0, 3, 0.05, existingSSAO.intensity, v => { existingSSAO.intensity = v; });
      this.addSlider(ssaoSec, 'Bias', 0, 0.1, 0.005, existingSSAO.bias, v => { existingSSAO.bias = v; });
    }

    // Tone Mapping
    const tmSec = this.section(parent, 'Tone Mapping');
    const existingTM = pp.getEffect<ToneMappingEffect>('toneMapping');
    this.addButton(tmSec, existingTM ? '🔄 Remove Tone Mapping' : '➕ Add Tone Mapping', () => {
      if (pp.getEffect('toneMapping')) {
        pp.removeEffect('toneMapping');
      } else {
        pp.addEffect(new ToneMappingEffect());
      }
      this.refresh();
    });
    if (existingTM) {
      this.addSlider(tmSec, 'Exposure', 0.1, 5, 0.05, existingTM.exposure, v => { existingTM.exposure = v; });
      const modeRow = this.row(tmSec, 'Mode');
      const modeSelect = document.createElement('select');
      modeSelect.style.cssText = 'flex:1;background:#333;color:#ccc;border:1px solid #555;padding:3px 6px;border-radius:3px;font-size:12px;';
      for (const m of ['aces', 'reinhard', 'hable'] as ToneMappingMode[]) {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = m.charAt(0).toUpperCase() + m.slice(1);
        if (existingTM.mode === m) opt.selected = true;
        modeSelect.appendChild(opt);
      }
      modeSelect.addEventListener('change', () => { existingTM.mode = modeSelect.value as ToneMappingMode; });
      modeRow.appendChild(modeSelect);
    }

    // Film Grain
    const fgSec = this.section(parent, 'Film Grain');
    const existingFG = pp.getEffect<FilmGrainEffect>('filmGrain');
    this.addButton(fgSec, existingFG ? '🔄 Remove Film Grain' : '➕ Add Film Grain', () => {
      if (pp.getEffect('filmGrain')) {
        pp.removeEffect('filmGrain');
      } else {
        pp.addEffect(new FilmGrainEffect());
      }
      this.refresh();
    });
    if (existingFG) {
      this.addSlider(fgSec, 'Intensity', 0, 0.5, 0.01, existingFG.intensity, v => { existingFG.intensity = v; });
    }
  }

  // ── Performance ──
  private renderPerformance(parent: HTMLElement): void {
    const perf = this.editor.engine.performance;
    const eng = this.editor.engine;

    const header = document.createElement('div');
    header.style.cssText = 'font-size:18px;font-weight:600;color:#e0e0e0;margin-bottom:4px;';
    header.textContent = '⚡ Performance';
    parent.appendChild(header);
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:#888;margin-bottom:12px;';
    desc.textContent = 'Adaptive quality system — auto-adjusts rendering to maintain target FPS.';
    parent.appendChild(desc);

    // GPU Info
    const infoSec = this.section(parent, 'GPU Info');
    const infoText = document.createElement('div');
    infoText.style.cssText = 'font-size:12px;color:#aaa;line-height:1.6;';
    infoText.innerHTML = `
      GPU Tier: <b style="color:#fff">${perf.gpuTier.toUpperCase()}</b><br>
      WebGPU: <b style="color:${perf.webgpuSupported ? '#4ec' : '#f66'}">${perf.webgpuSupported ? 'Supported' : 'Not Available'}</b><br>
      Max Texture: ${perf.maxTextureSize}px | Anisotropy: ${perf.maxAnisotropy}x
    `;
    infoSec.appendChild(infoText);

    // Quality Level
    const qualSec = this.section(parent, 'Quality Level');
    const qualRow = this.row(qualSec, 'Preset');
    const qualSelect = document.createElement('select');
    qualSelect.style.cssText = 'flex:1;background:#333;color:#ccc;border:1px solid #555;padding:3px 6px;border-radius:3px;font-size:12px;';
    for (const level of ['ultra', 'high', 'medium', 'low', 'potato'] as const) {
      const opt = document.createElement('option');
      opt.value = level; opt.textContent = level.charAt(0).toUpperCase() + level.slice(1);
      if (perf.getQuality() === level) opt.selected = true;
      qualSelect.appendChild(opt);
    }
    qualSelect.addEventListener('change', () => {
      perf.setQuality(qualSelect.value as 'ultra' | 'high' | 'medium' | 'low' | 'potato');
    });
    qualRow.appendChild(qualSelect);

    // Adaptive Quality
    const adaptSec = this.section(parent, 'Adaptive Quality');
    this.addCheckbox(adaptSec, 'Enable Auto-Adjust', perf.enabled, v => { perf.enabled = v; });
    this.addSlider(adaptSec, 'Target FPS', 30, 144, 1, perf.targetFPS, v => { perf.targetFPS = Math.round(v); });

    // Shadow Budget
    const shadowSec = this.section(parent, 'Shadow Optimization');
    this.addSlider(shadowSec, 'Shadow Cast Distance', 20, 500, 10, eng.shadowCastDistance, v => { eng.shadowCastDistance = v; });
    this.addSlider(shadowSec, 'Max Shadow Lights', 1, 8, 1, eng.maxShadowLights, v => { eng.maxShadowLights = Math.round(v); });

    // Stats overlay toggle
    const statsSec = this.section(parent, 'Stats Overlay');
    this.addButton(statsSec, '📊 Toggle Stats Overlay (FPS, Draw Calls, Tris)', () => {
      eng.renderStats.toggle();
    });

    // Live stats (auto-refresh)
    const liveSec = this.section(parent, 'Live Stats');
    const liveText = document.createElement('div');
    liveText.style.cssText = 'font-size:12px;color:#aaa;line-height:1.6;font-family:monospace;';
    liveSec.appendChild(liveText);

    const updateLive = () => {
      if (!parent.isConnected) return;
      const fpsColor = perf.avgFPS >= 55 ? '#4ec' : perf.avgFPS >= 30 ? '#fa0' : '#f44';
      liveText.innerHTML = `
        FPS: <b style="color:${fpsColor}">${Math.round(perf.avgFPS)}</b> (${perf.avgFrameTime.toFixed(1)}ms)<br>
        Draw Calls: <b>${perf.drawCalls}</b> | Triangles: <b>${(perf.triangles / 1000).toFixed(1)}k</b><br>
        Textures: ${perf.textureMemory} | Geometries: ${perf.geometryCount}
      `;
      requestAnimationFrame(updateLive);
    };
    updateLive();
  }

  // ── Particles ──
  private renderParticles(parent: HTMLElement): void {
    const ps = this.editor.engine.particles;

    const header = document.createElement('div');
    header.style.cssText = 'font-size:18px;font-weight:600;color:#e0e0e0;margin-bottom:4px;';
    header.textContent = '🔥 Particle System';
    parent.appendChild(header);
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:#888;margin-bottom:12px;';
    desc.textContent = 'Create and manage particle emitters in the scene.';
    parent.appendChild(desc);

    // New emitter
    const createSec = this.section(parent, 'Create Emitter');
    let emitterName = 'emitter_' + Date.now();
    const nameRow = this.row(createSec, 'Name');
    const nameInp = document.createElement('input');
    nameInp.type = 'text'; nameInp.value = emitterName;
    nameInp.style.cssText = 'flex:1;background:#333;color:#ccc;border:1px solid #555;padding:3px 6px;border-radius:3px;font-size:12px;';
    nameInp.addEventListener('input', () => { emitterName = nameInp.value; });
    nameRow.appendChild(nameInp);

    const emitRate = this.addNumber(createSec, 'Emit Rate', 50, 1, () => {});
    const maxParticles = this.addNumber(createSec, 'Max Particles', 500, 10, () => {});
    const lifetime = this.addSlider(createSec, 'Lifetime (s)', 0.1, 10, 0.1, 2, () => {});
    const speed = this.addSlider(createSec, 'Speed', 0, 20, 0.1, 3, () => {});
    const size = this.addSlider(createSec, 'Size', 0.01, 5, 0.01, 0.2, () => {});
    const spread = this.addSlider(createSec, 'Spread', 0, 3.14, 0.01, 0.5, () => {});

    const colorRow = this.row(createSec, 'Color');
    const colorInp = document.createElement('input');
    colorInp.type = 'color'; colorInp.value = '#ff6600';
    colorInp.style.cssText = 'width:40px;height:24px;border:none;background:none;cursor:pointer;';
    colorRow.appendChild(colorInp);

    this.addButton(createSec, '✨ Create Emitter', () => {
      const c = new THREE.Color(colorInp.value);
      const camPos = this.editor.editorCamera.position.clone();
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.editor.editorCamera.quaternion);
      const spawnPos = camPos.add(dir.multiplyScalar(5));

      const emitter = ps.createEmitter(nameInp.value, {
        maxParticles: parseInt(maxParticles.value) || 500,
        emitRate: parseInt(emitRate.value) || 50,
        lifetime: [parseFloat(lifetime.value) || 2, parseFloat(lifetime.value) || 2],
        speed: [parseFloat(speed.value) || 3, parseFloat(speed.value) || 3],
        direction: new THREE.Vector3(0, 1, 0),
        spread: parseFloat(spread.value) || 0.5,
        size: [parseFloat(size.value) || 0.2, parseFloat(size.value) * 0.5 || 0.1],
        color: c,
        opacity: [1, 0],
      });
      emitter.position.copy(spawnPos);
      this.editor.scene.add(emitter.object3D);
    });

    // Active emitters
    const listSec = this.section(parent, 'Active Emitters');
    const emitters = (ps as any).emitters as Map<string, any> | undefined;
    if (emitters && emitters.size > 0) {
      emitters.forEach((_em: any, name: string) => {
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;';
        r.innerHTML = `<span style="flex:1;font-size:12px;color:#ccc;">🔥 ${name}</span>`;
        const rmBtn = document.createElement('button');
        rmBtn.textContent = '🗑️';
        rmBtn.style.cssText = 'background:#333;border:1px solid #555;color:#f44;cursor:pointer;padding:2px 6px;border-radius:3px;font-size:11px;';
        rmBtn.addEventListener('click', () => { ps.removeEmitter(name); this.renderParticles(parent.parentElement!.querySelector('[data-sys="particles"]') || parent); });
        r.appendChild(rmBtn);
        listSec.appendChild(r);
      });
    } else {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:11px;color:#666;padding:8px 0;';
      empty.textContent = 'No active emitters';
      listSec.appendChild(empty);
    }
  }

  // ── Camera Effects ──
  private renderCameraEffects(parent: HTMLElement): void {
    const ce = this.editor.engine.cameraEffects;

    const header = document.createElement('div');
    header.style.cssText = 'font-size:18px;font-weight:600;color:#e0e0e0;margin-bottom:4px;';
    header.textContent = '📷 Camera Effects';
    parent.appendChild(header);
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:#888;margin-bottom:12px;';
    desc.textContent = 'Camera shake, zoom, FOV, tilt, and cinematic effects.';
    parent.appendChild(desc);

    // Shake
    const shakeSec = this.section(parent, 'Camera Shake');
    const shakeIntensity = this.addSlider(shakeSec, 'Intensity', 0, 2, 0.01, 0.5, () => {});
    this.addButton(shakeSec, '📳 Trigger Shake', () => {
      ce.shake(parseFloat(shakeIntensity.value));
    });
    this.addButton(shakeSec, '💥 Impact', () => {
      ce.impact(parseFloat(shakeIntensity.value));
    });

    // Zoom Punch
    const zoomSec = this.section(parent, 'Zoom Punch');
    const zoomAmount = this.addSlider(zoomSec, 'Amount', 0, 20, 0.5, 5, () => {});
    const zoomDecay = this.addSlider(zoomSec, 'Decay Speed', 1, 30, 0.5, 10, () => {});
    this.addButton(zoomSec, '🔍 Zoom Punch', () => {
      ce.zoomPunch(parseFloat(zoomAmount.value), parseFloat(zoomDecay.value));
    });

    // FOV Kick
    const fovSec = this.section(parent, 'FOV');
    this.addSlider(fovSec, 'Camera FOV', 20, 120, 1, this.editor.editorCamera.fov, v => {
      this.editor.editorCamera.fov = v;
      this.editor.editorCamera.updateProjectionMatrix();
    });
    const fovOffset = this.addSlider(fovSec, 'Kick Offset', -30, 30, 1, 10, () => {});
    const fovSpeed = this.addSlider(fovSec, 'Speed', 1, 20, 0.5, 4, () => {});
    const fovReturn = this.addSlider(fovSec, 'Return Speed', 0.5, 10, 0.5, 2, () => {});
    this.addButton(fovSec, '🎯 FOV Kick', () => {
      ce.fovKick(parseFloat(fovOffset.value), parseFloat(fovSpeed.value), parseFloat(fovReturn.value));
    });

    // Tilt
    const tiltSec = this.section(parent, 'Camera Tilt');
    const tiltAngle = this.addSlider(tiltSec, 'Angle (°)', -45, 45, 1, 0, () => {});
    const tiltSpeed = this.addSlider(tiltSec, 'Speed', 0.5, 10, 0.5, 3, () => {});
    this.addButton(tiltSec, '↗️ Apply Tilt', () => {
      ce.setTilt(parseFloat(tiltAngle.value), parseFloat(tiltSpeed.value));
    });
    this.addButton(tiltSec, '↩️ Reset Tilt', () => {
      ce.resetTilt(parseFloat(tiltSpeed.value));
    });

    // Slow Motion / Bullet Time
    const timeSec = this.section(parent, 'Time Effects');
    const slowScale = this.addSlider(timeSec, 'Time Scale', 0.01, 2, 0.01, 1, () => {});
    this.addButton(timeSec, '🐌 Set Slow Motion', () => {
      ce.setSlowMotion(parseFloat(slowScale.value));
    });
    const btDuration = this.addSlider(timeSec, 'Bullet Time Duration', 0.1, 5, 0.1, 1, () => {});
    this.addButton(timeSec, '⏱️ Bullet Time', () => {
      ce.bulletTime(parseFloat(slowScale.value), parseFloat(btDuration.value));
    });

    // Cinematic Bars
    const cineSec = this.section(parent, 'Cinematic Bars');
    this.addButton(cineSec, '🎬 Show Bars', () => { ce.showCinematicBars(); });
    this.addButton(cineSec, '🎬 Hide Bars', () => { ce.hideCinematicBars(); });
  }

  // ── Audio ──
  private renderAudio(parent: HTMLElement): void {
    const audio = this.editor.engine.audio;

    const header = document.createElement('div');
    header.style.cssText = 'font-size:18px;font-weight:600;color:#e0e0e0;margin-bottom:4px;';
    header.textContent = '🔊 Audio Manager';
    parent.appendChild(header);
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:#888;margin-bottom:12px;';
    desc.textContent = 'Manage audio sources and global volume.';
    parent.appendChild(desc);

    const globalSec = this.section(parent, 'Global Settings');
    this.addSlider(globalSec, 'Master Volume', 0, 1, 0.01, audio.masterVolume, v => {
      audio.masterVolume = v;
    });
    this.addSlider(globalSec, 'Music Volume', 0, 1, 0.01, 0.5, v => {
      audio.setGroupVolume('music', v);
    });
    this.addSlider(globalSec, 'SFX Volume', 0, 1, 0.01, 1, v => {
      audio.setGroupVolume('sfx', v);
    });

    const musicSec = this.section(parent, 'Music');

    // Load BGM file
    const loadBgmRow = document.createElement('div');
    loadBgmRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
    const bgmFileInput = document.createElement('input');
    bgmFileInput.type = 'file';
    bgmFileInput.accept = 'audio/*';
    bgmFileInput.style.cssText = 'display:none;';
    bgmFileInput.addEventListener('change', () => {
      const file = bgmFileInput.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      audio.playMusic(url, 1, 0.5);
    });
    loadBgmRow.appendChild(bgmFileInput);
    this.addButton(loadBgmRow, '🎵 Load BGM', () => bgmFileInput.click());
    musicSec.appendChild(loadBgmRow);

    // Load ambient file
    const loadAmbRow = document.createElement('div');
    loadAmbRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
    const ambFileInput = document.createElement('input');
    ambFileInput.type = 'file';
    ambFileInput.accept = 'audio/*';
    ambFileInput.style.cssText = 'display:none;';
    ambFileInput.addEventListener('change', () => {
      const file = ambFileInput.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      audio.play(url, { loop: true, volume: 0.4, group: 'ambient' });
    });
    loadAmbRow.appendChild(ambFileInput);
    this.addButton(loadAmbRow, '🌳 Load Ambient', () => ambFileInput.click());
    musicSec.appendChild(loadAmbRow);

    // Load SFX test
    const loadSfxRow = document.createElement('div');
    loadSfxRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
    const sfxFileInput = document.createElement('input');
    sfxFileInput.type = 'file';
    sfxFileInput.accept = 'audio/*';
    sfxFileInput.style.cssText = 'display:none;';
    sfxFileInput.addEventListener('change', () => {
      const file = sfxFileInput.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      audio.oneShot(url, 1, 'sfx');
    });
    loadSfxRow.appendChild(sfxFileInput);
    this.addButton(loadSfxRow, '🔊 Test SFX', () => sfxFileInput.click());
    musicSec.appendChild(loadSfxRow);

    this.addButton(musicSec, '⏹️ Stop Music', () => { audio.stopMusic(); });
    this.addButton(musicSec, '⏭️ Next Track', () => { audio.nextTrack(); });
    this.addButton(musicSec, '🔇 Stop All', () => { audio.stopAll(0.5); });

    // Spatial audio info
    const spatialSec = this.section(parent, 'Spatial Audio');
    const spatialDesc = document.createElement('div');
    spatialDesc.style.cssText = 'font-size:11px;color:#888;margin-bottom:8px;';
    spatialDesc.textContent = 'Spatial audio uses HRTF panning. Add sounds via play() with spatial:true option. Listener follows editor camera.';
    spatialSec.appendChild(spatialDesc);

    this.addSlider(spatialSec, 'Ambient Volume', 0, 1, 0.01, 0.5, v => {
      audio.setGroupVolume('ambient', v);
    });
    this.addSlider(spatialSec, 'Voice Volume', 0, 1, 0.01, 1, v => {
      audio.setGroupVolume('voice', v);
    });
    this.addSlider(spatialSec, 'UI Volume', 0, 1, 0.01, 0.8, v => {
      audio.setGroupVolume('ui', v);
    });

    const infoSec = this.section(parent, 'Info');
    const stats = document.createElement('div');
    stats.style.cssText = 'font-size:12px;color:#aaa;';
    stats.textContent = `Active Sounds: ${audio.activeSoundCount}`;
    infoSec.appendChild(stats);

    // ── Audio Zones ──
    const zoneSec = this.section(parent, 'Audio Zones');
    const zoneDesc = document.createElement('div');
    zoneDesc.style.cssText = 'font-size:11px;color:#888;margin-bottom:8px;';
    zoneDesc.textContent = 'Spatial audio trigger zones. Sounds play when the camera enters a zone.';
    zoneSec.appendChild(zoneDesc);

    // Initialize zone scene
    audio.setZoneScene(this.editor.scene);

    // Show/hide helpers toggle
    this.addButton(zoneSec, '👁 Toggle Zone Helpers', () => {
      const zones = audio.getAudioZones();
      const anyVisible = zones.some(z => {
        const s = this.editor.scene;
        let found = false;
        s.traverse(c => { if ((c as any).userData?._audioZoneHelper) found = true; });
        return found;
      });
      audio.setShowAudioZoneHelpers(!anyVisible);
    });

    // Add zone button
    this.addButton(zoneSec, '➕ Add Audio Zone', () => {
      const cam = this.editor.editorCamera;
      const pos = new THREE.Vector3();
      cam.getWorldDirection(pos).multiplyScalar(10).add(cam.position);
      audio.addAudioZone({
        name: 'New Zone',
        position: pos,
        size: new THREE.Vector3(10, 10, 10),
        soundUrl: '',
        volume: 0.8,
        loop: true,
      });
      audio.setShowAudioZoneHelpers(true);
      this.refresh();
    });

    // List existing zones
    const zones = audio.getAudioZones();
    for (const zone of zones) {
      const zRow = document.createElement('div');
      zRow.style.cssText = 'background:#1e1e2e;border:1px solid #333;border-radius:4px;padding:8px;margin-bottom:6px;';

      const nameRow = document.createElement('div');
      nameRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
      const nameLabel = document.createElement('span');
      nameLabel.style.cssText = 'color:#aaa;font-size:11px;';
      nameLabel.textContent = `🔊 ${zone.name}`;
      const removeBtn = document.createElement('button');
      removeBtn.style.cssText = 'background:#6b2020;border:1px solid #8b3030;color:#ccc;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        audio.removeAudioZone(zone.id);
        this.refresh();
      });
      nameRow.appendChild(nameLabel);
      nameRow.appendChild(removeBtn);
      zRow.appendChild(nameRow);

      // Sound URL input
      const urlRow = document.createElement('div');
      urlRow.style.cssText = 'display:flex;gap:4px;margin-bottom:4px;align-items:center;';
      const urlLabel = document.createElement('span');
      urlLabel.style.cssText = 'color:#888;font-size:10px;min-width:40px;';
      urlLabel.textContent = 'Sound:';
      const urlBtn = document.createElement('button');
      urlBtn.style.cssText = 'background:#333;border:1px solid #444;color:#aaa;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;';
      urlBtn.textContent = zone.soundUrl ? '🔄 Change' : '📂 Load';
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'audio/*';
      fileInput.style.cssText = 'display:none;';
      fileInput.addEventListener('change', () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        zone.soundUrl = URL.createObjectURL(f);
        this.refresh();
      });
      urlBtn.addEventListener('click', () => fileInput.click());
      urlRow.appendChild(fileInput);
      urlRow.appendChild(urlLabel);
      urlRow.appendChild(urlBtn);
      if (zone.soundUrl) {
        const loaded = document.createElement('span');
        loaded.style.cssText = 'color:#4caf50;font-size:10px;';
        loaded.textContent = '✓ loaded';
        urlRow.appendChild(loaded);
      }
      zRow.appendChild(urlRow);

      this.addSlider(zRow, 'Volume', 0, 1, 0.01, zone.volume, v => {
        audio.updateAudioZone(zone.id, { volume: v });
      });

      zoneSec.appendChild(zRow);
    }
  }

  // ── LOD ──
  private renderLOD(parent: HTMLElement): void {
    const lod = this.editor.engine.lod;

    const header = document.createElement('div');
    header.style.cssText = 'font-size:18px;font-weight:600;color:#e0e0e0;margin-bottom:4px;';
    header.textContent = '🔍 LOD System';
    parent.appendChild(header);
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:#888;margin-bottom:12px;';
    desc.textContent = 'Level of Detail management for performance optimization.';
    parent.appendChild(desc);

    const settingsSec = this.section(parent, 'LOD Settings');
    this.addSlider(settingsSec, 'Distance Bias', -5, 5, 0.1, lod.distanceBias, v => {
      lod.distanceBias = v;
    });
    this.addSlider(settingsSec, 'Hysteresis', 1, 2, 0.01, lod.hysteresis, v => {
      lod.hysteresis = v;
    });

    const infoSec = this.section(parent, 'Statistics');
    const stats = lod.getStats();
    const statsDiv = document.createElement('div');
    statsDiv.style.cssText = 'font-size:12px;color:#aaa;';
    const lines = [`Total LOD Groups: ${stats.total}`];
    stats.byLevel.forEach((count, level) => {
      lines.push(`Level ${level}: ${count} objects`);
    });
    statsDiv.innerHTML = lines.join('<br>');
    infoSec.appendChild(statsDiv);
  }

  // ── Spline Paths ──
  private renderSplines(parent: HTMLElement): void {
    const splines = this.editor.splinePaths;

    const header = document.createElement('div');
    header.style.cssText = 'font-size:18px;font-weight:600;color:#e0e0e0;margin-bottom:4px;';
    header.textContent = '➰ Spline Paths';
    parent.appendChild(header);
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:#888;margin-bottom:12px;';
    desc.textContent = 'Create paths for camera rails, NPC movement, collision walls, and more.';
    parent.appendChild(desc);

    // Create path buttons (spawn preset shape)
    const createSec = this.section(parent, 'Create Path');
    const types: Array<{ type: 'movement' | 'collision' | 'camera' | 'generic'; label: string; icon: string }> = [
      { type: 'movement', label: 'Movement Path', icon: '🚶' },
      { type: 'camera', label: 'Camera Rail', icon: '🎥' },
      { type: 'collision', label: 'Collision Wall', icon: '🧱' },
      { type: 'generic', label: 'Generic Path', icon: '〰️' },
    ];
    for (const t of types) {
      this.addButton(createSec, `${t.icon} ${t.label}`, () => {
        const cam = this.editor.editorCamera;
        const dir = new THREE.Vector3();
        cam.getWorldDirection(dir);
        const base = cam.position.clone().add(dir.multiplyScalar(5));
        const right = new THREE.Vector3().crossVectors(dir, cam.up).normalize();
        const pathName = `${t.type}_${Date.now()}`;
        splines.createPath({
          name: pathName,
          points: [
            base.clone().add(right.clone().multiplyScalar(-3)),
            base.clone(),
            base.clone().add(right.clone().multiplyScalar(3)),
          ],
          closed: false,
          type: t.type,
          tension: 0.5,
        });
        this.refresh();
      });
    }

    // Draw path buttons (click-to-place visual drawing mode)
    const drawSec = this.section(parent, 'Draw Path (Click to Place)');
    const drawDesc = document.createElement('div');
    drawDesc.style.cssText = 'font-size:10px;color:#888;margin-bottom:6px;';
    drawDesc.textContent = 'Left-click to place points. Right-click or Enter to finish. Escape to cancel. Ctrl+Z to undo.';
    drawSec.appendChild(drawDesc);

    if (this._drawingSpline) {
      const statusDiv = document.createElement('div');
      statusDiv.style.cssText = 'background:#3a3a20;border:1px solid #6a6a30;border-radius:4px;padding:6px;margin-bottom:6px;color:#ff0;font-size:11px;text-align:center;';
      statusDiv.textContent = `✏️ Drawing ${this._drawingType} — ${this._drawingPoints.length} points placed`;
      drawSec.appendChild(statusDiv);
      this.addButton(drawSec, '✅ Finish Path', () => this.stopDrawingSpline(true), '#2a5a2a');
      this.addButton(drawSec, '❌ Cancel', () => this.stopDrawingSpline(false), '#5a2a2a');
    } else {
      for (const t of types) {
        this.addButton(drawSec, `✏️ Draw ${t.label}`, () => {
          this.startDrawingSpline(t.type);
          this.refresh();
        });
      }
    }

    // List existing paths
    const allPaths = splines.getAllPaths();
    if (allPaths.length > 0) {
      const listSec = this.section(parent, `Paths (${allPaths.length})`);
      for (const path of allPaths) {
        const row = document.createElement('div');
        row.style.cssText = 'background:#1e1e2e;border:1px solid #333;border-radius:4px;padding:8px;margin-bottom:6px;';

        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'color:#aaa;font-size:11px;';
        const colorMap = { movement: '🟢', collision: '🔴', camera: '🔵', generic: '⚪' };
        nameSpan.textContent = `${colorMap[path.type] || '⚪'} ${path.name} (${path.points.length} pts)`;
        const removeBtn = document.createElement('button');
        removeBtn.style.cssText = 'background:#6b2020;border:1px solid #8b3030;color:#ccc;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:10px;';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => {
          splines.removePath(path.name);
          this.refresh();
        });
        headerRow.appendChild(nameSpan);
        headerRow.appendChild(removeBtn);
        row.appendChild(headerRow);

        // Add point button
        this.addButton(row, '➕ Add Point', () => {
          const cam = this.editor.editorCamera;
          const dir = new THREE.Vector3();
          cam.getWorldDirection(dir);
          path.addPoint(cam.position.clone().add(dir.multiplyScalar(5)));
          this.refresh();
        });

        // Per-point editing
        const pointsSec = document.createElement('div');
        pointsSec.style.cssText = 'margin-top:6px;max-height:160px;overflow-y:auto;';
        for (let i = 0; i < path.points.length; i++) {
          const pt = path.points[i];
          const ptRow = document.createElement('div');
          ptRow.style.cssText = 'display:flex;align-items:center;gap:3px;margin-bottom:2px;';

          const label = document.createElement('span');
          label.style.cssText = 'color:#888;font-size:10px;width:20px;flex-shrink:0;';
          label.textContent = `P${i}`;
          ptRow.appendChild(label);

          for (const axis of ['x', 'y', 'z'] as const) {
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.value = pt[axis].toFixed(1);
            inp.step = '0.5';
            inp.style.cssText = 'width:52px;background:#333;color:#ccc;border:1px solid #555;padding:2px 3px;border-radius:2px;font-size:10px;';
            inp.title = axis.toUpperCase();
            const capturedIdx = i;
            inp.addEventListener('change', () => {
              pt[axis] = parseFloat(inp.value) || 0;
              path.movePoint(capturedIdx, pt);
            });
            ptRow.appendChild(inp);
          }

          // Select point in viewport
          const selectBtn = document.createElement('button');
          selectBtn.style.cssText = 'background:#2a3a5a;border:1px solid #4a5a7a;color:#aaf;padding:1px 4px;border-radius:2px;cursor:pointer;font-size:9px;';
          selectBtn.textContent = '⊙';
          selectBtn.title = 'Select in viewport';
          const selectIdx = i;
          selectBtn.addEventListener('click', () => {
            // Find the point mesh in the scene and select it
            this.editor.scene.traverse(child => {
              if (child.userData._splineName === path.name && child.userData._splinePointIndex === selectIdx) {
                this.editor.select(child);
              }
            });
          });
          ptRow.appendChild(selectBtn);

          // Remove point button
          if (path.points.length > 2) {
            const rmBtn = document.createElement('button');
            rmBtn.style.cssText = 'background:#5a2020;border:1px solid #8a3030;color:#faa;padding:1px 4px;border-radius:2px;cursor:pointer;font-size:9px;';
            rmBtn.textContent = '✕';
            rmBtn.title = 'Remove point';
            const rmIdx = i;
            rmBtn.addEventListener('click', () => {
              path.removePoint(rmIdx);
              this.refresh();
            });
            ptRow.appendChild(rmBtn);
          }

          pointsSec.appendChild(ptRow);
        }
        row.appendChild(pointsSec);

        // Tension slider
        this.addSlider(row, 'Tension', 0, 1, 0.05, path.tension, v => {
          path.tension = v;
          (path as any).rebuildCurve();
        });

        // Closed toggle
        const closedRow = document.createElement('div');
        closedRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:4px;';
        const closedLabel = document.createElement('span');
        closedLabel.style.cssText = 'color:#888;font-size:10px;';
        closedLabel.textContent = 'Closed loop:';
        const closedCheck = document.createElement('input');
        closedCheck.type = 'checkbox';
        closedCheck.checked = path.closed;
        closedCheck.addEventListener('change', () => {
          path.closed = closedCheck.checked;
          path['rebuildCurve']();
        });
        closedRow.appendChild(closedLabel);
        closedRow.appendChild(closedCheck);
        row.appendChild(closedRow);

        listSec.appendChild(row);
      }
    }
  }

  // ── Spline Drawing Mode ──

  private startDrawingSpline(type: 'movement' | 'collision' | 'camera' | 'generic'): void {
    if (this._drawingSpline) this.stopDrawingSpline(false);
    this._drawingSpline = true;
    this._drawingType = type;
    this._drawingPoints = [];

    const canvas = (this.editor as any).editorCanvas as HTMLCanvasElement;
    if (!canvas) return;

    canvas.style.cursor = 'crosshair';
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._drawClickHandler = (e: MouseEvent) => {
      if (e.button !== 0) return; // left click only
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, this.editor.editorCamera);

      // Try to hit scene objects first, fallback to ground plane
      const meshes: THREE.Object3D[] = [];
      this.editor.scene.traverse(obj => {
        if ((obj as THREE.Mesh).isMesh && obj.visible) meshes.push(obj);
      });
      const hits = raycaster.intersectObjects(meshes, false);
      let point: THREE.Vector3;
      if (hits.length > 0) {
        point = hits[0].point.clone();
      } else {
        const target = new THREE.Vector3();
        raycaster.ray.intersectPlane(groundPlane, target);
        point = target;
      }

      this._drawingPoints.push(point);
      this.updateDrawingPreview();
    };

    this._drawContextHandler = (e: MouseEvent) => {
      e.preventDefault();
      // Right-click finishes drawing
      this.stopDrawingSpline(true);
    };

    this._drawKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.stopDrawingSpline(false); // cancel
      } else if (e.key === 'Enter') {
        this.stopDrawingSpline(true); // finish
      } else if ((e.key === 'z' || e.key === 'Z') && e.ctrlKey && this._drawingPoints.length > 0) {
        this._drawingPoints.pop(); // undo last point
        this.updateDrawingPreview();
      }
    };

    canvas.addEventListener('click', this._drawClickHandler);
    canvas.addEventListener('contextmenu', this._drawContextHandler);
    window.addEventListener('keydown', this._drawKeyHandler);
  }

  private updateDrawingPreview(): void {
    const scene = this.editor.scene;

    // Remove old preview
    if (this._drawingPreviewLine) {
      scene.remove(this._drawingPreviewLine);
      this._drawingPreviewLine.geometry.dispose();
      (this._drawingPreviewLine.material as THREE.Material).dispose();
      this._drawingPreviewLine = null;
    }
    for (const s of this._drawingPreviewSpheres) {
      scene.remove(s);
      s.geometry.dispose();
      (s.material as THREE.Material).dispose();
    }
    this._drawingPreviewSpheres = [];

    if (this._drawingPoints.length === 0) return;

    // Draw preview line
    if (this._drawingPoints.length >= 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(this._drawingPoints);
      const mat = new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false, linewidth: 2 });
      this._drawingPreviewLine = new THREE.Line(geo, mat);
      this._drawingPreviewLine.renderOrder = 999;
      scene.add(this._drawingPreviewLine);
    }

    // Draw point spheres
    const sphereGeo = new THREE.SphereGeometry(0.3, 8, 8);
    for (const pt of this._drawingPoints) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false });
      const sphere = new THREE.Mesh(sphereGeo, mat);
      sphere.position.copy(pt);
      sphere.renderOrder = 1000;
      scene.add(sphere);
      this._drawingPreviewSpheres.push(sphere);
    }
  }

  private stopDrawingSpline(commit: boolean): void {
    if (!this._drawingSpline) return;
    this._drawingSpline = false;

    const canvas = (this.editor as any).editorCanvas as HTMLCanvasElement;
    if (canvas) {
      canvas.style.cursor = '';
      if (this._drawClickHandler) canvas.removeEventListener('click', this._drawClickHandler);
      if (this._drawContextHandler) canvas.removeEventListener('contextmenu', this._drawContextHandler);
    }
    if (this._drawKeyHandler) window.removeEventListener('keydown', this._drawKeyHandler);
    this._drawClickHandler = null;
    this._drawContextHandler = null;
    this._drawKeyHandler = null;

    // Clean up preview
    const scene = this.editor.scene;
    if (this._drawingPreviewLine) {
      scene.remove(this._drawingPreviewLine);
      this._drawingPreviewLine.geometry.dispose();
      (this._drawingPreviewLine.material as THREE.Material).dispose();
      this._drawingPreviewLine = null;
    }
    for (const s of this._drawingPreviewSpheres) {
      scene.remove(s);
      s.geometry.dispose();
      (s.material as THREE.Material).dispose();
    }
    this._drawingPreviewSpheres = [];

    // Create the path if we have enough points
    if (commit && this._drawingPoints.length >= 2) {
      const pathName = `${this._drawingType}_${Date.now()}`;
      this.editor.splinePaths.createPath({
        name: pathName,
        points: this._drawingPoints,
        closed: this._drawingType === 'collision',
        type: this._drawingType,
        tension: 0.5,
      });
    }

    this._drawingPoints = [];
    this.refresh();
  }

  // ── ECS Systems ──────────────────────────────────────────────────────────────

  /** Render the live ECS system list with enable/disable toggles and last-frame timings. */
  private renderEcSystems(parent: HTMLElement): void {
    const world = this.editor.engine.world;
    const systems = world.getSystems();

    const header = this.section(parent, 'ECS Systems');
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:#888;margin-bottom:12px;';
    desc.textContent = `${systems.length} system${systems.length !== 1 ? 's' : ''} registered. Toggle enabled state at runtime. Frame times are sampled each second.`;
    header.appendChild(desc);

    if (systems.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:11px;color:#555;padding:12px 0;';
      empty.textContent = 'No ECS systems registered in the active world.';
      parent.appendChild(empty);
      return;
    }

    // Table header
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;';
    table.innerHTML = `
      <thead>
        <tr style="border-bottom:1px solid #444;color:#888;">
          <th style="text-align:left;padding:4px 6px;font-weight:500;">System</th>
          <th style="text-align:right;padding:4px 6px;font-weight:500;">Priority</th>
          <th style="text-align:right;padding:4px 6px;font-weight:500;">Last (ms)</th>
          <th style="text-align:center;padding:4px 6px;font-weight:500;">Enabled</th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement('tbody');
    const timingCells = new Map<object, HTMLTableCellElement>();

    for (const system of systems) {
      const name = system.constructor.name.replace('System', '');
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid #2a2a2a;';

      // Name
      const tdName = document.createElement('td');
      tdName.style.cssText = 'padding:5px 6px;color:#ddd;';
      tdName.textContent = name;

      // Priority
      const tdPri = document.createElement('td');
      tdPri.style.cssText = 'padding:5px 6px;text-align:right;color:#888;';
      tdPri.textContent = String(system.priority);

      // Last frame time (polled)
      const tdLast = document.createElement('td');
      tdLast.style.cssText = 'padding:5px 6px;text-align:right;color:#888;font-family:monospace;';
      tdLast.textContent = '—';
      timingCells.set(system, tdLast);

      // Enabled toggle
      const tdEnabled = document.createElement('td');
      tdEnabled.style.cssText = 'padding:5px 6px;text-align:center;';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = system.enabled;
      toggle.style.accentColor = '#0078d4';
      toggle.addEventListener('change', () => {
        system.enabled = toggle.checked;
        tdName.style.color = toggle.checked ? '#ddd' : '#555';
      });
      tdEnabled.appendChild(toggle);

      tr.append(tdName, tdPri, tdLast, tdEnabled);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    parent.appendChild(table);

    // ── Poll frame timings every second ──────────────────────────────────────
    const POLL_MS = 1000;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // Observe panel visibility
    const observer = new IntersectionObserver((entries) => {
      const visible = entries[0]?.isIntersecting ?? false;
      if (visible && !pollTimer) {
        pollTimer = setInterval(() => {
          // getSystemTimings() returns the ms each system took in the last completed frame
          const timings = world.getSystemTimings();
          for (const [sys, cell] of timingCells) {
            const ms = timings.get(sys as import('../../ecs/System').System);
            if (ms === undefined) { cell.textContent = '—'; cell.style.color = '#555'; continue; }
            cell.textContent = ms >= 0.01 ? ms.toFixed(2) : '< 0.01';
            cell.style.color = ms > 4 ? '#f88' : '#8f8';
          }
        }, POLL_MS);
      } else if (!visible && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    });

    // Observe the table to start/stop polling when the tab becomes visible
    observer.observe(table);

    // Clean up when the section is replaced or the panel is disposed
    // (the deprecated mutation event used before no longer fires in current Chromium).
    this._sectionCleanups.push(() => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      observer.disconnect();
    });
  }
}
