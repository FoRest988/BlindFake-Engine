// ─── Localization (i18n) System ──────────────────────────────────────
// Multi-language text management with fallback, interpolation,
// pluralization, and dynamic language switching.

export interface LocaleData {
  [key: string]: string | LocaleData;
}

export class Localization {
  private locales = new Map<string, LocaleData>();
  private currentLocale = 'en';
  private fallbackLocale = 'en';
  private onLanguageChange: ((locale: string) => void) | null = null;

  /** Register a locale with its translations */
  addLocale(locale: string, data: LocaleData): void {
    const existing = this.locales.get(locale);
    if (existing) {
      this.merge(existing, data);
    } else {
      this.locales.set(locale, data);
    }
  }

  /** Set the active language */
  setLocale(locale: string): void {
    if (this.locales.has(locale)) {
      this.currentLocale = locale;
      this.onLanguageChange?.(locale);
    }
  }

  /** Set the fallback language (used when key is missing in current locale) */
  setFallback(locale: string): void {
    this.fallbackLocale = locale;
  }

  /** Set callback for language changes (useful for re-rendering UI) */
  onChangeLanguage(fn: (locale: string) => void): void {
    this.onLanguageChange = fn;
  }

  get locale(): string {
    return this.currentLocale;
  }

  /** Get available locales */
  getAvailableLocales(): string[] {
    return Array.from(this.locales.keys());
  }

  /**
   * Translate a key. Supports:
   * - Nested keys with dots: "menu.play", "items.sword.name"
   * - Interpolation: "Hello {{name}}" + {name: "Player"}
   * - Pluralization: "item_count" → "items.one" / "items.other" via count param
   */
  t(key: string, params?: Record<string, string | number>): string {
    // Handle pluralization: if params.count exists, try key.one / key.other
    if (params && 'count' in params) {
      const count = Number(params.count);
      const pluralKey = count === 1 ? `${key}.one` : `${key}.other`;
      const pluralResult = this.resolve(pluralKey);
      if (pluralResult) return this.interpolate(pluralResult, params);
      // Also try key.zero
      if (count === 0) {
        const zeroResult = this.resolve(`${key}.zero`);
        if (zeroResult) return this.interpolate(zeroResult, params);
      }
    }

    const result = this.resolve(key);
    if (!result) return `[${key}]`; // Missing key indicator

    return params ? this.interpolate(result, params) : result;
  }

  /** Shorthand alias */
  _(key: string, params?: Record<string, string | number>): string {
    return this.t(key, params);
  }

  /** Check if a key exists in the current locale */
  has(key: string): boolean {
    return this.resolve(key) !== null;
  }

  // ── Helpers ───────────────────────────────────────────────────

  /** Auto-detect browser language and set it if available */
  detectLanguage(): string {
    const browserLangs = navigator.languages || [navigator.language];
    for (const lang of browserLangs) {
      const code = lang.split('-')[0].toLowerCase();
      if (this.locales.has(code)) {
        this.setLocale(code);
        return code;
      }
      // Try full code (e.g., pt-BR)
      if (this.locales.has(lang.toLowerCase())) {
        this.setLocale(lang.toLowerCase());
        return lang.toLowerCase();
      }
    }
    return this.currentLocale;
  }

  // ── Private ───────────────────────────────────────────────────

  private resolve(key: string): string | null {
    // Try current locale
    const result = this.resolveIn(this.currentLocale, key);
    if (result !== null) return result;

    // Try fallback locale
    if (this.currentLocale !== this.fallbackLocale) {
      return this.resolveIn(this.fallbackLocale, key);
    }

    return null;
  }

  private resolveIn(locale: string, key: string): string | null {
    const data = this.locales.get(locale);
    if (!data) return null;

    const parts = key.split('.');
    let current: any = data;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') return null;
      current = current[part];
    }

    return typeof current === 'string' ? current : null;
  }

  private interpolate(text: string, params: Record<string, string | number>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return key in params ? String(params[key]) : `{{${key}}}`;
    });
  }

  private merge(target: LocaleData, source: LocaleData): void {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'object' && typeof target[key] === 'object') {
        this.merge(target[key] as LocaleData, value as LocaleData);
      } else {
        target[key] = value;
      }
    }
  }
}

