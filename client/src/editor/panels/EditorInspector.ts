import * as THREE from 'three';
import type { EditorApp } from '../EditorApp';
import { TransformCommand, PropertyCommand, MaterialColorCommand, type TransformSnapshot } from '../UndoManager';

export class EditorInspector {
  private editor: EditorApp;
  private container!: HTMLElement;
  private content!: HTMLElement;
  private collapsedSections = new Set<string>();

  constructor(editor: EditorApp) {
    this.editor = editor;
  }

  render(): HTMLElement {
    this.container = document.createElement('div');
    this.container.style.cssText = 'display:flex;flex-direction:column;height:100%;';

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = `<span>🔧 Inspector</span>`;
    this.container.appendChild(header);

    this.content = document.createElement('div');
    this.content.className = 'panel-content';
    this.container.appendChild(this.content);

    this.rebuild();
    return this.container;
  }

  refresh(): void {
    this.rebuild();
  }

  private rebuild(): void {
    const obj = this.editor.state.selectedObject;
    const selCount = this.editor.selection.size;

    if (!obj) {
      this.content.innerHTML = `<p style="color:#666;text-align:center;padding:40px 0;font-size:11px;">No object selected</p>`;
      return;
    }

    this.content.innerHTML = '';

    // Multi-select header
    if (selCount > 1) {
      this.content.appendChild(this.renderMultiSelectSection(selCount));
    }

    // Object name & type
    this.content.appendChild(this.renderNameSection(obj));

    // Transform
    this.content.appendChild(this.renderTransformSection(obj));

    // Mesh / Geometry info
    if (obj instanceof THREE.Mesh) {
      this.content.appendChild(this.renderMeshSection(obj));
      this.content.appendChild(this.renderMaterialSection(obj));
    }

    // Light
    if (obj instanceof THREE.Light) {
      this.content.appendChild(this.renderLightSection(obj));
    }

    // Camera
    if (obj instanceof THREE.PerspectiveCamera) {
      this.content.appendChild(this.renderCameraSection(obj));
    }

    // Group/Model children summary + per-mesh material editing
    if (obj instanceof THREE.Group && obj.children.length > 0) {
      this.content.appendChild(this.renderGroupSection(obj));

      // Find child meshes and show material sections for each
      const meshes: THREE.Mesh[] = [];
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
      for (const childMesh of meshes) {
        this.content.appendChild(this.renderMaterialSection(childMesh, childMesh.name || `Mesh_${meshes.indexOf(childMesh)}`));
      }
    }

    // Actions
    this.content.appendChild(this.renderActionsSection(obj));

    // Script / Blueprint
    this.content.appendChild(this.renderScriptSection(obj));

    // ECS Components (if this object belongs to an entity)
    this.content.appendChild(this.renderECSSection(obj));
  }

  // --- Sections ---

  private renderNameSection(obj: THREE.Object3D): HTMLElement {
    const section = this.createSection('Object', '⬡');
    const body = section.querySelector('.inspector-section-body')!;

    body.innerHTML = `
      <div class="inspector-row">
        <span class="inspector-label">Name</span>
        <div class="inspector-value">
          <input class="inspector-input" type="text" value="${this.esc(obj.name)}" data-prop="name" />
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Type</span>
        <div class="inspector-value">
          <span style="color:#888;font-size:11px;">${obj.type}</span>
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Visible</span>
        <div class="inspector-value">
          <input class="inspector-checkbox" type="checkbox" ${obj.visible ? 'checked' : ''} data-prop="visible" />
        </div>
      </div>
    `;

    body.querySelector('[data-prop="name"]')?.addEventListener('change', (e) => {
      const newName = (e.target as HTMLInputElement).value;
      const oldName = obj.name;
      this.editor.undo.pushDirect(new PropertyCommand(obj, 'name', oldName, newName, `Rename "${oldName}" → "${newName}"`));
      obj.name = newName;
      this.editor.hierarchy.refresh();
    });

    body.querySelector('[data-prop="visible"]')?.addEventListener('change', (e) => {
      const newVal = (e.target as HTMLInputElement).checked;
      this.editor.undo.pushDirect(new PropertyCommand(obj, 'visible', !newVal, newVal, `Toggle visibility`));
      obj.visible = newVal;
      this.editor.hierarchy.refresh();
    });

    return section;
  }

