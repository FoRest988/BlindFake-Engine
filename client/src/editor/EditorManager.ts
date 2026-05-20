import type { Engine } from '../engine/Engine';
import { CinematicEditorPanel } from './CinematicEditorPanel';
import { ParticleEditorPanel } from './ParticleEditorPanel';
import { ModelInspectorPanel } from './ModelInspectorPanel';

export type EditorMode = 'cinematic' | 'particle' | 'model' | 'none';

export class EditorManager {
  private engine: Engine;
  private panel: HTMLElement;
  private currentMode: EditorMode = 'none';

  public cinematicEditor: CinematicEditorPanel;
  public particleEditor: ParticleEditorPanel;
  public modelInspector: ModelInspectorPanel;

  constructor(engine: Engine) {
    this.engine = engine;
    this.panel = document.getElementById('editor-panel')!;

    this.cinematicEditor = new CinematicEditorPanel(engine);
    this.particleEditor = new ParticleEditorPanel(engine);
    this.modelInspector = new ModelInspectorPanel(engine);

    // Toggle editor with F1
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        this.toggle('cinematic');
      }
      if (e.key === 'F2') {
        e.preventDefault();
        this.toggle('particle');
      }
      if (e.key === 'F3') {
        e.preventDefault();
        this.toggle('model');
      }
    });
  }

  toggle(mode: EditorMode): void {
    if (this.currentMode === mode) {
      this.close();
    } else {
      this.open(mode);
    }
  }

  open(mode: EditorMode): void {
    this.currentMode = mode;
    this.panel.classList.remove('hidden');
    this.panel.innerHTML = '';

    switch (mode) {
      case 'cinematic':
        this.panel.appendChild(this.cinematicEditor.render());
        break;
      case 'particle':
        this.panel.appendChild(this.particleEditor.render());
        break;
      case 'model':
        this.panel.appendChild(this.modelInspector.render());
        break;
    }
  }

  close(): void {
    this.currentMode = 'none';
    this.panel.classList.add('hidden');
    this.panel.innerHTML = '';
  }

  get mode(): EditorMode {
    return this.currentMode;
  }
}
