/**
 * TerrainEditorPanel — Full-featured terrain editing tab.
 * Connects to the engine's TerrainSystem for heightmap sculpting, texture painting,
 * and terrain configuration.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { EditorApp } from './EditorApp';
import { TerrainSystem, type TerrainBrush, type NoiseParams } from '../engine/TerrainSystem';
import { WaterPlacementSystem, type WaterBodyType, type WaterBodyHandle } from '../engine/WaterPlacementSystem';

/** Template stored in the panel for each added foliage type. */
interface FoliageLayerTemplate {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  scaleMin: number;
  scaleMax: number;
  slopeMin: number;
  slopeMax: number;
}

export class TerrainEditorPanel {
  private editor: EditorApp;
  private container: HTMLElement;
  private terrain: TerrainSystem | null = null;
  private tiles: Map<string, TerrainSystem> = new Map();
  private activeTileKey: string = '0,0';
  private canvas3d: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private previewScene: THREE.Scene;
  private previewCamera: THREE.PerspectiveCamera;
  private orbitControls: OrbitControls | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private keysPressed = new Set<string>();
  private animId = 0;
  private activeBrush: TerrainBrush = 'raise';
  private brushSize = 10;
  private brushStrength = 0.3;
  private isPainting = false;
  private activeTab: 'sculpt' | 'texture' | 'generate' | 'water' | 'foliage' = 'sculpt';
  private activeLayerIndex = 0;
  private riverPoints: THREE.Vector3[] = [];
  private isPlacingRiver = false;
  private waterPlacement: WaterPlacementSystem | null = null;
  private waterBodies: WaterBodyHandle[] = [];
  private selectedWaterType: WaterBodyType = 'ocean';
  // ── Foliage ───────────────────────────────────────────────────────────────
  private foliagePaintMode: 'paint' | 'erase' = 'paint';
  private activeFoliageLayerIndex = 0;
  private foliageTemplates: FoliageLayerTemplate[] = [];
  private foliageBrushStrength = 0.5;
  private foliageBrushSize = 10;

  constructor(editor: EditorApp) {
    this.editor = editor;
    this.container = document.createElement('div');
    this.container.className = 'terrain-editor-root';

    this.previewScene = new THREE.Scene();
    this.previewScene.background = new THREE.Color(0x1a1a2e);
    this.previewCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    this.previewCamera.position.set(80, 60, 80);
    this.previewCamera.lookAt(0, 0, 0);

    // Lighting for preview
    const amb = new THREE.AmbientLight(0x404060, 0.6);
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    dir.position.set(50, 80, 30);
    this.previewScene.add(amb, dir);
  }

