/**
 * MultiSelect — Extends the editor with multi-object selection,
 * box selection (marquee), copy/cut/paste, and grouped transform.
 */

import * as THREE from 'three';

export interface MultiSelectEvents {
  onSelectionChanged?: (objects: THREE.Object3D[]) => void;
}

export class MultiSelect {
  private selected: THREE.Object3D[] = [];
  private selectionBoxes: THREE.BoxHelper[] = [];
  private scene: THREE.Scene;
  private events: MultiSelectEvents;

  // Clipboard
  private clipboard: THREE.Object3D[] = [];
  private isCut = false;

  // Marquee selection
  private marqueeDiv: HTMLDivElement | null = null;
  private isMarqueeActive = false;
  private marqueeStart = { x: 0, y: 0 };
  private viewportEl: HTMLElement | null = null;
  private camera: THREE.Camera | null = null;

  constructor(scene: THREE.Scene, events: MultiSelectEvents = {}) {
    this.scene = scene;
    this.events = events;
  }

  /* ─── Selection API ───────────────────────────────────── */

  /** Replace selection with a single object */
  selectOne(obj: THREE.Object3D | null): void {
    this.clearVisuals();
    this.selected = obj ? [obj] : [];
    this.updateVisuals();
    this.notifyChange();
  }

  /** Toggle object in/out of selection (Ctrl+Click) */
  toggleSelect(obj: THREE.Object3D): void {
    const idx = this.selected.indexOf(obj);
    if (idx >= 0) {
      this.selected.splice(idx, 1);
    } else {
      this.selected.push(obj);
    }
    this.clearVisuals();
    this.updateVisuals();
    this.notifyChange();
  }

  /** Add object to selection (Shift+Click) */
  addToSelection(obj: THREE.Object3D): void {
    if (!this.selected.includes(obj)) {
      this.selected.push(obj);
    }
    this.clearVisuals();
    this.updateVisuals();
    this.notifyChange();
  }

  /** Clear all selection */
  clearSelection(): void {
    this.clearVisuals();
    this.selected = [];
    this.notifyChange();
  }

  /** Get current selection */
  getSelection(): ReadonlyArray<THREE.Object3D> {
    return this.selected;
  }

  /** Get first selected (for inspector) */
  getPrimary(): THREE.Object3D | null {
    return this.selected[0] ?? null;
  }

  /** Check if object is selected */
  isSelected(obj: THREE.Object3D): boolean {
    return this.selected.includes(obj);
  }

  /** Select all objects in scene (top-level children only) */
  selectAll(): void {
    this.clearVisuals();
    this.selected = [];
    this.scene.children.forEach(child => {
      if (this.isSelectable(child)) {
        this.selected.push(child);
      }
    });
    this.updateVisuals();
    this.notifyChange();
  }

  /** Invert selection */
  invertSelection(): void {
    const allSelectables: THREE.Object3D[] = [];
    this.scene.children.forEach(child => {
      if (this.isSelectable(child)) {
        allSelectables.push(child);
      }
    });

    const currentSet = new Set(this.selected);
    this.clearVisuals();
    this.selected = allSelectables.filter(obj => !currentSet.has(obj));
    this.updateVisuals();
    this.notifyChange();
  }

  /* ─── Copy / Cut / Paste ──────────────────────────────── */

  /** Copy selected objects to clipboard */
  copy(): void {
    this.clipboard = this.selected.slice();
    this.isCut = false;
  }

  /** Cut selected objects to clipboard */
  cut(): void {
    this.clipboard = this.selected.slice();
    this.isCut = true;
  }

  /** Paste clipboard objects into scene, returns new objects */
  paste(): THREE.Object3D[] {
    if (this.clipboard.length === 0) return [];

    const newObjects: THREE.Object3D[] = [];

    for (const obj of this.clipboard) {
      if (this.isCut) {
        // Move: just re-add if removed
        if (!obj.parent) {
          this.scene.add(obj);
        }
        // Offset slightly so user sees it
        obj.position.x += 1;
        obj.position.z += 1;
        newObjects.push(obj);
      } else {
        // Clone
        const clone = obj.clone(true);
        clone.name = obj.name + '_copy';
        // Offset
        clone.position.x += 1;
        clone.position.z += 1;
        this.scene.add(clone);
        newObjects.push(clone);
      }
    }

    if (this.isCut) {
      this.clipboard = [];
      this.isCut = false;
    }

    // Select the new objects
    this.clearVisuals();
    this.selected = newObjects;
    this.updateVisuals();
    this.notifyChange();

    return newObjects;
  }

