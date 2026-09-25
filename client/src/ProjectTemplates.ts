/**
 * ProjectTemplates — Pre-built scene setups for each project template type.
 * Called by main.ts after creating the engine and scene.
 *
 * Each template creates a playable game scene with:
 *  - Physics-collidable geometry (userData.isCollider = true)
 *  - Working player movement via ECS or direct camera control
 *  - Visible scripts on objects (userData.__luaScript) for editor inspection
 *  - Proper camera handling that syncs with the editor viewport
 */
import * as THREE from 'three';
import type { Engine } from './engine/Engine';
import { TransformComponent, MeshComponent, PhysicsBodyComponent, CameraFollowComponent } from './ecs/components/GameComponents';
import { CharacterControllerComponent } from './ecs/components/GameComponents2D';
import { TerrainSystem } from './engine/TerrainSystem';
import type { ProjectTemplate } from './LandingPage';
import { PhysicsSystem } from './ecs/systems/PhysicsSystem';
import { InputManager } from './engine/InputManager';

export interface TemplateResult {
  updateFn: ((delta: number, elapsed: number) => void) | null;
  helpText: string;
}

/** Set up the scene for the given template */
export function applyTemplate(
  engine: Engine,
  scene: THREE.Scene,
  template: ProjectTemplate,
): TemplateResult {
  switch (template) {
    case '2d':        return setup2DEmpty(engine, scene);
    case 'platformer3d': return setupPlatformer3D(engine, scene);
    default:          return setup3DDefault(engine, scene);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════

/** The visible canvas (editor viewport or engine canvas) */
function getCanvas(engine: Engine): HTMLCanvasElement {
  return engine.viewportCanvas ?? engine.renderer.domElement;
}

/** Add a static physics-collidable box mesh. Returns the mesh. */
function addStaticBox(
  scene: THREE.Scene, name: string,
  x: number, y: number, z: number,
  w: number, h: number, d: number,
  mat: THREE.Material,
  script?: string,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.name = name;
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.isCollider = true;
  if (script) m.userData.__luaScript = script;
  scene.add(m);
  return m;
}

/** Add standard directional + ambient lighting */
function addDefaultLighting(scene: THREE.Scene): void {
  const dir = new THREE.DirectionalLight(0xffeedd, 1.5);
  dir.name = 'DirectionalLight';
  dir.position.set(10, 20, 10);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.near = 0.5;
  dir.shadow.camera.far = 100;
  dir.shadow.camera.left = -40;
  dir.shadow.camera.right = 40;
  dir.shadow.camera.top = 40;
  dir.shadow.camera.bottom = -40;
  scene.add(dir);
  const amb = new THREE.AmbientLight(0x88aacc, 0.5);
  amb.name = 'AmbientLight';
  scene.add(amb);
}

/** Create a player ECS entity with capsule physics + camera follow */
function createPlayerEntity(
  engine: Engine, scene: THREE.Scene, name: string,
  x: number, y: number, z: number,
  color = 0xe74c3c,
  script?: string,
): { entity: ReturnType<typeof engine.world.createEntity>; mesh: THREE.Mesh } {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1.0, 8, 16),
    new THREE.MeshStandardMaterial({ color }),
  );
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  if (script) mesh.userData.__luaScript = script;

  const entity = engine.world.createEntity(name);
  const body = new PhysicsBodyComponent();
  body.collider = 'capsule';
  // capsule: radius = x*0.5 = 0.4 ; halfHeight = (y*0.5) - radius = 0.6
  // total height ≈ 2*halfH + 2*radius = 1.2 + 0.8 = 2.0
  body.colliderSize.set(0.8, 2.0, 0.8);
  body.lockRotation = true;
  body.mass = 1;
  body.friction = 0.5;
  body.gravity = true;
  body.bodyType = 'dynamic';

  const follow = new CameraFollowComponent();
  follow.offset.set(0, 5, 10);
  follow.lookAtOffset.set(0, 1.5, 0);
  follow.smoothSpeed = 8;

  entity
    .add(new TransformComponent().setPosition(x, y, z))
    .add(new MeshComponent(mesh))
    .add(body)
    .add(follow)
    .addTag('player');

  return { entity, mesh };
}

/** Mark physics terrain dirty so new colliders are picked up */
function markPhysicsDirty(engine: Engine): void {
  const physics = engine.world.getSystem(PhysicsSystem);
  if (physics) physics.markTerrainDirty();
}

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATE: 3D Default
// ═══════════════════════════════════════════════════════════════════

const SCRIPT_3D_PLAYER = `-- Explorer Controller (3D Adventure)
-- Third-person traversal for the default 3D sandbox.
-- Controls:
--   WASD ........ Move relative to camera heading
--   Shift ....... Sprint
--   Space ....... Jump
--   RMB Drag .... Orbit camera
--   Mouse Wheel . Zoom camera
-- Objective:
--   Recover the three energy crystals, activate the survey beacon,
--   then cross the ancient gate to finish the route.

function onStart(self)
  self.state = {
    spawn = { x = 0, y = 4, z = 0 },
    crystals = 0,
    checkpoint = "Trailhead"
  }
end

function onUpdate(self, dt)
  if self.position.y < -20 then
    self.position = {
      x = self.state.spawn.x,
      y = self.state.spawn.y,
      z = self.state.spawn.z
    }
  end
end
`;

const SCRIPT_3D_CRYSTAL = `-- Energy Crystal
-- Rotates slowly and pulses above the terrain.
-- Collect all crystals to unlock the ancient gate.
`;

const SCRIPT_3D_BEACON = `-- Survey Beacon
-- Serves as the midpoint checkpoint.
-- Once activated, respawns happen here instead of the trailhead.
`;

const SCRIPT_3D_GATE = `-- Ancient Gate
-- Locked until every energy crystal has been recovered.
-- Crossing the gate completes the default 3D adventure route.
`;

const SCRIPT_3D_WINDMILL = `-- Windmill Landmark
-- Decorative motion landmark used to make the valley feel alive.
-- Its blades rotate continuously to telegraph the route from a distance.
`;

const SCRIPT_3D_CAMP = `-- Camp Terminal
-- Intro interaction point for the exploration route.
-- Suggests the player should recover crystals and reactivate the beacon network.
`;

