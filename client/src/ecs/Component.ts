import type { Entity } from './Entity';

export abstract class Component {
  public entity?: Entity;

  /**
   * Release resources owned by the component (scene objects, GPU buffers, bodies).
   * Called by World when the owning entity is removed or the world is cleared.
   */
  dispose?(): void;
}

export interface ComponentClass<T extends Component = Component> {
  new (...args: any[]): T;
}
