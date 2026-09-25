import { findEditorTabDefinition, type EditorTabDefinition, type PrimaryEditorTab } from './EditorTabRegistry';

export interface EditorTabControllerArgs {
  root: HTMLElement;
  tabBar: HTMLElement;
  bodyEl: HTMLElement;
  tabDefinitions: EditorTabDefinition[];
  resizeViewport: () => void;
  initialTab?: PrimaryEditorTab;
}

export class EditorTabController {
  private readonly root: HTMLElement;
  private readonly tabBar: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly tabDefinitions: EditorTabDefinition[];
  private readonly resizeViewport: () => void;
  private activeTab: PrimaryEditorTab;

  constructor(args: EditorTabControllerArgs) {
    this.root = args.root;
    this.tabBar = args.tabBar;
    this.bodyEl = args.bodyEl;
    this.tabDefinitions = args.tabDefinitions;
    this.resizeViewport = args.resizeViewport;
    this.activeTab = args.initialTab ?? 'scene';
  }

  getActiveTab(): PrimaryEditorTab {
    return this.activeTab;
  }

  deactivateActiveTab(): void {
    const def = findEditorTabDefinition(this.tabDefinitions, this.activeTab);
    if (def?.deactivate) {
      def.deactivate();
    }
  }

  switchTab(tabId: string): void {
    const nextTab = tabId as PrimaryEditorTab;
    if (nextTab !== this.activeTab) {
      this.deactivateActiveTab();
    }
    this.activeTab = nextTab;

    this.tabBar.querySelectorAll('.editor-tab').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset.tab === nextTab);
    });

    this.root.querySelector('.editor-tab-overlay')?.remove();

    if (nextTab === 'scene') {
      this.showSceneTab();
      return;
    }

    const def = findEditorTabDefinition(this.tabDefinitions, nextTab);
    if (def?.render) {
      this.mountTabOverlay(def.render());
      return;
    }

    this.showPlaceholderTab(nextTab);
  }

  private createTabOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.className = 'editor-tab-overlay';
    overlay.style.cssText = 'display:flex;flex:1;overflow:hidden;padding:0;background:#1e1e1e;width:100%;min-height:0;';
    return overlay;
  }

  private mountTabOverlay(content: HTMLElement): void {
    this.bodyEl.style.display = 'none';
    const overlay = this.createTabOverlay();
    overlay.appendChild(content);
    const statusBar = this.root.querySelector('.editor-status-bar');
    if (statusBar) {
      this.root.insertBefore(overlay, statusBar);
    } else {
      this.root.appendChild(overlay);
    }
  }

  private showSceneTab(): void {
    this.bodyEl.style.display = '';
    requestAnimationFrame(() => this.resizeViewport());
  }

  private showPlaceholderTab(tabId: string): void {
    this.bodyEl.style.display = 'none';
    const overlay = this.createTabOverlay();
    overlay.innerHTML = `
      <div style="font-size:48px;margin-bottom:16px;">🔧</div>
      <div style="font-size:18px;color:#aaa;font-weight:500;">${tabId.charAt(0).toUpperCase() + tabId.slice(1)} Editor</div>
      <div style="font-size:12px;margin-top:8px;color:#666;max-width:300px;text-align:center;">Under development</div>
      <div style="font-size:11px;margin-top:24px;color:#444;">🚧 Under development</div>
    `;
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.flexDirection = 'column';
    const statusBar = this.root.querySelector('.editor-status-bar');
    if (statusBar) {
      this.root.insertBefore(overlay, statusBar);
    } else {
      this.root.appendChild(overlay);
    }
  }
}