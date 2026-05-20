export type PrimaryEditorTab = 'scene' | 'terrain' | 'animation' | 'cinematic' | 'statemachine' | 'scripting' | 'blueprints' | 'ui' | 'modeling' | 'textures';

export interface EditorTabDefinition {
  id: PrimaryEditorTab;
  icon: string;
  label: string;
  render?: () => HTMLElement;
  deactivate?: () => void;
  activate?: () => void;
}

interface EditorTabPanelHandle {
  render(): HTMLElement;
  dispose(): void;
}

export interface EditorTabRegistryDeps {
  terrainEditor: EditorTabPanelHandle;
  animationEditor: EditorTabPanelHandle;
  cinematicEditor: EditorTabPanelHandle;
  animStateMachineEditor: EditorTabPanelHandle;
  scriptEditorPanel: EditorTabPanelHandle;
  visualScript: EditorTabPanelHandle;
  uiEditorPanel: EditorTabPanelHandle;
  modelingPanel: EditorTabPanelHandle;
  textureEditor: EditorTabPanelHandle;
}

export function createEditorTabDefinitions(deps: EditorTabRegistryDeps): EditorTabDefinition[] {
  return [
    { id: 'scene', icon: '🏗️', label: 'Scene' },
    { id: 'terrain', icon: '🏔️', label: 'Terrain', render: () => deps.terrainEditor.render(), deactivate: () => deps.terrainEditor.dispose() },
    { id: 'animation', icon: '🎬', label: 'Animation', render: () => deps.animationEditor.render(), deactivate: () => deps.animationEditor.dispose() },
    { id: 'cinematic', icon: '🎥', label: 'Cinematic', render: () => deps.cinematicEditor.render(), deactivate: () => deps.cinematicEditor.dispose() },
    { id: 'statemachine', icon: '🔀', label: 'State Machine', render: () => deps.animStateMachineEditor.render(), deactivate: () => deps.animStateMachineEditor.dispose() },
    { id: 'scripting', icon: '💻', label: 'Scripting', render: () => deps.scriptEditorPanel.render(), deactivate: () => deps.scriptEditorPanel.dispose() },
    { id: 'blueprints', icon: '📜', label: 'Blueprints', render: () => deps.visualScript.render(), deactivate: () => deps.visualScript.dispose() },
    { id: 'ui', icon: '🎨', label: 'UI Editor', render: () => deps.uiEditorPanel.render(), deactivate: () => deps.uiEditorPanel.dispose() },
    { id: 'modeling', icon: '🔨', label: 'Modeling', render: () => deps.modelingPanel.render(), deactivate: () => deps.modelingPanel.dispose() },
    { id: 'textures', icon: '🖼️', label: 'Textures', render: () => deps.textureEditor.render(), deactivate: () => deps.textureEditor.dispose() },
  ];
}

export function findEditorTabDefinition(definitions: EditorTabDefinition[], tabId: PrimaryEditorTab): EditorTabDefinition | undefined {
  return definitions.find((tab) => tab.id === tabId);
}