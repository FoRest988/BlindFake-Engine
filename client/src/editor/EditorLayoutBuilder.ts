import type { EditorTabDefinition, PrimaryEditorTab } from './EditorTabRegistry';

export interface EditorLayoutBuilderArgs {
  root: HTMLElement;
  menuBar: HTMLElement;
  toolbar: HTMLElement;
  hierarchy: HTMLElement;
  inspector: HTMLElement;
  consolePanel: HTMLElement;
  statusBar: HTMLElement;
  editorCanvas: HTMLCanvasElement;
  viewport: HTMLElement;
  tabDefinitions: EditorTabDefinition[];
  activeTab: PrimaryEditorTab;
  onTabClick: (tabId: PrimaryEditorTab) => void;
  createResizer: (direction: 'h' | 'v', target: HTMLElement, prop: 'width' | 'height', reverse?: boolean) => HTMLElement;
}

export interface EditorLayoutRefs {
  tabBar: HTMLElement;
  body: HTMLElement;
  viewportContainer: HTMLElement;
}

export function buildEditorLayout(args: EditorLayoutBuilderArgs): EditorLayoutRefs {
  args.root.innerHTML = '';

  args.root.appendChild(args.menuBar);
  args.root.appendChild(args.toolbar);

  const tabBar = document.createElement('div');
  tabBar.className = 'editor-tabs';
  for (const tab of args.tabDefinitions) {
    const el = document.createElement('div');
    el.className = 'editor-tab' + (tab.id === args.activeTab ? ' active' : '');
    el.innerHTML = `${tab.icon} ${tab.label}`;
    el.dataset.tab = tab.id;
    el.addEventListener('click', () => args.onTabClick(tab.id));
    tabBar.appendChild(el);
  }
  args.root.appendChild(tabBar);

  const body = document.createElement('div');
  body.className = 'editor-body';

  const leftPanel = document.createElement('div');
  leftPanel.className = 'editor-left-panel';
  leftPanel.appendChild(args.hierarchy);
  body.appendChild(leftPanel);
  body.appendChild(args.createResizer('h', leftPanel, 'width'));

  const center = document.createElement('div');
  center.className = 'editor-center';

  const viewportContainer = document.createElement('div');
  viewportContainer.className = 'editor-viewport';
  viewportContainer.appendChild(args.editorCanvas);
  viewportContainer.appendChild(args.viewport);
  center.appendChild(viewportContainer);

  const consolePanel = document.createElement('div');
  consolePanel.className = 'editor-console';
  consolePanel.appendChild(args.consolePanel);
  center.appendChild(consolePanel);

  body.appendChild(center);

  const rightPanel = document.createElement('div');
  rightPanel.className = 'editor-right-panel';
  body.appendChild(args.createResizer('h', rightPanel, 'width', true));
  rightPanel.appendChild(args.inspector);
  body.appendChild(rightPanel);

  args.root.appendChild(body);
  args.root.appendChild(args.statusBar);

  return {
    tabBar,
    body,
    viewportContainer,
  };
}