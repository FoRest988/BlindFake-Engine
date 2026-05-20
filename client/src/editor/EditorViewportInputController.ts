export interface DroppedEditorAsset {
  type?: string;
  path?: string;
  name?: string;
  [key: string]: unknown;
}

export interface EditorViewportInputControllerDeps {
  canvas: HTMLCanvasElement;
  getViewportContainer: () => HTMLElement | null;
  isInteractionBlocked: () => boolean;
  isTransformDragging: () => boolean;
  isJustFinishedDragging: () => boolean;
  onViewportClick: (event: PointerEvent) => void;
  onMarqueeSelect: (startX: number, startY: number, endX: number, endY: number) => void;
  onAssetDrop: (asset: DroppedEditorAsset, event: DragEvent) => void;
}

export class EditorViewportInputController {
  private readonly canvas: HTMLCanvasElement;
  private readonly getViewportContainer: () => HTMLElement | null;
  private readonly isInteractionBlocked: () => boolean;
  private readonly isTransformDragging: () => boolean;
  private readonly isJustFinishedDragging: () => boolean;
  private readonly onViewportClick: (event: PointerEvent) => void;
  private readonly onMarqueeSelect: (startX: number, startY: number, endX: number, endY: number) => void;
  private readonly onAssetDrop: (asset: DroppedEditorAsset, event: DragEvent) => void;

  private pointerDownPos = { x: 0, y: 0 };
  private pointerDownTime = 0;
  private isLeftDown = false;
  private marqueeActive = false;
  private marqueeStart = { x: 0, y: 0 };
  private marqueeEl: HTMLDivElement | null = null;

  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (this.isInteractionBlocked()) return;
    if (this.isTransformDragging()) return;
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    this.pointerDownTime = performance.now();
    this.isLeftDown = true;
    this.marqueeStart = { x: e.clientX, y: e.clientY };
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (!this.isLeftDown) return;
    if (this.isInteractionBlocked()) return;
    if (this.isTransformDragging()) return;

    const dx = Math.abs(e.clientX - this.marqueeStart.x);
    const dy = Math.abs(e.clientY - this.marqueeStart.y);
    if (dx <= 5 && dy <= 5) return;

    if (!this.marqueeActive) {
      this.marqueeActive = true;
      this.marqueeEl = document.createElement('div');
      this.marqueeEl.className = 'marquee-selection';
      this.getViewportContainer()?.appendChild(this.marqueeEl);
    }

    const viewportContainer = this.getViewportContainer();
    if (!this.marqueeEl || !viewportContainer) return;

    const rect = viewportContainer.getBoundingClientRect();
    const left = Math.min(this.marqueeStart.x, e.clientX) - rect.left;
    const top = Math.min(this.marqueeStart.y, e.clientY) - rect.top;
    const w = Math.abs(e.clientX - this.marqueeStart.x);
    const h = Math.abs(e.clientY - this.marqueeStart.y);
    this.marqueeEl.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${w}px;height:${h}px;border:1px solid #0078d4;background:rgba(0,120,212,0.15);pointer-events:none;z-index:20;`;
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.isLeftDown = false;
    if (this.isInteractionBlocked()) return;

    if (this.marqueeActive) {
      this.onMarqueeSelect(this.marqueeStart.x, this.marqueeStart.y, e.clientX, e.clientY);
      this.clearMarquee();
      return;
    }

    if (this.isJustFinishedDragging()) return;

    const dx = Math.abs(e.clientX - this.pointerDownPos.x);
    const dy = Math.abs(e.clientY - this.pointerDownPos.y);
    const dt = performance.now() - this.pointerDownTime;
    if (dx > 5 || dy > 5 || dt > 500) return;

    this.onViewportClick(e);
  };

  private readonly onDragOver = (e: DragEvent) => {
    if (this.isInteractionBlocked()) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  private readonly onDrop = (e: DragEvent) => {
    if (this.isInteractionBlocked()) return;
    e.preventDefault();
    const data = e.dataTransfer?.getData('application/blindfake-asset');
    if (!data) return;
    try {
      this.onAssetDrop(JSON.parse(data) as DroppedEditorAsset, e);
    } catch {
      // Ignore invalid drag payloads.
    }
  };

  constructor(deps: EditorViewportInputControllerDeps) {
    this.canvas = deps.canvas;
    this.getViewportContainer = deps.getViewportContainer;
    this.isInteractionBlocked = deps.isInteractionBlocked;
    this.isTransformDragging = deps.isTransformDragging;
    this.isJustFinishedDragging = deps.isJustFinishedDragging;
    this.onViewportClick = deps.onViewportClick;
    this.onMarqueeSelect = deps.onMarqueeSelect;
    this.onAssetDrop = deps.onAssetDrop;
  }

  attach(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('dragover', this.onDragOver);
    this.canvas.addEventListener('drop', this.onDrop);
  }

  detach(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('dragover', this.onDragOver);
    this.canvas.removeEventListener('drop', this.onDrop);
    this.clearMarquee();
  }

  private clearMarquee(): void {
    this.marqueeEl?.remove();
    this.marqueeEl = null;
    this.marqueeActive = false;
  }
}