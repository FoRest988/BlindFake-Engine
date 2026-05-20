import type { Entity } from './Entity';

export abstract class Component {
  public entity?: Entity;
}

export interface ComponentClass<T extends Component = Component> {
  new (...args: any[]): T;
}