function setup3DDefault(engine: Engine, scene: THREE.Scene): TemplateResult {
  scene.background = new THREE.Color(0x9bc4db);
  scene.fog = new THREE.Fog(0x9bc4db, 55, 220);

  addDefaultLighting(scene);
  const terrain = new TerrainSystem(scene, {
    width: 256, depth: 256, maxHeight: 50, resolution: 128, chunks: 4,
  });
  (engine as any)._defaultTerrain = terrain;
  const collisionMesh = terrain.generateCollisionMesh();
  scene.add(collisionMesh);

  const groundPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshStandardMaterial({ color: 0x567d46 }),
  );
  groundPlane.name = 'Ground';
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.position.y = -0.05;
  groundPlane.receiveShadow = true;
  groundPlane.userData.isCollider = true;
  scene.add(groundPlane);

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8d8c89, roughness: 0.9 });
  const mossMat = new THREE.MeshStandardMaterial({ color: 0x5d7b49, roughness: 1 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5737, roughness: 0.85 });
  const canvasMat = new THREE.MeshStandardMaterial({ color: 0xc9b28a, roughness: 1 });
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x4dcfff, emissive: 0x4dcfff, emissiveIntensity: 0.45 });
  const gateLockedMat = new THREE.MeshStandardMaterial({ color: 0x6f7a80, emissive: 0x22313a, emissiveIntensity: 0.2 });
  const gateUnlockedMat = new THREE.MeshStandardMaterial({ color: 0x86f095, emissive: 0x86f095, emissiveIntensity: 0.45 });
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x62f2ff, emissive: 0x62f2ff, emissiveIntensity: 0.75 });

  addStaticBox(scene, 'Trailhead', 0, -0.4, 0, 12, 0.8, 12, mossMat, '-- Spawn platform and safe starting area.');
  addStaticBox(scene, 'TrailRamp', 6, 0.6, -5, 8, 0.8, 4, stoneMat, '-- Gentle ramp leading toward the valley floor.');
  addStaticBox(scene, 'RuinWalkway_A', 13, 1.8, -6, 8, 0.8, 5, stoneMat, '-- First ruin walkway overlooking the ravine.');
  addStaticBox(scene, 'RuinWalkway_B', 20, 3.3, -1, 7, 0.8, 5, stoneMat, '-- Second walkway near the first crystal.');
  addStaticBox(scene, 'BeaconRise', 14, 4.8, 7, 9, 0.8, 6, stoneMat, '-- Elevated plateau containing the survey beacon.');
  addStaticBox(scene, 'GateApproach', 3, 6.3, 15, 12, 0.8, 6, stoneMat, '-- Final ridge that leads into the gate plaza.');
  addStaticBox(scene, 'GatePlaza', -9, 7.5, 20, 16, 1, 10, stoneMat, '-- Final destination beyond the route objectives.');

  const camp = new THREE.Group();
  camp.name = 'CampTerminal';
  camp.userData.__luaScript = SCRIPT_3D_CAMP;
  const campDesk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1), woodMat);
  campDesk.position.set(0, 0.55, 0);
  campDesk.castShadow = true;
  campDesk.receiveShadow = true;
  camp.add(campDesk);
  const campScreen = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.15), beaconMat);
  campScreen.position.set(0, 1.35, -0.35);
  campScreen.castShadow = true;
  camp.add(campScreen);
  camp.position.set(-3.5, 0, 2.5);
  scene.add(camp);

  const tent = new THREE.Group();
  tent.name = 'CampTent';
  const tentRoof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.2, 4), canvasMat);
  tentRoof.rotation.y = Math.PI / 4;
  tentRoof.position.y = 1.5;
  tentRoof.castShadow = true;
  tent.add(tentRoof);
  const tentFloor = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.2, 2.8), woodMat);
  tentFloor.position.y = 0.1;
  tentFloor.receiveShadow = true;
  tent.add(tentFloor);
  tent.position.set(-6, 0, 3.5);
  scene.add(tent);

  const windmill = new THREE.Group();
  windmill.name = 'Windmill_0';
  windmill.userData.__luaScript = SCRIPT_3D_WINDMILL;
  windmill.position.set(18, 2.5, 11);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 8, 8), woodMat);
  tower.position.y = 4;
  tower.castShadow = true;
  tower.receiveShadow = true;
  windmill.add(tower);
  const bladeHub = new THREE.Group();
  bladeHub.name = 'WindmillHub';
  bladeHub.position.set(0, 6.8, 0.9);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.6, 0.18), canvasMat);
    blade.position.y = 1.7;
    blade.rotation.z = i * (Math.PI / 2);
    blade.castShadow = true;
    bladeHub.add(blade);
  }
  windmill.add(bladeHub);
  scene.add(windmill);

  const beacon = new THREE.Group();
  beacon.name = 'SurveyBeacon';
  beacon.userData.__luaScript = SCRIPT_3D_BEACON;
  beacon.position.set(14, 5.2, 7);
  const beaconBase = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 1.1, 18), stoneMat);
  beaconBase.castShadow = true;
  beaconBase.receiveShadow = true;
  beacon.add(beaconBase);
  const beaconCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), beaconMat);
  beaconCore.position.y = 1.5;
  beaconCore.castShadow = true;
  beacon.add(beaconCore);
  scene.add(beacon);

  const gate = new THREE.Group();
  gate.name = 'AncientGate';
  gate.userData.__luaScript = SCRIPT_3D_GATE;
  gate.position.set(-9, 8.1, 20);
  const gateLeft = new THREE.Mesh(new THREE.BoxGeometry(1.4, 6, 1.4), gateLockedMat);
  gateLeft.position.set(-3.2, 0, 0);
  gateLeft.castShadow = true;
  gateLeft.receiveShadow = true;
  gate.add(gateLeft);
  const gateRight = gateLeft.clone();
  gateRight.position.x = 3.2;
  gate.add(gateRight);
  const gateLintel = new THREE.Mesh(new THREE.BoxGeometry(8.2, 1.1, 1.4), gateLockedMat);
  gateLintel.position.set(0, 2.5, 0);
  gateLintel.castShadow = true;
  gate.add(gateLintel);
  const gateSeal = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.2, 12, 32), gateLockedMat);
  gateSeal.position.set(0, 0.4, 0.78);
  gateSeal.castShadow = true;
  gate.add(gateSeal);
  gate.add(gateSeal);
  scene.add(gate);

  const crystals: THREE.Mesh[] = [];
  [
    [20, 4.8, -1],
    [14, 6.6, 7],
    [1.5, 7.7, 15],
  ].forEach(([x, y, z], index) => {
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.65, 0), crystalMat);
    crystal.name = `EnergyCrystal_${index}`;
    crystal.position.set(x, y, z);
    crystal.castShadow = true;
    crystal.userData.__luaScript = SCRIPT_3D_CRYSTAL;
    scene.add(crystal);
    crystals.push(crystal);
  });

  [[10, -4], [24, 5], [-14, 13], [6, 20], [-12, -8]].forEach(([tx, tz], i) => {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 3, 10), woodMat);
    trunk.position.set(tx, 1.5, tz);
    trunk.castShadow = true;
    scene.add(trunk);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4.4, 10), mossMat);
    crown.position.set(tx, 4.8, tz);
    crown.castShadow = true;
    crown.name = `Pine_${i}`;
    scene.add(crown);
  });

  const { entity: player, mesh: playerMesh } = createPlayerEntity(
    engine, scene, 'Player', 0, 4, 0, 0xe74c3c, SCRIPT_3D_PLAYER,
  );
  const follow = player.get(CameraFollowComponent);
  follow.isActive = false;

  markPhysicsDirty(engine);

  const transform = player.get(TransformComponent);
  const body = player.get(PhysicsBodyComponent);
  const input = engine.input;
  const moveInput = new THREE.Vector3();
  const moveForward = new THREE.Vector3();
  const moveRight = new THREE.Vector3();
  const moveWorld = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const desiredCameraPos = new THREE.Vector3();
  const actualCameraPos = new THREE.Vector3();
  const orbitOffset = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const respawnPoint = new THREE.Vector3(0, 4, 0);
  const goalCenter = new THREE.Vector3(-9, 8, 22);
  const canvas = getCanvas(engine);
  const collected = new Set<string>();
  const crystalBaseHeights = new Map<string, number>(crystals.map((crystal) => [crystal.name, crystal.position.y]));
  let beaconActivated = false;
  let gateUnlocked = false;
  let routeCompleted = false;
  let cameraYaw = Math.PI;
  let cameraPitch = 0.42;
  let cameraDistance = 11;

  canvas.addEventListener('mousedown', () => canvas.focus());

  const hud = document.getElementById('ui-overlay');
  const objectiveEl = document.createElement('div');
  objectiveEl.style.cssText = 'position:fixed;top:64px;left:20px;color:#e9f7ff;font-size:1rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 8px #000;max-width:360px;';
  const crystalEl = document.createElement('div');
  crystalEl.style.cssText = 'position:fixed;top:118px;left:20px;color:#62f2ff;font-size:1rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 8px #000;';
  const hintEl = document.createElement('div');
  hintEl.style.cssText = 'position:fixed;bottom:28px;left:20px;color:#fff3d0;font-size:0.95rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 8px #000;max-width:380px;';
  hud?.appendChild(objectiveEl);
  hud?.appendChild(crystalEl);
  hud?.appendChild(hintEl);

  const updateHud = () => {
    crystalEl.textContent = `Crystals: ${collected.size} / ${crystals.length}`;
    if (routeCompleted) {
      objectiveEl.textContent = 'Route complete. The valley gate is open and the beacon network is online.';
      hintEl.textContent = 'Press F9 to return to the editor and inspect the attached scripts on the route objects.';
    } else if (!beaconActivated) {
      objectiveEl.textContent = 'Recover the energy crystals and activate the survey beacon on the upper ridge.';
      hintEl.textContent = 'Hold RMB to orbit the camera, scroll to zoom, and sprint with Shift on longer climbs.';
    } else if (!gateUnlocked) {
      objectiveEl.textContent = 'Beacon online. Recover the remaining crystals to power the ancient gate.';
      hintEl.textContent = 'The glowing gate seal will turn green once every crystal has been recovered.';
    } else {
      objectiveEl.textContent = 'Gate unlocked. Cross into the plaza to finish the default 3D adventure route.';
      hintEl.textContent = 'Follow the final ridge past the beacon and head through the open stone arch.';
    }
  };
  updateHud();

  const respawnPlayer = () => {
    transform.position.copy(respawnPoint);
    body.velocity.set(0, 0, 0);
    body._teleport = true;
  };

  const setGateMaterial = (material: THREE.Material) => {
    gate.traverse((child) => {
      if (child instanceof THREE.Mesh) child.material = material;
    });
  };

  const updateFn = (delta: number, elapsed: number) => {
    if (engine.mode === 'edit') {
      objectiveEl.style.display = 'none';
      crystalEl.style.display = 'none';
      hintEl.style.display = 'none';
      return;
    }
    objectiveEl.style.display = '';
    crystalEl.style.display = '';
    hintEl.style.display = '';

    if (transform.position.y < -18) {
      respawnPlayer();
      return;
    }

    const isSprinting = input.isKeyDown('shift') || input.isKeyDown('shiftleft') || input.isKeyDown('shiftright');
    const moveSpeed = isSprinting ? 11 : 7.5;

    moveInput.set(0, 0, 0);
    if (input.isKeyDown('w') || input.isKeyDown('arrowup')) moveInput.z -= 1;
    if (input.isKeyDown('s') || input.isKeyDown('arrowdown')) moveInput.z += 1;
    if (input.isKeyDown('a') || input.isKeyDown('arrowleft')) moveInput.x -= 1;
    if (input.isKeyDown('d') || input.isKeyDown('arrowright')) moveInput.x += 1;

    if (input.isMouseButtonDown(2)) {
      cameraYaw -= input.mouseDeltaX * 0.006;
      cameraPitch -= input.mouseDeltaY * 0.004;
      cameraPitch = Math.max(0.2, Math.min(1.05, cameraPitch));
    }
    if (input.scrollDelta !== 0) {
      cameraDistance = Math.max(5, Math.min(16, cameraDistance + input.scrollDelta * 0.01));
    }

    moveForward.set(Math.sin(cameraYaw), 0, Math.cos(cameraYaw)).normalize();
    moveRight.set(moveForward.z, 0, -moveForward.x).normalize();
    moveWorld.set(0, 0, 0);
    moveWorld.addScaledVector(moveForward, -moveInput.z);
    moveWorld.addScaledVector(moveRight, moveInput.x);

    if (moveWorld.lengthSq() > 0) {
      moveWorld.normalize().multiplyScalar(moveSpeed);
      body.velocity.x = moveWorld.x;
      body.velocity.z = moveWorld.z;
      playerMesh.rotation.y = Math.atan2(moveWorld.x, moveWorld.z);
    } else {
      body.velocity.x *= 0.82;
      body.velocity.z *= 0.82;
    }

    if (input.isKeyJustPressed(' ') && body.grounded) {
      body.velocity.y = 11.5;
    }

    windmill.getObjectByName('WindmillHub')!.rotation.z += delta * 1.4;
    beacon.children[1].rotation.y += delta * 1.1;
    crystals.forEach((crystal, index) => {
      if (!crystal.parent) return;
      crystal.rotation.y += delta * 1.8;
      crystal.position.y = (crystalBaseHeights.get(crystal.name) ?? crystal.position.y) + Math.sin(elapsed * 2 + index) * 0.35;
    });

    for (const crystal of crystals) {
      if (!crystal.parent || collected.has(crystal.name)) continue;
      if (transform.position.distanceTo(crystal.position) < 1.5) {
        collected.add(crystal.name);
        scene.remove(crystal);
        updateHud();
      }
    }

    if (!beaconActivated && transform.position.distanceTo(beacon.position) < 2.5) {
      beaconActivated = true;
      respawnPoint.set(beacon.position.x, beacon.position.y + 2.2, beacon.position.z - 1.2);
      beaconCore.material = new THREE.MeshStandardMaterial({ color: 0x86f8ff, emissive: 0x86f8ff, emissiveIntensity: 0.75 });
      updateHud();
    }

    if (!gateUnlocked && collected.size === crystals.length) {
      gateUnlocked = true;
      setGateMaterial(gateUnlockedMat);
      updateHud();
    }

    if (gateUnlocked && !routeCompleted && transform.position.distanceTo(goalCenter) < 4.5) {
      routeCompleted = true;
      updateHud();
    }

    cameraTarget.set(transform.position.x, transform.position.y + 1.7, transform.position.z);
    orbitOffset.set(
      Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraDistance,
      Math.sin(cameraPitch) * cameraDistance,
      Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraDistance,
    );
    desiredCameraPos.copy(cameraTarget).add(orbitOffset);

    raycaster.set(cameraTarget, desiredCameraPos.clone().sub(cameraTarget).normalize());
    const hits = raycaster.intersectObjects(scene.children.filter((child) => child.userData.isCollider), true);
    if (hits.length > 0 && hits[0].distance < cameraDistance) {
      actualCameraPos.copy(cameraTarget).addScaledVector(desiredCameraPos.clone().sub(cameraTarget).normalize(), Math.max(2.8, hits[0].distance - 0.4));
    } else {
      actualCameraPos.copy(desiredCameraPos);
    }

    engine.camera.position.lerp(actualCameraPos, 0.16);
    engine.camera.lookAt(cameraTarget);
  };

  return {
    updateFn,
    helpText: 'WASD: Move | Shift: Sprint | Space: Jump | RMB Drag: Orbit | Wheel: Zoom | Recover crystals, activate beacon, cross gate | F9: Editor',
  };
}

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATE: 2D Empty
// ═══════════════════════════════════════════════════════════════════

