/**
 * MaterialEditor — Full PBR material editor with node graph visualization,
 * custom shader editor, material library, instancing, and auto-setup.
 */

import * as THREE from 'three';
import type { EditorApp } from '../EditorApp';
import { MaterialLibrary, MaterialDefinition } from '../../engine/MaterialLibrary';

interface MaterialPreset {
  name: string;
  type: string;
  props: Record<string, unknown>;
}

const PRESETS: MaterialPreset[] = [
  { name: 'Default', type: 'MeshStandardMaterial', props: { color: 0xcccccc, roughness: 0.7, metalness: 0.0 } },
  { name: 'Metal', type: 'MeshStandardMaterial', props: { color: 0xaaaaaa, roughness: 0.15, metalness: 1.0 } },
  { name: 'Gold', type: 'MeshStandardMaterial', props: { color: 0xffd700, roughness: 0.2, metalness: 1.0 } },
  { name: 'Glass', type: 'MeshPhysicalMaterial', props: { color: 0xffffff, roughness: 0.05, metalness: 0.0, transmission: 0.95, thickness: 0.5, ior: 1.5 } },
  { name: 'Plastic', type: 'MeshStandardMaterial', props: { color: 0xff4444, roughness: 0.4, metalness: 0.0 } },
  { name: 'Wood', type: 'MeshStandardMaterial', props: { color: 0x8B4513, roughness: 0.85, metalness: 0.0 } },
  { name: 'Emissive', type: 'MeshStandardMaterial', props: { color: 0x111111, emissive: 0x00ff88, emissiveIntensity: 2.0, roughness: 0.5 } },
  { name: 'Ceramic', type: 'MeshPhysicalMaterial', props: { color: 0xeeeeee, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 } },
  { name: 'Fabric', type: 'MeshPhysicalMaterial', props: { color: 0x6644aa, roughness: 1.0, metalness: 0.0, sheen: 0.8, sheenRoughness: 0.3 } },
  { name: 'Skin', type: 'MeshPhysicalMaterial', props: { color: 0xd4a574, roughness: 0.7, metalness: 0.0, transmission: 0.1, thickness: 2.0 } },
  { name: 'Diamond', type: 'MeshPhysicalMaterial', props: { color: 0xffffff, roughness: 0, metalness: 0, transmission: 1, ior: 2.42, thickness: 1.0 } },
  { name: 'Water', type: 'MeshPhysicalMaterial', props: { color: 0x2288cc, roughness: 0, metalness: 0, transmission: 0.9, ior: 1.33, thickness: 3.0 } },
  { name: 'Iridescent', type: 'MeshPhysicalMaterial', props: { color: 0x333333, roughness: 0.2, metalness: 0.8, iridescence: 1.0, iridescenceIOR: 1.8 } },
  { name: 'Brushed Metal', type: 'MeshPhysicalMaterial', props: { color: 0xbbbbbb, roughness: 0.3, metalness: 1.0, anisotropy: 1.0 } },
  { name: 'Unlit', type: 'MeshBasicMaterial', props: { color: 0xffffff } },
  { name: 'Wireframe', type: 'MeshBasicMaterial', props: { color: 0x00ff00, wireframe: true } },
  { name: 'Toon', type: 'MeshToonMaterial', props: { color: 0x44aaff } },
];

// Node graph types for material connections visualization
interface MatNode {
  id: string;
  type: 'output' | 'texture' | 'color' | 'value' | 'math' | 'fresnel' | 'normal';
  label: string;
  x: number;
  y: number;
  inputs: string[];
  outputs: string[];
  data: Record<string, unknown>;
}

interface MatConnection {
  fromNode: string;
  fromOutput: string;
  toNode: string;
  toInput: string;
}

// Tabs
type EditorTab = 'properties' | 'graph' | 'library' | 'shader';

export class MaterialEditor {
  private editor: EditorApp;
  private container: HTMLElement | null = null;
  private propsArea!: HTMLElement;
  private previewCanvas!: HTMLCanvasElement;
  private previewRenderer!: THREE.WebGLRenderer;
  private previewScene!: THREE.Scene;
  private previewCamera!: THREE.PerspectiveCamera;
  private previewSphere!: THREE.Mesh;
  private currentMaterial: THREE.Material | null = null;
  private animFrameId = 0;
  private activeTab: EditorTab = 'properties';
  private tabContent!: HTMLElement;

  // Library
  public library = new MaterialLibrary();

  // Node graph
  private graphCanvas!: HTMLCanvasElement;
  private graphCtx!: CanvasRenderingContext2D;
  private graphResizeObserver: ResizeObserver | null = null;
  private nodes: MatNode[] = [];
  private connections: MatConnection[] = [];
  private graphPan = { x: 0, y: 0 };
  private graphScale = 1;

  // Shader editor
  private shaderVertArea!: HTMLTextAreaElement;
  private shaderFragArea!: HTMLTextAreaElement;

  constructor(editor: EditorApp) {
    this.editor = editor;
  }

  /** Dispose old preview material before assigning a new clone */
  private setPreviewMaterial(mat: THREE.Material): void {
    if (this.previewSphere) {
      const old = this.previewSphere.material;
      if (old && old !== mat) {
        if (Array.isArray(old)) old.forEach(m => m.dispose());
        else old.dispose();
      }
      this.previewSphere.material = mat.clone();
    }
  }

  render(): HTMLElement {
    if (this.container) {
      return this.container;
    }

    this.container = document.createElement('div');
    this.container.className = 'material-editor';
    this.container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = '<span>🎨 MATERIAL EDITOR</span>';
    this.container.appendChild(header);

    // Preview area
    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'height:140px;min-height:140px;background:#111;position:relative;border-bottom:1px solid #333;';
    this.previewCanvas = document.createElement('canvas');
    this.previewCanvas.style.cssText = 'width:100%;height:100%;';
    previewWrap.appendChild(this.previewCanvas);

    // Preview shape buttons
    const shapeBar = document.createElement('div');
    shapeBar.style.cssText = 'position:absolute;bottom:4px;right:4px;display:flex;gap:2px;';
    for (const [icon, geo] of [['⚫', 'sphere'], ['⬜', 'box'], ['🔵', 'cylinder'], ['⬛', 'plane']] as const) {
      const btn = document.createElement('button');
      btn.textContent = icon;
      btn.title = geo;
      btn.style.cssText = 'background:rgba(0,0,0,0.6);border:1px solid #555;color:#ccc;padding:1px 4px;font-size:11px;cursor:pointer;border-radius:2px;';
      btn.addEventListener('click', () => this.setPreviewGeometry(geo));
      shapeBar.appendChild(btn);
    }
    previewWrap.appendChild(shapeBar);
    this.container.appendChild(previewWrap);

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;background:#1a1a1a;border-bottom:1px solid #333;flex-shrink:0;';
    const tabs: { id: EditorTab; label: string }[] = [
      { id: 'properties', label: '📋 Properties' },
      { id: 'graph', label: '🔗 Graph' },
      { id: 'library', label: '📚 Library' },
      { id: 'shader', label: '💻 Shader' },
    ];
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.textContent = tab.label;
      btn.dataset.tab = tab.id;
      btn.style.cssText = 'flex:1;background:none;border:none;color:#888;padding:6px 4px;font-size:10px;cursor:pointer;border-bottom:2px solid transparent;';
      if (tab.id === this.activeTab) {
        btn.style.color = '#fff';
        btn.style.borderBottomColor = '#0078d4';
      }
      btn.addEventListener('click', () => this.switchTab(tab.id));
      tabBar.appendChild(btn);
    }
    this.container.appendChild(tabBar);