  render(): HTMLElement {
    // Cleanup old renderer/controls before rebuilding
    cancelAnimationFrame(this.animId);
    if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
    if (this.orbitControls) { this.orbitControls.dispose(); this.orbitControls = null; }

    this.container.innerHTML = '';
    this.container.style.cssText = 'display:flex;width:100%;height:100%;background:#1e1e1e;color:#ccc;font-family:system-ui,sans-serif;font-size:12px;';

    // Left: 3D preview
    const previewArea = document.createElement('div');
    previewArea.style.cssText = 'flex:1;position:relative;min-width:0;background:#111;';
    this.container.appendChild(previewArea);

    this.canvas3d = document.createElement('canvas');
    this.canvas3d.style.cssText = 'width:100%;height:100%;display:block;';
    previewArea.appendChild(this.canvas3d);

    // Right: Controls
    const controls = document.createElement('div');
    controls.className = 'te-controls';
    controls.style.cssText = 'width:280px;border-left:1px solid #333;overflow-y:auto;padding:12px;flex-shrink:0;';
    this.container.appendChild(controls);

    controls.innerHTML = `
      <div style="font-size:14px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
        <span>🏔️</span> Terrain Editor
      </div>

      <!-- Tab Bar -->
      <div class="te-tabs">
        <button class="te-tab ${this.activeTab==='sculpt'?'active':''}" data-tab="sculpt">Sculpt</button>
        <button class="te-tab ${this.activeTab==='texture'?'active':''}" data-tab="texture">Texture</button>
        <button class="te-tab ${this.activeTab==='generate'?'active':''}" data-tab="generate">Generate</button>
        <button class="te-tab ${this.activeTab==='water'?'active':''}" data-tab="water">Water</button>
        <button class="te-tab ${this.activeTab==='foliage'?'active':''}" data-tab="foliage">Foliage</button>
      </div>

      <!-- ═══ SCULPT TAB ═══ -->
      <div class="te-tab-panel" data-panel="sculpt" style="${this.activeTab==='sculpt'?'':'display:none'}">
        <div class="te-section">
          <div class="te-section-title">Terrain</div>
          <div class="te-field"><label>Size</label>
            <select data-field="size"><option value="128">128×128</option><option value="256" selected>256×256</option><option value="512">512×512</option><option value="1024">1024×1024</option></select></div>
          <div class="te-field"><label>Resolution</label>
            <select data-field="resolution"><option value="64">64</option><option value="128">128</option><option value="256" selected>256</option><option value="512">512</option></select></div>
          <div class="te-field"><label>Max Height</label>
            <input type="range" data-field="maxHeight" min="10" max="200" value="50" /><span data-display="maxHeight">50</span></div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button class="te-btn te-btn-primary" data-action="create">Create</button>
            <button class="te-btn" data-action="reset">Reset</button>
            <button class="te-btn" data-action="undo" title="Ctrl+Z">↩ Undo</button>
            <button class="te-btn" data-action="redo" title="Ctrl+Y">↪ Redo</button>
          </div>
        </div>

        <div class="te-section">
          <div class="te-section-title">Brush Mode</div>
          <div class="te-brush-grid">
            <button class="te-brush active" data-brush="raise">⬆ Raise</button>
            <button class="te-brush" data-brush="lower">⬇ Lower</button>
            <button class="te-brush" data-brush="smooth">〰 Smooth</button>
            <button class="te-brush" data-brush="flatten">▬ Flatten</button>
            <button class="te-brush" data-brush="noise">⚡ Noise</button>
            <button class="te-brush" data-brush="ramp">↗ Ramp</button>
            <button class="te-brush" data-brush="paint">🎨 Paint</button>
          </div>
        </div>

        <div class="te-section">
          <div class="te-section-title">Brush Settings <span style="font-size:9px;color:#666;">[ smaller  ] larger</span></div>
          <div class="te-field"><label>Size</label>
            <input type="range" data-field="brushSize" min="1" max="50" value="10" /><span data-display="brushSize">10</span></div>
          <div class="te-field"><label>Strength</label>
            <input type="range" data-field="brushStrength" min="1" max="100" value="30" /><span data-display="brushStrength">30</span></div>
          <div class="te-field"><label>Falloff</label>
            <input type="range" data-field="brushFalloff" min="0" max="100" value="50" /><span data-display="brushFalloff">50</span></div>
        </div>

        <!-- Import/Export -->
        <div class="te-section">
          <div class="te-section-title">Heightmap I/O</div>
          <div class="te-field"><label>Tiles</label>
            <select data-field="import-tiles"><option value="auto">Auto</option><option value="2">2×2</option><option value="4">4×4</option><option value="8" selected>8×8</option><option value="16">16×16</option></select></div>
          <div class="te-field"><label>Tile Res</label>
            <select data-field="import-res"><option value="64">64</option><option value="128" selected>128</option><option value="256">256</option><option value="512">512</option></select></div>
          <div class="te-field"><label>Tile Size</label>
            <select data-field="import-tile-size"><option value="64">64</option><option value="128" selected>128</option><option value="256">256</option><option value="512">512</option></select></div>
          <div data-display="import-info" style="font-size:10px;color:#8af;margin:4px 0;">8×8 tiles = 1024×1024 units</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">
            <button class="te-btn te-btn-primary" data-action="import-hm">📥 PNG</button>
            <button class="te-btn" data-action="export-hm">📤 PNG</button>
            <button class="te-btn" data-action="import-raw">📥 RAW16</button>
            <button class="te-btn" data-action="export-raw">📤 RAW16</button>
          </div>
        </div>

        <!-- Tile Grid -->
        <div class="te-section">
          <div class="te-section-title">Tile Grid</div>
          <div style="display:flex;gap:4px;">
            <button class="te-btn" data-action="add-tile-n">⬆ N</button>
            <button class="te-btn" data-action="add-tile-s">⬇ S</button>
            <button class="te-btn" data-action="add-tile-e">➡ E</button>
            <button class="te-btn" data-action="add-tile-w">⬅ W</button>
            <button class="te-btn" data-action="stitch-edges" title="Average heights along shared edges">⇆ Stitch</button>
          </div>
          <div data-display="tiles" style="font-size:10px;color:#888;margin:4px 0;">Tiles: 1 (center)</div>
          <div data-container="tilemap" style="display:grid;gap:2px;justify-content:center;margin-bottom:4px;"></div>
          <button class="te-btn" data-action="remove-tile" style="font-size:10px;color:#f88;width:100%;">Remove Selected Tile</button>
        </div>

        <!-- Collision & Apply -->
        <div class="te-section">
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;margin-bottom:8px;">
            <input type="checkbox" data-field="collision" checked />Generate collision meshes
          </label>
          <button class="te-btn te-btn-primary" style="width:100%;" data-action="apply">Apply All Tiles to Scene</button>
        </div>
      </div>

      <!-- ═══ TEXTURE TAB ═══ -->
      <div class="te-tab-panel" data-panel="texture" style="${this.activeTab==='texture'?'':'display:none'}">
        <div class="te-section">
          <div class="te-section-title">Blend Visualization</div>
          <div class="te-field">
            <label>Show</label>
            <select data-field="blend-viz">
              <option value="-1">Off</option>
              <option value="0">Layer 0</option><option value="1">Layer 1</option><option value="2">Layer 2</option><option value="3">Layer 3</option>
              <option value="4">Layer 4</option><option value="5">Layer 5</option><option value="6">Layer 6</option><option value="7">Layer 7</option>
            </select>
          </div>
        </div>
        <div class="te-section">
          <div class="te-section-title">Texture Layers</div>
          <div class="te-layer-list" id="te-layer-list">
            ${Array.from({length:8},(_,i) => `
            <div class="te-layer ${i===0?'active':''}" data-layer="${i}">
              <div class="te-layer-swatch" data-layer-swatch="${i}" style="background:#444;"></div>
              <span class="te-layer-label" data-layer-label="${i}" style="flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Layer ${i}</span>
              <label class="te-layer-tex" title="Diffuse texture">D<input type="file" accept="image/*" data-layer-tex="${i}" hidden></label>
              <label class="te-layer-tex" title="Normal map">N<input type="file" accept="image/*" data-layer-nm="${i}" hidden></label>
            </div>`).join('')}
          </div>
        </div>
        <!-- Per-layer controls (shown for active layer) -->
        <div class="te-section" id="te-layer-props">
          <div class="te-section-title">Layer <span id="te-active-layer-name">0 – Layer 0</span></div>
          <!-- RGB color picker -->
          <div style="margin-bottom:8px;">
            <div style="font-size:10px;color:#888;margin-bottom:4px;">Color</div>
            <div style="display:flex;gap:6px;align-items:center;">
              <canvas id="te-color-preview" width="32" height="32" style="width:28px;height:28px;border:1px solid #555;cursor:pointer;border-radius:3px;"></canvas>
              <div style="flex:1;">
                <div class="te-field" style="margin-bottom:3px;"><label style="width:14px;color:#f44;">R</label><input type="range" id="te-r" min="0" max="255" value="74" /><span id="te-r-val" style="width:28px;text-align:right;font-size:10px;color:#aaa;">74</span></div>
                <div class="te-field" style="margin-bottom:3px;"><label style="width:14px;color:#4f4;">G</label><input type="range" id="te-g" min="0" max="255" value="124" /><span id="te-g-val" style="width:28px;text-align:right;font-size:10px;color:#aaa;">124</span></div>
                <div class="te-field" style="margin-bottom:3px;"><label style="width:14px;color:#88f;">B</label><input type="range" id="te-b" min="0" max="255" value="63" /><span id="te-b-val" style="width:28px;text-align:right;font-size:10px;color:#aaa;">63</span></div>
                <div class="te-field"><label style="width:32px;font-size:10px;">Hex</label><input type="text" id="te-hex" value="#4a7c3f" style="flex:1;background:#222;border:1px solid #444;color:#ccc;padding:2px 6px;border-radius:3px;font-size:11px;" /></div>
              </div>
            </div>
          </div>
          <div class="te-field"><label>Tiling</label><input type="range" id="te-layer-tiling" min="1" max="64" value="16" /><span id="te-tiling-val" style="width:28px;text-align:right;font-size:10px;color:#aaa;">16</span></div>
          <div class="te-field"><label>Roughness</label><input type="range" id="te-layer-roughness" min="0" max="100" value="80" /><span id="te-roughness-val" style="width:28px;text-align:right;font-size:10px;color:#aaa;">0.8</span></div>
        </div>
      </div>

      <!-- ═══ GENERATE TAB ═══ -->
      <div class="te-tab-panel" data-panel="generate" style="${this.activeTab==='generate'?'':'display:none'}">
        <div class="te-section">
          <div class="te-section-title">Noise Generation</div>
          <div class="te-field"><label>Scale</label><input type="range" data-field="noise-scale" min="1" max="20" value="4" /><span data-display="noise-scale">4</span></div>
          <div class="te-field"><label>Octaves</label><input type="range" data-field="noise-octaves" min="1" max="10" value="6" /><span data-display="noise-octaves">6</span></div>
          <div class="te-field"><label>Persist</label><input type="range" data-field="noise-persist" min="10" max="90" value="50" /><span data-display="noise-persist">0.50</span></div>
          <div class="te-field"><label>Lacun.</label><input type="range" data-field="noise-lacun" min="10" max="40" value="20" /><span data-display="noise-lacun">2.0</span></div>
          <div class="te-field"><label>Amplitude</label><input type="range" data-field="noise-amp" min="10" max="100" value="100" /><span data-display="noise-amp">1.0</span></div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button class="te-btn te-btn-primary" data-action="gen-noise">Generate</button>
            <button class="te-btn" data-action="gen-noise-add">Additive</button>
          </div>
        </div>
        <div class="te-section">
          <div class="te-section-title">Biome Presets</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            <button class="te-btn" data-action="biome-flat">Flat</button>
            <button class="te-btn" data-action="biome-hills">Hills</button>
            <button class="te-btn" data-action="biome-mountains">Mountains</button>
            <button class="te-btn" data-action="biome-canyon">Canyon</button>
            <button class="te-btn" data-action="biome-island">Island</button>
            <button class="te-btn" data-action="biome-badlands">Badlands</button>
          </div>
        </div>
        <div class="te-section">
          <div class="te-section-title">Slope Auto-Paint</div>
          <div class="te-field"><label>Min°</label><input type="range" data-field="slope-min" min="0" max="89" value="30" /><span data-display="slope-min">30</span></div>
          <div class="te-field"><label>Max°</label><input type="range" data-field="slope-max" min="1" max="90" value="60" /><span data-display="slope-max">60</span></div>
          <div class="te-field"><label>Layer</label>
            <select data-field="slope-layer">${Array.from({length:8},(_,i)=>`<option value="${i}">Layer ${i}</option>`).join('')}</select></div>
          <button class="te-btn te-btn-primary" data-action="slope-paint" style="margin-top:6px;">Apply Slope Paint</button>
        </div>
        <div class="te-section">
          <div class="te-section-title">Hydraulic Erosion</div>
          <div class="te-field"><label>Droplets</label><input type="range" data-field="erosion-drops" min="1000" max="200000" step="1000" value="50000" /><span data-display="erosion-drops">50k</span></div>
          <div id="erosion-status" style="font-size:10px;color:#8af;margin:4px 0;"></div>
          <button class="te-btn te-btn-primary" data-action="run-erosion">Run Erosion (Worker)</button>
        </div>
        <div class="te-section">
          <div class="te-section-title">Stamp Blend</div>
          <div class="te-field"><label>Scale</label><input type="range" data-field="stamp-scale" min="10" max="500" value="100" /><span data-display="stamp-scale">100</span></div>
          <div class="te-field"><label>Blend</label><input type="range" data-field="stamp-blend" min="1" max="100" value="50" /><span data-display="stamp-blend">0.50</span></div>
          <button class="te-btn" data-action="import-stamp">📥 Load Stamp & Apply</button>
        </div>
      </div>

      <!-- ═══ WATER TAB ═══ -->
      <div class="te-tab-panel" data-panel="water" style="${this.activeTab==='water'?'':'display:none'}">
        <div class="te-section">
          <div class="te-section-title">Water Type</div>
          <div class="te-brush-grid" style="grid-template-columns:1fr 1fr;">
            <button class="te-brush active" data-water="ocean">🌊 Ocean</button>
            <button class="te-brush" data-water="lake">💧 Lake</button>
            <button class="te-brush" data-water="river">〰 River</button>
            <button class="te-brush" data-water="lava">🌋 Lava</button>
            <button class="te-brush" data-water="shallow">≈ Shallow</button>
          </div>
        </div>
        <div class="te-section">
          <div class="te-section-title">Water Settings</div>
          <div class="te-field"><label>Level</label><input type="range" data-field="water-level" min="-50" max="50" value="0" /><span data-display="water-level">0</span></div>
          <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;margin-bottom:6px;">
            <input type="checkbox" data-field="shore-foam" checked />Shore foam
          </label>
          <button class="te-btn te-btn-primary" data-action="add-water">Add Water</button>
          <button class="te-btn" data-action="remove-water" style="margin-top:4px;color:#f88;">Remove All Water</button>
          <div data-display="water-count" style="font-size:10px;color:#888;margin-top:4px;">Water bodies: 0</div>
        </div>
        <div class="te-section">
          <div class="te-section-title">Wave Configuration</div>
          <div class="te-field"><label>Amplitude</label><input type="range" data-field="wave-amp" min="0" max="200" value="80" /><span data-display="wave-amp">0.80</span></div>
          <div class="te-field"><label>Speed</label><input type="range" data-field="wave-speed" min="0" max="300" value="60" /><span data-display="wave-speed">0.60</span></div>
          <div class="te-field"><label>Opacity</label><input type="range" data-field="wave-opacity" min="0" max="100" value="85" /><span data-display="wave-opacity">0.85</span></div>
        </div>
        <div class="te-section" id="te-river-section">
          <div class="te-section-title">River Spline</div>
          <div style="font-size:10px;color:#aaa;margin-bottom:6px;">Shift+Click in viewport to add points. Press Escape to finish.</div>
          <div id="te-river-pts" style="font-size:10px;color:#888;">Points: 0</div>
          <div style="display:flex;gap:4px;margin-top:6px;">
            <button class="te-btn te-btn-primary" data-action="start-river">Start River</button>
            <button class="te-btn" data-action="finish-river">Finish</button>
            <button class="te-btn" data-action="clear-river" style="color:#f88;">Clear</button>
          </div>
        </div>
      </div>

      <!-- ═══ FOLIAGE TAB ═══ -->
      <div class="te-tab-panel" data-panel="foliage" style="${this.activeTab==='foliage'?'':'display:none'}">
        <div class="te-section">
          <div class="te-section-title">Foliage Layers</div>
          <div id="te-foliage-layer-list" style="display:flex;flex-direction:column;gap:3px;max-height:130px;overflow-y:auto;margin-bottom:6px;"></div>
          <div style="display:flex;gap:4px;">
            <button class="te-btn te-btn-primary" data-action="add-foliage-layer" style="flex:1;">+ Import GLTF</button>
            <button class="te-btn" data-action="add-foliage-box" title="Add a box-shaped placeholder layer">📦 Box</button>
            <button class="te-btn" data-action="remove-foliage-layer" style="color:#f88;" title="Remove active layer">✕</button>
          </div>
        </div>
        <div class="te-section">
          <div class="te-section-title">Paint Mode</div>
          <div class="te-brush-grid" style="grid-template-columns:1fr 1fr;">
            <button class="te-brush active" data-foliage-mode="paint">🌿 Paint</button>
            <button class="te-brush" data-foliage-mode="erase">🧹 Erase</button>
          </div>
        </div>
        <div class="te-section">
          <div class="te-section-title">Brush</div>
          <div class="te-field"><label>Size</label><input type="range" data-field="foliage-size" min="1" max="50" value="10" /><span data-display="foliage-size">10</span></div>
          <div class="te-field"><label>Density</label><input type="range" data-field="foliage-density" min="1" max="100" value="50" /><span data-display="foliage-density">50</span></div>
        </div>
        <div class="te-section">
          <div class="te-section-title">Layer Settings</div>
          <div class="te-field"><label>Scale Min</label><input type="range" data-field="foliage-scale-min" min="1" max="100" value="80" /><span data-display="foliage-scale-min">0.8</span></div>
          <div class="te-field"><label>Scale Max</label><input type="range" data-field="foliage-scale-max" min="10" max="300" value="120" /><span data-display="foliage-scale-max">1.2</span></div>
          <div class="te-field"><label>Slope Min</label><input type="range" data-field="foliage-slope-min" min="0" max="89" value="0" /><span data-display="foliage-slope-min">0°</span></div>
          <div class="te-field"><label>Slope Max</label><input type="range" data-field="foliage-slope-max" min="1" max="90" value="45" /><span data-display="foliage-slope-max">45°</span></div>
        </div>
        <div class="te-section">
          <button class="te-btn te-btn-primary" data-action="refresh-foliage" style="width:100%;">🔄 Rebuild Instances</button>
          <button class="te-btn" data-action="clear-foliage-density" style="width:100%;margin-top:4px;color:#f88;">🗑 Clear Layer Density</button>
        </div>
      </div>
    </div>
    `;
    this.addStyles();
    this.bindEvents(controls, previewArea);

    // Restore brush settings to HTML controls
    const sizeInput = controls.querySelector('[data-field="brushSize"]') as HTMLInputElement;
    const strengthInput = controls.querySelector('[data-field="brushStrength"]') as HTMLInputElement;
    if (sizeInput) { sizeInput.value = String(this.brushSize); const d = controls.querySelector('[data-display="brushSize"]'); if (d) d.textContent = String(this.brushSize); }
    if (strengthInput) { strengthInput.value = String(Math.round(this.brushStrength * 100)); const d = controls.querySelector('[data-display="brushStrength"]'); if (d) d.textContent = String(Math.round(this.brushStrength * 100)); }
    // Restore active brush button
    controls.querySelectorAll('.te-brush').forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.brush === this.activeBrush);
    });

    this.initPreview(previewArea);

    return this.container;
  }

  private addStyles(): void {
    if (document.getElementById('terrain-editor-styles')) return;
    const style = document.createElement('style');
    style.id = 'terrain-editor-styles';
    style.textContent = `
      .te-section { margin-bottom:14px; padding-bottom:12px; border-bottom:1px solid #333; }
      .te-section-title { font-size:11px; font-weight:600; color:#888; text-transform:uppercase; margin-bottom:8px; letter-spacing:0.5px; }
      .te-field { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
      .te-field label { width:65px; font-size:11px; color:#999; flex-shrink:0; }
      .te-field input[type="range"] { flex:1; height:4px; accent-color:#58a6ff; }
      .te-field span[data-display] { width:28px; text-align:right; font-size:10px; color:#aaa; }
      .te-field select { flex:1; background:#2a2a3a; border:1px solid #444; color:#ccc; padding:3px 6px; border-radius:3px; font-size:11px; }
      .te-btn { padding:5px 10px; border-radius:4px; border:1px solid #444; background:#2a2a3a; color:#ccc; font-size:11px; cursor:pointer; transition:all 0.15s; }
      .te-btn:hover { background:#3a3a4a; }
      .te-btn-primary { background:#1f6feb; border-color:#1f6feb; color:#fff; }
      .te-btn-primary:hover { background:#388bfd; }
      .te-tabs { display:flex; gap:2px; margin-bottom:12px; border-bottom:1px solid #333; padding-bottom:6px; flex-wrap:wrap; }
      .te-tab { padding:4px 8px; border-radius:3px 3px 0 0; border:1px solid #333; background:#1a1a1a; color:#888; font-size:10px; cursor:pointer; transition:all 0.15s; border-bottom:none; }
      .te-tab:hover { color:#ccc; }
      .te-tab.active { background:#2a2a3a; color:#58a6ff; border-color:#444; }
      .te-tab-panel { }
      .te-brush-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:4px; }
      .te-brush { padding:6px 4px; border-radius:4px; border:1px solid #444; background:#2a2a3a; color:#ccc; font-size:10px; cursor:pointer; text-align:center; transition:all 0.15s; }
      .te-brush:hover { border-color:#58a6ff; }
      .te-brush.active { border-color:#58a6ff; background:#1f6feb22; color:#58a6ff; }
      .te-layer-list { display:flex; flex-direction:column; gap:4px; }
      .te-layer { display:flex; align-items:center; gap:6px; padding:4px 8px; border-radius:4px; border:1px solid #333; cursor:pointer; transition:all 0.15s; }
      .te-layer:hover { border-color:#555; }
      .te-layer.active { border-color:#58a6ff; background:#1f6feb11; }
      .te-layer-swatch { width:20px; height:20px; border:1px solid #555; border-radius:3px; flex-shrink:0; cursor:pointer; }
      .te-layer-tex { cursor:pointer; font-size:11px; padding:2px 5px; background:#222; border:1px solid #444; border-radius:3px; opacity:0.8; flex-shrink:0; }
      .te-layer-tex:hover { opacity:1; border-color:#58a6ff; }
    `;
    document.head.appendChild(style);
  }

  private initPreview(area: HTMLElement): void {
    if (!this.canvas3d) return;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas3d,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Reuse existing terrain if present, otherwise create default
    if (!this.terrain || this.tiles.size === 0) {
      this.terrain = new TerrainSystem(this.previewScene, {
        width: 256, depth: 256, maxHeight: 50, resolution: 256, chunks: 1, gridX: 0, gridZ: 0,
      });
      this.tiles.clear();
      this.tiles.set('0,0', this.terrain);
      this.activeTileKey = '0,0';
    }

    if (!this.waterPlacement) {
      this.waterPlacement = new WaterPlacementSystem(this.previewScene);
    }

    const resizePreview = () => {
      if (!this.renderer || !this.canvas3d) return;
      const w = area.clientWidth;
      const h = area.clientHeight;
      if (w === 0 || h === 0) return;
      this.renderer.setSize(w, h);
      this.previewCamera.aspect = w / h;
      this.previewCamera.updateProjectionMatrix();
    };

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(resizePreview);
    this.resizeObserver.observe(area);
    resizePreview();

    // OrbitControls — right-click to orbit, middle to pan, scroll to zoom
    this.orbitControls = new OrbitControls(this.previewCamera, this.canvas3d);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.screenSpacePanning = true;
    this.orbitControls.maxPolarAngle = Math.PI * 0.95;
    this.orbitControls.mouseButtons = {
      LEFT: null as any,           // left-click reserved for painting
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.orbitControls.target.set(0, 0, 0);

    // Make canvas focusable for keyboard input
    this.canvas3d.tabIndex = 0;
    this.canvas3d.style.outline = 'none';
    this.canvas3d.addEventListener('keydown', (e) => {
      this.keysPressed.add(e.key.toLowerCase());
      if (['w','a','s','d','q','e',' '].includes(e.key.toLowerCase())) e.preventDefault();
      const controlsEl = this.container.querySelector('.te-controls') as HTMLElement;
      // Brush size shortcuts: [ smaller, ] larger
      if (e.key === '[') { this.brushSize = Math.max(1, this.brushSize - 1); this.updateBrushSizeFromCode(controlsEl); }
      if (e.key === ']') { this.brushSize = Math.min(50, this.brushSize + 1); this.updateBrushSizeFromCode(controlsEl); }
      // Undo/redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); for (const tile of this.tiles.values()) tile.undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); for (const tile of this.tiles.values()) tile.redo(); }
      if (e.key === 'Escape' && this.isPlacingRiver) { this.isPlacingRiver = false; }
    });
    this.canvas3d.addEventListener('keyup', (e) => { this.keysPressed.delete(e.key.toLowerCase()); });
    this.canvas3d.addEventListener('blur', () => { this.keysPressed.clear(); });
    this.canvas3d.addEventListener('mouseenter', () => { this.canvas3d?.focus(); });

    this.startPreviewLoop();
    this.setupPreviewInteraction(area);
  }

  private startPreviewLoop(): void {
    const moveDir = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    let lastTime = performance.now();

    const loop = () => {
      this.animId = requestAnimationFrame(loop);
      if (!this.renderer) return;

      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // WASD camera movement
      if (this.keysPressed.size > 0 && this.orbitControls) {
        const speed = this.keysPressed.has('shift') ? 2.0 : 0.8;

        this.previewCamera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        moveDir.set(0, 0, 0);
        if (this.keysPressed.has('w')) moveDir.add(forward);
        if (this.keysPressed.has('s')) moveDir.sub(forward);
        if (this.keysPressed.has('a')) moveDir.sub(right);
        if (this.keysPressed.has('d')) moveDir.add(right);
        if (this.keysPressed.has('q')) moveDir.y -= 1;
        if (this.keysPressed.has('e') || this.keysPressed.has(' ')) moveDir.y += 1;

        if (moveDir.lengthSq() > 0) {
          moveDir.normalize().multiplyScalar(speed);
          this.previewCamera.position.add(moveDir);
          this.orbitControls.target.add(moveDir);
        }
      }

      this.orbitControls?.update();

      // Update water bodies
      for (const body of this.waterBodies) {
        body.update(dt, this.previewCamera, this.renderer!, this.previewScene);
      }

      this.renderer.render(this.previewScene, this.previewCamera);
    };
    loop();
  }

  private setupPreviewInteraction(area: HTMLElement): void {
    if (!this.canvas3d) return;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const getWorldPos = (e: PointerEvent | MouseEvent): { local: THREE.Vector3; world: THREE.Vector3; tile: TerrainSystem } | null => {
      if (this.tiles.size === 0 || !this.canvas3d) return null;
      const rect = this.canvas3d.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, this.previewCamera);

      // Raycast all tile meshes and pick the closest hit
      let bestHit: THREE.Intersection | null = null;
      let bestTile: TerrainSystem | null = null;
      for (const tile of this.tiles.values()) {
        const hits = raycaster.intersectObject(tile.getMesh());
        if (hits.length > 0 && (!bestHit || hits[0].distance < bestHit.distance)) {
          bestHit = hits[0];
          bestTile = tile;
        }
      }
      if (!bestHit || !bestTile) return null;

      const worldPt = bestHit.point.clone();
      const local = bestTile.getMesh().worldToLocal(worldPt.clone());
      return { local, world: worldPt, tile: bestTile };
    };

    this.canvas3d.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      // River spline: Shift+click adds a point
      if (this.isPlacingRiver && e.shiftKey) {
        const result = getWorldPos(e);
        if (result) {
          this.riverPoints.push(result.world.clone());
          const ptEl = this.container.querySelector('#te-river-pts') as HTMLElement;
          if (ptEl) ptEl.textContent = `Points: ${this.riverPoints.length}`;
        }
        return;
      }

      // Ctrl+Alt+Click → pick tile under cursor
      if (e.ctrlKey && e.altKey) {
        const result = getWorldPos(e);
        if (result) {
          for (const [key, tile] of this.tiles) {
            if (tile === result.tile) {
              this.activeTileKey = key;
              this.terrain = tile;
              const controlsEl = this.container?.querySelector('.te-controls') as HTMLElement;
              if (controlsEl) this.refreshTileGrid(controlsEl);
              break;
            }
          }
        }
        return;
      }

      this.isPainting = true;
      this.canvas3d!.setPointerCapture(e.pointerId);
      const result = getWorldPos(e);
      if (result) {
        this.terrain = result.tile;
        if (this.activeTab === 'foliage') {
          if (this.foliagePaintMode === 'erase') {
            result.tile.eraseFoliageDensity(result.world.x, result.world.z, this.activeFoliageLayerIndex, this.foliageBrushStrength);
          } else {
            result.tile.paintFoliageDensity(result.world.x, result.world.z, this.activeFoliageLayerIndex, this.foliageBrushStrength);
          }
        } else {
          this.terrain.applyBrush(result.local.x, result.local.z, 1/60, result.world.y);
        }
      }
    });

    this.canvas3d.addEventListener('pointermove', (e) => {
      const result = getWorldPos(e);
      if (result) {
        for (const tile of this.tiles.values()) {
          if (tile !== result.tile) tile.hideBrush();
        }
        result.tile.updateBrushPosition(result.world.x, result.world.y, result.world.z);
        if (this.isPainting) {
          this.terrain = result.tile;
          if (this.activeTab === 'foliage') {
            if (this.foliagePaintMode === 'erase') {
              result.tile.eraseFoliageDensity(result.world.x, result.world.z, this.activeFoliageLayerIndex, this.foliageBrushStrength);
            } else {
              result.tile.paintFoliageDensity(result.world.x, result.world.z, this.activeFoliageLayerIndex, this.foliageBrushStrength);
            }
          } else {
            this.terrain.applyBrush(result.local.x, result.local.z, 1/60, result.world.y);
          }
        }
      }
    });

    this.canvas3d.addEventListener('pointerup', (e) => {
      this.isPainting = false;
      this.canvas3d?.releasePointerCapture(e.pointerId);
      // Reset ramp on pointer up
      for (const tile of this.tiles.values()) tile.resetRampOrigin();
      // Rebuild foliage instances after a paint stroke finishes
      if (this.activeTab === 'foliage') {
        for (const tile of this.tiles.values()) tile.refreshFoliageMeshes();
      }
    });
    this.canvas3d.addEventListener('pointerleave', () => {
      this.isPainting = false;
      for (const tile of this.tiles.values()) tile.hideBrush();
    });
  }

  private bindEvents(controls: HTMLElement, _previewArea: HTMLElement): void {
    // ── Tab switching ───────────────────────────────
    controls.querySelectorAll('.te-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeTab = (tab as HTMLElement).dataset.tab as typeof this.activeTab;
        controls.querySelectorAll('.te-tab').forEach(t => t.classList.toggle('active', t === tab));
        controls.querySelectorAll('.te-tab-panel').forEach(p => {
          (p as HTMLElement).style.display = (p as HTMLElement).dataset.panel === this.activeTab ? '' : 'none';
        });
      });
    });

    // ── Range sliders with display ──────────────────
    controls.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(input => {
      const field = input.dataset.field;
      const display = field ? controls.querySelector(`[data-display="${field}"]`) : null;
      input.addEventListener('input', () => {
        if (display) {
          // Format certain fields with decimal places
          if (field === 'noise-persist' || field === 'noise-lacun' || field === 'noise-amp' || field === 'stamp-blend' || field === 'foliage-scale-min' || field === 'foliage-scale-max') {
            display.textContent = (parseInt(input.value) / 100).toFixed(2);
          } else if (field === 'erosion-drops') {
            const v = parseInt(input.value);
            display.textContent = v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v);
          } else {
            display.textContent = input.value;
          }
        }
        this.updateBrushFromControls(controls);
      });
    });

    // ── Brush selection ─────────────────────────────
    controls.querySelectorAll('.te-brush[data-brush]').forEach(btn => {
      btn.addEventListener('click', () => {
        controls.querySelectorAll('.te-brush[data-brush]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeBrush = (btn as HTMLElement).dataset.brush as TerrainBrush;
        this.updateBrushFromControls(controls);
      });
    });

    // ── Layer selection + per-layer props update ─────
    const updateLayerPropsPanel = (idx: number) => {
      const namEl = controls.querySelector('#te-active-layer-name') as HTMLElement;
      const labelEl = controls.querySelector(`[data-layer-label="${idx}"]`) as HTMLElement;
      const currentName = labelEl?.textContent || `Layer ${idx}`;
      if (namEl) namEl.textContent = `${idx} – ${currentName}`;
      // Parse current swatch color to RGB
      const swatch = controls.querySelector(`[data-layer-swatch="${idx}"]`) as HTMLElement;
      if (swatch) {
        const raw = swatch.style.background || '#444444';
        const hex = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#444444';
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        const rIn = controls.querySelector('#te-r') as HTMLInputElement;
        const gIn = controls.querySelector('#te-g') as HTMLInputElement;
        const bIn = controls.querySelector('#te-b') as HTMLInputElement;
        const hexIn = controls.querySelector('#te-hex') as HTMLInputElement;
        if (rIn) { rIn.value = String(r); (controls.querySelector('#te-r-val') as HTMLElement).textContent = String(r); }
        if (gIn) { gIn.value = String(g); (controls.querySelector('#te-g-val') as HTMLElement).textContent = String(g); }
        if (bIn) { bIn.value = String(b); (controls.querySelector('#te-b-val') as HTMLElement).textContent = String(b); }
        if (hexIn) hexIn.value = hex;
        // Update color preview canvas
        const canvas = controls.querySelector('#te-color-preview') as HTMLCanvasElement;
        if (canvas) { const ctx = canvas.getContext('2d')!; ctx.fillStyle = hex; ctx.fillRect(0,0,32,32); }
      }
    };

    controls.querySelectorAll('.te-layer').forEach(layer => {
      layer.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.te-layer-tex')) return;
        controls.querySelectorAll('.te-layer').forEach(l => l.classList.remove('active'));
        layer.classList.add('active');
        const layerIdx = parseInt((layer as HTMLElement).dataset.layer || '0');
        this.activeLayerIndex = layerIdx;
        for (const tile of this.tiles.values()) tile.setPaintLayer(layerIdx);
        updateLayerPropsPanel(layerIdx);
      });
    });

    // ── RGB color picker ─────────────────────────────
    const applyLayerColor = () => {
      const r = parseInt((controls.querySelector('#te-r') as HTMLInputElement)?.value || '128');
      const g = parseInt((controls.querySelector('#te-g') as HTMLInputElement)?.value || '128');
      const b = parseInt((controls.querySelector('#te-b') as HTMLInputElement)?.value || '128');
      const hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
      const hexIn = controls.querySelector('#te-hex') as HTMLInputElement;
      if (hexIn) hexIn.value = hex;
      const canvas = controls.querySelector('#te-color-preview') as HTMLCanvasElement;
      if (canvas) { const ctx = canvas.getContext('2d')!; ctx.fillStyle = hex; ctx.fillRect(0,0,32,32); }
      const swatch = controls.querySelector(`[data-layer-swatch="${this.activeLayerIndex}"]`) as HTMLElement;
      if (swatch) swatch.style.background = hex;
      for (const tile of this.tiles.values()) tile.setLayerColor(this.activeLayerIndex, hex);
    };
    ['#te-r','#te-g','#te-b'].forEach(id => controls.querySelector(id)?.addEventListener('input', (e) => {
      const field = id.slice(1); const valEl = controls.querySelector(`#${field}-val`) as HTMLElement;
      if (valEl) valEl.textContent = (e.target as HTMLInputElement).value;
      applyLayerColor();
    }));
    (controls.querySelector('#te-hex') as HTMLInputElement)?.addEventListener('change', (e) => {
      const hex = (e.target as HTMLInputElement).value;
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      (controls.querySelector('#te-r') as HTMLInputElement).value = String(r);
      (controls.querySelector('#te-g') as HTMLInputElement).value = String(g);
      (controls.querySelector('#te-b') as HTMLInputElement).value = String(b);
      applyLayerColor();
    });

    // ── Per-layer tiling & roughness ─────────────────
    const tilingSlider = controls.querySelector('#te-layer-tiling') as HTMLInputElement;
    tilingSlider?.addEventListener('input', () => {
      const v = parseInt(tilingSlider.value);
      const valEl = controls.querySelector('#te-tiling-val') as HTMLElement;
      if (valEl) valEl.textContent = String(v);
      for (const tile of this.tiles.values()) tile.setLayerTiling(this.activeLayerIndex, v);
    });
    const roughSlider = controls.querySelector('#te-layer-roughness') as HTMLInputElement;
    roughSlider?.addEventListener('input', () => {
      const v = parseInt(roughSlider.value) / 100;
      const valEl = controls.querySelector('#te-roughness-val') as HTMLElement;
      if (valEl) valEl.textContent = v.toFixed(2);
      for (const tile of this.tiles.values()) tile.setLayerRoughness(this.activeLayerIndex, v);
    });

    // ── Blend visualization ───────────────────────────
    (controls.querySelector('[data-field="blend-viz"]') as HTMLSelectElement)?.addEventListener('change', (e) => {
      const v = parseInt((e.target as HTMLSelectElement).value);
      for (const tile of this.tiles.values()) tile.setBlendVisualization(v);
    });

    // ── Diffuse texture import ────────────────────────
    controls.querySelectorAll<HTMLInputElement>('[data-layer-tex]').forEach(input => {
      input.addEventListener('change', () => {
        const file = input.files?.[0]; if (!file) return;
        const idx = parseInt(input.dataset.layerTex || '0');
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const img = new Image();
          img.onload = () => {
            const tex = new THREE.Texture(img);
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.needsUpdate = true;
            for (const tile of this.tiles.values()) tile.setLayer(idx, { name: file.name, diffuse: tex, tiling: 16 });
            // Update layer swatch thumbnail and label
            const swatch = controls.querySelector(`[data-layer-swatch="${idx}"]`) as HTMLElement;
            if (swatch) { swatch.style.backgroundImage = `url(${dataUrl})`; swatch.style.backgroundSize = 'cover'; swatch.style.background = ''; }
            const label = controls.querySelector(`[data-layer-label="${idx}"]`) as HTMLElement;
            const baseName = file.name.replace(/\.[^.]+$/, '');
            if (label) label.textContent = baseName;
            if (idx === this.activeLayerIndex) {
              const namEl = controls.querySelector('#te-active-layer-name') as HTMLElement;
              if (namEl) namEl.textContent = `${idx} – ${baseName}`;
            }
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
      });
    });

    // ── Normal map import ────────────────────────────
    controls.querySelectorAll<HTMLInputElement>('[data-layer-nm]').forEach(input => {
      input.addEventListener('change', () => {
        const file = input.files?.[0]; if (!file) return;
        const idx = parseInt(input.dataset.layerNm || '0');
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image(); img.onload = () => {
            const tex = new THREE.Texture(img);
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.needsUpdate = true;
            for (const tile of this.tiles.values()) tile.setLayerNormalMap(idx, tex);
          };
          img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
      });
    });

    // ── Create terrain ────────────────────────────────
    controls.querySelector('[data-action="create"]')?.addEventListener('click', () => {
      const size = parseInt((controls.querySelector('[data-field="size"]') as HTMLSelectElement)?.value || '256');
      const resolution = parseInt((controls.querySelector('[data-field="resolution"]') as HTMLSelectElement)?.value || '256');
      const maxHeight = parseInt((controls.querySelector('[data-field="maxHeight"]') as HTMLInputElement)?.value || '50');
      for (const tile of this.tiles.values()) { this.previewScene.remove(tile.getMesh()); tile.dispose(); }
      this.tiles.clear();
      this.terrain = new TerrainSystem(this.previewScene, { width: size, depth: size, maxHeight, resolution, chunks: 1, gridX: 0, gridZ: 0 });
      this.tiles.set('0,0', this.terrain);
      this.activeTileKey = '0,0';
      this.updateBrushFromControls(controls);
      this.refreshTileGrid(controls);
    });

    // ── Reset ─────────────────────────────────────────
    controls.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
      for (const tile of this.tiles.values()) { this.previewScene.remove(tile.getMesh()); tile.dispose(); }
      this.tiles.clear();
      this.terrain = new TerrainSystem(this.previewScene, { width: 256, depth: 256, maxHeight: 50, resolution: 256, chunks: 1, gridX: 0, gridZ: 0 });
      this.tiles.set('0,0', this.terrain);
      this.activeTileKey = '0,0';
      this.refreshTileGrid(controls);
    });

    // ── Undo / Redo ───────────────────────────────────
    controls.querySelector('[data-action="undo"]')?.addEventListener('click', () => { for (const tile of this.tiles.values()) tile.undo(); });
    controls.querySelector('[data-action="redo"]')?.addEventListener('click', () => { for (const tile of this.tiles.values()) tile.redo(); });

    // ── Import PNG heightmap ──────────────────────────
    const updateImportInfo = () => {
      const tilesVal = (controls.querySelector('[data-field="import-tiles"]') as HTMLSelectElement)?.value;
      const tileSz = parseInt((controls.querySelector('[data-field="import-tile-size"]') as HTMLSelectElement)?.value ?? '128');
      const infoEl = controls.querySelector('[data-display="import-info"]') as HTMLElement;
      if (!infoEl) return;
      if (tilesVal === 'auto') { infoEl.textContent = 'Auto: tile count from image ÷ resolution'; }
      else { const n = parseInt(tilesVal); infoEl.textContent = `${n}×${n} tiles = ${n*tileSz}×${n*tileSz} units`; }
    };
    controls.querySelector('[data-field="import-tiles"]')?.addEventListener('change', updateImportInfo);
    controls.querySelector('[data-field="import-tile-size"]')?.addEventListener('change', updateImportInfo);
    controls.querySelector('[data-field="import-res"]')?.addEventListener('change', updateImportInfo);

    controls.querySelector('[data-action="import-hm"]')?.addEventListener('click', () => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.png,.jpg,.jpeg';
      input.onchange = () => {
        const file = input.files?.[0]; if (!file) return;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const tilesVal = (controls.querySelector('[data-field="import-tiles"]') as HTMLSelectElement)?.value ?? 'auto';
          const tileRes = parseInt((controls.querySelector('[data-field="import-res"]') as HTMLSelectElement)?.value ?? '128');
          const tileSz  = parseInt((controls.querySelector('[data-field="import-tile-size"]') as HTMLSelectElement)?.value ?? '128');
          const maxH    = parseInt((controls.querySelector('[data-field="maxHeight"]') as HTMLInputElement)?.value ?? '50');
          let tilesX: number, tilesZ: number;
          if (tilesVal === 'auto') { tilesX = Math.max(1, Math.ceil(img.width / tileRes)); tilesZ = Math.max(1, Math.ceil(img.height / tileRes)); }
          else { tilesX = parseInt(tilesVal); tilesZ = tilesX; }
          for (const tile of this.tiles.values()) { this.previewScene.remove(tile.getMesh()); tile.dispose(); } this.tiles.clear();
          const totalPX = tilesX * tileRes, totalPZ = tilesZ * tileRes;
          const rc = document.createElement('canvas'); rc.width = totalPX; rc.height = totalPZ;
          const rctx = rc.getContext('2d')!; rctx.imageSmoothingEnabled = true; rctx.imageSmoothingQuality = 'high';
          rctx.drawImage(img, 0, 0, totalPX, totalPZ);
          const pixels = rctx.getImageData(0, 0, totalPX, totalPZ).data;
          for (let gz = 0; gz < tilesZ; gz++) {
            for (let gx = 0; gx < tilesX; gx++) {
              const wx = this.getCenteredGridCoordinate(gx, tilesX), wz = this.getCenteredGridCoordinate(gz, tilesZ);
              const tile = new TerrainSystem(this.previewScene, { width: tileSz, depth: tileSz, maxHeight: maxH, resolution: tileRes, chunks: 1, gridX: wx, gridZ: wz });
              const hd = tile.getHeightData();
              const sx = gx * tileRes, sz = gz * tileRes;
              for (let lz = 0; lz < tileRes; lz++) for (let lx = 0; lx < tileRes; lx++) hd[lz*tileRes+lx] = (pixels[((sz+lz)*totalPX+(sx+lx))*4] / 255) * maxH;
              tile.refreshGeometry();
              this.tiles.set(`${wx},${wz}`, tile);
            }
          }
          this.activeTileKey = this.findClosestTileKeyToOrigin();
          this.terrain = this.tiles.get(this.activeTileKey)!;
          this.updateBrushFromControls(controls); this.refreshTileGrid(controls); URL.revokeObjectURL(url);
        };
        img.src = url;
      };
      input.click();
    });

    // ── Export PNG heightmap ──────────────────────────
    controls.querySelector('[data-action="export-hm"]')?.addEventListener('click', () => {
      if (!this.terrain) return;
      const a = document.createElement('a'); a.href = this.terrain.exportHeightmap(); a.download = 'terrain.png'; a.click();
    });

    // ── RAW 16-bit import ─────────────────────────────
    controls.querySelector('[data-action="import-raw"]')?.addEventListener('click', () => {
      if (!this.terrain) return;
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.raw,.r16,.r16l';
      input.onchange = () => {
        const file = input.files?.[0]; if (!file) return;
        file.arrayBuffer().then(buf => {
          const data = new Uint16Array(buf);
          const s = Math.round(Math.sqrt(data.length));
          this.terrain!.importHeightmapRAW(data, s, s);
        });
      };
      input.click();
    });

    // ── RAW 16-bit export ─────────────────────────────
    controls.querySelector('[data-action="export-raw"]')?.addEventListener('click', () => {
      if (!this.terrain) return;
      const raw = this.terrain.exportHeightmapRAW();
      const blob = new Blob([raw.buffer as ArrayBuffer], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'terrain.raw'; a.click();
    });

    // ── Apply all tiles to main scene ────────────────
    controls.querySelector('[data-action="apply"]')?.addEventListener('click', () => {
      if (this.tiles.size === 0) return;
      const scene = this.editor.scene;
      const generateCollision = (controls.querySelector('[data-field="collision"]') as HTMLInputElement)?.checked ?? true;
      const existing = scene.getObjectByName('TerrainGroup');
      if (existing) { existing.traverse(child => { if (child instanceof THREE.Mesh) { child.geometry?.dispose(); (Array.isArray(child.material) ? child.material : [child.material]).forEach((m: THREE.Material) => m.dispose()); } }); scene.remove(existing); }
      const terrainGroup = new THREE.Group(); terrainGroup.name = 'TerrainGroup'; scene.add(terrainGroup);
      const tileEntries = [...this.tiles.entries()]; const total = tileEntries.length; let processed = 0;
      const overlay = document.createElement('div'); overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99999;flex-direction:column;color:#fff;font-family:system-ui;';
      const progressText = document.createElement('div'); progressText.style.cssText = 'font-size:18px;margin-bottom:12px;'; progressText.textContent = `Applying terrain... 0/${total}`;
      const progressBar = document.createElement('div'); progressBar.style.cssText = 'width:400px;height:12px;background:#333;border-radius:6px;overflow:hidden;';
      const progressFill = document.createElement('div'); progressFill.style.cssText = 'height:100%;background:#2a6;width:0%;transition:width 0.2s;';
      progressBar.appendChild(progressFill); overlay.appendChild(progressText); overlay.appendChild(progressBar); document.body.appendChild(overlay);
      const processBatch = () => {
        const end = Math.min(processed + 10, total);
        for (let i = processed; i < end; i++) {
          const [key, tile] = tileEntries[i];
          const config = tile.getConfig(); const heightData = tile.getHeightData();
          const [fbx, fbz] = key.split(',').map(Number);
          const gridX = config.gridX ?? fbx, gridZ = config.gridZ ?? fbz;
          const mainTile = new TerrainSystem(terrainGroup, { width: config.width, depth: config.depth, maxHeight: config.maxHeight, resolution: config.resolution, chunks: 1, gridX, gridZ });
          const mh = mainTile.getHeightData(); for (let j = 0; j < heightData.length && j < mh.length; j++) mh[j] = isFinite(heightData[j]) ? heightData[j] : 0;
          mainTile.refreshGeometry();
          const sd = mainTile.getSplatData(); const s = tile.getSplatData(); for (let j = 0; j < s.length && j < sd.length; j++) sd[j] = s[j];
          const sd2 = mainTile.getSplatData2(); const s2 = tile.getSplatData2(); for (let j = 0; j < s2.length && j < sd2.length; j++) sd2[j] = s2[j];
          mainTile.refreshSplatMap();
          const srcLayers = tile.getLayers(); const srcMat = tile.getMaterial();
          for (let li = 0; li < 8; li++) { const layer = srcLayers[li]; if (layer) { mainTile.setLayer(li, { name: layer.name, diffuse: layer.diffuse, tiling: layer.tiling }); } else { const dm = mainTile.getMaterial(); const dk = `layer${li}Diffuse`, tk = `layer${li}Tiling`; const tv = srcMat.uniforms[dk]?.value, tl = srcMat.uniforms[tk]?.value; if (tv) { dm.uniforms[dk].value = tv; if (tl !== undefined) dm.uniforms[tk].value = tl; dm.needsUpdate = true; } } }
          if (generateCollision) terrainGroup.add(mainTile.generateCollisionMesh());
        }
        processed = end; progressText.textContent = `Applying terrain... ${processed}/${total}`; progressFill.style.width = `${(processed/total)*100}%`;
        if (processed < total) { setTimeout(processBatch, 16); }
        else {
          // Apply water bodies to main scene
          if (this.waterBodies.length > 0) {
            const existingWater = scene.getObjectByName('WaterGroup');
            if (existingWater) { existingWater.traverse(child => { if (child instanceof THREE.Mesh) { child.geometry?.dispose(); (Array.isArray(child.material) ? child.material : [child.material]).forEach((m: THREE.Material) => m.dispose()); } }); scene.remove(existingWater); }
            const sceneWater = new WaterPlacementSystem(scene);
            for (const body of this.waterBodies) {
              const waterLevel = parseInt((controls.querySelector('[data-field="water-level"]') as HTMLInputElement)?.value || '0');
              switch (body.type) {
                case 'ocean': sceneWater.addOcean(waterLevel); break;
                case 'lake': sceneWater.addLake(new THREE.Vector3(0, waterLevel, 0), 50, waterLevel); break;
                case 'lava': sceneWater.addLava(new THREE.Vector3(0, waterLevel, 0)); break;
                case 'shallow': sceneWater.addShallow(new THREE.Vector3(0, waterLevel, 0)); break;
                case 'river': break; // River already uses points stored in the preview
              }
            }
            // Store water system on engine for runtime updates
            (this.editor.engine as any)._sceneWater = sceneWater;
          }
          overlay.remove(); this.editor.hierarchy.refresh(); this.editor.engine.events.emit('terrain:applied');
        }
      };
      setTimeout(processBatch, 50);
    });

    // ── Tile grid controls ────────────────────────────
    const addTile = (dx: number, dz: number) => {
      if (!this.terrain) return;
      const [cx, cz] = this.activeTileKey.split(',').map(Number);
      const key = `${cx+dx},${cz+dz}`; if (this.tiles.has(key)) return;
      const config = this.terrain.getConfig();
      const newTile = new TerrainSystem(this.previewScene, { width: config.width, depth: config.depth, maxHeight: config.maxHeight, resolution: config.resolution, chunks: 1, gridX: cx+dx, gridZ: cz+dz });
      this.tiles.set(key, newTile); this.refreshTileGrid(controls);
    };
    controls.querySelector('[data-action="add-tile-n"]')?.addEventListener('click', () => addTile(0, -1));
    controls.querySelector('[data-action="add-tile-s"]')?.addEventListener('click', () => addTile(0, 1));
    controls.querySelector('[data-action="add-tile-e"]')?.addEventListener('click', () => addTile(1, 0));
    controls.querySelector('[data-action="add-tile-w"]')?.addEventListener('click', () => addTile(-1, 0));
    controls.querySelector('[data-action="remove-tile"]')?.addEventListener('click', () => {
      if (this.tiles.size <= 1) return;
      const tile = this.tiles.get(this.activeTileKey); if (!tile) return;
      this.previewScene.remove(tile.getMesh()); tile.dispose(); this.tiles.delete(this.activeTileKey);
      const firstKey = this.tiles.keys().next().value!; this.activeTileKey = firstKey; this.terrain = this.tiles.get(firstKey)!;
      this.updateBrushFromControls(controls); this.refreshTileGrid(controls);
    });

    // ── Edge stitch ───────────────────────────────────
    controls.querySelector('[data-action="stitch-edges"]')?.addEventListener('click', () => {
      for (const [key, tile] of this.tiles) {
        const [gx, gz] = key.split(',').map(Number);
        const neighbors: Array<[string, 'north'|'south'|'east'|'west']> = [
          [`${gx},${gz-1}`,'north'],[`${gx},${gz+1}`,'south'],[`${gx+1},${gz}`,'east'],[`${gx-1},${gz}`,'west']
        ];
        for (const [nk, dir] of neighbors) { const n = this.tiles.get(nk); if (n) tile.stitchEdgeWith(n, dir); }
      }
    });

    // ── Generate: Noise ────────────────────────────────
    const getNoiseParams = (additive: boolean): NoiseParams => ({
      scale:     parseInt((controls.querySelector('[data-field="noise-scale"]') as HTMLInputElement)?.value || '4'),
      octaves:   parseInt((controls.querySelector('[data-field="noise-octaves"]') as HTMLInputElement)?.value || '6'),
      persistence: parseInt((controls.querySelector('[data-field="noise-persist"]') as HTMLInputElement)?.value || '50') / 100,
      lacunarity:  parseInt((controls.querySelector('[data-field="noise-lacun"]') as HTMLInputElement)?.value || '20') / 10,
      amplitude:   parseInt((controls.querySelector('[data-field="noise-amp"]') as HTMLInputElement)?.value || '100') / 100,
      offsetX: Math.random() * 100, offsetZ: Math.random() * 100, additive,
    });
    controls.querySelector('[data-action="gen-noise"]')?.addEventListener('click', () => { for (const tile of this.tiles.values()) tile.applyNoiseHeightmap(getNoiseParams(false)); });
    controls.querySelector('[data-action="gen-noise-add"]')?.addEventListener('click', () => { for (const tile of this.tiles.values()) tile.applyNoiseHeightmap(getNoiseParams(true)); });

    // ── Biome presets ──────────────────────────────────
    const applyBiome = (p: NoiseParams) => { for (const tile of this.tiles.values()) tile.applyNoiseHeightmap(p); };
    controls.querySelector('[data-action="biome-flat"]')?.addEventListener('click', () => { for (const tile of this.tiles.values()) { tile.getHeightData().fill(0); tile.refreshGeometry(); } });
    controls.querySelector('[data-action="biome-hills"]')?.addEventListener('click', () => applyBiome({ scale: 3, octaves: 5, persistence: 0.5, lacunarity: 2, amplitude: 0.5, offsetX: Math.random()*100, offsetZ: Math.random()*100 }));
    controls.querySelector('[data-action="biome-mountains"]')?.addEventListener('click', () => applyBiome({ scale: 2, octaves: 8, persistence: 0.55, lacunarity: 2.2, amplitude: 1, offsetX: Math.random()*100, offsetZ: Math.random()*100 }));
    controls.querySelector('[data-action="biome-canyon"]')?.addEventListener('click', () => applyBiome({ scale: 1.5, octaves: 4, persistence: 0.7, lacunarity: 3, amplitude: 0.9, offsetX: Math.random()*100, offsetZ: Math.random()*100 }));
    controls.querySelector('[data-action="biome-island"]')?.addEventListener('click', () => applyBiome({ scale: 1, octaves: 6, persistence: 0.45, lacunarity: 2, amplitude: 0.8, offsetX: Math.random()*100, offsetZ: Math.random()*100 }));
    controls.querySelector('[data-action="biome-badlands"]')?.addEventListener('click', () => applyBiome({ scale: 4, octaves: 3, persistence: 0.8, lacunarity: 4, amplitude: 0.75, offsetX: Math.random()*100, offsetZ: Math.random()*100 }));

    // ── Slope auto-paint ───────────────────────────────
    controls.querySelector('[data-action="slope-paint"]')?.addEventListener('click', () => {
      const sMin = parseInt((controls.querySelector('[data-field="slope-min"]') as HTMLInputElement)?.value || '30');
      const sMax = parseInt((controls.querySelector('[data-field="slope-max"]') as HTMLInputElement)?.value || '60');
      const sLayer = parseInt((controls.querySelector('[data-field="slope-layer"]') as HTMLSelectElement)?.value || '0');
      for (const tile of this.tiles.values()) tile.applySlopeAutoPaint(sMin, sMax, sLayer);
    });

    // ── Hydraulic erosion via Web Worker ───────────────
    controls.querySelector('[data-action="run-erosion"]')?.addEventListener('click', () => {
      if (!this.terrain) return;
      const drops = parseInt((controls.querySelector('[data-field="erosion-drops"]') as HTMLInputElement)?.value || '50000');
      const statusEl = controls.querySelector('#erosion-status') as HTMLElement;
      const tile = this.terrain;
      const config = tile.getConfig();
      const heightCopy = new Float32Array(tile.getHeightData());
      const workerUrl = new URL('../engine/workers/erosionWorker.ts', import.meta.url);
      let worker: Worker;
      try { worker = new Worker(workerUrl, { type: 'module' }); }
      catch { if (statusEl) statusEl.textContent = '⚠ Worker not available'; return; }
      if (statusEl) statusEl.textContent = '⏳ Running erosion…';
      worker.postMessage({ heightData: heightCopy.buffer, resolution: config.resolution, droplets: drops }, [heightCopy.buffer]);
      worker.onmessage = (e) => {
        const result = new Float32Array(e.data.heightData);
        tile.getHeightData().set(result);
        tile.refreshGeometry();
        if (statusEl) statusEl.textContent = '✅ Done';
        worker.terminate();
      };
      worker.onerror = () => { if (statusEl) statusEl.textContent = '❌ Error in worker'; worker.terminate(); };
    });

    // ── Stamp blend ────────────────────────────────────
    controls.querySelector('[data-action="import-stamp"]')?.addEventListener('click', () => {
      if (!this.terrain) return;
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0]; if (!file) return;
        const scale = parseInt((controls.querySelector('[data-field="stamp-scale"]') as HTMLInputElement)?.value || '100');
        const blend = parseInt((controls.querySelector('[data-field="stamp-blend"]') as HTMLInputElement)?.value || '50') / 100;
        const url = URL.createObjectURL(file);
        for (const tile of this.tiles.values()) tile.applyStampBlend(url, 0, 0, scale, blend).then(() => URL.revokeObjectURL(url));
      };
      input.click();
    });

    // ── Water level / shore foam ───────────────────────
    (controls.querySelector('[data-field="water-level"]') as HTMLInputElement)?.addEventListener('input', (e) => {
      const wl = parseInt((e.target as HTMLInputElement).value);
      const foam = (controls.querySelector('[data-field="shore-foam"]') as HTMLInputElement)?.checked ?? true;
      for (const tile of this.tiles.values()) tile.setShoreFoam(foam, wl);
    });
    (controls.querySelector('[data-field="shore-foam"]') as HTMLInputElement)?.addEventListener('change', (e) => {
      const foam = (e.target as HTMLInputElement).checked;
      const wl = parseInt((controls.querySelector('[data-field="water-level"]') as HTMLInputElement)?.value || '0');
      for (const tile of this.tiles.values()) tile.setShoreFoam(foam, wl);
    });
    controls.querySelector('[data-action="add-water"]')?.addEventListener('click', () => {
      if (!this.waterPlacement) return;
      const waterLevel = parseInt((controls.querySelector('[data-field="water-level"]') as HTMLInputElement)?.value || '0');
      let handle: WaterBodyHandle;
      switch (this.selectedWaterType) {
        case 'ocean':
          handle = this.waterPlacement.addOcean(waterLevel);
          break;
        case 'lake':
          handle = this.waterPlacement.addLake(new THREE.Vector3(0, waterLevel, 0), 50, waterLevel);
          break;
        case 'lava':
          handle = this.waterPlacement.addLava(new THREE.Vector3(0, waterLevel, 0));
          break;
        case 'shallow':
          handle = this.waterPlacement.addShallow(new THREE.Vector3(0, waterLevel, 0));
          break;
        case 'river':
          return; // Rivers use spline placement
      }
      this.waterBodies.push(handle);
      const countEl = controls.querySelector('[data-display="water-count"]') as HTMLElement;
      if (countEl) countEl.textContent = `Water bodies: ${this.waterBodies.length}`;
    });
    controls.querySelector('[data-action="remove-water"]')?.addEventListener('click', () => {
      for (const body of this.waterBodies) body.dispose();
      this.waterBodies = [];
      const countEl = controls.querySelector('[data-display="water-count"]') as HTMLElement;
      if (countEl) countEl.textContent = 'Water bodies: 0';
    });
    // ── Water type selection ─────────────────────────
    controls.querySelectorAll('.te-brush[data-water]').forEach(btn => {
      btn.addEventListener('click', () => {
        controls.querySelectorAll('.te-brush[data-water]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedWaterType = (btn as HTMLElement).dataset.water as WaterBodyType;
      });
    });

    // ── River placement ────────────────────────────────
    controls.querySelector('[data-action="start-river"]')?.addEventListener('click', () => {
      this.riverPoints = []; this.isPlacingRiver = true;
      const ptEl = controls.querySelector('#te-river-pts') as HTMLElement;
      if (ptEl) ptEl.textContent = 'Points: 0 (Shift+click in viewport)';
    });
    controls.querySelector('[data-action="finish-river"]')?.addEventListener('click', () => {
      this.isPlacingRiver = false;
      if (this.riverPoints.length >= 2 && this.waterPlacement) {
        const handle = this.waterPlacement.addRiver(this.riverPoints);
        this.waterBodies.push(handle);
        const countEl = controls.querySelector('[data-display="water-count"]') as HTMLElement;
        if (countEl) countEl.textContent = `Water bodies: ${this.waterBodies.length}`;
      }
    });
    controls.querySelector('[data-action="clear-river"]')?.addEventListener('click', () => { this.riverPoints = []; this.isPlacingRiver = false; const ptEl = controls.querySelector('#te-river-pts') as HTMLElement; if (ptEl) ptEl.textContent = 'Points: 0'; });

    // ── Foliage refresh ────────────────────────────────
    controls.querySelector('[data-action="refresh-foliage"]')?.addEventListener('click', () => {
      for (const tile of this.tiles.values()) tile.refreshFoliageMeshes();
    });

    // ── Foliage paint mode ──────────────────────────────
    controls.querySelectorAll('.te-brush[data-foliage-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        controls.querySelectorAll('.te-brush[data-foliage-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.foliagePaintMode = (btn as HTMLElement).dataset.foliageMode as 'paint' | 'erase';
      });
    });

    // ── Foliage brush sliders ───────────────────────────
    const foliageSizeEl = controls.querySelector('[data-field="foliage-size"]') as HTMLInputElement;
    const foliageDensityEl = controls.querySelector('[data-field="foliage-density"]') as HTMLInputElement;
    foliageSizeEl?.addEventListener('input', () => {
      this.foliageBrushSize = parseInt(foliageSizeEl.value);
      const d = controls.querySelector('[data-display="foliage-size"]') as HTMLElement;
      if (d) d.textContent = String(this.foliageBrushSize);
      for (const tile of this.tiles.values()) tile.setBrush(this.activeBrush, this.foliageBrushSize, this.brushStrength);
    });
    foliageDensityEl?.addEventListener('input', () => {
      this.foliageBrushStrength = parseInt(foliageDensityEl.value) / 100;
      const d = controls.querySelector('[data-display="foliage-density"]') as HTMLElement;
      if (d) d.textContent = String(parseInt(foliageDensityEl.value));
    });

    // ── Foliage slope / scale sliders (live-update templates) ──
    const getFoliageLayerProps = () => ({
      scaleMin: parseInt((controls.querySelector('[data-field="foliage-scale-min"]') as HTMLInputElement)?.value || '80') / 100,
      scaleMax: parseInt((controls.querySelector('[data-field="foliage-scale-max"]') as HTMLInputElement)?.value || '120') / 100,
      slopeMin: parseInt((controls.querySelector('[data-field="foliage-slope-min"]') as HTMLInputElement)?.value || '0'),
      slopeMax: parseInt((controls.querySelector('[data-field="foliage-slope-max"]') as HTMLInputElement)?.value || '45'),
    });
    ['foliage-slope-min','foliage-slope-max'].forEach(field => {
      const el = controls.querySelector(`[data-field="${field}"]`) as HTMLInputElement;
      const disp = controls.querySelector(`[data-display="${field}"]`) as HTMLElement;
      el?.addEventListener('input', () => { if (disp) disp.textContent = `${el.value}°`; });
    });

    // ── Add foliage layer: GLTF import ──────────────────
    const addFoliageLayer = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
      const props = getFoliageLayerProps();
      this.foliageTemplates.push({ name, geometry: geo, material: mat, ...props });
      const li = this.foliageTemplates.length - 1;
      this.activeFoliageLayerIndex = li;
      const MAX_INST = 50000;
      for (const tile of this.tiles.values()) {
        const instMesh = new THREE.InstancedMesh(geo, mat, MAX_INST);
        instMesh.count = 0;
        instMesh.castShadow = true;
        tile.addFoliageLayer({ name, mesh: instMesh, scaleMin: props.scaleMin, scaleMax: props.scaleMax, slopeMin: props.slopeMin, slopeMax: props.slopeMax });
      }
      this.refreshFoliageLayerList(controls);
    };

    controls.querySelector('[data-action="add-foliage-layer"]')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.glb,.gltf';
      input.onchange = () => {
        const file = input.files?.[0]; if (!file) return;
        const url = URL.createObjectURL(file);
        const loader = new GLTFLoader();
        loader.loadAsync(url).then(gltf => {
          let geo: THREE.BufferGeometry = new THREE.BoxGeometry(0.4, 1, 0.4);
          let mat: THREE.Material = new THREE.MeshLambertMaterial({ color: 0x3a8a3a });
          gltf.scene.traverse(child => {
            if ((child as THREE.Mesh).isMesh) {
              const m = child as THREE.Mesh;
              geo = m.geometry;
              mat = Array.isArray(m.material) ? m.material[0] : m.material;
            }
          });
          addFoliageLayer(geo, mat, file.name.replace(/\.[^.]+$/, ''));
          URL.revokeObjectURL(url);
        }).catch(err => {
          console.warn('[Foliage] GLTF load failed:', err);
          URL.revokeObjectURL(url);
        });
      };
      input.click();
    });

    controls.querySelector('[data-action="add-foliage-box"]')?.addEventListener('click', () => {
      const geo = new THREE.ConeGeometry(0.25, 1.5, 5);
      const mat = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
      addFoliageLayer(geo, mat, `Tree ${this.foliageTemplates.length + 1}`);
    });

    controls.querySelector('[data-action="remove-foliage-layer"]')?.addEventListener('click', () => {
      const li = this.activeFoliageLayerIndex;
      if (li < 0 || li >= this.foliageTemplates.length) return;
      for (const tile of this.tiles.values()) tile.removeFoliageLayer(li);
      this.foliageTemplates.splice(li, 1);
      this.activeFoliageLayerIndex = Math.max(0, li - 1);
      this.refreshFoliageLayerList(controls);
    });

    controls.querySelector('[data-action="clear-foliage-density"]')?.addEventListener('click', () => {
      for (const tile of this.tiles.values()) {
        tile.clearFoliageDensity(this.activeFoliageLayerIndex);
        tile.refreshFoliageMeshes();
      }
    });

    // ── Wave config sliders (update all water bodies live) ──
    const applyWaveConfig = () => {
      const amp  = parseInt((controls.querySelector('[data-field="wave-amp"]')  as HTMLInputElement)?.value || '80')  / 100;
      const spd  = parseInt((controls.querySelector('[data-field="wave-speed"]') as HTMLInputElement)?.value || '60')  / 100;
      const opac = parseInt((controls.querySelector('[data-field="wave-opacity"]') as HTMLInputElement)?.value || '85') / 100;
      for (const body of this.waterBodies) body.setWaveConfig?.(amp, spd, opac);
    };

    ['wave-amp','wave-speed','wave-opacity'].forEach(field => {
      const el = controls.querySelector(`[data-field="${field}"]`) as HTMLInputElement;
      const disp = controls.querySelector(`[data-display="${field}"]`) as HTMLElement;
      el?.addEventListener('input', () => {
        if (disp) disp.textContent = (parseInt(el.value) / 100).toFixed(2);
        applyWaveConfig();
      });
    });
  }

  /** Rebuilds the foliage layer list UI in the foliage tab. */
  private refreshFoliageLayerList(controls: HTMLElement): void {
    const listEl = controls.querySelector('#te-foliage-layer-list') as HTMLElement;
    if (!listEl) return;
    listEl.innerHTML = '';
    if (this.foliageTemplates.length === 0) {
      listEl.innerHTML = '<div style="font-size:10px;color:#666;padding:4px;">No layers — add a GLTF or box placeholder.</div>';
      return;
    }
    this.foliageTemplates.forEach((tpl, i) => {
      const item = document.createElement('div');
      const isActive = i === this.activeFoliageLayerIndex;
      item.style.cssText = `display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;cursor:pointer;border:1px solid ${isActive?'#58a6ff':'#333'};background:${isActive?'#1f6feb22':'#1a1a1a'};font-size:11px;`;
      item.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tpl.name}</span><span style="font-size:10px;color:#666;">${tpl.slopeMin}°–${tpl.slopeMax}°</span>`;
      item.addEventListener('click', () => {
        this.activeFoliageLayerIndex = i;
        this.refreshFoliageLayerList(controls);
      });
      listEl.appendChild(item);
    });
  }

  private updateBrushSizeFromCode(controls: HTMLElement | null): void {
    if (!controls) return;
    const sizeInput = controls.querySelector('[data-field="brushSize"]') as HTMLInputElement;
    const display = controls.querySelector('[data-display="brushSize"]') as HTMLElement;
    if (sizeInput) sizeInput.value = String(this.brushSize);
    if (display) display.textContent = String(this.brushSize);
    this.updateBrushFromControls(controls);
  }

  private updateBrushFromControls(controls: HTMLElement): void {
    const size = parseInt((controls.querySelector('[data-field="brushSize"]') as HTMLInputElement)?.value || '10');
    const strength = parseInt((controls.querySelector('[data-field="brushStrength"]') as HTMLInputElement)?.value || '30') / 100;
    const falloff = parseInt((controls.querySelector('[data-field="brushFalloff"]') as HTMLInputElement)?.value || '50') / 100;

    this.brushSize = size;
    this.brushStrength = strength;

    // Propagate brush to ALL tiles so painting on any tile uses the correct mode
    for (const tile of this.tiles.values()) {
      tile.setBrush(this.activeBrush, size, strength, falloff);
    }
  }

  private refreshTileGrid(controls: HTMLElement): void {
    const tilesDisplay = controls.querySelector('[data-display="tiles"]') as HTMLElement;
    const tilemap = controls.querySelector('[data-container="tilemap"]') as HTMLElement;
    if (!tilesDisplay || !tilemap) return;

    tilesDisplay.textContent = `Tiles: ${this.tiles.size}`;

    // Compute grid bounds
    let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
    for (const key of this.tiles.keys()) {
      const [gx, gz] = key.split(',').map(Number);
      minX = Math.min(minX, gx); maxX = Math.max(maxX, gx);
      minZ = Math.min(minZ, gz); maxZ = Math.max(maxZ, gz);
    }

    const cols = maxX - minX + 1;
    const rows = maxZ - minZ + 1;
    tilemap.style.gridTemplateColumns = `repeat(${cols}, 40px)`;
    tilemap.innerHTML = '';

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const key = `${x},${z}`;
        const cell = document.createElement('div');
        cell.style.cssText = 'width:40px;height:40px;border-radius:4px;font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.15s;font-weight:600;';

        if (this.tiles.has(key)) {
          const isActive = key === this.activeTileKey;
          cell.style.background = isActive ? '#1f6feb' : '#2a2a3a';
          cell.style.border = isActive ? '2px solid #58a6ff' : '1px solid #444';
          cell.style.color = '#ccc';
          cell.textContent = `${this.formatTileCoordinate(x)},${this.formatTileCoordinate(z)}`;
          cell.addEventListener('click', () => {
            this.activeTileKey = key;
            this.terrain = this.tiles.get(key)!;
            this.updateBrushFromControls(controls);
            this.refreshTileGrid(controls);
          });
        } else {
          cell.style.background = '#111';
          cell.style.border = '1px solid #222';
        }
        tilemap.appendChild(cell);
      }
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.animId);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.orbitControls?.dispose();
    this.renderer?.dispose();
    for (const body of this.waterBodies) body.dispose();
    this.waterBodies = [];
  }

  private getCenteredGridCoordinate(index: number, tileCount: number): number {
    return index - (tileCount - 1) / 2;
  }

  private findClosestTileKeyToOrigin(): string {
    let bestKey = this.tiles.keys().next().value as string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const key of this.tiles.keys()) {
      const [gridX, gridZ] = key.split(',').map(Number);
      const distance = gridX * gridX + gridZ * gridZ;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestKey = key;
      }
    }

    return bestKey ?? '0,0';
  }

  private formatTileCoordinate(value: number): string {
    return Number.isInteger(value) ? `${value}` : value.toFixed(1);
  }
}