  private renderTransformSection(obj: THREE.Object3D): HTMLElement {
    const section = this.createSection('Transform', '✥');
    const body = section.querySelector('.inspector-section-body')!;

    const pos = obj.position;
    const rot = obj.rotation;
    const scl = obj.scale;
    const toDeg = THREE.MathUtils.radToDeg;

    body.innerHTML = `
      <div class="inspector-row">
        <span class="inspector-label">Position</span>
        <div class="inspector-value">
          <input class="inspector-input inspector-input-vec inspector-input-x" type="number" step="0.1" value="${pos.x.toFixed(3)}" data-transform="px" />
          <input class="inspector-input inspector-input-vec inspector-input-y" type="number" step="0.1" value="${pos.y.toFixed(3)}" data-transform="py" />
          <input class="inspector-input inspector-input-vec inspector-input-z" type="number" step="0.1" value="${pos.z.toFixed(3)}" data-transform="pz" />
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Rotation</span>
        <div class="inspector-value">
          <input class="inspector-input inspector-input-vec inspector-input-x" type="number" step="1" value="${toDeg(rot.x).toFixed(1)}" data-transform="rx" />
          <input class="inspector-input inspector-input-vec inspector-input-y" type="number" step="1" value="${toDeg(rot.y).toFixed(1)}" data-transform="ry" />
          <input class="inspector-input inspector-input-vec inspector-input-z" type="number" step="1" value="${toDeg(rot.z).toFixed(1)}" data-transform="rz" />
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Scale</span>
        <div class="inspector-value">
          <input class="inspector-input inspector-input-vec inspector-input-x" type="number" step="0.1" value="${scl.x.toFixed(3)}" data-transform="sx" />
          <input class="inspector-input inspector-input-vec inspector-input-y" type="number" step="0.1" value="${scl.y.toFixed(3)}" data-transform="sy" />
          <input class="inspector-input inspector-input-vec inspector-input-z" type="number" step="0.1" value="${scl.z.toFixed(3)}" data-transform="sz" />
        </div>
      </div>
    `;

    const toRad = THREE.MathUtils.degToRad;
    let transformSnapshot: TransformSnapshot | null = null;
    let inputDebounceId = 0;

    body.querySelectorAll('[data-transform]').forEach((input) => {
      // Capture snapshot when the user focuses the input
      input.addEventListener('focus', () => {
        transformSnapshot = TransformCommand.capture(obj);
      });

      input.addEventListener('input', () => {
        const prop = (input as HTMLElement).dataset.transform!;
        const val = parseFloat((input as HTMLInputElement).value) || 0;
        switch (prop) {
          case 'px': obj.position.x = val; break;
          case 'py': obj.position.y = val; break;
          case 'pz': obj.position.z = val; break;
          case 'rx': obj.rotation.x = toRad(val); break;
          case 'ry': obj.rotation.y = toRad(val); break;
          case 'rz': obj.rotation.z = toRad(val); break;
          case 'sx': obj.scale.x = val; break;
          case 'sy': obj.scale.y = val; break;
          case 'sz': obj.scale.z = val; break;
        }
        // Debounce any heavy refresh triggered by transform changes
        clearTimeout(inputDebounceId);
        inputDebounceId = window.setTimeout(() => {
          this.editor.viewport?.refresh();
        }, 100);
      });

      // Push undo command when the user leaves the input
      input.addEventListener('blur', () => {
        if (transformSnapshot) {
          const after = TransformCommand.capture(obj);
          const cmd = TransformCommand.fromSnapshots(obj, transformSnapshot, after);
          this.editor.undo.pushDirect(cmd);
          transformSnapshot = null;
        }
      });
    });

    return section;
  }

  private renderMeshSection(mesh: THREE.Mesh): HTMLElement {
    const section = this.createSection('Mesh', '🔷');
    const body = section.querySelector('.inspector-section-body')!;

    const geo = mesh.geometry;
    const vertCount = geo.attributes.position?.count ?? 0;
    const faceCount = geo.index ? geo.index.count / 3 : vertCount / 3;
    const hasNormals = !!geo.attributes.normal;
    const hasUVs = !!geo.attributes.uv;
    const hasTangents = !!geo.attributes.tangent;

    body.innerHTML = `
      <div class="inspector-row"><span class="inspector-label">Vertices</span><span style="color:#2ecc71;">${vertCount.toLocaleString()}</span></div>
      <div class="inspector-row"><span class="inspector-label">Faces</span><span style="color:#2ecc71;">${Math.floor(faceCount).toLocaleString()}</span></div>
      <div class="inspector-row"><span class="inspector-label">Normals</span><span>${hasNormals ? '✅' : '❌'}</span></div>
      <div class="inspector-row"><span class="inspector-label">UVs</span><span>${hasUVs ? '✅' : '❌'}</span></div>
      <div class="inspector-row"><span class="inspector-label">Tangents</span><span>${hasTangents ? '✅' : '❌'}</span></div>
      <div class="inspector-row">
        <span class="inspector-label">Shadows</span>
        <div class="inspector-value">
          <label style="font-size:10px;color:#888;">Cast <input class="inspector-checkbox" type="checkbox" ${mesh.castShadow ? 'checked' : ''} data-shadow="cast" /></label>
          <label style="font-size:10px;color:#888;margin-left:8px;">Recv <input class="inspector-checkbox" type="checkbox" ${mesh.receiveShadow ? 'checked' : ''} data-shadow="receive" /></label>
        </div>
      </div>
    `;

    body.querySelector('[data-shadow="cast"]')?.addEventListener('change', (e) => {
      const newVal = (e.target as HTMLInputElement).checked;
      this.editor.undo.pushDirect(new PropertyCommand(mesh, 'castShadow', !newVal, newVal, 'Toggle cast shadow'));
      mesh.castShadow = newVal;
    });
    body.querySelector('[data-shadow="receive"]')?.addEventListener('change', (e) => {
      const newVal = (e.target as HTMLInputElement).checked;
      this.editor.undo.pushDirect(new PropertyCommand(mesh, 'receiveShadow', !newVal, newVal, 'Toggle receive shadow'));
      mesh.receiveShadow = newVal;
    });

    return section;
  }