  /** Delete all selected objects */
  deleteSelected(): THREE.Object3D[] {
    const removed = this.selected.slice();
    for (const obj of removed) {
      obj.removeFromParent();
    }
    this.clearVisuals();
    this.selected = [];
    this.notifyChange();
    return removed;
  }

  /** Duplicate selected objects */
  duplicateSelected(): THREE.Object3D[] {
    const dupes: THREE.Object3D[] = [];
    for (const obj of this.selected) {
      const clone = obj.clone(true);
      clone.name = obj.name + '_copy';
      clone.position.x += 1;
      clone.position.z += 1;
      (obj.parent ?? this.scene).add(clone);
      dupes.push(clone);
    }
    this.clearVisuals();
    this.selected = dupes;
    this.updateVisuals();
    this.notifyChange();
    return dupes;
  }

  /* ─── Group Operations ────────────────────────────────── */

  /** Group selected objects under a new parent */
  groupSelected(): THREE.Group | null {
    if (this.selected.length < 2) return null;

    const center = new THREE.Vector3();
    for (const obj of this.selected) {
      center.add(obj.position);
    }
    center.divideScalar(this.selected.length);

    const group = new THREE.Group();
    group.name = 'Group';
    group.position.copy(center);
    this.scene.add(group);

    for (const obj of this.selected) {
      const worldPos = new THREE.Vector3();
      obj.getWorldPosition(worldPos);
      obj.removeFromParent();
      group.add(obj);
      obj.position.copy(worldPos.sub(center));
    }

    this.clearVisuals();
    this.selected = [group];
    this.updateVisuals();
    this.notifyChange();

    return group;
  }

  /** Ungroup — move children of selected group to scene */
  ungroupSelected(): THREE.Object3D[] {
    const ungrouped: THREE.Object3D[] = [];

    for (const obj of this.selected) {
      if (obj instanceof THREE.Group && obj.children.length > 0) {
        const children = [...obj.children];
        for (const child of children) {
          const worldPos = new THREE.Vector3();
          child.getWorldPosition(worldPos);
          child.removeFromParent();
          (obj.parent ?? this.scene).add(child);
          child.position.copy(worldPos);
          ungrouped.push(child);
        }
        obj.removeFromParent();
      }
    }

    this.clearVisuals();
    this.selected = ungrouped;
    this.updateVisuals();
    this.notifyChange();
    return ungrouped;
  }

  /* ─── Marquee (Box) Selection ─────────────────────────── */

  /** Enable marquee selection on viewport element */
  enableMarquee(viewportEl: HTMLElement, camera: THREE.Camera): void {
    this.viewportEl = viewportEl;
    this.camera = camera;

    viewportEl.addEventListener('mousedown', this.onMarqueeDown);
    window.addEventListener('mousemove', this.onMarqueeMove);
    window.addEventListener('mouseup', this.onMarqueeUp);
  }

  disableMarquee(): void {
    if (this.viewportEl) {
      this.viewportEl.removeEventListener('mousedown', this.onMarqueeDown);
    }
    window.removeEventListener('mousemove', this.onMarqueeMove);
    window.removeEventListener('mouseup', this.onMarqueeUp);
    if (this.marqueeDiv) {
      this.marqueeDiv.remove();
      this.marqueeDiv = null;
    }
  }

  private onMarqueeDown = (e: MouseEvent): void => {
    // Only left click + Alt (or middle button configured elsewhere)
    if (e.button !== 0 || !e.altKey) return;

    e.preventDefault();
    this.isMarqueeActive = true;
    const rect = this.viewportEl!.getBoundingClientRect();
    this.marqueeStart.x = e.clientX - rect.left;
    this.marqueeStart.y = e.clientY - rect.top;

    if (!this.marqueeDiv) {
      this.marqueeDiv = document.createElement('div');
      this.marqueeDiv.style.cssText = 'position:absolute;border:1px solid #0078d4;background:rgba(0,120,212,0.1);pointer-events:none;z-index:1000;';
      this.viewportEl!.style.position = 'relative';
      this.viewportEl!.appendChild(this.marqueeDiv);
    }
    this.marqueeDiv.style.display = 'block';
    this.marqueeDiv.style.left = this.marqueeStart.x + 'px';
    this.marqueeDiv.style.top = this.marqueeStart.y + 'px';
    this.marqueeDiv.style.width = '0';
    this.marqueeDiv.style.height = '0';
  };

