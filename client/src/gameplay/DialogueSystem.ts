// ─── Dialogue System ────────────────────────────────────────────────
// NPC dialogue with branching choices, conditions, events, speaker
// portraits, typing effect, and dialogue trees.

export interface DialogueLine {
  id: string;
  speaker: string;
  text: string;
  /** Optional portrait image URL or key */
  portrait?: string;
  /** Auto-advance after seconds (0 = wait for input) */
  autoAdvance?: number;
  /** Choices for the player */
  choices?: DialogueChoice[];
  /** Next line ID (if no choices) */
  next?: string | null;
  /** Condition that must be true to show this line */
  condition?: (context: DialogueContext) => boolean;
  /** Event triggered when this line is displayed */
  onShow?: (context: DialogueContext) => void;
  /** Typing speed (chars per second, 0 = instant) */
  typingSpeed?: number;
}

export interface DialogueChoice {
  text: string;
  /** Line ID to jump to */
  next: string;
  /** Condition to show this choice */
  condition?: (context: DialogueContext) => boolean;
  /** Event when choice is selected */
  onSelect?: (context: DialogueContext) => void;
}

export interface DialogueContext {
  /** Game flags/variables accessible during dialogue */
  flags: Map<string, any>;
  /** Set a flag */
  setFlag: (key: string, value: any) => void;
  /** Get a flag */
  getFlag: (key: string) => any;
  /** Check a flag */
  hasFlag: (key: string) => boolean;
}

export interface DialogueTree {
  id: string;
  name: string;
  lines: DialogueLine[];
  startLineId: string;
}

// ── Dialogue Manager ──────────────────────────────────────────────

export class DialogueManager {
  private trees = new Map<string, DialogueTree>();
  private context: DialogueContext;
  private currentTree: DialogueTree | null = null;
  private currentLine: DialogueLine | null = null;

  // UI
  private overlay: HTMLElement | null = null;
  private speakerEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private portraitEl: HTMLElement | null = null;
  private choicesEl: HTMLElement | null = null;

  // Typing effect
  private typing = false;
  private typedText = '';
  private typeTimer = 0;
  private typeIndex = 0;
  private currentTypingSpeed = 40;

  // Callbacks
  public onDialogueStart: ((treeId: string) => void) | null = null;
  public onDialogueEnd: ((treeId: string) => void) | null = null;
  public onLineShow: ((line: DialogueLine) => void) | null = null;
  public onChoiceSelected: ((choice: DialogueChoice) => void) | null = null;

  // State
  private active = false;
  private autoAdvanceTimer = 0;

  constructor() {
    const flags = new Map<string, any>();
    this.context = {
      flags,
      setFlag: (k, v) => flags.set(k, v),
      getFlag: (k) => flags.get(k),
      hasFlag: (k) => flags.has(k),
    };
  }

  /** Register a dialogue tree */
  addTree(tree: DialogueTree): void {
    this.trees.set(tree.id, tree);
  }

  /** Create a dialogue tree from a simple array of exchanges */
  createSimpleDialogue(
    id: string,
    name: string,
    exchanges: { speaker: string; text: string; portrait?: string }[],
  ): DialogueTree {
    const lines: DialogueLine[] = exchanges.map((ex, i) => ({
      id: `line_${i}`,
      speaker: ex.speaker,
      text: ex.text,
      portrait: ex.portrait,
      next: i < exchanges.length - 1 ? `line_${i + 1}` : null,
    }));

    const tree: DialogueTree = { id, name, lines, startLineId: 'line_0' };
    this.addTree(tree);
    return tree;
  }

  /** Start a dialogue tree */
  start(treeId: string): boolean {
    const tree = this.trees.get(treeId);
    if (!tree) return false;

    this.currentTree = tree;
    this.active = true;
    this.createUI();
    this.showLine(tree.startLineId);
    this.onDialogueStart?.(treeId);
    return true;
  }

  /** End current dialogue */
  end(): void {
    if (!this.currentTree) return;
    const treeId = this.currentTree.id;
    this.active = false;
    this.currentTree = null;
    this.currentLine = null;
    this.destroyUI();
    this.onDialogueEnd?.(treeId);
  }

  /** Advance to next line (skip typing or go to next) */
  advance(): void {
    if (!this.active || !this.currentLine) return;

    // If typing, skip to end
    if (this.typing) {
      this.typing = false;
      if (this.textEl) this.textEl.textContent = this.currentLine.text;
      this.showChoices();
      return;
    }

    // If line has choices, don't auto-advance
    if (this.currentLine.choices && this.currentLine.choices.length > 0) return;

    // Go to next line
    if (this.currentLine.next) {
      this.showLine(this.currentLine.next);
    } else {
      this.end();
    }
  }

