import * as THREE from 'three';
import type { Engine } from '../engine/Engine';

/**
 * Model Inspector — reads and displays bones, meshes, materials,
 * textures, and animations from loaded glTF models.
 */
export class ModelInspectorPanel {
  private engine: Engine;
  private inspectedObject: THREE.Object3D | null = null;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  render(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'editor-section';
    container.innerHTML = `
      <h2 style="margin-bottom:12px;color:#3498db;">🔍 Model Inspector</h2>

      <div class="editor-field">
        <label>Load Model (.glb / .gltf)</label>
        <input type="file" id="model-file" accept=".glb,.gltf" style="width:100%;color:#aaa;" />
      </div>

      <p style="color:#888;font-size:0.75rem;margin-bottom:12px;">
        Or click on a model in the scene to inspect it.
      </p>

      <hr style="border-color:#444;margin:12px 0;" />

      <div id="model-info" style="font-size:0.75rem;color:#ccc;">
        <p style="color:#666;">No model loaded.</p>
      </div>
    `;

    this.bindEvents(container);
    return container;
  }

  private bindEvents(container: HTMLElement): void {
    // File upload
    container.querySelector('#model-file')?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const url = URL.createObjectURL(file);
      try {
        const model = await this.engine.assets.loadModel(url);
        this.inspectedObject = model.scene;

        // Add to scene
        const scene = this.engine.scenes.active;
        if (scene) {
          scene.add(model.scene);
        }

        this.displayModelInfo(container, model);
      } catch (err) {
        const info = container.querySelector('#model-info')!;
        info.innerHTML = `<p style="color:#e74c3c;">Error loading model: ${err}</p>`;
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  }

  private displayModelInfo(
    container: HTMLElement,
    model: { scene: THREE.Group; animations: THREE.AnimationClip[]; bones: THREE.Bone[]; meshes: THREE.Mesh[]; materials: THREE.Material[]; textures: THREE.Texture[] }
  ): void {
    const info = container.querySelector('#model-info')!;

    let html = `
      <div style="margin-bottom:8px;">
        <strong style="color:#3498db;">📊 Summary</strong>
        <ul style="padding-left:16px;margin:4px 0;">
          <li>Meshes: ${model.meshes.length}</li>
          <li>Bones: ${model.bones.length}</li>
          <li>Materials: ${model.materials.length}</li>
          <li>Textures: ${model.textures.length}</li>
          <li>Animations: ${model.animations.length}</li>
        </ul>
      </div>
    `;

    // Bones list
    if (model.bones.length > 0) {
      html += `<div style="margin-bottom:8px;"><strong style="color:#e67e22;">🦴 Bones</strong><ul style="padding-left:16px;margin:4px 0;max-height:150px;overflow-y:auto;">`;
      for (const bone of model.bones) {
        html += `<li>${this.escapeHtml(bone.name)} <span style="color:#666;">(${bone.position.x.toFixed(1)}, ${bone.position.y.toFixed(1)}, ${bone.position.z.toFixed(1)})</span></li>`;
      }
      html += `</ul></div>`;
    }

    // Meshes list
    if (model.meshes.length > 0) {
      html += `<div style="margin-bottom:8px;"><strong style="color:#2ecc71;">🔷 Meshes</strong><ul style="padding-left:16px;margin:4px 0;max-height:150px;overflow-y:auto;">`;
      for (const mesh of model.meshes) {
        const geo = mesh.geometry;
        const verts = geo.attributes.position?.count ?? 0;
        const faces = geo.index ? geo.index.count / 3 : verts / 3;
        html += `<li>${this.escapeHtml(mesh.name)} <span style="color:#666;">(${verts} verts, ${Math.floor(faces)} faces)</span></li>`;
      }
      html += `</ul></div>`;
    }

    // Materials
    if (model.materials.length > 0) {
      html += `<div style="margin-bottom:8px;"><strong style="color:#9b59b6;">🎨 Materials</strong><ul style="padding-left:16px;margin:4px 0;">`;
      for (const mat of model.materials) {
        html += `<li>${this.escapeHtml(mat.name || 'Unnamed')} <span style="color:#666;">(${mat.type})</span></li>`;
      }
      html += `</ul></div>`;
    }

    // Animations
    if (model.animations.length > 0) {
      html += `<div style="margin-bottom:8px;"><strong style="color:#f1c40f;">🎬 Animations</strong><ul style="padding-left:16px;margin:4px 0;">`;
      for (const clip of model.animations) {
        html += `<li>${this.escapeHtml(clip.name)} <span style="color:#666;">(${clip.duration.toFixed(1)}s, ${clip.tracks.length} tracks)</span></li>`;
      }
      html += `</ul></div>`;
    }

    // Textures
    if (model.textures.length > 0) {
      html += `<div style="margin-bottom:8px;"><strong style="color:#1abc9c;">🖼 Textures</strong><ul style="padding-left:16px;margin:4px 0;">`;
      for (const tex of model.textures) {
        const img = tex.image;
        const size = img ? `${img.width}x${img.height}` : 'unknown';
        html += `<li>${this.escapeHtml(tex.name || 'Unnamed')} <span style="color:#666;">(${size})</span></li>`;
      }
      html += `</ul></div>`;
    }

    info.innerHTML = html;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  inspectObject(obj: THREE.Object3D): void {
    this.inspectedObject = obj;
  }
}
