import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Engine } from '../engine/Engine';
import { EditorHierarchy } from './panels/EditorHierarchy';
import { EditorInspector } from './panels/EditorInspector';
import { EditorTimeline } from './panels/EditorTimeline';
import { EditorToolbar } from './panels/EditorToolbar';
import { EditorViewport } from './panels/EditorViewport';
import { EditorStatusBar } from './panels/EditorStatusBar';
import { EditorMenuBar } from './panels/EditorMenuBar';
import { UndoManager, TransformCommand, type TransformSnapshot } from './UndoManager';
import { EditorConsole } from './panels/EditorConsole';
import { EditorPreferences } from './panels/EditorPreferences';
import { SceneGizmos } from './SceneGizmos';
import { VisualScriptEditor } from './panels/VisualScriptEditor';
import { PlayModeSystem } from './PlayModeSystem';
import { SceneSerializer } from '../engine/SceneSerialization';
import { TerrainEditorPanel } from './TerrainEditorPanel';
import { CinematicEditorTab } from './CinematicEditorTab';
import { AnimationEditorPanel } from './AnimationEditorPanel';
import { AnimStateMachineEditor } from './panels/AnimStateMachineEditor';
import { ScriptEditorPanel } from './panels/ScriptEditorPanel';
import { SplinePathSystem, SplinePath } from '../engine/SplinePathSystem';
import { EngineSystemsPanel } from './panels/EngineSystemsPanel';
import { UIEditorPanel } from './UIEditorPanel';
import { ModelingRiggingPanel } from './panels/ModelingRiggingPanel';
import { TextureEditorPanel } from './panels/TextureEditorPanel';
import { createEditorTabDefinitions, type EditorTabDefinition } from './EditorTabRegistry';
import { buildEditorLayout } from './EditorLayoutBuilder';
import { EditorTabController } from './EditorTabController';
import { EditorPlayModeCoordinator } from './EditorPlayModeCoordinator';
import { EditorAutosaveService } from './EditorAutosaveService';
import { EditorViewportInputController, type DroppedEditorAsset } from './EditorViewportInputController';
import { EditorKeyboardShortcuts } from './EditorKeyboardShortcuts';
import { EditorSelectionController } from './EditorSelectionController';
import { EditorProjectFileService } from './EditorProjectFileService';
import { EditorAssetDropService } from './EditorAssetDropService';
import { EditorSceneEditingService } from './EditorSceneEditingService';
import { EditorCameraNavigationController } from './EditorCameraNavigationController';

export type TransformMode = 'translate' | 'rotate' | 'scale';
export type EditorTool = 'select' | 'translate' | 'rotate' | 'scale';
export type TimelineMode = 'cinematic' | 'animation';

export interface EditorState {
  selectedObject: THREE.Object3D | null;
  tool: EditorTool;
  transformSpace: 'world' | 'local';
  pivotMode: 'center' | 'origin';
  isPlaying: boolean;
  snapTranslate: number;
  snapRotate: number;
  snapScale: number;
  showGrid: boolean;
  showWireframe: boolean;
  showBones: boolean;
  showBoundingBoxes: boolean;
  timelineMode: TimelineMode;
  edgeScale: boolean;
}

export class EditorApp {
  public engine: Engine;
  public state: EditorState;
  public scene: THREE.Scene;
  public editorCamera: THREE.PerspectiveCamera;
  public orbitControls: OrbitControls;
  public transformControls: TransformControls;

  // Panels
  public hierarchy: EditorHierarchy;
  public inspector: EditorInspector;
  public timeline: EditorTimeline;
  public toolbar: EditorToolbar;
  public viewport: EditorViewport;
  public statusBar: EditorStatusBar;
  public menuBar: EditorMenuBar;
  public undo: UndoManager;

  // Extended panels
  public console: EditorConsole;
  public preferences: EditorPreferences;
  public sceneGizmos: SceneGizmos;
  public visualScript: VisualScriptEditor;
  public playMode: PlayModeSystem;
  public terrainEditor: TerrainEditorPanel;
  public cinematicEditor: CinematicEditorTab;
  public animationEditor: AnimationEditorPanel;
  public animStateMachineEditor: AnimStateMachineEditor;
  public scriptEditorPanel: ScriptEditorPanel;
  public splinePaths: SplinePathSystem;
  public engineSystemsPanel: EngineSystemsPanel;
  public uiEditorPanel: UIEditorPanel;
  public modelingPanel: ModelingRiggingPanel;
  public textureEditor: TextureEditorPanel;

  // DOM
  private root: HTMLElement;
  private viewportContainer: HTMLElement | null = null;
  private editorRenderer: THREE.WebGLRenderer;
  private editorCanvas: HTMLCanvasElement;

  // Public accessors for panels
  get camera(): THREE.PerspectiveCamera { return this.editorCamera; }
  get controls(): OrbitControls { return this.orbitControls; }
  private clock = new THREE.Clock();
  private running = false;
  private animFrameId = 0;

  // Editor helpers
  private gridHelper: THREE.GridHelper;
  private axisHelper: THREE.AxesHelper;
  private _savedSelectedObject: THREE.Object3D | null = null;
  private readonly selectionController: EditorSelectionController;
  private readonly sceneEditingService: EditorSceneEditingService;
  private readonly cameraNavigationController: EditorCameraNavigationController;

  get selection(): ReadonlySet<THREE.Object3D> { return this.selectionController.getSelectedObjects(); }

  // Transform undo tracking
  private _transformSnapshot: TransformSnapshot | null = null;
  private _justFinishedDragging = false;

