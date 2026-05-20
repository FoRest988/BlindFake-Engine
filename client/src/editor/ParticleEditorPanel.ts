import * as THREE from 'three';
import type { Engine } from '../engine/Engine';
import { ParticleSystem, type ParticleEmitterConfig } from '../engine/ParticleSystem';

export class ParticleEditorPanel {
  private engine: Engine;
  private currentPreset = 'fire';
  private config: ParticleEmitterConfig;

  constructor(engine: Engine) {
    this.engine = engine;
    this.config = ParticleSystem.firePreset();
  }

  render(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'editor-section';
    container.innerHTML = `
      <h2 style="margin-bottom:12px;color:#f39c12;">✨ Particle Editor</h2>

      <div class="editor-field">
        <label>Preset</label>
        <select id="part-preset" style="width:100%;padding:4px;background:#222;border:1px solid #444;color:#fff;border-radius:3px;">
          <option value="fire" ${this.currentPreset === 'fire' ? 'selected' : ''}>🔥 Fire</option>
          <option value="debris" ${this.currentPreset === 'debris' ? 'selected' : ''}>💨 Debris</option>
          <option value="magic" ${this.currentPreset === 'magic' ? 'selected' : ''}>🔮 Magic</option>
          <option value="custom">⚙ Custom</option>
        </select>
      </div>

      <hr style="border-color:#444;margin:12px 0;" />

      <div class="editor-field">
        <label>Max Particles</label>
        <input type="number" id="part-max" value="${this.config.maxParticles}" min="10" max="10000" step="10" />
      </div>
      <div class="editor-field">
        <label>Emit Rate (per second)</label>
        <input type="number" id="part-rate" value="${this.config.emitRate}" min="1" max="1000" step="5" />
      </div>
      <div class="editor-field">
        <label>Lifetime (min / max)</label>
        <div style="display:flex;gap:4px;">
          <input type="number" id="part-life-min" value="${this.config.lifetime[0]}" min="0.1" step="0.1" />
          <input type="number" id="part-life-max" value="${this.config.lifetime[1]}" min="0.1" step="0.1" />
        </div>
      </div>
      <div class="editor-field">
        <label>Speed (min / max)</label>
        <div style="display:flex;gap:4px;">
          <input type="number" id="part-speed-min" value="${this.config.speed[0]}" min="0" step="0.5" />
          <input type="number" id="part-speed-max" value="${this.config.speed[1]}" min="0" step="0.5" />
        </div>
      </div>
      <div class="editor-field">
        <label>Spread (radians)</label>
        <input type="number" id="part-spread" value="${this.config.spread.toFixed(2)}" min="0" max="6.28" step="0.1" />
      </div>
      <div class="editor-field">
        <label>Size (start / end)</label>
        <div style="display:flex;gap:4px;">
          <input type="number" id="part-size-start" value="${this.config.size[0]}" min="0.01" step="0.1" />
          <input type="number" id="part-size-end" value="${this.config.size[1]}" min="0" step="0.1" />
        </div>
      </div>
      <div class="editor-field">
        <label>Start Color</label>
        <input type="color" id="part-color-start" value="#${this.config.color.getHexString()}" />
      </div>
      <div class="editor-field">
        <label>End Color</label>
        <input type="color" id="part-color-end" value="#${(this.config.colorEnd ?? this.config.color).getHexString()}" />
      </div>
      <div class="editor-field">
        <label>Opacity (start / end)</label>
        <div style="display:flex;gap:4px;">
          <input type="number" id="part-opacity-start" value="${this.config.opacity[0]}" min="0" max="1" step="0.1" />
          <input type="number" id="part-opacity-end" value="${this.config.opacity[1]}" min="0" max="1" step="0.1" />
        </div>
      </div>
      <div class="editor-field">
        <label>Gravity (x, y, z)</label>
        <div style="display:flex;gap:4px;">
          <input type="number" id="part-grav-x" value="${this.config.gravity?.x ?? 0}" step="0.5" />
          <input type="number" id="part-grav-y" value="${this.config.gravity?.y ?? 0}" step="0.5" />
          <input type="number" id="part-grav-z" value="${this.config.gravity?.z ?? 0}" step="0.5" />
        </div>
      </div>

      <hr style="border-color:#444;margin:12px 0;" />

      <div style="display:flex;gap:8px;">
        <button id="part-spawn" class="editor-btn btn-green">▶ Spawn</button>
        <button id="part-clear" class="editor-btn btn-red">■ Clear All</button>
        <button id="part-export" class="editor-btn">📤 Export JSON</button>
      </div>

      <div id="part-json-output" style="margin-top:12px;display:none;">
        <textarea id="part-json-code" rows="8" style="width:100%;background:#1a1a1a;color:#0f0;border:1px solid #333;padding:8px;font-family:monospace;font-size:0.7rem;resize:vertical;"></textarea>
      </div>
    `;

    this.bindEvents(container);
    return container;
  }

