import { System } from '../System';
import { TransformComponent, MeshComponent } from '../components/GameComponents';
import type { Engine } from '../../engine/Engine';

export class RenderSystem extends System {
  public priority = 100; // Runs late
  public override runsInEditMode = true;
  private engine: Engine;

  constructor(engine: Engine) {
    super();
    this.engine = engine;
  }

  update(_delta: number, _elapsed: number): void {
    const scene = this.engine.scenes.active;
    if (!scene) return;

    const entities = this.world.query(TransformComponent, MeshComponent);
    for (const entity of entities) {
      const transform = entity.get(TransformComponent);
      const mesh = entity.get(MeshComponent);

      // Add to scene if not already
      if (!mesh.addedToScene) {
        // Owned by the ECS: recreated by gameplay code, never serialized or replaced by scene loads
        mesh.object3D.userData.__ecsOwned = true;
        scene.add(mesh.object3D);
        mesh.addedToScene = true;
      }

      // If the engine is in editor mode, read transforms FROM the 3D object
      // back into the ECS component (so gizmo changes are preserved).
      // Otherwise, push ECS → 3D as normal.
      if (this.engine.mode === 'edit') {
        transform.position.copy(mesh.object3D.position);
        transform.quaternion.copy(mesh.object3D.quaternion);
        transform.scale.copy(mesh.object3D.scale);
        transform.rotation.copy(mesh.object3D.rotation);
      } else {
        mesh.object3D.position.copy(transform.position);
        mesh.object3D.quaternion.copy(transform.quaternion);
        mesh.object3D.scale.copy(transform.scale);
      }
    }
  }
}
