/**
 * LandingPage — Project hub (similar to Unity Hub / Unreal Project Browser / Roblox Studio).
 * Manages recent projects list, new project creation (3D/2D), and project opening.
 */

export type ProjectTemplate = '3d' | '2d' | 'platformer3d' | 'fps' | 'topdown2d' | 'mainmenu' | 'fighting' | 'racing' | 'puzzle';

export interface ProjectInfo {
  id: string;
  name: string;
  template: ProjectTemplate;
  lastOpened: number;
  thumbnail?: string;
  sceneData?: string;
}

const PROJECTS_KEY = 'blindfake_projects';
const LAST_PROJECT_KEY = 'blindfake_last_project';

export class LandingPage {
  private container: HTMLElement;
  private projects: ProjectInfo[] = [];
  private onOpen: (project: ProjectInfo) => void;

  constructor(container: HTMLElement, onOpen: (project: ProjectInfo) => void) {
    this.container = container;
    this.onOpen = onOpen;
    this.loadProjects();
    this.render();
  }

  private loadProjects(): void {
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      this.projects = raw ? JSON.parse(raw) : [];
    } catch { this.projects = []; }
  }

  private saveProjects(): void {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(this.projects));
  }

  static saveProjectScene(projectId: string, sceneJson: string): void {
    try {
      const raw = localStorage.getItem(PROJECTS_KEY);
      const projects: ProjectInfo[] = raw ? JSON.parse(raw) : [];
      const p = projects.find(pr => pr.id === projectId);
      if (p) {
        p.sceneData = sceneJson;
        p.lastOpened = Date.now();
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
      }
    } catch { /* ignore */ }
  }

  static setLastProject(id: string): void {
    localStorage.setItem(LAST_PROJECT_KEY, id);
  }

  static getLastProject(): string | null {
    return localStorage.getItem(LAST_PROJECT_KEY);
  }

  private createProject(name: string, template: ProjectTemplate): ProjectInfo {
    const project: ProjectInfo = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      template,
      lastOpened: Date.now(),
    };
    this.projects.unshift(project);
    this.saveProjects();
    return project;
  }

  private deleteProject(id: string): void {
    this.projects = this.projects.filter(p => p.id !== id);
    this.saveProjects();
    this.render();
  }

  private openProject(project: ProjectInfo): void {
    project.lastOpened = Date.now();
    this.saveProjects();
    LandingPage.setLastProject(project.id);
    this.container.style.display = 'none';
    this.onOpen(project);
  }

  private render(): void {
    const sorted = [...this.projects].sort((a, b) => b.lastOpened - a.lastOpened);

    this.container.innerHTML = `
      <div class="lp-root">
        <div class="lp-sidebar">
          <div class="lp-logo">
            <div class="lp-logo-icon">BF</div>
            <div class="lp-logo-text">BlindFake<span>Phantom</span></div>
          </div>
          <nav class="lp-nav">
            <div class="lp-nav-item active" data-section="projects">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h5l1 2H14.5a1 1 0 011 1v9a1 1 0 01-1 1h-13a1 1 0 01-1-1V2a1 1 0 011-1z"/></svg>
              Projects
            </div>
            <div class="lp-nav-item" data-section="learn">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5l7 3.5v1L8 9.5 1 6V5l7-3.5zM2 8l6 3 6-3v2l-6 3-6-3V8z"/></svg>
              Learn
            </div>
          </nav>
          <div class="lp-version">v0.2.0 Phantom</div>
        </div>
        <div class="lp-main">
          <div class="lp-header">
            <h1>Projects</h1>
            <div class="lp-header-actions">
              <button class="lp-btn lp-btn-primary" data-action="new">+ New Project</button>
            </div>
          </div>
          <div class="lp-content" data-section-content="projects">
            ${sorted.length === 0 ? this.renderEmptyState() : this.renderProjectList(sorted)}
          </div>
          <div class="lp-content lp-hidden" data-section-content="learn">
            <div class="lp-learn-grid">
              <div class="lp-learn-card">
                <div class="lp-learn-icon">📖</div>
                <h3>Getting Started</h3>
                <p>Learn the basics of BlindFake: Phantom</p>
              </div>
              <div class="lp-learn-card">
                <div class="lp-learn-icon">🎮</div>
                <h3>Game Templates</h3>
                <p>Start with pre-built game templates</p>
              </div>
              <div class="lp-learn-card">
                <div class="lp-learn-icon">📜</div>
                <h3>Visual Scripting</h3>
                <p>Create game logic without code</p>
              </div>
              <div class="lp-learn-card">
                <div class="lp-learn-icon">🏔️</div>
                <h3>Terrain & World</h3>
                <p>Build open worlds with terrain tools</p>
              </div>
            </div>
          </div>
        </div>

        <!-- New Project Modal -->
        <div class="lp-modal lp-hidden" data-modal="new-project">
          <div class="lp-modal-backdrop"></div>
          <div class="lp-modal-content">
            <h2>New Project</h2>
            <div class="lp-form-group">
              <label>Project Name</label>
              <input type="text" class="lp-input" data-input="project-name" placeholder="My Awesome Game" maxlength="50" />
            </div>
            <div class="lp-form-group">
              <label>Template</label>
              <div class="lp-template-grid">
                <div class="lp-template-card selected" data-template="3d">
                  <div class="lp-template-preview lp-template-3d">
                    <div class="lp-cube"></div>
                  </div>
                  <div class="lp-template-label">3D Empty</div>
                  <div class="lp-template-desc">Blank 3D scene with lighting and camera</div>
                </div>
                <div class="lp-template-card" data-template="2d">
                  <div class="lp-template-preview lp-template-2d">
                    <div class="lp-sprite"></div>
                  </div>
                  <div class="lp-template-label">2D Empty</div>
                  <div class="lp-template-desc">Blank 2D scene with orthographic camera</div>
                </div>
                <div class="lp-template-card" data-template="platformer3d">
                  <div class="lp-template-preview lp-template-3d">
                    <div class="lp-cube" style="background:#2ecc71"></div>
                  </div>
                  <div class="lp-template-label">Platformer 3D</div>
                  <div class="lp-template-desc">Player, platforms, 3rd-person camera, and physics</div>
                </div>
                <div class="lp-template-card" data-template="fps">
                  <div class="lp-template-preview lp-template-3d">
                    <div class="lp-cube" style="background:#e74c3c"></div>
                  </div>
                  <div class="lp-template-label">FPS</div>
                  <div class="lp-template-desc">First-person camera, arena, shooting mechanics</div>
                </div>
                <div class="lp-template-card" data-template="topdown2d">
                  <div class="lp-template-preview lp-template-2d">
                    <div class="lp-sprite" style="background:#3498db"></div>
                  </div>
                  <div class="lp-template-label">Top-Down 2D</div>
                  <div class="lp-template-desc">2D player, tilemap, enemies, top-down camera</div>
                </div>
                <div class="lp-template-card" data-template="mainmenu">
                  <div class="lp-template-preview lp-template-3d">
                    <div class="lp-cube" style="background:#9b59b6"></div>
                  </div>
                  <div class="lp-template-label">Main Menu</div>
                  <div class="lp-template-desc">Animated 3D background with UI menu system</div>
                </div>
                <div class="lp-template-card" data-template="fighting">
                  <div class="lp-template-preview lp-template-3d">
                    <div class="lp-cube" style="background:#e67e22"></div>
                  </div>
                  <div class="lp-template-label">Fighting</div>
                  <div class="lp-template-desc">3D arena fighter with Stand system, health bars, combos</div>
                </div>
                <div class="lp-template-card" data-template="racing">
                  <div class="lp-template-preview lp-template-3d">
                    <div class="lp-cube" style="background:#f1c40f"></div>
                  </div>
                  <div class="lp-template-label">Racing</div>
                  <div class="lp-template-desc">Vehicle physics, track, lap timer, drift controls</div>
                </div>
                <div class="lp-template-card" data-template="puzzle">
                  <div class="lp-template-preview lp-template-3d">
                    <div class="lp-cube" style="background:#1abc9c"></div>
                  </div>
                  <div class="lp-template-label">Puzzle / Adventure</div>
                  <div class="lp-template-desc">3rd-person exploration, inventory, dialogue, puzzle triggers</div>
                </div>
              </div>
            </div>
            <div class="lp-modal-actions">
              <button class="lp-btn" data-action="cancel-modal">Cancel</button>
              <button class="lp-btn lp-btn-primary" data-action="create-project">Create Project</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderEmptyState(): string {
    return `
      <div class="lp-empty">
        <div class="lp-empty-icon">🎮</div>
        <h2>No projects yet</h2>
        <p>Create your first project to get started</p>
        <button class="lp-btn lp-btn-primary lp-btn-lg" data-action="new">+ New Project</button>
      </div>
    `;
  }

  private renderProjectList(projects: ProjectInfo[]): string {
    return `
      <div class="lp-project-grid">
        ${projects.map(p => `
          <div class="lp-project-card" data-id="${p.id}">
            <div class="lp-project-thumb">
              <div class="lp-project-thumb-icon">${this.templateIcon(p.template)}</div>
              <div class="lp-project-badge">${this.templateBadge(p.template)}</div>
            </div>
            <div class="lp-project-info">
              <div class="lp-project-name">${this.escapeHtml(p.name)}</div>
              <div class="lp-project-date">${this.formatDate(p.lastOpened)}</div>
            </div>
            <button class="lp-project-delete" data-delete="${p.id}" title="Delete project">&times;</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  private templateIcon(t: ProjectTemplate): string {
    switch (t) {
      case 'platformer3d': return '🏃';
      case 'fps': return '🔫';
      case 'topdown2d': return '🗡️';
      case 'fighting': return '👊';
      case 'racing': return '🏎️';
      case 'puzzle': return '🧩';
      case 'mainmenu': return '🎬';
      case '2d': return '🕹️';
      default: return '🎮';
    }
  }

  private templateBadge(t: ProjectTemplate): string {
    switch (t) {
      case 'platformer3d': return 'PLATFORMER';
      case 'fps': return 'FPS';
      case 'topdown2d': return 'TOP-DOWN';
      case 'fighting': return 'FIGHTING';
      case 'racing': return 'RACING';
      case 'puzzle': return 'PUZZLE';
      case 'mainmenu': return 'MENU';
      default: return t.toUpperCase();
    }
  }

  private formatDate(ts: number): string {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return d.toLocaleDateString();
  }

  private bindEvents(): void {
    const root = this.container;

    // Nav
    root.querySelectorAll('.lp-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        root.querySelectorAll('.lp-nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const section = (item as HTMLElement).dataset.section!;
        root.querySelectorAll('[data-section-content]').forEach(el => {
          (el as HTMLElement).classList.toggle('lp-hidden', (el as HTMLElement).dataset.sectionContent !== section);
        });
        const h1 = root.querySelector('.lp-header h1');
        if (h1) h1.textContent = section === 'projects' ? 'Projects' : 'Learn';
      });
    });

    // New project buttons
    root.querySelectorAll('[data-action="new"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = root.querySelector('[data-modal="new-project"]');
        modal?.classList.remove('lp-hidden');
        const input = root.querySelector('[data-input="project-name"]') as HTMLInputElement;
        if (input) { input.value = ''; input.focus(); }
      });
    });

    // Template selection
    root.querySelectorAll('.lp-template-card').forEach(card => {
      card.addEventListener('click', () => {
        root.querySelectorAll('.lp-template-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      });
    });

    // Cancel modal
    root.querySelectorAll('[data-action="cancel-modal"], .lp-modal-backdrop').forEach(el => {
      el.addEventListener('click', () => {
        root.querySelectorAll('.lp-modal').forEach(m => m.classList.add('lp-hidden'));
      });
    });

    // Create project
    root.querySelector('[data-action="create-project"]')?.addEventListener('click', () => {
      const nameInput = root.querySelector('[data-input="project-name"]') as HTMLInputElement;
      const name = nameInput?.value.trim() || 'Untitled Project';
      const templateEl = root.querySelector('.lp-template-card.selected') as HTMLElement;
      const template = (templateEl?.dataset.template || '3d') as ProjectTemplate;
      const project = this.createProject(name, template);
      root.querySelectorAll('.lp-modal').forEach(m => m.classList.add('lp-hidden'));
      this.openProject(project);
    });

    // Open project
    root.querySelectorAll('.lp-project-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.lp-project-delete')) return;
        const id = (card as HTMLElement).dataset.id!;
        const project = this.projects.find(p => p.id === id);
        if (project) this.openProject(project);
      });
    });

    // Delete project
    root.querySelectorAll('.lp-project-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.delete!;
        if (confirm('Delete this project? Scene data will be lost.')) {
          this.deleteProject(id);
        }
      });
    });

    // Enter key in name input
    root.querySelector('[data-input="project-name"]')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        root.querySelector<HTMLElement>('[data-action="create-project"]')?.click();
      }
    });
  }
}
