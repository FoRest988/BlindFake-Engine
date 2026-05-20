import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import { trackToLua } from '../cinematics/LuaScriptRunner';
import type { CinematicKeyframe, CinematicTrack } from '../cinematics/CinematicEngine';

export class CinematicEditorPanel {
  private engine: Engine;
  private track: CinematicTrack;

  constructor(engine: Engine) {
    this.engine = engine;
    this.track = {
      name: 'New Cinematic',
      duration: 10,
      keyframes: [],
    };
  }

  render(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'editor-section';
    container.innerHTML = `
      <h2 style="margin-bottom:12px;color:#e74c3c;">🎬 Cinematic Editor</h2>

      <div class="editor-field">
        <label>Name</label>
        <input type="text" id="cin-name" value="${this.track.name}" />
      </div>
      <div class="editor-field">
        <label>Duration (s)</label>
        <input type="number" id="cin-duration" value="${this.track.duration}" step="0.5" min="1" />
      </div>
      <div class="editor-field">
        <label>Loop</label>
        <input type="checkbox" id="cin-loop" ${this.track.loop ? 'checked' : ''} />
      </div>

      <hr style="border-color:#444;margin:12px 0;" />

      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button id="cin-add-keyframe" class="editor-btn">+ Add Keyframe</button>
        <button id="cin-capture-camera" class="editor-btn btn-accent">📷 Capture Camera</button>
      </div>

      <div id="cin-keyframes" style="max-height:300px;overflow-y:auto;"></div>

      <hr style="border-color:#444;margin:12px 0;" />

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="cin-play" class="editor-btn btn-green">▶ Play</button>
        <button id="cin-stop" class="editor-btn btn-red">■ Stop</button>
        <button id="cin-export" class="editor-btn">📤 Export Lua</button>
        <button id="cin-import" class="editor-btn">📥 Import Lua</button>
      </div>

      <div id="cin-lua-output" style="margin-top:12px;display:none;">
        <textarea id="cin-lua-code" rows="10" style="width:100%;background:#1a1a1a;color:#0f0;border:1px solid #333;padding:8px;font-family:monospace;font-size:0.75rem;resize:vertical;"></textarea>
      </div>

      <style>
        .editor-section { font-size:0.85rem; }
        .editor-field { margin-bottom:8px; }
        .editor-field label { display:block;color:#aaa;font-size:0.75rem;margin-bottom:2px; }
        .editor-field input[type="text"],
        .editor-field input[type="number"] {
          width:100%;padding:4px 8px;background:#222;border:1px solid #444;color:#fff;border-radius:3px;
        }
        .editor-btn { padding:6px 12px;border:1px solid #555;background:#333;color:#fff;cursor:pointer;border-radius:3px;font-size:0.75rem; }
        .editor-btn:hover { background:#444; }
        .btn-accent { border-color:#e74c3c;color:#e74c3c; }
        .btn-green { border-color:#2ecc71;color:#2ecc71; }
        .btn-red { border-color:#e74c3c;color:#e74c3c; }
        .keyframe-item { background:#1a1a1a;border:1px solid #333;padding:8px;margin-bottom:4px;border-radius:3px; }
        .keyframe-item .kf-header { display:flex;justify-content:space-between;align-items:center; }
        .keyframe-item input { width:60px;padding:2px 4px;background:#222;border:1px solid #444;color:#fff;border-radius:2px; }
        .keyframe-item textarea { width:100%;padding:2px 4px;background:#222;border:1px solid #444;color:#fff;border-radius:2px;resize:none;font-size:0.7rem; }
      </style>
    `;

    this.bindEvents(container);
    this.renderKeyframes(container);
    return container;
  }