const SCRIPT_2D_PLAYER = `-- Runner Controller (2D Side-Scroller)
-- Controls:
--   A / D or Arrows .. Run
--   Shift ........... Sprint
--   Space ........... Jump
-- Objective:
--   Collect the power batteries, touch the checkpoint tower,
--   then pass through the signal door and reach the exit beacon.

function onStart(self)
  self.state = {
    spawn = { x = -12, y = 1.4, z = 0 },
    batteries = 0,
    checkpoint = "Dock"
  }
end

function onUpdate(self, dt)
  if self.position.y < -6 then
    self.position = {
      x = self.state.spawn.x,
      y = self.state.spawn.y,
      z = self.state.spawn.z
    }
  end
end
`;

const SCRIPT_2D_BATTERY = `-- Power Battery
-- Floating collectible used to restore the signal bridge.
-- Gather every battery to unlock the signal door.
`;

const SCRIPT_2D_CHECKPOINT = `-- Checkpoint Tower
-- Updates the runner's respawn point when touched.
`;

const SCRIPT_2D_DOOR = `-- Signal Door
-- Locked until every power battery is recovered.
-- Opens the route to the exit beacon once the bridge circuit is restored.
`;

const SCRIPT_2D_LIFT = `-- Lift Platform
-- Oscillates vertically to bridge the mid-level route.
`;