  // Tab system
  private readonly tabDefinitions: EditorTabDefinition[];
  private tabController: EditorTabController | null = null;
  private _playModePlayHandler: (() => void) | null = null;
  private _playModeStopHandler: (() => void) | null = null;

  // Listeners
  private listeners: Array<() => void> = [];

  private readonly playModeCoordinator: EditorPlayModeCoordinator;
  private readonly autosaveService: EditorAutosaveService;
  private readonly viewportInputController: EditorViewportInputController;
  private readonly keyboardShortcuts: EditorKeyboardShortcuts;
  private readonly projectFileService: EditorProjectFileService;
  private readonly assetDropService: EditorAssetDropService;

  // Scene animation mixers (for in-editor animation preview)
  private _sceneMixers: THREE.AnimationMixer[] = [];

  constructor(engine: Engine) {
    this.engine = engine;

    this.state = {
      selectedObject: null,
      tool: 'translate',
      transformSpace: 'world',
      pivotMode: 'center',
      isPlaying: false,
      snapTranslate: 0,
      snapRotate: 0,
      snapScale: 0,
      showGrid: true,
      showWireframe: false,
      showBones: false,
      showBoundingBoxes: false,
      timelineMode: 'cinematic',
      edgeScale: false,
    };

    // Editor scene (clone of game scene or new)
    this.scene = engine.scenes.active ?? engine.scenes.create('editor');

    // Editor camera
    this.editorCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
    this.editorCamera.position.set(15, 12, 15);
    this.editorCamera.lookAt(0, 0, 0);

    // Create editor canvas/renderer
    this.editorCanvas = document.createElement('canvas');
    this.editorCanvas.id = 'editor-canvas';
    // Tell engine that the visible viewport is the editor canvas (for templates' pointer lock etc.)
    engine.viewportCanvas = this.editorCanvas;
    engine.input.setCanvas(this.editorCanvas);
    this.editorRenderer = new THREE.WebGLRenderer({
      canvas: this.editorCanvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.editorRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.editorRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this.editorRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.editorRenderer.shadowMap.enabled = true;
    this.editorRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Grid & Axis
    this.gridHelper = new THREE.GridHelper(200, 200, 0x444444, 0x2a2a2a);
    this.scene.add(this.gridHelper);

    this.axisHelper = new THREE.AxesHelper(5);
    this.scene.add(this.axisHelper);

    // Orbit Controls — RMB orbit, MMB pan, scroll zoom, LMB reserved for selection
    this.orbitControls = new OrbitControls(this.editorCamera, this.editorCanvas);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;
    this.orbitControls.screenSpacePanning = true;
    this.orbitControls.maxPolarAngle = Math.PI * 0.95;
    this.orbitControls.mouseButtons = {
      LEFT: -1 as any,      // Disabled — left click is for selection only
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.orbitControls.keys = {
      LEFT: 'ArrowLeft',
      UP: 'ArrowUp',
      RIGHT: 'ArrowRight',
      BOTTOM: 'ArrowDown',
    };

    // Transform Controls (gizmos)
    this.transformControls = new TransformControls(this.editorCamera, this.editorCanvas);
    this.transformControls.setMode('translate');
    this.scene.add(this.transformControls.getHelper());

    // Disable orbit while transforming + capture undo snapshots
    // Track transform delta for multi-select
    const _prevPos = new THREE.Vector3();
    const _prevRot = new THREE.Euler();
    const _prevScale = new THREE.Vector3();

    this.transformControls.addEventListener('dragging-changed', (event) => {
      // Don't re-enable orbit if camera preview is active
      if (this.cameraNavigationController.isPreviewing()) {
        this.orbitControls.enabled = false;
      } else {
        this.orbitControls.enabled = !event.value;
      }
      if (event.value) {
        // Drag started — capture "before" snapshot
        const obj = this.transformControls.object;
        if (obj) {
          this._transformSnapshot = TransformCommand.capture(obj);
          _prevPos.copy(obj.position);
          _prevRot.copy(obj.rotation);
          _prevScale.copy(obj.scale);
        }
      } else {
        // Drag ended — push undo command
        this._justFinishedDragging = true;
        setTimeout(() => { this._justFinishedDragging = false; }, 200);
        const obj = this.transformControls.object;
        if (obj && this._transformSnapshot) {
          const after = TransformCommand.capture(obj);
          const cmd = TransformCommand.fromSnapshots(obj, this._transformSnapshot, after);
          // Push without re-executing (transform already applied)
          this.undo.pushDirect(cmd);
          this._transformSnapshot = null;
        }
      }
    });

    let _inspectorRefreshQueued = false;
    this.transformControls.addEventListener('objectChange', () => {
      // Apply delta to all other selected objects (multi-select support)
      const primary = this.transformControls.object;
      const selectedObjects = this.selectionController.getSelectedObjects();
      if (primary && selectedObjects.size > 0) {
        const mode = this.transformControls.getMode();
        if (mode === 'translate') {
          const delta = new THREE.Vector3().subVectors(primary.position, _prevPos);
          for (const obj of selectedObjects) {
            if (obj !== primary) obj.position.add(delta);
          }
        } else if (mode === 'rotate') {
          const dx = primary.rotation.x - _prevRot.x;
          const dy = primary.rotation.y - _prevRot.y;
          const dz = primary.rotation.z - _prevRot.z;
          for (const obj of selectedObjects) {
            if (obj !== primary) {
              obj.rotation.x += dx;
              obj.rotation.y += dy;
              obj.rotation.z += dz;
            }
          }
        } else if (mode === 'scale') {
          const sx = primary.scale.x / (_prevScale.x || 1);
          const sy = primary.scale.y / (_prevScale.y || 1);
          const sz = primary.scale.z / (_prevScale.z || 1);

          // Edge scale: compensate position so object scales from one edge
          if (this.state.edgeScale) {
            const box = new THREE.Box3().setFromObject(primary);
            const halfSize = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
            // Offset in the direction of scale change
            if (sx !== 1) primary.position.x += halfSize.x * (sx - 1) * 0.5;
            if (sy !== 1) primary.position.y += halfSize.y * (sy - 1) * 0.5;
            if (sz !== 1) primary.position.z += halfSize.z * (sz - 1) * 0.5;
          }

          for (const obj of selectedObjects) {
            if (obj !== primary) {
              obj.scale.x *= sx;
              obj.scale.y *= sy;
              obj.scale.z *= sz;
            }
          }
        }
        _prevPos.copy(primary.position);
        _prevRot.copy(primary.rotation);
        _prevScale.copy(primary.scale);
      }

      // Spline control point drag — update underlying path data
      const spObj = this.transformControls.object;
      if (spObj && spObj.userData._splinePointIndex !== undefined && spObj.userData._splineName) {
        const path = this.splinePaths?.getPath(spObj.userData._splineName);
        if (path) {
          path.movePoint(spObj.userData._splinePointIndex, spObj.position);
        }
      }

      if (!_inspectorRefreshQueued) {
        _inspectorRefreshQueued = true;
        requestAnimationFrame(() => {
          this.inspector?.refresh();
          _inspectorRefreshQueued = false;
        });
      }
      // Snap visual feedback
      this.showSnapFeedback();
    });

    // Build DOM
    this.root = document.getElementById('editor-root')!;

    // Create panels
    this.toolbar = new EditorToolbar(this);
    this.menuBar = new EditorMenuBar(this);
    this.hierarchy = new EditorHierarchy(this);
    this.inspector = new EditorInspector(this);
    this.timeline = new EditorTimeline(this);
    this.viewport = new EditorViewport(this);
    this.statusBar = new EditorStatusBar(this);
    this.undo = new UndoManager();

    // After undo/redo, refresh the gizmo and inspector to show correct state
    this.undo.onChange = () => {
      const obj = this.state.selectedObject;
      if (obj && this.state.tool !== 'select') {
        // Re-attach gizmo so it moves to the object's current (undone/redone) position
        this.transformControls.detach();
        this.transformControls.attach(obj);
      }
      this.inspector?.refresh();
      this.hierarchy?.refresh();
    };

    // Extended panels
    this.console = new EditorConsole(this);
    this.preferences = new EditorPreferences(this);
    this.sceneGizmos = new SceneGizmos(this.scene, this.editorCamera, this.editorCanvas);
    this.visualScript = new VisualScriptEditor();
    this.playMode = new PlayModeSystem(this.scene);
    this.terrainEditor = new TerrainEditorPanel(this);
    this.cinematicEditor = new CinematicEditorTab(this);
    this.animationEditor = new AnimationEditorPanel(this);
    this.animStateMachineEditor = new AnimStateMachineEditor(this);
    this.scriptEditorPanel = new ScriptEditorPanel(this);
    this.splinePaths = new SplinePathSystem(this.scene);
    this.engineSystemsPanel = new EngineSystemsPanel(this);
    this.uiEditorPanel = new UIEditorPanel(this);
    this.modelingPanel = new ModelingRiggingPanel(this);
    this.textureEditor = new TextureEditorPanel(this);
    this.selectionController = new EditorSelectionController({
      scene: this.scene,
      state: this.state,
      camera: this.editorCamera,
      transformControls: this.transformControls,
      refreshHierarchy: () => this.hierarchy.refresh(),
      refreshInspector: () => this.inspector.refresh(),
      isLocked: (object) => this.hierarchy.isLocked(object),
      isEditorHelper: (object) => this.isEditorHelper(object),
      isTransformControlChild: (object) => this.isTransformControlChild(object),
    });
    this.tabDefinitions = createEditorTabDefinitions({
      terrainEditor: this.terrainEditor,
      animationEditor: this.animationEditor,
      cinematicEditor: this.cinematicEditor,
      animStateMachineEditor: this.animStateMachineEditor,
      scriptEditorPanel: this.scriptEditorPanel,
      visualScript: this.visualScript,
      uiEditorPanel: this.uiEditorPanel,
      modelingPanel: this.modelingPanel,
      textureEditor: this.textureEditor,
    });
    this.playModeCoordinator = new EditorPlayModeCoordinator({
      engine: this.engine,
      scene: this.scene,
      editorCamera: this.editorCamera,
      orbitControls: this.orbitControls,
      transformControls: this.transformControls,
      editorCanvas: this.editorCanvas,
      onEnterPlayMode: () => this.clearSelectionForPlayMode(),
      onExitPlayMode: () => this.restoreSelectionAfterPlayMode(),
      requestStopPlayMode: () => {
        this.playMode.stop();
        this.exitPlayMode();
      },
    });
    this.autosaveService = new EditorAutosaveService({
      getPreferences: () => this.preferences.get(),
      getActiveScene: () => this.engine.scenes.active,
      serializeScene: (scene) => SceneSerializer.serialize(scene),
      deserializeScene: (data, targetScene) => SceneSerializer.deserialize(data, targetScene),
      rebuildHierarchy: () => this.hierarchy.rebuild(),
      setStatusMessage: (message) => this.statusBar.setMessage(message),
      storage: typeof localStorage === 'undefined' ? undefined : localStorage,
    });
    this.viewportInputController = new EditorViewportInputController({
      canvas: this.editorCanvas,
      getViewportContainer: () => this.viewportContainer,
      isInteractionBlocked: () => this.playMode.isPlaying() || this.playMode.isPaused(),
      isTransformDragging: () => this.transformControls.dragging,
      isJustFinishedDragging: () => this._justFinishedDragging,
      onViewportClick: (event) => this.selectionController.handleViewportClick(event, this.viewportContainer),
      onMarqueeSelect: (startX, startY, endX, endY) => this.selectionController.handleMarqueeSelect(startX, startY, endX, endY, this.viewportContainer),
      onAssetDrop: (asset, event) => this.handleViewportAssetDrop(asset, event),
    });
    this.keyboardShortcuts = new EditorKeyboardShortcuts({
      onTranslate: () => this.setTool('translate'),
      onRotate: () => this.setTool('rotate'),
      onScale: () => this.setTool('scale'),
      onSelectTool: () => this.setTool('select'),
      onFocusSelected: () => this.focusSelected(),
      onDeleteSelected: () => this.deleteSelected(),
      onExitCameraPreview: () => this.exitCameraPreview(),
      onUndo: () => this.undo.undo(),
      onRedo: () => this.undo.redo(),
      onSaveScene: () => this.saveActiveScene(),
      onDuplicateSelected: () => this.duplicateSelected(),
      onSelectAll: () => this.selectAllSceneObjects(),
      onTogglePlayMode: () => this.togglePlayMode(),
      onToggleSelectedVisibility: () => this.toggleSelectedVisibility(),
      onToggleGrid: () => { this.state.showGrid = !this.state.showGrid; },
      onToggleWireframe: () => { this.state.showWireframe = !this.state.showWireframe; this.toggleWireframe(); },
      onToggleBones: () => this.toggleBones(),
    });
    this.sceneEditingService = new EditorSceneEditingService({
      scene: this.scene,
      camera: this.editorCamera,
      undo: this.undo,
      getSelectedObject: () => this.state.selectedObject,
      select: (object) => this.select(object),
      refreshHierarchy: () => this.hierarchy.refresh(),
      isLocked: (object) => this.hierarchy.isLocked(object),
      createSplinePath: (config) => this.splinePaths.createPath(config),
      loadModelFromFiles: (files) => this.engine.assets.loadModelFromFiles(files as FileList),
      registerMixer: (mixer) => this._sceneMixers.push(mixer),
      unregisterMixer: (mixer) => {
        this._sceneMixers = this._sceneMixers.filter(existingMixer => existingMixer !== mixer);
      },
    });
    this.cameraNavigationController = new EditorCameraNavigationController({
      editorCamera: this.editorCamera,
      orbitControls: this.orbitControls,
      setStatusMessage: (message) => this.statusBar.setMessage(message),
    });
    this.projectFileService = new EditorProjectFileService();
    this.assetDropService = new EditorAssetDropService({
      loadModel: (path) => this.engine.assets.loadModel(path),
      scene: this.scene,
      onSelect: (object) => this.select(object),
      onRefreshHierarchy: () => this.hierarchy.refresh(),
      onRegisterMixer: (mixer) => this._sceneMixers.push(mixer),
      resolveDropPoint: (event) => this.resolveViewportDropPoint(event),
    });
  }

  open(): void {
    document.body.classList.add('editor-mode');
    this.buildLayout();
    this.running = true;
    this.clock.start();
    this.loop();
    this.keyboardShortcuts.attach();

    // Hook play mode events (from overlay buttons)
    if (!this._playModePlayHandler) {
      this._playModePlayHandler = () => {
        if (!this.state.isPlaying) {
          this.state.isPlaying = true;
          this.enterPlayMode();
        }
      };
    }
    if (!this._playModeStopHandler) {
      this._playModeStopHandler = () => {
        if (this.state.isPlaying) {
          this.state.isPlaying = false;
          this.exitPlayMode();
        }
      };
    }
    this.playMode.on('play', this._playModePlayHandler);
    this.playMode.on('stop', this._playModeStopHandler);

    // Initialize weather scene reference for editor preview
    if (!this.engine.weather.scene) {
      this.engine.weather.init(this.scene, this.editorCamera);
    }

    // Apply snap settings from preferences
    this.applyPreferences();

    // Delayed resize so canvas gets correct layout dimensions
    requestAnimationFrame(() => {
      this.resizeViewport();
      requestAnimationFrame(() => this.resizeViewport());
    });

    // Autosave every 60 seconds
    this.autosaveService.start();

    // Restore autosave on first open
    this.autosaveService.offerRestore();
  }

  private _snapFeedbackEl: HTMLElement | null = null;
  private _snapFeedbackTimer = 0;

  private showSnapFeedback(): void {
    const obj = this.state.selectedObject;
    if (!obj) return;
    const snap = this.state.snapTranslate || this.state.snapRotate || this.state.snapScale;
    if (!snap) return;

    if (!this._snapFeedbackEl) {
      this._snapFeedbackEl = document.createElement('div');
      this._snapFeedbackEl.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(0,120,212,0.85);color:#fff;padding:3px 10px;border-radius:4px;font-size:10px;font-family:monospace;pointer-events:none;z-index:30;transition:opacity 0.3s;';
    }

    const p = obj.position;
    const r = obj.rotation;
    let text = '';
    if (this.state.tool === 'translate' && this.state.snapTranslate) {
      text = `Snap: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} (${this.state.snapTranslate}u)`;
    } else if (this.state.tool === 'rotate' && this.state.snapRotate) {
      text = `Snap: ${THREE.MathUtils.radToDeg(r.x).toFixed(0)}°, ${THREE.MathUtils.radToDeg(r.y).toFixed(0)}°, ${THREE.MathUtils.radToDeg(r.z).toFixed(0)}° (${this.state.snapRotate}°)`;
    } else if (this.state.tool === 'scale' && this.state.snapScale) {
      const s = obj.scale;
      text = `Snap: ${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)} (${this.state.snapScale})`;
    }

    if (text && this._snapFeedbackEl) {
      this._snapFeedbackEl.textContent = text;
      this._snapFeedbackEl.style.opacity = '1';
      if (this.viewportContainer && !this.viewportContainer.contains(this._snapFeedbackEl)) {
        this.viewportContainer.appendChild(this._snapFeedbackEl);
      }
      clearTimeout(this._snapFeedbackTimer);
      this._snapFeedbackTimer = window.setTimeout(() => {
        if (this._snapFeedbackEl) this._snapFeedbackEl.style.opacity = '0';
      }, 1500);
    }
  }

  /** Apply stored preferences (snap, camera, grid) to editor state */
  private applyPreferences(): void {
    const prefs = this.preferences.get();
    // Snap
    this.transformControls.setTranslationSnap(prefs.snapTranslate || null);
    this.transformControls.setRotationSnap(prefs.snapRotate ? THREE.MathUtils.degToRad(prefs.snapRotate) : null);
    this.transformControls.setScaleSnap(prefs.snapScale || null);
    this.state.snapTranslate = prefs.snapTranslate;
    this.state.snapRotate = prefs.snapRotate;
    this.state.snapScale = prefs.snapScale;
    // Camera
    this.editorCamera.fov = prefs.cameraFov;
    this.editorCamera.near = prefs.cameraNear;
    this.editorCamera.far = prefs.cameraFar;
    this.editorCamera.updateProjectionMatrix();
    // Grid (apply colors from prefs)
    this.updateGrid();
  }

  close(): void {
    // Autosave before closing
    this.autosaveService.perform();
    this.autosaveService.stop();
    // Exit camera preview if active
    if (this.cameraNavigationController.isPreviewing()) {
      this.exitCameraPreview();
    }
    // Stop play mode if active
    if (!this.playMode.isStopped()) {
      this.playMode.stop();
      this.exitPlayMode();
    }
    this.running = false;
    cancelAnimationFrame(this.animFrameId);
    if (this._playModePlayHandler) this.playMode.off('play', this._playModePlayHandler);
    if (this._playModeStopHandler) this.playMode.off('stop', this._playModeStopHandler);
    this.disposePanels();
    this.viewportInputController.detach();
    this.keyboardShortcuts.detach();
    // Dispose controls (prevents lingering DOM listeners)
    this.orbitControls.dispose();
    this.transformControls.dispose();
    this.engine.viewportCanvas = this.engine.renderer.domElement;
    this.engine.input.setCanvas(this.engine.renderer.domElement);
    document.body.classList.remove('editor-mode');
    this.root.innerHTML = '';
    this.viewportContainer = null;
    this.tabController = null;
    this.cleanupListeners();
  }

  private deactivateActiveTab(): void {
    this.tabController?.deactivateActiveTab();
  }

  private disposePanels(): void {
    this.deactivateActiveTab();
    this.viewport.dispose();
    this.statusBar.dispose();
    this.timeline.dispose();
    this.console.dispose();
    this.sceneGizmos.dispose();
    this.terrainEditor.dispose();
    this.animationEditor.dispose();
    this.cinematicEditor.dispose();
    this.visualScript.dispose();
    this.scriptEditorPanel.dispose();
    this.uiEditorPanel.dispose();
    this.modelingPanel.dispose();
    this.textureEditor.dispose();
    this.animStateMachineEditor.dispose();
  }

  private buildLayout(): void {
    // The timeline widget lives inside the Animation tab; render it so the tab can adopt its container.
    this.timeline.render();
    const layout = buildEditorLayout({
      root: this.root,
      menuBar: this.menuBar.render(),
      toolbar: this.toolbar.render(),
      hierarchy: this.hierarchy.render(),
      inspector: this.inspector.render(),
      consolePanel: this.console.render(),
      statusBar: this.statusBar.render(),
      editorCanvas: this.editorCanvas,
      viewport: this.viewport.render(),
      tabDefinitions: this.tabDefinitions,
      activeTab: 'scene',
      onTabClick: (tabId) => this.switchTab(tabId),
      createResizer: (direction, target, prop, reverse) => this.createResizer(direction, target, prop, reverse),
    });

    this.viewportContainer = layout.viewportContainer;
    this.tabController = new EditorTabController({
      root: this.root,
      tabBar: layout.tabBar,
      bodyEl: layout.body,
      tabDefinitions: this.tabDefinitions,
      resizeViewport: () => this.resizeViewport(),
      initialTab: 'scene',
    });

    // Attach play mode overlay to viewport
    if (this.viewportContainer) {
      this.playMode.attachOverlay(this.viewportContainer);
    }
    this.viewportInputController.attach();

    // Initialize viewport size
    this.resizeViewport();
    const onResize = () => this.resizeViewport();
    window.addEventListener('resize', onResize);
    this.listeners.push(() => window.removeEventListener('resize', onResize));
  }

  private loop = (): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.loop);

    const delta = this.clock.getDelta();

    const isPlaying = this.playMode.isPlaying() || this.playMode.isPaused();

    // Only update orbit controls when not playing
    if (!isPlaying) {
      this.orbitControls.update();
    } else if (this.engine.onUpdate) {
      // Template handles its own camera — sync engine.camera → editorCamera each frame
      this.editorCamera.position.copy(this.engine.camera.position);
      this.editorCamera.quaternion.copy(this.engine.camera.quaternion);
      this.editorCamera.fov = this.engine.camera.fov;
      this.editorCamera.updateProjectionMatrix();
    } else {
      // FPS camera movement during play mode — only when no template handles its own camera
      this.playModeCoordinator.updateCamera(delta);
    }

    // Scene gizmos
    this.sceneGizmos.update();

    // Play mode — engine loop handles game system updates via editorActive flag
    const playDelta = this.playMode.update(delta);

    // Update weather in editor (always, so it's visible)
    this.engine.weather.update(delta);

    // Update grid visibility
    this.gridHelper.visible = this.state.showGrid;

    // Update selection box (hide when object is invisible)
    const selectionBox = this.selectionController.getPrimarySelectionBox();
    if (selectionBox && this.state.selectedObject) {
      selectionBox.visible = this.state.selectedObject.visible;
      selectionBox.update();
    }
    // Update multi-select boxes
    for (const [uuid, box] of this.selectionController.getSelectionBoxes()) {
      const obj = this.scene.getObjectByProperty('uuid', uuid);
      if (obj) {
        box.visible = obj.visible;
        box.update();
      }
    }

    // Hide transform gizmo helper when selected object is invisible or during play mode
    const gizmoHelper = this.transformControls.getHelper();
    if (isPlaying) {
      gizmoHelper.visible = false;
    } else if (this.transformControls.object && !this.transformControls.object.visible) {
      gizmoHelper.visible = false;
    } else if (this.transformControls.object) {
      gizmoHelper.visible = true;
    }

    // Update bone helpers
    for (const helper of this.selectionController.getBoneHelpers()) {
      helper.visible = this.state.showBones;
    }

    // Update engine systems (particles, camera effects, audio)
    this.engine.particles.update(delta);
    this.engine.cameraEffects.update(delta);
    this.engine.audio.updateListener(this.editorCamera);

    // Update any animation mixers on scene objects (for in-editor animation preview)
    if (!isPlaying) {
      for (const mixer of this._sceneMixers) {
        mixer.update(delta);
      }
    }

    // Render — split mode bypasses post-processing and renders 4 independent viewports
    if (this.viewport.isSplitModeEnabled()) {
      this.viewport.renderSplitViewports(this.editorRenderer, this.scene);
    } else {
      // Render — use post-processing pipeline if effects are active, otherwise standard render
      const pp = this.engine.postProcessing;
      if (pp.hasEffects) {
      try {
        // Use layers to separate editor helpers from scene objects:
        // Layer 0 = scene objects (default), Layer 1 = editor helpers
        const editorHelpers: THREE.Object3D[] = [
          this.gridHelper,
          ...(selectionBox ? [selectionBox] : []),
          this.transformControls.getHelper(),
          ...this.selectionController.getBoneHelpers(),
        ].filter(Boolean);
        for (const h of editorHelpers) h.layers.set(1);

        // Render scene objects only (layer 0) through post-processing
        this.editorCamera.layers.set(0);
        pp.setRenderer(this.editorRenderer);
        pp.render(this.scene, this.editorCamera);

        // Render editor helpers (layer 1) on top without post-processing
        this.editorCamera.layers.set(1);
        this.editorRenderer.autoClear = false;
        this.editorRenderer.render(this.scene, this.editorCamera);
        this.editorRenderer.autoClear = true;

        // Restore camera to see all layers
        this.editorCamera.layers.enableAll();
        for (const h of editorHelpers) h.layers.set(0);
      } catch (e) {
        // Fallback to normal render if post-processing fails
        this.editorCamera.layers.enableAll();
        this.editorRenderer.autoClear = true;
        this.editorRenderer.render(this.scene, this.editorCamera);
        console.warn('[PostProcessing] Render error, falling back:', e instanceof Error ? e.message : e);
      }
      } else {
        this.editorRenderer.render(this.scene, this.editorCamera);
      }
    }

    // Status bar update
    this.statusBar.refresh();
  };

  // --- Selection ---

  select(object: THREE.Object3D | null): void {
    this.selectionController.select(object);
  }

  addToSelection(object: THREE.Object3D): void {
    this.selectionController.addToSelection(object);
  }

  removeFromSelection(object: THREE.Object3D): void {
    this.selectionController.removeFromSelection(object);
  }

  /* ─── Play Mode Hooks ───────────────────────────────── */

  /** Called when editor play mode starts — enables physics, plays within viewport */
  enterPlayMode(): void {
    this.playModeCoordinator.enter();
  }

  /** Called when play resumes from pause */
  resumePlayMode(): void {
    this.playModeCoordinator.resumeFromPause();
  }

  /** Called when editor play mode stops — restores scene, disables physics */
  exitPlayMode(): void {
    this.playModeCoordinator.exit();
  }

  private clearSelectionForPlayMode(): void {
    this.transformControls.detach();
    this._savedSelectedObject = this.state.selectedObject;
    this.selectionController.clearForPlayMode();
    this.transformControls.getHelper().visible = false;
  }

  private restoreSelectionAfterPlayMode(): void {
    if (this._savedSelectedObject) {
      this.select(this._savedSelectedObject);
      this._savedSelectedObject = null;
    }
    this.hierarchy.refresh();
    this.inspector.refresh();
  }



  setTool(tool: EditorTool): void {
    this.state.tool = tool;
    switch (tool) {
      case 'select':
        this.transformControls.detach();
        break;
      case 'translate':
        this.transformControls.setMode('translate');
        if (this.state.selectedObject) this.transformControls.attach(this.state.selectedObject);
        break;
      case 'rotate':
        this.transformControls.setMode('rotate');
        if (this.state.selectedObject) this.transformControls.attach(this.state.selectedObject);
        break;
      case 'scale':
        this.transformControls.setMode('scale');
        if (this.state.selectedObject) this.transformControls.attach(this.state.selectedObject);
        break;
    }
    this.toolbar.refresh();
  }

  setTransformSpace(space: 'world' | 'local'): void {
    this.state.transformSpace = space;
    this.transformControls.setSpace(space);
    this.toolbar.refresh();
  }

  /** Toggle panel visibility (hierarchy, inspector, console) */
  togglePanel(panel: 'hierarchy' | 'inspector' | 'console'): void {
    const selectors: Record<string, string> = {
      hierarchy: '.editor-left-panel',
      inspector: '.editor-right-panel',
      console: '.editor-console',
    };
    const el = this.root.querySelector(selectors[panel]) as HTMLElement;
    if (el) {
      el.style.display = el.style.display === 'none' ? '' : 'none';
      requestAnimationFrame(() => this.resizeViewport());
    }
  }

  /** Update grid from preferences (color, size) */
  updateGrid(): void {
    const prefs = this.preferences.get();
    this.scene.remove(this.gridHelper);
    this.gridHelper = new THREE.GridHelper(
      prefs.gridSize,
      prefs.gridDivisions,
      new THREE.Color(prefs.gridColor1),
      new THREE.Color(prefs.gridColor2),
    );
    this.gridHelper.visible = this.state.showGrid;
    this.scene.add(this.gridHelper);
  }

  toggleWireframe(): void {
    this.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (this.isEditorHelper(child)) return;
      if (this.isTransformControlChild(child)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        (mat as THREE.MeshStandardMaterial).wireframe = this.state.showWireframe;
      }
    });
  }

  toggleBones(): void {
    this.state.showBones = !this.state.showBones;
    this.selectionController.setBonesVisible(this.state.showBones);
  }

  // --- Add objects to scene ---

  addPrimitive(type: 'cube' | 'sphere' | 'plane' | 'cylinder' | 'capsule' | 'cone' | 'torus'): THREE.Mesh {
    return this.sceneEditingService.addPrimitive(type);
  }

  addLight(type: 'directional' | 'point' | 'spot' | 'ambient'): THREE.Light {
    return this.sceneEditingService.addLight(type);
  }

  addCamera(): THREE.PerspectiveCamera {
    return this.sceneEditingService.addCamera();
  }

  addSplinePath(type: 'movement' | 'collision' | 'camera' | 'generic' = 'movement'): SplinePath {
    return this.sceneEditingService.addSplinePath(type);
  }

  async addModel(): Promise<void> {
    await this.sceneEditingService.addModel();
  }

  /** Save complete project (scene + blueprints + camera + settings) as JSON */
  saveProject(): void {
    const scene = this.engine.scenes.active;
    if (!scene) return;

    const project = this.projectFileService.createProjectData(scene, this.visualScript.graph, this.camera, this.orbitControls.target);

    const json = JSON.stringify(project);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project_${Date.now()}.bfproject`;
    a.click();
    URL.revokeObjectURL(url);
    this.statusBar.setMessage('Project saved');
  }

  /** Load complete project from .bfproject file */
  loadProject(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bfproject,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const project = JSON.parse(text);
        if (!project.scene) { console.error('Invalid project file'); return; }

        const scene = this.engine.scenes.active;
        if (!scene) return;

        this.projectFileService.applyProjectData(project, {
          scene,
          getSceneObjects: () => this.getSceneObjects(),
          graph: this.visualScript.graph,
          camera: this.camera,
          orbitTarget: this.orbitControls.target,
        });

        this.select(null);
        this.hierarchy.refresh();
        this.statusBar.setMessage(`Project loaded: ${file.name}`);
      } catch (err) {
        console.error('Failed to load project:', err);
      }
    };
    input.click();
  }

  deleteSelected(): void {
    this.sceneEditingService.deleteSelected();
  }

  duplicateSelected(): void {
    this.sceneEditingService.duplicateSelected();
  }

  focusSelected(): void {
    this.cameraNavigationController.focusObject(this.state.selectedObject);
  }

  previewCamera(cam: THREE.PerspectiveCamera): void {
    this.cameraNavigationController.previewCamera(cam);
  }

  exitCameraPreview(): void {
    this.cameraNavigationController.exitPreview();
  }

  // --- Private ---

  private isTransformControlChild(obj: THREE.Object3D): boolean {
    const helper = this.transformControls.getHelper();
    let current: THREE.Object3D | null = obj;
    while (current) {
      if (current === helper) return true;
      current = current.parent;
    }
    return false;
  }

  private isEditorHelper(obj: THREE.Object3D): boolean {
    if (obj === this.gridHelper) return true;
    if (obj === this.axisHelper) return true;
    if (obj instanceof THREE.BoxHelper) return true;
    if (obj instanceof THREE.SkeletonHelper) return true;
    if (obj instanceof THREE.CameraHelper) return true;
    if (obj.name.endsWith('_helper')) return true;
    if (obj.userData.__editorOnly || obj.userData.__editorHelper) return true;
    return false;
  }

  switchTab(tabId: string): void {
    this.tabController?.switchTab(tabId);
  }

  /** Toggle the Engine Systems floating panel */
  toggleEngineSystems(): void {
    const existing = this.root.querySelector('.engine-systems-float');
    if (existing) {
      existing.remove();
      return;
    }

    const panel = document.createElement('div');
    panel.className = 'engine-systems-float';
    panel.style.cssText = 'position:absolute;top:80px;right:10px;width:700px;height:500px;background:#1e1e1e;border:1px solid #444;border-radius:6px;z-index:9999;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.6);overflow:hidden;resize:both;';

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:#2d2d2d;border-bottom:1px solid #444;cursor:move;user-select:none;flex-shrink:0;';
    titleBar.innerHTML = '<span style="font-size:13px;color:#ccc;font-weight:600;">⚙️ Engine Systems</span>';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:14px;cursor:pointer;padding:2px 6px;';
    closeBtn.addEventListener('click', () => panel.remove());
    titleBar.appendChild(closeBtn);
    panel.appendChild(titleBar);

    // Make draggable
    let dragX = 0, dragY = 0;
    titleBar.addEventListener('mousedown', (e) => {
      dragX = e.clientX - panel.offsetLeft;
      dragY = e.clientY - panel.offsetTop;
      const onMove = (ev: MouseEvent) => {
        panel.style.left = (ev.clientX - dragX) + 'px';
        panel.style.top = (ev.clientY - dragY) + 'px';
        panel.style.right = 'auto';
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Content
    const content = document.createElement('div');
    content.style.cssText = 'flex:1;overflow:hidden;display:flex;';
    content.appendChild(this.engineSystemsPanel.render());
    panel.appendChild(content);

    this.root.appendChild(panel);
  }

  private resizeViewport(): void {
    if (!this.viewportContainer) return;
    const rect = this.viewportContainer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.editorCamera.aspect = rect.width / rect.height;
    this.editorCamera.updateProjectionMatrix();
    this.editorRenderer.setSize(rect.width, rect.height);
    // Resize post-processing render targets to match viewport
    this.engine.postProcessing.resize(rect.width, rect.height);
  }

  private createResizer(direction: 'h' | 'v', target: HTMLElement, prop: 'width' | 'height', reverse = false): HTMLElement {
    const resizer = document.createElement('div');
    resizer.className = direction === 'h' ? 'resizer-h' : 'resizer-v';

    let startPos = 0;
    let startSize = 0;

    const onMouseMove = (e: MouseEvent) => {
      const diff = direction === 'h'
        ? (reverse ? startPos - e.clientX : e.clientX - startPos)
        : (reverse ? startPos - e.clientY : e.clientY - startPos);
      const newSize = Math.max(100, startSize + diff);
      target.style[prop] = newSize + 'px';
      this.resizeViewport();
    };

    const onMouseUp = () => {
      resizer.classList.remove('active');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    resizer.addEventListener('mousedown', (e) => {
      startPos = direction === 'h' ? e.clientX : e.clientY;
      startSize = direction === 'h' ? target.offsetWidth : target.offsetHeight;
      resizer.classList.add('active');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    return resizer;
  }

  private cleanupListeners(): void {
    for (const cleanup of this.listeners) {
      cleanup();
    }
    this.listeners = [];
  }

  private handleViewportAssetDrop(asset: DroppedEditorAsset, event: DragEvent): void {
    this.assetDropService.handleAssetDrop(asset, event).catch((err: any) => console.error('Drop load failed:', err));
  }

  togglePlayMode(): void {
    if (this.state.isPlaying) {
      this.playMode.stop();
      this.state.isPlaying = false;
      this.exitPlayMode();
    } else {
      this.playMode.play();
      this.state.isPlaying = true;
      this.enterPlayMode();
    }
    this.toolbar.refresh();
  }

  private toggleSelectedVisibility(): void {
    if (!this.state.selectedObject) return;
    this.state.selectedObject.visible = !this.state.selectedObject.visible;
    this.inspector.refresh();
  }

  private selectAllSceneObjects(): void {
    const objects = this.getSceneObjects();
    if (objects.length === 0) return;
    this.select(objects[0]);
    for (let i = 1; i < objects.length; i++) {
      this.addToSelection(objects[i]);
    }
  }

  private saveActiveScene(): void {
    const activeScene = this.engine.scenes.active;
    if (!activeScene) return;
    SceneSerializer.exportToFile(activeScene);
    this.statusBar.setMessage('Scene saved');
  }

  private resolveViewportDropPoint(event: DragEvent): THREE.Vector3 | null {
    const rect = this.editorCanvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.editorCamera);
    const hits = raycaster.intersectObjects(this.scene.children, true);
    return hits.length > 0 ? hits[0].point.clone() : null;
  }

  getSceneObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    this.scene.children.forEach((child) => {
      if (child === this.gridHelper || child === this.axisHelper) return;
      if (child === this.transformControls.getHelper()) return;
      if (child instanceof THREE.BoxHelper) return;
      if (child instanceof THREE.SkeletonHelper) return;
      if (child.name.endsWith('_helper')) return;
      objects.push(child);
    });
    return objects;
  }
}
