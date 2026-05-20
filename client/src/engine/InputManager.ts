export class InputManager {
  private keys = new Map<string, boolean>();
  private keysJustPressed = new Set<string>();
  private keysJustReleased = new Set<string>();

  public mouseX = 0;
  public mouseY = 0;
  public mouseDeltaX = 0;
  public mouseDeltaY = 0;
  public mouseButtons = new Set<number>();
  public isPointerLocked = false;
  public scrollDelta = 0;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onDocumentMouseMove);
    document.addEventListener('mouseup', this.onDocumentMouseUp);
    this.bindCanvas(canvas);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('wheel', this.onDocumentWheel, { passive: false });
  }

  isKeyDown(key: string): boolean {
    return this.keys.get(key.toLowerCase()) ?? false;
  }

  isKeyJustPressed(key: string): boolean {
    return this.keysJustPressed.has(key.toLowerCase());
  }

  isKeyJustReleased(key: string): boolean {
    return this.keysJustReleased.has(key.toLowerCase());
  }

  isMouseButtonDown(button: number): boolean {
    return this.mouseButtons.has(button);
  }

  requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  exitPointerLock(): void {
    document.exitPointerLock();
  }

  setCanvas(canvas: HTMLCanvasElement): void {
    if (canvas === this.canvas) return;
    this.unbindCanvas(this.canvas);
    this.canvas = canvas;
    this.bindCanvas(canvas);
    this.mouseButtons.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.scrollDelta = 0;
    this.isPointerLocked = document.pointerLockElement === this.canvas;
  }

  update(): void {
    this.keysJustPressed.clear();
    this.keysJustReleased.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.scrollDelta = 0;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const aliases = this.getKeyAliases(e);
    const primary = aliases[0];
    if (!this.keys.get(primary)) {
      for (const alias of aliases) {
        this.keysJustPressed.add(alias);
      }
    }
    for (const alias of aliases) {
      this.keys.set(alias, true);
    }

    // Block browser defaults when the game canvas is focused
    if (document.activeElement === this.canvas || document.pointerLockElement === this.canvas) {
      // Allow F12 (dev tools), F11 (fullscreen), F9 (editor toggle), Ctrl+Shift+I
      if (e.key === 'F12' || e.key === 'F11' || e.key === 'F9') return;
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i') return;
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const aliases = this.getKeyAliases(e);
    for (const alias of aliases) {
      this.keys.set(alias, false);
      this.keysJustReleased.add(alias);
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    this.mouseButtons.add(e.button);
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.mouseButtons.delete(e.button);
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.mouseDeltaX += e.movementX;
    this.mouseDeltaY += e.movementY;
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
  };

  private onDocumentMouseMove = (e: MouseEvent): void => {
    if (document.pointerLockElement === this.canvas) {
      this.onMouseMove(e);
      return;
    }
    if (e.target === this.canvas) {
      this.onMouseMove(e);
    }
  };

  private onDocumentMouseUp = (e: MouseEvent): void => {
    if (document.pointerLockElement === this.canvas || this.mouseButtons.has(e.button)) {
      this.onMouseUp(e);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    this.scrollDelta += e.deltaY;
    e.preventDefault();
  };

  // Pointer lock captures mice but NOT wheel events — listen on document so scroll
  // still works when pointer is locked (e.g. platformer camera zoom).
  private onDocumentWheel = (e: WheelEvent): void => {
    if (this.isPointerLocked) {
      this.scrollDelta += e.deltaY;
      e.preventDefault();
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private onClick = (): void => {
    // Pointer lock on click if game needs it
  };

  private onPointerLockChange = (): void => {
    this.isPointerLocked = document.pointerLockElement === this.canvas;
  };

  private bindCanvas(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private unbindCanvas(canvas: HTMLCanvasElement): void {
    canvas.removeEventListener('mousedown', this.onMouseDown);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('click', this.onClick);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private getKeyAliases(e: KeyboardEvent): string[] {
    const aliases = new Set<string>();
    aliases.add(e.key.toLowerCase());
    aliases.add(e.code.toLowerCase());

    if (e.key === ' ') aliases.add('space');
    if (e.code === 'Space') aliases.add(' ');

    return [...aliases];
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onDocumentMouseMove);
    document.removeEventListener('mouseup', this.onDocumentMouseUp);
    document.removeEventListener('wheel', this.onDocumentWheel);
    this.unbindCanvas(this.canvas);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }
}