const SCRIPT_2D_EXIT = `-- Exit Beacon
-- Final goal for the 2D sample once the signal door is open.
`;

function setup2DEmpty(engine: Engine, scene: THREE.Scene): TemplateResult {
  scene.background = new THREE.Color(0x101827);

  engine.camera.position.set(0, 5.5, 22);
  engine.camera.lookAt(0, 4, 0);
  engine.camera.fov = 28;
  engine.camera.updateProjectionMatrix();

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 26),
    new THREE.MeshBasicMaterial({ color: 0x18243a }),
  );
  backdrop.name = 'Backdrop';
  backdrop.position.set(0, 6, -4);
  scene.add(backdrop);

  const parallaxRidge = new THREE.Mesh(
    new THREE.PlaneGeometry(56, 10),
    new THREE.MeshBasicMaterial({ color: 0x22314d }),
  );
  parallaxRidge.position.set(2, 3.5, -3.6);
  scene.add(parallaxRidge);

  const trackMat = new THREE.MeshBasicMaterial({ color: 0x4a5f84 });
  const accentMat = new THREE.MeshBasicMaterial({ color: 0x7699d4 });
  const batteryMat = new THREE.MeshBasicMaterial({ color: 0xffde6b });
  const playerMat = new THREE.MeshBasicMaterial({ color: 0x5fd8ff });
  const checkpointMat = new THREE.MeshBasicMaterial({ color: 0x82f0d4 });
  const doorLockedMat = new THREE.MeshBasicMaterial({ color: 0x6b728f });
  const doorOpenMat = new THREE.MeshBasicMaterial({ color: 0x7ef7ae });
  const exitMat = new THREE.MeshBasicMaterial({ color: 0xaee2ff });

  interface PlatformData {
    mesh: THREE.Mesh;
    width: number;
    height: number;
  }
  const platforms: PlatformData[] = [];
  const addPlatform = (name: string, x: number, y: number, width: number, height: number, material = trackMat): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, 1), material);
    mesh.name = name;
    mesh.position.set(x, y, 0);
    scene.add(mesh);
    platforms.push({ mesh, width, height });
    return mesh;
  };

  addPlatform('Dock', -9, 0, 10, 1.1);
  addPlatform('MidBridge_A', -1.5, 2.5, 6, 0.9);
  addPlatform('MidBridge_B', 6.2, 5, 5.4, 0.9);
  addPlatform('ExitRunway', 13.5, 7.5, 9, 1.1, accentMat);
  addPlatform('LowerShelf', 1.5, -1.8, 4.5, 0.8);

  const liftPlatform = addPlatform('LiftPlatform_0', 2.5, 1.1, 3.1, 0.75, accentMat);
  liftPlatform.userData.__luaScript = SCRIPT_2D_LIFT;
  const liftBaseY = liftPlatform.position.y;

  const signalDoor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 5.2, 0.8), doorLockedMat);
  signalDoor.name = 'SignalDoor';
  signalDoor.position.set(10.2, 5.1, 0);
  signalDoor.userData.__luaScript = SCRIPT_2D_DOOR;
  scene.add(signalDoor);

  const checkpointTower = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.8, 0.8), checkpointMat);
  checkpointTower.name = 'CheckpointTower';
  checkpointTower.position.set(0.5, 4.6, 0);
  checkpointTower.userData.__luaScript = SCRIPT_2D_CHECKPOINT;
  scene.add(checkpointTower);

  const exitBeacon = new THREE.Mesh(new THREE.RingGeometry(0.65, 1.05, 24), exitMat);
  exitBeacon.name = 'ExitBeacon';
  exitBeacon.position.set(15.8, 9, 0);
  exitBeacon.userData.__luaScript = SCRIPT_2D_EXIT;
  scene.add(exitBeacon);

  const playerMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.4), playerMat);
  playerMesh.name = 'Runner';
  playerMesh.position.set(-12, 1.4, 0.05);
  playerMesh.userData.__luaScript = SCRIPT_2D_PLAYER;
  scene.add(playerMesh);

  const batteryBaseHeights = new Map<string, number>();
  const batteries: THREE.Mesh[] = [
    [-4.2, 2.1],
    [3.2, 6.3],
    [12.7, 9.1],
  ].map(([x, y], index) => {
    const battery = new THREE.Mesh(new THREE.CircleGeometry(0.34, 6), batteryMat);
    battery.name = `Battery_${index}`;
    battery.position.set(x, y, 0.06);
    battery.userData.__luaScript = SCRIPT_2D_BATTERY;
    batteryBaseHeights.set(battery.name, y);
    scene.add(battery);
    return battery;
  });

  const objectiveEl = document.createElement('div');
  objectiveEl.style.cssText = 'position:fixed;top:60px;left:20px;color:#edf5ff;font-size:1rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;max-width:420px;';
  const batteryEl = document.createElement('div');
  batteryEl.style.cssText = 'position:fixed;top:96px;left:20px;color:#ffde6b;font-size:0.95rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;';
  const checkpointEl = document.createElement('div');
  checkpointEl.style.cssText = 'position:fixed;top:128px;left:20px;color:#82f0d4;font-size:0.95rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;';
  const hintEl = document.createElement('div');
  hintEl.style.cssText = 'position:fixed;bottom:28px;left:20px;color:#c9dbff;font-size:0.95rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;max-width:420px;';
  document.getElementById('ui-overlay')?.append(objectiveEl, batteryEl, checkpointEl, hintEl);

  const collectedBatteries = new Set<string>();
  const activeBatteries = [...batteries];
  const spawn = new THREE.Vector3(-12, 1.4, 0.05);
  const velocity = new THREE.Vector2();
  const playerSize = { width: 1, height: 1.4 };
  let isGrounded = false;
  let checkpointReached = false;
  let doorUnlocked = false;
  let missionComplete = false;
  let messageTimer = 0;
  let transientHint = 'Collect the batteries, touch the checkpoint tower, then push through to the beacon.';

  const setHint = (message: string, duration = 2.4) => {
    transientHint = message;
    messageTimer = duration;
  };

  const playerBounds = () => ({
    left: playerMesh.position.x - playerSize.width / 2,
    right: playerMesh.position.x + playerSize.width / 2,
    bottom: playerMesh.position.y - playerSize.height / 2,
    top: playerMesh.position.y + playerSize.height / 2,
  });

  const platformBounds = (platform: PlatformData) => ({
    left: platform.mesh.position.x - platform.width / 2,
    right: platform.mesh.position.x + platform.width / 2,
    bottom: platform.mesh.position.y - platform.height / 2,
    top: platform.mesh.position.y + platform.height / 2,
  });

  const respawn = (message: string) => {
    playerMesh.position.copy(spawn);
    velocity.set(0, 0);
    setHint(message, 2.6);
  };

  const updateHud = () => {
    batteryEl.textContent = `Batteries: ${collectedBatteries.size} / ${batteries.length}`;
    checkpointEl.textContent = checkpointReached ? 'Checkpoint: Tower online' : 'Checkpoint: Dock';
    if (missionComplete) {
      objectiveEl.textContent = 'Route complete. The runner restored the bridge circuit and reached the beacon.';
      hintEl.textContent = 'Press F9 to inspect the scripted batteries, lift, door, checkpoint, and exit beacon.';
      return;
    }
    if (!doorUnlocked) {
      objectiveEl.textContent = collectedBatteries.size === batteries.length
        ? 'All batteries recovered. Reach the signal door to watch the bridge route unlock.'
        : 'Collect every battery pack and use the moving lift to climb toward the exit route.';
      hintEl.textContent = messageTimer > 0 ? transientHint : 'Shift adds speed for long gaps. Space jumps. Falling below the route triggers a respawn.';
      return;
    }
    objectiveEl.textContent = 'Signal door unlocked. Cross the upper runway and touch the exit beacon.';
    hintEl.textContent = messageTimer > 0 ? transientHint : 'Keep moving right. The checkpoint tower now serves as the active respawn point.';
  };

  const updateFn = (delta: number, elapsed: number) => {
    if (engine.mode === 'edit') {
      objectiveEl.style.display = 'none';
      batteryEl.style.display = 'none';
      checkpointEl.style.display = 'none';
      hintEl.style.display = 'none';
      return;
    }
    objectiveEl.style.display = '';
    batteryEl.style.display = '';
    checkpointEl.style.display = '';
    hintEl.style.display = '';
    if (messageTimer > 0) messageTimer = Math.max(0, messageTimer - delta);

    const input = engine.input;
    const moveLeft = input.isKeyDown('a') || input.isKeyDown('arrowleft');
    const moveRight = input.isKeyDown('d') || input.isKeyDown('arrowright');
    const sprint = input.isKeyDown('shift') || input.isKeyDown('shiftleft') || input.isKeyDown('shiftright');
    const move = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
    const runSpeed = sprint ? 8.5 : 6;

    velocity.x = move * runSpeed;
    velocity.y -= 20 * delta;

    if (isGrounded && (input.isKeyJustPressed(' ') || input.isKeyJustPressed('space'))) {
      velocity.y = 9.2;
      isGrounded = false;
      setHint('Jump committed.', 0.8);
    }

    liftPlatform.position.y = liftBaseY + Math.sin(elapsed * 1.2) * 2.1;

    playerMesh.position.x += velocity.x * delta;
    playerMesh.position.y += velocity.y * delta;
    playerMesh.position.x = THREE.MathUtils.clamp(playerMesh.position.x, -14.5, 18.5);
    if (move !== 0) {
      playerMesh.scale.x = move > 0 ? 1 : -1;
    }

    isGrounded = false;
    const previousBottom = playerBounds().bottom - velocity.y * delta;
    for (const platform of platforms) {
      const pb = platformBounds(platform);
      const bounds = playerBounds();
      const overlapsX = bounds.right > pb.left && bounds.left < pb.right;
      const fallingOntoPlatform = previousBottom >= pb.top && bounds.bottom <= pb.top + 0.25;
      if (overlapsX && fallingOntoPlatform && velocity.y <= 0) {
        playerMesh.position.y = pb.top + playerSize.height / 2;
        velocity.y = 0;
        isGrounded = true;
      }
    }

    if (!doorUnlocked) {
      const bounds = playerBounds();
      const doorLeft = signalDoor.position.x - 0.6;
      const doorRight = signalDoor.position.x + 0.6;
      const doorBottom = signalDoor.position.y - 2.6;
      const doorTop = signalDoor.position.y + 2.6;
      const overlapsDoor = bounds.right > doorLeft && bounds.left < doorRight && bounds.top > doorBottom && bounds.bottom < doorTop;
      if (overlapsDoor) {
        if (playerMesh.position.x < signalDoor.position.x) {
          playerMesh.position.x = doorLeft - playerSize.width / 2;
        } else {
          playerMesh.position.x = doorRight + playerSize.width / 2;
        }
      }
    }

    for (let index = activeBatteries.length - 1; index >= 0; index--) {
      const battery = activeBatteries[index];
      battery.position.y = (batteryBaseHeights.get(battery.name) ?? battery.position.y) + Math.sin(elapsed * 3 + index) * 0.18;
      battery.rotation.z = elapsed * 2.8 + index;
      const distance = Math.hypot(playerMesh.position.x - battery.position.x, playerMesh.position.y - battery.position.y);
      if (distance < 0.8) {
        collectedBatteries.add(battery.name);
        scene.remove(battery);
        activeBatteries.splice(index, 1);
        setHint(`Recovered ${battery.name.replace('_', ' ')}.`, 1.6);
      }
    }

    if (!checkpointReached && Math.hypot(playerMesh.position.x - checkpointTower.position.x, playerMesh.position.y - checkpointTower.position.y) < 1.6) {
      checkpointReached = true;
      spawn.set(0.8, 4.2, 0.05);
      setHint('Checkpoint tower synced. Respawn updated.', 2.2);
    }

    if (!doorUnlocked && collectedBatteries.size === batteries.length && playerMesh.position.x > 8.6) {
      doorUnlocked = true;
      signalDoor.material = doorOpenMat;
      signalDoor.position.y = 8.5;
      setHint('Signal door unlocked. Upper runway open.', 2.3);
    }

    if (!missionComplete && doorUnlocked && Math.hypot(playerMesh.position.x - exitBeacon.position.x, playerMesh.position.y - exitBeacon.position.y) < 1.1) {
      missionComplete = true;
      setHint('Exit beacon reached.', 2.3);
    }

    if (playerMesh.position.y < -5.5) {
      respawn('The runner fell off-route and respawned at the latest checkpoint.');
    }

    engine.camera.position.x = THREE.MathUtils.lerp(engine.camera.position.x, playerMesh.position.x + 2.5, 0.08);
    engine.camera.position.y = THREE.MathUtils.lerp(engine.camera.position.y, Math.max(4.5, playerMesh.position.y + 3.5), 0.08);
    engine.camera.position.z = 22;
    engine.camera.lookAt(playerMesh.position.x + 1.2, playerMesh.position.y + 1, 0);

    updateHud();
  };

  return {
    updateFn,
    helpText: 'A / D: Run | Shift: Sprint | Space: Jump | Collect batteries, unlock the door, reach the beacon | F9: Editor',
  };
}

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATE: Platformer 3D
// ═══════════════════════════════════════════════════════════════════

