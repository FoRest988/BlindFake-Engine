import { Component, ComponentClass } from './Component';

export class Entity {
  public readonly id: number;
  public name: string;
  public active = true;
  public tags = new Set<string>();

  /** Called by World when this entity is registered — do not set manually. */
  _onComponentAdded?: (type: ComponentClass) => void;
  /** Called by World when this entity is registered — do not set manually. */
  _onComponentRemoved?: (type: ComponentClass, component: Component) => void;

  private components = new Map<ComponentClass, Component>();

  constructor(id: number, name?: string) {
    this.id = id;
    this.name = name ?? `Entity_${id}`;
  }

  add<T extends Component>(component: T): this {
    const ctor = component.constructor as ComponentClass;
    this.components.set(ctor, component);
    component.entity = this;
    this._onComponentAdded?.(ctor);
    return this;
  }

  get<T extends Component>(type: ComponentClass<T>): T {
    const comp = this.components.get(type);
    if (!comp) {
      throw new Error(`Entity "${this.name}" does not have component ${type.name}`);
    }
    return comp as T;
  }

  tryGet<T extends Component>(type: ComponentClass<T>): T | undefined {
    return this.components.get(type) as T | undefined;
  }

  has(type: ComponentClass): boolean {
    return this.components.has(type);
  }

  remove(type: ComponentClass): void {
    const comp = this.components.get(type);
    if (comp) {
      comp.entity = undefined;
      this.components.delete(type);
      this._onComponentRemoved?.(type, comp);
    }
  }

  addTag(tag: string): this {
    this.tags.add(tag);
    return this;
  }

  hasTag(tag: string): boolean {
    return this.tags.has(tag);
  }

  /** Get all components on this entity */
  getAll(): Component[] {
    return Array.from(this.components.values());
  }

  /** Get all component constructor types on this entity */
  getComponentTypes(): ComponentClass[] {
    return Array.from(this.components.keys());
  }

  dispose(): void {
    this.components.clear();
    this.active = false;
  }
}
