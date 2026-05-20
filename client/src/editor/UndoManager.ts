// ─── Editor Undo / Redo System ──────────────────────────────────────
// Command pattern for reversible editor operations.
// Supports: transform changes, add/remove objects, property edits,
// material changes, hierarchy changes. With grouping for compound ops.

import * as THREE from 'three';

// ── Command Interface ───────────────────────────────────────────────

export interface UndoCommand {
  /** Short label for the undo history UI */
  label: string;
  /** Execute the action */
  execute(): void;
  /** Reverse the action */
  undo(): void;
}

// ── Undo Manager ────────────────────────────────────────────────────

export class UndoManager {
  private undoStack: UndoCommand[] = [];
  private redoStack: UndoCommand[] = [];
  private maxHistory: number;

  // Callbacks for UI updates
  public onChange: (() => void) | null = null;

  constructor(maxHistory = 100) {
    this.maxHistory = maxHistory;
  }

  /** Execute a command and push it to the undo stack */
  execute(command: UndoCommand): void {
    command.execute();
    this.undoStack.push(command);

    // Clear redo on new action
    this.redoStack.length = 0;

    // Enforce max history
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }

    this.onChange?.();
  }

  /** Push a command onto the undo stack without executing it (for already-applied changes) */
  pushDirect(command: UndoCommand): void {
    this.undoStack.push(command);
    this.redoStack.length = 0;
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.onChange?.();
  }

  /** Undo the last command */
  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;

    command.undo();
    this.redoStack.push(command);
    this.onChange?.();
    return true;
  }

  /** Redo the last undone command */
  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;

    command.execute();
    this.undoStack.push(command);
    this.onChange?.();
    return true;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string { return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].label : ''; }
  get redoLabel(): string { return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1].label : ''; }

  /** Get undo history labels (most recent first) */
  getHistory(): string[] {
    return [...this.undoStack].reverse().map(c => c.label);
  }

  /** Clear all history */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange?.();
  }
}

// ─── Built-in Commands ──────────────────────────────────────────────

/** Transform change (position, rotation, scale) */
export class TransformCommand implements UndoCommand {
  label: string;

  constructor(
    private object: THREE.Object3D,
    private oldPosition: THREE.Vector3,
    private oldRotation: THREE.Euler,
    private oldScale: THREE.Vector3,
    private newPosition: THREE.Vector3,
    private newRotation: THREE.Euler,
    private newScale: THREE.Vector3,
  ) {
    this.label = `Transform ${object.name || 'Object'}`;
  }

  static capture(object: THREE.Object3D): TransformSnapshot {
    return {
      position: object.position.clone(),
      rotation: object.rotation.clone(),
      scale: object.scale.clone(),
    };
  }

  static fromSnapshots(object: THREE.Object3D, before: TransformSnapshot, after: TransformSnapshot): TransformCommand {
    return new TransformCommand(
      object,
      before.position, before.rotation, before.scale,
      after.position, after.rotation, after.scale,
    );
  }

  execute(): void {
    this.object.position.copy(this.newPosition);
    this.object.rotation.copy(this.newRotation);
    this.object.scale.copy(this.newScale);
  }

  undo(): void {
    this.object.position.copy(this.oldPosition);
    this.object.rotation.copy(this.oldRotation);
    this.object.scale.copy(this.oldScale);
  }
}

export interface TransformSnapshot {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

/** Add object to scene */
export class AddObjectCommand implements UndoCommand {
  label: string;

  constructor(
    private scene: THREE.Scene,
    private object: THREE.Object3D,
  ) {
    this.label = `Add ${object.name || object.type}`;
  }

  execute(): void {
    this.scene.add(this.object);
  }

  undo(): void {
    this.scene.remove(this.object);
  }
}

/** Remove object from scene */
export class RemoveObjectCommand implements UndoCommand {
  label: string;
  private parent: THREE.Object3D;

  constructor(
    private object: THREE.Object3D,
  ) {
    this.label = `Remove ${object.name || object.type}`;
    this.parent = object.parent || object; // fallback
  }

  execute(): void {
    this.parent = this.object.parent || this.parent;
    this.object.removeFromParent();
  }

  undo(): void {
    this.parent.add(this.object);
  }
}

/** Change a single property on any object */
export class PropertyCommand<T extends object, K extends keyof T> implements UndoCommand {
  label: string;

  constructor(
    private target: T,
    private property: K,
    private oldValue: T[K],
    private newValue: T[K],
    label?: string,
  ) {
    this.label = label ?? `Change ${String(property)}`;
  }

  execute(): void {
    this.target[this.property] = this.newValue;
  }

  undo(): void {
    this.target[this.property] = this.oldValue;
  }
}

/** Material color change */
export class MaterialColorCommand implements UndoCommand {
  label: string;
  private oldColor: THREE.Color;
  private newColor: THREE.Color;

  constructor(
    private material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial,
    oldColor: THREE.Color,
    newColor: THREE.Color,
  ) {
    this.label = 'Change Material Color';
    this.oldColor = oldColor.clone();
    this.newColor = newColor.clone();
  }

  execute(): void {
    this.material.color.copy(this.newColor);
  }

  undo(): void {
    this.material.color.copy(this.oldColor);
  }
}

/** Group multiple commands into one undo step */
export class GroupCommand implements UndoCommand {
  label: string;

  constructor(
    label: string,
    private commands: UndoCommand[],
  ) {
    this.label = label;
  }

  execute(): void {
    for (const cmd of this.commands) {
      cmd.execute();
    }
  }

  undo(): void {
    // Undo in reverse order
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }
}

/** Reparent an object (change hierarchy) */
export class ReparentCommand implements UndoCommand {
  label: string;
  private oldParent: THREE.Object3D;
  private oldIndex: number;

  constructor(
    private object: THREE.Object3D,
    private newParent: THREE.Object3D,
  ) {
    this.label = `Reparent ${object.name || 'Object'}`;
    this.oldParent = object.parent!;
    this.oldIndex = this.oldParent?.children.indexOf(object) ?? 0;
  }

  execute(): void {
    this.newParent.add(this.object);
  }

  undo(): void {
    this.oldParent.add(this.object);
    // Restore original position in children array
    const children = this.oldParent.children;
    const idx = children.indexOf(this.object);
    if (idx !== this.oldIndex && this.oldIndex < children.length) {
      children.splice(idx, 1);
      children.splice(this.oldIndex, 0, this.object);
    }
  }
}