    // Tab content
    this.tabContent = document.createElement('div');
    this.tabContent.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;';
    this.container.appendChild(this.tabContent);

    this.setupPreview();
    this.switchTab(this.activeTab);
    return this.container;
  }

  refresh(): void {
    if (!this.container) return;
    const obj = this.editor.state.selectedObject;
    if (!obj || !(obj instanceof THREE.Mesh)) {
      this.currentMaterial = null;
      this.switchTab(this.activeTab);
      return;
    }

    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    this.currentMaterial = mat;
    this.setPreviewMaterial(mat);
    this.switchTab(this.activeTab);
  }

  private switchTab(tab: EditorTab): void {
    if (!this.container) return;
    this.activeTab = tab;
    this.tabContent.innerHTML = '';

    // Update tab button styles
    const buttons = this.container.querySelectorAll('[data-tab]') as NodeListOf<HTMLButtonElement>;
    buttons.forEach(btn => {
      const isActive = btn.dataset.tab === tab;
      btn.style.color = isActive ? '#fff' : '#888';
      btn.style.borderBottomColor = isActive ? '#0078d4' : 'transparent';
    });

    switch (tab) {
      case 'properties': this.renderPropertiesTab(); break;
      case 'graph': this.renderGraphTab(); break;
      case 'library': this.renderLibraryTab(); break;
      case 'shader': this.renderShaderTab(); break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PROPERTIES TAB
  // ═══════════════════════════════════════════════════════════════════

  private renderPropertiesTab(): void {
    this.propsArea = document.createElement('div');
    this.propsArea.style.cssText = 'flex:1;overflow-y:auto;padding:8px;';

    if (!this.currentMaterial) {
      this.propsArea.innerHTML = '<div style="color:#555;text-align:center;padding:20px;">Select a mesh to edit its material</div>';
      this.tabContent.appendChild(this.propsArea);
      return;
    }

    // Presets bar
    const presetsBar = document.createElement('div');
    presetsBar.style.cssText = 'display:flex;gap:4px;padding:6px 0;overflow-x:auto;flex-shrink:0;flex-wrap:wrap;';
    for (const preset of PRESETS) {
      const btn = document.createElement('button');
      btn.textContent = preset.name;
      btn.title = preset.type;
      btn.style.cssText = 'background:#333;border:1px solid #444;color:#aaa;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:9px;white-space:nowrap;';
      btn.addEventListener('click', () => this.applyPreset(preset));
      presetsBar.appendChild(btn);
    }
    this.propsArea.appendChild(presetsBar);

    this.buildProperties(this.currentMaterial);
    this.tabContent.appendChild(this.propsArea);
  }

  private buildProperties(mat: THREE.Material): void {
    // Material type selector
    this.addLabel(`Type: ${mat.type}`);

    // Convert type buttons
    const typeBar = document.createElement('div');
    typeBar.style.cssText = 'display:flex;gap:4px;margin:4px 0 8px;';
    for (const t of ['Standard', 'Physical', 'Basic', 'Toon']) {
      const btn = document.createElement('button');
      btn.textContent = t;
      btn.style.cssText = `background:${mat.type.includes(t) ? '#0078d4' : '#333'};border:1px solid #444;color:#ccc;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:9px;`;
      btn.addEventListener('click', () => this.convertMaterialType(t.toLowerCase()));
      typeBar.appendChild(btn);
    }
    this.propsArea.appendChild(typeBar);
    this.addSeparator();

    // Common PBR properties
    if ('color' in mat) {
      this.addColorProp('Color', (mat as THREE.MeshStandardMaterial).color, (c) => {
        (mat as THREE.MeshStandardMaterial).color.copy(c);
        this.updatePreview();
      });
    }

    if ('roughness' in mat) {
      this.addSliderProp('Roughness', (mat as THREE.MeshStandardMaterial).roughness, 0, 1, 0.01, (v) => {
        (mat as THREE.MeshStandardMaterial).roughness = v;
        this.updatePreview();
      });
    }

    if ('metalness' in mat) {
      this.addSliderProp('Metalness', (mat as THREE.MeshStandardMaterial).metalness, 0, 1, 0.01, (v) => {
        (mat as THREE.MeshStandardMaterial).metalness = v;
        this.updatePreview();
      });
    }

    if ('emissive' in mat) {
      this.addColorProp('Emissive', (mat as THREE.MeshStandardMaterial).emissive, (c) => {
        (mat as THREE.MeshStandardMaterial).emissive.copy(c);
        this.updatePreview();
      });
      this.addSliderProp('Emissive Intensity', (mat as THREE.MeshStandardMaterial).emissiveIntensity, 0, 10, 0.1, (v) => {
        (mat as THREE.MeshStandardMaterial).emissiveIntensity = v;
        this.updatePreview();
      });
    }

    if ('normalScale' in mat) {
      const ns = (mat as THREE.MeshStandardMaterial).normalScale;
      this.addSliderProp('Normal Scale', ns.x, 0, 3, 0.01, (v) => {
        (mat as THREE.MeshStandardMaterial).normalScale.set(v, v);
        this.updatePreview();
      });
    }

    // Opacity
    this.addSliderProp('Opacity', mat.opacity, 0, 1, 0.01, (v) => {
      mat.opacity = v;
      mat.transparent = v < 1;
      this.updatePreview();
    });

    // Physical material extras
    if (mat instanceof THREE.MeshPhysicalMaterial) {
      this.addSeparator();
      this.addLabel('Physical Properties');

      this.addSliderProp('Clearcoat', mat.clearcoat, 0, 1, 0.01, (v) => { mat.clearcoat = v; this.updatePreview(); });
      this.addSliderProp('Clearcoat Roughness', mat.clearcoatRoughness, 0, 1, 0.01, (v) => { mat.clearcoatRoughness = v; this.updatePreview(); });

      this.addSeparator();
      this.addLabel('Transmission / Glass');
      this.addSliderProp('Transmission', mat.transmission, 0, 1, 0.01, (v) => { mat.transmission = v; mat.transparent = v > 0; this.updatePreview(); });
      this.addSliderProp('IOR', mat.ior, 1, 2.5, 0.01, (v) => { mat.ior = v; this.updatePreview(); });
      this.addSliderProp('Thickness', mat.thickness, 0, 10, 0.1, (v) => { mat.thickness = v; this.updatePreview(); });
      this.addColorProp('Attenuation Color', mat.attenuationColor, (c) => { mat.attenuationColor.copy(c); this.updatePreview(); });
      this.addSliderProp('Attenuation Distance', mat.attenuationDistance === Infinity ? 100 : mat.attenuationDistance, 0, 100, 0.5, (v) => { mat.attenuationDistance = v >= 100 ? Infinity : v; this.updatePreview(); });

      this.addSeparator();
      this.addLabel('Sheen (Fabric)');
      this.addSliderProp('Sheen', mat.sheen, 0, 1, 0.01, (v) => { mat.sheen = v; this.updatePreview(); });
      this.addSliderProp('Sheen Roughness', mat.sheenRoughness, 0, 1, 0.01, (v) => { mat.sheenRoughness = v; this.updatePreview(); });
      this.addColorProp('Sheen Color', mat.sheenColor, (c) => { mat.sheenColor.copy(c); this.updatePreview(); });

      this.addSeparator();
      this.addLabel('Specular');
      this.addSliderProp('Specular Intensity', mat.specularIntensity, 0, 2, 0.01, (v) => { mat.specularIntensity = v; this.updatePreview(); });
      this.addColorProp('Specular Color', mat.specularColor, (c) => { mat.specularColor.copy(c); this.updatePreview(); });

      this.addSeparator();
      this.addLabel('Iridescence');
      this.addSliderProp('Iridescence', mat.iridescence, 0, 1, 0.01, (v) => { mat.iridescence = v; this.updatePreview(); });
      this.addSliderProp('Iridescence IOR', mat.iridescenceIOR, 1, 2.5, 0.01, (v) => { mat.iridescenceIOR = v; this.updatePreview(); });

      this.addSeparator();
      this.addLabel('Anisotropy');
      this.addSliderProp('Anisotropy', mat.anisotropy, -1, 1, 0.01, (v) => { mat.anisotropy = v; this.updatePreview(); });
      this.addSliderProp('Aniso Rotation', mat.anisotropyRotation ?? 0, 0, Math.PI * 2, 0.01, (v) => { mat.anisotropyRotation = v; this.updatePreview(); });
    }

    // Displacement
    if ('displacementScale' in mat) {
      this.addSeparator();
      this.addLabel('Displacement');
      this.addSliderProp('Displacement Scale', (mat as THREE.MeshStandardMaterial).displacementScale, 0, 2, 0.01, (v) => {
        (mat as THREE.MeshStandardMaterial).displacementScale = v;
        this.updatePreview();
      });
      this.addSliderProp('Displacement Bias', (mat as THREE.MeshStandardMaterial).displacementBias, -1, 1, 0.01, (v) => {
        (mat as THREE.MeshStandardMaterial).displacementBias = v;
        this.updatePreview();
      });
    }

    // Texture maps — full list for physical
    this.addSeparator();
    this.addLabel('Texture Maps');

    // Auto-setup button
    const autoBtn = document.createElement('button');
    autoBtn.textContent = '📁 Auto-Setup from Folder';
    autoBtn.style.cssText = 'width:100%;background:#1a3a1a;border:1px solid #2a4a2a;color:#6c6;padding:4px 8px;border-radius:3px;cursor:pointer;font-size:10px;margin:4px 0;';
    autoBtn.addEventListener('click', () => this.autoSetupTextures());
    this.propsArea.appendChild(autoBtn);

    const stdMat = mat as THREE.MeshStandardMaterial;
    const standardMaps: [string, string][] = [
      ['Diffuse (Base Color)', 'map'],
      ['Normal Map', 'normalMap'],
      ['Roughness Map', 'roughnessMap'],
      ['Metalness Map', 'metalnessMap'],
      ['AO Map', 'aoMap'],
      ['Emissive Map', 'emissiveMap'],
      ['Displacement Map', 'displacementMap'],
    ];

    const physicalMaps: [string, string][] = mat instanceof THREE.MeshPhysicalMaterial ? [
      ['Clearcoat Map', 'clearcoatMap'],
      ['Clearcoat Normal', 'clearcoatNormalMap'],
      ['Clearcoat Roughness', 'clearcoatRoughnessMap'],
      ['Transmission Map', 'transmissionMap'],
      ['Thickness Map', 'thicknessMap'],
      ['Sheen Color Map', 'sheenColorMap'],
      ['Sheen Roughness Map', 'sheenRoughnessMap'],
      ['Iridescence Map', 'iridescenceMap'],
      ['Anisotropy Map', 'anisotropyMap'],
    ] : [];

    for (const [label, key] of [...standardMaps, ...physicalMaps]) {
      if (key in mat) {
        this.addTextureProp(label, (stdMat as unknown as Record<string, THREE.Texture | null>)[key], (tex) => {
          (stdMat as unknown as Record<string, unknown>)[key] = tex;
          mat.needsUpdate = true;
          this.updatePreview();
        });
      }
    }

    // UV settings
    this.addSeparator();
    this.addLabel('UV / Tiling');
    if (stdMat.map) {
      this.addSliderProp('Tile X', stdMat.map.repeat.x, 0.1, 20, 0.1, (v) => {
        if (stdMat.map) { stdMat.map.repeat.x = v; stdMat.map.needsUpdate = true; }
        this.updatePreview();
      });
      this.addSliderProp('Tile Y', stdMat.map.repeat.y, 0.1, 20, 0.1, (v) => {
        if (stdMat.map) { stdMat.map.repeat.y = v; stdMat.map.needsUpdate = true; }
        this.updatePreview();
      });
      this.addSliderProp('Offset X', stdMat.map.offset.x, 0, 1, 0.01, (v) => {
        if (stdMat.map) { stdMat.map.offset.x = v; }
        this.updatePreview();
      });
      this.addSliderProp('Offset Y', stdMat.map.offset.y, 0, 1, 0.01, (v) => {
        if (stdMat.map) { stdMat.map.offset.y = v; }
        this.updatePreview();
      });
      this.addSliderProp('Rotation', stdMat.map.rotation, 0, Math.PI * 2, 0.01, (v) => {
        if (stdMat.map) { stdMat.map.rotation = v; }
        this.updatePreview();
      });
    }

    // Rendering options
    this.addSeparator();
    this.addLabel('Rendering');

    this.addCheckboxProp('Wireframe', 'wireframe' in mat ? (mat as THREE.MeshStandardMaterial).wireframe : false, (v) => {
      if ('wireframe' in mat) (mat as THREE.MeshStandardMaterial).wireframe = v;
      this.updatePreview();
    });

    this.addSelectProp('Side', mat.side, [
      { label: 'Front', value: THREE.FrontSide },
      { label: 'Back', value: THREE.BackSide },
      { label: 'Double', value: THREE.DoubleSide },
    ], (v) => {
      mat.side = v as THREE.Side;
      mat.needsUpdate = true;
      this.updatePreview();
    });

    this.addCheckboxProp('Flat Shading', 'flatShading' in mat ? (mat as THREE.MeshStandardMaterial).flatShading : false, (v) => {
      if ('flatShading' in mat) {
        (mat as THREE.MeshStandardMaterial).flatShading = v;
        mat.needsUpdate = true;
      }
      this.updatePreview();
    });

    this.addCheckboxProp('Depth Write', mat.depthWrite, (v) => { mat.depthWrite = v; });
    this.addCheckboxProp('Depth Test', mat.depthTest, (v) => { mat.depthTest = v; });
    this.addCheckboxProp('Alpha Test', mat.alphaTest > 0, (v) => { mat.alphaTest = v ? 0.5 : 0; mat.needsUpdate = true; });

    // Save to library
    this.addSeparator();
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 Save to Library';
    saveBtn.style.cssText = 'width:100%;background:#1a1a3a;border:1px solid #2a2a5a;color:#88f;padding:6px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin:4px 0;';
    saveBtn.addEventListener('click', () => this.saveCurrentToLibrary());
    this.propsArea.appendChild(saveBtn);

    // Create Instance
    const instBtn = document.createElement('button');
    instBtn.textContent = '🔀 Create Material Instance';
    instBtn.style.cssText = 'width:100%;background:#1a2a1a;border:1px solid #2a4a2a;color:#8c8;padding:6px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin:4px 0;';
    instBtn.addEventListener('click', () => this.createMaterialInstance());
    this.propsArea.appendChild(instBtn);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GRAPH TAB — Visual Node Graph
  // ═══════════════════════════════════════════════════════════════════

  private renderGraphTab(): void {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex:1;position:relative;overflow:hidden;background:#0a0a0a;';

    this.graphCanvas = document.createElement('canvas');
    this.graphCanvas.style.cssText = 'width:100%;height:100%;cursor:grab;';
    wrap.appendChild(this.graphCanvas);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'position:absolute;top:4px;left:4px;display:flex;gap:4px;z-index:10;';
    const addNodeBtn = (label: string, type: MatNode['type']) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = 'background:#333;border:1px solid #555;color:#ccc;padding:3px 8px;font-size:9px;cursor:pointer;border-radius:3px;';
      btn.addEventListener('click', () => this.addGraphNode(type));
      toolbar.appendChild(btn);
    };
    addNodeBtn('+ Texture', 'texture');
    addNodeBtn('+ Color', 'color');
    addNodeBtn('+ Value', 'value');
    addNodeBtn('+ Math', 'math');
    addNodeBtn('+ Fresnel', 'fresnel');
    addNodeBtn('+ Normal', 'normal');

    const resetBtn = document.createElement('button');
    resetBtn.textContent = '↻ Reset';
    resetBtn.style.cssText = 'background:#333;border:1px solid #555;color:#ccc;padding:3px 8px;font-size:9px;cursor:pointer;border-radius:3px;';
    resetBtn.addEventListener('click', () => this.resetGraph());
    toolbar.appendChild(resetBtn);

    const applyBtn = document.createElement('button');
    applyBtn.textContent = '✓ Apply to PBR';
    applyBtn.style.cssText = 'background:#1a3a1a;border:1px solid #2a5a2a;color:#7ddc7d;padding:3px 8px;font-size:9px;cursor:pointer;border-radius:3px;';
    applyBtn.addEventListener('click', () => this.applyGraphToCurrentMaterial());
    toolbar.appendChild(applyBtn);

    wrap.appendChild(toolbar);
    this.tabContent.appendChild(wrap);

    this.buildDefaultGraph();
    requestAnimationFrame(() => this.initGraphCanvas());
  }

  private buildDefaultGraph(): void {
    if (this.nodes.length > 0) return;

    this.nodes = [
      { id: 'output', type: 'output', label: 'Material Output', x: 500, y: 100, inputs: ['Base Color', 'Metallic', 'Roughness', 'Normal', 'Emission', 'Opacity'], outputs: [], data: {} },
      { id: 'basecolor', type: 'texture', label: 'Base Color Tex', x: 50, y: 50, inputs: ['UV'], outputs: ['RGB', 'Alpha'], data: { slot: 'map' } },
      { id: 'normalmap', type: 'texture', label: 'Normal Map', x: 50, y: 200, inputs: ['UV'], outputs: ['RGB'], data: { slot: 'normalMap' } },
      { id: 'roughmet', type: 'texture', label: 'Roughness/Metal', x: 50, y: 350, inputs: ['UV'], outputs: ['R', 'G', 'B'], data: { slot: 'roughnessMap' } },
    ];
    this.connections = [
      { fromNode: 'basecolor', fromOutput: 'RGB', toNode: 'output', toInput: 'Base Color' },
      { fromNode: 'normalmap', fromOutput: 'RGB', toNode: 'output', toInput: 'Normal' },
      { fromNode: 'roughmet', fromOutput: 'G', toNode: 'output', toInput: 'Roughness' },
      { fromNode: 'roughmet', fromOutput: 'B', toNode: 'output', toInput: 'Metallic' },
    ];
  }

  private addGraphNode(type: MatNode['type']): void {
    const id = `node_${Date.now()}`;
    const x = 200 - this.graphPan.x;
    const y = 200 - this.graphPan.y;

    let node: MatNode;
    switch (type) {
      case 'texture':
        node = { id, type, label: 'Texture', x, y, inputs: ['UV'], outputs: ['RGB', 'Alpha'], data: {} };
        break;
      case 'color':
        node = { id, type, label: 'Color', x, y, inputs: [], outputs: ['RGB'], data: { color: '#ffffff' } };
        break;
      case 'value':
        node = { id, type, label: 'Value', x, y, inputs: [], outputs: ['Value'], data: { value: 0.5 } };
        break;
      case 'math':
        node = { id, type, label: 'Math', x, y, inputs: ['A', 'B'], outputs: ['Result'], data: { op: 'multiply' } };
        break;
      case 'fresnel':
        node = { id, type, label: 'Fresnel', x, y, inputs: ['IOR'], outputs: ['Factor'], data: { ior: 1.45 } };
        break;
      case 'normal':
        node = { id, type, label: 'Normal Map', x, y, inputs: ['Texture'], outputs: ['Normal'], data: { strength: 1 } };
        break;
      default: return;
    }
    this.nodes.push(node);
    this.drawGraph();
  }

  private resetGraph(): void {
    this.nodes = [];
    this.connections = [];
    this.buildDefaultGraph();
    this.drawGraph();
  }

  private initGraphCanvas(): void {
    const ctx = this.graphCanvas.getContext('2d');
    if (!ctx) return;
    this.graphCtx = ctx;

    const resize = () => {
      const r = this.graphCanvas.getBoundingClientRect();
      this.graphCanvas.width = r.width * window.devicePixelRatio;
      this.graphCanvas.height = r.height * window.devicePixelRatio;
      this.graphCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
      this.drawGraph();
    };

    resize();
    this.graphResizeObserver?.disconnect();
    this.graphResizeObserver = new ResizeObserver(resize);
    this.graphResizeObserver.observe(this.graphCanvas);

    // Pan
    let dragging = false;
    let dragNode: MatNode | null = null;
    let lastX = 0, lastY = 0;

    this.graphCanvas.addEventListener('mousedown', (e) => {
      const mx = e.offsetX - this.graphPan.x;
      const my = e.offsetY - this.graphPan.y;
      dragNode = this.nodes.find(n => mx >= n.x && mx <= n.x + 180 && my >= n.y && my <= n.y + 30) ?? null;
      if (!dragNode) dragging = true;
      lastX = e.offsetX;
      lastY = e.offsetY;
    });

    this.graphCanvas.addEventListener('mousemove', (e) => {
      const dx = e.offsetX - lastX;
      const dy = e.offsetY - lastY;
      if (dragging) {
        this.graphPan.x += dx;
        this.graphPan.y += dy;
        this.drawGraph();
      } else if (dragNode) {
        dragNode.x += dx;
        dragNode.y += dy;
        this.drawGraph();
      }
      lastX = e.offsetX;
      lastY = e.offsetY;
    });

    this.graphCanvas.addEventListener('mouseup', () => {
      dragging = false;
      dragNode = null;
    });

    this.graphCanvas.addEventListener('dblclick', (e) => {
      const mx = e.offsetX - this.graphPan.x;
      const my = e.offsetY - this.graphPan.y;
      const node = this.nodes.find(n => mx >= n.x && mx <= n.x + 180 && my >= n.y && my <= n.y + 30);
      if (!node) return;

      if (node.type === 'value') {
        const current = typeof node.data.value === 'number' ? node.data.value : 0.5;
        const next = prompt('Value node scalar (0..1):', String(current));
        if (next !== null) {
          const parsed = parseFloat(next);
          if (Number.isFinite(parsed)) node.data.value = parsed;
        }
      } else if (node.type === 'color') {
        const current = typeof node.data.color === 'string' ? node.data.color : '#ffffff';
        const next = prompt('Color node value (#rrggbb):', current);
        if (next && /^#?[0-9a-fA-F]{6}$/.test(next)) {
          node.data.color = next.startsWith('#') ? next : `#${next}`;
        }
      } else if (node.type === 'texture') {
        const current = typeof node.data.slot === 'string' ? node.data.slot : 'map';
        const next = prompt('Texture slot source (map, normalMap, roughnessMap, metalnessMap, emissiveMap):', current);
        if (next) node.data.slot = next.trim();
      }

      this.drawGraph();
    });
  }

  private drawGraph(): void {
    if (!this.graphCtx) return;
    const ctx = this.graphCtx;
    const w = this.graphCanvas.width / window.devicePixelRatio;
    const h = this.graphCanvas.height / window.devicePixelRatio;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(this.graphPan.x, this.graphPan.y);

    // Grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    const gs = 40;
    const startX = Math.floor(-this.graphPan.x / gs) * gs;
    const startY = Math.floor(-this.graphPan.y / gs) * gs;
    for (let x = startX; x < startX + w + gs; x += gs) {
      ctx.beginPath(); ctx.moveTo(x, startY); ctx.lineTo(x, startY + h + gs); ctx.stroke();
    }
    for (let y = startY; y < startY + h + gs; y += gs) {
      ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(startX + w + gs, y); ctx.stroke();
    }

    // Connections
    for (const conn of this.connections) {
      const from = this.nodes.find(n => n.id === conn.fromNode);
      const to = this.nodes.find(n => n.id === conn.toNode);
      if (!from || !to) continue;

      const outIdx = from.outputs.indexOf(conn.fromOutput);
      const inIdx = to.inputs.indexOf(conn.toInput);
      const fx = from.x + 180;
      const fy = from.y + 40 + outIdx * 18;
      const tx = to.x;
      const ty = to.y + 40 + inIdx * 18;

      ctx.strokeStyle = '#0078d4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      const cpx = (fx + tx) / 2;
      ctx.bezierCurveTo(cpx, fy, cpx, ty, tx, ty);
      ctx.stroke();
    }

    // Nodes
    for (const node of this.nodes) {
      const nw = 180;
      const nh = 30 + Math.max(node.inputs.length, node.outputs.length) * 18 + 8;

      // Background
      const colors: Record<string, string> = {
        output: '#2a1a3a', texture: '#1a2a2a', color: '#2a2a1a',
        value: '#1a1a2a', math: '#2a1a1a', fresnel: '#1a2a1a', normal: '#1a1a3a',
      };
      ctx.fillStyle = colors[node.type] ?? '#222';
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      this.roundRect(ctx, node.x, node.y, nw, nh, 6);

      // Header
      ctx.fillStyle = '#333';
      this.roundRectTop(ctx, node.x, node.y, nw, 24, 6);
      ctx.fillStyle = '#ddd';
      ctx.font = '10px monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.label, node.x + 8, node.y + 13);

      // Inputs
      ctx.font = '9px monospace';
      for (let i = 0; i < node.inputs.length; i++) {
        const py = node.y + 40 + i * 18;
        ctx.fillStyle = '#888';
        ctx.fillText(node.inputs[i], node.x + 12, py);
        // Dot
        ctx.fillStyle = '#66aaff';
        ctx.beginPath();
        ctx.arc(node.x, py, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Outputs
      for (let i = 0; i < node.outputs.length; i++) {
        const py = node.y + 40 + i * 18;
        ctx.fillStyle = '#888';
        ctx.textAlign = 'right';
        ctx.fillText(node.outputs[i], node.x + nw - 12, py);
        ctx.textAlign = 'left';
        // Dot
        ctx.fillStyle = '#66ff66';
        ctx.beginPath();
        ctx.arc(node.x + nw, py, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private roundRectTop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }

  private applyGraphToCurrentMaterial(): void {
    if (!this.currentMaterial) return;
    if (!(this.currentMaterial instanceof THREE.MeshStandardMaterial || this.currentMaterial instanceof THREE.MeshPhysicalMaterial)) {
      console.warn('[MaterialGraph] Graph apply currently supports MeshStandard/Physical materials only.');
      return;
    }

    const mat = this.currentMaterial;
    const output = this.nodes.find(n => n.type === 'output');
    if (!output) return;

    const applyScalar = (inputName: string, onScalar: (value: number) => void, onTexture?: (tex: THREE.Texture) => void): void => {
      const conn = this.connections.find(c => c.toNode === output.id && c.toInput === inputName);
      if (!conn) return;
      const node = this.nodes.find(n => n.id === conn.fromNode);
      if (!node) return;

      const scalar = this.resolveGraphScalar(node, conn.fromOutput);
      if (scalar !== undefined) {
        onScalar(scalar);
      }

      if (onTexture) {
        const tex = this.resolveGraphTexture(node);
        if (tex) onTexture(tex);
      }
    };

    const baseColorConn = this.connections.find(c => c.toNode === output.id && c.toInput === 'Base Color');
    if (baseColorConn) {
      const source = this.nodes.find(n => n.id === baseColorConn.fromNode);
      if (source) {
        const color = this.resolveGraphColor(source, baseColorConn.fromOutput);
        if (color) {
          mat.color.copy(color);
        }
        const tex = this.resolveGraphTexture(source);
        if (tex) {
          mat.map = tex;
        }
      }
    }

    applyScalar('Roughness', (v) => { mat.roughness = THREE.MathUtils.clamp(v, 0, 1); }, (tex) => { mat.roughnessMap = tex; });
    applyScalar('Metallic', (v) => { mat.metalness = THREE.MathUtils.clamp(v, 0, 1); }, (tex) => { mat.metalnessMap = tex; });
    applyScalar('Opacity', (v) => {
      mat.opacity = THREE.MathUtils.clamp(v, 0, 1);
      mat.transparent = mat.opacity < 0.999;
    });

    const normalConn = this.connections.find(c => c.toNode === output.id && c.toInput === 'Normal');
    if (normalConn) {
      const node = this.nodes.find(n => n.id === normalConn.fromNode);
      if (node) {
        const tex = this.resolveGraphTexture(node);
        if (tex) {
          mat.normalMap = tex;
        }
        const strength = this.resolveGraphScalar(node, normalConn.fromOutput);
        if (strength !== undefined && 'normalScale' in mat) {
          mat.normalScale.set(strength, strength);
        }
      }
    }

    const emissionConn = this.connections.find(c => c.toNode === output.id && c.toInput === 'Emission');
    if (emissionConn) {
      const node = this.nodes.find(n => n.id === emissionConn.fromNode);
      if (node && 'emissive' in mat) {
        const c = this.resolveGraphColor(node, emissionConn.fromOutput);
        if (c) {
          mat.emissive.copy(c);
        }
        const tex = this.resolveGraphTexture(node);
        if (tex) {
          mat.emissiveMap = tex;
        }
      }
    }

    mat.needsUpdate = true;
    this.updatePreview();
    this.switchTab('properties');
    console.info('[MaterialGraph] Applied graph values to current PBR material.');
  }

  private resolveGraphTexture(node: MatNode): THREE.Texture | null {
    if (!this.currentMaterial) return null;
    if (node.type !== 'texture' && node.type !== 'normal') return null;

    const slot = typeof node.data.slot === 'string' ? node.data.slot : null;
    if (!slot) return null;
    const mat = this.currentMaterial as unknown as Record<string, unknown>;
    const val = mat[slot];
    return val instanceof THREE.Texture ? val : null;
  }

  private resolveGraphScalar(node: MatNode, output: string): number | undefined {
    if (node.type === 'value') {
      const val = node.data.value;
      return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
    }
    if (node.type === 'fresnel') {
      const ior = typeof node.data.ior === 'number' ? node.data.ior : 1.45;
      const f0 = ((ior - 1) / (ior + 1)) ** 2;
      return THREE.MathUtils.clamp(f0, 0, 1);
    }
    if (node.type === 'normal') {
      const strength = typeof node.data.strength === 'number' ? node.data.strength : 1;
      return output === 'Normal' ? strength : undefined;
    }
    if (node.type === 'texture') {
      // Texture channel-driven scalar defaults for quick prototyping.
      if (output === 'R') return 1;
      if (output === 'G') return 0.5;
      if (output === 'B') return 0;
    }
    return undefined;
  }

  private resolveGraphColor(node: MatNode, _output: string): THREE.Color | null {
    if (node.type === 'color') {
      const raw = typeof node.data.color === 'string' ? node.data.color : '#ffffff';
      return new THREE.Color(raw);
    }
    if (node.type === 'value') {
      const val = typeof node.data.value === 'number' ? THREE.MathUtils.clamp(node.data.value, 0, 1) : 0.5;
      return new THREE.Color(val, val, val);
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIBRARY TAB
  // ═══════════════════════════════════════════════════════════════════

  private renderLibraryTab(): void {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex:1;overflow-y:auto;padding:8px;';

    // Actions
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;';

    const importBtn = document.createElement('button');
    importBtn.textContent = '📥 Import Library';
    importBtn.style.cssText = 'background:#333;border:1px solid #444;color:#ccc;padding:4px 8px;font-size:10px;cursor:pointer;border-radius:3px;';
    importBtn.addEventListener('click', () => this.importLibrary());
    actions.appendChild(importBtn);

    const exportBtn = document.createElement('button');
    exportBtn.textContent = '📤 Export Library';
    exportBtn.style.cssText = 'background:#333;border:1px solid #444;color:#ccc;padding:4px 8px;font-size:10px;cursor:pointer;border-radius:3px;';
    exportBtn.addEventListener('click', () => this.exportLibrary());
    actions.appendChild(exportBtn);

    wrap.appendChild(actions);

    // Materials list
    const mats = this.library.getAllMaterials();
    if (mats.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#555;text-align:center;padding:30px;';
      empty.textContent = 'No saved materials. Use "Save to Library" in Properties tab.';
      wrap.appendChild(empty);
    } else {
      for (const def of mats) {
        const card = document.createElement('div');
        card.style.cssText = 'background:#1e1e1e;border:1px solid #333;border-radius:4px;padding:8px;margin-bottom:6px;cursor:pointer;';
        card.addEventListener('mouseenter', () => { card.style.borderColor = '#0078d4'; });
        card.addEventListener('mouseleave', () => { card.style.borderColor = '#333'; });

        const title = document.createElement('div');
        title.style.cssText = 'font-size:11px;color:#ddd;font-weight:600;';
        title.textContent = `${def.name}`;
        card.appendChild(title);

        const info = document.createElement('div');
        info.style.cssText = 'font-size:9px;color:#888;margin-top:2px;';
        info.textContent = `Type: ${def.type} | Tags: ${def.tags.join(', ') || 'none'}`;
        card.appendChild(info);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:4px;margin-top:4px;';

        const applyBtn = document.createElement('button');
        applyBtn.textContent = '✓ Apply';
        applyBtn.style.cssText = 'background:#1a3a1a;border:1px solid #2a4a2a;color:#8c8;padding:2px 8px;font-size:9px;cursor:pointer;border-radius:3px;';
        applyBtn.addEventListener('click', (e) => { e.stopPropagation(); this.applyLibraryMaterial(def); });
        btnRow.appendChild(applyBtn);

        const instanceBtn = document.createElement('button');
        instanceBtn.textContent = '🔀 Instance';
        instanceBtn.style.cssText = 'background:#1a1a3a;border:1px solid #2a2a5a;color:#88f;padding:2px 8px;font-size:9px;cursor:pointer;border-radius:3px;';
        instanceBtn.addEventListener('click', (e) => { e.stopPropagation(); this.createInstanceFromLibrary(def); });
        btnRow.appendChild(instanceBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑';
        deleteBtn.style.cssText = 'background:#3a1a1a;border:1px solid #5a2a2a;color:#f88;padding:2px 8px;font-size:9px;cursor:pointer;border-radius:3px;margin-left:auto;';
        deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); this.library.removeMaterial(def.id); this.switchTab('library'); });
        btnRow.appendChild(deleteBtn);

        card.appendChild(btnRow);

        // Show instances
        const instances = this.library.getInstances(def.id);
        if (instances.length > 0) {
          const instList = document.createElement('div');
          instList.style.cssText = 'margin-top:4px;padding-left:12px;border-left:2px solid #333;';
          for (const inst of instances) {
            const instItem = document.createElement('div');
            instItem.style.cssText = 'font-size:9px;color:#aaa;padding:2px 0;cursor:pointer;';
            instItem.textContent = `↳ ${inst.name}`;
            instItem.addEventListener('click', (e) => {
              e.stopPropagation();
              const mat = this.library.buildInstanceMaterial(inst);
              if (mat) this.applyMaterialToSelection(mat);
            });
            instList.appendChild(instItem);
          }
          card.appendChild(instList);
        }

        wrap.appendChild(card);
      }
    }

    this.tabContent.appendChild(wrap);
  }

  // ═══════════════════════════════════════════════════════════════════
  // SHADER TAB — Custom GLSL Editor
  // ═══════════════════════════════════════════════════════════════════

  private renderShaderTab(): void {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';

    // Actions
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid #333;flex-shrink:0;align-items:center;';

    const compileBtn = document.createElement('button');
    compileBtn.textContent = '▶ Compile & Apply';
    compileBtn.style.cssText = 'background:#1a3a1a;border:1px solid #2a5a2a;color:#6c6;padding:4px 12px;font-size:10px;cursor:pointer;border-radius:3px;';
    compileBtn.addEventListener('click', () => this.compileShader());
    actions.appendChild(compileBtn);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = '↻ Reset to Default';
    resetBtn.style.cssText = 'background:#333;border:1px solid #444;color:#ccc;padding:4px 8px;font-size:10px;cursor:pointer;border-radius:3px;';
    resetBtn.addEventListener('click', () => {
      this.shaderVertArea.value = this.library.defaultVertexShader;
      this.shaderFragArea.value = this.library.defaultFragmentShader;
    });
    actions.appendChild(resetBtn);

    const errSpan = document.createElement('span');
    errSpan.id = 'shader-error';
    errSpan.style.cssText = 'font-size:9px;color:#f88;margin-left:8px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    actions.appendChild(errSpan);

    wrap.appendChild(actions);

    // Shader editors
    const editors = document.createElement('div');
    editors.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';

    // Vertex
    const vertLabel = document.createElement('div');
    vertLabel.style.cssText = 'font-size:10px;color:#888;padding:4px 8px;background:#1a1a1a;border-bottom:1px solid #333;';
    vertLabel.textContent = 'Vertex Shader';
    editors.appendChild(vertLabel);

    this.shaderVertArea = document.createElement('textarea');
    this.shaderVertArea.style.cssText = 'flex:1;background:#0e0e0e;color:#d4d4d4;border:none;padding:8px;font-family:monospace;font-size:11px;resize:none;tab-size:2;outline:none;min-height:80px;';
    this.shaderVertArea.value = this.library.defaultVertexShader;
    this.shaderVertArea.spellcheck = false;
    editors.appendChild(this.shaderVertArea);

    // Fragment
    const fragLabel = document.createElement('div');
    fragLabel.style.cssText = 'font-size:10px;color:#888;padding:4px 8px;background:#1a1a1a;border-bottom:1px solid #333;border-top:1px solid #333;';
    fragLabel.textContent = 'Fragment Shader';
    editors.appendChild(fragLabel);

    this.shaderFragArea = document.createElement('textarea');
    this.shaderFragArea.style.cssText = 'flex:2;background:#0e0e0e;color:#d4d4d4;border:none;padding:8px;font-family:monospace;font-size:11px;resize:none;tab-size:2;outline:none;min-height:120px;';
    this.shaderFragArea.value = this.library.defaultFragmentShader;
    this.shaderFragArea.spellcheck = false;

    // Tab key support
    for (const area of [this.shaderVertArea, this.shaderFragArea]) {
      area.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = area.selectionStart;
          area.value = area.value.substring(0, start) + '  ' + area.value.substring(area.selectionEnd);
          area.selectionStart = area.selectionEnd = start + 2;
        }
      });
    }

    editors.appendChild(this.shaderFragArea);
    wrap.appendChild(editors);
    this.tabContent.appendChild(wrap);
  }

  private compileShader(): void {
    const container = this.container;
    if (!container) return;
    const errSpan = container.querySelector('#shader-error') as HTMLElement;
    if (!errSpan) return;

    const vert = this.shaderVertArea.value;
    const frag = this.shaderFragArea.value;

    try {
      const mat = new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: {
          baseColor: { value: new THREE.Vector3(0.8, 0.8, 0.8) },
          roughness: { value: 0.5 },
          metalness: { value: 0 },
          opacity: { value: 1 },
          time: { value: 0 },
        },
        transparent: true,
      });

      this.applyMaterialToSelection(mat);
      this.currentMaterial = mat;
      this.setPreviewMaterial(mat);

      errSpan.textContent = '✓ Compiled successfully';
      errSpan.style.color = '#6c6';
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errSpan.textContent = `✕ ${msg}`;
      errSpan.style.color = '#f88';
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════

  private setPreviewGeometry(shape: 'sphere' | 'box' | 'cylinder' | 'plane'): void {
    const oldMat = this.previewSphere.material;
    this.previewSphere.geometry.dispose();
    switch (shape) {
      case 'box': this.previewSphere.geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5); break;
      case 'cylinder': this.previewSphere.geometry = new THREE.CylinderGeometry(0.7, 0.7, 1.5, 64); break;
      case 'plane': this.previewSphere.geometry = new THREE.PlaneGeometry(2, 2); break;
      default: this.previewSphere.geometry = new THREE.SphereGeometry(1, 64, 64); break;
    }
    this.previewSphere.material = oldMat;
  }

  private convertMaterialType(type: string): void {
    const obj = this.editor.state.selectedObject;
    if (!obj || !(obj instanceof THREE.Mesh)) return;

    const oldMat = this.currentMaterial as THREE.MeshStandardMaterial;
    const color = 'color' in oldMat ? oldMat.color.getHex() : 0xcccccc;

    let newMat: THREE.Material;
    switch (type) {
      case 'physical':
        newMat = new THREE.MeshPhysicalMaterial({ color, roughness: oldMat.roughness ?? 0.5, metalness: oldMat.metalness ?? 0 });
        break;
      case 'basic':
        newMat = new THREE.MeshBasicMaterial({ color });
        break;
      case 'toon':
        newMat = new THREE.MeshToonMaterial({ color });
        break;
      default:
        newMat = new THREE.MeshStandardMaterial({ color, roughness: oldMat.roughness ?? 0.5, metalness: oldMat.metalness ?? 0 });
    }

    obj.material = newMat;
    this.currentMaterial = newMat;
    this.setPreviewMaterial(newMat);
    this.switchTab('properties');
  }

  private autoSetupTextures(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*';
    input.onchange = () => {
      if (!input.files || !this.currentMaterial) return;
      const files = Array.from(input.files);
      const paths = files.map(f => f.name);
      const mapping = this.library.autoSetupFromTextures(paths);

      const mat = this.currentMaterial as THREE.MeshStandardMaterial;
      const loader = new THREE.TextureLoader();

      for (const [slot, filename] of Object.entries(mapping)) {
        const file = files.find(f => f.name === filename);
        if (!file) continue;

        const url = URL.createObjectURL(file);
        loader.load(url, (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          if (slot === 'map' || slot === 'emissiveMap') {
            tex.colorSpace = THREE.SRGBColorSpace;
          }
          (mat as unknown as Record<string, unknown>)[slot] = tex;
          mat.needsUpdate = true;
          this.updatePreview();
          this.switchTab('properties');
        });
      }
    };
    input.click();
  }

  private saveCurrentToLibrary(): void {
    if (!this.currentMaterial) return;

    const name = prompt('Material name:', this.currentMaterial.name || 'My Material');
    if (!name) return;

    const tags = (prompt('Tags (comma separated):', '') ?? '').split(',').map(t => t.trim()).filter(Boolean);
    const def = this.library.extractDefinition(this.currentMaterial, name);
    def.tags = tags;
    this.library.saveMaterial(def);
    this.switchTab('library');
  }

  private createMaterialInstance(): void {
    if (!this.currentMaterial) return;

    const baseName = this.currentMaterial.name || 'Material';
    const def = this.library.extractDefinition(this.currentMaterial, baseName);
    if (!this.library.getMaterialDef(def.id)) {
      this.library.saveMaterial(def);
    }

    const inst = this.library.createInstance(`${baseName}_Instance`, def.id);
    const mat = this.library.buildInstanceMaterial(inst);
    if (mat) this.applyMaterialToSelection(mat);
  }

  private applyLibraryMaterial(def: MaterialDefinition): void {
    const mat = this.library.buildMaterial(def);
    this.applyMaterialToSelection(mat.clone());
  }

  private createInstanceFromLibrary(def: MaterialDefinition): void {
    const name = prompt('Instance name:', `${def.name}_Variant`);
    if (!name) return;
    this.library.createInstance(name, def.id);
    this.switchTab('library');
  }

  private applyMaterialToSelection(mat: THREE.Material): void {
    const obj = this.editor.state.selectedObject;
    if (obj && obj instanceof THREE.Mesh) {
      obj.material = mat;
      this.currentMaterial = mat;
      this.setPreviewMaterial(mat);
    }
  }

  private importLibrary(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      if (!input.files?.[0]) return;
      const reader = new FileReader();
      reader.onload = () => {
        this.library.deserialize(reader.result as string);
        this.switchTab('library');
      };
      reader.readAsText(input.files[0]);
    };
    input.click();
  }

  private exportLibrary(): void {
    const json = this.library.serialize();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'material-library.json';
    a.click();
  }

  /* ─── Property builders ──────────────────────────────── */

  private addLabel(text: string): void {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:10px;color:#888;font-weight:600;margin:4px 0 2px;';
    el.textContent = text;
    this.propsArea.appendChild(el);
  }

  private addSeparator(): void {
    const el = document.createElement('hr');
    el.style.cssText = 'border:none;border-top:1px solid #333;margin:6px 0;';
    this.propsArea.appendChild(el);
  }

  private addSliderProp(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void): void {
    const row = this.createRow(label);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.cssText = 'flex:1;height:14px;accent-color:#0078d4;';
    const valSpan = document.createElement('span');
    valSpan.style.cssText = 'min-width:36px;text-align:right;font-size:10px;color:#aaa;';
    valSpan.textContent = value.toFixed(2);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valSpan.textContent = v.toFixed(2);
      onChange(v);
    });
    row.appendChild(input);
    row.appendChild(valSpan);
    this.propsArea.appendChild(row);
  }

  private addColorProp(label: string, color: THREE.Color, onChange: (c: THREE.Color) => void): void {
    const row = this.createRow(label);
    const input = document.createElement('input');
    input.type = 'color';
    input.value = '#' + color.getHexString();
    input.style.cssText = 'width:40px;height:20px;border:1px solid #444;background:none;cursor:pointer;padding:0;';
    const hex = document.createElement('span');
    hex.style.cssText = 'font-size:10px;color:#888;';
    hex.textContent = '#' + color.getHexString();
    input.addEventListener('input', () => {
      const c = new THREE.Color(input.value);
      onChange(c);
      hex.textContent = input.value;
    });
    row.appendChild(input);
    row.appendChild(hex);
    this.propsArea.appendChild(row);
  }

  private addCheckboxProp(label: string, value: boolean, onChange: (v: boolean) => void): void {
    const row = this.createRow(label);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.style.cssText = 'accent-color:#0078d4;';
    input.addEventListener('change', () => onChange(input.checked));
    row.appendChild(input);
    this.propsArea.appendChild(row);
  }

  private addSelectProp(label: string, value: number, options: { label: string; value: number }[], onChange: (v: number) => void): void {
    const row = this.createRow(label);
    const select = document.createElement('select');
    select.style.cssText = 'background:#1e1e1e;color:#ccc;border:1px solid #444;padding:2px 4px;font-size:10px;border-radius:2px;';
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = String(opt.value);
      o.textContent = opt.label;
      if (opt.value === value) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => onChange(parseInt(select.value)));
    row.appendChild(select);
    this.propsArea.appendChild(row);
  }

  private addTextureProp(label: string, texture: THREE.Texture | null, onChange: (tex: THREE.Texture | null) => void): void {
    const row = this.createRow(label);
    row.style.flexWrap = 'wrap';

    const thumbWrap = document.createElement('div');
    thumbWrap.style.cssText = 'width:32px;height:32px;background:#1e1e1e;border:1px solid #444;border-radius:2px;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;color:#555;';

    if (texture && texture.image) {
      const img = document.createElement('img');
      img.src = texture.image.src ?? '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      thumbWrap.appendChild(img);
    } else {
      thumbWrap.textContent = texture ? '✓' : '📷';
    }

    thumbWrap.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        if (input.files && input.files[0]) {
          const url = URL.createObjectURL(input.files[0]);
          new THREE.TextureLoader().load(url, (tex) => {
            const isColorMap = label.toLowerCase().includes('diffuse') || label.toLowerCase().includes('base color') || label.toLowerCase().includes('emissive');
            if (isColorMap) tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            onChange(tex);
            thumbWrap.innerHTML = '';
            const img = document.createElement('img');
            img.src = url;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
            thumbWrap.appendChild(img);
          });
        }
      };
      input.click();
    });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕';
    clearBtn.title = 'Clear texture';
    clearBtn.style.cssText = 'background:#333;border:1px solid #444;color:#888;padding:2px 6px;font-size:9px;border-radius:2px;cursor:pointer;';
    clearBtn.addEventListener('click', () => {
      onChange(null);
      thumbWrap.innerHTML = '';
      thumbWrap.textContent = '📷';
    });

    row.appendChild(thumbWrap);
    row.appendChild(clearBtn);
    this.propsArea.appendChild(row);

    // Drop
    thumbWrap.addEventListener('dragover', (e) => { e.preventDefault(); thumbWrap.style.borderColor = '#0078d4'; });
    thumbWrap.addEventListener('dragleave', () => { thumbWrap.style.borderColor = '#444'; });
    thumbWrap.addEventListener('drop', (e) => {
      e.preventDefault();
      thumbWrap.style.borderColor = '#444';
      if (e.dataTransfer?.files[0]) {
        const url = URL.createObjectURL(e.dataTransfer.files[0]);
        new THREE.TextureLoader().load(url, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          onChange(tex);
          this.refresh();
        });
      }
    });
  }

  private createRow(label: string): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'min-width:100px;font-size:10px;color:#999;';
    lbl.textContent = label;
    row.appendChild(lbl);
    return row;
  }

  /* ─── Preview sphere ──────────────────────────────────── */

  private setupPreview(): void {
    this.previewScene = new THREE.Scene();
    this.previewScene.background = new THREE.Color(0x111111);

    this.previewCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.previewCamera.position.set(0, 0, 3);

    const ambient = new THREE.AmbientLight(0x404040, 1);
    this.previewScene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 2);
    dir.position.set(3, 4, 5);
    this.previewScene.add(dir);
    const fill = new THREE.DirectionalLight(0x4488ff, 0.5);
    fill.position.set(-3, 1, -2);
    this.previewScene.add(fill);
    const hemi = new THREE.HemisphereLight(0x88aaff, 0x443322, 0.5);
    this.previewScene.add(hemi);

    const geo = new THREE.SphereGeometry(1, 64, 64);
    this.previewSphere = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 }));
    this.previewScene.add(this.previewSphere);

    try {
      this.previewRenderer = new THREE.WebGLRenderer({
        canvas: this.previewCanvas,
        antialias: true,
        alpha: true,
      });
      this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.previewRenderer.toneMappingExposure = 1.2;
    } catch {
      return;
    }

    this.animatePreview();
  }

  private animatePreview = (): void => {
    this.animFrameId = requestAnimationFrame(this.animatePreview);
    this.previewSphere.rotation.y += 0.005;
    const w = this.previewCanvas.clientWidth;
    const h = this.previewCanvas.clientHeight;
    if (w > 0 && h > 0) {
      this.previewRenderer.setSize(w, h, false);
      this.previewCamera.aspect = w / h;
      this.previewCamera.updateProjectionMatrix();
      this.previewRenderer.render(this.previewScene, this.previewCamera);
    }
  };

  private updatePreview(): void {
    if (this.currentMaterial) {
      this.setPreviewMaterial(this.currentMaterial);
    }
  }

  private applyPreset(preset: MaterialPreset): void {
    const obj = this.editor.state.selectedObject;
    if (!obj || !(obj instanceof THREE.Mesh)) return;

    let mat: THREE.Material;
    switch (preset.type) {
      case 'MeshPhysicalMaterial':
        mat = new THREE.MeshPhysicalMaterial(preset.props as THREE.MeshPhysicalMaterialParameters);
        break;
      case 'MeshBasicMaterial':
        mat = new THREE.MeshBasicMaterial(preset.props as THREE.MeshBasicMaterialParameters);
        break;
      case 'MeshToonMaterial':
        mat = new THREE.MeshToonMaterial(preset.props as THREE.MeshToonMaterialParameters);
        break;
      default:
        mat = new THREE.MeshStandardMaterial(preset.props as THREE.MeshStandardMaterialParameters);
    }

    obj.material = mat;
    this.currentMaterial = mat;
    this.setPreviewMaterial(mat);
    this.switchTab('properties');
  }

  dispose(): void {
    cancelAnimationFrame(this.animFrameId);
    this.animFrameId = 0;
    this.graphResizeObserver?.disconnect();
    this.graphResizeObserver = null;
    if (this.previewSphere) {
      this.previewSphere.geometry.dispose();
      const m = this.previewSphere.material;
      if (Array.isArray(m)) m.forEach(mat => mat.dispose());
      else m.dispose();
    }
    this.previewRenderer?.dispose();
    this.container = null;
  }
}