const SCRIPT_PLATFORMER_PLAYER = `-- Player Controller (Platformer 3D)
-- ECS character controller drives actual movement.
-- This script documents the expected behavior for the player object.
-- Controls:
--   WASD ........ Move relative to camera
--   Shift ....... Sprint
--   Space ....... Jump
--   Click ....... Capture mouse for camera orbit
--   Mouse Wheel . Zoom camera
-- Systems:
--   * Respawn when falling into the void
--   * Mid-level checkpoint updates spawn point
--   * Bounce pad launches the player upward
--   * Goal unlocks after all coins are collected

function onStart(self)
  self.state = {
    spawn = { x = 0, y = 4, z = 0 },
    camera = { yaw = 0, pitch = 0.35, distance = 12 }
  }
end

function onUpdate(self, dt)
  -- Runtime gameplay is handled by the template's ECS + camera systems.
  -- Keep this script as living design documentation inside the editor.
  if self.position.y < -25 then
    self.position = { x = self.state.spawn.x, y = self.state.spawn.y, z = self.state.spawn.z }
  end
end
`;

const SCRIPT_PLATFORMER_COIN = `-- Coin Collectible
-- Spins continuously.
-- Grants progress toward unlocking the goal.
-- Collected when the player gets close enough.
`;

const SCRIPT_PLATFORMER_CHECKPOINT = `-- Checkpoint Beacon
-- When the player reaches this beacon, future respawns happen here.
-- Intended to reduce frustration on longer platforming routes.
`;

