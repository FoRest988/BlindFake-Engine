import * as THREE from 'three';
import type { EditorApp } from '../EditorApp';
import { PropertyCommand, ReparentCommand, AddObjectCommand, GroupCommand as UndoGroupCommand } from '../UndoManager';

export class EditorHierarchy {
  private editor: EditorApp;
  private container!: HTMLElement;
  private listEl!: HTMLElement;
  private collapsed = new Set<string>();
  private locked = new Set<string>();
  private draggedObject: THREE.Object3D | null = null;

  constructor(editor: EditorApp) {
    this.editor = editor;
  }

  render(): HTMLElement {
    this.container = document.createElement('div');
    this.container.style.cssText = 'display:flex;flex-direction:column;height:100%;';

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = `<span>📂 Hierarchy</span><button class="toolbar-btn" style="width:20px;height:20px;font-size:14px;" id="hier-add-btn">+</button>`;
    this.container.appendChild(header);

    // Search
    const search = document.createElement('div');
    search.style.cssText = 'padding:4px 8px;background:#1e1e1e;border-bottom:1px solid #333;';
    search.innerHTML = `<input type="text" placeholder="Search..." style="width:100%;padding:3px 6px;background:#2a2a2a;border:1px solid #444;color:#ccc;border-radius:2px;font-size:11px;" id="hier-search" />`;
    this.container.appendChild(search);

    // List
    this.listEl = document.createElement('div');
    this.listEl.className = 'panel-content';
    this.listEl.style.padding = '0';
    this.container.appendChild(this.listEl);

    this.rebuild();

    // Search filter
    const searchInput = this.container.querySelector('#hier-search') as HTMLInputElement;
    searchInput?.addEventListener('input', () => {
      this.rebuild(searchInput.value.toLowerCase());
    });

    // Add button context menu
    this.container.querySelector('#hier-add-btn')?.addEventListener('click', (e) => {
      this.showAddMenu(e as MouseEvent);
    });

    return this.container;
  }

  refresh(): void {
    this.rebuild();
  }

