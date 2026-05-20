import type { EditorApp } from '../EditorApp';

export class EditorStatusBar {
  private editor: EditorApp;
  private container!: HTMLElement;
  private fpsEl!: HTMLSpanElement;
  private infoEl!: HTMLSpanElement;
  private toolEl!: HTMLSpanElement;
  private selEl!: HTMLSpanElement;
  private sceneEl!: HTMLSpanElement;
  private memoryEl!: HTMLSpanElement;
  private lastTime = 0;
  private frameCount = 0;
  private fps = 0;
  private rafId = 0;

  private message = '';

  constructor(editor: EditorApp) {
    this.editor = editor;
  }

  render(): HTMLElement {
    this.container = document.createElement('div');
    this.container.className = 'editor-status-bar';

    this.container.innerHTML = `
      <span data-sb="fps" style="color:#2ecc71;font-family:monospace;">60 FPS</span>
      <span style="color:#333;">|</span>
      <span data-sb="tool">Tool: Select</span>
      <span style="color:#333;">|</span>
      <span data-sb="sel">No selection</span>
      <span style="color:#333;">|</span>
      <span data-sb="scene" style="color:#888;">Scene: main</span>
      <span style="flex:1;"></span>
      <span data-sb="memory" style="color:#666;font-family:monospace;"></span>
      <span style="color:#333;">|</span>
      <span data-sb="info">BlindFake: Phantom v0.2</span>
    `;

    this.fpsEl = this.container.querySelector('[data-sb="fps"]')!;
    this.toolEl = this.container.querySelector('[data-sb="tool"]')!;
    this.selEl = this.container.querySelector('[data-sb="sel"]')!;
    this.infoEl = this.container.querySelector('[data-sb="info"]')!;
    this.sceneEl = this.container.querySelector('[data-sb="scene"]')!;
    this.memoryEl = this.container.querySelector('[data-sb="memory"]')!;

    this.startLoop();
    return this.container;
  }

  refresh(): void {
    this.update();
  }

  setMessage(msg: string): void {
    this.message = msg;
    if (this.infoEl) {
      this.infoEl.textContent = msg || 'BlindFake: Phantom v0.2';
      this.infoEl.style.color = msg ? '#e67e22' : '#888';
    }
  }

  private startLoop(): void {
    const tick = (time: number) => {
      this.frameCount++;
      if (time - this.lastTime >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.lastTime = time;
        this.update();
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private update(): void {
    if (!this.fpsEl) return;

    this.fpsEl.textContent = `${this.fps} FPS`;
    this.fpsEl.style.color = this.fps >= 50 ? '#2ecc71' : this.fps >= 30 ? '#e67e22' : '#e74c3c';

    this.toolEl.textContent = `Tool: ${this.capitalize(this.editor.state.tool)} (${this.editor.state.transformSpace})`;

    const sel = this.editor.state.selectedObject;
    this.selEl.textContent = sel ? `Selected: ${sel.name || sel.type}` : 'No selection';

    // Scene name
    const sceneName = this.editor.engine.scenes.active?.name || 'main';
    this.sceneEl.textContent = `Scene: ${sceneName}`;

    // Memory usage (if available)
    if (this.memoryEl) {
      const perf = (performance as any);
      if (perf.memory) {
        const mb = (perf.memory.usedJSHeapSize / (1024 * 1024)).toFixed(0);
        this.memoryEl.textContent = `${mb} MB`;
      } else {
        // Estimate from renderer info if available
        const info = this.editor.engine.renderer.info;
        this.memoryEl.textContent = `Geo: ${info.memory.geometries} | Tex: ${info.memory.textures} | Calls: ${info.render.calls}`;
      }
    }
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  dispose(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }
}