  private bindEvents(container: HTMLElement): void {
    // Name
    container.querySelector('#cin-name')?.addEventListener('input', (e) => {
      this.track.name = (e.target as HTMLInputElement).value;
    });

    // Duration
    container.querySelector('#cin-duration')?.addEventListener('input', (e) => {
      this.track.duration = parseFloat((e.target as HTMLInputElement).value) || 10;
    });

    // Loop
    container.querySelector('#cin-loop')?.addEventListener('change', (e) => {
      this.track.loop = (e.target as HTMLInputElement).checked;
    });

    // Add keyframe
    container.querySelector('#cin-add-keyframe')?.addEventListener('click', () => {
      const time = this.track.keyframes.length > 0
        ? this.track.keyframes[this.track.keyframes.length - 1].time + 2
        : 0;
      this.track.keyframes.push({
        time,
        cameraPosition: new THREE.Vector3(0, 5, 10),
        cameraLookAt: new THREE.Vector3(0, 0, 0),
        cameraFov: 60,
        letterbox: true,
        subtitle: '',
      });
      this.renderKeyframes(container);
    });

    // Capture camera position as keyframe
    container.querySelector('#cin-capture-camera')?.addEventListener('click', () => {
      const cam = this.engine.camera;
      const time = this.track.keyframes.length > 0
        ? this.track.keyframes[this.track.keyframes.length - 1].time + 2
        : 0;
      const lookDir = new THREE.Vector3();
      cam.getWorldDirection(lookDir);
      const lookAt = cam.position.clone().add(lookDir.multiplyScalar(10));

      this.track.keyframes.push({
        time,
        cameraPosition: cam.position.clone(),
        cameraLookAt: lookAt,
        cameraFov: cam.fov,
        letterbox: true,
        subtitle: '',
      });
      this.renderKeyframes(container);
    });

    // Play
    container.querySelector('#cin-play')?.addEventListener('click', () => {
      this.track.keyframes.sort((a, b) => a.time - b.time);
      this.engine.cinematics.play(this.track);
    });

    // Stop
    container.querySelector('#cin-stop')?.addEventListener('click', () => {
      this.engine.cinematics.stop();
    });

    // Export Lua
    container.querySelector('#cin-export')?.addEventListener('click', () => {
      const lua = trackToLua(this.track);
      const output = container.querySelector('#cin-lua-output') as HTMLElement;
      const textarea = container.querySelector('#cin-lua-code') as HTMLTextAreaElement;
      output.style.display = 'block';
      textarea.value = lua;
    });

    // Import Lua
    container.querySelector('#cin-import')?.addEventListener('click', () => {
      const output = container.querySelector('#cin-lua-output') as HTMLElement;
      const textarea = container.querySelector('#cin-lua-code') as HTMLTextAreaElement;
      output.style.display = 'block';
      textarea.value = '-- Paste your Lua cinematic script here and press Enter';
      textarea.focus();
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
          this.engine.cinematics.playScript(textarea.value);
        }
      });
    });
  }

  private renderKeyframes(container: HTMLElement): void {
    const kfContainer = container.querySelector('#cin-keyframes');
    if (!kfContainer) return;
    kfContainer.innerHTML = '';

    for (let i = 0; i < this.track.keyframes.length; i++) {
      const kf = this.track.keyframes[i];
      const item = document.createElement('div');
      item.className = 'keyframe-item';
      item.innerHTML = `
        <div class="kf-header">
          <strong style="color:#e74c3c;">KF ${i + 1}</strong>
          <div>
            <label style="font-size:0.7rem;color:#888;">t=</label>
            <input type="number" class="kf-time" value="${kf.time}" step="0.5" min="0" />
            <button class="editor-btn btn-red kf-delete" style="padding:2px 6px;margin-left:4px;">✕</button>
          </div>
        </div>
        <div style="margin-top:4px;">
          <label style="font-size:0.7rem;color:#888;">Subtitle</label>
          <textarea class="kf-subtitle" rows="1">${kf.subtitle ?? ''}</textarea>
        </div>
      `;

      // Events
      item.querySelector('.kf-time')?.addEventListener('input', (e) => {
        kf.time = parseFloat((e.target as HTMLInputElement).value) || 0;
      });
      item.querySelector('.kf-subtitle')?.addEventListener('input', (e) => {
        kf.subtitle = (e.target as HTMLTextAreaElement).value;
      });
      item.querySelector('.kf-delete')?.addEventListener('click', () => {
        this.track.keyframes.splice(i, 1);
        this.renderKeyframes(container);
      });

      kfContainer.appendChild(item);
    }
  }

  /** Load a track for editing */
  loadTrack(track: CinematicTrack): void {
    this.track = track;
  }

  getTrack(): CinematicTrack {
    return this.track;
  }
}