  private bindEvents(container: HTMLElement): void {
    // Preset change
    container.querySelector('#part-preset')?.addEventListener('change', (e) => {
      this.currentPreset = (e.target as HTMLSelectElement).value;
      switch (this.currentPreset) {
        case 'fire': this.config = ParticleSystem.firePreset(); break;
        case 'debris': this.config = ParticleSystem.debrisPreset(); break;
        case 'magic': this.config = ParticleSystem.magicPreset(); break;
      }
      // Re-render
      container.replaceWith(this.render());
    });

    // All number inputs update config
    const updateConfig = (): void => {
      this.config.maxParticles = getNum(container, '#part-max', 500);
      this.config.emitRate = getNum(container, '#part-rate', 50);
      this.config.lifetime = [getNum(container, '#part-life-min', 0.5), getNum(container, '#part-life-max', 2)];
      this.config.speed = [getNum(container, '#part-speed-min', 1), getNum(container, '#part-speed-max', 5)];
      this.config.spread = getNum(container, '#part-spread', 0.5);
      this.config.size = [getNum(container, '#part-size-start', 1), getNum(container, '#part-size-end', 0)];
      this.config.opacity = [getNum(container, '#part-opacity-start', 1), getNum(container, '#part-opacity-end', 0)];
      this.config.gravity = new THREE.Vector3(
        getNum(container, '#part-grav-x', 0),
        getNum(container, '#part-grav-y', 0),
        getNum(container, '#part-grav-z', 0)
      );

      const startColor = (container.querySelector('#part-color-start') as HTMLInputElement)?.value ?? '#ff9900';
      const endColor = (container.querySelector('#part-color-end') as HTMLInputElement)?.value ?? '#ff0000';
      this.config.color = new THREE.Color(startColor);
      this.config.colorEnd = new THREE.Color(endColor);
    };

    container.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', updateConfig);
    });

    // Spawn
    container.querySelector('#part-spawn')?.addEventListener('click', () => {
      updateConfig();
      const name = `editor_emitter_${Date.now()}`;
      const emitter = this.engine.particles.createEmitter(name, { ...this.config });
      emitter.position.copy(this.engine.camera.position);
      const scene = this.engine.scenes.active;
      if (scene) {
        scene.add(emitter.object3D);
      }
    });

    // Clear
    container.querySelector('#part-clear')?.addEventListener('click', () => {
      this.engine.particles.dispose();
    });

    // Export
    container.querySelector('#part-export')?.addEventListener('click', () => {
      updateConfig();
      const output = container.querySelector('#part-json-output') as HTMLElement;
      const textarea = container.querySelector('#part-json-code') as HTMLTextAreaElement;
      output.style.display = 'block';
      const exportConfig = {
        ...this.config,
        color: '#' + this.config.color.getHexString(),
        colorEnd: this.config.colorEnd ? '#' + this.config.colorEnd.getHexString() : undefined,
        gravity: this.config.gravity ? { x: this.config.gravity.x, y: this.config.gravity.y, z: this.config.gravity.z } : undefined,
        direction: { x: this.config.direction.x, y: this.config.direction.y, z: this.config.direction.z },
      };
      textarea.value = JSON.stringify(exportConfig, null, 2);
    });
  }
}

function getNum(container: HTMLElement, selector: string, fallback: number): number {
  const el = container.querySelector(selector) as HTMLInputElement | null;
  return el ? (parseFloat(el.value) || fallback) : fallback;
}
