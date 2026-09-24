// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEditorLayout } from '../client/src/editor/EditorLayoutBuilder';
import { EditorTabController } from '../client/src/editor/EditorTabController';
import { createEditorTabDefinitions } from '../client/src/editor/EditorTabRegistry';

function createPanelHandle(label: string) {
  return {
    render: vi.fn(() => {
      const el = document.createElement('section');
      el.className = `${label}-panel`;
      el.textContent = label;
      return el;
    }),
    dispose: vi.fn(),
  };
}

describe('Editor layout and tabs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it('builds the editor shell and switches tabs through DOM clicks', () => {
    const root = document.createElement('div');
    const terrainEditor = createPanelHandle('terrain');
    const definitions = createEditorTabDefinitions({
      terrainEditor,
      animationEditor: createPanelHandle('animation'),
      cinematicEditor: createPanelHandle('cinematic'),
      animStateMachineEditor: createPanelHandle('statemachine'),
      scriptEditorPanel: createPanelHandle('scripting'),
      visualScript: createPanelHandle('blueprints'),
      uiEditorPanel: createPanelHandle('ui'),
      modelingPanel: createPanelHandle('modeling'),
      textureEditor: createPanelHandle('textures'),
    });

    let controller: EditorTabController;
    const layout = buildEditorLayout({
      root,
      menuBar: Object.assign(document.createElement('div'), { className: 'editor-menu-bar' }),
      toolbar: Object.assign(document.createElement('div'), { className: 'editor-toolbar' }),
      hierarchy: document.createElement('div'),
      inspector: document.createElement('div'),
      timeline: document.createElement('div'),
      consolePanel: document.createElement('div'),
      statusBar: Object.assign(document.createElement('div'), { className: 'editor-status-bar' }),
      editorCanvas: document.createElement('canvas'),
      viewport: document.createElement('div'),
      tabDefinitions: definitions,
      activeTab: 'scene',
      onTabClick: (tabId) => controller.switchTab(tabId),
      createResizer: () => document.createElement('div'),
    });

    document.body.appendChild(root);

    const resizeViewport = vi.fn();
    controller = new EditorTabController({
      root,
      tabBar: layout.tabBar,
      bodyEl: layout.body,
      timelinePanel: layout.timelinePanel,
      tabDefinitions: definitions,
      resizeViewport,
      initialTab: 'scene',
    });

    expect(root.querySelector('.editor-tabs')).toBeTruthy();
    expect(root.querySelector('.editor-body')).toBeTruthy();
    expect(root.querySelector('.editor-viewport')).toBeTruthy();
    expect(root.querySelector('.editor-status-bar')).toBeTruthy();

    const terrainTab = root.querySelector('[data-tab="terrain"]') as HTMLElement;
    terrainTab.click();

    expect(terrainEditor.render).toHaveBeenCalledOnce();
    expect(root.querySelector('.editor-tab-overlay')).toBeTruthy();
    expect(layout.body.style.display).toBe('none');
    expect(terrainTab.classList.contains('active')).toBe(true);

    const sceneTab = root.querySelector('[data-tab="scene"]') as HTMLElement;
    sceneTab.click();

    expect(terrainEditor.dispose).toHaveBeenCalledOnce();
    expect(root.querySelector('.editor-tab-overlay')).toBeNull();
    expect(layout.body.style.display).toBe('');
    expect(layout.timelinePanel.style.display).toBe('none');
    expect(resizeViewport).toHaveBeenCalledOnce();
  });

  it('reopens panel tabs cleanly after returning to scene', () => {
    const root = document.createElement('div');
    const terrainEditor = createPanelHandle('terrain');
    const definitions = createEditorTabDefinitions({
      terrainEditor,
      animationEditor: createPanelHandle('animation'),
      cinematicEditor: createPanelHandle('cinematic'),
      animStateMachineEditor: createPanelHandle('statemachine'),
      scriptEditorPanel: createPanelHandle('scripting'),
      visualScript: createPanelHandle('blueprints'),
      uiEditorPanel: createPanelHandle('ui'),
      modelingPanel: createPanelHandle('modeling'),
      textureEditor: createPanelHandle('textures'),
    });

    let controller: EditorTabController;
    const layout = buildEditorLayout({
      root,
      menuBar: document.createElement('div'),
      toolbar: document.createElement('div'),
      hierarchy: document.createElement('div'),
      inspector: document.createElement('div'),
      timeline: document.createElement('div'),
      consolePanel: document.createElement('div'),
      statusBar: Object.assign(document.createElement('div'), { className: 'editor-status-bar' }),
      editorCanvas: document.createElement('canvas'),
      viewport: document.createElement('div'),
      tabDefinitions: definitions,
      activeTab: 'scene',
      onTabClick: (tabId) => controller.switchTab(tabId),
      createResizer: () => document.createElement('div'),
    });
    controller = new EditorTabController({
      root,
      tabBar: layout.tabBar,
      bodyEl: layout.body,
      timelinePanel: layout.timelinePanel,
      tabDefinitions: definitions,
      resizeViewport: vi.fn(),
      initialTab: 'scene',
    });

    controller.switchTab('terrain');
    controller.switchTab('scene');
    controller.switchTab('terrain');

    expect(terrainEditor.render).toHaveBeenCalledTimes(2);
    expect(terrainEditor.dispose).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll('.terrain-panel')).toHaveLength(1);
    expect(root.querySelector('.editor-tab-overlay')).toBeTruthy();
  });
});