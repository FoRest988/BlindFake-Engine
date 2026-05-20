import { System } from '../System';
import { AnimationComponent, StateMachineComponent } from '../components/GameComponents';
import type { Engine } from '../../engine/Engine';

export class AnimationSystem extends System {
  public priority = 20;
  private engine: Engine;
  /** Tracks the clips array reference last bound per entity, so we rebind when clips change. */
  private clipVersions = new Map<number, unknown[]>();

  constructor(engine: Engine) {
    super();
    this.engine = engine;
  }

  update(delta: number, _elapsed: number): void {
    // Update standard animation mixers
    const entities = this.world.query(AnimationComponent);
    for (const entity of entities) {
      const anim = entity.get(AnimationComponent);

      // If this entity also has a state machine, update it
      if (entity.has(StateMachineComponent)) {
        const sm = entity.get(StateMachineComponent);
        // Rebind when clips haven't been bound yet OR the clips array reference changed at runtime
        const lastClips = this.clipVersions.get(entity.id);
        if (!sm.bound || lastClips !== (anim.clips as unknown[])) {
          sm.stateMachine.bind(anim.mixer, anim.clips);
          sm.bound = true;
          this.clipVersions.set(entity.id, anim.clips as unknown[]);
        }
        sm.stateMachine.update(delta);
      }

      anim.mixer.update(delta);
    }
  }
}
