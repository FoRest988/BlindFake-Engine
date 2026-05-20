/**
 * PanelPersistenceService — save and restore editor tab / panel layout state.
 *
 * Persists to localStorage under a versioned key so stale snapshots are
 * discarded after a schema change.
 *
 * Usage:
 *   const svc = new PanelPersistenceService();
 *
 *   // Save the active tab on every tab change:
 *   svc.setActiveTab('inspector');
 *
 *   // Save a panel's pixel size:
 *   svc.setPanelSize('hierarchy', 240);
 *
 *   // On startup, restore:
 *   const { activeTab, panelSizes } = svc.restore();
 */

const STORAGE_KEY = 'blindfake_panel_state_v1';

export interface PanelLayout {
  /** ID of the currently active tab (e.g. 'inspector', 'assetBrowser') */
  activeTab: string | null;

  /**
   * Open secondary panels — set of panel IDs that are currently shown.
   * e.g. ['console', 'preferences']
   */
  openPanels: string[];

  /**
   * Pixel sizes for resizable panels (panel ID → px).
   * e.g. { hierarchy: 240, inspector: 280 }
   */
  panelSizes: Record<string, number>;

  /** Timestamp of last save (ms since epoch) */
  savedAt: number;
}

const DEFAULT_LAYOUT: PanelLayout = {
  activeTab: null,
  openPanels: [],
  panelSizes: {},
  savedAt: 0,
};

export class PanelPersistenceService {
  private layout: PanelLayout;

  constructor() {
    this.layout = this._load();
  }

  // ── Restore ─────────────────────────────────────────────────────────────────

  /** Return the last saved layout snapshot. */
  restore(): PanelLayout {
    return { ...this.layout };
  }

  /** Convenience: restore just the active tab ID. */
  getActiveTab(): string | null {
    return this.layout.activeTab;
  }

  /** Convenience: restore the size of a specific panel (returns undefined if not saved). */
  getPanelSize(panelId: string): number | undefined {
    return this.layout.panelSizes[panelId];
  }

  /** Return whether a panel was open in the last session. */
  wasPanelOpen(panelId: string): boolean {
    return this.layout.openPanels.includes(panelId);
  }

  // ── Persist ─────────────────────────────────────────────────────────────────

  /** Record the currently active tab and persist. */
  setActiveTab(tabId: string | null): void {
    this.layout.activeTab = tabId;
    this._save();
  }

  /** Record a panel's pixel size and persist. */
  setPanelSize(panelId: string, px: number): void {
    this.layout.panelSizes[panelId] = Math.round(px);
    this._save();
  }

  /** Mark a panel as open and persist. */
  openPanel(panelId: string): void {
    if (!this.layout.openPanels.includes(panelId)) {
      this.layout.openPanels.push(panelId);
      this._save();
    }
  }

  /** Mark a panel as closed and persist. */
  closePanel(panelId: string): void {
    const idx = this.layout.openPanels.indexOf(panelId);
    if (idx !== -1) {
      this.layout.openPanels.splice(idx, 1);
      this._save();
    }
  }

  /** Toggle a panel's open state and persist. Returns new open state. */
  togglePanel(panelId: string): boolean {
    if (this.wasPanelOpen(panelId)) {
      this.closePanel(panelId);
      return false;
    }
    this.openPanel(panelId);
    return true;
  }

  /** Replace the full layout snapshot and persist. */
  save(layout: Partial<PanelLayout>): void {
    Object.assign(this.layout, layout, { savedAt: Date.now() });
    this._save();
  }

  /** Reset to defaults and clear localStorage. */
  reset(): void {
    this.layout = { ...DEFAULT_LAYOUT };
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private _load(): PanelLayout {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PanelLayout>;
        return {
          activeTab: parsed.activeTab ?? null,
          openPanels: Array.isArray(parsed.openPanels) ? parsed.openPanels : [],
          panelSizes: (parsed.panelSizes && typeof parsed.panelSizes === 'object') ? parsed.panelSizes : {},
          savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
        };
      }
    } catch { /* corrupt data — fall through */ }
    return { ...DEFAULT_LAYOUT };
  }

  private _save(): void {
    this.layout.savedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.layout));
    } catch { /* quota exceeded — ignore */ }
  }
}
