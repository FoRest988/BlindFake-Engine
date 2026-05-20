import * as THREE from 'three';
import { Engine } from './engine/Engine';
import { EditorApp } from './editor/EditorApp';
import { PhysicsSystem } from './ecs/systems/PhysicsSystem';
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

  // --- HUD ---
  const fpsEl = document.createElement('div');
  fpsEl.className = 'hud-element hud-fps';
  document.getElementById('ui-overlay')?.appendChild(fpsEl);

  const helpEl = document.createElement('div');
  helpEl.className = 'hud-element';
  helpEl.style.cssText = 'bottom:8px;left:8px;font-size:0.7rem;color:#666;';
  helpEl.innerHTML = templateResult.helpText;
  document.getElementById('ui-overlay')?.appendChild(helpEl);

  // --- Editor ---
  const editorApp = new EditorApp(engine);
  (editorApp as any)._currentProjectId = project.id;

  // Start directly in editor mode
  engine.editorActive = true;
  const physicsInit = engine.world.getSystem(PhysicsSystem);
  if (physicsInit) physicsInit.enabled = false;
  gameContainer.style.display = 'none';
  document.getElementById('editor-root')!.classList.remove('hidden');
  fpsEl.style.display = 'none';
  helpEl.style.display = 'none';
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
