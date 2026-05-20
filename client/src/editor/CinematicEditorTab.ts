/**
 * CinematicEditorTab — Full cinematic sequencer editor tab.
 * 3D viewport with camera path visualization, timeline, keyframe editing.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { EditorApp } from './EditorApp';
import type { CinematicKeyframe, CinematicTrack } from '../cinematics/CinematicEngine';

export interface ActorKeyframe {
  time: number;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

export interface ActorTrack {
  objectName: string;
  objectUuid: string;
  keyframes: ActorKeyframe[];
  expanded: boolean;
}

export class CinematicEditorTab {
  private editor: EditorApp;
  private container: HTMLElement;
  private track: CinematicTrack;
  private actorTracks: ActorTrack[] = [];
  private currentTime = 0;
  private isPlaying = false;
  private selectedKeyframe: number = -1;
  private timelineCanvas: HTMLCanvasElement | null = null;
  private timelineCtx: CanvasRenderingContext2D | null = null;
  private animId = 0;
  private lastTime = 0;
  private zoom = 50; // pixels per second

  // 3D viewport
  private canvas3d: HTMLCanvasElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private previewScene: THREE.Scene;
  private previewCamera: THREE.PerspectiveCamera;
  private orbitControls: OrbitControls | null = null;
  private cameraPathLine: THREE.Line | null = null;
  private keyframeSpheres: THREE.Mesh[] = [];
  private cinCamera: THREE.PerspectiveCamera; // the "cinematic" camera for preview
  private blackBars = false;
  private previewMode = false; // true = view from cinematic camera

  constructor(editor: EditorApp) {
    this.editor = editor;
    this.container = document.createElement('div');
    this.track = { name: 'Untitled Cinematic', duration: 10, keyframes: [] };

    this.previewScene = new THREE.Scene();
    this.previewScene.background = new THREE.Color(0x1a1a2e);
    this.previewCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    this.previewCamera.position.set(10, 8, 10);
    this.cinCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);

    // Lighting
    const amb = new THREE.AmbientLight(0x404060, 0.6);
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    dir.position.set(50, 80, 30);
    this.previewScene.add(amb, dir);

    // Ground grid
    const grid = new THREE.GridHelper(100, 100, 0x333344, 0x222233);
    this.previewScene.add(grid);
  }

  render(): HTMLElement {
    this.container.innerHTML = '';
    this.container.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;background:#1a1a2e;color:#ccc;font-family:system-ui,sans-serif;font-size:12px;';

    // Header toolbar
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #333;background:#1e1e2e;flex-shrink:0;';
    header.innerHTML = `
      <span style="font-size:16px;">🎥</span>
      <input type="text" value="${this.escHtml(this.track.name)}" class="cin-name-input" style="background:#2a2a3a;border:1px solid #444;color:#ccc;padding:4px 8px;border-radius:3px;font-size:12px;width:180px;" />
      <span style="color:#666;">|</span>
      <label style="font-size:11px;color:#888;">Duration:</label>
      <input type="number" value="${this.track.duration}" min="1" max="300" step="0.5" class="cin-duration" style="background:#2a2a3a;border:1px solid #444;color:#ccc;padding:4px 6px;border-radius:3px;font-size:11px;width:60px;" />
      <span style="font-size:11px;color:#666;">sec</span>
      <div style="flex:1;"></div>
      <button class="cin-btn" data-action="load-model">📦 Load Model</button>
      <button class="cin-btn" data-action="load-scene">🌍 From Scene</button>
      <button class="cin-btn" data-action="add-actor">🎭 Add Actor</button>
      <button class="cin-btn" data-action="add-key">+ Keyframe</button>
      <button class="cin-btn" data-action="capture">📷 Capture</button>
      <span style="color:#666;">|</span>
      <button class="cin-btn" data-action="preview-toggle">👁 Preview</button>
      <button class="cin-btn" data-action="black-bars">▬ Bars</button>
      <span style="color:#666;">|</span>
      <button class="cin-btn cin-play" data-action="play">▶</button>
      <button class="cin-btn" data-action="stop">⏹</button>
      <span class="cin-time-display" style="font-family:monospace;font-size:12px;color:#58a6ff;min-width:60px;">0.00s</span>
    `;
    this.container.appendChild(header);

    // Main area: 3D viewport + properties (top), timeline (bottom)
    const mainArea = document.createElement('div');
    mainArea.style.cssText = 'display:flex;flex:1;overflow:hidden;min-height:0;';
    this.container.appendChild(mainArea);

    // 3D Viewport
    const viewportArea = document.createElement('div');
    viewportArea.style.cssText = 'flex:1;position:relative;min-width:0;background:#111;';
    mainArea.appendChild(viewportArea);

    this.canvas3d = document.createElement('canvas');
    this.canvas3d.style.cssText = 'width:100%;height:100%;display:block;';
    viewportArea.appendChild(this.canvas3d);

    // Black bars overlay
    const barsOverlay = document.createElement('div');
    barsOverlay.className = 'cin-black-bars';
    barsOverlay.style.cssText = 'display:none;position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;';
    barsOverlay.innerHTML = `
      <div style="position:absolute;top:0;left:0;right:0;height:12%;background:#000;"></div>
      <div style="position:absolute;bottom:0;left:0;right:0;height:12%;background:#000;"></div>
    `;
    viewportArea.appendChild(barsOverlay);

    // Properties panel (right)
    const propsPanel = document.createElement('div');
    propsPanel.className = 'cin-props';
    propsPanel.style.cssText = 'width:260px;overflow-y:auto;padding:12px;flex-shrink:0;border-left:1px solid #333;';
    propsPanel.innerHTML = this.renderProps();
    mainArea.appendChild(propsPanel);

    // Timeline area (bottom)
    const timelineArea = document.createElement('div');
    timelineArea.style.cssText = 'height:200px;flex-shrink:0;display:flex;border-top:1px solid #333;';
    this.container.appendChild(timelineArea);

    // Track labels
    const labelsCol = document.createElement('div');
    labelsCol.style.cssText = 'width:140px;flex-shrink:0;border-right:1px solid #333;overflow-y:hidden;';
    this.rebuildTrackLabels(labelsCol);
    timelineArea.appendChild(labelsCol);

    const canvasWrapper = document.createElement('div');
    canvasWrapper.style.cssText = 'flex:1;overflow-x:auto;overflow-y:hidden;position:relative;';
    this.timelineCanvas = document.createElement('canvas');
    this.timelineCanvas.style.cssText = 'display:block;';
    canvasWrapper.appendChild(this.timelineCanvas);
    timelineArea.appendChild(canvasWrapper);

    this.addStyles();
    this.initViewport(viewportArea);
    this.bindEvents(header, propsPanel, canvasWrapper, barsOverlay, labelsCol);
    requestAnimationFrame(() => this.resizeTimeline(canvasWrapper));

    return this.container;
  }

  private renderProps(): string {
    if (this.selectedKeyframe < 0 || this.selectedKeyframe >= this.track.keyframes.length) {
      return `
        <div style="color:#666;text-align:center;margin-top:40px;">
          <div style="font-size:32px;margin-bottom:8px;">🎞️</div>
          <div>Select a keyframe to edit</div>
          <div style="font-size:10px;margin-top:4px;">Click on the timeline or use + Keyframe</div>
        </div>
      `;
    }

    const kf = this.track.keyframes[this.selectedKeyframe];
    return `
      <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:8px;">Keyframe ${this.selectedKeyframe + 1}</div>
      <div class="cin-field">
        <label>Time (s)</label>
        <input type="number" data-kf="time" value="${kf.time.toFixed(2)}" min="0" max="${this.track.duration}" step="0.1" />
      </div>
      <div class="cin-field">
        <label>Camera Pos X</label>
        <input type="number" data-kf="posX" value="${kf.cameraPosition?.x.toFixed(2) ?? '0'}" step="0.5" />
      </div>
      <div class="cin-field">
        <label>Camera Pos Y</label>
        <input type="number" data-kf="posY" value="${kf.cameraPosition?.y.toFixed(2) ?? '0'}" step="0.5" />
      </div>
      <div class="cin-field">
        <label>Camera Pos Z</label>
        <input type="number" data-kf="posZ" value="${kf.cameraPosition?.z.toFixed(2) ?? '0'}" step="0.5" />
      </div>
      <div class="cin-field">
        <label>Look At X</label>
        <input type="number" data-kf="lookX" value="${kf.cameraLookAt?.x.toFixed(2) ?? '0'}" step="0.5" />
      </div>
      <div class="cin-field">
        <label>Look At Y</label>
        <input type="number" data-kf="lookY" value="${kf.cameraLookAt?.y.toFixed(2) ?? '0'}" step="0.5" />
      </div>
      <div class="cin-field">
        <label>Look At Z</label>
        <input type="number" data-kf="lookZ" value="${kf.cameraLookAt?.z.toFixed(2) ?? '0'}" step="0.5" />
      </div>
      <div class="cin-field">
        <label>FOV</label>
        <input type="number" data-kf="fov" value="${kf.cameraFov ?? 60}" min="10" max="120" step="1" />
      </div>
      <div class="cin-field">
        <label>Subtitle</label>
        <input type="text" data-kf="subtitle" value="${this.escHtml(kf.subtitle ?? '')}" />
      </div>
      <div class="cin-field">
        <label>Event</label>
        <input type="text" data-kf="event" value="${this.escHtml(kf.event ?? '')}" />
      </div>
      <div style="margin-top:12px;">
        <button class="cin-btn cin-btn-danger" data-action="delete-key">Delete Keyframe</button>
      </div>
    `;
  }

  private selectedActor: THREE.Object3D | null = null;
  private selectionBox: THREE.BoxHelper | null = null;
  private transformControls: TransformControls | null = null;

  private initViewport(area: HTMLElement): void {
    if (!this.canvas3d) return;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas3d, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.orbitControls = new OrbitControls(this.previewCamera, this.canvas3d);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.1;

    // Transform controls for moving/rotating/scaling selected actors
    this.transformControls = new TransformControls(this.previewCamera, this.canvas3d);
    this.transformControls.size = 0.8;
    this.previewScene.add(this.transformControls.getHelper());
    this.transformControls.addEventListener('dragging-changed', (event: any) => {
      if (this.orbitControls) this.orbitControls.enabled = !event.value;
    });
    // Keyboard shortcuts for transform mode in cinematic viewport
    this.canvas3d.setAttribute('tabindex', '0');
    this.canvas3d.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.transformControls) return;
      if (e.key === 'g' || e.key === 'G') this.transformControls.setMode('translate');
      if (e.key === 'r' || e.key === 'R') this.transformControls.setMode('rotate');
      if (e.key === 's' || e.key === 'S') this.transformControls.setMode('scale');
    });

    // Click-to-select objects in the cinematic viewport
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    this.canvas3d.addEventListener('dblclick', (e: MouseEvent) => {
      if (this.previewMode || !this.canvas3d) return;
      const rect = this.canvas3d.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, this.previewCamera);
      const meshes: THREE.Object3D[] = [];
      this.previewScene.traverse(child => {
        if (child instanceof THREE.Mesh && (child as THREE.Object3D) !== (this.cameraPathLine as THREE.Object3D | null)) meshes.push(child);
      });
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length > 0) {
        // Find root group for this mesh
        let root: THREE.Object3D = hits[0].object;
        while (root.parent && root.parent !== this.previewScene) root = root.parent;
        this.selectActorInViewport(root);
      } else {
        this.selectActorInViewport(null);
      }
    });

    const resizeViewport = () => {
      if (!this.renderer || !this.canvas3d) return;
      const w = area.clientWidth;
      const h = area.clientHeight;
      if (w === 0 || h === 0) return;
      this.renderer.setSize(w, h);
      this.previewCamera.aspect = w / h;
      this.previewCamera.updateProjectionMatrix();
      this.cinCamera.aspect = w / h;
      this.cinCamera.updateProjectionMatrix();
    };

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(resizeViewport);
    this.resizeObserver.observe(area);
    resizeViewport();

    // Camera helper for cinematic camera visualization
    this.updateCameraPath();

    // Start render loop
    const loop = () => {
      this.animId = requestAnimationFrame(loop);
      if (!this.renderer) return;
      this.orbitControls?.update();
      if (this.selectionBox) this.selectionBox.update();

      // If previewing, interpolate cin camera and render from it
      if (this.previewMode) {
        this.interpolateCinCamera(this.currentTime);
        this.renderer.render(this.previewScene, this.cinCamera);
      } else {
        this.renderer.render(this.previewScene, this.previewCamera);
      }
    };
    loop();
  }

  private interpolateCinCamera(time: number): void {
    const kfs = this.track.keyframes.filter(k => k.cameraPosition);
    if (kfs.length === 0) return;

    if (kfs.length === 1) {
      this.cinCamera.position.copy(kfs[0].cameraPosition!);
      if (kfs[0].cameraLookAt) this.cinCamera.lookAt(kfs[0].cameraLookAt);
      if (kfs[0].cameraFov) this.cinCamera.fov = kfs[0].cameraFov;
      this.cinCamera.updateProjectionMatrix();
      return;
    }

    // Find surrounding keyframes
    let a = kfs[0], b = kfs[kfs.length - 1];
    for (let i = 0; i < kfs.length - 1; i++) {
      if (kfs[i].time <= time && kfs[i + 1].time >= time) {
        a = kfs[i];
        b = kfs[i + 1];
        break;
      }
    }

    const range = b.time - a.time;
    const t = range > 0 ? (time - a.time) / range : 0;

    this.cinCamera.position.lerpVectors(a.cameraPosition!, b.cameraPosition!, t);
    if (a.cameraLookAt && b.cameraLookAt) {
      const look = new THREE.Vector3().lerpVectors(a.cameraLookAt, b.cameraLookAt, t);
      this.cinCamera.lookAt(look);
    }
    const fovA = a.cameraFov ?? 60;
    const fovB = b.cameraFov ?? 60;
    this.cinCamera.fov = fovA + (fovB - fovA) * t;
    this.cinCamera.updateProjectionMatrix();
  }

  private updateCameraPath(): void {
    // Remove old path
    if (this.cameraPathLine) {
      this.previewScene.remove(this.cameraPathLine);
      this.cameraPathLine.geometry.dispose();
      (this.cameraPathLine.material as THREE.Material).dispose();
    }
    for (const s of this.keyframeSpheres) {
      this.previewScene.remove(s);
      s.geometry.dispose();
      (s.material as THREE.Material).dispose();
    }
    this.keyframeSpheres = [];

    const posKfs = this.track.keyframes.filter(k => k.cameraPosition);
    if (posKfs.length < 2) {
      // Just show spheres for single keyframes
      for (const kf of posKfs) {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.3, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x58a6ff })
        );
        sphere.position.copy(kf.cameraPosition!);
        this.previewScene.add(sphere);
        this.keyframeSpheres.push(sphere);
      }
      return;
    }

    // Build camera path spline
    const points = posKfs.map(k => k.cameraPosition!.clone());
    const curve = new THREE.CatmullRomCurve3(points);
    const linePoints = curve.getPoints(100);
    const geo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const mat = new THREE.LineBasicMaterial({ color: 0x58a6ff, linewidth: 2 });
    this.cameraPathLine = new THREE.Line(geo, mat);
    this.previewScene.add(this.cameraPathLine);

    // Keyframe position markers
    for (let i = 0; i < posKfs.length; i++) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 8),
        new THREE.MeshBasicMaterial({
          color: i === this.selectedKeyframe ? 0xffffff : 0x58a6ff,
        })
      );
      sphere.position.copy(posKfs[i].cameraPosition!);
      this.previewScene.add(sphere);
      this.keyframeSpheres.push(sphere);
    }
  }

  private resizeTimeline(wrapper: HTMLElement): void {
    if (!this.timelineCanvas) return;
    const totalTracks = 6 + this.actorTracks.length;
    const w = Math.max(wrapper.clientWidth, this.track.duration * this.zoom + 60);
    const h = 28 * totalTracks;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.timelineCanvas.width = w * dpr;
    this.timelineCanvas.height = h * dpr;
    this.timelineCanvas.style.width = w + 'px';
    this.timelineCanvas.style.height = h + 'px';
    this.timelineCtx = this.timelineCanvas.getContext('2d');
    if (this.timelineCtx) this.timelineCtx.scale(dpr, dpr);
    this.drawTimeline(w, h);
  }

  private drawTimeline(w: number, h: number): void {
    const ctx = this.timelineCtx;
    if (!ctx) return;
    const totalTracks = 6 + this.actorTracks.length;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    // Track rows
    for (let i = 0; i < totalTracks; i++) {
      const y = i * 28;
      ctx.fillStyle = i >= 6 ? (i % 2 === 0 ? '#2a1e2e' : '#251a28') : (i % 2 === 0 ? '#1e1e30' : '#1a1a2e');
      ctx.fillRect(0, y, w, 28);
      ctx.strokeStyle = '#2a2a3a';
      ctx.beginPath();
      ctx.moveTo(0, y + 28);
      ctx.lineTo(w, y + 28);
      ctx.stroke();
    }

    // Time markers
    const step = this.zoom >= 40 ? 1 : 2;
    for (let t = 0; t <= this.track.duration; t += step) {
      const x = t * this.zoom + 20;
      ctx.strokeStyle = '#333';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.font = '9px system-ui';
      ctx.fillText(`${t}s`, x + 2, 10);
    }

    // Camera keyframes
    this.track.keyframes.forEach((kf, i) => {
      const x = kf.time * this.zoom + 20;
      const selected = i === this.selectedKeyframe;

      const drawDiamond = (trackIdx: number, color: string) => {
        const cy = trackIdx * 28 + 14;
        ctx.save();
        ctx.translate(x, cy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = selected ? '#fff' : color;
        ctx.fillRect(-4, -4, 8, 8);
        if (selected) {
          ctx.strokeStyle = '#58a6ff';
          ctx.lineWidth = 2;
          ctx.strokeRect(-5, -5, 10, 10);
        }
        ctx.restore();
      };

      if (kf.cameraPosition) drawDiamond(0, '#58a6ff');
      if (kf.cameraLookAt) drawDiamond(1, '#3fb950');
      if (kf.cameraFov !== undefined) drawDiamond(2, '#f0883e');
      if (kf.subtitle) drawDiamond(3, '#bc8cff');
      if (kf.event) drawDiamond(4, '#da3633');
      if (kf.fadeAlpha !== undefined) drawDiamond(5, '#8b949e');
    });

    // Actor track keyframes
    for (let ai = 0; ai < this.actorTracks.length; ai++) {
      const at = this.actorTracks[ai];
      const trackIdx = 6 + ai;
      for (const akf of at.keyframes) {
        const x = akf.time * this.zoom + 20;
        const cy = trackIdx * 28 + 14;
        ctx.save();
        ctx.translate(x, cy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#d4a';
        ctx.fillRect(-4, -4, 8, 8);
        ctx.restore();
      }
    }

    // Playhead
    const px = this.currentTime * this.zoom + 20;
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 6);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1;
  }

  private bindEvents(header: HTMLElement, propsPanel: HTMLElement, canvasWrapper: HTMLElement, barsOverlay: HTMLElement, labelsCol: HTMLElement): void {
    // Name input
    header.querySelector('.cin-name-input')?.addEventListener('change', (e) => {
      this.track.name = (e.target as HTMLInputElement).value;
    });

    // Duration
    header.querySelector('.cin-duration')?.addEventListener('change', (e) => {
      this.track.duration = parseFloat((e.target as HTMLInputElement).value) || 10;
      this.resizeTimeline(canvasWrapper);
    });

    // Add keyframe
    header.querySelector('[data-action="add-key"]')?.addEventListener('click', () => {
      const cam = this.editor.editorCamera;
      const kf: CinematicKeyframe = {
        time: this.currentTime,
        cameraPosition: cam.position.clone(),
        cameraLookAt: new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).add(cam.position),
        cameraFov: cam.fov,
      };
      this.track.keyframes.push(kf);
      this.track.keyframes.sort((a, b) => a.time - b.time);
      this.selectedKeyframe = this.track.keyframes.indexOf(kf);
      propsPanel.innerHTML = this.renderProps();
      this.bindPropsEvents(propsPanel, canvasWrapper);
      this.resizeTimeline(canvasWrapper);
      this.updateCameraPath();
    });

    // Capture camera
    header.querySelector('[data-action="capture"]')?.addEventListener('click', () => {
      if (this.selectedKeyframe >= 0 && this.selectedKeyframe < this.track.keyframes.length) {
        const cam = this.editor.editorCamera;
        const kf = this.track.keyframes[this.selectedKeyframe];
        kf.cameraPosition = cam.position.clone();
        kf.cameraLookAt = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).add(cam.position);
        kf.cameraFov = cam.fov;
        propsPanel.innerHTML = this.renderProps();
        this.bindPropsEvents(propsPanel, canvasWrapper);
        this.resizeTimeline(canvasWrapper);
        this.updateCameraPath();
      }
      // Also capture actor keyframes at current time
      this.captureActorKeyframes();
      this.resizeTimeline(canvasWrapper);
    });

    // Play
    header.querySelector('[data-action="play"]')?.addEventListener('click', () => {
      this.isPlaying = !this.isPlaying;
      const btn = header.querySelector('.cin-play') as HTMLElement;
      if (btn) btn.textContent = this.isPlaying ? '⏸' : '▶';
      if (this.isPlaying) {
        this.lastTime = performance.now();
        this.startPlayback(header, canvasWrapper);
      }
    });

    // Stop
    header.querySelector('[data-action="stop"]')?.addEventListener('click', () => {
      this.isPlaying = false;
      this.currentTime = 0;
      const btn = header.querySelector('.cin-play') as HTMLElement;
      if (btn) btn.textContent = '▶';
      const display = header.querySelector('.cin-time-display') as HTMLElement;
      if (display) display.textContent = '0.00s';
      this.resizeTimeline(canvasWrapper);
    });

    // Timeline click
    this.timelineCanvas?.addEventListener('mousedown', (e) => {
      const rect = this.timelineCanvas!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = Math.max(0, (x - 20) / this.zoom);

      // Check if click is near a keyframe
      let hit = -1;
      this.track.keyframes.forEach((kf, i) => {
        if (Math.abs(kf.time * this.zoom + 20 - x) < 8) hit = i;
      });

      if (hit >= 0) {
        this.selectedKeyframe = hit;
        this.currentTime = this.track.keyframes[hit].time;
      } else {
        this.currentTime = Math.min(time, this.track.duration);
        this.selectedKeyframe = -1;
      }

      propsPanel.innerHTML = this.renderProps();
      this.bindPropsEvents(propsPanel, canvasWrapper);
      const display = header.querySelector('.cin-time-display') as HTMLElement;
      if (display) display.textContent = this.currentTime.toFixed(2) + 's';
      this.resizeTimeline(canvasWrapper);
    });

    this.bindPropsEvents(propsPanel, canvasWrapper);

    // Load model into cinematic scene
    header.querySelector('[data-action="load-model"]')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.glb,.gltf,.bin,.png,.jpg,.jpeg';
      input.multiple = true;
      input.onchange = async () => {
        if (!input.files || input.files.length === 0) return;
        try {
          const model = await this.editor.engine.assets.loadModelFromFiles(input.files);
          model.scene.traverse((child: THREE.Object3D) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          this.previewScene.add(model.scene);
        } catch (err) {
          console.error('Failed to load model into cinematic scene:', err);
        }
      };
      input.click();
    });

    // Clone objects from main scene
    header.querySelector('[data-action="load-scene"]')?.addEventListener('click', () => {
      const mainScene = this.editor.scene;
      const toAdd: THREE.Object3D[] = [];
      mainScene.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh && child.parent === mainScene) {
          toAdd.push(child.clone());
        }
        if (child instanceof THREE.Group && child.parent === mainScene && !child.userData.__editorHelper) {
          toAdd.push(child.clone());
        }
      });
      for (const obj of toAdd) {
        this.previewScene.add(obj);
      }
    });

    // Add actor from scene
    header.querySelector('[data-action="add-actor"]')?.addEventListener('click', () => {
      this.showActorPicker(labelsCol, canvasWrapper);
    });

    // Toggle preview mode (view from cinematic camera)
    header.querySelector('[data-action="preview-toggle"]')?.addEventListener('click', () => {
      this.previewMode = !this.previewMode;
      const btn = header.querySelector('[data-action="preview-toggle"]') as HTMLElement;
      if (btn) btn.style.background = this.previewMode ? '#1f6feb' : '';
    });

    // Toggle black bars
    header.querySelector('[data-action="black-bars"]')?.addEventListener('click', () => {
      this.blackBars = !this.blackBars;
      barsOverlay.style.display = this.blackBars ? 'block' : 'none';
      const btn = header.querySelector('[data-action="black-bars"]') as HTMLElement;
      if (btn) btn.style.background = this.blackBars ? '#1f6feb' : '';
    });
  }

  private bindPropsEvents(propsPanel: HTMLElement, canvasWrapper: HTMLElement): void {
    if (this.selectedKeyframe < 0) return;
    const kf = this.track.keyframes[this.selectedKeyframe];
    if (!kf) return;

    propsPanel.querySelectorAll<HTMLInputElement>('[data-kf]').forEach(input => {
      input.addEventListener('change', () => {
        const field = input.dataset.kf!;
        const val = parseFloat(input.value);
        switch (field) {
          case 'time': kf.time = Math.max(0, Math.min(this.track.duration, val)); break;
          case 'posX': (kf.cameraPosition ??= new THREE.Vector3()).x = val; break;
          case 'posY': (kf.cameraPosition ??= new THREE.Vector3()).y = val; break;
          case 'posZ': (kf.cameraPosition ??= new THREE.Vector3()).z = val; break;
          case 'lookX': (kf.cameraLookAt ??= new THREE.Vector3()).x = val; break;
          case 'lookY': (kf.cameraLookAt ??= new THREE.Vector3()).y = val; break;
          case 'lookZ': (kf.cameraLookAt ??= new THREE.Vector3()).z = val; break;
          case 'fov': kf.cameraFov = val; break;
          case 'subtitle': kf.subtitle = input.value; break;
          case 'event': kf.event = input.value; break;
        }
        this.track.keyframes.sort((a, b) => a.time - b.time);
        this.selectedKeyframe = this.track.keyframes.indexOf(kf);
        this.resizeTimeline(canvasWrapper);
        this.updateCameraPath();
      });
    });

    propsPanel.querySelector('[data-action="delete-key"]')?.addEventListener('click', () => {
      if (this.selectedKeyframe >= 0) {
        this.track.keyframes.splice(this.selectedKeyframe, 1);
        this.selectedKeyframe = -1;
        propsPanel.innerHTML = this.renderProps();
        this.resizeTimeline(canvasWrapper);
        this.updateCameraPath();
      }
    });
  }

  private startPlayback(header: HTMLElement, canvasWrapper: HTMLElement): void {
    const display = header.querySelector('.cin-time-display') as HTMLElement;
    const loop = () => {
      if (!this.isPlaying) return;
      this.animId = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      this.currentTime += dt;
      if (this.currentTime >= this.track.duration) {
        this.currentTime = 0;
      }
      if (display) display.textContent = this.currentTime.toFixed(2) + 's';
      this.updateActorPlayback();
      this.resizeTimeline(canvasWrapper);
    };
    loop();
  }

  private addStyles(): void {
    if (document.getElementById('cin-editor-styles')) return;
    const style = document.createElement('style');
    style.id = 'cin-editor-styles';
    style.textContent = `
      .cin-btn { padding:4px 10px; border-radius:3px; border:1px solid #444; background:#2a2a3a; color:#ccc; font-size:11px; cursor:pointer; transition:all 0.15s; }
      .cin-btn:hover { background:#3a3a4a; }
      .cin-btn-danger { border-color:#da3633; color:#da3633; }
      .cin-btn-danger:hover { background:#da3633; color:#fff; }
      .cin-field { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
      .cin-field label { width:80px; font-size:10px; color:#888; flex-shrink:0; }
      .cin-field input { flex:1; background:#2a2a3a; border:1px solid #444; color:#ccc; padding:3px 6px; border-radius:3px; font-size:11px; }
      .cin-field input:focus { border-color:#58a6ff; outline:none; }
    `;
    document.head.appendChild(style);
  }

  private escHtml(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Actor Tracks ──────────────────────────────────────

  private rebuildTrackLabels(labelsCol: HTMLElement): void {
    labelsCol.innerHTML = '';
    const cameraLabels = ['📹 Camera Pos', '📹 Camera Look', '📹 Camera FOV', '💬 Subtitles', '⚡ Events', '🌫 Fade'];
    cameraLabels.forEach(name => {
      const row = document.createElement('div');
      row.style.cssText = 'height:28px;display:flex;align-items:center;padding:0 8px;border-bottom:1px solid #2a2a3a;font-size:10px;color:#888;';
      row.textContent = name;
      labelsCol.appendChild(row);
    });

    for (const at of this.actorTracks) {
      const row = document.createElement('div');
      row.style.cssText = 'height:28px;display:flex;align-items:center;justify-content:space-between;padding:0 8px;border-bottom:1px solid #2a2a3a;font-size:10px;color:#d4a;gap:4px;';
      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameSpan.textContent = `🎭 ${at.objectName}`;
      nameSpan.title = at.objectName;
      const removeBtn = document.createElement('button');
      removeBtn.style.cssText = 'background:none;border:none;color:#c66;font-size:10px;cursor:pointer;padding:0;';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Remove actor track';
      removeBtn.addEventListener('click', () => {
        this.actorTracks = this.actorTracks.filter(t => t !== at);
        this.rebuildTrackLabels(labelsCol);
      });
      row.appendChild(nameSpan);
      row.appendChild(removeBtn);
      labelsCol.appendChild(row);
    }
  }

  private selectActorInViewport(obj: THREE.Object3D | null): void {
    // Clear previous selection highlight
    if (this.selectionBox) {
      this.previewScene.remove(this.selectionBox);
      this.selectionBox.dispose();
      this.selectionBox = null;
    }
    this.selectedActor = obj;

    // Detach transform controls if deselecting
    if (!obj && this.transformControls) {
      this.transformControls.detach();
    }

    if (obj) {
      this.selectionBox = new THREE.BoxHelper(obj, 0x58a6ff);
      this.previewScene.add(this.selectionBox);

      // Attach transform controls so user can move/rotate the actor
      if (this.transformControls) {
        this.transformControls.attach(obj);
      }

      // If this actor isn't already in actorTracks, auto-add it
      const hasTrack = this.actorTracks.some(t => t.objectName === obj.name);
      if (!hasTrack && obj.name) {
        this.actorTracks.push({
          objectName: obj.name,
          objectUuid: obj.uuid,
          keyframes: [],
          expanded: false,
        });
        // Rebuild labels if container exists
        const labelsCol = this.container.querySelector('.cin-track-labels') as HTMLElement;
        if (labelsCol) this.rebuildTrackLabels(labelsCol);
      }
    }
  }

  private showActorPicker(labelsCol: HTMLElement, canvasWrapper: HTMLElement): void {
    // Get all named objects from the main scene
    const sceneObjects: { name: string; uuid: string }[] = [];
    this.editor.scene.traverse((obj: THREE.Object3D) => {
      if (obj.name && obj !== this.editor.scene && !obj.userData.__editorHelper && !obj.userData._weatherZoneHelper) {
        sceneObjects.push({ name: obj.name, uuid: obj.uuid });
      }
    });

    // Create popup
    const popup = document.createElement('div');
    popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#2a2a3a;border:1px solid #555;border-radius:6px;padding:12px;z-index:10000;min-width:280px;max-height:400px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.6);';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:600;color:#ccc;margin-bottom:8px;';
    title.textContent = '🎭 Select Actor from Scene';
    popup.appendChild(title);

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Search objects...';
    search.style.cssText = 'width:100%;padding:6px 10px;background:#1e1e2e;border:1px solid #444;color:#ccc;border-radius:3px;font-size:12px;box-sizing:border-box;margin-bottom:8px;';
    popup.appendChild(search);

    const list = document.createElement('div');
    popup.appendChild(list);

    const renderList = (filter: string) => {
      list.innerHTML = '';
      const filtered = sceneObjects.filter(o => !filter || o.name.toLowerCase().includes(filter));
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color:#666;text-align:center;padding:12px;font-size:11px;';
        empty.textContent = 'No matching objects found';
        list.appendChild(empty);
        return;
      }
      for (const obj of filtered) {
        // Skip already-added actors
        if (this.actorTracks.some(t => t.objectUuid === obj.uuid)) continue;
        const item = document.createElement('div');
        item.style.cssText = 'padding:6px 10px;cursor:pointer;border-radius:3px;font-size:12px;color:#ccc;display:flex;align-items:center;gap:6px;';
        item.innerHTML = `<span style="color:#d4a;">🎭</span> ${this.escHtml(obj.name)}`;
        item.addEventListener('mouseenter', () => { item.style.background = '#3a3a5a'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('click', () => {
          this.actorTracks.push({
            objectName: obj.name,
            objectUuid: obj.uuid,
            keyframes: [],
            expanded: false,
          });
          document.body.removeChild(popup);
          this.rebuildTrackLabels(labelsCol);
          this.resizeTimeline(canvasWrapper);
        });
        list.appendChild(item);
      }
    };

    renderList('');
    search.addEventListener('input', () => renderList(search.value.toLowerCase()));
    search.focus();

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'position:absolute;top:8px;right:8px;background:none;border:none;color:#888;font-size:16px;cursor:pointer;';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => document.body.removeChild(popup));
    popup.appendChild(closeBtn);

    document.body.appendChild(popup);
  }

  private captureActorKeyframes(): void {
    const mainScene = this.editor.scene;
    for (const at of this.actorTracks) {
      const found = this.findObjectByUuid(mainScene, at.objectUuid);
      if (!found) continue;
      at.keyframes.push({
        time: this.currentTime,
        position: found.position.clone(),
        rotation: found.rotation.clone(),
        scale: found.scale.clone(),
      });
      at.keyframes.sort((a, b) => a.time - b.time);
    }
  }

  private findObjectByUuid(root: THREE.Object3D, uuid: string): THREE.Object3D | null {
    let result: THREE.Object3D | null = null;
    root.traverse((obj) => { if (obj.uuid === uuid && !result) result = obj; });
    return result;
  }

  private updateActorPlayback(): void {
    const mainScene = this.editor.scene;
    for (const at of this.actorTracks) {
      if (at.keyframes.length === 0) continue;
      const found = this.findObjectByUuid(mainScene, at.objectUuid);
      if (!found) continue;

      // Find surrounding keyframes
      let prev: ActorKeyframe | null = null;
      let next: ActorKeyframe | null = null;
      for (const kf of at.keyframes) {
        if (kf.time <= this.currentTime) prev = kf;
        if (kf.time > this.currentTime && !next) next = kf;
      }

      if (prev && next) {
        const range = next.time - prev.time;
        const alpha = range > 0 ? Math.min(1, (this.currentTime - prev.time) / range) : 1;
        const t = alpha * alpha * (3 - 2 * alpha); // smoothstep
        found.position.lerpVectors(prev.position, next.position, t);
        found.rotation.set(
          prev.rotation.x + (next.rotation.x - prev.rotation.x) * t,
          prev.rotation.y + (next.rotation.y - prev.rotation.y) * t,
          prev.rotation.z + (next.rotation.z - prev.rotation.z) * t,
        );
        found.scale.lerpVectors(prev.scale, next.scale, t);
      } else if (prev) {
        found.position.copy(prev.position);
        found.rotation.copy(prev.rotation);
        found.scale.copy(prev.scale);
      }
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.animId);
    this.isPlaying = false;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.transformControls?.dispose();
    this.orbitControls?.dispose();
    this.renderer?.dispose();
  }
}
