/**
 * SceneVersioning — Track scene changes and provide version history.
 * Stores snapshots of scene state that can be restored.
 */

const VERSIONS_KEY = 'blindfake_scene_versions';
const MAX_VERSIONS = 20;

export interface SceneVersion {
  id: string;
  timestamp: number;
  label: string;
  data: string; // serialized scene JSON
  auto: boolean;
}

export class SceneVersioning {
  private versions: SceneVersion[] = [];
  private sceneId: string;

  constructor(sceneId: string) {
    this.sceneId = sceneId;
    this.load();
  }

  /** Save a version snapshot */
  save(sceneData: string, label?: string, auto = false): SceneVersion {
    const version: SceneVersion = {
      id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      label: label || (auto ? 'Auto-save' : `Save ${this.versions.length + 1}`),
      data: sceneData,
      auto,
    };

    this.versions.push(version);

    // Trim old auto-saves, keep manual saves
    while (this.versions.length > MAX_VERSIONS) {
      const autoIdx = this.versions.findIndex(v => v.auto);
      if (autoIdx >= 0) {
        this.versions.splice(autoIdx, 1);
      } else {
        this.versions.shift();
      }
    }

    this.persist();
    return version;
  }

  /** Get all versions, newest first */
  getAll(): SceneVersion[] {
    return [...this.versions].sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Get a specific version */
  get(id: string): SceneVersion | undefined {
    return this.versions.find(v => v.id === id);
  }

  /** Delete a version */
  delete(id: string): void {
    this.versions = this.versions.filter(v => v.id !== id);
    this.persist();
  }

  /** Render version list UI */
  render(onRestore: (data: string) => void): HTMLElement {
    const container = document.createElement('div');
    container.style.cssText = 'padding:8px;max-height:400px;overflow-y:auto;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
    header.innerHTML = `
      <span style="font-size:13px;font-weight:600;">🕐 Version History</span>
      <span style="font-size:10px;color:#666;">${this.versions.length} versions</span>
    `;
    container.appendChild(header);

    const versions = this.getAll();
    if (versions.length === 0) {
      container.innerHTML += '<div style="color:#666;text-align:center;padding:20px;font-size:11px;">No saved versions yet</div>';
      return container;
    }

    for (const v of versions) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;border:1px solid #333;margin-bottom:4px;';

      const icon = v.auto ? '🔄' : '💾';
      const date = new Date(v.timestamp);
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });

      row.innerHTML = `
        <span>${icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${v.label}</div>
          <div style="font-size:9px;color:#666;">${dateStr} ${timeStr}</div>
        </div>
      `;

      const restoreBtn = document.createElement('button');
      restoreBtn.textContent = 'Restore';
      restoreBtn.style.cssText = 'padding:2px 8px;font-size:10px;border:1px solid #444;background:#2a2a3a;color:#ccc;border-radius:3px;cursor:pointer;';
      restoreBtn.addEventListener('click', () => onRestore(v.data));
      row.appendChild(restoreBtn);

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.style.cssText = 'padding:2px 6px;font-size:10px;border:1px solid #444;background:transparent;color:#666;border-radius:3px;cursor:pointer;';
      delBtn.addEventListener('click', () => {
        this.delete(v.id);
        container.replaceWith(this.render(onRestore));
      });
      row.appendChild(delBtn);

      container.appendChild(row);
    }

    return container;
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(`${VERSIONS_KEY}_${this.sceneId}`);
      this.versions = raw ? JSON.parse(raw) : [];
    } catch { this.versions = []; }
  }

  private persist(): void {
    localStorage.setItem(`${VERSIONS_KEY}_${this.sceneId}`, JSON.stringify(this.versions));
  }
}
