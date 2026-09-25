import type { World } from './World';
import type { ComponentClass } from './Component';

export abstract class System {
  public world!: World;
  public enabled = true;

  /** Lower priority runs first */
  public priority = 0;

  /** Systems that must keep running while the editor is in 'edit' mode (e.g. transform sync). */
  public runsInEditMode = false;

  /**
   * Component types this system only reads.
   * Used by the World execution graph to detect safe-to-parallelise groups.
   * (Currently informational — parallelism via Web Workers is a future step.)
   */
  public readonly readComponents: ComponentClass[] = [];

  /**
   * Component types this system writes (adds, modifies, or removes).
   * Any two systems that share a write target are serialised.
   */
  public readonly writeComponents: ComponentClass[] = [];

  /**
   * Maximum milliseconds this system may consume in a single frame.
   * When > 0 and exceeded, the system is skipped for the remainder of
   * the current frame and will run again next frame.
   * Set to 0 (default) to disable the budget.
   */
  public tickBudgetMs = 0;

  abstract update(delta: number, elapsed: number): void;

  init(): void {}
  destroy(): void {}
}