  private onMarqueeMove = (e: MouseEvent): void => {
    if (!this.isMarqueeActive || !this.marqueeDiv || !this.viewportEl) return;

    const rect = this.viewportEl.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const left = Math.min(this.marqueeStart.x, cx);
    const top = Math.min(this.marqueeStart.y, cy);
    const width = Math.abs(cx - this.marqueeStart.x);
    const height = Math.abs(cy - this.marqueeStart.y);

    this.marqueeDiv.style.left = left + 'px';
    this.marqueeDiv.style.top = top + 'px';
    this.marqueeDiv.style.width = width + 'px';
    this.marqueeDiv.style.height = height + 'px';
  };

  private onMarqueeUp = (e: MouseEvent): void => {
    if (!this.isMarqueeActive || !this.viewportEl || !this.camera) return;
    this.isMarqueeActive = false;

    if (this.marqueeDiv) {
      this.marqueeDiv.style.display = 'none';
    }

    const rect = this.viewportEl.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Marquee bounds in normalized device coords
    const minX = (Math.min(this.marqueeStart.x, cx) / rect.width) * 2 - 1;
    const maxX = (Math.max(this.marqueeStart.x, cx) / rect.width) * 2 - 1;
    const minY = -(Math.max(this.marqueeStart.y, cy) / rect.height) * 2 + 1;
    const maxY = -(Math.min(this.marqueeStart.y, cy) / rect.height) * 2 + 1;

    // Test which objects fall within the frustum defined by marquee
    const hits: THREE.Object3D[] = [];
    const screenPos = new THREE.Vector3();

    this.scene.traverse(child => {
      if (!this.isSelectable(child)) return;

      child.getWorldPosition(screenPos);
      screenPos.project(this.camera!);

      if (screenPos.x >= minX && screenPos.x <= maxX &&
          screenPos.y >= minY && screenPos.y <= maxY &&
          screenPos.z >= -1 && screenPos.z <= 1) {
        // Find top-level parent
        let target = child;
        while (target.parent && target.parent !== this.scene) {
          target = target.parent;
        }
        if (!hits.includes(target)) {
          hits.push(target);
        }
      }
    });

    if (!e.shiftKey) {
      this.clearVisuals();
      this.selected = hits;
    } else {
      // Add to existing selection
      for (const h of hits) {
        if (!this.selected.includes(h)) {
          this.selected.push(h);
        }
      }
      this.clearVisuals();
    }

    this.updateVisuals();
    this.notifyChange();
  };

  /* ─── Keyboard handler (call from editor keydown) ──── */

  handleKeyboard(e: KeyboardEvent): boolean {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return false;

    if (e.ctrlKey) {
      switch (e.key.toLowerCase()) {
        case 'c':
          e.preventDefault();
          this.copy();
          return true;
        case 'x':
          e.preventDefault();
          this.cut();
          return true;
        case 'v':
          e.preventDefault();
          this.paste();
          return true;
        case 'a':
          e.preventDefault();
          this.selectAll();
          return true;
        case 'g':
          e.preventDefault();
          this.groupSelected();
          return true;
      }
    }

    return false;
  }

  /* ─── Visual helpers ──────────────────────────────────── */

  private updateVisuals(): void {
    for (const obj of this.selected) {
      const box = new THREE.BoxHelper(obj, 0x0078d4);
      this.scene.add(box);
      this.selectionBoxes.push(box);
    }
  }

  private clearVisuals(): void {
    for (const box of this.selectionBoxes) {
      this.scene.remove(box);
      box.dispose();
    }
    this.selectionBoxes.length = 0;
  }

  /** Update box helpers (call each frame) */
  update(): void {
    for (let i = 0; i < this.selectionBoxes.length; i++) {
      this.selectionBoxes[i].update();
    }
  }

  private isSelectable(obj: THREE.Object3D): boolean {
    return (
      (obj instanceof THREE.Mesh || obj instanceof THREE.Group || obj instanceof THREE.Light) &&
      !obj.name.endsWith('_helper') &&
      !(obj instanceof THREE.GridHelper) &&
      !(obj instanceof THREE.BoxHelper)
    );
  }

  private notifyChange(): void {
    this.events.onSelectionChanged?.(this.selected);
  }

  dispose(): void {
    this.disableMarquee();
    this.clearVisuals();
    this.selected = [];
    this.clipboard = [];
  }
}
