/**
 * AnimationEditorPanel — A Blender-like animation editing environment.
 * Features:
 * - 3D viewport with model preview & skeleton visualization
 * - Load model from file or scene selection
 * - Animation clip playback with controls
 * - Bone selection and manual posing
 * - Skeleton/rig visibility toggle
 * - Timeline integration at the bottom
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import type { EditorApp } from './EditorApp';
import type { LoadedModel } from '../engine/AssetManager';

export class AnimationEditorPanel {
  private editor: EditorApp;
  private container: HTMLElement | null = null;

  // 3D preview
  private canvas3d: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls | null = null;
  private animId = 0;
  private clock = new THREE.Clock();
  private resizeObserver: ResizeObserver | null = null;

  // Model state
  private model: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private clips: THREE.AnimationClip[] = [];
  private currentAction: THREE.AnimationAction | null = null;
  private skeletonHelper: THREE.SkeletonHelper | null = null;
  private showSkeleton = true;
  private isPlaying = false;
  private playbackSpeed = 1;

  // Bone selection
  private selectedBone: THREE.Bone | null = null;
  private boneHighlight: THREE.Mesh | null = null;
  private boneGizmo: TransformControls | null = null;
  private boneGizmoMode: 'translate' | 'rotate' = 'rotate';
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  // State Machine
  private animStates: { name: string; clipName: string; loop: boolean; speed: number }[] = [];
  private animTransitions: { from: string; to: string; condition: string; duration: number }[] = [];
  private crossfadeDuration = 0.3;

  // Pose keyframes for clip creation
  private poseKeyframes: { time: number; bones: Map<string, { position: THREE.Vector3; rotation: THREE.Euler }> }[] = [];
  private clipFrameRate = 30;

  // Onion skinning
  private onionSkinning = false;
  private onionGhosts: THREE.Group[] = [];

  // ── Phase 11: IK Chains ──────────────────────────────────
  private ikChains: Array<{ id: number; tipBoneName: string; chainLength: number; targetPos: THREE.Vector3; enabled: boolean }> = [];
  private ikTargetObjects = new Map<number, THREE.Mesh>(); // id → draggable sphere
  private ikNextId = 0;

  // ── Phase 11: Blend Tree ─────────────────────────────────
  private blendTree: { clipIndexA: number; clipIndexB: number; param: number } | null = null;

  // ── Phase 11: Animation Events ───────────────────────────
  private animEvents: Array<{ id: number; clipName: string; time: number; eventName: string }> = [];
  private animEventCallbacks = new Map<string, (ev: { clipName: string; time: number; eventName: string }) => void>();
  private _animPrevTime = 0;

  // ── Phase 11: Retargeting ────────────────────────────────
  private retargetBoneMap = new Map<string, string>(); // sourceName → targetName

  constructor(editor: EditorApp) {
    this.editor = editor;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 500);
    this.camera.position.set(3, 2, 3);
    this.camera.lookAt(0, 1, 0);

    // Lighting
    const amb = new THREE.AmbientLight(0x606080, 0.8);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(5, 8, 3);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
    fill.position.set(-3, 2, -3);
    this.scene.add(amb, dir, fill);

    // Ground grid
    const grid = new THREE.GridHelper(10, 20, 0x444466, 0x333355);
    this.scene.add(grid);

    // Bone highlight sphere
    const geo = new THREE.SphereGeometry(0.03, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.8, depthTest: false });
    this.boneHighlight = new THREE.Mesh(geo, mat);
    this.boneHighlight.visible = false;
    this.boneHighlight.renderOrder = 999;
    this.scene.add(this.boneHighlight);
  }

  render(): HTMLElement {
    // Reuse existing container (avoids recreating renderer on every tab switch)
    if (this.container && this.canvas3d && this.renderer) {
      // Restart the render loop if it was cancelled
      if (!this.animId) this.startLoop();
      return this.container;
    }

    this.container = document.createElement('div');
    this.container.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;background:#1e1e1e;color:#ccc;font-family:system-ui,sans-serif;font-size:12px;';

    // ── Top bar with header & model loading ──
    const topBar = document.createElement('div');
    topBar.style.cssText = 'padding:6px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #333;flex-shrink:0;';
    topBar.innerHTML = `
      <span style="font-size:15px;">🎬</span>
      <span style="font-weight:600;font-size:13px;">Animation Editor</span>
      <span style="flex:1;"></span>
      <button class="anim-btn" data-action="load-file" title="Load model from file">📂 Load Model</button>
      <button class="anim-btn" data-action="load-scene" title="Load selected scene object">🎯 From Scene</button>
      <span style="width:1px;height:18px;background:#444;"></span>
      <button class="anim-btn anim-btn-toggle active" data-action="toggle-skeleton" title="Toggle skeleton">🦴</button>
      <button class="anim-btn anim-btn-toggle" data-action="toggle-wireframe" title="Toggle wireframe">🔲</button>
      <button class="anim-btn anim-btn-toggle" data-action="toggle-onion" title="Onion skinning (ghost frames)">🧅</button>
      <span style="width:1px;height:18px;background:#444;"></span>
      <button class="anim-btn" data-action="export-clip" title="Export selected clip to file">💾 Export</button>
    `;
    this.container.appendChild(topBar);

    // ── Main area: 3D viewport (left) + side panel (right) ──
    const mainArea = document.createElement('div');
    mainArea.style.cssText = 'display:flex;flex:1;overflow:hidden;min-height:0;';
    this.container.appendChild(mainArea);

    // 3D viewport
    const viewportArea = document.createElement('div');
    viewportArea.style.cssText = 'flex:1;position:relative;min-width:0;background:#111;';
    mainArea.appendChild(viewportArea);

    this.canvas3d = document.createElement('canvas');
    this.canvas3d.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block;';
    viewportArea.appendChild(this.canvas3d);

    // No-model overlay
    const emptyOverlay = document.createElement('div');
    emptyOverlay.className = 'anim-empty-overlay';
    emptyOverlay.innerHTML = `
      <div style="font-size:36px;margin-bottom:12px;opacity:0.5;">🎬</div>
      <div style="font-size:14px;color:#888;margin-bottom:8px;">No model loaded</div>
      <div style="font-size:11px;color:#555;">Load a .glb/.gltf model or select an object from the scene</div>
    `;
    emptyOverlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;';
    viewportArea.appendChild(emptyOverlay);

    // ── Side panel: animations & bone info ──
    const sidePanel = document.createElement('div');
    sidePanel.style.cssText = 'width:260px;border-left:1px solid #333;overflow-y:auto;padding:10px;flex-shrink:0;display:flex;flex-direction:column;gap:10px;';
    mainArea.appendChild(sidePanel);

    // Clip list section
    sidePanel.innerHTML = `
      <div class="anim-section">
        <div class="anim-section-title">Animation Clips</div>
        <div class="anim-clip-list" style="max-height:180px;overflow-y:auto;">
          <div style="color:#555;font-size:11px;padding:8px;">No clips available</div>
        </div>
      </div>

      <div class="anim-section">
        <div class="anim-section-title">Playback</div>
        <div style="display:flex;gap:4px;margin-bottom:6px;">
          <button class="anim-btn" data-action="play" title="Play/Pause">▶️ Play</button>
          <button class="anim-btn" data-action="stop" title="Stop">⏹ Stop</button>
          <button class="anim-btn" data-action="prev-frame" title="Previous frame">⏪</button>
          <button class="anim-btn" data-action="next-frame" title="Next frame">⏩</button>
        </div>
        <div class="anim-field">
          <label>Speed</label>
          <input type="range" data-field="speed" min="10" max="300" value="100" />
          <span data-display="speed">1.0x</span>
        </div>
        <div class="anim-field">
          <label>Time</label>
          <input type="range" data-field="time" min="0" max="100" value="0" />
          <span data-display="time">0.00s</span>
        </div>
      </div>

      <div class="anim-section">
        <div class="anim-section-title">Bones / Rig</div>
        <div class="anim-bone-list" style="max-height:200px;overflow-y:auto;">
          <div style="color:#555;font-size:11px;padding:8px;">No bones</div>
        </div>
      </div>

      <div class="anim-section">
        <div class="anim-section-title">Selected Bone</div>
        <div class="anim-bone-info" style="font-size:11px;color:#666;padding:4px;">None selected</div>
        <div class="anim-bone-controls" style="display:none;">
          <div style="display:flex;gap:4px;margin-bottom:6px;">
            <button class="anim-btn anim-gizmo-mode active" data-gizmo="rotate" title="Rotate bone">🔄 Rotate</button>
            <button class="anim-btn anim-gizmo-mode" data-gizmo="translate" title="Move bone">✥ Move</button>
            <button class="anim-btn" data-action="deselect-bone" title="Deselect bone">✖</button>
          </div>
          <div style="font-size:10px;color:#888;margin:4px 0 2px;">Rotation (degrees)</div>
          <div class="anim-field"><label>Rot X</label><input type="range" data-bone="rotX" min="-180" max="180" value="0" /><span data-bone-display="rotX">0°</span></div>
          <div class="anim-field"><label>Rot Y</label><input type="range" data-bone="rotY" min="-180" max="180" value="0" /><span data-bone-display="rotY">0°</span></div>
          <div class="anim-field"><label>Rot Z</label><input type="range" data-bone="rotZ" min="-180" max="180" value="0" /><span data-bone-display="rotZ">0°</span></div>
          <div style="font-size:10px;color:#888;margin:4px 0 2px;">Position offset</div>
          <div class="anim-field"><label>Pos X</label><input type="number" data-bone="posX" value="0" step="0.01" style="width:60px;background:#2a2a3a;border:1px solid #444;color:#ccc;padding:2px 4px;font-size:10px;border-radius:2px;" /></div>
          <div class="anim-field"><label>Pos Y</label><input type="number" data-bone="posY" value="0" step="0.01" style="width:60px;background:#2a2a3a;border:1px solid #444;color:#ccc;padding:2px 4px;font-size:10px;border-radius:2px;" /></div>
          <div class="anim-field"><label>Pos Z</label><input type="number" data-bone="posZ" value="0" step="0.01" style="width:60px;background:#2a2a3a;border:1px solid #444;color:#ccc;padding:2px 4px;font-size:10px;border-radius:2px;" /></div>
        </div>
      </div>

      <div class="anim-section">
        <div class="anim-section-title">Pose & Clip Creation</div>
        <div style="display:flex;gap:4px;margin-bottom:6px;">
          <button class="anim-btn" data-action="record-keyframe" title="Record current pose">🔴 Record Pose</button>
          <button class="anim-btn" data-action="clear-poses" title="Clear all poses">🗑 Clear</button>
        </div>
        <div class="anim-field">
          <label>Name</label>
          <input type="text" data-field="clip-name" value="NewClip" style="flex:1;background:#2a2a3a;border:1px solid #444;color:#ccc;padding:3px 6px;font-size:11px;border-radius:2px;" />
        </div>
        <div class="anim-pose-list" style="max-height:100px;overflow-y:auto;margin-bottom:4px;">
          <div style="color:#555;font-size:10px;padding:4px;">No poses recorded</div>
        </div>
        <button class="anim-btn" data-action="create-clip" style="width:100%;background:#1f6feb;border-color:#1f6feb;color:#fff;">Create Animation Clip</button>
      </div>

      <div class="anim-section">
        <div class="anim-section-title">Animation State Machine</div>
        <div class="anim-state-machine" style="min-height:60px;">
          <div style="color:#555;font-size:10px;padding:4px;">Define states and transitions between animation clips</div>
          <div class="anim-state-list" style="max-height:120px;overflow-y:auto;"></div>
          <button class="anim-btn" data-action="add-state" style="width:100%;margin-top:4px;font-size:10px;">+ Add State</button>
        </div>
      </div>

      <div class="anim-section">
        <div class="anim-section-title">Transitions</div>
        <div class="anim-transition-list" style="max-height:120px;overflow-y:auto;">
          <div style="color:#555;font-size:10px;padding:4px;">No transitions defined</div>
        </div>
        <button class="anim-btn" data-action="add-transition" style="width:100%;margin-top:4px;font-size:10px;">+ Add Transition</button>
      </div>

      <div class="anim-section">
        <div class="anim-section-title">Blend Settings</div>
        <div class="anim-field">
          <label>Crossfade Duration</label>
          <input type="range" data-field="crossfade" min="0" max="200" value="30" />
          <span data-display="crossfade">0.3s</span>
        </div>
      </div>

      <div class="anim-section">
        <div class="anim-section-title">⛓ IK Chains</div>
        <div class="anim-ik-list" style="max-height:140px;overflow-y:auto;margin-bottom:4px;">
          <div style="color:#555;font-size:10px;padding:4px;">No IK chains defined</div>
        </div>
        <button class="anim-btn" data-action="add-ik-chain" style="width:100%;font-size:10px;">+ Add IK Chain</button>
      </div>

      <div class="anim-section">
        <div class="anim-section-title">🌿 Blend Tree</div>
        <div style="font-size:10px;color:#666;margin-bottom:6px;">Blend between two clips by a parameter (0..1).</div>
        <div class="anim-field">
          <label>Clip A</label>
          <select data-field="bt-clip-a" style="flex:1;background:#2a2a3a;border:1px solid #444;color:#ccc;padding:2px 4px;font-size:10px;border-radius:2px;">
            <option value="-1">— none —</option>
          </select>
        </div>
        <div class="anim-field">
          <label>Clip B</label>
          <select data-field="bt-clip-b" style="flex:1;background:#2a2a3a;border:1px solid #444;color:#ccc;padding:2px 4px;font-size:10px;border-radius:2px;">
            <option value="-1">— none —</option>
          </select>
        </div>
        <div class="anim-field">
          <label>Blend</label>
          <input type="range" data-field="bt-param" min="0" max="100" value="0" />
          <span data-display="bt-param">0.0</span>
        </div>
        <button class="anim-btn" data-action="apply-blend-tree" style="width:100%;margin-top:4px;font-size:10px;background:#1f6feb;border-color:#1f6feb;color:#fff;">Apply Blend Tree</button>
      </div>

      <div class="anim-section">
        <div class="anim-section-title">🔔 Animation Events</div>
        <div class="anim-event-list" style="max-height:120px;overflow-y:auto;margin-bottom:4px;">
          <div style="color:#555;font-size:10px;padding:4px;">No events defined</div>
        </div>
        <button class="anim-btn" data-action="add-anim-event" style="width:100%;font-size:10px;">+ Add Event</button>
      </div>

      <div class="anim-section">
        <div class="anim-section-title">🔁 Retargeting</div>
        <div style="font-size:10px;color:#666;margin-bottom:6px;">Remap bone names to retarget a clip to a different rig.</div>
        <div class="anim-remap-list" style="max-height:120px;overflow-y:auto;margin-bottom:4px;">
          <div style="color:#555;font-size:10px;padding:4px;">No bone mappings</div>
        </div>
        <button class="anim-btn" data-action="add-bone-mapping" style="width:100%;margin-bottom:4px;font-size:10px;">+ Add Bone Mapping</button>
        <button class="anim-btn" data-action="retarget-clip" style="width:100%;font-size:10px;background:#2e7d32;border-color:#2e7d32;color:#fff;">Retarget Active Clip</button>
      </div>
    `;

    // ── Bottom: timeline placeholder with resize handle ──
    const timelineArea = document.createElement('div');
    timelineArea.style.cssText = 'height:180px;border-top:1px solid #333;flex-shrink:0;overflow:auto;position:relative;min-height:60px;max-height:80vh;';

    // Resize handle at top of timeline area
    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = 'position:absolute;top:0;left:0;right:0;height:5px;cursor:ns-resize;z-index:10;background:transparent;';
    resizeHandle.addEventListener('mouseenter', () => { resizeHandle.style.background = 'rgba(0,120,212,0.5)'; });
    resizeHandle.addEventListener('mouseleave', () => { if (!resizing) resizeHandle.style.background = 'transparent'; });

    let resizing = false;
    let startY = 0;
    let startHeight = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      resizing = true;
      startY = e.clientY;
      startHeight = timelineArea.offsetHeight;
      resizeHandle.style.background = 'rgba(0,120,212,0.7)';

      const onMove = (ev: MouseEvent) => {
        const dy = startY - ev.clientY;
        const newH = Math.max(60, Math.min(window.innerHeight * 0.8, startHeight + dy));
        timelineArea.style.height = newH + 'px';
      };
      const onUp = () => {
        resizing = false;
        resizeHandle.style.background = 'transparent';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    timelineArea.appendChild(resizeHandle);
    if (this.editor.timeline.container) {
      timelineArea.appendChild(this.editor.timeline.container);
    }
    this.container.appendChild(timelineArea);

    this.addStyles();
    this.initRenderer(viewportArea);
    this.bindEvents(topBar, sidePanel, viewportArea);

    return this.container;
  }

  private addStyles(): void {
    if (document.getElementById('anim-editor-styles')) return;
    const style = document.createElement('style');
    style.id = 'anim-editor-styles';
    style.textContent = `
      .anim-section { border-bottom:1px solid #333; padding-bottom:8px; }
      .anim-section-title { font-size:10px; font-weight:600; color:#888; text-transform:uppercase; margin-bottom:6px; letter-spacing:0.5px; }
      .anim-btn { padding:4px 10px; border-radius:3px; border:1px solid #444; background:#2a2a3a; color:#ccc; font-size:11px; cursor:pointer; transition:all 0.15s; white-space:nowrap; }
      .anim-btn:hover { background:#3a3a4a; }
      .anim-btn-toggle.active { border-color:#58a6ff; background:#1f6feb22; color:#58a6ff; }
      .anim-field { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
      .anim-field label { width:45px; font-size:10px; color:#999; flex-shrink:0; }
      .anim-field input[type="range"] { flex:1; height:3px; accent-color:#58a6ff; }
      .anim-field span[data-display] { width:40px; text-align:right; font-size:10px; color:#aaa; }
      .anim-clip-item { padding:5px 8px; border-radius:3px; cursor:pointer; font-size:11px; display:flex; align-items:center; gap:6px; transition:all 0.12s; }
      .anim-clip-item:hover { background:#333; }
      .anim-clip-item.active { background:#1f6feb33; border-left:2px solid #58a6ff; color:#fff; }
      .anim-bone-item { padding:3px 6px; cursor:pointer; font-size:10px; border-radius:2px; transition:all 0.1s; }
      .anim-bone-item:hover { background:#333; }
      .anim-bone-item.selected { background:#58a6ff22; color:#58a6ff; }
    `;
    document.head.appendChild(style);
  }

  private initRenderer(area: HTMLElement): void {
    if (!this.canvas3d) return;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas3d, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.orbit = new OrbitControls(this.camera, this.canvas3d);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.1;
    this.orbit.target.set(0, 1, 0);

    // Bone manipulation gizmo
    this.boneGizmo = new TransformControls(this.camera, this.canvas3d);
    this.boneGizmo.setSize(0.6);
    this.boneGizmo.setMode(this.boneGizmoMode);
    this.boneGizmo.setSpace('local');
    this.boneGizmo.addEventListener('dragging-changed', (event: any) => {
      if (this.orbit) this.orbit.enabled = !event.value;
    });
    this.boneGizmo.addEventListener('objectChange', () => {
      // Sync UI sliders with gizmo changes
      if (this.selectedBone) this.syncBoneControls();
    });
    this.scene.add(this.boneGizmo.getHelper());

    const resize = () => {
      if (!this.renderer || !this.canvas3d) return;
      const w = area.clientWidth;
      const h = area.clientHeight;
      if (w === 0 || h === 0) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(area);
    // Defer initial resize to ensure DOM layout is complete
    requestAnimationFrame(() => resize());
    // Fallback: container may not be in DOM yet when render() returns
    setTimeout(() => resize(), 150);

    this.startLoop();
  }

  private startLoop(): void {
    const loop = () => {
      this.animId = requestAnimationFrame(loop);
      const dt = this.clock.getDelta();

      if (this.mixer && this.isPlaying) {
        const prevTime = this._animPrevTime;
        this.mixer.update(dt * this.playbackSpeed);
        this._animPrevTime = this.mixer.time;
        this.updateTimeSlider();
        if (this.onionSkinning) this.updateOnionSkins();
        this._fireAnimEvents(prevTime, this.mixer.time);
      }
      // Solve IK chains every frame (even when paused, for interactive posing)
      if (this.ikChains.length > 0 && this.model) this._solveAllIK();
      this.orbit?.update();
      this.renderer?.render(this.scene, this.camera);
    };
    loop();
  }

  /* ─── Model Loading ──────────────────────────────────── */

  private loadModelFromFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf,.bin,.png,.jpg,.jpeg';
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) return;
      try {
        const model = await this.editor.engine.assets.loadModelFromFiles(files);
        this.setModel(model);
      } catch (e) {
        console.error('Failed to load model:', e);
      }
    };
    input.click();
  }

  private loadModelFromScene(): void {
    const selected = this.editor.state.selectedObject;
    if (!selected) return;

    // Find the root group with geometry
    let root: THREE.Object3D = selected;
    while (root.parent && root.parent !== this.editor.scene) {
      root = root.parent;
    }

    // Use SkeletonUtils.clone to properly rebind SkinnedMesh skeletons
    const cloned = skeletonClone(root);
    const bones: THREE.Bone[] = [];
    const meshes: THREE.Mesh[] = [];
    const clips: THREE.AnimationClip[] = [];

    cloned.traverse(child => {
      if (child instanceof THREE.Bone) bones.push(child);
      if (child instanceof THREE.Mesh) meshes.push(child);
    });

    // Try to find animations from the original root
    if ((root as any).animations && (root as any).animations.length > 0) {
      clips.push(...(root as any).animations);
    }
    // Also check Object3D.animations (standard property)
    if (root.animations && root.animations.length > 0 && clips.length === 0) {
      clips.push(...root.animations);
    }

    this.setModel({
      scene: cloned as THREE.Group,
      animations: clips,
      bones,
      meshes,
      materials: [],
      textures: [],
    });
  }

  private setModel(data: LoadedModel): void {
    // Clear previous
    if (this.model) {
      this.scene.remove(this.model);
    }
    if (this.skeletonHelper) {
      this.scene.remove(this.skeletonHelper);
      this.skeletonHelper = null;
    }
    this.mixer = null;
    this.currentAction = null;
    this.clips = [];
    this.selectedBone = null;
    this.isPlaying = false;

    // Add model
    this.model = data.scene;
    this.scene.add(this.model);

    // Center and fit model
    const box = new THREE.Box3().setFromObject(this.model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    this.model.position.sub(center);
    this.model.position.y += size.y / 2;

    if (this.orbit) {
      this.orbit.target.set(0, size.y / 2, 0);
    }
    const dist = maxDim * 2;
    this.camera.position.set(dist * 0.6, size.y * 0.8, dist * 0.6);
    this.camera.lookAt(0, size.y / 2, 0);

    // Skeleton helper
    if (data.bones.length > 0) {
      this.skeletonHelper = new THREE.SkeletonHelper(this.model);
      (this.skeletonHelper.material as THREE.LineBasicMaterial).linewidth = 2;
      this.skeletonHelper.visible = this.showSkeleton;
      this.scene.add(this.skeletonHelper);
    }

    // Animation clips
    this.clips = data.animations;
    if (this.clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(this.model);
    }

    // Update UI
    this.updateClipList();
    this.updateBoneList();
    this.updateEmptyOverlay();
  }

  /* ─── Animation Controls ─────────────────────────────── */

  private playClip(index: number): void {
    if (!this.mixer || index < 0 || index >= this.clips.length) return;
    const container = this.container;
    if (!container) return;

    if (this.currentAction) {
      this.currentAction.stop();
    }
    const clip = this.clips[index];
    this.currentAction = this.mixer.clipAction(clip);
    this.currentAction.reset().play();
    this.isPlaying = true;

    // Update time slider max
    const timeSlider = container.querySelector('[data-field="time"]') as HTMLInputElement | null;
    if (timeSlider) {
      timeSlider.max = String(Math.round(clip.duration * 100));
    }

    this.updateClipListActiveState(index);
  }

  private togglePlay(): void {
    if (!this.currentAction) {
      if (this.clips.length > 0) this.playClip(0);
      return;
    }
    const container = this.container;
    if (!container) return;
    this.isPlaying = !this.isPlaying;
    this.currentAction.paused = !this.isPlaying;

    const btn = container.querySelector('[data-action="play"]');
    if (btn) btn.textContent = this.isPlaying ? '⏸ Pause' : '▶️ Play';
  }

  private stopPlayback(): void {
    const container = this.container;
    if (!container) return;
    if (this.currentAction) {
      this.currentAction.stop();
      this.currentAction = null;
    }
    this.isPlaying = false;
    if (this.mixer) this.mixer.setTime(0);

    const btn = container.querySelector('[data-action="play"]');
    if (btn) btn.textContent = '▶️ Play';
  }

  private stepFrame(dir: number): void {
    if (!this.mixer || !this.currentAction) return;
    this.isPlaying = false;
    this.currentAction.paused = true;
    const frameTime = 1 / 30; // 30fps
    this.mixer.setTime(Math.max(0, this.mixer.time + frameTime * dir));
    this.updateTimeSlider();
  }

  private seekTo(t: number): void {
    if (!this.mixer) return;
    this.mixer.setTime(t);
  }

  private updateTimeSlider(): void {
    if (!this.mixer) return;
    const container = this.container;
    if (!container) return;
    const timeSlider = container.querySelector('[data-field="time"]') as HTMLInputElement | null;
    const timeDisplay = container.querySelector('[data-display="time"]') as HTMLElement | null;
    if (timeSlider) {
      timeSlider.value = String(Math.round(this.mixer.time * 100));
    }
    if (timeDisplay) {
      timeDisplay.textContent = this.mixer.time.toFixed(2) + 's';
    }
  }

  /* ─── UI Updates ─────────────────────────────────────── */

  /** Add a clip created externally (e.g. from timeline) */
  addExternalClip(clip: THREE.AnimationClip): void {
    this.clips.push(clip);
    if (!this.mixer && this.model) {
      this.mixer = new THREE.AnimationMixer(this.model);
    }
    this.updateClipList();
  }

  private updateClipList(): void {
    const container = this.container;
    if (!container) return;
    const list = container.querySelector('.anim-clip-list');
    if (!list) return;

    if (this.clips.length === 0) {
      list.innerHTML = '<div style="color:#555;font-size:11px;padding:8px;">No clips available</div>';
      return;
    }

    list.innerHTML = '';
    this.clips.forEach((clip, i) => {
      const item = document.createElement('div');
      item.className = 'anim-clip-item';
      item.dataset.index = String(i);
      item.style.cssText = 'display:flex;align-items:center;gap:6px;';
      
      const info = document.createElement('span');
      info.style.cssText = 'flex:1;cursor:pointer;display:flex;align-items:center;gap:6px;';
      info.innerHTML = `<span>🎞️</span><span style="flex:1;">${clip.name || `Clip ${i}`}</span><span style="color:#666;font-size:10px;">${clip.duration.toFixed(1)}s</span>`;
      info.addEventListener('click', () => this.playClip(i));
      info.addEventListener('dblclick', () => {
        const newName = prompt('Rename clip:', clip.name);
        if (newName) { clip.name = newName; this.updateClipList(); }
      });
      item.appendChild(info);

      const tlBtn = document.createElement('button');
      tlBtn.textContent = '📊';
      tlBtn.title = 'Insert clip into timeline';
      tlBtn.style.cssText = 'background:#1f6feb;border:1px solid #3a7bd5;color:#fff;cursor:pointer;padding:2px 6px;border-radius:3px;font-size:10px;flex-shrink:0;';
      tlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.insertClipToTimeline(clip);
      });
      item.appendChild(tlBtn);

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.title = 'Delete clip';
      delBtn.style.cssText = 'background:none;border:none;color:#e74c3c;cursor:pointer;font-size:10px;flex-shrink:0;padding:2px;';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.currentAction?.getClip() === clip) {
          this.stopPlayback();
        }
        this.clips.splice(i, 1);
        this.updateClipList();
      });
      item.appendChild(delBtn);

      list.appendChild(item);
    });
  }

  /** Insert an AnimationClip's tracks into the editor timeline as keyframe tracks */
  private insertClipToTimeline(clip: THREE.AnimationClip): void {
    const timeline = this.editor.timeline;
    if (!timeline) return;

    const trackColors: Record<string, string> = {
      'position': '#e74c3c',
      'quaternion': '#2ecc71',
      'rotation': '#2ecc71',
      'scale': '#3498db',
    };

    const tracks: Array<{
      name: string;
      property: string;
      color: string;
      keyframes: Array<{ time: number; value: number }>;
      objectUuid?: string;
    }> = [];

    for (const track of clip.tracks) {
      // Track name format: "boneName.property" e.g. "Hips.position" or "Spine.quaternion"
      const dotIdx = track.name.lastIndexOf('.');
      const boneName = dotIdx >= 0 ? track.name.substring(0, dotIdx) : track.name;
      const propName = dotIdx >= 0 ? track.name.substring(dotIdx + 1) : 'value';

      const times = track.times;
      const values = track.values;
      const valueSize = values.length / times.length;

      // Find matching model bone uuid
      let boneUuid: string | undefined;
      if (this.model) {
        this.model.traverse(child => {
          if (child.name === boneName) boneUuid = child.uuid;
        });
      }

      // Create separate axis tracks for vector/quaternion data
      const axes = valueSize === 4 ? ['x', 'y', 'z', 'w'] :
                   valueSize === 3 ? ['x', 'y', 'z'] :
                   valueSize === 1 ? [''] : [];

      for (let axis = 0; axis < Math.min(valueSize, 4); axis++) {
        const axisName = axes[axis] || '';
        const keyframes: Array<{ time: number; value: number }> = [];
        for (let t = 0; t < times.length; t++) {
          keyframes.push({ time: times[t], value: values[t * valueSize + axis] });
        }

        const baseColor = trackColors[propName] || '#e67e22';
        const trackDef = {
          name: `${boneName} ${propName}.${axisName}`,
          property: `${propName}.${axisName}`,
          color: baseColor,
          keyframes,
          objectUuid: boneUuid,
        };
        tracks.push(trackDef);
      }
    }

    // Use public API to add tracks
    timeline.setDuration(clip.duration);
    timeline.addTracks(tracks);

    this.editor.statusBar?.setMessage(`Inserted ${tracks.length} tracks from "${clip.name}" into timeline`);
  }

  private updateClipListActiveState(activeIndex: number): void {
    const container = this.container;
    if (!container) return;
    container.querySelectorAll('.anim-clip-item').forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
    });
  }

  private updateBoneList(): void {
    const container = this.container;
    if (!container) return;
    const list = container.querySelector('.anim-bone-list');
    if (!list) return;

    const bones: THREE.Bone[] = [];
    this.model?.traverse(child => {
      if (child instanceof THREE.Bone) bones.push(child);
    });

    if (bones.length === 0) {
      list.innerHTML = '<div style="color:#555;font-size:11px;padding:8px;">No bones</div>';
      return;
    }

    list.innerHTML = '';
    bones.forEach(bone => {
      const item = document.createElement('div');
      item.className = 'anim-bone-item';
      item.textContent = `🦴 ${bone.name || 'Bone'}`;
      item.addEventListener('click', () => this.selectBone(bone));
      list.appendChild(item);
    });
  }

  private selectBone(bone: THREE.Bone): void {
    const container = this.container;
    if (!container) return;
    this.selectedBone = bone;

    // Highlight in bone list
    container.querySelectorAll('.anim-bone-item').forEach(el => {
      el.classList.toggle('selected', el.textContent?.includes(bone.name) ?? false);
    });

    // Show bone highlight sphere
    if (this.boneHighlight) {
      const worldPos = new THREE.Vector3();
      bone.getWorldPosition(worldPos);
      this.boneHighlight.position.copy(worldPos);
      this.boneHighlight.visible = true;
    }

    // Attach gizmo to selected bone
    if (this.boneGizmo) {
      this.boneGizmo.attach(bone);
    }

    // Update bone info
    const info = container.querySelector('.anim-bone-info');
    if (info) {
      const pos = bone.position;
      const rot = bone.rotation;
      info.innerHTML = `
        <div style="margin-bottom:4px;color:#58a6ff;font-weight:600;">${bone.name || 'Bone'}</div>
        <div>Position: ${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}</div>
        <div>Rotation: ${THREE.MathUtils.radToDeg(rot.x).toFixed(1)}°, ${THREE.MathUtils.radToDeg(rot.y).toFixed(1)}°, ${THREE.MathUtils.radToDeg(rot.z).toFixed(1)}°</div>
        <div style="margin-top:4px;color:#666;">Children: ${bone.children.length}</div>
      `;
    }

    // Show and populate bone transform controls
    const controls = container.querySelector('.anim-bone-controls') as HTMLElement;
    if (controls) {
      controls.style.display = 'block';

      const setSlider = (name: string, val: number) => {
        const input = controls.querySelector(`[data-bone="${name}"]`) as HTMLInputElement;
        const display = controls.querySelector(`[data-bone-display="${name}"]`) as HTMLElement;
        if (input) input.value = String(Math.round(val));
        if (display) display.textContent = Math.round(val) + '°';
      };
      const setNumber = (name: string, val: number) => {
        const input = controls.querySelector(`[data-bone="${name}"]`) as HTMLInputElement;
        if (input) input.value = val.toFixed(3);
      };

      setSlider('rotX', THREE.MathUtils.radToDeg(bone.rotation.x));
      setSlider('rotY', THREE.MathUtils.radToDeg(bone.rotation.y));
      setSlider('rotZ', THREE.MathUtils.radToDeg(bone.rotation.z));
      setNumber('posX', bone.position.x);
      setNumber('posY', bone.position.y);
      setNumber('posZ', bone.position.z);
    }
  }

  /** Sync UI sliders with current bone transform (called after gizmo drag) */
  private syncBoneControls(): void {
    if (!this.selectedBone) return;
    const bone = this.selectedBone;
    const container = this.container;
    if (!container) return;
    const controls = container.querySelector('.anim-bone-controls') as HTMLElement;
    if (!controls) return;

    const setSlider = (name: string, val: number) => {
      const input = controls.querySelector(`[data-bone="${name}"]`) as HTMLInputElement;
      const display = controls.querySelector(`[data-bone-display="${name}"]`) as HTMLElement;
      if (input) input.value = String(Math.round(val));
      if (display) display.textContent = Math.round(val) + '°';
    };
    const setNumber = (name: string, val: number) => {
      const input = controls.querySelector(`[data-bone="${name}"]`) as HTMLInputElement;
      if (input) input.value = val.toFixed(3);
    };

    setSlider('rotX', THREE.MathUtils.radToDeg(bone.rotation.x));
    setSlider('rotY', THREE.MathUtils.radToDeg(bone.rotation.y));
    setSlider('rotZ', THREE.MathUtils.radToDeg(bone.rotation.z));
    setNumber('posX', bone.position.x);
    setNumber('posY', bone.position.y);
    setNumber('posZ', bone.position.z);

    // Update bone info text
    const info = container.querySelector('.anim-bone-info');
    if (info) {
      const pos = bone.position;
      const rot = bone.rotation;
      info.innerHTML = `
        <div style="margin-bottom:4px;color:#58a6ff;font-weight:600;">${bone.name || 'Bone'}</div>
        <div>Position: ${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}</div>
        <div>Rotation: ${THREE.MathUtils.radToDeg(rot.x).toFixed(1)}°, ${THREE.MathUtils.radToDeg(rot.y).toFixed(1)}°, ${THREE.MathUtils.radToDeg(rot.z).toFixed(1)}°</div>
        <div style="margin-top:4px;color:#666;">Children: ${bone.children.length}</div>
      `;
    }

    // Update highlight sphere position
    if (this.boneHighlight) {
      const wp = new THREE.Vector3();
      bone.getWorldPosition(wp);
      this.boneHighlight.position.copy(wp);
    }
  }

  private updateEmptyOverlay(): void {
    const container = this.container;
    if (!container) return;
    const overlay = container.querySelector('.anim-empty-overlay') as HTMLElement | null;
    if (overlay) {
      overlay.style.display = this.model ? 'none' : 'flex';
    }
  }

  /* ─── Event Binding ──────────────────────────────────── */

  private bindEvents(topBar: HTMLElement, sidePanel: HTMLElement, viewportArea: HTMLElement): void {
    // Top bar buttons
    topBar.querySelector('[data-action="load-file"]')?.addEventListener('click', () => this.loadModelFromFile());
    topBar.querySelector('[data-action="load-scene"]')?.addEventListener('click', () => this.loadModelFromScene());

    topBar.querySelector('[data-action="toggle-skeleton"]')?.addEventListener('click', (e) => {
      this.showSkeleton = !this.showSkeleton;
      if (this.skeletonHelper) this.skeletonHelper.visible = this.showSkeleton;
      (e.currentTarget as HTMLElement).classList.toggle('active', this.showSkeleton);
    });

    topBar.querySelector('[data-action="toggle-wireframe"]')?.addEventListener('click', (e) => {
      const active = (e.currentTarget as HTMLElement).classList.toggle('active');
      this.model?.traverse(child => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.wireframe = active;
        }
      });
    });

    topBar.querySelector('[data-action="toggle-onion"]')?.addEventListener('click', (e) => {
      this.onionSkinning = (e.currentTarget as HTMLElement).classList.toggle('active');
      this.updateOnionSkins();
    });

    topBar.querySelector('[data-action="export-clip"]')?.addEventListener('click', () => this.exportCurrentClip());

    // Playback controls
    sidePanel.querySelector('[data-action="play"]')?.addEventListener('click', () => this.togglePlay());
    sidePanel.querySelector('[data-action="stop"]')?.addEventListener('click', () => this.stopPlayback());
    sidePanel.querySelector('[data-action="prev-frame"]')?.addEventListener('click', () => this.stepFrame(-1));
    sidePanel.querySelector('[data-action="next-frame"]')?.addEventListener('click', () => this.stepFrame(1));

    // Speed slider
    const speedSlider = sidePanel.querySelector('[data-field="speed"]') as HTMLInputElement | null;
    const speedDisplay = sidePanel.querySelector('[data-display="speed"]') as HTMLElement | null;
    speedSlider?.addEventListener('input', () => {
      this.playbackSpeed = parseInt(speedSlider.value) / 100;
      if (speedDisplay) speedDisplay.textContent = this.playbackSpeed.toFixed(1) + 'x';
    });

    // Time slider
    const timeSlider = sidePanel.querySelector('[data-field="time"]') as HTMLInputElement | null;
    const timeDisplay = sidePanel.querySelector('[data-display="time"]') as HTMLElement | null;
    timeSlider?.addEventListener('input', () => {
      const t = parseInt(timeSlider.value) / 100;
      this.seekTo(t);
      if (timeDisplay) timeDisplay.textContent = t.toFixed(2) + 's';
    });

    // Bone picking in 3D viewport
    this.canvas3d?.addEventListener('click', (e) => {
      if (!this.model) return;
      const rect = this.canvas3d!.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);

      // Try to pick bones (via skeleton helper lines or nearby geometry)
      const bones: THREE.Bone[] = [];
      this.model.traverse(child => {
        if (child instanceof THREE.Bone) bones.push(child);
      });

      let closestBone: THREE.Bone | null = null;
      let closestDist = Infinity;
      const worldPos = new THREE.Vector3();

      for (const bone of bones) {
        bone.getWorldPosition(worldPos);
        const screenPos = worldPos.clone().project(this.camera);
        const dx = screenPos.x - this.mouse.x;
        const dy = screenPos.y - this.mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.05 && dist < closestDist) {
          closestDist = dist;
          closestBone = bone;
        }
      }

      if (closestBone) {
        this.selectBone(closestBone);
      }
    });

    // State machine controls
    sidePanel.querySelector('[data-action="add-state"]')?.addEventListener('click', () => {
      const clipName = this.clips.length > 0 ? this.clips[0].name : '';
      this.animStates.push({ name: `State_${this.animStates.length}`, clipName, loop: true, speed: 1.0 });
      this.updateStateList(sidePanel);
    });

    sidePanel.querySelector('[data-action="add-transition"]')?.addEventListener('click', () => {
      if (this.animStates.length < 2) return;
      this.animTransitions.push({
        from: this.animStates[0].name,
        to: this.animStates.length > 1 ? this.animStates[1].name : this.animStates[0].name,
        condition: 'auto',
        duration: this.crossfadeDuration,
      });
      this.updateTransitionList(sidePanel);
    });

    // Crossfade slider
    const crossfadeSlider = sidePanel.querySelector('[data-field="crossfade"]') as HTMLInputElement | null;
    const crossfadeDisplay = sidePanel.querySelector('[data-display="crossfade"]') as HTMLElement | null;
    crossfadeSlider?.addEventListener('input', () => {
      this.crossfadeDuration = parseInt(crossfadeSlider.value) / 100;
      if (crossfadeDisplay) crossfadeDisplay.textContent = this.crossfadeDuration.toFixed(1) + 's';
    });

    // Bone rotation sliders
    const boneControls = sidePanel.querySelector('.anim-bone-controls');
    if (boneControls) {
      ['rotX', 'rotY', 'rotZ'].forEach(axis => {
        const input = boneControls.querySelector(`[data-bone="${axis}"]`) as HTMLInputElement;
        const display = boneControls.querySelector(`[data-bone-display="${axis}"]`) as HTMLElement;
        input?.addEventListener('input', () => {
          if (!this.selectedBone) return;
          const deg = parseFloat(input.value);
          if (display) display.textContent = Math.round(deg) + '°';
          const rad = THREE.MathUtils.degToRad(deg);
          if (axis === 'rotX') this.selectedBone.rotation.x = rad;
          if (axis === 'rotY') this.selectedBone.rotation.y = rad;
          if (axis === 'rotZ') this.selectedBone.rotation.z = rad;
        });
      });
      ['posX', 'posY', 'posZ'].forEach(axis => {
        const input = boneControls.querySelector(`[data-bone="${axis}"]`) as HTMLInputElement;
        input?.addEventListener('change', () => {
          if (!this.selectedBone) return;
          const val = parseFloat(input.value) || 0;
          if (axis === 'posX') this.selectedBone.position.x = val;
          if (axis === 'posY') this.selectedBone.position.y = val;
          if (axis === 'posZ') this.selectedBone.position.z = val;
        });
      });

      // Gizmo mode toggle
      boneControls.querySelectorAll('.anim-gizmo-mode').forEach(btn => {
        btn.addEventListener('click', () => {
          boneControls.querySelectorAll('.anim-gizmo-mode').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const mode = (btn as HTMLElement).dataset.gizmo as 'rotate' | 'translate';
          this.boneGizmoMode = mode;
          if (this.boneGizmo) this.boneGizmo.setMode(mode);
        });
      });

      // Deselect bone
      boneControls.querySelector('[data-action="deselect-bone"]')?.addEventListener('click', () => {
        this.selectedBone = null;
        if (this.boneGizmo) this.boneGizmo.detach();
        if (this.boneHighlight) this.boneHighlight.visible = false;
        const container = this.container;
        if (!container) return;
        const info = container.querySelector('.anim-bone-info');
        if (info) info.innerHTML = '<div style="color:#666;font-size:11px;padding:4px;">None selected</div>';
        (boneControls as HTMLElement).style.display = 'none';
      });
    }

    // Record pose keyframe
    sidePanel.querySelector('[data-action="record-keyframe"]')?.addEventListener('click', () => {
      this.recordPoseKeyframe();
      this.updatePoseList(sidePanel);
    });

    // Clear poses
    sidePanel.querySelector('[data-action="clear-poses"]')?.addEventListener('click', () => {
      this.poseKeyframes = [];
      this.updatePoseList(sidePanel);
    });

    // Create clip from poses
    sidePanel.querySelector('[data-action="create-clip"]')?.addEventListener('click', () => {
      const nameInput = sidePanel.querySelector('[data-field="clip-name"]') as HTMLInputElement;
      const clipName = nameInput?.value || 'NewClip';
      this.createClipFromPoses(clipName);
    });

    // ── IK Chains ──
    sidePanel.querySelector('[data-action="add-ik-chain"]')?.addEventListener('click', () => {
      const bones: string[] = [];
      this.model?.traverse(c => { if (c instanceof THREE.Bone && c.name) bones.push(c.name); });
      const tipName = bones[bones.length - 1] ?? '';
      const id = this.ikNextId++;
      const targetPos = new THREE.Vector3(0, 1, 0.5);
      this.ikChains.push({ id, tipBoneName: tipName, chainLength: 2, targetPos, enabled: true });
      // Create a draggable target sphere in the viewport
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff4400, depthTest: false }),
      );
      sphere.position.copy(targetPos);
      sphere.renderOrder = 1000;
      sphere.userData._ikId = id;
      this.scene.add(sphere);
      this.ikTargetObjects.set(id, sphere);
      this._refreshIKList(sidePanel);
    });

    // IK target drag in viewport (pointer events)
    let _ikDragId: number | null = null;
    this.canvas3d?.addEventListener('pointerdown', (e) => {
      if (!this.model || e.button !== 0) return;
      const rect = this.canvas3d!.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(new THREE.Vector2(mx, my), this.camera);
      for (const [id, sphere] of this.ikTargetObjects) {
        const hits = this.raycaster.intersectObject(sphere);
        if (hits.length > 0) { _ikDragId = id; e.stopPropagation(); break; }
      }
    });
    this.canvas3d?.addEventListener('pointermove', (e) => {
      if (_ikDragId === null) return;
      const sphere = this.ikTargetObjects.get(_ikDragId);
      const chain = this.ikChains.find(c => c.id === _ikDragId);
      if (!sphere || !chain) return;
      const rect = this.canvas3d!.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(new THREE.Vector2(mx, my), this.camera);
      // Move target on a plane perpendicular to the camera
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        this.camera.getWorldDirection(new THREE.Vector3()),
        chain.targetPos,
      );
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(plane, hit)) {
        chain.targetPos.copy(hit);
        sphere.position.copy(hit);
      }
    });
    this.canvas3d?.addEventListener('pointerup', () => { _ikDragId = null; });

    // ── Blend Tree ──
    const populateBlendClipSelects = () => {
      ['bt-clip-a', 'bt-clip-b'].forEach(field => {
        const sel = sidePanel.querySelector(`[data-field="${field}"]`) as HTMLSelectElement | null;
        if (!sel) return;
        sel.innerHTML = '<option value="-1">— none —</option>' +
          this.clips.map((c, i) => `<option value="${i}">${c.name}</option>`).join('');
      });
    };
    populateBlendClipSelects();

    const btParam = sidePanel.querySelector('[data-field="bt-param"]') as HTMLInputElement | null;
    const btParamDisp = sidePanel.querySelector('[data-display="bt-param"]') as HTMLElement | null;
    btParam?.addEventListener('input', () => {
      const v = parseInt(btParam.value) / 100;
      if (btParamDisp) btParamDisp.textContent = v.toFixed(2);
      if (this.blendTree) {
        this.blendTree.param = v;
        this._applyBlendTree();
      }
    });

    sidePanel.querySelector('[data-action="apply-blend-tree"]')?.addEventListener('click', () => {
      const selA = sidePanel.querySelector('[data-field="bt-clip-a"]') as HTMLSelectElement | null;
      const selB = sidePanel.querySelector('[data-field="bt-clip-b"]') as HTMLSelectElement | null;
      const iA = selA ? parseInt(selA.value) : -1;
      const iB = selB ? parseInt(selB.value) : -1;
      if (iA < 0 || iB < 0 || iA >= this.clips.length || iB >= this.clips.length) return;
      this.blendTree = { clipIndexA: iA, clipIndexB: iB, param: parseInt(btParam?.value ?? '0') / 100 };
      this._applyBlendTree();
    });

    // ── Animation Events ──
    sidePanel.querySelector('[data-action="add-anim-event"]')?.addEventListener('click', () => {
      const clipName = this.currentAction ? this.currentAction.getClip().name : (this.clips[0]?.name ?? '');
      const time = this.mixer ? this.mixer.time : 0;
      this.animEvents.push({ id: this.animEvents.length, clipName, time: parseFloat(time.toFixed(3)), eventName: 'onEvent' });
      this._refreshAnimEventList(sidePanel);
    });

    // ── Retargeting ──
    sidePanel.querySelector('[data-action="add-bone-mapping"]')?.addEventListener('click', () => {
      this.retargetBoneMap.set('sourceBone', 'targetBone');
      this._refreshRemapList(sidePanel);
    });

    sidePanel.querySelector('[data-action="retarget-clip"]')?.addEventListener('click', () => {
      if (!this.currentAction) { alert('No active clip selected.'); return; }
      const clip = this.currentAction.getClip();
      const retargeted = this._retargetClip(clip, this.retargetBoneMap);
      this.clips.push(retargeted);
      if (!this.mixer && this.model) this.mixer = new THREE.AnimationMixer(this.model);
      this.updateClipList();
      populateBlendClipSelects();
      this.editor.statusBar?.setMessage(`Retargeted clip → "${retargeted.name}"`);
    });
  }

  // ── Pose Recording & Clip Creation ──

  private recordPoseKeyframe(): void {
    if (!this.model) return;

    const bones = new Map<string, { position: THREE.Vector3; rotation: THREE.Euler }>();
    this.model.traverse(child => {
      if (child instanceof THREE.Bone && child.name) {
        bones.set(child.name, {
          position: child.position.clone(),
          rotation: child.rotation.clone(),
        });
      }
    });

    // Time = index / frameRate (each keyframe is 1 second apart by default)
    const time = this.poseKeyframes.length;
    this.poseKeyframes.push({ time, bones });
  }

  private createClipFromPoses(name: string): void {
    if (this.poseKeyframes.length < 1 || !this.model) return;

    const tracks: THREE.KeyframeTrack[] = [];
    const allBoneNames = new Set<string>();

    // Collect all bone names from all keyframes
    for (const kf of this.poseKeyframes) {
      for (const boneName of kf.bones.keys()) {
        allBoneNames.add(boneName);
      }
    }

    for (const boneName of allBoneNames) {
      const times: number[] = [];
      const posValues: number[] = [];
      const rotValues: number[] = [];

      for (const kf of this.poseKeyframes) {
        const data = kf.bones.get(boneName);
        if (!data) continue;

        times.push(kf.time);
        posValues.push(data.position.x, data.position.y, data.position.z);

        // Convert Euler to Quaternion for smooth interpolation
        const q = new THREE.Quaternion().setFromEuler(data.rotation);
        rotValues.push(q.x, q.y, q.z, q.w);
      }

      if (times.length > 0) {
        tracks.push(new THREE.VectorKeyframeTrack(`${boneName}.position`, times, posValues));
        tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, rotValues));
      }
    }

    if (tracks.length === 0) return;

    const duration = this.poseKeyframes.length > 1 ? this.poseKeyframes[this.poseKeyframes.length - 1].time : 1;
    const clip = new THREE.AnimationClip(name, duration, tracks);
    this.clips.push(clip);

    // Setup mixer if not already
    if (!this.mixer && this.model) {
      this.mixer = new THREE.AnimationMixer(this.model);
    }

    this.updateClipList();
  }

  private updatePoseList(sidePanel: HTMLElement): void {
    const list = sidePanel.querySelector('.anim-pose-list');
    if (!list) return;

    if (this.poseKeyframes.length === 0) {
      list.innerHTML = '<div style="color:#555;font-size:10px;padding:4px;">No poses recorded</div>';
      return;
    }

    list.innerHTML = '';
    this.poseKeyframes.forEach((kf, i) => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 6px;font-size:10px;border-radius:2px;background:#1e1e1e;margin-bottom:1px;';
      item.innerHTML = `
        <span style="color:#f0883e;">◆</span>
        <span>Pose ${i + 1}</span>
        <span style="flex:1;"></span>
        <span style="color:#666;">${kf.bones.size} bones</span>
        <span style="color:#666;">t=${kf.time}s</span>
        <button style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:9px;" data-del-pose="${i}">✕</button>
      `;
      item.querySelector(`[data-del-pose="${i}"]`)?.addEventListener('click', () => {
        this.poseKeyframes.splice(i, 1);
        // Re-number times
        this.poseKeyframes.forEach((p, idx) => { p.time = idx; });
        this.updatePoseList(sidePanel);
      });
      list.appendChild(item);
    });
  }

  // ── State Machine UI ──

  private updateStateList(sidePanel: HTMLElement): void {
    const list = sidePanel.querySelector('.anim-state-list');
    if (!list) return;
    list.innerHTML = '';

    for (let i = 0; i < this.animStates.length; i++) {
      const state = this.animStates[i];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 4px;background:#1e1e1e;border-radius:3px;margin-bottom:2px;border-left:2px solid #2ecc71;';
      row.innerHTML = `
        <input type="text" value="${state.name}" style="flex:1;background:#111;border:1px solid #333;color:#ccc;padding:2px 4px;font-size:10px;border-radius:2px;min-width:0;" data-state-name="${i}" />
        <select style="background:#111;border:1px solid #333;color:#ccc;font-size:9px;padding:1px;border-radius:2px;" data-state-clip="${i}">
          ${this.clips.map(c => `<option value="${c.name}" ${c.name === state.clipName ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
        <label style="font-size:9px;color:#888;display:flex;align-items:center;gap:2px;"><input type="checkbox" ${state.loop ? 'checked' : ''} data-state-loop="${i}" />Loop</label>
        <button style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:10px;" data-state-del="${i}">✕</button>
      `;

      row.querySelector(`[data-state-name="${i}"]`)?.addEventListener('change', (e) => {
        state.name = (e.target as HTMLInputElement).value;
      });
      row.querySelector(`[data-state-clip="${i}"]`)?.addEventListener('change', (e) => {
        state.clipName = (e.target as HTMLSelectElement).value;
      });
      row.querySelector(`[data-state-loop="${i}"]`)?.addEventListener('change', (e) => {
        state.loop = (e.target as HTMLInputElement).checked;
      });
      row.querySelector(`[data-state-del="${i}"]`)?.addEventListener('click', () => {
        this.animStates.splice(i, 1);
        this.updateStateList(sidePanel);
      });

      // Click to preview this state's animation
      row.addEventListener('dblclick', () => {
        const clipIndex = this.clips.findIndex(c => c.name === state.clipName);
        if (clipIndex >= 0) this.playClip(clipIndex);
      });

      list.appendChild(row);
    }
  }

  private updateTransitionList(sidePanel: HTMLElement): void {
    const list = sidePanel.querySelector('.anim-transition-list');
    if (!list) return;
    list.innerHTML = '';

    if (this.animTransitions.length === 0) {
      list.innerHTML = '<div style="color:#555;font-size:10px;padding:4px;">No transitions defined</div>';
      return;
    }

    for (let i = 0; i < this.animTransitions.length; i++) {
      const trans = this.animTransitions[i];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 4px;background:#1e1e1e;border-radius:3px;margin-bottom:2px;border-left:2px solid #3498db;font-size:10px;';
      row.innerHTML = `
        <select style="background:#111;border:1px solid #333;color:#ccc;font-size:9px;padding:1px;border-radius:2px;flex:1;" data-trans-from="${i}">
          ${this.animStates.map(s => `<option value="${s.name}" ${s.name === trans.from ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
        <span style="color:#888;">→</span>
        <select style="background:#111;border:1px solid #333;color:#ccc;font-size:9px;padding:1px;border-radius:2px;flex:1;" data-trans-to="${i}">
          ${this.animStates.map(s => `<option value="${s.name}" ${s.name === trans.to ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
        <button style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:10px;" data-trans-del="${i}">✕</button>
      `;

      row.querySelector(`[data-trans-from="${i}"]`)?.addEventListener('change', (e) => {
        trans.from = (e.target as HTMLSelectElement).value;
      });
      row.querySelector(`[data-trans-to="${i}"]`)?.addEventListener('change', (e) => {
        trans.to = (e.target as HTMLSelectElement).value;
      });
      row.querySelector(`[data-trans-del="${i}"]`)?.addEventListener('click', () => {
        this.animTransitions.splice(i, 1);
        this.updateTransitionList(sidePanel);
      });

      list.appendChild(row);
    }
  }

  // ── Onion Skinning ──

  private updateOnionSkins(): void {
    // Remove existing ghosts
    for (const ghost of this.onionGhosts) {
      this.scene.remove(ghost);
    }
    this.onionGhosts = [];

    if (!this.onionSkinning || !this.model || !this.mixer || !this.currentAction) return;

    const clip = this.currentAction.getClip();
    const currentTime = this.mixer.time;

    // Show ghost frames at -2, -1, +1, +2 frames from current
    const frameTime = 1 / this.clipFrameRate;
    const offsets = [-2, -1, 1, 2];

    for (const offset of offsets) {
      const ghostTime = currentTime + offset * frameTime;
      if (ghostTime < 0 || ghostTime > clip.duration) continue;

      const ghost = this.model.clone(true);
      ghost.name = `__onion_ghost_${offset}`;

      // Apply ghost time pose
      const ghostMixer = new THREE.AnimationMixer(ghost);
      const action = ghostMixer.clipAction(clip);
      action.play();
      ghostMixer.setTime(ghostTime);
      ghostMixer.update(0);

      // Make ghost semi-transparent
      const opacity = offset < 0 ? 0.15 : 0.12;
      const tint = offset < 0 ? 0x4488ff : 0xff8844;
      ghost.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const mat = (child.material as THREE.Material).clone();
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.transparent = true;
            mat.opacity = opacity;
            mat.color.set(tint);
            mat.depthWrite = false;
          }
          child.material = mat;
          child.renderOrder = -1;
        }
      });

      this.scene.add(ghost);
      this.onionGhosts.push(ghost);
    }
  }

  // ── Clip Export ──

  private exportCurrentClip(): void {
    const clipIdx = this.clips.findIndex(c => {
      if (!this.currentAction) return false;
      return this.currentAction.getClip() === c;
    });
    const clip = clipIdx >= 0 ? this.clips[clipIdx] : this.clips[0];
    if (!clip) return;

    const data = {
      name: clip.name,
      duration: clip.duration,
      tracks: clip.tracks.map(track => ({
        name: track.name,
        type: track.constructor.name,
        times: Array.from(track.times),
        values: Array.from(track.values),
      })),
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clip.name || 'animation'}.bfclip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  dispose(): void {
    cancelAnimationFrame(this.animId);
    this.animId = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.boneGizmo?.dispose();
    this.renderer?.dispose();
    this.orbit?.dispose();
    this.renderer = null;
    this.orbit = null;
    this.boneGizmo = null;
    this.canvas3d = null;
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 11 — IK CHAINS (CCD Solver)
  // ══════════════════════════════════════════════════════════════

  private _solveAllIK(): void {
    for (const chain of this.ikChains) {
      if (!chain.enabled) continue;
      this._solveCCDChain(chain.tipBoneName, chain.chainLength, chain.targetPos);
    }
  }

  /**
   * CCD (Cyclic Coordinate Descent) IK solver.
   * Iterates from tip's parent toward root, rotating each bone to bring
   * the tip closer to the target.
   */
  private _solveCCDChain(tipBoneName: string, chainLength: number, targetWorld: THREE.Vector3): void {
    if (!this.model) return;

    // Collect chain bones from tip upward
    let tipBone: THREE.Bone | null = null;
    this.model.traverse(child => {
      if (child instanceof THREE.Bone && child.name === tipBoneName) tipBone = child;
    });
    if (!tipBone) return;

    const chainBones: THREE.Bone[] = [];
    let cursor: THREE.Object3D | null = tipBone as THREE.Object3D;
    while (cursor && chainBones.length < chainLength) {
      if ((cursor as THREE.Object3D) instanceof THREE.Bone) chainBones.unshift(cursor as THREE.Bone);
      cursor = (cursor as THREE.Object3D).parent as THREE.Object3D | null;
    }
    if (chainBones.length < 2) return;

    const tipBoneRef = chainBones[chainBones.length - 1];
    const ITERATIONS = 4;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (let i = chainBones.length - 2; i >= 0; i--) {
        const bone = chainBones[i];

        const tipWorld = new THREE.Vector3();
        tipBoneRef.getWorldPosition(tipWorld);

        const boneWorld = new THREE.Vector3();
        bone.getWorldPosition(boneWorld);

        const toTip = tipWorld.clone().sub(boneWorld).normalize();
        const toTarget = targetWorld.clone().sub(boneWorld).normalize();

        const dot = Math.max(-1, Math.min(1, toTip.dot(toTarget)));
        if (dot >= 0.9999) continue;

        const axis = new THREE.Vector3().crossVectors(toTip, toTarget);
        if (axis.lengthSq() < 1e-10) continue;
        axis.normalize();

        const angle = Math.acos(dot);
        const rotQ = new THREE.Quaternion().setFromAxisAngle(axis, angle);

        // Apply rotation in world space, then convert to local
        const worldQ = new THREE.Quaternion();
        bone.getWorldQuaternion(worldQ);
        const newWorldQ = rotQ.multiply(worldQ);

        const parentWorldQ = new THREE.Quaternion();
        if (bone.parent) bone.parent.getWorldQuaternion(parentWorldQ);
        bone.quaternion.copy(parentWorldQ.clone().invert().multiply(newWorldQ));
        bone.updateWorldMatrix(true, true);
      }
    }
  }

  private _refreshIKList(sidePanel: HTMLElement): void {
    const list = sidePanel.querySelector('.anim-ik-list');
    if (!list) return;
    if (this.ikChains.length === 0) {
      list.innerHTML = '<div style="color:#555;font-size:10px;padding:4px;">No IK chains defined</div>';
      return;
    }
    list.innerHTML = '';
    for (const chain of this.ikChains) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 4px;background:#1e1e1e;border-radius:3px;margin-bottom:2px;font-size:10px;border-left:2px solid #ff6600;';
      row.innerHTML = `
        <input type="checkbox" ${chain.enabled ? 'checked' : ''} title="Enable IK chain" />
        <span style="flex:1;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${chain.tipBoneName}">${chain.tipBoneName || '—'}</span>
        <label style="color:#888;white-space:nowrap;">Len:
          <input type="number" value="${chain.chainLength}" min="1" max="10" style="width:32px;background:#111;border:1px solid #333;color:#ccc;font-size:9px;padding:1px 2px;border-radius:2px;" />
        </label>
        <button style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:10px;" title="Remove">✕</button>
      `;
      const check = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
      check.addEventListener('change', () => { chain.enabled = check.checked; });

      const lenInput = row.querySelector('input[type="number"]') as HTMLInputElement;
      lenInput.addEventListener('change', () => {
        const v = parseInt(lenInput.value);
        if (v >= 1 && v <= 10) chain.chainLength = v;
      });

      const del = row.querySelector('button')!;
      del.addEventListener('click', () => {
        const sphere = this.ikTargetObjects.get(chain.id);
        if (sphere) { this.scene.remove(sphere); sphere.geometry.dispose(); }
        this.ikTargetObjects.delete(chain.id);
        this.ikChains.splice(this.ikChains.indexOf(chain), 1);
        this._refreshIKList(sidePanel);
      });

      list.appendChild(row);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 11 — BLEND TREE
  // ══════════════════════════════════════════════════════════════

  private _applyBlendTree(): void {
    const bt = this.blendTree;
    if (!bt || !this.mixer) return;
    if (bt.clipIndexA >= this.clips.length || bt.clipIndexB >= this.clips.length) return;

    const clipA = this.clips[bt.clipIndexA];
    const clipB = this.clips[bt.clipIndexB];

    // Stop all other actions
    this.mixer.stopAllAction();

    const actionA = this.mixer.clipAction(clipA);
    const actionB = this.mixer.clipAction(clipB);

    actionA.weight = 1 - bt.param;
    actionB.weight = bt.param;

    actionA.setEffectiveWeight(actionA.weight);
    actionB.setEffectiveWeight(actionB.weight);

    actionA.play();
    actionB.play();

    this.isPlaying = true;
    this.currentAction = bt.param < 0.5 ? actionA : actionB;
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 11 — ANIMATION EVENTS
  // ══════════════════════════════════════════════════════════════

  /** Register a runtime callback for a named event. */
  onAnimEvent(eventName: string, callback: (ev: { clipName: string; time: number; eventName: string }) => void): void {
    this.animEventCallbacks.set(eventName, callback);
  }

  private _fireAnimEvents(prevTime: number, currentTime: number): void {
    if (!this.currentAction) return;
    const clipName = this.currentAction.getClip().name;
    for (const ev of this.animEvents) {
      if (ev.clipName !== clipName) continue;
      // Fire when crossing the event time (forward playback)
      if (ev.time > prevTime && ev.time <= currentTime) {
        const cb = this.animEventCallbacks.get(ev.eventName);
        if (cb) cb(ev);
        this.editor.statusBar?.setMessage(`🔔 AnimEvent: "${ev.eventName}" @ ${ev.time.toFixed(3)}s`);
      }
    }
  }

  private _refreshAnimEventList(sidePanel: HTMLElement): void {
    const list = sidePanel.querySelector('.anim-event-list');
    if (!list) return;
    if (this.animEvents.length === 0) {
      list.innerHTML = '<div style="color:#555;font-size:10px;padding:4px;">No events defined</div>';
      return;
    }
    list.innerHTML = '';
    for (let i = 0; i < this.animEvents.length; i++) {
      const ev = this.animEvents[i];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:3px;padding:3px 4px;background:#1e1e1e;border-radius:3px;margin-bottom:2px;font-size:10px;border-left:2px solid #f0883e;';
      row.innerHTML = `
        <input type="text" value="${ev.eventName}" placeholder="event name" style="width:72px;background:#111;border:1px solid #333;color:#ccc;font-size:9px;padding:1px 3px;border-radius:2px;" />
        <label style="color:#888;white-space:nowrap;">@
          <input type="number" value="${ev.time}" min="0" step="0.01" style="width:36px;background:#111;border:1px solid #333;color:#ccc;font-size:9px;padding:1px 2px;border-radius:2px;" />s
        </label>
        <button style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:10px;">✕</button>
      `;
      const nameIn = row.querySelectorAll('input')[0] as HTMLInputElement;
      nameIn.addEventListener('change', () => { ev.eventName = nameIn.value; });
      const timeIn = row.querySelectorAll('input')[1] as HTMLInputElement;
      timeIn.addEventListener('change', () => { ev.time = parseFloat(timeIn.value) || 0; });
      const del = row.querySelector('button')!;
      del.addEventListener('click', () => { this.animEvents.splice(i, 1); this._refreshAnimEventList(sidePanel); });
      list.appendChild(row);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 11 — RETARGETING
  // ══════════════════════════════════════════════════════════════

  /**
   * Retarget a clip by remapping bone names in each track.
   * sourceName → targetName entries in boneMap.
   * Tracks for bones not in the map are preserved as-is.
   */
  private _retargetClip(sourceClip: THREE.AnimationClip, boneMap: Map<string, string>): THREE.AnimationClip {
    const newTracks: THREE.KeyframeTrack[] = [];
    for (const track of sourceClip.tracks) {
      const dotIdx = track.name.lastIndexOf('.');
      const boneName = dotIdx >= 0 ? track.name.substring(0, dotIdx) : track.name;
      const property  = dotIdx >= 0 ? track.name.substring(dotIdx) : '';
      const mapped = boneMap.get(boneName) ?? boneName;
      const cloned = track.clone() as THREE.KeyframeTrack;
      (cloned as any).name = mapped + property;
      newTracks.push(cloned);
    }
    return new THREE.AnimationClip(`${sourceClip.name}_retargeted`, sourceClip.duration, newTracks);
  }

  private _refreshRemapList(sidePanel: HTMLElement): void {
    const list = sidePanel.querySelector('.anim-remap-list');
    if (!list) return;
    if (this.retargetBoneMap.size === 0) {
      list.innerHTML = '<div style="color:#555;font-size:10px;padding:4px;">No bone mappings</div>';
      return;
    }
    list.innerHTML = '';
    const entries = Array.from(this.retargetBoneMap.entries());
    for (const [src, tgt] of entries) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:3px;padding:3px 4px;background:#1e1e1e;border-radius:3px;margin-bottom:2px;font-size:10px;border-left:2px solid #2ecc71;';
      row.innerHTML = `
        <input type="text" value="${src}" placeholder="source bone" style="flex:1;background:#111;border:1px solid #333;color:#ccc;font-size:9px;padding:1px 3px;border-radius:2px;min-width:0;" />
        <span style="color:#666;">→</span>
        <input type="text" value="${tgt}" placeholder="target bone" style="flex:1;background:#111;border:1px solid #333;color:#ccc;font-size:9px;padding:1px 3px;border-radius:2px;min-width:0;" />
        <button style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:10px;">✕</button>
      `;
      const [srcIn, tgtIn] = row.querySelectorAll<HTMLInputElement>('input');
      const applyChange = () => {
        this.retargetBoneMap.delete(src);
        if (srcIn.value) this.retargetBoneMap.set(srcIn.value, tgtIn.value);
      };
      srcIn.addEventListener('change', applyChange);
      tgtIn.addEventListener('change', applyChange);
      row.querySelector('button')!.addEventListener('click', () => {
        this.retargetBoneMap.delete(src);
        this._refreshRemapList(sidePanel);
      });
      list.appendChild(row);
    }
  }
}
