/**
 * ModelingRiggingPanel — Full 3D modeling, sculpting, UV editing & rigging.
 *
 * Features:
 * - Create primitives from scratch (Cube, Sphere, Cylinder, Plane, Torus, Cone, etc.)
 * - Vertex / Edge / Face selection modes with multi-select (Shift)
 * - Move / Rotate / Scale vertices, edges, faces
 * - Extrude faces, Inset faces, Loop cut
 * - Subdivide & simplify mesh, merge vertices
 * - Basic sculpting: push/pull, smooth, flatten brushes
 * - UV Map editor: view and adjust UVs in side panel
 * - Texture assignment: drag texture onto model
 * - Bone creation & hierarchy for rigging
 * - Weight paint visualization
 * - Normals recalculation, flip normals
 * - Mirror modifier (X/Y/Z)
 * - Import from scene / Export back to scene
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { EditorApp } from '../EditorApp';

type EditMode = 'object' | 'vertex' | 'edge' | 'face' | 'sculpt' | 'uv' | 'weightpaint';
type SculptBrush = 'push' | 'pull' | 'smooth' | 'flatten';

export class ModelingRiggingPanel {
  private editor: EditorApp;
  private container!: HTMLElement;

  // 3D preview
  private canvas!: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.05, 500);
  private orbit!: OrbitControls;
  private animId = 0;
  private resizeObserver: ResizeObserver | null = null;

  // State
  private editMode: EditMode = 'object';
  private model: THREE.Object3D | null = null;
  private activeMesh: THREE.Mesh | null = null;
  private wireframeOverlay: THREE.LineSegments | null = null;
  private vertexDots: THREE.Points | null = null;
  private selectedVerts = new Set<number>();
  private selectedFaces = new Set<number>();
  private bones: THREE.Bone[] = [];
  private skeletonHelper: THREE.SkeletonHelper | null = null;
  private showWeights = false;
  private toolMode: 'select' | 'move' | 'rotate' | 'scale' | 'addBone' | 'extrude' | 'inset' | 'loopcut' = 'select';

  // Weight paint
  private weightPaintBrushRadius = 0.4;
  private weightPaintBrushStrength = 0.1;
  private weightPaintActiveBoneIndex = 0;
  private weightPaintPanelEl!: HTMLElement;
  private isWeightPainting = false;

  // Morph targets
  private morphTargetNames: string[] = [];
  private morphTargetPanelEl!: HTMLElement;

  // Sculpting
  private sculptBrush: SculptBrush = 'push';
  private sculptRadius = 0.5;
  private sculptStrength = 0.3;
  private isSculpting = false;

  // UV editor
  private uvCanvas: HTMLCanvasElement | null = null;
  private uvCtx: CanvasRenderingContext2D | null = null;

  // Sidebar elements
  private sidebarEl!: HTMLElement;
  private infoEl!: HTMLElement;
  private bonesEl!: HTMLElement;
  private uvPanelEl!: HTMLElement;
  private sculptPanelEl!: HTMLElement;

  // Edge selection
  private selectedEdges = new Set<string>(); // "minIdx_maxIdx"

  // Drag state (move tool)
  private isDragging = false;
  private dragPlane = new THREE.Plane();
  private dragOrigin = new THREE.Vector3();
  private dragStartPositions = new Map<number, THREE.Vector3>();

  // Raycasting
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private isMouseDown = false;

  constructor(editor: EditorApp) {
    this.editor = editor;
  }

  render(): HTMLElement {
    // Cleanup previous
    if (this.animId) cancelAnimationFrame(this.animId);
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();

    this.container = document.createElement('div');
    this.container.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;background:#1a1a1a;';

    // ─── Toolbar Row 1: Mode + Tool ───
    const toolbar1 = document.createElement('div');
    toolbar1.style.cssText = 'display:flex;align-items:center;gap:3px;padding:3px 8px;background:#2a2a2a;border-bottom:1px solid #333;flex-wrap:nowrap;overflow-x:auto;';
    toolbar1.innerHTML = `
      <span class="mr-lbl">Mode:</span>
      <button class="mr-btn mr-mode active" data-mode="object">Object</button>
      <button class="mr-btn mr-mode" data-mode="vertex">Vertex</button>
      <button class="mr-btn mr-mode" data-mode="edge">Edge</button>
      <button class="mr-btn mr-mode" data-mode="face">Face</button>
      <button class="mr-btn mr-mode" data-mode="sculpt">Sculpt</button>
      <button class="mr-btn mr-mode" data-mode="uv">UV</button>
      <button class="mr-btn mr-mode" data-mode="weightpaint">Weight Paint</button>
      <span class="mr-sep"></span>
      <span class="mr-lbl">Tool:</span>
      <button class="mr-btn mr-tool active" data-tool="select" title="Select (Q)">Select</button>
      <button class="mr-btn mr-tool" data-tool="move" title="Move (W)">Move</button>
      <button class="mr-btn mr-tool" data-tool="rotate" title="Rotate (E)">Rotate</button>
      <button class="mr-btn mr-tool" data-tool="scale" title="Scale (R)">Scale</button>
      <button class="mr-btn mr-tool" data-tool="extrude" title="Extrude Region">Extrude</button>
      <button class="mr-btn mr-tool" data-tool="inset" title="Inset Faces">Inset</button>
      <button class="mr-btn mr-tool" data-tool="loopcut" title="Loop Cut">LoopCut</button>
      <button class="mr-btn mr-tool" data-tool="addBone" title="Add Bone">Bone</button>
    `;
    this.container.appendChild(toolbar1);

    // ─── Toolbar Row 2: Actions ───
    const toolbar2 = document.createElement('div');
    toolbar2.style.cssText = 'display:flex;align-items:center;gap:3px;padding:3px 8px;background:#252525;border-bottom:1px solid #333;flex-wrap:nowrap;overflow-x:auto;';
    toolbar2.innerHTML = `
      <span class="mr-lbl">Create:</span>
      <button class="mr-btn mr-create" data-prim="cube">Cube</button>
      <button class="mr-btn mr-create" data-prim="sphere">Sphere</button>
      <button class="mr-btn mr-create" data-prim="cylinder">Cylinder</button>
      <button class="mr-btn mr-create" data-prim="plane">Plane</button>
      <button class="mr-btn mr-create" data-prim="torus">Torus</button>
      <button class="mr-btn mr-create" data-prim="cone">Cone</button>
      <button class="mr-btn mr-create" data-prim="icosphere">Icosphere</button>
      <span class="mr-sep"></span>
      <span class="mr-lbl">Mesh:</span>
      <button class="mr-btn mr-action" data-action="subdivide">Subdivide</button>
      <button class="mr-btn mr-action" data-action="mergeVerts">Merge</button>
      <button class="mr-btn mr-action" data-action="flipNormals">Flip Normals</button>
      <button class="mr-btn mr-action" data-action="recalcNormals">Recalc Normals</button>
      <button class="mr-btn mr-action" data-action="mirror">Mirror X</button>
      <button class="mr-btn mr-action" data-action="triangulate">Triangulate</button>
      <span class="mr-sep"></span>
      <button class="mr-btn mr-action" data-action="loadSelected" style="background:#0063a5;">Load From Scene</button>
      <button class="mr-btn mr-action" data-action="importFile" style="background:#0063a5;">Import File</button>
      <button class="mr-btn mr-action" data-action="applyBack" style="background:#2e7d32;">Apply to Scene</button>
      <button class="mr-btn mr-action" data-action="exportOBJ" style="background:#6a1b9a;">Export OBJ</button>
      <button class="mr-btn mr-action" data-action="exportGLTF" style="background:#4a1b9a;">Export GLTF</button>
      <button class="mr-btn mr-action" data-action="assignTexture">Assign Texture</button>
      <button class="mr-btn mr-action" data-action="toggleWeights">Weights</button>
    `;
    this.container.appendChild(toolbar2);

    // Inject CSS
    this.injectStyles();

    // ─── Main area: sidebar + 3D canvas + UV panel ───
    const main = document.createElement('div');
    main.style.cssText = 'flex:1;display:flex;overflow:hidden;';

    // Left sidebar: info + bones + sculpt + material
    this.sidebarEl = document.createElement('div');
    this.sidebarEl.style.cssText = 'width:180px;min-width:140px;background:#222;border-right:1px solid #333;overflow-y:auto;padding:8px;font-size:10px;color:#aaa;';
    this.sidebarEl.innerHTML = `
      <div class="mr-section-title">MESH INFO</div>
      <div id="mr-info">No model loaded.<br/><br/>Use <b>Create</b> buttons to make a new mesh or <b>Load From Scene</b> to edit an existing object.</div>
      <div class="mr-section-title" style="margin-top:12px;">BONES</div>
      <div id="mr-bones">No bones</div>
      <div class="mr-section-title" style="margin-top:12px;">SCULPT</div>
      <div id="mr-sculpt" style="display:none;">
        <label class="mr-slider-lbl">Brush: <select id="mr-sculpt-brush" style="background:#333;color:#ccc;border:1px solid #444;font-size:10px;">
          <option value="push">Push</option><option value="pull">Pull</option><option value="smooth">Smooth</option><option value="flatten">Flatten</option>
        </select></label>
        <label class="mr-slider-lbl">Radius: <input type="range" id="mr-sculpt-radius" min="0.05" max="3" step="0.05" value="0.5" style="width:80px;"/><span id="mr-sculpt-radius-val">0.50</span></label>
        <label class="mr-slider-lbl">Strength: <input type="range" id="mr-sculpt-strength" min="0.01" max="1" step="0.01" value="0.3" style="width:80px;"/><span id="mr-sculpt-strength-val">0.30</span></label>
      </div>
      <div class="mr-section-title" style="margin-top:12px;">MATERIAL</div>
      <div id="mr-material">
        <button class="mr-btn mr-action" data-action="assignTexture" style="width:100%;margin-top:4px;">Assign Texture</button>
        <div id="mr-tex-preview" style="margin-top:6px;text-align:center;color:#555;">No texture</div>
      </div>
      <div class="mr-section-title" style="margin-top:12px;">WEIGHT PAINT</div>
      <div id="mr-weightpaint" style="display:none;">
        <label class="mr-slider-lbl">Bone: <select id="mr-wp-bone" style="background:#333;color:#ccc;border:1px solid #444;font-size:10px;max-width:90px;"></select></label>
        <label class="mr-slider-lbl">Radius: <input type="range" id="mr-wp-radius" min="0.05" max="3" step="0.05" value="0.4" style="width:70px;"/><span id="mr-wp-radius-val">0.40</span></label>
        <label class="mr-slider-lbl">Strength: <input type="range" id="mr-wp-strength" min="0.01" max="1" step="0.01" value="0.1" style="width:70px;"/><span id="mr-wp-strength-val">0.10</span></label>
        <div style="margin-top:4px;color:#777;font-size:9px;">LMB = paint weight.<br/>Red = full, Blue = zero.</div>
      </div>
      <div class="mr-section-title" style="margin-top:12px;">MORPH TARGETS</div>
      <div id="mr-morphtargets">
        <button class="mr-btn mr-action" data-action="addMorphTarget" style="width:100%;margin-top:4px;">+ Add Shape Key</button>
        <div id="mr-morph-list" style="margin-top:6px;"></div>
      </div>
    `;
    main.appendChild(this.sidebarEl);

    // Center: 3D canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'flex:1;display:block;';
    main.appendChild(this.canvas);

    // Right panel: UV editor (hidden by default)
    this.uvPanelEl = document.createElement('div');
    this.uvPanelEl.style.cssText = 'width:250px;background:#1e1e1e;border-left:1px solid #333;display:none;flex-direction:column;';
    this.uvPanelEl.innerHTML = `<div class="mr-section-title" style="padding:6px 8px;border-bottom:1px solid #333;">UV MAP</div>`;
    this.uvCanvas = document.createElement('canvas');
    this.uvCanvas.width = 240;
    this.uvCanvas.height = 240;
    this.uvCanvas.style.cssText = 'margin:5px auto;display:block;background:#111;border:1px solid #333;';
    this.uvPanelEl.appendChild(this.uvCanvas);
    this.uvCtx = this.uvCanvas.getContext('2d');
    const uvInfo = document.createElement('div');
    uvInfo.style.cssText = 'padding:8px;font-size:10px;color:#888;';
    uvInfo.innerHTML = `<div>Click vertices in 3D to see their UV coords.</div>
      <div style="margin-top:6px;">
        <button class="mr-btn mr-action" data-action="autoUV" style="width:100%;">Auto UV Unwrap (Box)</button>
      </div>
      <div style="margin-top:4px;">
        <button class="mr-btn mr-action" data-action="sphericalUV" style="width:100%;">Spherical UV</button>
      </div>`;
    this.uvPanelEl.appendChild(uvInfo);
    main.appendChild(this.uvPanelEl);

    this.container.appendChild(main);

    // Cache elements
    this.infoEl = this.sidebarEl.querySelector('#mr-info')!;
    this.bonesEl = this.sidebarEl.querySelector('#mr-bones')!;
    this.sculptPanelEl = this.sidebarEl.querySelector('#mr-sculpt')!;
    this.weightPaintPanelEl = this.sidebarEl.querySelector('#mr-weightpaint')!;
    this.morphTargetPanelEl = this.sidebarEl.querySelector('#mr-morphtargets')!;

    // ─── Setup 3D ───
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1a1a1a);
    this.renderer.shadowMap.enabled = true;

    this.camera.position.set(3, 2.5, 3);
    this.camera.lookAt(0, 0, 0);

    this.orbit = new OrbitControls(this.camera, this.canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.1;
    // Middle-button orbits, right-button pans — left-button reserved for editing
    this.orbit.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,    // editing, not orbit
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };

    // Grid + lights
    const grid = new THREE.GridHelper(20, 20, 0x333333, 0x222222);
    this.scene.add(grid);
    const axesHelper = new THREE.AxesHelper(2);
    axesHelper.position.set(0, 0.001, 0);
    this.scene.add(axesHelper);
    this.scene.add(new THREE.AmbientLight(0x606060, 1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(5, 10, 7);
    dir.castShadow = true;
    this.scene.add(dir);
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-5, 3, -5);
    this.scene.add(fillLight);

    // Events
    this.bindAllEvents(toolbar1, toolbar2);

    // Resize observer
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);

    // Animation loop
    const animate = () => {
      this.animId = requestAnimationFrame(animate);
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    };
    animate();

    requestAnimationFrame(() => this.resize());

    return this.container;
  }

  private injectStyles(): void {
    if (document.getElementById('mr-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'mr-panel-styles';
    style.textContent = `
      .mr-lbl { color:#888;font-size:10px;white-space:nowrap; }
      .mr-sep { flex:0 0 1px;height:18px;background:#444;margin:0 4px; }
      .mr-btn { background:#333;border:1px solid #444;color:#aaa;padding:2px 7px;border-radius:3px;cursor:pointer;font-size:10px;white-space:nowrap;transition:background .15s; }
      .mr-btn:hover { background:#3a3a3a;color:#ddd; }
      .mr-btn.active { background:#0078d4;color:#fff;border-color:#005a9e; }
      .mr-section-title { color:#666;font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px; }
      .mr-slider-lbl { display:flex;align-items:center;gap:4px;margin-top:4px;font-size:10px;color:#aaa; }
      .mr-slider-lbl input[type="range"] { height:3px; }
    `;
    document.head.appendChild(style);
  }

  private bindAllEvents(toolbar1: HTMLElement, toolbar2: HTMLElement): void {
    const setActive = (container: HTMLElement, cls: string, el: Element) => {
      container.querySelectorAll(cls).forEach(b => b.classList.remove('active'));
      el.classList.add('active');
    };

    // Mode switch
    toolbar1.querySelectorAll('.mr-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        setActive(toolbar1, '.mr-mode', btn);
        this.editMode = (btn as HTMLElement).dataset.mode as EditMode;
        this.sculptPanelEl.style.display = this.editMode === 'sculpt' ? 'block' : 'none';
        this.uvPanelEl.style.display = this.editMode === 'uv' ? 'flex' : 'none';
        this.weightPaintPanelEl.style.display = this.editMode === 'weightpaint' ? 'block' : 'none';
        if (this.editMode === 'weightpaint') this.refreshWeightPaintBoneList();
        this.updateOverlays();
        if (this.editMode === 'uv') this.drawUV();
      });
    });

    // Tool switch
    toolbar1.querySelectorAll('.mr-tool').forEach(btn => {
      btn.addEventListener('click', () => {
        setActive(toolbar1, '.mr-tool', btn);
        this.toolMode = (btn as HTMLElement).dataset.tool as typeof this.toolMode;
      });
    });

    // Create primitives
    toolbar2.querySelectorAll('.mr-create').forEach(btn => {
      btn.addEventListener('click', () => {
        this.createPrimitive((btn as HTMLElement).dataset.prim!);
      });
    });

    // Actions (from toolbar2, sidebar, uv panel)
    const allActionBtns = [
      ...toolbar2.querySelectorAll('.mr-action'),
      ...this.sidebarEl.querySelectorAll('.mr-action'),
      ...this.uvPanelEl.querySelectorAll('.mr-action'),
    ];
    allActionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action;
        switch (action) {
          case 'loadSelected': this.loadFromScene(); break;
          case 'importFile': this.importFile(); break;
          case 'subdivide': this.subdivideMesh(); break;
          case 'mergeVerts': this.mergeSelectedVertices(); break;
          case 'flipNormals': this.flipNormals(); break;
          case 'recalcNormals': this.recalcNormals(); break;
          case 'mirror': this.mirrorMesh('x'); break;
          case 'triangulate': this.triangulateMesh(); break;
          case 'toggleWeights': this.toggleWeightView(); break;
          case 'applyBack': this.applyToScene(); break;
          case 'exportOBJ': this.exportOBJ(); break;
          case 'exportGLTF': this.exportGLTF(); break;
          case 'assignTexture': this.assignTexture(); break;
          case 'autoUV': this.autoBoxUV(); break;
          case 'sphericalUV': this.sphericalUV(); break;
          case 'addMorphTarget': this.addMorphTarget(); break;
        }
      });
    });

    // Sculpt controls
    const brushSel = this.sidebarEl.querySelector('#mr-sculpt-brush') as HTMLSelectElement | null;
    brushSel?.addEventListener('change', () => { this.sculptBrush = brushSel.value as SculptBrush; });
    const radiusSlider = this.sidebarEl.querySelector('#mr-sculpt-radius') as HTMLInputElement | null;
    radiusSlider?.addEventListener('input', () => {
      this.sculptRadius = parseFloat(radiusSlider.value);
      const valEl = this.sidebarEl.querySelector('#mr-sculpt-radius-val') as HTMLElement | null;
      if (valEl) valEl.textContent = this.sculptRadius.toFixed(2);
    });
    const strengthSlider = this.sidebarEl.querySelector('#mr-sculpt-strength') as HTMLInputElement | null;
    strengthSlider?.addEventListener('input', () => {
      this.sculptStrength = parseFloat(strengthSlider.value);
      const valEl = this.sidebarEl.querySelector('#mr-sculpt-strength-val') as HTMLElement | null;
      if (valEl) valEl.textContent = this.sculptStrength.toFixed(2);
    });

    // Weight paint sidebar controls
    const wpRadiusSlider = this.sidebarEl.querySelector('#mr-wp-radius') as HTMLInputElement | null;
    wpRadiusSlider?.addEventListener('input', () => {
      this.weightPaintBrushRadius = parseFloat(wpRadiusSlider.value);
      const v = this.sidebarEl.querySelector('#mr-wp-radius-val') as HTMLElement | null;
      if (v) v.textContent = this.weightPaintBrushRadius.toFixed(2);
    });
    const wpStrengthSlider = this.sidebarEl.querySelector('#mr-wp-strength') as HTMLInputElement | null;
    wpStrengthSlider?.addEventListener('input', () => {
      this.weightPaintBrushStrength = parseFloat(wpStrengthSlider.value);
      const v = this.sidebarEl.querySelector('#mr-wp-strength-val') as HTMLElement | null;
      if (v) v.textContent = this.weightPaintBrushStrength.toFixed(2);
    });
    const wpBoneSel = this.sidebarEl.querySelector('#mr-wp-bone') as HTMLSelectElement | null;
    wpBoneSel?.addEventListener('change', () => {
      this.weightPaintActiveBoneIndex = parseInt(wpBoneSel.value);
    });

    // Canvas mouse events
    // Left button (0) = edit/sculpt, Middle (1) = orbit, Right (2) = pan
    // Hold Alt + left-button = orbit (skips edit action)
    this.canvas.addEventListener('mousedown', (e) => {
      this.isMouseDown = true;
      this.updateMouse(e);
      // Only perform edit operations on left-button without Alt (Alt = orbit override)
      if (e.button !== 0 || e.altKey) return;
      if (this.editMode === 'weightpaint') {
        this.orbit.enabled = false;
        this.isWeightPainting = true;
        this.applyWeightPaint();
      }
      else if (this.editMode === 'sculpt') {
        // Temporarily disable orbit so drag doesn't rotate view
        this.orbit.enabled = false;
        this.isSculpting = true;
        this.applySculpt();
      }
      else if (this.toolMode === 'addBone') this.addBoneAtClick();
      else if (this.toolMode === 'extrude') this.extrudeSelectedFaces();
      else if (this.toolMode === 'inset') this.insetSelectedFaces();
      else if (this.toolMode === 'loopcut') this.loopCutAtClick();
      else if (this.toolMode === 'move' && this.hasSelection()) {
        this.startDrag();
      }
      else if (this.editMode === 'vertex') this.selectVertexAtClick(e.shiftKey);
      else if (this.editMode === 'edge') this.selectEdgeAtClick(e.shiftKey);
      else if (this.editMode === 'face') this.selectFaceAtClick(e.shiftKey);
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.isMouseDown) return;
      this.updateMouse(e);
      if (this.isWeightPainting) this.applyWeightPaint();
      else if (this.isSculpting) this.applySculpt();
      else if (this.isDragging) this.updateDrag();
    });
    this.canvas.addEventListener('mouseup', () => {
      this.isMouseDown = false;
      if (this.isWeightPainting) {
        this.isWeightPainting = false;
        this.orbit.enabled = true;
      }
      if (this.isSculpting) {
        this.isSculpting = false;
        this.orbit.enabled = true; // Re-enable orbit after sculpt drag
      }
      if (this.isDragging) {
        this.isDragging = false;
        this.orbit.enabled = true;
        this.dragStartPositions.clear();
      }
    });

    // Keyboard shortcuts
    this.canvas.tabIndex = 0;
    this.canvas.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (key === 'q') { this.toolMode = 'select'; setActive(toolbar1, '.mr-tool', toolbar1.querySelector('[data-tool="select"]')!); }
      if (key === 'w') { this.toolMode = 'move'; setActive(toolbar1, '.mr-tool', toolbar1.querySelector('[data-tool="move"]')!); }
      if (key === 'e') { this.toolMode = 'rotate'; setActive(toolbar1, '.mr-tool', toolbar1.querySelector('[data-tool="rotate"]')!); }
      if (key === 'r') { this.toolMode = 'scale'; setActive(toolbar1, '.mr-tool', toolbar1.querySelector('[data-tool="scale"]')!); }
      if (e.key === 'Delete') this.deleteSelected();
      if (key === 'a' && e.ctrlKey) { e.preventDefault(); this.selectAll(); }
    });
  }

  private updateMouse(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
  }

  // ══════════════════════════════════════════════════════— 
  // CREATE PRIMITIVES
  // ══════════════════════════════════════════════════════— 

  private createPrimitive(type: string): void {
    let geometry: THREE.BufferGeometry;
    switch (type) {
      case 'cube': geometry = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2); break;
      case 'sphere': geometry = new THREE.SphereGeometry(0.5, 24, 24); break;
      case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1); break;
      case 'plane': geometry = new THREE.PlaneGeometry(2, 2, 4, 4); break;
      case 'torus': geometry = new THREE.TorusGeometry(0.5, 0.2, 16, 32); break;
      case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 24); break;
      case 'icosphere': geometry = new THREE.IcosahedronGeometry(0.5, 2); break;
      default: geometry = new THREE.BoxGeometry(1, 1, 1); break;
    }
    if (!geometry.index) {
      const posAttr = geometry.getAttribute('position');
      const indices: number[] = [];
      for (let i = 0; i < posAttr.count; i++) indices.push(i);
      geometry.setIndex(indices);
    }
    const material = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = type.charAt(0).toUpperCase() + type.slice(1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (type === 'plane') mesh.rotation.x = -Math.PI / 2;
    this.clearModel();
    this.model = mesh;
    this.activeMesh = mesh;
    this.scene.add(mesh);
    this.focusModel();
    this.updateInfo();
    this.updateOverlays();
  }

  private focusModel(): void {
    if (!this.model) return;
    const box = new THREE.Box3().setFromObject(this.model);
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
    this.orbit.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(size * 1.2, size * 0.9, size * 1.2));
  }

  // ══════════════════════════════════════════════════════— 
  // LOAD / IMPORT / EXPORT
  // ══════════════════════════════════════════════════════— 

  private loadFromScene(): void {
    const obj = this.editor.state.selectedObject;
    if (!obj) { alert('Select an object in the scene first.'); return; }
    this.clearModel();
    this.model = obj.clone(true);
    this.model.position.set(0, 0, 0);
    this.model.rotation.set(0, 0, 0);
    this.scene.add(this.model);
    this.activeMesh = this.findFirstMesh(this.model);
    this.collectBones();
    this.focusModel();
    this.updateInfo();
    this.updateOverlays();
    this.updateBoneList();
  }

  private importFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf,.obj,.fbx';
    input.onchange = async () => {
      if (!input.files?.length) return;
      const file = input.files[0];
      const url = URL.createObjectURL(file);
      try {
        const result = await this.editor.engine.assets.loadModel(url);
        this.clearModel();
        this.model = result.scene;
        this.model.position.set(0, 0, 0);
        this.scene.add(this.model);
        this.activeMesh = this.findFirstMesh(this.model);
        this.collectBones();
        this.focusModel();
        this.updateInfo();
        this.updateOverlays();
        this.updateBoneList();
      } catch (err) {
        console.error('[ModelingPanel] Import failed:', err);
        alert('Failed to import file. Check console for details.');
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    input.click();
  }

  private applyToScene(): void {
    if (!this.model) { alert('No model to apply.'); return; }
    const original = this.editor.state.selectedObject;
    if (original) {
      const srcMesh = this.findFirstMesh(this.model);
      const dstMesh = this.findFirstMesh(original);
      if (srcMesh && dstMesh) {
        dstMesh.geometry.dispose();
        dstMesh.geometry = srcMesh.geometry.clone();
        dstMesh.geometry.computeVertexNormals();
        if ((srcMesh.material as THREE.MeshStandardMaterial).map) {
          (dstMesh.material as THREE.MeshStandardMaterial).map = (srcMesh.material as THREE.MeshStandardMaterial).map;
          (dstMesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
        }
      }
    } else {
      const clone = this.model.clone(true);
      clone.name = this.model.name || 'ModelingResult';
      this.editor.scene.add(clone);
      this.editor.select(clone);
    }
    this.editor.hierarchy.refresh();
  }

  private exportOBJ(): void {
    const mesh = this.activeMesh;
    if (!mesh) { alert('No mesh to export.'); return; }
    const pos = mesh.geometry.getAttribute('position');
    const norm = mesh.geometry.getAttribute('normal');
    const uv = mesh.geometry.getAttribute('uv');
    const idx = mesh.geometry.index;
    if (!pos) return;

    let obj = `# BlindFake: Phantom OBJ Export\no ${mesh.name || 'mesh'}\n`;
    for (let i = 0; i < pos.count; i++) obj += `v ${pos.getX(i).toFixed(6)} ${pos.getY(i).toFixed(6)} ${pos.getZ(i).toFixed(6)}\n`;
    if (uv) { for (let i = 0; i < uv.count; i++) obj += `vt ${uv.getX(i).toFixed(6)} ${uv.getY(i).toFixed(6)}\n`; }
    if (norm) { for (let i = 0; i < norm.count; i++) obj += `vn ${norm.getX(i).toFixed(6)} ${norm.getY(i).toFixed(6)} ${norm.getZ(i).toFixed(6)}\n`; }
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    for (let i = 0; i < triCount; i++) {
      const a = idx ? idx.getX(i * 3) + 1 : i * 3 + 1;
      const b = idx ? idx.getX(i * 3 + 1) + 1 : i * 3 + 2;
      const c = idx ? idx.getX(i * 3 + 2) + 1 : i * 3 + 3;
      if (uv && norm) obj += `f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}\n`;
      else obj += `f ${a} ${b} ${c}\n`;
    }
    const blob = new Blob([obj], { type: 'text/plain' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = (mesh.name || 'model') + '.obj';
    link.click();
    URL.revokeObjectURL(blobUrl);
  }

  // ══════════════════════════════════════════════════════— 
  // TEXTURE ASSIGNMENT
  // ══════════════════════════════════════════════════════— 

  private assignTexture(): void {
    const mesh = this.activeMesh;
    if (!mesh) { alert('No mesh. Create or load one first.'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      if (!input.files?.length) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          (mesh.material as THREE.MeshStandardMaterial).map = tex;
          (mesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
          const preview = this.sidebarEl.querySelector('#mr-tex-preview');
          if (preview) preview.innerHTML = `<img src="${reader.result as string}" style="max-width:100%;max-height:60px;border:1px solid #444;"/>`;
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(input.files[0]);
    };
    input.click();
  }

  // ══════════════════════════════════════════════════════— 
  // MESH OPERATIONS
  // ══════════════════════════════════════════════════════— 

  private subdivideMesh(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute('position');
    const index = geo.index;
    if (!posAttr || !index) return;

    const allPos: number[] = [];
    for (let i = 0; i < posAttr.count; i++) allPos.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));

    const midCache = new Map<string, number>();
    const newIndices: number[] = [];

    const getMid = (a: number, b: number): number => {
      const key = Math.min(a, b) + '_' + Math.max(a, b);
      if (midCache.has(key)) return midCache.get(key)!;
      const idx = allPos.length / 3;
      allPos.push(
        (allPos[a * 3] + allPos[b * 3]) / 2,
        (allPos[a * 3 + 1] + allPos[b * 3 + 1]) / 2,
        (allPos[a * 3 + 2] + allPos[b * 3 + 2]) / 2,
      );
      midCache.set(key, idx);
      return idx;
    };

    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      const ab = getMid(a, b), bc = getMid(b, c), ca = getMid(c, a);
      newIndices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }

    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3));
    newGeo.setIndex(newIndices);
    newGeo.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = newGeo;
    this.selectedVerts.clear();
    this.selectedFaces.clear();
    this.updateOverlays();
    this.updateInfo();
  }

  private mergeSelectedVertices(): void {
    if (this.selectedVerts.size < 2) return;
    const mesh = this.activeMesh;
    if (!mesh) return;
    const posAttr = mesh.geometry.getAttribute('position');
    if (!posAttr) return;

    const center = new THREE.Vector3();
    for (const idx of this.selectedVerts) {
      center.x += posAttr.getX(idx);
      center.y += posAttr.getY(idx);
      center.z += posAttr.getZ(idx);
    }
    center.divideScalar(this.selectedVerts.size);
    for (const idx of this.selectedVerts) posAttr.setXYZ(idx, center.x, center.y, center.z);
    posAttr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    this.updateOverlays();
    this.updateInfo();
  }

  private flipNormals(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const idx = mesh.geometry.index;
    if (!idx) return;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), c = idx.getX(i + 2);
      idx.setX(i, c);
      idx.setX(i + 2, a);
    }
    idx.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    this.updateOverlays();
  }

  private recalcNormals(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    mesh.geometry.computeVertexNormals();
    const norm = mesh.geometry.getAttribute('normal');
    if (norm) norm.needsUpdate = true;
  }

  private mirrorMesh(axis: 'x' | 'y' | 'z'): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const posAttr = mesh.geometry.getAttribute('position');
    const idxAttr = mesh.geometry.index;
    if (!posAttr || !idxAttr) return;

    const origCount = posAttr.count;
    const origIdxCount = idxAttr.count;
    const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

    const newPos: number[] = [];
    for (let i = 0; i < posAttr.count; i++) newPos.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    for (let i = 0; i < origCount; i++) {
      const vals = [posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)];
      vals[ai] = -vals[ai];
      newPos.push(vals[0], vals[1], vals[2]);
    }

    const newIdx: number[] = [];
    for (let i = 0; i < idxAttr.count; i++) newIdx.push(idxAttr.getX(i));
    for (let i = 0; i < origIdxCount; i += 3) {
      newIdx.push(idxAttr.getX(i) + origCount, idxAttr.getX(i + 2) + origCount, idxAttr.getX(i + 1) + origCount);
    }

    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
    newGeo.setIndex(newIdx);
    newGeo.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = newGeo;
    this.selectedVerts.clear();
    this.updateOverlays();
    this.updateInfo();
  }

  private triangulateMesh(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    if (!mesh.geometry.index) {
      const posAttr = mesh.geometry.getAttribute('position');
      const indices: number[] = [];
      for (let i = 0; i < posAttr.count; i++) indices.push(i);
      mesh.geometry.setIndex(indices);
    }
    this.updateInfo();
  }

  private deleteSelected(): void {
    if (this.editMode === 'face' && this.selectedFaces.size > 0) {
      const mesh = this.activeMesh;
      if (!mesh) return;
      const idx = mesh.geometry.index;
      if (!idx) return;
      const newIndices: number[] = [];
      for (let i = 0; i < idx.count; i += 3) {
        if (!this.selectedFaces.has(Math.floor(i / 3))) {
          newIndices.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
        }
      }
      mesh.geometry.setIndex(newIndices);
      mesh.geometry.computeVertexNormals();
      this.selectedFaces.clear();
      this.updateOverlays();
      this.updateInfo();
    }
  }

  private selectAll(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    if (this.editMode === 'vertex') {
      const posAttr = mesh.geometry.getAttribute('position');
      if (!posAttr) return;
      this.selectedVerts.clear();
      for (let i = 0; i < posAttr.count; i++) this.selectedVerts.add(i);
      this.updateOverlays();
    } else if (this.editMode === 'face') {
      const idx = mesh.geometry.index;
      if (!idx) return;
      this.selectedFaces.clear();
      for (let i = 0; i < idx.count / 3; i++) this.selectedFaces.add(i);
      this.updateOverlays();
    }
  }

  // ══════════════════════════════════════════════════════— 
  // UV EDITING
  // ══════════════════════════════════════════════════════— 

  private autoBoxUV(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    const norm = mesh.geometry.getAttribute('normal');
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      let nx = 0, ny = 1, nz = 0;
      if (norm) { nx = Math.abs(norm.getX(i)); ny = Math.abs(norm.getY(i)); nz = Math.abs(norm.getZ(i)); }
      if (nx >= ny && nx >= nz) {
        uvs[i * 2] = (pos.getZ(i) - box.min.z) / maxDim;
        uvs[i * 2 + 1] = (pos.getY(i) - box.min.y) / maxDim;
      } else if (ny >= nx && ny >= nz) {
        uvs[i * 2] = (pos.getX(i) - box.min.x) / maxDim;
        uvs[i * 2 + 1] = (pos.getZ(i) - box.min.z) / maxDim;
      } else {
        uvs[i * 2] = (pos.getX(i) - box.min.x) / maxDim;
        uvs[i * 2 + 1] = (pos.getY(i) - box.min.y) / maxDim;
      }
    }
    mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    mesh.geometry.attributes.uv.needsUpdate = true;
    (mesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
    this.drawUV();
  }

  private sphericalUV(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - center.x, dy = pos.getY(i) - center.y, dz = pos.getZ(i) - center.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      uvs[i * 2] = 0.5 + Math.atan2(dz, dx) / (2 * Math.PI);
      uvs[i * 2 + 1] = Math.acos(Math.max(-1, Math.min(1, dy / len))) / Math.PI;
    }
    mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    mesh.geometry.attributes.uv.needsUpdate = true;
    (mesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
    this.drawUV();
  }

  private drawUV(): void {
    const ctx = this.uvCtx;
    if (!ctx || !this.uvCanvas) return;
    const W = this.uvCanvas.width, H = this.uvCanvas.height;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
    // Grid
    ctx.strokeStyle = '#333'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const p = i / 4;
      ctx.beginPath(); ctx.moveTo(p * W, 0); ctx.lineTo(p * W, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p * H); ctx.lineTo(W, p * H); ctx.stroke();
    }
    const mesh = this.activeMesh;
    if (!mesh) return;
    const uv = mesh.geometry.getAttribute('uv');
    const idx = mesh.geometry.index;
    if (!uv) { ctx.fillStyle = '#666'; ctx.font = '11px sans-serif'; ctx.fillText('No UVs. Use Auto UV.', 40, H / 2); return; }
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 1;
    const count = idx ? idx.count : uv.count;
    for (let i = 0; i < count; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      ctx.beginPath();
      ctx.moveTo(uv.getX(a) * W, (1 - uv.getY(a)) * H);
      ctx.lineTo(uv.getX(b) * W, (1 - uv.getY(b)) * H);
      ctx.lineTo(uv.getX(c) * W, (1 - uv.getY(c)) * H);
      ctx.closePath(); ctx.stroke();
    }
    ctx.fillStyle = '#ff9800';
    for (const vi of this.selectedVerts) {
      if (vi < uv.count) { ctx.beginPath(); ctx.arc(uv.getX(vi) * W, (1 - uv.getY(vi)) * H, 3, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  // ══════════════════════════════════════════════════════— 
  // SCULPTING
  // ══════════════════════════════════════════════════════— 

  private applySculpt(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const posAttr = mesh.geometry.getAttribute('position');
    const normAttr = mesh.geometry.getAttribute('normal');
    if (!posAttr) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(mesh, false);
    if (hits.length === 0) return;
    const hitPoint = hits[0].point;
    const hitFace = hits[0].face;

    const radius2 = this.sculptRadius * this.sculptRadius;
    const wp = new THREE.Vector3();
    let modified = false;

    for (let i = 0; i < posAttr.count; i++) {
      wp.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      mesh.localToWorld(wp);
      const dist2 = wp.distanceToSquared(hitPoint);
      if (dist2 > radius2) continue;

      const falloff = 1 - Math.sqrt(dist2) / this.sculptRadius;
      const strength = this.sculptStrength * falloff * 0.016;
      mesh.worldToLocal(wp);

      let nx = 0, ny = 1, nz = 0;
      if (normAttr) { nx = normAttr.getX(i); ny = normAttr.getY(i); nz = normAttr.getZ(i); }

      switch (this.sculptBrush) {
        case 'push':
          posAttr.setXYZ(i, wp.x + nx * strength, wp.y + ny * strength, wp.z + nz * strength);
          modified = true; break;
        case 'pull':
          posAttr.setXYZ(i, wp.x - nx * strength, wp.y - ny * strength, wp.z - nz * strength);
          modified = true; break;
        case 'smooth': {
          const local = new THREE.Vector3(); mesh.worldToLocal(local.copy(hitPoint));
          const amt = strength * 0.5;
          posAttr.setXYZ(i, wp.x + (local.x - wp.x) * amt, wp.y + (local.y - wp.y) * amt, wp.z + (local.z - wp.z) * amt);
          modified = true; break;
        }
        case 'flatten': {
          const local = new THREE.Vector3(); mesh.worldToLocal(local.copy(hitPoint));
          const hn = hitFace ? hitFace.normal.clone() : new THREE.Vector3(0, 1, 0);
          const dot = (wp.x - local.x) * hn.x + (wp.y - local.y) * hn.y + (wp.z - local.z) * hn.z;
          posAttr.setXYZ(i, wp.x - hn.x * dot * strength * 2, wp.y - hn.y * dot * strength * 2, wp.z - hn.z * dot * strength * 2);
          modified = true; break;
        }
      }
    }

    if (modified) {
      // Sanitize: replace any NaN vertex positions with 0
      for (let vi = 0; vi < posAttr.count; vi++) {
        if (!isFinite(posAttr.getX(vi))) posAttr.setX(vi, 0);
        if (!isFinite(posAttr.getY(vi))) posAttr.setY(vi, 0);
        if (!isFinite(posAttr.getZ(vi))) posAttr.setZ(vi, 0);
      }
      posAttr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
      if (this.wireframeOverlay) {
        const wireGeo = new THREE.WireframeGeometry(mesh.geometry);
        this.wireframeOverlay.geometry.dispose();
        this.wireframeOverlay.geometry = wireGeo;
      }
    }
  }

  // ══════════════════════════════════════════════════════— 
  // SELECTION
  // ══════════════════════════════════════════════════════— 

  private selectVertexAtClick(additive: boolean): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const posAttr = mesh.geometry.getAttribute('position');
    if (!posAttr) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    let bestDist = 0.12, bestIdx = -1;
    const wp = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      wp.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      mesh.localToWorld(wp);
      const projected = wp.clone().project(this.camera);
      const dist = Math.sqrt((projected.x - this.mouse.x) ** 2 + (projected.y - this.mouse.y) ** 2);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }

    if (!additive) this.selectedVerts.clear();
    if (bestIdx >= 0) {
      if (this.selectedVerts.has(bestIdx)) this.selectedVerts.delete(bestIdx);
      else this.selectedVerts.add(bestIdx);
    }
    this.updateOverlays();
    if (this.editMode === 'uv') this.drawUV();
  }

  private selectFaceAtClick(additive: boolean): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(mesh, false);
    if (hits.length === 0) { if (!additive) this.selectedFaces.clear(); this.updateOverlays(); return; }
    const faceIdx = hits[0].faceIndex;
    if (faceIdx === undefined || faceIdx === null) return;
    if (!additive) this.selectedFaces.clear();
    if (this.selectedFaces.has(faceIdx)) this.selectedFaces.delete(faceIdx);
    else this.selectedFaces.add(faceIdx);
    this.updateOverlays();
  }

  private selectEdgeAtClick(additive: boolean): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const idx = mesh.geometry.index;
    const posAttr = mesh.geometry.getAttribute('position');
    if (!posAttr || !idx) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    let bestDist = 0.15;
    let bestEdge = '';
    const a = new THREE.Vector3(), b = new THREE.Vector3();

    for (let i = 0; i < idx.count; i += 3) {
      const triVerts = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
      for (let j = 0; j < 3; j++) {
        const i0 = triVerts[j], i1 = triVerts[(j + 1) % 3];
        const key = Math.min(i0, i1) + '_' + Math.max(i0, i1);
        a.set(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0));
        b.set(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1));
        mesh.localToWorld(a); mesh.localToWorld(b);
        const pa = a.clone().project(this.camera);
        const pb = b.clone().project(this.camera);
        // Distance from mouse to 2D line segment
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const lenSq = dx * dx + dy * dy;
        let t = lenSq > 0 ? ((this.mouse.x - pa.x) * dx + (this.mouse.y - pa.y) * dy) / lenSq : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = pa.x + t * dx - this.mouse.x;
        const cy = pa.y + t * dy - this.mouse.y;
        const dist = Math.sqrt(cx * cx + cy * cy);
        if (dist < bestDist) { bestDist = dist; bestEdge = key; }
      }
    }

    if (!additive) this.selectedEdges.clear();
    if (bestEdge) {
      if (this.selectedEdges.has(bestEdge)) this.selectedEdges.delete(bestEdge);
      else this.selectedEdges.add(bestEdge);
    }
    this.updateOverlays();
  }

  // ══════════════════════════════════════════════════════— 
  // DRAG (MOVE TOOL)
  // ══════════════════════════════════════════════════════— 

  private hasSelection(): boolean {
    if (this.editMode === 'vertex') return this.selectedVerts.size > 0;
    if (this.editMode === 'edge') return this.selectedEdges.size > 0;
    if (this.editMode === 'face') return this.selectedFaces.size > 0;
    return false;
  }

  /** Collect all vertex indices affected by the current selection (verts/edges/faces). */
  private getSelectedVertexIndices(): Set<number> {
    const verts = new Set<number>();
    const mesh = this.activeMesh;
    if (!mesh) return verts;
    if (this.editMode === 'vertex') {
      for (const v of this.selectedVerts) verts.add(v);
    } else if (this.editMode === 'edge') {
      for (const key of this.selectedEdges) {
        const [a, b] = key.split('_').map(Number);
        verts.add(a); verts.add(b);
      }
    } else if (this.editMode === 'face') {
      const idx = mesh.geometry.index;
      if (idx) {
        for (const fi of this.selectedFaces) {
          const base = fi * 3;
          if (base + 2 < idx.count) { verts.add(idx.getX(base)); verts.add(idx.getX(base + 1)); verts.add(idx.getX(base + 2)); }
        }
      }
    }
    return verts;
  }

  private startDrag(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const posAttr = mesh.geometry.getAttribute('position');
    if (!posAttr) return;

    const indices = this.getSelectedVertexIndices();
    if (indices.size === 0) return;

    // Compute centroid of selected verts (world space)
    const centroid = new THREE.Vector3();
    const wp = new THREE.Vector3();
    for (const i of indices) {
      wp.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      mesh.localToWorld(wp);
      centroid.add(wp);
    }
    centroid.divideScalar(indices.size);

    // Build a drag plane facing the camera through the centroid
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    this.dragPlane.setFromNormalAndCoplanarPoint(camDir, centroid);

    // Find initial intersection point
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, hit)) return;
    this.dragOrigin.copy(hit);

    // Store start positions (local space)
    this.dragStartPositions.clear();
    for (const i of indices) {
      this.dragStartPositions.set(i, new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)));
    }

    this.isDragging = true;
    this.orbit.enabled = false;
  }

  private updateDrag(): void {
    const mesh = this.activeMesh;
    if (!mesh || this.dragStartPositions.size === 0) return;
    const posAttr = mesh.geometry.getAttribute('position');
    if (!posAttr) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, hit)) return;

    // World-space delta
    const delta = hit.clone().sub(this.dragOrigin);
    // Convert delta to local space
    const invMat = mesh.matrixWorld.clone().invert();
    const localDelta = delta.clone().transformDirection(invMat);

    for (const [i, startPos] of this.dragStartPositions) {
      posAttr.setXYZ(i, startPos.x + localDelta.x, startPos.y + localDelta.y, startPos.z + localDelta.z);
    }
    posAttr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    this.updateOverlays();
  }

  // ══════════════════════════════════════════════════════— 
  // EXTRUDE / INSET / LOOP CUT
  // ══════════════════════════════════════════════════════— 

  private extrudeSelectedFaces(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const idx = mesh.geometry.index;
    const posAttr = mesh.geometry.getAttribute('position');
    if (!idx || !posAttr || this.selectedFaces.size === 0) return;

    // Collect unique vertex indices from selected faces
    const selVerts = new Set<number>();
    for (const fi of this.selectedFaces) {
      const base = fi * 3;
      if (base + 2 >= idx.count) continue;
      selVerts.add(idx.getX(base)); selVerts.add(idx.getX(base + 1)); selVerts.add(idx.getX(base + 2));
    }

    // Compute average normal of selected faces
    const avgNormal = new THREE.Vector3();
    const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
    for (const fi of this.selectedFaces) {
      const base = fi * 3;
      const a = idx.getX(base), b = idx.getX(base + 1), c = idx.getX(base + 2);
      v0.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
      v1.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
      v2.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
      e1.subVectors(v1, v0); e2.subVectors(v2, v0);
      fn.crossVectors(e1, e2).normalize();
      avgNormal.add(fn);
    }
    avgNormal.normalize();
    const extrudeAmount = 0.3;

    // Duplicate vertices: map old index -> new index
    const allPos: number[] = [];
    for (let i = 0; i < posAttr.count; i++) allPos.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    const oldToNew = new Map<number, number>();
    for (const vi of selVerts) {
      const ni = allPos.length / 3;
      allPos.push(
        posAttr.getX(vi) + avgNormal.x * extrudeAmount,
        posAttr.getY(vi) + avgNormal.y * extrudeAmount,
        posAttr.getZ(vi) + avgNormal.z * extrudeAmount,
      );
      oldToNew.set(vi, ni);
    }

    // Rebuild indices: selected faces now point to new (extruded) vertices
    const newIndices: number[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      const fi = i / 3;
      if (this.selectedFaces.has(fi)) {
        newIndices.push(oldToNew.get(a)!, oldToNew.get(b)!, oldToNew.get(c)!);
      } else {
        newIndices.push(a, b, c);
      }
    }

    // Create side faces connecting old -> new vertices along border edges
    const edgeCount = new Map<string, number[]>();
    for (const fi of this.selectedFaces) {
      const base = fi * 3;
      const verts = [idx.getX(base), idx.getX(base + 1), idx.getX(base + 2)];
      for (let j = 0; j < 3; j++) {
        const ea = verts[j], eb = verts[(j + 1) % 3];
        const key = Math.min(ea, eb) + '_' + Math.max(ea, eb);
        edgeCount.set(key, (edgeCount.get(key) || []).concat(fi));
      }
    }
    for (const [key, faces] of edgeCount) {
      if (faces.length === 1) {
        // Border edge — create side quad (2 triangles)
        const [sa, sb] = key.split('_').map(Number);
        const na = oldToNew.get(sa)!, nb = oldToNew.get(sb)!;
        newIndices.push(sa, sb, nb, sa, nb, na);
      }
    }

    // Apply new geometry
    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3));
    newGeo.setIndex(newIndices);
    newGeo.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = newGeo;

    // Update selection to new extruded faces
    this.selectedFaces.clear();
    this.selectedVerts.clear();
    for (const ni of oldToNew.values()) this.selectedVerts.add(ni);
    this.editMode = 'vertex';
    this.toolMode = 'move';
    this.updateOverlays();
    this.updateInfo();
  }

  private insetSelectedFaces(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const idx = mesh.geometry.index;
    const posAttr = mesh.geometry.getAttribute('position');
    if (!idx || !posAttr || this.selectedFaces.size === 0) return;

    const insetAmount = 0.15;
    const allPos: number[] = [];
    for (let i = 0; i < posAttr.count; i++) allPos.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    const newIndices: number[] = [];
    const newSelectedFaces = new Set<number>();

    for (let i = 0; i < idx.count; i += 3) {
      const fi = i / 3;
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);

      if (!this.selectedFaces.has(fi)) {
        newIndices.push(a, b, c);
        continue;
      }

      // Compute centroid
      const cx = (posAttr.getX(a) + posAttr.getX(b) + posAttr.getX(c)) / 3;
      const cy = (posAttr.getY(a) + posAttr.getY(b) + posAttr.getY(c)) / 3;
      const cz = (posAttr.getZ(a) + posAttr.getZ(b) + posAttr.getZ(c)) / 3;

      // Create 3 new (inset) vertices
      const makeInset = (vi: number): number => {
        const ni = allPos.length / 3;
        const ox = posAttr.getX(vi), oy = posAttr.getY(vi), oz = posAttr.getZ(vi);
        allPos.push(ox + (cx - ox) * insetAmount, oy + (cy - oy) * insetAmount, oz + (cz - oz) * insetAmount);
        return ni;
      };
      const ia = makeInset(a), ib = makeInset(b), ic = makeInset(c);

      // Inner face
      const innerFi = newIndices.length / 3;
      newIndices.push(ia, ib, ic);
      newSelectedFaces.add(innerFi);

      // 3 border quads (2 tris each)
      newIndices.push(a, b, ib, a, ib, ia);
      newIndices.push(b, c, ic, b, ic, ib);
      newIndices.push(c, a, ia, c, ia, ic);
    }

    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3));
    newGeo.setIndex(newIndices);
    newGeo.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = newGeo;
    this.selectedFaces = newSelectedFaces;
    this.updateOverlays();
    this.updateInfo();
  }

  private loopCutAtClick(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const idx = mesh.geometry.index;
    const posAttr = mesh.geometry.getAttribute('position');
    if (!idx || !posAttr) return;

    // Raycast to find clicked face
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(mesh, false);
    if (hits.length === 0) return;
    const faceIdx = hits[0].faceIndex;
    if (faceIdx === undefined || faceIdx === null) return;

    // Find the longest edge of the hit face (we'll cut perpendicular)
    const base = faceIdx * 3;
    const triVerts = [idx.getX(base), idx.getX(base + 1), idx.getX(base + 2)];
    let maxLen = -1, cutEdgeA = 0, cutEdgeB = 0;
    for (let j = 0; j < 3; j++) {
      const ea = triVerts[j], eb = triVerts[(j + 1) % 3];
      const dx = posAttr.getX(ea) - posAttr.getX(eb);
      const dy = posAttr.getY(ea) - posAttr.getY(eb);
      const dz = posAttr.getZ(ea) - posAttr.getZ(eb);
      const len = dx * dx + dy * dy + dz * dz;
      if (len > maxLen) { maxLen = len; cutEdgeA = ea; cutEdgeB = eb; }
    }

    // Simple approach: subdivide every triangle that shares this edge pair by adding midpoints
    // Build edge -> face adjacency
    const edgeFaces = new Map<string, number[]>();
    for (let i = 0; i < idx.count; i += 3) {
      const fi = i / 3;
      const tv = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
      for (let j = 0; j < 3; j++) {
        const ea = tv[j], eb = tv[(j + 1) % 3];
        const key = Math.min(ea, eb) + '_' + Math.max(ea, eb);
        const list = edgeFaces.get(key);
        if (list) list.push(fi);
        else edgeFaces.set(key, [fi]);
      }
    }

    // Walk loop: follow the edge ring perpendicular to the cut edge
    const cutKey = Math.min(cutEdgeA, cutEdgeB) + '_' + Math.max(cutEdgeA, cutEdgeB);
    const loopEdges = new Set<string>();
    loopEdges.add(cutKey);

    // BFS along faces sharing the perpendicular edge
    const visited = new Set<number>();
    const queue: string[] = [cutKey];
    while (queue.length > 0) {
      const edgeKey = queue.shift()!;
      const faces = edgeFaces.get(edgeKey) || [];
      for (const fi of faces) {
        if (visited.has(fi)) continue;
        visited.add(fi);
        const b2 = fi * 3;
        const tv = [idx.getX(b2), idx.getX(b2 + 1), idx.getX(b2 + 2)];
        // Find the opposite edge(s) in this triangle
        for (let j = 0; j < 3; j++) {
          const ea = tv[j], eb = tv[(j + 1) % 3];
          const k = Math.min(ea, eb) + '_' + Math.max(ea, eb);
          if (k !== edgeKey && !loopEdges.has(k)) {
            // Check if this edge shares a vertex with the current edge
            const [ka, kb] = edgeKey.split('_').map(Number);
            if (ea !== ka && ea !== kb && eb !== ka && eb !== kb) {
              loopEdges.add(k);
              queue.push(k);
            }
          }
        }
      }
    }

    if (loopEdges.size === 0) return;

    // Now subdivide: for each edge in loopEdges, add a midpoint vertex and split affected faces
    const allPos: number[] = [];
    for (let i = 0; i < posAttr.count; i++) allPos.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    const midpointMap = new Map<string, number>();
    for (const ek of loopEdges) {
      const [ea, eb] = ek.split('_').map(Number);
      const ni = allPos.length / 3;
      allPos.push(
        (posAttr.getX(ea) + posAttr.getX(eb)) / 2,
        (posAttr.getY(ea) + posAttr.getY(eb)) / 2,
        (posAttr.getZ(ea) + posAttr.getZ(eb)) / 2,
      );
      midpointMap.set(ek, ni);
    }

    const newIndices: number[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      const tv = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
      // Check which edges of this triangle are in the loop
      const splits: { edgeIdx: number; midVert: number }[] = [];
      for (let j = 0; j < 3; j++) {
        const ea = tv[j], eb = tv[(j + 1) % 3];
        const k = Math.min(ea, eb) + '_' + Math.max(ea, eb);
        if (midpointMap.has(k)) splits.push({ edgeIdx: j, midVert: midpointMap.get(k)! });
      }

      if (splits.length === 0) {
        newIndices.push(tv[0], tv[1], tv[2]);
      } else if (splits.length === 1) {
        // Split triangle into 2 with the midpoint
        const s = splits[0];
        const a = tv[s.edgeIdx], b = tv[(s.edgeIdx + 1) % 3], c = tv[(s.edgeIdx + 2) % 3];
        const m = s.midVert;
        newIndices.push(a, m, c, m, b, c);
      } else if (splits.length === 2) {
        // Split into 3 triangles
        const s0 = splits[0], s1 = splits[1];
        const a = tv[s0.edgeIdx], b = tv[(s0.edgeIdx + 1) % 3], c = tv[(s0.edgeIdx + 2) % 3];
        const m0 = s0.midVert, m1 = s1.midVert;
        newIndices.push(a, m0, m1, m0, b, m1, m1, b, c);
      } else {
        // All 3 edges split -> 4 triangles
        const m0 = splits[0].midVert, m1 = splits[1].midVert, m2 = splits[2].midVert;
        newIndices.push(tv[0], m0, m2, m0, tv[1], m1, m2, m1, tv[2], m0, m1, m2);
      }
    }

    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3));
    newGeo.setIndex(newIndices);
    newGeo.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = newGeo;
    this.selectedVerts.clear();
    this.selectedFaces.clear();
    this.selectedEdges.clear();
    this.updateOverlays();
    this.updateInfo();
  }

  private collectBones(): void {
    this.bones = [];
    if (!this.model) return;
    this.model.traverse(child => { if (child instanceof THREE.Bone) this.bones.push(child); });
    const skinned = this.findSkinnedMesh(this.model);
    if (this.skeletonHelper) this.scene.remove(this.skeletonHelper);
    if (skinned) { this.skeletonHelper = new THREE.SkeletonHelper(skinned); this.scene.add(this.skeletonHelper); }
  }

  private addBoneAtClick(): void {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, pt)) return;

    const bone = new THREE.Bone();
    bone.name = `Bone_${this.bones.length}`;
    bone.position.copy(pt);
    if (this.bones.length > 0) {
      const parent = this.bones[this.bones.length - 1];
      bone.position.copy(pt.clone().sub(parent.getWorldPosition(new THREE.Vector3())));
      parent.add(bone);
    } else if (this.model) {
      this.model.add(bone);
    }
    this.bones.push(bone);
    if (this.skeletonHelper) this.scene.remove(this.skeletonHelper);
    if (this.model) { this.skeletonHelper = new THREE.SkeletonHelper(this.model); this.scene.add(this.skeletonHelper); }
    this.updateBoneList();
  }

  private toggleWeightView(): void {
    this.showWeights = !this.showWeights;
    const mesh = this.activeMesh;
    if (!mesh) return;
    if (this.showWeights) {
      const skinWeightAttr = mesh.geometry.getAttribute('skinWeight');
      if (!skinWeightAttr) { alert('No skin weights on this mesh.'); this.showWeights = false; return; }
      const colors = new Float32Array(skinWeightAttr.count * 3);
      for (let i = 0; i < skinWeightAttr.count; i++) { const w = skinWeightAttr.getX(i); colors[i * 3] = w; colors[i * 3 + 1] = 0; colors[i * 3 + 2] = 1 - w; }
      mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      (mesh.material as THREE.MeshStandardMaterial).vertexColors = true;
      (mesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
    } else {
      mesh.geometry.deleteAttribute('color');
      (mesh.material as THREE.MeshStandardMaterial).vertexColors = false;
      (mesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
    }
  }

  // ══════════════════════════════════════════════════════— 
  // OVERLAYS
  // ══════════════════════════════════════════════════════— 

  private updateOverlays(): void {
    if (this.wireframeOverlay) { this.scene.remove(this.wireframeOverlay); this.wireframeOverlay = null; }
    if (this.vertexDots) { this.scene.remove(this.vertexDots); this.vertexDots = null; }
    // Remove face highlight helpers
    const toRemove: THREE.Object3D[] = [];
    this.scene.traverse(obj => { if (obj.userData?.__editorHelper) toRemove.push(obj); });
    toRemove.forEach(obj => this.scene.remove(obj));

    const mesh = this.activeMesh;
    if (!mesh || this.editMode === 'object') return;

    // Wireframe
    if (this.editMode !== 'uv') {
      // Sanitize positions to avoid NaN in WireframeGeometry
      const posA = mesh.geometry.getAttribute('position');
      if (posA) {
        let dirty = false;
        for (let vi = 0; vi < posA.count; vi++) {
          if (!isFinite(posA.getX(vi))) { (posA as THREE.BufferAttribute).setX(vi, 0); dirty = true; }
          if (!isFinite(posA.getY(vi))) { (posA as THREE.BufferAttribute).setY(vi, 0); dirty = true; }
          if (!isFinite(posA.getZ(vi))) { (posA as THREE.BufferAttribute).setZ(vi, 0); dirty = true; }
        }
        if (dirty) { posA.needsUpdate = true; mesh.geometry.computeBoundingSphere(); }
      }
      const wireGeo = new THREE.WireframeGeometry(mesh.geometry);
      this.wireframeOverlay = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x4fc3f7, opacity: 0.35, transparent: true }));
      mesh.getWorldPosition(this.wireframeOverlay.position);
      mesh.getWorldQuaternion(this.wireframeOverlay.quaternion);
      mesh.getWorldScale(this.wireframeOverlay.scale);
      this.scene.add(this.wireframeOverlay);
    }

    // Vertex dots
    if (this.editMode === 'vertex' || this.editMode === 'uv') {
      const posAttr = mesh.geometry.getAttribute('position');
      if (posAttr) {
        const dotGeo = new THREE.BufferGeometry();
        dotGeo.setAttribute('position', posAttr.clone());
        const colors = new Float32Array(posAttr.count * 3);
        for (let i = 0; i < posAttr.count; i++) {
          const sel = this.selectedVerts.has(i);
          colors[i * 3] = sel ? 1 : 0.3; colors[i * 3 + 1] = sel ? 0.6 : 0.76; colors[i * 3 + 2] = sel ? 0 : 0.97;
        }
        dotGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this.vertexDots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, depthTest: false }));
        mesh.getWorldPosition(this.vertexDots.position);
        mesh.getWorldQuaternion(this.vertexDots.quaternion);
        mesh.getWorldScale(this.vertexDots.scale);
        this.scene.add(this.vertexDots);
      }
    }

    // Face highlight
    if (this.editMode === 'face' && this.selectedFaces.size > 0) {
      const idx = mesh.geometry.index;
      const posAttr = mesh.geometry.getAttribute('position');
      if (idx && posAttr) {
        const highlightIndices: number[] = [];
        for (const fi of this.selectedFaces) {
          const base = fi * 3;
          if (base + 2 < idx.count) highlightIndices.push(idx.getX(base), idx.getX(base + 1), idx.getX(base + 2));
        }
        if (highlightIndices.length > 0) {
          const hlGeo = new THREE.BufferGeometry();
          hlGeo.setAttribute('position', posAttr.clone());
          hlGeo.setIndex(highlightIndices);
          const hlMesh = new THREE.Mesh(hlGeo, new THREE.MeshBasicMaterial({ color: 0xff9800, opacity: 0.35, transparent: true, side: THREE.DoubleSide, depthTest: false }));
          mesh.getWorldPosition(hlMesh.position);
          mesh.getWorldQuaternion(hlMesh.quaternion);
          mesh.getWorldScale(hlMesh.scale);
          hlMesh.userData.__editorHelper = true;
          this.scene.add(hlMesh);
        }
      }
    }

    // Edge highlight
    if (this.editMode === 'edge' && this.selectedEdges.size > 0) {
      const posAttr = mesh.geometry.getAttribute('position');
      if (posAttr) {
        const edgePositions: number[] = [];
        for (const key of this.selectedEdges) {
          const [a, b] = key.split('_').map(Number);
          if (a < posAttr.count && b < posAttr.count) {
            edgePositions.push(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
            edgePositions.push(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
          }
        }
        if (edgePositions.length > 0) {
          const edgeGeo = new THREE.BufferGeometry();
          edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
          const edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xff9800, linewidth: 2, depthTest: false }));
          mesh.getWorldPosition(edgeLines.position);
          mesh.getWorldQuaternion(edgeLines.quaternion);
          mesh.getWorldScale(edgeLines.scale);
          edgeLines.userData.__editorHelper = true;
          this.scene.add(edgeLines);
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════— 
  // UI UPDATES
  // ══════════════════════════════════════════════════════— 

  private updateInfo(): void {
    if (!this.infoEl) return;
    if (!this.activeMesh) {
      this.infoEl.innerHTML = 'No model loaded.<br/><br/>Use <b>Create</b> buttons to make a new mesh or <b>Load From Scene</b> to edit an existing object.';
      return;
    }
    const geo = this.activeMesh.geometry;
    const verts = geo.getAttribute('position')?.count ?? 0;
    const faces = geo.index ? geo.index.count / 3 : verts / 3;
    const hasUV = !!geo.getAttribute('uv');
    const hasNormals = !!geo.getAttribute('normal');
    const hasSkin = !!geo.getAttribute('skinWeight');
    this.infoEl.innerHTML = `
      <div style="color:#ccc;font-weight:600;">${this.model?.name || 'Unnamed'}</div>
      <div style="margin-top:4px;">Vertices: <b style="color:#4fc3f7;">${verts}</b></div>
      <div>Triangles: <b style="color:#4fc3f7;">${Math.floor(faces)}</b></div>
      <div>Edges: <b style="color:#4fc3f7;">~${Math.floor(faces * 1.5)}</b></div>
      <div style="margin-top:4px;">Selected Verts: <b>${this.selectedVerts.size}</b></div>
      <div>Selected Edges: <b>${this.selectedEdges.size}</b></div>
      <div>Selected Faces: <b>${this.selectedFaces.size}</b></div>
      <hr style="border-color:#333;margin:6px 0;"/>
      <div>UVs: ${hasUV ? 'Yes' : 'No (use Auto UV)'}</div>
      <div>Normals: ${hasNormals ? 'Yes' : 'No'}</div>
      <div>Skin Weights: ${hasSkin ? 'Yes' : 'No'}</div>
      <div>Bones: <b>${this.bones.length}</b></div>
    `;
  }

  private updateBoneList(): void {
    if (!this.bonesEl) return;
    if (this.bones.length === 0) { this.bonesEl.textContent = 'No bones'; return; }
    this.bonesEl.innerHTML = this.bones.map((b, i) =>
      `<div style="padding:2px 0;cursor:pointer;display:flex;align-items:center;gap:4px;" data-bidx="${i}">
        <span style="color:#ccc;">${b.name}</span>
      </div>`
    ).join('');
  }

  // ══════════════════════════════════════════════════════— 
  // HELPERS
  // ══════════════════════════════════════════════════════— 

  private clearModel(): void {
    const toRemove: THREE.Object3D[] = [];
    this.scene.traverse(obj => {
      if (obj === this.model || obj === this.wireframeOverlay || obj === this.vertexDots || obj === this.skeletonHelper || obj.userData?.__editorHelper) {
        toRemove.push(obj);
      }
    });
    toRemove.forEach(obj => this.scene.remove(obj));
    this.model = null;
    this.activeMesh = null;
    this.wireframeOverlay = null;
    this.vertexDots = null;
    this.skeletonHelper = null;
    this.selectedVerts.clear();
    this.selectedEdges.clear();
    this.selectedFaces.clear();
    this.bones = [];
  }

  private findSkinnedMesh(obj: THREE.Object3D): THREE.SkinnedMesh | null {
    let result: THREE.SkinnedMesh | null = null;
    obj.traverse(child => { if (!result && child instanceof THREE.SkinnedMesh) result = child; });
    return result;
  }

  private findFirstMesh(obj: THREE.Object3D): THREE.Mesh | null {
    let result: THREE.Mesh | null = null;
    obj.traverse(child => { if (!result && child instanceof THREE.Mesh) result = child; });
    return result;
  }

  dispose(): void {
    if (this.animId) cancelAnimationFrame(this.animId);
    this.resizeObserver?.disconnect();
    this.clearModel();
    this.orbit?.dispose();
    this.renderer?.dispose();
  }

  // ══════════════════════════════════════════════════════
  // WEIGHT PAINT
  // ══════════════════════════════════════════════════════

  private refreshWeightPaintBoneList(): void {
    const sel = this.sidebarEl.querySelector('#mr-wp-bone') as HTMLSelectElement | null;
    if (!sel) return;
    sel.innerHTML = this.bones.length > 0
      ? this.bones.map((b, i) => `<option value="${i}">${b.name}</option>`).join('')
      : '<option value="0">No bones</option>';
    this.weightPaintActiveBoneIndex = 0;
  }

  private applyWeightPaint(): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    if (!posAttr) return;

    // Ensure skinWeight and skinIndex attributes exist
    if (!geo.getAttribute('skinWeight')) {
      const sw = new Float32Array(posAttr.count * 4);
      const si = new Float32Array(posAttr.count * 4);
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    }
    const skinWeightAttr = geo.getAttribute('skinWeight') as THREE.BufferAttribute;

    // Raycast to find hit point
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObject(mesh);
    if (hits.length === 0) return;
    const hitPos = hits[0].point;

    // Paint all vertices within brush radius
    const meshPos = new THREE.Vector3();
    let changed = false;
    for (let i = 0; i < posAttr.count; i++) {
      meshPos.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      meshPos.applyMatrix4(mesh.matrixWorld);
      const dist = meshPos.distanceTo(hitPos);
      if (dist < this.weightPaintBrushRadius) {
        const falloff = 1 - dist / this.weightPaintBrushRadius;
        const delta = this.weightPaintBrushStrength * falloff;
        // We store weight for the active bone in channel 0 of skinWeight (simplified)
        const cur = skinWeightAttr.getX(i);
        const next = Math.min(1, Math.max(0, cur + delta));
        (skinWeightAttr as THREE.BufferAttribute).setX(i, next);
        changed = true;
      }
    }
    if (!changed) return;
    skinWeightAttr.needsUpdate = true;

    // Update vertex colours to reflect weights (red=high, blue=low)
    const colors = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      const w = skinWeightAttr.getX(i);
      colors[i * 3]     = w;
      colors[i * 3 + 1] = 0;
      colors[i * 3 + 2] = 1 - w;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.vertexColors = true;
    mat.needsUpdate = true;
  }

  // ══════════════════════════════════════════════════════
  // MORPH TARGETS
  // ══════════════════════════════════════════════════════

  private addMorphTarget(): void {
    const mesh = this.activeMesh;
    if (!mesh) { alert('No mesh loaded. Create or load a mesh first.'); return; }
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;

    const name = `Shape ${this.morphTargetNames.length + 1}`;
    this.morphTargetNames.push(name);

    // Store current positions as a new morph position array
    if (!geo.morphAttributes.position) geo.morphAttributes.position = [];
    const snapshot = posAttr.clone() as THREE.BufferAttribute;
    geo.morphAttributes.position.push(snapshot);

    // Ensure mesh has the influences array
    if (!mesh.morphTargetInfluences) mesh.morphTargetInfluences = [];
    mesh.morphTargetInfluences.push(0);
    mesh.updateMorphTargets();

    this.refreshMorphTargetList();
  }

  private refreshMorphTargetList(): void {
    const list = this.sidebarEl.querySelector('#mr-morph-list') as HTMLElement | null;
    if (!list) return;
    list.innerHTML = '';
    this.morphTargetNames.forEach((name, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;';
      const label = document.createElement('span');
      label.textContent = name;
      label.style.cssText = 'color:#ccc;font-size:10px;width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '1';
      slider.step = '0.01';
      slider.value = '0';
      slider.style.cssText = 'flex:1;accent-color:#58a6ff;';
      slider.addEventListener('input', () => {
        const mesh = this.activeMesh;
        if (mesh?.morphTargetInfluences && i < mesh.morphTargetInfluences.length) {
          mesh.morphTargetInfluences[i] = parseFloat(slider.value);
        }
      });
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.className = 'mr-btn';
      delBtn.style.cssText = 'padding:1px 4px;font-size:9px;color:#f44;';
      delBtn.addEventListener('click', () => this.removeMorphTarget(i));
      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(delBtn);
      list.appendChild(row);
    });
  }

  private removeMorphTarget(index: number): void {
    const mesh = this.activeMesh;
    if (!mesh) return;
    this.morphTargetNames.splice(index, 1);
    if (mesh.geometry.morphAttributes.position) {
      mesh.geometry.morphAttributes.position.splice(index, 1);
    }
    if (mesh.morphTargetInfluences) {
      mesh.morphTargetInfluences.splice(index, 1);
    }
    mesh.updateMorphTargets();
    this.refreshMorphTargetList();
  }

  // ══════════════════════════════════════════════════════
  // GLTF EXPORT
  // ══════════════════════════════════════════════════════

  private exportGLTF(): void {
    const mesh = this.activeMesh;
    if (!mesh) { alert('No mesh to export.'); return; }

    const exporter = new GLTFExporter();
    const exportRoot = this.model ?? mesh;

    exporter.parse(
      exportRoot,
      (result) => {
        let blob: Blob;
        if (result instanceof ArrayBuffer) {
          blob = new Blob([result], { type: 'application/octet-stream' });
        } else {
          blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (exportRoot.name || 'model') + (result instanceof ArrayBuffer ? '.glb' : '.gltf');
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      },
      (error) => {
        console.error('GLTFExporter error:', error);
        alert('GLTF export failed. See console for details.');
      },
      {
        binary: true,
        animations: [],
        includeCustomExtensions: false,
      },
    );
  }
}
