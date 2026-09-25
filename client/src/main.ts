import * as THREE from 'three';
import { Engine } from './engine/Engine';
import { EditorApp } from './editor/EditorApp';
import { LandingPage, type ProjectInfo } from './LandingPage';
import { applyTemplate } from './ProjectTemplates';
import { initDevErrorTracker, setDevErrorTrackerContext } from './engine/DevErrorTracker';

console.log(`
  ██████╗ ██╗     ██╗███╗   ██╗██████╗ ███████╗ █████╗ ██╗  ██╗███████╗
  ██╔══██╗██║     ██║████╗  ██║██╔══██╗██╔════╝██╔══██╗██║ ██╔╝██╔════╝
  ██████╔╝██║     ██║██╔██╗ ██║██║  ██║█████╗  ███████║█████╔╝ █████╗
  ██╔══██╗██║     ██║██║╚██╗██║██║  ██║██╔══╝  ██╔══██║██╔═██╗ ██╔══╝
  ██████╔╝███████╗██║██║ ╚████║██████╔╝██║     ██║  ██║██║  ██╗███████╗
  ╚═════╝ ╚══════╝╚═╝╚═╝  ╚═══╝╚═════╝ ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝

  Engine v0.1.0 | Landing Page Active
`);

// --- Landing Page ---
const landingEl = document.getElementById('landing-page')!;
initDevErrorTracker();
new LandingPage(landingEl, (project) => startProject(project));

function startProject(project: ProjectInfo): void {
  setDevErrorTrackerContext({
    projectId: project.id,
    projectName: project.name,
    template: project.template,
  });

  const gameContainer = document.getElementById('game-container')!;
  gameContainer.classList.remove('hidden');

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  canvas.focus();

  const engine = new Engine({
    canvas,
    antialias: true,
    shadows: true,
  });

  // --- Create main scene ---
  const scene = engine.scenes.create('main');
  engine.scenes.setActive('main');
  engine.scenes.addDefaultLighting(scene);

  // --- Apply template ---
  const templateResult = applyTemplate(engine, scene, project.template);
  if (templateResult.updateFn) {
    engine.onUpdate = templateResult.updateFn;
  }

  // --- Editor (adopts the engine canvas, puts the engine in edit mode) ---
  const editorApp = new EditorApp(engine, { projectId: project.id });
  document.getElementById('editor-root')!.classList.remove('hidden');
  editorApp.open();

  // --- Restore saved scene data ---
  if (project.sceneData) {
    try {
      const data = JSON.parse(project.sceneData);
      // SceneSerializer restore could happen here
      console.info('[Project] Restored scene data for:', project.name, data);
    } catch { /* ignore corrupted data */ }
  }

  engine.start();
}