  private renderMaterialSection(mesh: THREE.Mesh, label?: string): HTMLElement {
    const sectionTitle = label ? `Material (${label})` : 'Material';
    const section = this.createSection(sectionTitle, '🎨');
    const body = section.querySelector('.inspector-section-body')!;

    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat || !(mat instanceof THREE.MeshStandardMaterial)) {
      body.innerHTML = `<span style="color:#666;font-size:11px;">Non-standard material: ${(mat as any)?.type ?? 'unknown'}</span>`;
      return section;
    }

    body.innerHTML = `
      <div class="inspector-row">
        <span class="inspector-label">Color</span>
        <div class="inspector-value">
          <input class="inspector-color" type="color" value="#${mat.color.getHexString()}" data-mat="color" />
          <span style="font-size:10px;color:#888;margin-left:4px;">#${mat.color.getHexString()}</span>
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Roughness</span>
        <div class="inspector-value">
          <input class="inspector-input" type="range" min="0" max="1" step="0.01" value="${mat.roughness}" data-mat="roughness" />
          <span style="font-size:10px;color:#888;width:30px;text-align:right;">${mat.roughness.toFixed(2)}</span>
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Metalness</span>
        <div class="inspector-value">
          <input class="inspector-input" type="range" min="0" max="1" step="0.01" value="${mat.metalness}" data-mat="metalness" />
          <span style="font-size:10px;color:#888;width:30px;text-align:right;">${mat.metalness.toFixed(2)}</span>
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Emissive</span>
        <div class="inspector-value">
          <input class="inspector-color" type="color" value="#${mat.emissive.getHexString()}" data-mat="emissive" />
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Opacity</span>
        <div class="inspector-value">
          <input class="inspector-input" type="range" min="0" max="1" step="0.01" value="${mat.opacity}" data-mat="opacity" />
          <span style="font-size:10px;color:#888;width:30px;">${mat.opacity.toFixed(2)}</span>
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Wireframe</span>
        <div class="inspector-value">
          <input class="inspector-checkbox" type="checkbox" ${mat.wireframe ? 'checked' : ''} data-mat="wireframe" />
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Side</span>
        <div class="inspector-value">
          <select class="inspector-select" data-mat="side">
            <option value="0" ${mat.side === THREE.FrontSide ? 'selected' : ''}>Front</option>
            <option value="1" ${mat.side === THREE.BackSide ? 'selected' : ''}>Back</option>
            <option value="2" ${mat.side === THREE.DoubleSide ? 'selected' : ''}>Double</option>
          </select>
        </div>
      </div>
      <hr style="border-color:#333;margin:8px 0;" />
      <div style="font-size:10px;color:#888;margin-bottom:4px;">TEXTURES</div>
      <div class="inspector-row">
        <span class="inspector-label">Diffuse</span>
        <div class="inspector-value">
          ${mat.map ? `<span style="color:#2ecc71;">✅ ${mat.map.image?.width ?? '?'}x${mat.map.image?.height ?? '?'}</span>` : '<span style="color:#666;">None</span>'}
          <button class="inspector-btn" data-tex="map" style="margin-left:auto;">📎</button>
          ${mat.map ? '<button class="inspector-btn inspector-btn-danger" data-tex-remove="map">✕</button>' : ''}
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Normal</span>
        <div class="inspector-value">
          ${mat.normalMap ? `<span style="color:#2ecc71;">✅</span>` : '<span style="color:#666;">None</span>'}
          <button class="inspector-btn" data-tex="normalMap" style="margin-left:auto;">📎</button>
          ${mat.normalMap ? '<button class="inspector-btn inspector-btn-danger" data-tex-remove="normalMap">✕</button>' : ''}
        </div>
      </div>
    `;

    // Material property events
    let colorSnapshot: THREE.Color | null = null;
    const colorInput = body.querySelector('[data-mat="color"]');
    colorInput?.addEventListener('focus', () => { colorSnapshot = mat.color.clone(); });
    colorInput?.addEventListener('input', (e) => {
      mat.color.set((e.target as HTMLInputElement).value);
    });
    colorInput?.addEventListener('change', () => {
      if (colorSnapshot) {
        this.editor.undo.pushDirect(new MaterialColorCommand(mat, colorSnapshot, mat.color.clone()));
        colorSnapshot = null;
      }
    });

