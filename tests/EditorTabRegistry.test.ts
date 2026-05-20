import { describe, it, expect, vi } from 'vitest';
import { createEditorTabDefinitions, findEditorTabDefinition } from '../client/src/editor/EditorTabRegistry';

function createPanelHandle() {
  return {
    render: vi.fn(() => ({}) as HTMLElement),
    dispose: vi.fn(),
  };
}

describe('EditorTabRegistry', () => {
  it('creates the expected primary tabs in editor order', () => {
    const deps = {
      terrainEditor: createPanelHandle(),
      animationEditor: createPanelHandle(),
      cinematicEditor: createPanelHandle(),
      animStateMachineEditor: createPanelHandle(),
      scriptEditorPanel: createPanelHandle(),
      visualScript: createPanelHandle(),
      uiEditorPanel: createPanelHandle(),
      modelingPanel: createPanelHandle(),
      textureEditor: createPanelHandle(),
    };

    const definitions = createEditorTabDefinitions(deps);

    expect(definitions.map((tab) => tab.id)).toEqual([
      'scene',
      'terrain',
      'animation',
      'cinematic',
      'statemachine',
      'scripting',
      'blueprints',
      'ui',
      'modeling',
      'textures',
    ]);
  });

  it('wires panel lifecycle callbacks for non-scene tabs', () => {
    const deps = {
      terrainEditor: createPanelHandle(),
      animationEditor: createPanelHandle(),
      cinematicEditor: createPanelHandle(),
      animStateMachineEditor: createPanelHandle(),
      scriptEditorPanel: createPanelHandle(),
      visualScript: createPanelHandle(),
      uiEditorPanel: createPanelHandle(),
      modelingPanel: createPanelHandle(),
      textureEditor: createPanelHandle(),
    };

    const definitions = createEditorTabDefinitions(deps);
    const sceneTab = findEditorTabDefinition(definitions, 'scene');
    const terrainTab = findEditorTabDefinition(definitions, 'terrain');

    const rendered = terrainTab?.render?.();
    terrainTab?.deactivate?.();

    expect(sceneTab?.render).toBeUndefined();
    expect(sceneTab?.deactivate).toBeUndefined();
    expect(deps.terrainEditor.render).toHaveBeenCalledOnce();
    expect(deps.terrainEditor.dispose).toHaveBeenCalledOnce();
    expect(rendered).toBeTruthy();
  });
});