  /** Select a choice by index */
  selectChoice(index: number): void {
    if (!this.currentLine?.choices) return;

    const visibleChoices = this.getVisibleChoices();
    if (index < 0 || index >= visibleChoices.length) return;

    const choice = visibleChoices[index];
    this.onChoiceSelected?.(choice);
    choice.onSelect?.(this.context);

    if (choice.next) {
      this.showLine(choice.next);
    } else {
      this.end();
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Update typing effect (call each frame) */
  update(delta: number): void {
    if (!this.active || !this.currentLine) return;

    // Typing effect
    if (this.typing && this.textEl) {
      this.typeTimer += delta * 1000;
      const msPerChar = 1000 / this.currentTypingSpeed;

      while (this.typeTimer >= msPerChar && this.typeIndex < this.currentLine.text.length) {
        this.typeTimer -= msPerChar;
        this.typeIndex++;
        this.typedText = this.currentLine.text.substring(0, this.typeIndex);
        this.textEl.textContent = this.typedText;
      }

      if (this.typeIndex >= this.currentLine.text.length) {
        this.typing = false;
        this.showChoices();
      }
    }

    // Auto-advance
    if (!this.typing && this.currentLine.autoAdvance && this.currentLine.autoAdvance > 0) {
      this.autoAdvanceTimer += delta;
      if (this.autoAdvanceTimer >= this.currentLine.autoAdvance) {
        this.advance();
      }
    }
  }

  /** Get the dialogue context for flag manipulation */
  getContext(): DialogueContext {
    return this.context;
  }

  // ── Private ─────────────────────────────────────────────────────

  private showLine(lineId: string): void {
    if (!this.currentTree) return;

    const line = this.currentTree.lines.find((l) => l.id === lineId);
    if (!line) { this.end(); return; }

    // Check condition
    if (line.condition && !line.condition(this.context)) {
      // Skip to next
      if (line.next) this.showLine(line.next);
      else this.end();
      return;
    }

    this.currentLine = line;
    this.autoAdvanceTimer = 0;

    // Update UI
    if (this.speakerEl) {
      this.speakerEl.textContent = line.speaker;
      this.speakerEl.style.display = line.speaker ? '' : 'none';
    }

    if (this.portraitEl) {
      if (line.portrait) {
        this.portraitEl.style.backgroundImage = `url(${line.portrait})`;
        this.portraitEl.style.display = '';
      } else {
        this.portraitEl.style.display = 'none';
      }
    }

    // Clear choices
    if (this.choicesEl) this.choicesEl.innerHTML = '';

    // Start typing effect
    this.currentTypingSpeed = line.typingSpeed ?? 40;
    if (this.currentTypingSpeed > 0) {
      this.typing = true;
      this.typedText = '';
      this.typeTimer = 0;
      this.typeIndex = 0;
      if (this.textEl) this.textEl.textContent = '';
    } else {
      this.typing = false;
      if (this.textEl) this.textEl.textContent = line.text;
      this.showChoices();
    }

    line.onShow?.(this.context);
    this.onLineShow?.(line);
  }

  private showChoices(): void {
    if (!this.currentLine?.choices || !this.choicesEl) return;

    const visibleChoices = this.getVisibleChoices();
    if (visibleChoices.length === 0) return;

    this.choicesEl.innerHTML = '';
    visibleChoices.forEach((choice, i) => {
      const btn = document.createElement('button');
      btn.className = 'dialogue-choice';
      btn.textContent = `${i + 1}. ${choice.text}`;
      btn.style.cssText = `
        display:block;width:100%;text-align:left;padding:8px 12px;
        margin:4px 0;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);
        border-radius:4px;color:#fff;font-size:13px;cursor:pointer;
        pointer-events:auto;transition:background 0.2s;
      `;
      btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(0,120,212,0.5)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(255,255,255,0.1)'; });
      btn.addEventListener('click', () => this.selectChoice(i));
      this.choicesEl!.appendChild(btn);
    });
  }

  private getVisibleChoices(): DialogueChoice[] {
    if (!this.currentLine?.choices) return [];
    return this.currentLine.choices.filter((c) => !c.condition || c.condition(this.context));
  }

  private createUI(): void {
    this.destroyUI();

    this.overlay = document.createElement('div');
    this.overlay.id = 'dialogue-overlay';
    this.overlay.style.cssText = `
      position:fixed;bottom:0;left:0;width:100%;
      padding:20px;box-sizing:border-box;pointer-events:auto;
      z-index:800;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      max-width:800px;margin:0 auto;background:rgba(0,0,0,0.85);
      border:1px solid rgba(255,255,255,0.15);border-radius:8px;
      padding:16px 20px;backdrop-filter:blur(8px);
    `;

    // Portrait + text container
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:16px;align-items:flex-start;';

    this.portraitEl = document.createElement('div');
    this.portraitEl.style.cssText = `
      width:64px;height:64px;border-radius:50%;border:2px solid #0078d4;
      background-size:cover;background-position:center;flex-shrink:0;display:none;
    `;
    row.appendChild(this.portraitEl);

    const textContainer = document.createElement('div');
    textContainer.style.cssText = 'flex:1;min-width:0;';

    this.speakerEl = document.createElement('div');
    this.speakerEl.style.cssText = 'color:#0078d4;font-weight:bold;font-size:14px;margin-bottom:6px;';
    textContainer.appendChild(this.speakerEl);

    this.textEl = document.createElement('div');
    this.textEl.style.cssText = 'color:#eee;font-size:14px;line-height:1.6;min-height:40px;';
    textContainer.appendChild(this.textEl);

    this.choicesEl = document.createElement('div');
    this.choicesEl.style.cssText = 'margin-top:12px;';
    textContainer.appendChild(this.choicesEl);

    row.appendChild(textContainer);
    box.appendChild(row);

    // Advance hint
    const hint = document.createElement('div');
    hint.style.cssText = 'text-align:right;color:#555;font-size:10px;margin-top:8px;';
    hint.textContent = 'Click or press Space to continue';
    box.appendChild(hint);

    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);

    // Click to advance
    this.overlay.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('dialogue-choice')) return;
      this.advance();
    });
  }

  private destroyUI(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.speakerEl = null;
    this.textEl = null;
    this.portraitEl = null;
    this.choicesEl = null;
  }
}
