// ─── AI System ──────────────────────────────────────────────────────
// Updates AI entities: pathfinding movement, trigger zones, lifetime.

import * as THREE from 'three';
import { System } from '../System';
import { TransformComponent } from '../components/GameComponents';
import {
  AIComponent,
  PathAgentComponent,
  TriggerZoneComponent,
  LifetimeComponent,
} from '../components/GameComponents2D';

export class AISystem extends System {
  priority = 30; // After physics

  private _tempVec = new THREE.Vector3();

  update(delta: number, _elapsed: number): void {
    this.updatePathAgents(delta);
    this.updateTriggerZones();
    this.updateLifetimes(delta);
  }

  private updatePathAgents(delta: number): void {
    const entities = this.world.query(TransformComponent, PathAgentComponent);

    for (const entity of entities) {
      const transform = entity.get(TransformComponent);
      const agent = entity.get(PathAgentComponent);

      if (agent.path.length === 0 || agent.pathIndex >= agent.path.length) continue;

      const target = agent.path[agent.pathIndex];
      this._tempVec.copy(target).sub(transform.position);
      this._tempVec.y = 0; // Stay on ground plane
      const dist = this._tempVec.length();

      if (dist < agent.waypointThreshold) {
        agent.pathIndex++;
        if (agent.pathIndex >= agent.path.length) {
          agent.path = [];
          agent.pathIndex = 0;
          continue;
        }
      }

      // Move toward waypoint
      if (dist > 0.01) {
        this._tempVec.normalize().multiplyScalar(agent.speed * delta);
        transform.position.add(this._tempVec);

        // Face direction
        if (agent.faceDirection) {
          const angle = Math.atan2(this._tempVec.x, this._tempVec.z);
          transform.rotation.y = angle;
          transform.quaternion.setFromEuler(transform.rotation);
        }
      }
    }
  }

  private updateTriggerZones(): void {
    const triggers = this.world.query(TransformComponent, TriggerZoneComponent);
    const allEntities = this.world.query(TransformComponent);

    for (const triggerEntity of triggers) {
      const trigger = triggerEntity.get(TriggerZoneComponent);
      if (!trigger.enabled) continue;
      const trigTransform = triggerEntity.get(TransformComponent);
      const previousInside = new Set(trigger.entitiesInside);

      trigger.entitiesInside.clear();

      for (const other of allEntities) {
        if (other.id === triggerEntity.id) continue;
        if (trigger.filterTag && !other.hasTag(trigger.filterTag)) continue;

        const otherTransform = other.get(TransformComponent);
        const dist = trigTransform.position.distanceTo(otherTransform.position);

        const inRange = trigger.shape === 'sphere'
          ? dist <= trigger.radius
          : this.isInsideBox(trigTransform.position, trigger.size, otherTransform.position);

        if (inRange) {
          trigger.entitiesInside.add(other.id);

          if (!previousInside.has(other.id)) {
            // Entity entered
            if (trigger.onEnterTag) other.addTag(trigger.onEnterTag);
          }
        }
      }

      // Check exits
      for (const prevId of previousInside) {
        if (!trigger.entitiesInside.has(prevId)) {
          // Entity exited — O(1) lookup via World.getEntity instead of scanning all entities
          const e = this.world.getEntity(prevId);
          if (e && trigger.onExitTag) {
            e.addTag(trigger.onExitTag);
          }
        }
      }
    }
  }

  private updateLifetimes(delta: number): void {
    const entities = this.world.query(LifetimeComponent);

    for (const entity of entities) {
      const lt = entity.get(LifetimeComponent);
      lt.elapsed += delta;
      if (lt.expired) {
        this.world.removeEntity(entity.id);
      }
    }
  }

  private isInsideBox(center: THREE.Vector3, halfSize: THREE.Vector3, point: THREE.Vector3): boolean {
    return (
      Math.abs(point.x - center.x) <= halfSize.x &&
      Math.abs(point.y - center.y) <= halfSize.y &&
      Math.abs(point.z - center.z) <= halfSize.z
    );
  }
}