    let roughnessOld = mat.roughness;
    const roughInput = body.querySelector('[data-mat="roughness"]');
    roughInput?.addEventListener('focus', () => { roughnessOld = mat.roughness; });
    roughInput?.addEventListener('input', (e) => {
      mat.roughness = parseFloat((e.target as HTMLInputElement).value);
      const span = (e.target as HTMLInputElement).nextElementSibling;
      if (span) span.textContent = mat.roughness.toFixed(2);
    });
    roughInput?.addEventListener('change', () => {
      this.editor.undo.pushDirect(new PropertyCommand(mat, 'roughness', roughnessOld, mat.roughness, 'Change roughness'));
    });

    let metalnessOld = mat.metalness;
    const metalInput = body.querySelector('[data-mat="metalness"]');
    metalInput?.addEventListener('focus', () => { metalnessOld = mat.metalness; });
    metalInput?.addEventListener('input', (e) => {
      mat.metalness = parseFloat((e.target as HTMLInputElement).value);
      const span = (e.target as HTMLInputElement).nextElementSibling;
      if (span) span.textContent = mat.metalness.toFixed(2);
    });
    metalInput?.addEventListener('change', () => {
      this.editor.undo.pushDirect(new PropertyCommand(mat, 'metalness', metalnessOld, mat.metalness, 'Change metalness'));
    });

    let emissiveSnapshot: THREE.Color | null = null;
    const emissiveInput = body.querySelector('[data-mat="emissive"]');
    emissiveInput?.addEventListener('focus', () => { emissiveSnapshot = mat.emissive.clone(); });
    emissiveInput?.addEventListener('input', (e) => {
      mat.emissive.set((e.target as HTMLInputElement).value);
    });
    emissiveInput?.addEventListener('change', () => {
      if (emissiveSnapshot) {
        this.editor.undo.pushDirect(new MaterialColorCommand(mat, emissiveSnapshot, mat.emissive.clone()));
        emissiveSnapshot = null;
      }
    });

    let opacityOld = mat.opacity;
    const opacityInput = body.querySelector('[data-mat="opacity"]');
    opacityInput?.addEventListener('focus', () => { opacityOld = mat.opacity; });
    opacityInput?.addEventListener('input', (e) => {
      mat.opacity = parseFloat((e.target as HTMLInputElement).value);
      mat.transparent = mat.opacity < 1;
      const span = (e.target as HTMLInputElement).nextElementSibling;
      if (span) span.textContent = mat.opacity.toFixed(2);
    });
    opacityInput?.addEventListener('change', () => {
      this.editor.undo.pushDirect(new PropertyCommand(mat, 'opacity', opacityOld, mat.opacity, 'Change opacity'));
    });

    body.querySelector('[data-mat="wireframe"]')?.addEventListener('change', (e) => {
      const newVal = (e.target as HTMLInputElement).checked;
      this.editor.undo.pushDirect(new PropertyCommand(mat, 'wireframe', !newVal, newVal, 'Toggle wireframe'));
      mat.wireframe = newVal;
    });
    body.querySelector('[data-mat="side"]')?.addEventListener('change', (e) => {
      const oldSide = mat.side;
      mat.side = parseInt((e.target as HTMLSelectElement).value) as THREE.Side;
      mat.needsUpdate = true;
      this.editor.undo.pushDirect(new PropertyCommand(mat, 'side', oldSide, mat.side, 'Change side'));
    });