// ── Convenience: Preset Language Data ─────────────────────────────

export const ENGLISH_BASE: LocaleData = {
  common: {
    ok: 'OK',
    cancel: 'Cancel',
    yes: 'Yes',
    no: 'No',
    save: 'Save',
    load: 'Load',
    back: 'Back',
    next: 'Next',
    close: 'Close',
    confirm: 'Confirm',
    delete: 'Delete',
    edit: 'Edit',
    settings: 'Settings',
    language: 'Language',
  },
  menu: {
    newGame: 'New Game',
    continue: 'Continue',
    loadGame: 'Load Game',
    saveGame: 'Save Game',
    options: 'Options',
    quit: 'Quit',
    pause: 'Paused',
    resume: 'Resume',
  },
  hud: {
    health: 'Health',
    mana: 'Mana',
    stamina: 'Stamina',
    level: 'Level {{level}}',
    xp: '{{current}} / {{max}} XP',
  },
  items: {
    count: { one: '{{count}} item', other: '{{count}} items' },
    pickup: 'Picked up {{name}}',
    drop: 'Dropped {{name}}',
    use: 'Used {{name}}',
    equip: 'Equipped {{name}}',
    unequip: 'Unequipped {{name}}',
    inventory: 'Inventory',
    equipment: 'Equipment',
  },
  quest: {
    new: 'New Quest: {{name}}',
    complete: 'Quest Complete: {{name}}',
    failed: 'Quest Failed: {{name}}',
    objective: 'Objective: {{description}}',
    progress: '{{current}}/{{required}}',
    journal: 'Quest Journal',
  },
  dialogue: {
    skip: 'Press Space to skip',
    choice: 'Choose an option',
  },
  notifications: {
    saved: 'Game Saved',
    loaded: 'Game Loaded',
    autosave: 'Autosaving...',
    error: 'An error occurred',
    connected: 'Connected to server',
    disconnected: 'Disconnected from server',
  },
};

export const PORTUGUESE_BASE: LocaleData = {
  common: {
    ok: 'OK',
    cancel: 'Cancelar',
    yes: 'Sim',
    no: 'Não',
    save: 'Guardar',
    load: 'Carregar',
    back: 'Voltar',
    next: 'Próximo',
    close: 'Fechar',
    confirm: 'Confirmar',
    delete: 'Apagar',
    edit: 'Editar',
    settings: 'Definições',
    language: 'Idioma',
  },
  menu: {
    newGame: 'Novo Jogo',
    continue: 'Continuar',
    loadGame: 'Carregar Jogo',
    saveGame: 'Guardar Jogo',
    options: 'Opções',
    quit: 'Sair',
    pause: 'Pausado',
    resume: 'Continuar',
  },
  hud: {
    health: 'Vida',
    mana: 'Mana',
    stamina: 'Estamina',
    level: 'Nível {{level}}',
    xp: '{{current}} / {{max}} XP',
  },
  items: {
    count: { one: '{{count}} item', other: '{{count}} itens' },
    pickup: 'Apanhou {{name}}',
    drop: 'Largou {{name}}',
    use: 'Usou {{name}}',
    equip: 'Equipou {{name}}',
    unequip: 'Desequipou {{name}}',
    inventory: 'Inventário',
    equipment: 'Equipamento',
  },
  quest: {
    new: 'Nova Missão: {{name}}',
    complete: 'Missão Concluída: {{name}}',
    failed: 'Missão Falhada: {{name}}',
    objective: 'Objetivo: {{description}}',
    progress: '{{current}}/{{required}}',
    journal: 'Diário de Missões',
  },
  dialogue: {
    skip: 'Pressione Espaço para saltar',
    choice: 'Escolha uma opção',
  },
  notifications: {
    saved: 'Jogo Guardado',
    loaded: 'Jogo Carregado',
    autosave: 'A guardar automaticamente...',
    error: 'Ocorreu um erro',
    connected: 'Ligado ao servidor',
    disconnected: 'Desligado do servidor',
  },
};