  rebuild(filter = ''): void {
    this.listEl.innerHTML = '';
    const objects = this.editor.getSceneObjects();
    this.renderTree(objects, 0, filter);
    // Auto-scroll selected item into view
    requestAnimationFrame(() => {
      const sel = this.listEl.querySelector('.hierarchy-item.selected') as HTMLElement;
      sel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  private renderTree(objects: THREE.Object3D[], depth: number, filter: string): void {
    for (const obj of objects) {
      if (filter && !obj.name.toLowerCase().includes(filter)) {
        if (obj.children.length > 0) {
          this.renderTree(obj.children, depth, filter);
        }
        continue;
      }

      const item = document.createElement('div');
      item.className = 'hierarchy-item' + (this.editor.state.selectedObject === obj ? ' selected' : '');
      item.style.setProperty('--depth', String(depth));
      item.draggable = true;
      item.dataset.uuid = obj.uuid;

      const icon = this.getObjectIcon(obj);
      const filteredChildren = obj.children.filter(c =>
        !(c instanceof THREE.BoxHelper) &&
        !(c instanceof THREE.SkeletonHelper) &&
        !(c instanceof THREE.CameraHelper) &&
        !c.name.endsWith('_helper') &&
        !c.userData.__editorOnly &&
        !c.userData.__editorHelper
      );
      const hasChildren = filteredChildren.length > 0;
      const isCollapsed = this.collapsed.has(obj.uuid);

      const isLocked = this.locked.has(obj.uuid);
      const isHidden = !obj.visible;

      // Name styling: dimmed + strikethrough when hidden, dimmed when locked
      let nameStyle = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      if (isHidden) nameStyle += 'opacity:0.35;text-decoration:line-through;color:#888;';
      else if (isLocked) nameStyle += 'opacity:0.5;';

      item.innerHTML = `
        <span class="expand-btn" style="cursor:pointer;width:14px;display:inline-block;text-align:center;font-size:10px;">${hasChildren ? (isCollapsed ? '▶' : '▼') : ' '}</span>
        <span class="icon" style="${isHidden ? 'opacity:0.3;' : ''}">${icon}</span>
        <span class="hierarchy-name" style="${nameStyle}">${this.escapeHtml(obj.name || 'Unnamed')}</span>
        <span class="lock-btn" title="Toggle lock" style="cursor:pointer;opacity:0.5;font-size:10px;">${isLocked ? '🔒' : '🔓'}</span>
        <span class="visibility-btn" title="${isHidden ? 'Show' : 'Hide'}" style="cursor:pointer;${isHidden ? 'opacity:0.2;' : 'opacity:0.7;'}font-size:12px;">👁</span>
      `;

      // ── Drag-and-drop for reparenting ──
      item.draggable = !isLocked;
      item.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        if (isLocked) { e.preventDefault(); return; }
        this.draggedObject = obj;
        item.classList.add('dragging');
        e.dataTransfer!.effectAllowed = 'move';
        e.dataTransfer!.setData('text/plain', obj.uuid);
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        this.draggedObject = null;
        this.listEl.querySelectorAll('.drag-over-top,.drag-over-middle,.drag-over-bottom').forEach(
          el => el.classList.remove('drag-over-top', 'drag-over-middle', 'drag-over-bottom')
        );
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.draggedObject || this.draggedObject === obj) return;
        // Don't allow dropping onto a descendant of the dragged object
        if (this.isDescendant(this.draggedObject, obj)) return;
        e.dataTransfer!.dropEffect = 'move';

        const rect = item.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const zone = rect.height / 3;

        item.classList.remove('drag-over-top', 'drag-over-middle', 'drag-over-bottom');
        if (y < zone) {
          item.classList.add('drag-over-top');
        } else if (y > zone * 2) {
          item.classList.add('drag-over-bottom');
        } else {
          item.classList.add('drag-over-middle');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over-top', 'drag-over-middle', 'drag-over-bottom');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.classList.remove('drag-over-top', 'drag-over-middle', 'drag-over-bottom');
        if (!this.draggedObject || this.draggedObject === obj) return;
        if (this.isDescendant(this.draggedObject, obj)) return;

        const rect = item.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const zone = rect.height / 3;

        if (y < zone || y > zone * 2) {
          // Drop as sibling (before/after) — reparent to same parent
          const targetParent = obj.parent || this.editor.scene;
          this.editor.undo.execute(new ReparentCommand(this.draggedObject, targetParent));
        } else {
          // Drop as child
          this.editor.undo.execute(new ReparentCommand(this.draggedObject, obj));
          // Auto-expand the target so the child is visible
          this.collapsed.delete(obj.uuid);
        }

        this.draggedObject = null;
        this.rebuild();
        this.editor.hierarchy.refresh();
      });

      // Expand/collapse toggle
      if (hasChildren) {
        item.querySelector('.expand-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.collapsed.has(obj.uuid)) {
            this.collapsed.delete(obj.uuid);
          } else {
            this.collapsed.add(obj.uuid);
          }
          this.rebuild();
        });
      }

      // Click to select
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLocked) return;
        this.editor.select(obj);
      });

      // Double-click to inline rename (blocked when locked)
      item.querySelector('.hierarchy-name')?.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (isLocked) return;
        this.startInlineRename(item, obj);
      });

      // Visibility toggle
      item.querySelector('.visibility-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.editor.undo.execute(new PropertyCommand(obj, 'visible', obj.visible, !obj.visible, `${obj.visible ? 'Hide' : 'Show'} ${obj.name}`));
        this.rebuild();
      });

      // Lock toggle
      item.querySelector('.lock-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.locked.has(obj.uuid)) {
          this.locked.delete(obj.uuid);
        } else {
          this.locked.add(obj.uuid);
        }
        this.rebuild();
      });

      // Right-click context menu
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isLocked) this.editor.select(obj);
        this.showContextMenu(e, obj);
      });

      this.listEl.appendChild(item);

      // Render children if expanded
      if (hasChildren && !isCollapsed && !filter) {
        this.renderTree(
          filteredChildren,
          depth + 1,
          filter
        );
      }
    }
  }

  private isDescendant(potentialParent: THREE.Object3D, child: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = child;
    while (current) {
      if (current === potentialParent) return true;
      current = current.parent;
    }
    return false;
  }

  private startInlineRename(item: HTMLElement, obj: THREE.Object3D): void {
    const nameEl = item.querySelector('.hierarchy-name') as HTMLElement;
    if (!nameEl) return;
    const input = document.createElement('input');
    input.className = 'hierarchy-rename-input';
    input.value = obj.name || '';
    input.type = 'text';

    const commit = () => {
      const newName = input.value.trim();
      if (newName && newName !== obj.name) {
        this.editor.undo.execute(new PropertyCommand(obj, 'name', obj.name, newName, `Rename to ${newName}`));
      }
      this.rebuild();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); }
      if (e.key === 'Escape') { this.rebuild(); }
      e.stopPropagation(); // Don't trigger editor shortcuts while typing
    });

    nameEl.innerHTML = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();
  }

  private getObjectIcon(obj: THREE.Object3D): string {
    if (obj instanceof THREE.PerspectiveCamera || obj instanceof THREE.OrthographicCamera) return '📷';
    if (obj instanceof THREE.DirectionalLight) return '☀️';
    if (obj instanceof THREE.PointLight) return '💡';
    if (obj instanceof THREE.SpotLight) return '🔦';
    if (obj instanceof THREE.AmbientLight) return '🌤';
    if (obj instanceof THREE.SkinnedMesh) return '🦴';
    if (obj instanceof THREE.Mesh) return '🔷';
    if (obj instanceof THREE.Group) return '📁';
    if (obj instanceof THREE.Bone) return '🦴';
    return '⬡';
  }

  private showContextMenu(e: MouseEvent, obj: THREE.Object3D): void {
    // Remove existing
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const isLocked = this.locked.has(obj.uuid);

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    // Disabled style for locked items
    const dis = isLocked ? 'pointer-events:none;opacity:0.3;' : '';

    menu.innerHTML = `
      <div class="context-menu-item" data-action="focus">Focus <span class="shortcut">F</span></div>
      <div class="context-menu-item" data-action="duplicate" style="${dis}">Duplicate <span class="shortcut">Ctrl+D</span></div>
      <div class="context-menu-item" data-action="rename" style="${dis}">Rename</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="group" style="${dis}">Group into Empty <span class="shortcut">Ctrl+G</span></div>
      <div class="context-menu-item" data-action="unparent" style="${dis}">Detach from Parent</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="hide">${obj.visible ? 'Hide' : 'Show'}</div>
      <div class="context-menu-item" data-action="lock">${isLocked ? '🔓 Unlock' : '🔒 Lock'}</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="copy-name">Copy Name</div>
      <div class="context-menu-item" data-action="select-children" style="${dis}">Select All Children</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="delete" style="color:#e74c3c;${dis}">Delete <span class="shortcut">Del</span></div>
    `;

    document.body.appendChild(menu);

    menu.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest('.context-menu-item')?.getAttribute('data-action');
      switch (action) {
        case 'focus': this.editor.focusSelected(); break;
        case 'duplicate': this.editor.duplicateSelected(); break;
        case 'rename': this.promptRename(obj); break;
        case 'hide':
          this.editor.undo.execute(new PropertyCommand(obj, 'visible', obj.visible, !obj.visible, `${obj.visible ? 'Hide' : 'Show'} ${obj.name}`));
          this.rebuild();
          break;
        case 'lock':
          if (this.locked.has(obj.uuid)) this.locked.delete(obj.uuid);
          else this.locked.add(obj.uuid);
          this.rebuild();
          break;
        case 'group': {
          const group = new THREE.Group();
          group.name = `${obj.name}_Group`;
          const parent = obj.parent || this.editor.scene;
          group.position.copy(obj.position);
          // Use undo: add group, then reparent obj into it
          this.editor.undo.execute(new UndoGroupCommand('Group Object', [
            new AddObjectCommand(parent as THREE.Scene, group),
            new ReparentCommand(obj, group),
          ]));
          obj.position.set(0, 0, 0);
          this.editor.select(group);
          this.rebuild();
          break;
        }
        case 'unparent': {
          if (obj.parent && obj.parent !== this.editor.scene) {
            const worldPos = new THREE.Vector3();
            obj.getWorldPosition(worldPos);
            this.editor.undo.execute(new ReparentCommand(obj, this.editor.scene));
            obj.position.copy(worldPos);
            this.rebuild();
          }
          break;
        }
        case 'copy-name':
          navigator.clipboard.writeText(obj.name || 'Unnamed');
          break;
        case 'select-children':
          obj.children.forEach(c => (this.editor.selection as Set<THREE.Object3D>).add(c));
          this.rebuild();
          break;
        case 'delete': this.editor.deleteSelected(); break;
      }
      menu.remove();
    });

    // Close on click elsewhere
    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  private showAddMenu(e: MouseEvent): void {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.innerHTML = `
      <div class="context-menu-item" data-add="cube">▣ Cube</div>
      <div class="context-menu-item" data-add="sphere">● Sphere</div>
      <div class="context-menu-item" data-add="plane">▬ Plane</div>
      <div class="context-menu-item" data-add="cylinder">⊙ Cylinder</div>
      <div class="context-menu-item" data-add="capsule">⬭ Capsule</div>
      <div class="context-menu-item" data-add="cone">△ Cone</div>
      <div class="context-menu-item" data-add="torus">◎ Torus</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-add="directional-light">☀ Directional Light</div>
      <div class="context-menu-item" data-add="point-light">💡 Point Light</div>
      <div class="context-menu-item" data-add="spot-light">🔦 Spot Light</div>
      <div class="context-menu-item" data-add="ambient-light">🌤 Ambient Light</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-add="camera">📷 Camera</div>
      <div class="context-menu-item" data-add="model">📦 Import Model...</div>
    `;

    document.body.appendChild(menu);

    menu.addEventListener('click', (ev) => {
      const action = (ev.target as HTMLElement).closest('.context-menu-item')?.getAttribute('data-add');
      if (!action) return;
      switch (action) {
        case 'cube': case 'sphere': case 'plane': case 'cylinder': case 'capsule': case 'cone': case 'torus':
          this.editor.addPrimitive(action); break;
        case 'directional-light': this.editor.addLight('directional'); break;
        case 'point-light': this.editor.addLight('point'); break;
        case 'spot-light': this.editor.addLight('spot'); break;
        case 'ambient-light': this.editor.addLight('ambient'); break;
        case 'camera': this.editor.addCamera(); break;
        case 'model': this.editor.addModel(); break;
      }
      menu.remove();
    });

    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  private promptRename(obj: THREE.Object3D): void {
    // Find the hierarchy item for this specific object by matching data-uuid
    const item = this.listEl.querySelector(`.hierarchy-item[data-uuid="${obj.uuid}"]`) as HTMLElement;
    if (item) {
      this.startInlineRename(item, obj);
      return;
    }
    // Fallback: use currently selected item
    const selected = this.listEl.querySelector('.hierarchy-item.selected') as HTMLElement;
    if (selected) {
      this.startInlineRename(selected, obj);
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /** Check if an object is locked (for use by other editor systems) */
  isLocked(obj: THREE.Object3D): boolean {
    return this.locked.has(obj.uuid);
  }
}