    // Texture upload
    body.querySelectorAll('[data-tex]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prop = (btn as HTMLElement).dataset.tex! as keyof THREE.MeshStandardMaterial;
        this.loadTextureForMaterial(mat, prop);
      });
    });

    // Texture remove
    body.querySelectorAll('[data-tex-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prop = (btn as HTMLElement).dataset.texRemove! as keyof THREE.MeshStandardMaterial;
        (mat as any)[prop] = null;
        mat.needsUpdate = true;
        this.rebuild();
      });
    });

    return section;
  }

  private renderLightSection(light: THREE.Light): HTMLElement {
    const section = this.createSection('Light', '💡');
    const body = section.querySelector('.inspector-section-body')!;

    body.innerHTML = `
      <div class="inspector-row">
        <span class="inspector-label">Color</span>
        <div class="inspector-value">
          <input class="inspector-color" type="color" value="#${light.color.getHexString()}" data-light="color" />
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Intensity</span>
        <div class="inspector-value">
          <input class="inspector-input" type="number" step="0.1" min="0" value="${light.intensity}" data-light="intensity" />
        </div>
      </div>
    `;

    let lightColorSnapshot: THREE.Color | null = null;
    const lightColorInput = body.querySelector('[data-light="color"]');
    lightColorInput?.addEventListener('focus', () => { lightColorSnapshot = light.color.clone(); });
    lightColorInput?.addEventListener('input', (e) => {
      light.color.set((e.target as HTMLInputElement).value);
    });
    lightColorInput?.addEventListener('change', () => {
      if (lightColorSnapshot) {
        this.editor.undo.pushDirect(new MaterialColorCommand(light as any, lightColorSnapshot, light.color.clone()));
        lightColorSnapshot = null;
      }
    });

    let intensityOld = light.intensity;
    const intensityInput = body.querySelector('[data-light="intensity"]');
    intensityInput?.addEventListener('focus', () => { intensityOld = light.intensity; });
    intensityInput?.addEventListener('input', (e) => {
      light.intensity = parseFloat((e.target as HTMLInputElement).value) || 0;
    });
    intensityInput?.addEventListener('change', () => {
      this.editor.undo.pushDirect(new PropertyCommand(light, 'intensity', intensityOld, light.intensity, 'Change light intensity'));
    });

    return section;
  }

  private renderCameraSection(cam: THREE.PerspectiveCamera): HTMLElement {
    const section = this.createSection('Camera', '📷');
    const body = section.querySelector('.inspector-section-body')!;

    body.innerHTML = `
      <div class="inspector-row">
        <span class="inspector-label">FOV</span>
        <div class="inspector-value">
          <input class="inspector-input" type="number" step="1" min="10" max="120" value="${cam.fov}" data-cam="fov" />
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Near</span>
        <div class="inspector-value">
          <input class="inspector-input" type="number" step="0.01" min="0.01" value="${cam.near}" data-cam="near" />
        </div>
      </div>
      <div class="inspector-row">
        <span class="inspector-label">Far</span>
        <div class="inspector-value">
          <input class="inspector-input" type="number" step="1" min="1" value="${cam.far}" data-cam="far" />
        </div>
      </div>
      <div style="margin-top:8px;">
        <button class="inspector-btn inspector-btn-primary" data-cam-action="preview">👁 Preview Camera</button>
      </div>
    `;

    body.querySelectorAll('[data-cam]').forEach((input) => {
      input.addEventListener('input', () => {
        const prop = (input as HTMLElement).dataset.cam!;
        const val = parseFloat((input as HTMLInputElement).value) || 0;
        switch (prop) {
          case 'fov': cam.fov = val; break;
          case 'near': cam.near = val; break;
          case 'far': cam.far = val; break;
        }
        cam.updateProjectionMatrix();
      });
    });

    body.querySelector('[data-cam-action="preview"]')?.addEventListener('click', () => {
      this.editor.previewCamera(cam);
    });

    return section;
  }

  private renderGroupSection(obj: THREE.Object3D): HTMLElement {
    const section = this.createSection('Children', '📁');
    const body = section.querySelector('.inspector-section-body')!;

    let meshCount = 0, boneCount = 0, animCount = 0;
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) meshCount++;
      if (child instanceof THREE.Bone) boneCount++;
    });

    body.innerHTML = `
      <div class="inspector-row"><span class="inspector-label">Children</span><span>${obj.children.length}</span></div>
      <div class="inspector-row"><span class="inspector-label">Meshes</span><span style="color:#2ecc71;">${meshCount}</span></div>
      <div class="inspector-row"><span class="inspector-label">Bones</span><span style="color:#e67e22;">${boneCount}</span></div>
    `;

    return section;
  }

  private renderMultiSelectSection(count: number): HTMLElement {
    const section = this.createSection(`Selection (${count} objects)`, '🔘');
    const body = section.querySelector('.inspector-section-body')!;

    // List selected objects
    const objects = Array.from(this.editor.selection);
    let listHtml = '';
    for (const obj of objects.slice(0, 20)) {
      const name = obj.name || obj.type;
      listHtml += `<div style="font-size:10px;color:#aaa;padding:2px 0;border-bottom:1px solid #333;">
        <span style="color:#0078d4;margin-right:4px;">●</span>${this.esc(name)}
      </div>`;
    }
    if (objects.length > 20) {
      listHtml += `<div style="font-size:10px;color:#666;padding:2px 0;">... and ${objects.length - 20} more</div>`;
    }

    // Count types
    const types = new Map<string, number>();
    for (const obj of objects) {
      types.set(obj.type, (types.get(obj.type) || 0) + 1);
    }
    let typeSummary = '';
    for (const [type, n] of types) {
      typeSummary += `<span style="background:#333;padding:1px 6px;border-radius:2px;font-size:10px;color:#aaa;">${type}: ${n}</span> `;
    }

    body.innerHTML = `
      <div style="margin-bottom:6px;display:flex;flex-wrap:wrap;gap:4px;">${typeSummary}</div>
      <div style="max-height:120px;overflow-y:auto;">${listHtml}</div>
    `;

    return section;
  }

  private renderActionsSection(obj: THREE.Object3D): HTMLElement {
    const section = this.createSection('Actions', '⚡');
    const body = section.querySelector('.inspector-section-body')!;

    body.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:4px;">
        <button class="inspector-btn" data-action="focus">🎯 Focus</button>
        <button class="inspector-btn" data-action="duplicate">📋 Duplicate</button>
        <button class="inspector-btn" data-action="reset-transform">↺ Reset Transform</button>
        <button class="inspector-btn inspector-btn-danger" data-action="delete">🗑 Delete</button>
      </div>
    `;

    body.querySelector('[data-action="focus"]')?.addEventListener('click', () => this.editor.focusSelected());
    body.querySelector('[data-action="duplicate"]')?.addEventListener('click', () => this.editor.duplicateSelected());
    body.querySelector('[data-action="delete"]')?.addEventListener('click', () => this.editor.deleteSelected());
    body.querySelector('[data-action="reset-transform"]')?.addEventListener('click', () => {
      obj.position.set(0, 0, 0);
      obj.rotation.set(0, 0, 0);
      obj.scale.set(1, 1, 1);
      this.rebuild();
    });

    return section;
  }

  private renderScriptSection(obj: THREE.Object3D): HTMLElement {
    const section = this.createSection('Script / Blueprint', '🔗');
    const body = section.querySelector('.inspector-section-body')!;

    const hasBlueprint = !!obj.userData.__blueprint;
    const hasLuaScript = !!obj.userData.__luaScript;

    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${hasBlueprint
            ? '<button class="inspector-btn" data-action="edit-bp" style="flex:1;">🔗 Edit Blueprint</button><button class="inspector-btn inspector-btn-danger" data-action="remove-bp" style="width:28px;">✗</button>'
            : '<button class="inspector-btn" data-action="add-bp" style="flex:1;">+ Add Blueprint</button>'}
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${hasLuaScript
            ? '<button class="inspector-btn" data-action="edit-lua" style="flex:1;">📝 Edit Script</button><button class="inspector-btn inspector-btn-danger" data-action="remove-lua" style="width:28px;">✗</button>'
            : '<button class="inspector-btn" data-action="add-lua" style="flex:1;">+ Add Lua Script</button>'}
        </div>
        ${hasBlueprint ? '<div style="font-size:9px;color:#58a6ff;">Blueprint: ' + (obj.userData.__blueprint.nodes?.length || 0) + ' nodes</div>' : ''}
        ${hasLuaScript ? '<div style="font-size:9px;color:#f0ad4e;">Script: ' + (obj.userData.__luaScript.split('\\n').length || 0) + ' lines</div>' : ''}
      </div>
    `;

    // Add Blueprint
    body.querySelector('[data-action="add-bp"]')?.addEventListener('click', () => {
      obj.userData.__blueprint = { nodes: [], connections: [], variables: [] };
      this.rebuild();
      this.openBlueprintForObject(obj);
    });

    // Edit Blueprint
    body.querySelector('[data-action="edit-bp"]')?.addEventListener('click', () => {
      this.openBlueprintForObject(obj);
    });

    // Remove Blueprint
    body.querySelector('[data-action="remove-bp"]')?.addEventListener('click', () => {
      delete obj.userData.__blueprint;
      this.rebuild();
    });

    // Add Lua Script
    body.querySelector('[data-action="add-lua"]')?.addEventListener('click', () => {
      obj.userData.__luaScript = '-- ' + (obj.name || 'Object') + ' script\nfunction onStart(self)\n  print("Started: " .. self.name)\nend\n\nfunction onUpdate(self, dt)\n  -- Update logic here\nend\n\nfunction onCollision(self, other)\n  -- Collision logic here\nend\n';
      this.rebuild();
      this.openScriptEditorForObject(obj);
    });

    // Edit Script
    body.querySelector('[data-action="edit-lua"]')?.addEventListener('click', () => {
      this.openScriptEditorForObject(obj);
    });

    // Remove Script
    body.querySelector('[data-action="remove-lua"]')?.addEventListener('click', () => {
      delete obj.userData.__luaScript;
      this.rebuild();
    });

    return section;
  }

  private openBlueprintForObject(obj: THREE.Object3D): void {
    // Switch to blueprints tab and load this object's blueprint graph
    this.editor.switchTab('blueprints');
    const vsEditor = this.editor.visualScript;
    if (vsEditor && obj.userData.__blueprint) {
      vsEditor.setGraph(obj.userData.__blueprint);
      vsEditor.onGraphChanged = () => {
        obj.userData.__blueprint = vsEditor.getGraph();
      };
    }
  }

  private openScriptEditorForObject(obj: THREE.Object3D): void {
    // Open a modal/overlay with a text editor for the Lua script
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1e1e2e;border:1px solid #444;border-radius:8px;width:700px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.5);';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #333;';
    header.innerHTML = `<span style="font-weight:600;color:#ccc;">📝 Script — ${obj.name || 'Object'}</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:16px;cursor:pointer;';
    closeBtn.onclick = () => {
      obj.userData.__luaScript = textarea.value;
      overlay.remove();
      this.rebuild();
    };
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    const textarea = document.createElement('textarea');
    textarea.value = obj.userData.__luaScript || '';
    textarea.style.cssText = 'flex:1;min-height:400px;background:#111;color:#d4d4d4;border:none;padding:16px;font-family:"Cascadia Code","Fira Code",Consolas,monospace;font-size:13px;line-height:1.5;resize:none;outline:none;tab-size:2;';
    textarea.spellcheck = false;
    // Handle Tab key for indentation
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }
      if (e.key === 'Escape') {
        closeBtn.click();
      }
    });
    dialog.appendChild(textarea);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid #333;';
    footer.innerHTML = `
      <button class="inspector-btn" style="padding:6px 16px;" id="script-save-btn">💾 Save & Close</button>
    `;
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    textarea.focus();

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeBtn.click();
    });

    footer.querySelector('#script-save-btn')?.addEventListener('click', () => {
      closeBtn.click();
    });
  }

  private renderECSSection(obj: THREE.Object3D): HTMLElement {
    const section = this.createSection('ECS Components', '🧩');
    const body = section.querySelector('.inspector-section-body')!;

    // Find entity that owns this object3D
    const world = this.editor.engine.world;
    let foundEntity: any = null;

    for (const entity of world.allEntities) {
      const components = entity.getAll();
      for (const comp of components) {
        if ((comp as any).object3D === obj) {
          foundEntity = entity;
          break;
        }
      }
      if (foundEntity) break;
    }

    if (!foundEntity) {
      body.innerHTML = `
        <div style="color:#666;font-size:10px;padding:4px;">No ECS entity linked</div>
        <button class="inspector-btn" style="width:100%;margin-top:4px;padding:6px;background:#0a3a0a;border:1px solid #1a5a1a;color:#4a4;font-size:10px;cursor:pointer;border-radius:3px;" id="ecs-create-entity">
          + Create Entity for this Object
        </button>
      `;
      body.querySelector('#ecs-create-entity')?.addEventListener('click', () => {
        const entity = world.createEntity(obj.name || 'Entity');
        // Import and add a MeshComponent to link the object
        import('../../ecs/components/GameComponents').then(({ MeshComponent }) => {
          entity.add(new MeshComponent(obj));
          this.rebuild();
        });
      });
      return section;
    }

    const components = foundEntity.getAll();
    let html = `<div style="font-size:10px;color:#888;margin-bottom:4px;">Entity: <span style="color:#0078d4;">${foundEntity.name || `#${foundEntity.id}`}</span> (${components.length} components)</div>`;

    for (const comp of components) {
      const name = comp.constructor.name;
      html += `<div style="margin-top:4px;padding:4px;background:#1e1e1e;border-radius:3px;border-left:2px solid #0078d4;position:relative;">`;
      html += `<div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-size:10px;font-weight:600;color:#aaa;">${name}</span><button class="ecs-remove-btn" data-comp="${name}" style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:10px;padding:0 2px;" title="Remove">✕</button></div>`;

      // Show key properties of known component types
      const props = Object.getOwnPropertyNames(comp).filter(k => k !== 'object3D' && !k.startsWith('_') && k !== 'entity');
      for (const key of props) {
        const val = (comp as any)[key];
        let display: string;
        if (val && typeof val === 'object' && 'x' in val && 'y' in val) {
          display = `${val.x?.toFixed?.(2) ?? val.x}, ${val.y?.toFixed?.(2) ?? val.y}, ${val.z?.toFixed?.(2) ?? val.z}`;
        } else if (typeof val === 'boolean') {
          display = val ? '✓' : '✗';
        } else if (typeof val === 'number') {
          display = String(parseFloat(val.toFixed(3)));
        } else if (typeof val === 'string') {
          display = val || '(empty)';
        } else {
          continue;
        }
        html += `<div style="display:flex;justify-content:space-between;font-size:10px;padding:1px 0;">
          <span style="color:#888;">${key}</span>
          <span style="color:#ccc;font-family:monospace;">${display}</span>
        </div>`;
      }
      html += `</div>`;
    }

    // Add Component button (like UE)
    html += `<button class="inspector-btn" id="ecs-add-comp-btn" style="width:100%;margin-top:8px;padding:6px;background:#0a3a0a;border:1px solid #1a5a1a;color:#4a4;font-size:10px;cursor:pointer;border-radius:3px;">+ Add Component</button>`;

    body.innerHTML = html;

    // Remove component buttons
    body.querySelectorAll('.ecs-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const compName = (btn as HTMLElement).dataset.comp;
        const comp = foundEntity.getAll().find((c: any) => c.constructor.name === compName);
        if (comp) {
          foundEntity.remove(comp.constructor);
          this.rebuild();
        }
      });
    });

    // Add Component dropdown
    body.querySelector('#ecs-add-comp-btn')?.addEventListener('click', (e) => {
      this.showAddComponentMenu(e as MouseEvent, foundEntity);
    });

    return section;
  }

  private showAddComponentMenu(e: MouseEvent, entity: any): void {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const componentOptions = [
      { group: '3D / Core', items: [
        { name: 'PhysicsBodyComponent', module: 'GameComponents' },
        { name: 'AnimationComponent', module: 'GameComponents' },
        { name: 'StateMachineComponent', module: 'GameComponents' },
        { name: 'CameraFollowComponent', module: 'GameComponents' },
        { name: 'HealthComponent', module: 'GameComponents' },
        { name: 'NetworkComponent', module: 'GameComponents' },
      ]},
      { group: '2D / Gameplay', items: [
        { name: 'CharacterControllerComponent', module: 'GameComponents2D' },
        { name: 'AIComponent', module: 'GameComponents2D' },
        { name: 'AudioSourceComponent', module: 'GameComponents2D' },
        { name: 'TriggerZoneComponent', module: 'GameComponents2D' },
        { name: 'InteractableComponent', module: 'GameComponents2D' },
        { name: 'LifetimeComponent', module: 'GameComponents2D' },
        { name: 'InventoryHolderComponent', module: 'GameComponents2D' },
        { name: 'DialogueTriggerComponent', module: 'GameComponents2D' },
        { name: 'PathAgentComponent', module: 'GameComponents2D' },
        { name: 'LootDropComponent', module: 'GameComponents2D' },
      ]},
      { group: 'Tags', items: [
        { name: 'PlayerTag', module: 'GameComponents2D' },
        { name: 'EnemyTag', module: 'GameComponents2D' },
        { name: 'NPCTag', module: 'GameComponents2D' },
      ]},
    ];

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = (e as MouseEvent).clientX + 'px';
    menu.style.top = (e as MouseEvent).clientY + 'px';
    menu.style.maxHeight = '300px';
    menu.style.overflowY = 'auto';

    // Search input
    const searchDiv = document.createElement('div');
    searchDiv.style.cssText = 'padding:4px;border-bottom:1px solid #333;';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search components...';
    searchInput.style.cssText = 'width:100%;padding:3px 6px;background:#1e1e1e;border:1px solid #444;color:#fff;font-size:10px;border-radius:2px;box-sizing:border-box;';
    searchDiv.appendChild(searchInput);
    menu.appendChild(searchDiv);

    const listEl = document.createElement('div');
    menu.appendChild(listEl);

    const buildList = (filter: string) => {
      listEl.innerHTML = '';
      for (const group of componentOptions) {
        const filteredItems = group.items.filter(i => !filter || i.name.toLowerCase().includes(filter));
        if (filteredItems.length === 0) continue;

        const groupHeader = document.createElement('div');
        groupHeader.style.cssText = 'padding:3px 10px;font-size:9px;color:#666;font-weight:600;border-bottom:1px solid #333;';
        groupHeader.textContent = group.group;
        listEl.appendChild(groupHeader);

        for (const item of filteredItems) {
          const existing = entity.getAll().find((c: any) => c.constructor.name === item.name);
          const el = document.createElement('div');
          el.className = 'context-menu-item';
          el.style.cssText = existing ? 'opacity:0.4;pointer-events:none;' : '';
          el.textContent = (existing ? '✓ ' : '') + item.name.replace('Component', '').replace('Tag', ' (Tag)');
          el.addEventListener('click', () => {
            this.addComponentToEntity(entity, item.name, item.module);
            menu.remove();
          });
          listEl.appendChild(el);
        }
      }
    };

    buildList('');
    searchInput.addEventListener('input', () => buildList(searchInput.value.toLowerCase()));

    document.body.appendChild(menu);
    searchInput.focus();

    const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  private async addComponentToEntity(entity: any, compName: string, module: string): Promise<void> {
    try {
      let mod: any;
      if (module === 'GameComponents') {
        mod = await import('../../ecs/components/GameComponents');
      } else {
        mod = await import('../../ecs/components/GameComponents2D');
      }

      const CompClass = mod[compName];
      if (!CompClass) { console.warn(`Component ${compName} not found in ${module}`); return; }

      // Most components have no required constructor params or have defaults
      entity.add(new CompClass());
      this.rebuild();
    } catch (err) {
      console.error(`Failed to add component ${compName}:`, err);
    }
  }

  // --- Helpers ---

  private createSection(title: string, icon: string): HTMLElement {
    const section = document.createElement('div');
    section.className = 'inspector-section';
    const isCollapsed = this.collapsedSections.has(title);
    section.innerHTML = `
      <div class="inspector-section-header">
        <span class="section-arrow">${isCollapsed ? '▶' : '▼'}</span>
        <span>${icon}</span><span>${title}</span>
      </div>
      <div class="inspector-section-body" ${isCollapsed ? 'style="display:none;"' : ''}></div>
    `;

    // Toggle collapse with persistence
    const header = section.querySelector('.inspector-section-header')!;
    const body = section.querySelector('.inspector-section-body')!;
    const arrow = section.querySelector('.section-arrow')!;
    header.addEventListener('click', () => {
      const hidden = (body as HTMLElement).style.display === 'none';
      (body as HTMLElement).style.display = hidden ? '' : 'none';
      arrow.textContent = hidden ? '▼' : '▶';
      if (hidden) {
        this.collapsedSections.delete(title);
      } else {
        this.collapsedSections.add(title);
      }
    });

    return section;
  }

  private loadTextureForMaterial(mat: THREE.MeshStandardMaterial, prop: string): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const loader = new THREE.TextureLoader();
      loader.load(url, (texture) => {
        texture.colorSpace = prop === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
        (mat as any)[prop] = texture;
        mat.needsUpdate = true;
        this.rebuild();
        URL.revokeObjectURL(url);
      });
    };
    input.click();
  }

  private esc(text: string): string {
    return text.replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}