const SCRIPT_PLATFORMER_BOUNCE_PAD = `-- Bounce Pad
-- Launches the player upward when they land on it.
-- Useful for vertical shortcuts and secret routes.
`;

const SCRIPT_PLATFORMER_GOAL = `-- Goal Crystal
-- Reach this after collecting all coins.
-- If coins remain, the crystal stays locked.
`;

const SCRIPT_PLATFORMER_HAZARD = `-- Hazard Spinner
-- Rotates continuously.
-- Touching it resets the player to the last checkpoint.
`;

const SCRIPT_PLATFORMER_PLATFORM = `-- Platform Piece
-- Static collision geometry used for traversal.
-- Adjust position/scale to reshape the route.
`;

function setupPlatformer3D(engine: Engine, scene: THREE.Scene): TemplateResult {
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 40, 120);

  addDefaultLighting(scene);

  // Materials
  const platMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3498db });
  const goalMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, emissive: 0xf1c40f, emissiveIntensity: 0.3 });
  const checkpointMat = new THREE.MeshStandardMaterial({ color: 0x00d2ff, emissive: 0x00d2ff, emissiveIntensity: 0.4 });
  const bouncePadMat = new THREE.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff4d6d, emissiveIntensity: 0.35 });
  const hazardMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff2244, emissiveIntensity: 0.6 });
  const checkpointActiveMat = new THREE.MeshStandardMaterial({ color: 0x7cf7ff, emissive: 0x7cf7ff, emissiveIntensity: 0.65 });
  const goalUnlockedMat = new THREE.MeshStandardMaterial({ color: 0x7cff65, emissive: 0x7cff65, emissiveIntensity: 0.7 });

  // Platforms (all collidable, all named)
  addStaticBox(scene, 'StartPlatform',  0,   -0.5,  0,   10, 1,   10, platMat, SCRIPT_PLATFORMER_PLATFORM + '\n-- Start platform and safe spawn zone.');
  addStaticBox(scene, 'Platform_1',     7,    1.0, -7,    4, 0.5,  4, platMat, SCRIPT_PLATFORMER_PLATFORM + '\n-- First jump from the spawn area.');
  addStaticBox(scene, 'Platform_2',    14,    2.8, -6,    5, 0.5,  5, platMat, SCRIPT_PLATFORMER_PLATFORM + '\n-- Slightly wider landing before the midpoint.');
  addStaticBox(scene, 'Platform_3',    18,    4.8,  1,    4, 0.5,  4, platMat, SCRIPT_PLATFORMER_PLATFORM + '\n-- Narrow approach to the bounce section.');
  addStaticBox(scene, 'Platform_4',    11,    6.4,  6,    5, 0.5,  5, platMat, SCRIPT_PLATFORMER_PLATFORM + '\n-- Checkpoint platform.');
  addStaticBox(scene, 'Platform_5',     2,    8.4, 10,    6, 0.5,  6, platMat, SCRIPT_PLATFORMER_PLATFORM + '\n-- Return arc toward the final climb.');
  addStaticBox(scene, 'Platform_6',    -6,   10.2, 14,    5, 0.5,  5, platMat, SCRIPT_PLATFORMER_PLATFORM + '\n-- Final jump before the goal ramp.');
  addStaticBox(scene, 'GoalPlatform', -14,   12.0, 18,    8, 0.75, 8, goalMat, SCRIPT_PLATFORMER_PLATFORM + '\n-- Goal platform. Reach the crystal after collecting every coin.');
  addStaticBox(scene, 'GoalRamp',     -10,   10.6, 16,    5, 0.5, 10, platMat, SCRIPT_PLATFORMER_PLATFORM + '\n-- Ramp-up to the final reward platform.');

  // Boundary walls (invisible but collidable)
  addStaticBox(scene, 'Wall_Back',  0,  3, -14, 35, 8, 1, wallMat);
  addStaticBox(scene, 'Wall_Front', 0,  3,  14, 35, 8, 1, wallMat);
  addStaticBox(scene, 'Wall_Left', -17, 3,  0,  1,  8, 30, wallMat);
  addStaticBox(scene, 'Wall_Right', 22, 3,  0,  1,  8, 30, wallMat);

  // Kill plane (invisible, catches falling player)
  const killPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  killPlane.name = 'KillPlane';
  killPlane.rotation.x = -Math.PI / 2;
  killPlane.position.y = -30;
  killPlane.userData.isCollider = true;
  scene.add(killPlane);

  const checkpoint = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.45, 0.14, 96, 12),
    checkpointMat,
  );
  checkpoint.name = 'CheckpointBeacon';
  checkpoint.position.set(11, 7.7, 6);
  checkpoint.castShadow = true;
  checkpoint.userData.__luaScript = SCRIPT_PLATFORMER_CHECKPOINT;
  scene.add(checkpoint);

  const bouncePad = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 0.25, 24),
    bouncePadMat,
  );
  bouncePad.name = 'BouncePad';
  bouncePad.position.set(18, 5.2, 1);
  bouncePad.receiveShadow = true;
  bouncePad.userData.__luaScript = SCRIPT_PLATFORMER_BOUNCE_PAD;
  scene.add(bouncePad);

  const goalCrystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.9, 0),
    goalMat,
  );
  goalCrystal.name = 'GoalCrystal';
  goalCrystal.position.set(-14, 13.6, 18);
  goalCrystal.castShadow = true;
  goalCrystal.userData.__luaScript = SCRIPT_PLATFORMER_GOAL;
  scene.add(goalCrystal);

  const hazardPivot = new THREE.Group();
  hazardPivot.name = 'HazardSpinner';
  hazardPivot.position.set(2, 9.2, 10);
  hazardPivot.userData.__luaScript = SCRIPT_PLATFORMER_HAZARD;
  const hazardBar = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 0.18, 0.34),
    hazardMat,
  );
  hazardBar.castShadow = true;
  hazardPivot.add(hazardBar);
  scene.add(hazardPivot);

  // Collectible coins
  const coinGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16);
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, emissive: 0xf1c40f, emissiveIntensity: 0.5 });
  const coins: THREE.Mesh[] = [];
  const coinPositions: [number, number, number][] = [
    [3, 1.2, -3],
    [10, 3.4, -6],
    [18, 5.8, 1],
    [11, 7.8, 6],
    [2, 9.8, 10],
    [-6, 11.6, 14],
    [-14, 13.6, 18],
  ];
  coinPositions.forEach(([cx, cy, cz], i) => {
    const coin = new THREE.Mesh(coinGeo, coinMat);
    coin.name = `Coin_${i}`;
    coin.position.set(cx, cy, cz);
    coin.rotation.x = Math.PI / 2;
    coin.castShadow = true;
    coin.userData.__luaScript = SCRIPT_PLATFORMER_COIN;
    scene.add(coin);
    coins.push(coin);
  });

  // Player — spawn higher (y=4) to avoid clipping into start platform
  const { entity: player } = createPlayerEntity(
    engine, scene, 'Player', 0, 4, 0, 0xe74c3c, SCRIPT_PLATFORMER_PLAYER,
  );
  const transform = player.get(TransformComponent);
  const body = player.get(PhysicsBodyComponent);
  const controller = new CharacterControllerComponent();
  controller.mode = 'third-person';
  controller.moveSpeed = 7;
  controller.runSpeed = 10.5;
  controller.jumpForce = 10.5;
  controller.rotationSpeed = 12;
  body.gravity = false;
  body.bodyType = 'kinematic';
  body._useCharacterController = true;
  player.add(controller);

  // Disable the generic ECS follow camera; this template drives a proper orbit camera.
  const follow = player.get(CameraFollowComponent);
  follow.isActive = false;

  markPhysicsDirty(engine);

  let score = 0;
  const totalCoins = coins.length;
  let checkpointReached = false;
  let goalUnlocked = false;
  let levelComplete = false;
  const startRespawnPoint = new THREE.Vector3(0, 4, 0);
  const respawnPoint = startRespawnPoint.clone();
  let cameraYaw = Math.PI;
  let cameraPitch = 0.45;
  let cameraDistance = 12;
  const cameraTargetOffset = new THREE.Vector3(0, 1.6, 0);
  const cameraDesiredPos = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();
  const cameraLookTarget = new THREE.Vector3();
  const hazardCenter = new THREE.Vector3();
  const hazardDir = new THREE.Vector3();
  const hazardStart = new THREE.Vector3();
  const hazardEnd = new THREE.Vector3();
  const hazardClosest = new THREE.Vector3();
  const playerXZ = new THREE.Vector3();
  const segmentDelta = new THREE.Vector3();
  const segmentToPlayer = new THREE.Vector3();
  const hazardQuaternion = new THREE.Quaternion();
  const raycaster = new THREE.Raycaster();
  const cameraCollisionTargets = () => scene.children.filter((child) => child.userData.isCollider || child.name === 'TerrainGroup');

  // Pointer lock — resolved lazily so the correct canvas is used whether
  // the template is running in standalone mode or inside the editor viewport.
  const onDocumentMouseDownPlatformer = (e: MouseEvent) => {
    if (engine.mode === 'edit') return;
    const activeCanvas = engine.viewportCanvas ?? engine.renderer.domElement;
    if (e.target !== activeCanvas) return;
    if (document.pointerLockElement !== activeCanvas) {
      activeCanvas.requestPointerLock?.();
    }
  };
  document.addEventListener('mousedown', onDocumentMouseDownPlatformer);

  // Score HUD
  const scoreEl = document.createElement('div');
  scoreEl.style.cssText = 'position:fixed;top:60px;right:20px;color:#f1c40f;font-size:1.2rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;';
  scoreEl.textContent = `Coins: 0 / ${totalCoins}`;
  document.getElementById('ui-overlay')?.appendChild(scoreEl);

  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'position:fixed;top:90px;right:20px;color:#d9ecff;font-size:0.95rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;max-width:360px;text-align:right;';
  statusEl.textContent = 'Click inside the viewport to capture the camera, then reach the checkpoint and collect every coin.';
  document.getElementById('ui-overlay')?.appendChild(statusEl);

  const resetState = () => {
    score = 0;
    checkpointReached = false;
    goalUnlocked = false;
    levelComplete = false;
    respawnPoint.copy(startRespawnPoint);
    cameraYaw = Math.PI;
    cameraPitch = 0.45;
    cameraDistance = 12;
    transform.position.copy(startRespawnPoint);
    body.velocity.set(0, 0, 0);
    body.grounded = false;
    body._teleport = true;
    controller.canJump = true;
    controller.isJumping = false;
    checkpoint.material = checkpointMat;
    goalCrystal.material = goalMat;
    goalCrystal.position.set(-14, 13.6, 18);
    scoreEl.textContent = `Coins: 0 / ${totalCoins}`;
    statusEl.textContent = 'Click inside the viewport to capture the camera, then reach the checkpoint and collect every coin.';
    coins.forEach((coin, index) => {
      coin.visible = true;
      coin.position.set(...coinPositions[index]);
    });
  };

  const updateFn = (delta: number, _elapsed: number) => {
    if (engine.mode === 'edit') {
      scoreEl.style.display = 'none';
      statusEl.style.display = 'none';
      return;
    }
    scoreEl.style.display = '';
    statusEl.style.display = '';
    const input = engine.input;

    if (input.isPointerLocked) {
      cameraYaw -= input.mouseDeltaX * 0.008;
      cameraPitch = Math.max(0.15, Math.min(1.2, cameraPitch - input.mouseDeltaY * 0.005));
    }
    if (input.scrollDelta !== 0) {
      cameraDistance = Math.max(6, Math.min(18, cameraDistance - input.scrollDelta * 0.05));
    }

    // Respawn if fallen below ground level
    if (transform.position.y < -8) {
      transform.position.copy(respawnPoint);
      body.velocity.set(0, 0, 0);
      body._teleport = true;
      statusEl.textContent = checkpointReached
        ? 'Respawned at the checkpoint.'
        : 'Respawned at the start platform.';
      return;
    }

    checkpoint.rotation.y += delta * 1.8;
    goalCrystal.rotation.y += delta * 1.4;
    goalCrystal.position.y = 13.6 + Math.sin(_elapsed * 2) * 0.15;
    hazardPivot.rotation.y += delta * 2.8;

    if (!checkpointReached && transform.position.distanceTo(checkpoint.position) < 2.4) {
      checkpointReached = true;
      respawnPoint.set(11, 8.2, 6);
      checkpoint.material = checkpointActiveMat;
      statusEl.textContent = 'Checkpoint activated.';
    }

    const bounceDistance = Math.hypot(transform.position.x - bouncePad.position.x, transform.position.z - bouncePad.position.z);
    if (bounceDistance < 1.35 && transform.position.y > bouncePad.position.y && body.velocity.y <= 0) {
      body.velocity.y = 15;
      statusEl.textContent = 'Bounce pad boost!';
    }

    const hazardDistance = Math.hypot(transform.position.x - hazardPivot.position.x, transform.position.z - hazardPivot.position.z);
    hazardBar.updateWorldMatrix(true, false);
    hazardBar.getWorldPosition(hazardCenter);
    hazardBar.getWorldQuaternion(hazardQuaternion);
    hazardDir.set(1, 0, 0).applyQuaternion(hazardQuaternion).setY(0).normalize();
    hazardStart.copy(hazardCenter).addScaledVector(hazardDir, -1.6);
    hazardEnd.copy(hazardCenter).addScaledVector(hazardDir, 1.6);
    playerXZ.set(transform.position.x, 0, transform.position.z);
    segmentDelta.copy(hazardEnd).sub(hazardStart);
    segmentToPlayer.copy(playerXZ).sub(hazardStart);
    const segmentLengthSq = Math.max(segmentDelta.lengthSq(), 0.0001);
    const projection = THREE.MathUtils.clamp(segmentToPlayer.dot(segmentDelta) / segmentLengthSq, 0, 1);
    hazardClosest.copy(hazardStart).addScaledVector(segmentDelta, projection);
    const hazardBarDistance = Math.hypot(playerXZ.x - hazardClosest.x, playerXZ.z - hazardClosest.z);
    const verticalHazardGap = Math.abs(transform.position.y - hazardCenter.y);
    if (hazardDistance < 1.95 && hazardBarDistance < 0.72 && verticalHazardGap < 1.25) {
      transform.position.copy(respawnPoint);
      body.velocity.set(0, 0, 0);
      body._teleport = true;
      statusEl.textContent = checkpointReached
        ? 'Hazard hit. Back to checkpoint.'
        : 'Hazard hit. Back to start.';
      return;
    }

    // Coin collection
    for (let i = coins.length - 1; i >= 0; i--) {
      if (!coins[i].visible) continue;
      coins[i].rotation.y += delta * 2;
      coins[i].position.y += Math.sin(_elapsed * 3 + i) * 0.0035;
      if (transform.position.distanceTo(coins[i].position) < 1.35) {
        coins[i].visible = false;
        score++;
        scoreEl.textContent = `Coins: ${score} / ${totalCoins}`;
      }
    }

    if (!goalUnlocked && score === totalCoins) {
      goalUnlocked = true;
      goalCrystal.material = goalUnlockedMat;
      statusEl.textContent = 'All coins collected. The goal crystal is now unlocked.';
    } else if (!goalUnlocked && !input.isPointerLocked) {
      statusEl.textContent = 'Click inside the viewport to recapture the camera. Reach the checkpoint and collect every coin.';
    }

    if (!levelComplete && transform.position.distanceTo(goalCrystal.position) < 2.2) {
      if (goalUnlocked) {
        levelComplete = true;
        statusEl.textContent = 'Level complete. Press F9 to return to the editor.';
      } else {
        statusEl.textContent = `Goal locked. ${totalCoins - score} coin(s) remaining.`;
      }
    }

    cameraLookTarget.copy(transform.position).add(cameraTargetOffset);
    cameraDesiredPos.set(
      Math.sin(cameraYaw) * Math.cos(cameraPitch),
      Math.sin(cameraPitch),
      Math.cos(cameraYaw) * Math.cos(cameraPitch),
    ).multiplyScalar(cameraDistance).add(cameraLookTarget);

    cameraDirection.copy(cameraDesiredPos).sub(cameraLookTarget).normalize();
    raycaster.set(cameraLookTarget, cameraDirection);
    const cameraHits = raycaster.intersectObjects(cameraCollisionTargets(), true);
    if (cameraHits.length > 0 && cameraHits[0].distance < cameraDistance) {
      cameraDesiredPos.copy(cameraLookTarget).add(cameraDirection.multiplyScalar(Math.max(1.5, cameraHits[0].distance - 0.6)));
    }

    engine.camera.position.lerp(cameraDesiredPos, 0.14);
    engine.camera.lookAt(cameraLookTarget);
  };

  (updateFn as typeof updateFn & { resetState?: () => void }).resetState = resetState;

  return { updateFn, helpText: 'WASD: Move | Shift: Sprint | Space: Jump | Click viewport: Lock mouse camera | Mouse Wheel: Zoom | Esc: Release mouse | Collect coins to unlock the goal | F9: Editor' };
}
