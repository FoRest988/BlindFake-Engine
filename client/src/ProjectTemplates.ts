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
    case 'fps':       return setupFPS(engine, scene);
    case 'topdown2d': return setupTopDown2D(engine, scene);
    case 'mainmenu':  return setupMainMenu(engine, scene);
    case 'fighting':  return setupFighting(engine, scene);
    case 'racing':    return setupRacing(engine, scene);
    case 'puzzle':    return setupPuzzle(engine, scene);
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
    if (engine.editorActive) {
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
    if (engine.editorActive) {
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
    if (engine.editorActive) return;
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
    if (engine.editorActive) {
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

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATE: FPS
// ═══════════════════════════════════════════════════════════════════

const SCRIPT_FPS_PLAYER = `-- Strike Player Controller
-- Uses the shared engine InputManager and the visible viewport canvas.
-- Controls:
--   WASD ........ Move
--   Shift ....... Sprint
--   Space ....... Jump
--   Mouse ....... Look (while pointer lock is active)
--   Click ....... Fire
--   R ........... Reload
--   E ........... Interact with support stations / extraction terminal

function onUpdate(self, dt)
  -- Runtime movement, shooting, interaction and HUD are handled by the template.
  -- Keep this script as an attached gameplay note visible in the Scripts tab.
end
`;

const SCRIPT_FPS_TARGET = `-- Armored Target Dummy
-- Takes two hits before destruction.
-- Some targets sway to force the player to track while aiming.
-- Eliminate every target to unlock extraction.
`;

const SCRIPT_FPS_COVER = `-- Arena Cover
-- Static collision used to break sightlines and force repositioning.
-- Good objects to duplicate when expanding the arena layout.
`;

const SCRIPT_FPS_HEAL_STATION = `-- Heal Station
-- Press E nearby to restore player health back to full.
-- Intended as a recovery checkpoint during target-clearing runs.
`;

const SCRIPT_FPS_AMMO_CRATE = `-- Ammo Crate
-- Press E nearby to refill reserve ammo.
-- Keeps the firefight loop readable without infinite magazine spam.
`;

const SCRIPT_FPS_HAZARD = `-- Patrol Hazard Drone
-- Oscillates around the arena and damages the player on contact.
-- Meant to punish standing still in the open for too long.
`;

const SCRIPT_FPS_EXIT = `-- Extraction Terminal
-- Locked until every target dummy is destroyed.
-- Press E once the arena is clear to complete the scenario.
`;

function setupFPS(engine: Engine, scene: THREE.Scene): TemplateResult {
  scene.background = new THREE.Color(0x161a24);
  scene.fog = new THREE.Fog(0x161a24, 35, 120);

  addDefaultLighting(scene);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x3b414f, roughness: 0.92 }),
  );
  floor.name = 'ArenaFloor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.userData.isCollider = true;
  floor.userData.__luaScript = '-- Arena Floor\n-- Large flat combat space for the FPS template.';
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6e5d54, roughness: 0.9 });
  const coverMat = new THREE.MeshStandardMaterial({ color: 0x8a765f, roughness: 0.85 });
  const supportMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.55, metalness: 0.3 });
  const exitMatLocked = new THREE.MeshStandardMaterial({ color: 0x3b536f, emissive: 0x0b1d2d, emissiveIntensity: 0.5 });
  const exitMatOpen = new THREE.MeshStandardMaterial({ color: 0x5cd37a, emissive: 0x5cd37a, emissiveIntensity: 0.8 });
  const hazardMat = new THREE.MeshStandardMaterial({ color: 0xff5566, emissive: 0xff3344, emissiveIntensity: 0.75 });
  const targetMat = new THREE.MeshStandardMaterial({ color: 0x57d66d, emissive: 0x173f1d, emissiveIntensity: 0.35 });
  const targetDamagedMat = new THREE.MeshStandardMaterial({ color: 0xffc857, emissive: 0x8a4f00, emissiveIntensity: 0.55 });

  addStaticBox(scene, 'Wall_North', 0, 2.5, -29.5, 60, 5, 1, wallMat, SCRIPT_FPS_COVER + '\n-- Northern arena wall.');
  addStaticBox(scene, 'Wall_South', 0, 2.5, 29.5, 60, 5, 1, wallMat, SCRIPT_FPS_COVER + '\n-- Southern arena wall.');
  addStaticBox(scene, 'Wall_West', -29.5, 2.5, 0, 1, 5, 60, wallMat, SCRIPT_FPS_COVER + '\n-- Western arena wall.');
  addStaticBox(scene, 'Wall_East', 29.5, 2.5, 0, 1, 5, 60, wallMat, SCRIPT_FPS_COVER + '\n-- Eastern arena wall.');

  const blockingMeshes = [
    addStaticBox(scene, 'CentralBarrier_A', 0, 1.4, -6, 10, 2.8, 1.2, coverMat, SCRIPT_FPS_COVER + '\n-- Mid-lane barrier for peeking duels.'),
    addStaticBox(scene, 'CentralBarrier_B', 0, 1.4, 8, 10, 2.8, 1.2, coverMat, SCRIPT_FPS_COVER + '\n-- Opposite barrier that creates a crossfire lane.'),
    addStaticBox(scene, 'WestPillar', -11, 1.8, 4, 1.8, 3.6, 5, coverMat, SCRIPT_FPS_COVER + '\n-- Chunky west-side cover.'),
    addStaticBox(scene, 'EastPillar', 11, 1.8, -4, 1.8, 3.6, 5, coverMat, SCRIPT_FPS_COVER + '\n-- Chunky east-side cover.'),
    addStaticBox(scene, 'NorthCrateStack', -16, 1.2, -14, 3, 2.4, 3, coverMat, SCRIPT_FPS_COVER + '\n-- Crate stack guarding the north-west lane.'),
    addStaticBox(scene, 'SouthCrateStack', 16, 1.2, 14, 3, 2.4, 3, coverMat, SCRIPT_FPS_COVER + '\n-- Crate stack guarding the south-east lane.'),
  ];

  const healStation = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 20), supportMat.clone());
  healStation.name = 'HealStation';
  healStation.position.set(-22, 0.7, 22);
  healStation.castShadow = true;
  healStation.receiveShadow = true;
  healStation.userData.__luaScript = SCRIPT_FPS_HEAL_STATION;
  scene.add(healStation);

  const ammoCrate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), supportMat.clone());
  ammoCrate.name = 'AmmoCrate';
  ammoCrate.position.set(22, 0.55, -22);
  ammoCrate.castShadow = true;
  ammoCrate.receiveShadow = true;
  ammoCrate.userData.__luaScript = SCRIPT_FPS_AMMO_CRATE;
  scene.add(ammoCrate);

  const extractionTerminal = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 1.2), exitMatLocked);
  extractionTerminal.name = 'ExtractionTerminal';
  extractionTerminal.position.set(0, 1.1, 25);
  extractionTerminal.castShadow = true;
  extractionTerminal.receiveShadow = true;
  extractionTerminal.userData.__luaScript = SCRIPT_FPS_EXIT;
  scene.add(extractionTerminal);

  const targets: Array<{ mesh: THREE.Mesh; home: THREE.Vector3; phase: number; hp: number; sway: boolean }> = [];
  const targetSpecs: Array<[number, number, boolean]> = [
    [-18, -18, false],
    [-10, 12, true],
    [0, -20, true],
    [12, 14, false],
    [20, -8, true],
    [0, 20, false],
  ];
  targetSpecs.forEach(([tx, tz, sway], index) => {
    const target = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.3, 8, 16), targetMat.clone());
    target.name = `TargetDummy_${index}`;
    target.position.set(tx, 1.05, tz);
    target.castShadow = true;
    target.userData.__luaScript = SCRIPT_FPS_TARGET;
    scene.add(target);
    targets.push({
      mesh: target,
      home: target.position.clone(),
      phase: index * 0.7,
      hp: 2,
      sway,
    });
  });

  const hazards: Array<{ pivot: THREE.Group; radius: number; speed: number; phase: number }> = [];
  [
    { x: -14, z: -2, radius: 5, speed: 1.4, phase: 0 },
    { x: 16, z: 6, radius: 4, speed: 1.9, phase: 1.8 },
  ].forEach((spec, index) => {
    const pivot = new THREE.Group();
    pivot.name = `HazardDrone_${index}`;
    pivot.position.set(spec.x, 1.4, spec.z);
    pivot.userData.__luaScript = SCRIPT_FPS_HAZARD;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 16), hazardMat.clone());
    orb.position.set(spec.radius, 0, 0);
    orb.castShadow = true;
    pivot.add(orb);
    scene.add(pivot);
    hazards.push({ pivot, radius: spec.radius, speed: spec.speed, phase: spec.phase });
  });

  const blockingBounds = blockingMeshes.map((mesh) => new THREE.Box3().setFromObject(mesh));
  markPhysicsDirty(engine);

  // Pointer lock — resolved lazily so the correct canvas is used whether
  // the template is running in standalone mode or inside the editor viewport.
  const onDocumentMouseDownFPS = (e: MouseEvent) => {
    if (engine.editorActive) return;
    const activeCanvas = engine.viewportCanvas ?? engine.renderer.domElement;
    if (e.target !== activeCanvas) return;
    if (document.pointerLockElement !== activeCanvas) {
      activeCanvas.requestPointerLock?.();
    }
  };
  document.addEventListener('mousedown', onDocumentMouseDownFPS);

  engine.camera.position.set(0, 1.7, -24);
  engine.camera.rotation.order = 'YXZ';
  let yaw = Math.PI;
  let pitch = 0;
  let velocityY = 0;
  let health = 100;
  let magazine = 12;
  let reserveAmmo = 48;
  let shootCooldown = 0;
  let reloadCooldown = 0;
  let interactionCooldown = 0;
  let extractionUnlocked = false;
  let missionComplete = false;
  const spawnPoint = new THREE.Vector3(0, 1.7, -24);
  const playerRadius = 0.45;
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const moveDir = new THREE.Vector3();
  const testPosition = new THREE.Vector3();
  const playerBox = new THREE.Box3();
  const raycaster = new THREE.Raycaster();

  const overlay = document.getElementById('ui-overlay');
  const crosshair = document.createElement('div');
  crosshair.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:10px;height:10px;pointer-events:none;z-index:1000;';
  crosshair.innerHTML = '<div style="position:absolute;left:4px;top:0;width:2px;height:10px;background:#fff;opacity:0.9"></div><div style="position:absolute;left:0;top:4px;width:10px;height:2px;background:#fff;opacity:0.9"></div>';
  overlay?.appendChild(crosshair);

  const objectiveEl = document.createElement('div');
  objectiveEl.style.cssText = 'position:fixed;top:60px;left:20px;color:#dce7ff;font-size:1rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;max-width:420px;';
  overlay?.appendChild(objectiveEl);

  const targetEl = document.createElement('div');
  targetEl.style.cssText = 'position:fixed;top:60px;right:20px;color:#7dff97;font-size:1.2rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;';
  overlay?.appendChild(targetEl);

  const healthEl = document.createElement('div');
  healthEl.style.cssText = 'position:fixed;bottom:72px;left:20px;color:#ff8f8f;font-size:1rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;';
  overlay?.appendChild(healthEl);

  const ammoEl = document.createElement('div');
  ammoEl.style.cssText = 'position:fixed;bottom:40px;right:20px;color:#f4f7ff;font-size:1rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;text-align:right;';
  overlay?.appendChild(ammoEl);

  const hintEl = document.createElement('div');
  hintEl.style.cssText = 'position:fixed;bottom:40px;left:20px;color:#c8d4ea;font-size:0.95rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;max-width:420px;';
  overlay?.appendChild(hintEl);

  const intersectsBlockingVolume = (position: THREE.Vector3): boolean => {
    playerBox.min.set(position.x - playerRadius, position.y - 1.7, position.z - playerRadius);
    playerBox.max.set(position.x + playerRadius, position.y + 0.1, position.z + playerRadius);
    return blockingBounds.some((bounds) => bounds.intersectsBox(playerBox));
  };

  const respawnPlayer = (message: string) => {
    engine.camera.position.copy(spawnPoint);
    yaw = Math.PI;
    pitch = 0;
    velocityY = 0;
    health = 100;
    hintEl.textContent = message;
  };

  const updateHud = () => {
    const remaining = targets.filter((target) => target.hp > 0).length;
    targetEl.textContent = remaining > 0 ? `Targets Remaining: ${remaining}` : 'Arena Clear';
    targetEl.style.color = remaining > 0 ? '#7dff97' : '#7cffc4';
    healthEl.textContent = `Health: ${Math.max(0, Math.round(health))}`;
    ammoEl.textContent = `Ammo: ${magazine} / ${reserveAmmo}`;

    if (missionComplete) {
      objectiveEl.textContent = 'Mission complete. Press F9 to return to the editor or keep exploring the arena.';
    } else if (extractionUnlocked) {
      objectiveEl.textContent = 'Extraction unlocked. Reach the terminal and press E to finish the run.';
    } else {
      objectiveEl.textContent = 'Clear every armored target, manage health/ammo stations, then extract.';
    }
  };

  updateHud();
  hintEl.textContent = 'Click inside the viewport to capture the mouse.';

  const resetState = () => {
    yaw = Math.PI;
    pitch = 0;
    velocityY = 0;
    health = 100;
    magazine = 12;
    reserveAmmo = 48;
    shootCooldown = 0;
    reloadCooldown = 0;
    interactionCooldown = 0;
    extractionUnlocked = false;
    missionComplete = false;
    extractionTerminal.material = exitMatLocked;
    engine.camera.position.copy(spawnPoint);
    engine.camera.rotation.set(0, 0, 0);
    targets.forEach((target) => {
      target.hp = 2;
      target.mesh.visible = true;
      target.mesh.position.copy(target.home);
      target.mesh.rotation.set(0, 0, 0);
      target.mesh.material = targetMat.clone();
    });
    updateHud();
    hintEl.textContent = 'Click inside the viewport to capture the mouse.';
  };

  const updateFn = (delta: number, elapsed: number) => {
    if (engine.editorActive) {
      crosshair.style.display = 'none';
      objectiveEl.style.display = 'none';
      targetEl.style.display = 'none';
      healthEl.style.display = 'none';
      ammoEl.style.display = 'none';
      hintEl.style.display = 'none';
      return;
    }

    crosshair.style.display = '';
    objectiveEl.style.display = '';
    targetEl.style.display = '';
    healthEl.style.display = '';
    ammoEl.style.display = '';
    hintEl.style.display = '';

    const input = engine.input;
    shootCooldown = Math.max(0, shootCooldown - delta);
    reloadCooldown = Math.max(0, reloadCooldown - delta);
    interactionCooldown = Math.max(0, interactionCooldown - delta);

    if (input.isPointerLocked) {
      yaw -= input.mouseDeltaX * 0.0022;
      pitch = THREE.MathUtils.clamp(pitch - input.mouseDeltaY * 0.0017, -1.35, 1.35);
    }

    engine.camera.rotation.order = 'YXZ';
    engine.camera.rotation.y = yaw;
    engine.camera.rotation.x = pitch;

    forward.set(Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, Math.sin(yaw));

    moveDir.set(0, 0, 0);
    if (input.isKeyDown('w') || input.isKeyDown('arrowup')) moveDir.add(forward);
    if (input.isKeyDown('s') || input.isKeyDown('arrowdown')) moveDir.sub(forward);
    if (input.isKeyDown('a') || input.isKeyDown('arrowleft')) moveDir.sub(right);
    if (input.isKeyDown('d') || input.isKeyDown('arrowright')) moveDir.add(right);

    const sprintMultiplier = input.isKeyDown('shift') || input.isKeyDown('shiftleft') || input.isKeyDown('shiftright') ? 1.55 : 1;
    if (moveDir.lengthSq() > 0) {
      moveDir.normalize().multiplyScalar(8.5 * sprintMultiplier * delta);
      testPosition.copy(engine.camera.position);
      testPosition.x = THREE.MathUtils.clamp(testPosition.x + moveDir.x, -28.2, 28.2);
      if (!intersectsBlockingVolume(testPosition)) {
        engine.camera.position.x = testPosition.x;
      }
      testPosition.copy(engine.camera.position);
      testPosition.z = THREE.MathUtils.clamp(testPosition.z + moveDir.z, -28.2, 28.2);
      if (!intersectsBlockingVolume(testPosition)) {
        engine.camera.position.z = testPosition.z;
      }
    }

    velocityY -= 20 * delta;
    engine.camera.position.y += velocityY * delta;
    if (engine.camera.position.y <= 1.7) {
      engine.camera.position.y = 1.7;
      velocityY = 0;
      if (input.isKeyJustPressed(' ') || input.isKeyJustPressed('space')) {
        velocityY = 8.5;
      }
    }

    if (input.isKeyJustPressed('r') && magazine < 12 && reserveAmmo > 0 && reloadCooldown <= 0) {
      const needed = 12 - magazine;
      const loaded = Math.min(needed, reserveAmmo);
      magazine += loaded;
      reserveAmmo -= loaded;
      reloadCooldown = 0.45;
      hintEl.textContent = `Reloaded ${loaded} round(s).`;
    }

    hazards.forEach((hazard, index) => {
      hazard.pivot.rotation.y = elapsed * hazard.speed + hazard.phase;
      const orb = hazard.pivot.children[0] as THREE.Mesh;
      orb.position.y = Math.sin(elapsed * 2 + index) * 0.25;
      const orbWorld = orb.getWorldPosition(new THREE.Vector3());
      if (!missionComplete && orbWorld.distanceTo(engine.camera.position) < 1.5) {
        health -= 22 * delta;
        hintEl.textContent = 'Hazard drone contact. Keep moving.';
      }
    });

    targets.forEach((target, index) => {
      if (target.hp <= 0) return;
      if (!target.sway) return;
      target.mesh.position.x = target.home.x + Math.sin(elapsed * 1.5 + target.phase) * 1.2;
      target.mesh.position.z = target.home.z + Math.cos(elapsed * 1.2 + target.phase) * 0.45;
      target.mesh.rotation.y = elapsed * 1.5 + index;
    });

    if (!missionComplete && input.isMouseButtonDown(0) && input.isPointerLocked && shootCooldown <= 0 && reloadCooldown <= 0) {
      if (magazine <= 0) {
        hintEl.textContent = reserveAmmo > 0 ? 'Magazine empty. Press R to reload.' : 'Out of ammo. Refill at the ammo crate.';
        shootCooldown = 0.16;
      } else {
        magazine -= 1;
        shootCooldown = 0.18;
        raycaster.setFromCamera(new THREE.Vector2(0, 0), engine.camera);
        const hits = raycaster.intersectObjects(targets.filter((target) => target.hp > 0).map((target) => target.mesh), false);
        if (hits.length > 0) {
          const hitTarget = targets.find((target) => target.mesh === hits[0].object);
          if (hitTarget) {
            hitTarget.hp -= 1;
            hitTarget.mesh.material = (hitTarget.hp <= 1 ? targetDamagedMat : targetMat).clone();
            hintEl.textContent = hitTarget.hp > 0 ? 'Target damaged.' : 'Target eliminated.';
            if (hitTarget.hp <= 0) {
              hitTarget.mesh.visible = false;
              if (targets.every((target) => target.hp <= 0)) {
                extractionUnlocked = true;
                extractionTerminal.material = exitMatOpen;
                hintEl.textContent = 'Arena clear. Head to extraction.';
              }
            }
          }
        } else {
          hintEl.textContent = 'Missed shot.';
        }
      }
    }

    const nearHeal = engine.camera.position.distanceTo(healStation.position) < 2.3;
    const nearAmmo = engine.camera.position.distanceTo(ammoCrate.position) < 2.3;
    const nearExit = engine.camera.position.distanceTo(extractionTerminal.position) < 2.6;
    if (interactionCooldown <= 0 && (input.isKeyJustPressed('e'))) {
      if (nearHeal) {
        health = 100;
        interactionCooldown = 0.4;
        hintEl.textContent = 'Health restored.';
      } else if (nearAmmo) {
        reserveAmmo = 48;
        interactionCooldown = 0.4;
        hintEl.textContent = 'Reserve ammo refilled.';
      } else if (nearExit) {
        interactionCooldown = 0.4;
        if (extractionUnlocked) {
          missionComplete = true;
          hintEl.textContent = 'Extraction confirmed. Scenario complete.';
        } else {
          hintEl.textContent = `Extraction locked. ${targets.filter((target) => target.hp > 0).length} target(s) still active.`;
        }
      }
    } else if (!missionComplete) {
      if (nearHeal) hintEl.textContent = 'Press E at the heal station to restore health.';
      else if (nearAmmo) hintEl.textContent = 'Press E at the ammo crate to refill reserve ammo.';
      else if (nearExit) hintEl.textContent = extractionUnlocked
        ? 'Press E at the extraction terminal to finish the run.'
        : `Extraction locked. ${targets.filter((target) => target.hp > 0).length} target(s) remain.`;
      else if (!input.isPointerLocked) hintEl.textContent = 'Click inside the viewport to capture the mouse.';
    }

    if (health <= 0 || engine.camera.position.y < -10) {
      respawnPlayer('Player down. Respawned at the entry lane.');
    }

    updateHud();
  };

  (updateFn as typeof updateFn & { resetState?: () => void }).resetState = resetState;

  return { updateFn, helpText: 'WASD: Move | Shift: Sprint | Mouse: Look | Click: Fire | R: Reload | E: Interact | Space: Jump | Clear targets then extract | F9: Editor' };
}

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATE: Top-Down 2D
// ═══════════════════════════════════════════════════════════════════

const SCRIPT_TOPDOWN_PLAYER = `-- Courier Controller (Top-Down 2D)
-- Controls:
--   WASD / Arrows .. Move
--   Shift .......... Burst sprint
--   E .............. Interact with relay, med station, extraction
-- Objective:
--   Recover all data shards, uplink them at the command relay,
--   then reach the extraction pad.

function onStart(self)
  self.state = {
    health = 5,
    shards = 0,
    relayOnline = false,
    extractionReady = false,
  }
end

function onUpdate(self, dt)
  local input = self.input
  local moveX, moveZ = 0, 0
  if input:isKeyDown("w") or input:isKeyDown("arrowup") then moveZ = moveZ - 1 end
  if input:isKeyDown("s") or input:isKeyDown("arrowdown") then moveZ = moveZ + 1 end
  if input:isKeyDown("a") or input:isKeyDown("arrowleft") then moveX = moveX - 1 end
  if input:isKeyDown("d") or input:isKeyDown("arrowright") then moveX = moveX + 1 end

  if moveX ~= 0 or moveZ ~= 0 then
    local len = math.sqrt(moveX * moveX + moveZ * moveZ)
    local speed = input:isKeyDown("shift") and 7 or 5
    self.position.x = self.position.x + (moveX / len) * speed * dt
    self.position.z = self.position.z + (moveZ / len) * speed * dt
  end
end
`;

const SCRIPT_TOPDOWN_ENEMY = `-- Patrol Drone (Top-Down 2D)
-- Sweeps a lane, accelerates when the courier enters its alert radius,
-- and deals contact damage on interception.
`;

const SCRIPT_TOPDOWN_SHARD = `-- Data Shard
-- Mission pickup that feeds the command relay once the courier returns.
`;

const SCRIPT_TOPDOWN_RELAY = `-- Command Relay
-- Interact here after all data shards are recovered.
-- Bringing the relay online unlocks the extraction pad.
`;

const SCRIPT_TOPDOWN_MED = `-- Med Station
-- Restores the courier to full health when used.
`;

const SCRIPT_TOPDOWN_EXIT = `-- Extraction Pad
-- Remains locked until the command relay has been brought back online.
`;

function setupTopDown2D(engine: Engine, scene: THREE.Scene): TemplateResult {
  scene.background = new THREE.Color(0x0f1726);

  engine.camera.position.set(0, 28, 1.8);
  engine.camera.lookAt(0, 0, 0);
  engine.camera.fov = 26;
  engine.camera.updateProjectionMatrix();

  const floorMat = new THREE.MeshBasicMaterial({ color: 0x162235 });
  const laneMat = new THREE.MeshBasicMaterial({ color: 0x1d3150 });
  const wallMat = new THREE.MeshBasicMaterial({ color: 0x25354f });
  const playerMat = new THREE.MeshBasicMaterial({ color: 0x4ec7ff });
  const droneMat = new THREE.MeshBasicMaterial({ color: 0xff6b6b });
  const droneAlertMat = new THREE.MeshBasicMaterial({ color: 0xff9966 });
  const shardMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  const relayIdleMat = new THREE.MeshBasicMaterial({ color: 0x6c7a99 });
  const relayActiveMat = new THREE.MeshBasicMaterial({ color: 0x5fffb2 });
  const medMat = new THREE.MeshBasicMaterial({ color: 0x6ce0d6 });
  const extractionLockedMat = new THREE.MeshBasicMaterial({ color: 0x4b5874 });
  const extractionReadyMat = new THREE.MeshBasicMaterial({ color: 0x72ffb1 });

  const arenaFloor = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), floorMat);
  arenaFloor.name = 'ArenaFloor';
  arenaFloor.rotation.x = -Math.PI / 2;
  arenaFloor.position.y = -0.02;
  scene.add(arenaFloor);

  const laneNorth = new THREE.Mesh(new THREE.PlaneGeometry(18, 4), laneMat);
  laneNorth.rotation.x = -Math.PI / 2;
  laneNorth.position.set(0, -0.01, -6.5);
  scene.add(laneNorth);
  const laneCenter = new THREE.Mesh(new THREE.PlaneGeometry(10, 16), laneMat);
  laneCenter.rotation.x = -Math.PI / 2;
  laneCenter.position.set(0, -0.01, 1);
  scene.add(laneCenter);
  const laneEast = new THREE.Mesh(new THREE.PlaneGeometry(6, 10), laneMat);
  laneEast.rotation.x = -Math.PI / 2;
  laneEast.position.set(8, -0.01, 6);
  scene.add(laneEast);

  const gridHelper = new THREE.GridHelper(26, 26, 0x33507a, 0x1e314f);
  gridHelper.name = 'Grid';
  scene.add(gridHelper);

  [
    [-10.5, 0, 0.8, 1, 24],
    [10.5, 0, 0.8, 1, 24],
    [0, -10.5, 20, 1, 0.8],
    [0, 10.5, 20, 1, 0.8],
    [-4.5, -2.5, 0.8, 1, 9],
    [4.5, 3.2, 0.8, 1, 8],
    [0, 0, 4.2, 1, 0.8],
  ].forEach(([x, z, w, h, d], index) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    wall.name = `Barrier_${index}`;
    wall.position.set(x, h / 2 - 0.48, z);
    scene.add(wall);
  });

  const playerMesh = new THREE.Mesh(new THREE.CircleGeometry(0.55, 18), playerMat);
  playerMesh.name = 'Courier';
  playerMesh.rotation.x = -Math.PI / 2;
  playerMesh.position.set(-8.5, 0.03, 8.5);
  playerMesh.userData.__luaScript = SCRIPT_TOPDOWN_PLAYER;
  scene.add(playerMesh);

  const relay = new THREE.Mesh(new THREE.CircleGeometry(0.9, 6), relayIdleMat);
  relay.name = 'CommandRelay';
  relay.rotation.x = -Math.PI / 2;
  relay.position.set(0, 0.04, 0.5);
  relay.userData.__luaScript = SCRIPT_TOPDOWN_RELAY;
  scene.add(relay);

  const medStation = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), medMat);
  medStation.name = 'MedStation';
  medStation.rotation.x = -Math.PI / 2;
  medStation.position.set(-8.2, 0.03, -7.8);
  medStation.userData.__luaScript = SCRIPT_TOPDOWN_MED;
  scene.add(medStation);

  const extractionPad = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.3, 24), extractionLockedMat);
  extractionPad.name = 'ExtractionPad';
  extractionPad.rotation.x = -Math.PI / 2;
  extractionPad.position.set(8.5, 0.03, 8.5);
  extractionPad.userData.__luaScript = SCRIPT_TOPDOWN_EXIT;
  scene.add(extractionPad);

  const shardPositions: Array<[number, number]> = [[7.5, -7.2], [-7.2, 0.8], [7.4, 3.6]];
  const shards: THREE.Mesh[] = shardPositions.map(([x, z], index) => {
    const shard = new THREE.Mesh(new THREE.CircleGeometry(0.38, 5), shardMat);
    shard.name = `DataShard_${index}`;
    shard.rotation.x = -Math.PI / 2;
    shard.position.set(x, 0.05, z);
    shard.userData.__luaScript = SCRIPT_TOPDOWN_SHARD;
    scene.add(shard);
    return shard;
  });

  interface DroneData {
    mesh: THREE.Mesh;
    start: THREE.Vector3;
    end: THREE.Vector3;
    speed: number;
    t: number;
    dir: 1 | -1;
    alertRadius: number;
  }
  const droneDefs: Array<[number, number, number, number, number, number]> = [
    [-3.5, -6.5, 5.5, -6.5, 0.35, 3.6],
    [7.5, -2.8, 7.5, 7.2, 0.42, 3.2],
    [-5.8, 6.8, 1.4, 6.8, 0.5, 2.8],
  ];
  const drones: DroneData[] = droneDefs.map(([sx, sz, ex, ez, speed, alertRadius], index) => {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.48, 4), droneMat);
    mesh.name = `PatrolDrone_${index}`;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(sx, 0.04, sz);
    mesh.userData.__luaScript = SCRIPT_TOPDOWN_ENEMY;
    scene.add(mesh);
    return {
      mesh,
      start: new THREE.Vector3(sx, 0.04, sz),
      end: new THREE.Vector3(ex, 0.04, ez),
      speed,
      t: 0,
      dir: 1,
      alertRadius,
    };
  });

  const objectiveEl = document.createElement('div');
  objectiveEl.style.cssText = 'position:fixed;top:58px;left:20px;color:#e8f1ff;font-size:1rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;max-width:360px;';
  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'position:fixed;top:100px;left:20px;color:#ffe066;font-size:0.95rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;';
  const healthEl = document.createElement('div');
  healthEl.style.cssText = 'position:fixed;top:136px;left:20px;color:#ff8d8d;font-size:0.95rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;';
  const hintEl = document.createElement('div');
  hintEl.style.cssText = 'position:fixed;bottom:26px;left:20px;color:#bfd9ff;font-size:0.95rem;font-family:sans-serif;z-index:1000;text-shadow:0 0 6px #000;max-width:420px;';
  document.getElementById('ui-overlay')?.append(objectiveEl, statusEl, healthEl, hintEl);

  const moveDir = new THREE.Vector2();
  const dashDir = new THREE.Vector2(1, 0);
  const spawn = new THREE.Vector3(-8.5, 0.03, 8.5);
  const bounds = { minX: -9.2, maxX: 9.2, minZ: -9.2, maxZ: 9.2 };
  const collectedShards = new Set<string>();
  const activeShards = [...shards];
  let relayOnline = false;
  let extractionReady = false;
  let missionComplete = false;
  let health = 5;
  let damageCooldown = 0;
  let sprintEnergy = 1;
  let interactCooldown = 0;
  let messageTimer = 0;
  let transientHint = 'Slip through the patrol lanes, recover the shards, and bring the relay online.';

  const setHint = (message: string, duration = 2.6) => {
    transientHint = message;
    messageTimer = duration;
  };

  const respawn = (message: string) => {
    playerMesh.position.copy(spawn);
    damageCooldown = 1.2;
    sprintEnergy = 1;
    setHint(message, 2.8);
  };

  const updateHud = () => {
    statusEl.textContent = `Data shards: ${collectedShards.size} / ${shards.length}`;
    healthEl.textContent = `Integrity: ${'■'.repeat(Math.max(health, 0))}${'□'.repeat(Math.max(0, 5 - health))}`;
    if (missionComplete) {
      objectiveEl.textContent = 'Extraction complete. The courier delivered the recovered shard package.';
      hintEl.textContent = 'Press F9 to inspect the scripted relay, drones, and extraction pad in the editor.';
      return;
    }
    if (!relayOnline) {
      objectiveEl.textContent = collectedShards.size === shards.length
        ? 'All shards recovered. Return to the command relay and press E to bring the uplink online.'
        : 'Recover every data shard while avoiding patrol drones across the facility lanes.';
      hintEl.textContent = messageTimer > 0
        ? transientHint
        : 'Shift gives a short burst of speed. Use E near the med station, relay, or extraction pad.';
      return;
    }
    if (!extractionReady) {
      objectiveEl.textContent = 'Relay online. Extraction routing is stabilizing.';
      hintEl.textContent = messageTimer > 0 ? transientHint : 'Hold position and move to the extraction pad once it turns green.';
      return;
    }
    objectiveEl.textContent = 'Extraction ready. Reach the pad on the east side and press E to finish the run.';
    hintEl.textContent = messageTimer > 0 ? transientHint : 'The patrol lanes stay active. Use the central cover blocks to break line-of-travel.';
  };

  const updateFn = (delta: number, elapsed: number) => {
    if (engine.editorActive) {
      objectiveEl.style.display = 'none';
      statusEl.style.display = 'none';
      healthEl.style.display = 'none';
      hintEl.style.display = 'none';
      return;
    }
    objectiveEl.style.display = '';
    statusEl.style.display = '';
    healthEl.style.display = '';
    hintEl.style.display = '';

    const input = engine.input;
    damageCooldown = Math.max(0, damageCooldown - delta);
    interactCooldown = Math.max(0, interactCooldown - delta);
    if (messageTimer > 0) messageTimer = Math.max(0, messageTimer - delta);

    moveDir.set(0, 0);
    if (input.isKeyDown('w') || input.isKeyDown('arrowup')) moveDir.y -= 1;
    if (input.isKeyDown('s') || input.isKeyDown('arrowdown')) moveDir.y += 1;
    if (input.isKeyDown('a') || input.isKeyDown('arrowleft')) moveDir.x -= 1;
    if (input.isKeyDown('d') || input.isKeyDown('arrowright')) moveDir.x += 1;

    let speed = 5.2;
    const wantsSprint = input.isKeyDown('shift') || input.isKeyDown('shiftleft') || input.isKeyDown('shiftright');
    if (wantsSprint && sprintEnergy > 0.05) {
      speed = 8.4;
      sprintEnergy = Math.max(0, sprintEnergy - delta * 0.8);
    } else {
      sprintEnergy = Math.min(1, sprintEnergy + delta * 0.35);
    }

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
      dashDir.copy(moveDir);
      playerMesh.position.x += moveDir.x * speed * delta;
      playerMesh.position.z += moveDir.y * speed * delta;
      playerMesh.rotation.z = Math.atan2(moveDir.y, moveDir.x) - Math.PI / 2;
    }

    playerMesh.position.x = Math.max(bounds.minX, Math.min(bounds.maxX, playerMesh.position.x));
    playerMesh.position.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, playerMesh.position.z));

    for (let index = activeShards.length - 1; index >= 0; index--) {
      const shard = activeShards[index];
      shard.rotation.z = elapsed * 2.5 + index;
      shard.position.y = 0.05 + Math.sin(elapsed * 3 + index) * 0.03;
      const distance = Math.hypot(playerMesh.position.x - shard.position.x, playerMesh.position.z - shard.position.z);
      if (distance < 0.75) {
        collectedShards.add(shard.name);
        scene.remove(shard);
        activeShards.splice(index, 1);
        setHint(`Recovered ${shard.name.replace('_', ' ')}.`, 1.8);
      }
    }

    for (const drone of drones) {
      drone.t += drone.dir * drone.speed * delta;
      if (drone.t > 1) {
        drone.t = 1;
        drone.dir = -1;
      } else if (drone.t < 0) {
        drone.t = 0;
        drone.dir = 1;
      }
      drone.mesh.position.lerpVectors(drone.start, drone.end, drone.t);

      const distance = Math.hypot(playerMesh.position.x - drone.mesh.position.x, playerMesh.position.z - drone.mesh.position.z);
      const alert = distance < drone.alertRadius;
      (drone.mesh.material as THREE.MeshBasicMaterial).color.setHex(alert ? 0xff9966 : 0xff6b6b);
      drone.mesh.rotation.z = Math.atan2(drone.end.z - drone.start.z, drone.end.x - drone.start.x) - Math.PI / 2 + elapsed * 2;

      if (damageCooldown <= 0 && distance < 0.85) {
        health -= 1;
        damageCooldown = 1.1;
        setHint('Patrol drone intercepted the courier.', 1.6);
        if (health <= 0) {
          health = 5;
          respawn('Courier reset at the entry lane.');
        }
      }
    }

    if (!relayOnline) {
      (relay.material as THREE.MeshBasicMaterial) = relayIdleMat;
    }

    const nearRelay = Math.hypot(playerMesh.position.x - relay.position.x, playerMesh.position.z - relay.position.z) < 1.5;
    const nearMed = Math.hypot(playerMesh.position.x - medStation.position.x, playerMesh.position.z - medStation.position.z) < 1.35;
    const nearExtraction = Math.hypot(playerMesh.position.x - extractionPad.position.x, playerMesh.position.z - extractionPad.position.z) < 1.5;

    if (interactCooldown <= 0 && input.isKeyJustPressed('e')) {
      if (nearMed && health < 5) {
        health = 5;
        interactCooldown = 0.35;
        setHint('Integrity restored at the med station.', 1.8);
      } else if (nearRelay && !relayOnline) {
        interactCooldown = 0.35;
        if (collectedShards.size === shards.length) {
          relayOnline = true;
          extractionReady = true;
          relay.material = relayActiveMat;
          extractionPad.material = extractionReadyMat;
          setHint('Command relay online. Extraction lane unlocked.', 2.4);
        } else {
          setHint(`Relay missing ${shards.length - collectedShards.size} shard(s).`, 1.8);
        }
      } else if (nearExtraction) {
        interactCooldown = 0.35;
        if (extractionReady) {
          missionComplete = true;
          setHint('Courier extracted successfully.', 2.6);
        } else {
          setHint('Extraction pad locked. Bring the relay online first.', 1.8);
        }
      }
    } else if (messageTimer <= 0 && !missionComplete) {
      if (nearRelay && !relayOnline) {
        hintEl.textContent = collectedShards.size === shards.length
          ? 'Press E to uplink the recovered shards at the command relay.'
          : `Relay offline. ${shards.length - collectedShards.size} shard(s) still missing.`;
      } else if (nearMed && health < 5) {
        hintEl.textContent = 'Press E at the med station to restore full integrity.';
      } else if (nearExtraction) {
        hintEl.textContent = extractionReady
          ? 'Press E on the extraction pad to finish the mission.'
          : 'Extraction remains locked until the command relay is active.';
      }
    }

    engine.camera.position.x = playerMesh.position.x;
    engine.camera.position.z = playerMesh.position.z + 1.8;
    engine.camera.lookAt(playerMesh.position.x, 0, playerMesh.position.z);

    updateHud();
  };

  return {
    updateFn,
    helpText: 'WASD: Move | Shift: Sprint | E: Interact | Recover shards, activate relay, extract | F9: Editor',
  };
}

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATE: Main Menu
// ═══════════════════════════════════════════════════════════════════

const SCRIPT_MENU_CAMERA = `-- Menu Camera Rig
-- Orbits slowly around the title monolith and leans toward the selected menu pedestal.
`;

const SCRIPT_MENU_PORTAL = `-- Menu Portal
-- Animated centerpiece used to sell the title screen mood.
-- Pulses faster when the PLAY option is selected.
`;

const SCRIPT_MENU_MONOLITH = `-- Title Monolith
-- Environmental anchor for the title screen and backdrop for the menu options.
`;

const SCRIPT_MENU_OPTION = `-- Menu Pedestal
-- Represents a selectable title-screen option.
-- Arrow keys or W/S move selection; Enter confirms the current option.
`;

function setupMainMenu(engine: Engine, scene: THREE.Scene): TemplateResult {
  scene.background = new THREE.Color(0x07111c);
  scene.fog = new THREE.Fog(0x07111c, 18, 46);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(16, 48),
    new THREE.MeshStandardMaterial({ color: 0x101d30, roughness: 1 }),
  );
  floor.name = 'MenuFloor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(7.2, 9.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x18304d, emissive: 0x18304d, emissiveIntensity: 0.35 }),
  );
  ring.name = 'MenuFloorRing';
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -1.15;
  scene.add(ring);

  const ambient = new THREE.AmbientLight(0x33506d, 0.7);
  ambient.name = 'AmbientLight';
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xcfe7ff, 1.8);
  keyLight.name = 'MenuKeyLight';
  keyLight.position.set(6, 10, 8);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(0x3ed8ff, 8, 30, 2);
  fillLight.name = 'PortalGlow';
  fillLight.position.set(0, 2.5, -2.5);
  scene.add(fillLight);

  const monolithMat = new THREE.MeshStandardMaterial({ color: 0x2a3447, roughness: 0.75, metalness: 0.35 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x79d6ff, emissive: 0x79d6ff, emissiveIntensity: 0.45, roughness: 0.25 });
  const optionIdleMat = new THREE.MeshStandardMaterial({ color: 0x314765, roughness: 0.8 });
  const optionActiveMat = new THREE.MeshStandardMaterial({ color: 0x7ef0c0, emissive: 0x7ef0c0, emissiveIntensity: 0.7, roughness: 0.35 });

  const monolith = new THREE.Group();
  monolith.name = 'TitleMonolith';
  monolith.userData.__luaScript = SCRIPT_MENU_MONOLITH;
  const monolithCore = new THREE.Mesh(new THREE.BoxGeometry(6.5, 6.8, 1.1), monolithMat);
  monolithCore.position.set(0, 2.3, -4.4);
  monolithCore.castShadow = true;
  monolithCore.receiveShadow = true;
  monolith.add(monolithCore);
  const monolithAccent = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.24, 0.2), accentMat);
  monolithAccent.position.set(0, 4.8, -3.8);
  monolith.add(monolithAccent);
  scene.add(monolith);

  const menuPortal = new THREE.Group();
  menuPortal.name = 'MenuPortal';
  menuPortal.userData.__luaScript = SCRIPT_MENU_PORTAL;
  const portalOuter = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.22, 18, 80), accentMat.clone());
  portalOuter.rotation.x = Math.PI / 2;
  portalOuter.position.set(0, 1.5, -1.8);
  portalOuter.castShadow = true;
  menuPortal.add(portalOuter);
  const portalInner = new THREE.Mesh(
    new THREE.CircleGeometry(2.1, 48),
    new THREE.MeshStandardMaterial({ color: 0x123a5b, emissive: 0x26b3ff, emissiveIntensity: 0.65, roughness: 0.2 }),
  );
  portalInner.position.set(0, 1.5, -1.8);
  menuPortal.add(portalInner);
  scene.add(menuPortal);

  const cameraRig = new THREE.Object3D();
  cameraRig.name = 'MenuCameraRig';
  cameraRig.userData.__luaScript = SCRIPT_MENU_CAMERA;
  cameraRig.position.set(0, 2.5, -2.2);
  scene.add(cameraRig);

  const menuOptions = [
    { label: 'PLAY', description: 'Launch into the latest sandbox route.', x: -4.4 },
    { label: 'SETTINGS', description: 'Tune rendering, audio, and controls.', x: 0 },
    { label: 'CREDITS', description: 'Browse the engine systems behind the showcase.', x: 4.4 },
  ];

  const optionStands = menuOptions.map((option, index) => {
    const stand = new THREE.Group();
    stand.name = `${option.label}_Pedestal`;
    stand.userData.__luaScript = SCRIPT_MENU_OPTION;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.2, 0.7, 18), optionIdleMat.clone());
    base.position.set(option.x, -0.85, 3.8);
    base.castShadow = true;
    base.receiveShadow = true;
    stand.add(base);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 1.2), accentMat.clone());
    plate.position.set(option.x, -0.38, 3.8);
    stand.add(plate);
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), accentMat.clone());
    beacon.position.set(option.x, 0.38, 3.8);
    stand.add(beacon);
    scene.add(stand);
    return { stand, base, plate, beacon, index, ...option };
  });

  const shards: THREE.Mesh[] = [];
  for (let i = 0; i < 14; i++) {
    const shard = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.24 + Math.random() * 0.18, 0),
      new THREE.MeshStandardMaterial({ color: 0x6ccaff, emissive: 0x6ccaff, emissiveIntensity: 0.4, roughness: 0.3 }),
    );
    shard.name = `MenuShard_${i}`;
    shard.position.set((Math.random() - 0.5) * 18, 1 + Math.random() * 6, -8 - Math.random() * 12);
    shard.userData.__speed = 0.25 + Math.random() * 0.45;
    shard.userData.__axis = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
    scene.add(shard);
    shards.push(shard);
  }

  engine.camera.position.set(0, 2.8, 12);
  engine.camera.lookAt(0, 2, -2);

  const menuUI = document.createElement('div');
  menuUI.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;z-index:100;font-family:sans-serif;';
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:3.4rem;color:#f5fbff;letter-spacing:0.28em;text-shadow:0 0 32px rgba(121,214,255,0.72);margin-bottom:10px;';
  titleEl.textContent = 'BLINDFAKE';
  const subtitleEl = document.createElement('div');
  subtitleEl.style.cssText = 'color:#93b8d6;font-size:1rem;letter-spacing:0.08em;margin-bottom:34px;';
  subtitleEl.textContent = 'Playable editor templates and runtime systems showcase';
  const optionListEl = document.createElement('div');
  optionListEl.style.cssText = 'display:flex;gap:14px;pointer-events:none;';
  const infoEl = document.createElement('div');
  infoEl.style.cssText = 'margin-top:28px;color:#d8e7f8;font-size:0.95rem;letter-spacing:0.03em;text-shadow:0 0 10px #000;';
  const confirmEl = document.createElement('div');
  confirmEl.style.cssText = 'margin-top:14px;color:#7ef0c0;font-size:0.95rem;letter-spacing:0.08em;text-shadow:0 0 10px #000;';
  const optionEls = menuOptions.map((option) => {
    const el = document.createElement('div');
    el.style.cssText = 'min-width:160px;padding:14px 18px;border:1px solid rgba(126,240,192,0.12);border-radius:12px;background:rgba(10,20,34,0.56);color:#d8e7f8;text-align:center;font-size:1rem;letter-spacing:0.14em;';
    el.textContent = option.label;
    optionListEl.appendChild(el);
    return el;
  });
  menuUI.append(titleEl, subtitleEl, optionListEl, infoEl, confirmEl);
  document.getElementById('ui-overlay')?.appendChild(menuUI);

  let selectedIndex = 0;
  let confirmTimer = 0;
  let lastConfirmedLabel = 'PLAY';

  const updateSelectionUI = () => {
    optionEls.forEach((el, index) => {
      const active = index === selectedIndex;
      el.style.background = active ? 'rgba(24,54,72,0.88)' : 'rgba(10,20,34,0.56)';
      el.style.borderColor = active ? 'rgba(126,240,192,0.78)' : 'rgba(126,240,192,0.12)';
      el.style.color = active ? '#f7fffd' : '#d8e7f8';
      el.style.transform = active ? 'translateY(-4px)' : 'translateY(0)';
      el.style.boxShadow = active ? '0 0 24px rgba(126,240,192,0.18)' : 'none';
    });
    infoEl.textContent = menuOptions[selectedIndex].description;
    confirmEl.textContent = confirmTimer > 0 ? `${lastConfirmedLabel} CONFIRMED` : 'W / S or Arrow Keys: Navigate | Enter: Confirm';
  };
  updateSelectionUI();

  const updateFn = (delta: number, elapsed: number) => {
    if (engine.editorActive) {
      menuUI.style.display = 'none';
      return;
    }
    menuUI.style.display = '';

    const input = engine.input;
    if (input.isKeyJustPressed('w') || input.isKeyJustPressed('arrowup')) {
      selectedIndex = (selectedIndex + menuOptions.length - 1) % menuOptions.length;
    }
    if (input.isKeyJustPressed('s') || input.isKeyJustPressed('arrowdown')) {
      selectedIndex = (selectedIndex + 1) % menuOptions.length;
    }
    if (input.isKeyJustPressed('enter') || input.isKeyJustPressed(' ')) {
      lastConfirmedLabel = menuOptions[selectedIndex].label;
      confirmTimer = 1.8;
    }
    if (confirmTimer > 0) confirmTimer = Math.max(0, confirmTimer - delta);

    const orbitRadius = 12 + Math.sin(elapsed * 0.4) * 0.4;
    engine.camera.position.x = Math.sin(elapsed * 0.22) * orbitRadius;
    engine.camera.position.y = 2.6 + Math.cos(elapsed * 0.31) * 0.8;
    engine.camera.position.z = 10.8 + Math.cos(elapsed * 0.22) * 1.4;
    const selectedStand = optionStands[selectedIndex].stand.position;
    engine.camera.lookAt(selectedStand.x * 0.35, 1.6, -1.6);

    portalOuter.rotation.z += delta * 0.65;
    portalInner.rotation.z -= delta * 0.24;
    portalInner.scale.setScalar(1 + Math.sin(elapsed * (selectedIndex === 0 ? 2.6 : 1.8)) * 0.035);
    fillLight.intensity = 7.2 + Math.sin(elapsed * 2.4) * 1.4;
    monolithAccent.scale.x = 1 + Math.sin(elapsed * 0.9) * 0.06;

    optionStands.forEach((option, index) => {
      const active = index === selectedIndex;
      option.base.material = active ? optionActiveMat : optionIdleMat;
      option.plate.position.y = -0.38 + Math.sin(elapsed * 2 + index) * (active ? 0.07 : 0.03);
      option.beacon.position.y = 0.38 + Math.sin(elapsed * 2.8 + index) * (active ? 0.16 : 0.08);
      option.beacon.rotation.y += delta * (active ? 1.8 : 0.9);
      option.stand.position.z = 3.8 + (active ? Math.sin(elapsed * 3 + index) * 0.12 : 0);
    });

    shards.forEach((shard, index) => {
      const axis = shard.userData.__axis as THREE.Vector3;
      shard.rotateOnAxis(axis, delta * shard.userData.__speed);
      shard.position.y += Math.sin(elapsed * (1.4 + index * 0.03) + index) * 0.0025;
    });

    updateSelectionUI();
  };

  return { updateFn, helpText: 'W / S or Arrows: Navigate | Enter: Confirm | F9: Editor | Main Menu Showcase' };
}

// ═══════════════════════════════════════════════════════════════════
//  TEMPLATE: Fighting (JoJo / Tekken style arena fighter)
// ═══════════════════════════════════════════════════════════════════

const SCRIPT_FIGHTING_PLAYER = `-- Fighter Controller (Arena Fighter)
-- Controls (Player 1):
--   A / D ........... Move left/right
--   W ............... Jump
--   J ............... Light Attack
--   K ............... Heavy Attack
--   L ............... Special Attack
--   U ............... Summon / Dismiss Stand
--   S ............... Block
-- Controls (Player 2):
--   Arrow Left/Right  Move
--   Arrow Up ........ Jump
--   Numpad 1 ........ Light Attack
--   Numpad 2 ........ Heavy Attack
--   Numpad 3 ........ Special
--   Numpad 0 ........ Summon Stand
--   Arrow Down ...... Block

function onStart(self)
  self.state = { hp = 100, stand = false, combo = 0 }
end

function onUpdate(self, dt)
  -- Movement, attacks and Stand logic handled by the template update loop.
end
`;

interface Fighter {
  mesh: THREE.Mesh;
  standMesh: THREE.Mesh;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  vy: number;
  facingRight: boolean;
  grounded: boolean;
  standActive: boolean;
  blocking: boolean;
  attackTimer: number;
  attackType: '' | 'light' | 'heavy' | 'special' | 'stand-barrage';
  hitCooldown: number;
  comboCount: number;
  comboTimer: number;
  stunTimer: number;
  specialMeter: number;
  name: string;
}

function setupFighting(engine: Engine, scene: THREE.Scene): TemplateResult {
  scene.background = new THREE.Color(0x0a0a1a);

  // ── Arena Lighting ──
  const ambLight = new THREE.AmbientLight(0x334466, 0.7);
  ambLight.name = 'FightAmbient';
  scene.add(ambLight);

  const mainLight = new THREE.DirectionalLight(0xffeedd, 1.8);
  mainLight.name = 'FightMainLight';
  mainLight.position.set(5, 15, 8);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.set(2048, 2048);
  mainLight.shadow.camera.left = -20;
  mainLight.shadow.camera.right = 20;
  mainLight.shadow.camera.top = 10;
  mainLight.shadow.camera.bottom = -5;
  scene.add(mainLight);

  const rimLight = new THREE.DirectionalLight(0x6688ff, 0.8);
  rimLight.name = 'FightRimLight';
  rimLight.position.set(-8, 10, -5);
  scene.add(rimLight);

  const spotL = new THREE.SpotLight(0xff4444, 3, 30, Math.PI / 6, 0.5);
  spotL.name = 'SpotLeft';
  spotL.position.set(-12, 12, 6);
  spotL.target.position.set(-5, 0, 0);
  scene.add(spotL);
  scene.add(spotL.target);

  const spotR = new THREE.SpotLight(0x4444ff, 3, 30, Math.PI / 6, 0.5);
  spotR.name = 'SpotRight';
  spotR.position.set(12, 12, 6);
  spotR.target.position.set(5, 0, 0);
  scene.add(spotR);
  scene.add(spotR.target);

  // ── Arena Floor ──
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.3, metalness: 0.6 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 14), floorMat);
  floor.name = 'ArenaFloor';
  floor.position.y = -0.25;
  floor.receiveShadow = true;
  floor.userData.isCollider = true;
  scene.add(floor);

  // Arena edge glow strips
  const edgeGlowMat = new THREE.MeshBasicMaterial({ color: 0x4400ff });
  const edgeL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 14), edgeGlowMat);
  edgeL.position.set(-13, 0.05, 0); scene.add(edgeL);
  const edgeR = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 14), edgeGlowMat);
  edgeR.position.set(13, 0.05, 0); scene.add(edgeR);

  // Backdrop wall
  const backdropMat = new THREE.MeshStandardMaterial({ color: 0x0d0d20, roughness: 0.8 });
  const backdrop = new THREE.Mesh(new THREE.BoxGeometry(28, 12, 0.5), backdropMat);
  backdrop.name = 'ArenaBackdrop';
  backdrop.position.set(0, 5.5, -7);
  scene.add(backdrop);

  // Decorative columns
  const colMat = new THREE.MeshStandardMaterial({ color: 0x2a2a4a, roughness: 0.5, metalness: 0.4 });
  [-11, 11].forEach((cx, i) => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 10, 12), colMat);
    col.name = `ArenaColumn_${i}`;
    col.position.set(cx, 5, -6);
    col.castShadow = true;
    scene.add(col);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshStandardMaterial({ color: 0x6644ff, emissive: 0x6644ff, emissiveIntensity: 0.3 }));
    cap.position.set(cx, 10.3, -6);
    scene.add(cap);
  });

  // ── Materials ──
  const p1Color = 0xe74c3c;
  const p2Color = 0x3498db;
  const standP1Color = 0xf39c12;
  const standP2Color = 0x9b59b6;

  const p1Mat = new THREE.MeshStandardMaterial({ color: p1Color, roughness: 0.6 });
  const p2Mat = new THREE.MeshStandardMaterial({ color: p2Color, roughness: 0.6 });
  const standP1Mat = new THREE.MeshStandardMaterial({ color: standP1Color, emissive: standP1Color, emissiveIntensity: 0.4, transparent: true, opacity: 0.85 });
  const standP2Mat = new THREE.MeshStandardMaterial({ color: standP2Color, emissive: standP2Color, emissiveIntensity: 0.4, transparent: true, opacity: 0.85 });

  // ── Create Fighter Mesh ──
  const createFighterMesh = (name: string, mat: THREE.Material, x: number, facingRight: boolean): THREE.Mesh => {
    const group = new THREE.Group();
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.6), mat);
    body.position.y = 1.4;
    body.castShadow = true;
    group.add(body);
    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), mat);
    head.position.y = 2.4;
    head.castShadow = true;
    group.add(head);
    // Arms
    const armMat = (mat as THREE.MeshStandardMaterial).clone();
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.25), armMat);
    leftArm.position.set(-0.55, 1.5, 0);
    leftArm.castShadow = true;
    leftArm.name = 'LeftArm';
    group.add(leftArm);
    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.25), armMat);
    rightArm.position.set(0.55, 1.5, 0);
    rightArm.castShadow = true;
    rightArm.name = 'RightArm';
    group.add(rightArm);
    // Legs
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.3), armMat);
    leftLeg.position.set(-0.2, 0.4, 0);
    leftLeg.castShadow = true;
    leftLeg.name = 'LeftLeg';
    group.add(leftLeg);
    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.3), armMat);
    rightLeg.position.set(0.2, 0.4, 0);
    rightLeg.castShadow = true;
    rightLeg.name = 'RightLeg';
    group.add(rightLeg);

    // We use a container mesh so raycasting works
    const container = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial({ visible: false }));
    container.name = name;
    container.position.set(x, 0, 0);
    container.add(group);
    container.userData.__luaScript = SCRIPT_FIGHTING_PLAYER;
    if (!facingRight) group.rotation.y = Math.PI;
    scene.add(container);
    return container;
  };

  // ── Create Stand Mesh ──
  const createStandMesh = (name: string, mat: THREE.Material): THREE.Mesh => {
    const group = new THREE.Group();
    // Taller, more imposing body
    const sBody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.5), mat);
    sBody.position.y = 1.8;
    sBody.castShadow = true;
    group.add(sBody);
    // Stand head (angular)
    const sHead = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat);
    sHead.position.y = 3.0;
    sHead.castShadow = true;
    group.add(sHead);
    // Larger arms for punching
    const sMat = (mat as THREE.MeshStandardMaterial).clone();
    const sLeftArm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.3), sMat);
    sLeftArm.position.set(-0.65, 1.9, 0);
    sLeftArm.castShadow = true;
    sLeftArm.name = 'StandLeftArm';
    group.add(sLeftArm);
    const sRightArm = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.3), sMat);
    sRightArm.position.set(0.65, 1.9, 0);
    sRightArm.castShadow = true;
    sRightArm.name = 'StandRightArm';
    group.add(sRightArm);
    // Shoulder pads
    const shoulderMat = (mat as THREE.MeshStandardMaterial).clone();
    shoulderMat.emissiveIntensity = 0.7;
    const lShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), shoulderMat);
    lShoulder.position.set(-0.7, 2.55, 0);
    group.add(lShoulder);
    const rShoulder = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), shoulderMat);
    rShoulder.position.set(0.7, 2.55, 0);
    group.add(rShoulder);

    const container = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial({ visible: false }));
    container.name = name;
    container.visible = false;
    container.add(group);
    scene.add(container);
    return container;
  };

  const p1Mesh = createFighterMesh('Fighter_P1', p1Mat, -5, true);
  const p2Mesh = createFighterMesh('Fighter_P2', p2Mat, 5, false);
  const standP1Mesh = createStandMesh('Stand_P1', standP1Mat);
  const standP2Mesh = createStandMesh('Stand_P2', standP2Mat);

  // ── Camera Setup ──
  engine.camera.position.set(0, 4, 14);
  engine.camera.lookAt(0, 2.5, 0);

  // ── Fighter State ──
  const ARENA_LEFT = -12;
  const ARENA_RIGHT = 12;
  const GRAVITY = 22;
  const JUMP_FORCE = 10;
  const MOVE_SPEED = 6;
  const LIGHT_DMG = 5;
  const HEAVY_DMG = 12;
  const SPECIAL_DMG = 18;
  const BARRAGE_DMG = 3;
  const ATTACK_RANGE = 2.2;
  const STAND_OFFSET = 1.0;

  const createFighter = (name: string, mesh: THREE.Mesh, standMesh: THREE.Mesh, x: number, facingRight: boolean): Fighter => ({
    mesh,
    standMesh,
    hp: 100,
    maxHp: 100,
    x,
    y: 0,
    vy: 0,
    facingRight,
    grounded: true,
    standActive: false,
    blocking: false,
    attackTimer: 0,
    attackType: '',
    hitCooldown: 0,
    comboCount: 0,
    comboTimer: 0,
    stunTimer: 0,
    specialMeter: 0,
    name,
  });

  const p1: Fighter = createFighter('P1', p1Mesh, standP1Mesh, -5, true);
  const p2: Fighter = createFighter('P2', p2Mesh, standP2Mesh, 5, false);

  let roundTimer = 99;
  let roundOver = false;
  let roundResult = '';
  let roundStartTimer = 3;
  let roundNumber = 1;
  const p1Wins = [false, false, false];
  const p2Wins = [false, false, false];

  // ── HUD ──
  const hud = document.getElementById('ui-overlay');

  const hudContainer = document.createElement('div');
  hudContainer.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:1000;font-family:sans-serif;pointer-events:none;';

  // Health bars
  const barsContainer = document.createElement('div');
  barsContainer.style.cssText = 'display:flex;justify-content:center;align-items:flex-start;padding:16px 30px 0;gap:16px;';
  barsContainer.innerHTML = `
    <div style="flex:1;max-width:400px;">
      <div style="font-size:13px;color:#e74c3c;font-weight:700;margin-bottom:4px;text-shadow:0 0 8px #000;">PLAYER 1</div>
      <div style="position:relative;height:22px;background:#1a1a1a;border:2px solid #e74c3c;border-radius:3px;overflow:hidden;">
        <div id="hud-hp-p1" style="width:100%;height:100%;background:linear-gradient(90deg,#e74c3c,#ff6b6b);transition:width 0.2s;"></div>
        <div id="hud-hp-p1-text" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:700;text-shadow:0 1px 2px #000;">100 / 100</div>
      </div>
      <div style="position:relative;height:8px;background:#111;border:1px solid #f39c12;border-radius:2px;margin-top:3px;overflow:hidden;">
        <div id="hud-sp-p1" style="width:0%;height:100%;background:linear-gradient(90deg,#f39c12,#ffcc00);transition:width 0.15s;"></div>
      </div>
    </div>
    <div style="text-align:center;min-width:70px;">
      <div id="hud-timer" style="font-size:32px;color:#ffd700;font-weight:900;text-shadow:0 0 12px #000;line-height:1;">99</div>
      <div id="hud-round" style="font-size:11px;color:#aaa;margin-top:2px;">ROUND 1</div>
      <div style="display:flex;gap:4px;justify-content:center;margin-top:4px;">
        <div id="hud-w1-p1" style="width:10px;height:10px;border-radius:50%;border:1px solid #e74c3c;background:transparent;"></div>
        <div id="hud-w2-p1" style="width:10px;height:10px;border-radius:50%;border:1px solid #e74c3c;background:transparent;"></div>
        <div style="width:8px;"></div>
        <div id="hud-w1-p2" style="width:10px;height:10px;border-radius:50%;border:1px solid #3498db;background:transparent;"></div>
        <div id="hud-w2-p2" style="width:10px;height:10px;border-radius:50%;border:1px solid #3498db;background:transparent;"></div>
      </div>
    </div>
    <div style="flex:1;max-width:400px;">
      <div style="font-size:13px;color:#3498db;font-weight:700;margin-bottom:4px;text-align:right;text-shadow:0 0 8px #000;">PLAYER 2</div>
      <div style="position:relative;height:22px;background:#1a1a1a;border:2px solid #3498db;border-radius:3px;overflow:hidden;">
        <div id="hud-hp-p2" style="width:100%;height:100%;background:linear-gradient(270deg,#3498db,#5dade2);transition:width 0.2s;float:right;"></div>
        <div id="hud-hp-p2-text" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:700;text-shadow:0 1px 2px #000;">100 / 100</div>
      </div>
      <div style="position:relative;height:8px;background:#111;border:1px solid #9b59b6;border-radius:2px;margin-top:3px;overflow:hidden;">
        <div id="hud-sp-p2" style="width:0%;height:100%;background:linear-gradient(270deg,#9b59b6,#c39bd3);transition:width 0.15s;float:right;"></div>
      </div>
    </div>
  `;
  hudContainer.appendChild(barsContainer);

  // Combo display
  const comboEl = document.createElement('div');
  comboEl.id = 'hud-combo';
  comboEl.style.cssText = 'position:fixed;top:120px;left:50%;transform:translateX(-50%);font-size:28px;color:#ffd700;font-weight:900;text-shadow:0 0 16px #ff8800;opacity:0;transition:opacity 0.2s;pointer-events:none;z-index:1001;';
  hudContainer.appendChild(comboEl);

  // Round announcement
  const announceEl = document.createElement('div');
  announceEl.id = 'hud-announce';
  announceEl.style.cssText = 'position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);font-size:48px;color:#fff;font-weight:900;text-shadow:0 0 30px #ff4400,0 0 60px #ff0000;pointer-events:none;z-index:1002;';
  announceEl.textContent = 'ROUND 1';
  hudContainer.appendChild(announceEl);

  // Stand indicator
  const standIndicator = document.createElement('div');
  standIndicator.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);display:flex;gap:40px;font-size:12px;font-weight:600;pointer-events:none;z-index:1001;';
  standIndicator.innerHTML = `
    <div id="hud-stand-p1" style="color:#f39c12;opacity:0.3;text-shadow:0 0 8px #000;">⭐ STAND OFF</div>
    <div id="hud-stand-p2" style="color:#9b59b6;opacity:0.3;text-shadow:0 0 8px #000;">STAND OFF ⭐</div>
  `;
  hudContainer.appendChild(standIndicator);

  // Controls hint
  const hintEl = document.createElement('div');
  hintEl.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);color:#666;font-size:10px;text-align:center;pointer-events:none;z-index:1001;';
  hintEl.textContent = 'P1: A/D Move, W Jump, J/K/L Attack, U Stand, S Block  |  P2: Arrows, Num1/2/3 Attack, Num0 Stand, ↓ Block';
  hudContainer.appendChild(hintEl);

  hud?.appendChild(hudContainer);

  // ── Helper functions ──
  const updateHud = () => {
    const hp1 = document.getElementById('hud-hp-p1');
    const hp1t = document.getElementById('hud-hp-p1-text');
    const hp2 = document.getElementById('hud-hp-p2');
    const hp2t = document.getElementById('hud-hp-p2-text');
    const sp1 = document.getElementById('hud-sp-p1');
    const sp2 = document.getElementById('hud-sp-p2');
    const timer = document.getElementById('hud-timer');
    const round = document.getElementById('hud-round');
    const combo = document.getElementById('hud-combo');
    const stand1 = document.getElementById('hud-stand-p1');
    const stand2 = document.getElementById('hud-stand-p2');

    if (hp1) hp1.style.width = `${Math.max(0, p1.hp / p1.maxHp * 100)}%`;
    if (hp1t) hp1t.textContent = `${Math.max(0, Math.ceil(p1.hp))} / ${p1.maxHp}`;
    if (hp2) hp2.style.width = `${Math.max(0, p2.hp / p2.maxHp * 100)}%`;
    if (hp2t) hp2t.textContent = `${Math.max(0, Math.ceil(p2.hp))} / ${p2.maxHp}`;
    if (sp1) sp1.style.width = `${Math.min(100, p1.specialMeter)}%`;
    if (sp2) sp2.style.width = `${Math.min(100, p2.specialMeter)}%`;
    if (timer) timer.textContent = `${Math.max(0, Math.ceil(roundTimer))}`;
    if (round) round.textContent = `ROUND ${roundNumber}`;

    // Combo display
    const maxCombo = Math.max(p1.comboCount, p2.comboCount);
    if (combo) {
      if (maxCombo >= 2) {
        combo.style.opacity = '1';
        combo.textContent = `${maxCombo} HIT COMBO!`;
      } else {
        combo.style.opacity = '0';
      }
    }

    if (stand1) {
      stand1.textContent = p1.standActive ? '⭐ STAND ON' : '⭐ STAND OFF';
      stand1.style.opacity = p1.standActive ? '1' : '0.3';
    }
    if (stand2) {
      stand2.textContent = p2.standActive ? 'STAND ON ⭐' : 'STAND OFF ⭐';
      stand2.style.opacity = p2.standActive ? '1' : '0.3';
    }

    // Win indicators
    for (let i = 0; i < 2; i++) {
      const w1 = document.getElementById(`hud-w${i+1}-p1`);
      const w2 = document.getElementById(`hud-w${i+1}-p2`);
      if (w1) w1.style.background = p1Wins[i] ? '#e74c3c' : 'transparent';
      if (w2) w2.style.background = p2Wins[i] ? '#3498db' : 'transparent';
    }
  };

  const doAttack = (attacker: Fighter, defender: Fighter, delta: number) => {
    const dist = Math.abs(attacker.x - defender.x);
    const range = attacker.standActive ? ATTACK_RANGE + 1.0 : ATTACK_RANGE;

    if (dist > range) return;
    if (defender.hitCooldown > 0) return;

    let damage = 0;
    let knockback = 0;
    let stunDuration = 0;

    switch (attacker.attackType) {
      case 'light':
        damage = LIGHT_DMG;
        knockback = 1.5;
        stunDuration = 0.15;
        break;
      case 'heavy':
        damage = HEAVY_DMG;
        knockback = 3;
        stunDuration = 0.35;
        break;
      case 'special':
        damage = SPECIAL_DMG;
        knockback = 5;
        stunDuration = 0.5;
        break;
      case 'stand-barrage':
        damage = BARRAGE_DMG;
        knockback = 0.3;
        stunDuration = 0.08;
        break;
    }

    if (defender.blocking) {
      damage *= 0.15;
      knockback *= 0.3;
      stunDuration *= 0.2;
    }

    defender.hp -= damage;
    attacker.specialMeter = Math.min(100, attacker.specialMeter + damage * 0.6);
    defender.specialMeter = Math.min(100, defender.specialMeter + damage * 0.3);

    const dir = attacker.x < defender.x ? 1 : -1;
    defender.x += knockback * dir;
    defender.x = Math.max(ARENA_LEFT, Math.min(ARENA_RIGHT, defender.x));
    defender.hitCooldown = 0.2;
    defender.stunTimer = Math.max(defender.stunTimer, stunDuration);

    // Combo tracking
    attacker.comboCount++;
    attacker.comboTimer = 1.5;
  };

  const updateFighter = (f: Fighter, opponent: Fighter, delta: number, input: InputManager,
    keys: { left: string; right: string; jump: string; light: string; heavy: string; special: string; stand: string; block: string }) => {
    if (roundStartTimer > 0 || roundOver) return;
    if (f.stunTimer > 0) { f.stunTimer -= delta; return; }

    // ── Movement ──
    f.blocking = input.isKeyDown(keys.block);

    if (!f.blocking && f.attackTimer <= 0) {
      let moveX = 0;
      if (input.isKeyDown(keys.left)) moveX -= 1;
      if (input.isKeyDown(keys.right)) moveX += 1;
      f.x += moveX * MOVE_SPEED * delta;
      f.x = Math.max(ARENA_LEFT, Math.min(ARENA_RIGHT, f.x));
    }

    // Jump
    if (f.grounded && input.isKeyJustPressed(keys.jump) && !f.blocking) {
      f.vy = JUMP_FORCE;
      f.grounded = false;
    }

    // Gravity
    f.vy -= GRAVITY * delta;
    f.y += f.vy * delta;
    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
      f.grounded = true;
    }

    // ── Facing ──
    f.facingRight = f.x < opponent.x;

    // ── Attacks ──
    if (f.attackTimer > 0) {
      f.attackTimer -= delta;
      if (f.attackTimer <= 0) {
        f.attackType = '';
      }
    }

    if (f.attackTimer <= 0 && !f.blocking) {
      if (input.isKeyJustPressed(keys.light)) {
        f.attackType = 'light';
        f.attackTimer = 0.25;
        doAttack(f, opponent, delta);
      } else if (input.isKeyJustPressed(keys.heavy)) {
        f.attackType = 'heavy';
        f.attackTimer = 0.45;
        doAttack(f, opponent, delta);
      } else if (input.isKeyJustPressed(keys.special) && f.specialMeter >= 50) {
        f.attackType = 'special';
        f.attackTimer = 0.6;
        f.specialMeter -= 50;
        doAttack(f, opponent, delta);
      }
    }

    // ── Stand Barrage (while Stand is active, rapid auto-attacks) ──
    if (f.standActive && f.attackTimer <= 0 && (input.isKeyDown(keys.light) || input.isKeyDown(keys.heavy))) {
      f.attackType = 'stand-barrage';
      f.attackTimer = 0.07;
      doAttack(f, opponent, delta);
    }

    // ── Stand toggle ──
    if (input.isKeyJustPressed(keys.stand)) {
      f.standActive = !f.standActive;
    }

    // ── Cooldowns ──
    if (f.hitCooldown > 0) f.hitCooldown -= delta;
    if (f.comboTimer > 0) {
      f.comboTimer -= delta;
      if (f.comboTimer <= 0) f.comboCount = 0;
    }

    // Passive meter gain
    f.specialMeter = Math.min(100, f.specialMeter + delta * 3);
  };

  const updateFighterVisuals = (f: Fighter, elapsed: number) => {
    f.mesh.position.set(f.x, f.y, 0);
    const group = f.mesh.children[0] as THREE.Group;
    group.rotation.y = f.facingRight ? 0 : Math.PI;

    // Attack animation
    const rightArm = group.getObjectByName('RightArm');
    const leftArm = group.getObjectByName('LeftArm');
    const rightLeg = group.getObjectByName('RightLeg');
    const leftLeg = group.getObjectByName('LeftLeg');

    if (f.attackTimer > 0) {
      const punchExtend = f.facingRight ? 0.6 : -0.6;
      if (rightArm) {
        rightArm.position.z = punchExtend * (f.attackTimer * 4);
        rightArm.position.y = 1.5 + (f.attackType === 'heavy' ? 0.3 : 0);
      }
    } else {
      if (rightArm) { rightArm.position.z = 0; rightArm.position.y = 1.5; }
    }

    // Idle bob
    if (f.grounded && f.attackTimer <= 0) {
      const bob = Math.sin(elapsed * 4) * 0.05;
      if (leftArm) leftArm.position.y = 1.5 + bob;
      if (rightArm) rightArm.position.y = 1.5 - bob;
    }

    // Walking legs
    if (f.grounded) {
      const legSwing = Math.sin(elapsed * 8) * 0.2;
      if (leftLeg) leftLeg.position.z = legSwing;
      if (rightLeg) rightLeg.position.z = -legSwing;
    }

    // Blocking visual
    if (f.blocking) {
      if (leftArm) leftArm.position.z = f.facingRight ? -0.3 : 0.3;
      if (rightArm) rightArm.position.z = f.facingRight ? -0.3 : 0.3;
    }

    // Stun flash
    if (f.stunTimer > 0) {
      f.mesh.visible = Math.floor(f.stunTimer * 20) % 2 === 0;
    } else {
      f.mesh.visible = true;
    }

    // Stand
    if (f.standActive) {
      const standDir = f.facingRight ? 1 : -1;
      f.standMesh.visible = true;
      f.standMesh.position.set(f.x + standDir * STAND_OFFSET, f.y + 0.2, -0.5);
      const sGroup = f.standMesh.children[0] as THREE.Group;
      sGroup.rotation.y = f.facingRight ? 0 : Math.PI;

      // Stand barrage animation
      if (f.attackType === 'stand-barrage') {
        const sLeftArm = sGroup.getObjectByName('StandLeftArm');
        const sRightArm = sGroup.getObjectByName('StandRightArm');
        const fistPos = Math.sin(elapsed * 40) * 0.8;
        if (sLeftArm) sLeftArm.position.z = fistPos;
        if (sRightArm) sRightArm.position.z = -fistPos;
      } else {
        const sLeftArm = sGroup.getObjectByName('StandLeftArm');
        const sRightArm = sGroup.getObjectByName('StandRightArm');
        if (sLeftArm) sLeftArm.position.z = 0;
        if (sRightArm) sRightArm.position.z = 0;
      }

      // Menacing float
      f.standMesh.position.y += Math.sin(elapsed * 3) * 0.08;
    } else {
      f.standMesh.visible = false;
    }
  };

  const resetRound = () => {
    p1.hp = p1.maxHp; p1.x = -5; p1.y = 0; p1.vy = 0; p1.grounded = true;
    p1.standActive = false; p1.blocking = false; p1.attackTimer = 0; p1.attackType = '';
    p1.hitCooldown = 0; p1.comboCount = 0; p1.comboTimer = 0; p1.stunTimer = 0;
    p1.specialMeter = 0;

    p2.hp = p2.maxHp; p2.x = 5; p2.y = 0; p2.vy = 0; p2.grounded = true;
    p2.standActive = false; p2.blocking = false; p2.attackTimer = 0; p2.attackType = '';
    p2.hitCooldown = 0; p2.comboCount = 0; p2.comboTimer = 0; p2.stunTimer = 0;
    p2.specialMeter = 0;

    roundTimer = 99;
    roundOver = false;
    roundResult = '';
    roundStartTimer = 2.5;
  };

  // ── Main Update ──
  const updateFn = (delta: number, elapsed: number) => {
    if (engine.editorActive) {
      hudContainer.style.display = 'none';
      return;
    }
    hudContainer.style.display = '';

    const input = engine.input;

    // Round start countdown
    if (roundStartTimer > 0) {
      roundStartTimer -= delta;
      const announce = document.getElementById('hud-announce');
      if (announce) {
        if (roundStartTimer > 1.5) {
          announce.textContent = `ROUND ${roundNumber}`;
          announce.style.opacity = '1';
        } else if (roundStartTimer > 0.5) {
          announce.textContent = 'FIGHT!';
          announce.style.color = '#ff4400';
        } else {
          announce.style.opacity = `${Math.max(0, roundStartTimer * 2)}`;
        }
      }
      updateFighterVisuals(p1, elapsed);
      updateFighterVisuals(p2, elapsed);
      updateHud();
      return;
    }

    // Round end
    if (roundOver) {
      const announce = document.getElementById('hud-announce');
      if (announce) {
        announce.textContent = roundResult;
        announce.style.opacity = '1';
        announce.style.color = '#ffd700';
      }

      // R to restart
      if (input.isKeyJustPressed('r')) {
        roundNumber++;
        if (roundNumber > 3) {
          roundNumber = 1;
          p1Wins.fill(false);
          p2Wins.fill(false);
        }
        resetRound();
      }

      updateFighterVisuals(p1, elapsed);
      updateFighterVisuals(p2, elapsed);
      updateHud();
      return;
    }

    // Timer countdown
    roundTimer -= delta;

    // Update fighters
    updateFighter(p1, p2, delta, input, {
      left: 'a', right: 'd', jump: 'w', light: 'j', heavy: 'k',
      special: 'l', stand: 'u', block: 's',
    });
    updateFighter(p2, p1, delta, input, {
      left: 'arrowleft', right: 'arrowright', jump: 'arrowup',
      light: '1', heavy: '2', special: '3', stand: '0', block: 'arrowdown',
    });

    // Visuals
    updateFighterVisuals(p1, elapsed);
    updateFighterVisuals(p2, elapsed);

    // Dynamic camera
    const centerX = (p1.x + p2.x) / 2;
    const dist = Math.abs(p1.x - p2.x);
    const camZ = Math.max(10, 8 + dist * 0.5);
    const camY = 3 + Math.max(p1.y, p2.y) * 0.5;
    engine.camera.position.lerp(new THREE.Vector3(centerX * 0.6, camY, camZ), 0.08);
    engine.camera.lookAt(centerX * 0.6, 2 + Math.max(p1.y, p2.y) * 0.3, 0);

    // Spot lights track fighters
    spotL.target.position.set(p1.x, 0, 0);
    spotR.target.position.set(p2.x, 0, 0);

    // Check round end
    if (p1.hp <= 0 || p2.hp <= 0 || roundTimer <= 0) {
      roundOver = true;
      if (p1.hp <= 0) {
        roundResult = 'PLAYER 2 WINS!';
        p2Wins[roundNumber - 1] = true;
      } else if (p2.hp <= 0) {
        roundResult = 'PLAYER 1 WINS!';
        p1Wins[roundNumber - 1] = true;
      } else {
        // Time up — player with more HP wins
        if (p1.hp > p2.hp) { roundResult = 'PLAYER 1 WINS!'; p1Wins[roundNumber - 1] = true; }
        else if (p2.hp > p1.hp) { roundResult = 'PLAYER 2 WINS!'; p2Wins[roundNumber - 1] = true; }
        else { roundResult = 'DRAW!'; }
      }
    }

    updateHud();
  };

  return {
    updateFn,
    helpText: 'P1: A/D Move, W Jump, J/K/L Attack, U Stand, S Block | P2: Arrows, Num1/2/3, Num0 Stand, ↓ Block | R: Next Round | F9: Editor',
  };
}

// ═══════════════════════════════════════════════════════════════════
//  RACING TEMPLATE
// ═══════════════════════════════════════════════════════════════════

const SCRIPT_PLAYER_CAR = `-- Player Car Controller
-- Handles acceleration, braking, steering, and lap counting.
-- Use WASD or Arrow Keys to drive. Hit all checkpoints to complete a lap.
local speed = 0
local maxSpeed = 30
local accel = 18
local brakeForce = 24
local steerRate = 2.2
local drag = 0.96

function onUpdate(dt)
  local fwd = input.isKeyDown("w") or input.isKeyDown("arrowup")
  local bwd = input.isKeyDown("s") or input.isKeyDown("arrowdown")
  local left = input.isKeyDown("a") or input.isKeyDown("arrowleft")
  local right = input.isKeyDown("d") or input.isKeyDown("arrowright")
  if fwd then speed = math.min(speed + accel * dt, maxSpeed)
  elseif bwd then speed = math.max(speed - brakeForce * dt, -maxSpeed * 0.4)
  else speed = speed * math.pow(drag, dt * 60) end
  if math.abs(speed) > 0.5 then
    local steer = 0
    if left then steer = steerRate * dt end
    if right then steer = -steerRate * dt end
    self.rotation.y = self.rotation.y + steer * (speed / maxSpeed)
  end
  local dir = vec3(math.sin(self.rotation.y), 0, math.cos(self.rotation.y))
  self.position = self.position + dir * speed * dt
end`;

const SCRIPT_AI_RACER = `-- AI Racer
-- Follows waypoints around the track and avoids the player.
-- Controlled by the racing engine; edit speed and aggression below.
local waypointIndex = 0
local speed = 14
local turnRate = 1.8
local aggression = 0.5

function onUpdate(dt)
  -- seek next waypoint; racing system injects waypoints table
  local target = waypoints and waypoints[waypointIndex + 1]
  if target then
    local dx = target.x - self.position.x
    local dz = target.z - self.position.z
    local dist = math.sqrt(dx*dx + dz*dz)
    if dist < 3 then waypointIndex = (waypointIndex + 1) % #waypoints end
    local angle = math.atan2(dx, dz)
    local da = angle - self.rotation.y
    self.rotation.y = self.rotation.y + da * turnRate * dt
    local dir = vec3(math.sin(self.rotation.y), 0, math.cos(self.rotation.y))
    self.position = self.position + dir * speed * dt
  end
end`;

const SCRIPT_CHECKPOINT = `-- Checkpoint Gate
-- Registers the player car passing through this gate.
-- Order property determines lap counting sequence.
local triggered = false
local cooldown = 0

function onUpdate(dt)
  cooldown = math.max(0, cooldown - dt)
  if cooldown > 0 then triggered = false end
end

function onTriggerEnter(other)
  if other.tag == "PlayerCar" and not triggered then
    triggered = true
    cooldown = 2
    events.emit("checkpoint_hit", { id = self.userData.order })
  end
end`;

const SCRIPT_BOOST_PAD = `-- Speed Boost Pad
-- Gives the car a temporary speed burst when driven over.
local cooldown = 0
local boostStr = 15

function onUpdate(dt) cooldown = math.max(0, cooldown - dt) end

function onTriggerEnter(other)
  if other.tag == "PlayerCar" and cooldown == 0 then
    cooldown = 3
    physics.addImpulse(other, vec3(0,0,boostStr) * other.forward)
    events.emit("boost_triggered", { pad = self.name })
  end
end`;

function setupRacing(engine: Engine, scene: THREE.Scene): TemplateResult {
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 60, 200);

  // ── Lighting ──
  const sun = new THREE.DirectionalLight(0xfff0cc, 1.8);
  sun.name = 'RaceSun';
  sun.position.set(30, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  scene.add(sun);

  const sky = new THREE.AmbientLight(0x88aacc, 0.7);
  sky.name = 'RaceSkyLight';
  scene.add(sky);

  // ── Ground ──
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x3a7a3a, roughness: 0.9 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300, 1, 1), groundMat);
  ground.name = 'RaceGround';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.isCollider = true;
  scene.add(ground);

  // ── Road Surface (oval track approximated with straight + curved segments) ──
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.7 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffaa, roughness: 0.6 });
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.5 });

  // Two long straights + connecting short cross segments → simple rectangular loop
  // Straight A (South): Z = -40 to +40, X ≈ -15 (left lane) to +15 (right lane)
  const TRACK_HALF = 11; // half-width of road
  const straights: [number, number, number, number, number][] = [
    // x, y, z, lengthZ, lengthX
    [0, 0, 0, 90, 22],   // South straight  (Z: -45..+45)
  ];

  // Main oval segments (manual box track)
  const trackSegments: Array<{ x: number; z: number; rx: number; rz: number; ry?: number }> = [
    { x: 0, z: 0, rx: 22, rz: 90 },        // Centre straight (Z axis)
    { x: 50, z: 0, rx: 22, rz: 90 },       // Outer straight
    { x: 25, z: 44, rx: 52, rz: 22 },      // Top cross
    { x: 25, z: -44, rx: 52, rz: 22 },     // Bottom cross
  ];

  trackSegments.forEach((seg, i) => {
    const road = new THREE.Mesh(new THREE.BoxGeometry(seg.rx, 0.15, seg.rz), roadMat);
    road.name = `TrackSegment_${i}`;
    road.position.set(seg.x, 0.08, seg.z);
    road.receiveShadow = true;
    road.userData.isCollider = true;
    scene.add(road);
  });

  // Centre dashed line on main straight
  for (let z = -40; z <= 40; z += 8) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 3.5), lineMat);
    dash.position.set(0, 0.09, z);
    scene.add(dash);
  }

  // Start/Finish line
  const startLineMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const startLine = new THREE.Mesh(new THREE.BoxGeometry(22, 0.18, 1.5), startLineMat);
  startLine.name = 'StartLine';
  startLine.position.set(0, 0.09, -42);
  startLine.userData.__luaScript = `-- Start / Finish Line\n-- Detects when the player crosses to record lap times.\nfunction onTriggerEnter(other)\n  if other.tag == "PlayerCar" then\n    events.emit("lap_complete", { time = game.time })\n  end\nend`;
  scene.add(startLine);

  // ── Checkpoints ──
  const checkpointPositions: Array<[number, number]> = [
    [0, 0],        // Checkpoint_0 — mid straight
    [25, 44],      // Checkpoint_1 — top curve
    [50, 0],       // Checkpoint_2 — outer straight
    [25, -44],     // Checkpoint_3 — bottom curve
  ];

  checkpointPositions.forEach(([cpX, cpZ], i) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffcc00, emissiveIntensity: 0.5 }));
    post.name = `Checkpoint_${i}`;
    post.position.set(cpX, 2, cpZ);
    post.castShadow = true;
    post.userData.order = i;
    post.userData.__luaScript = SCRIPT_CHECKPOINT;
    scene.add(post);
    // Arch crossbeam
    const beam = new THREE.Mesh(new THREE.BoxGeometry(22, 0.4, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffcc00, emissiveIntensity: 0.3 }));
    beam.position.set(cpX, 4, cpZ);
    scene.add(beam);
  });

  // ── Boost Pads ──
  const boostPositions: Array<[number, number]> = [[0, 30], [50, -20]];
  boostPositions.forEach(([bx, bz], i) => {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 3),
      new THREE.MeshStandardMaterial({ color: 0x00aaff, emissive: 0x0066ff, emissiveIntensity: 0.7, transparent: true, opacity: 0.85 }));
    pad.name = `BoostPad_${i}`;
    pad.position.set(bx, 0.1, bz);
    pad.userData.__luaScript = SCRIPT_BOOST_PAD;
    scene.add(pad);
  });

  // ── Pit Stop ──
  const pitMat = new THREE.MeshStandardMaterial({ color: 0x555566, roughness: 0.5 });
  const pitStop = new THREE.Mesh(new THREE.BoxGeometry(10, 0.2, 6), pitMat);
  pitStop.name = 'PitStop';
  pitStop.position.set(-18, 0.1, 0);
  pitStop.userData.__luaScript = `-- Pit Stop\n-- Refuels and repairs the player car when it parks here.\nfunction onTriggerEnter(other)\n  if other.tag == "PlayerCar" then\n    events.emit("pit_repair", { car = other.name })\n  end\nend`;
  scene.add(pitStop);

  // Pit wall
  const pitWall = new THREE.Mesh(new THREE.BoxGeometry(10, 1.5, 0.5), pitMat);
  pitWall.name = 'PitWall';
  pitWall.position.set(-18, 0.75, 3);
  pitWall.castShadow = true;
  scene.add(pitWall);

  // ── Barriers ──
  const barrierPositions: Array<[number, number, number, number]> = [
    [-12, 0.5, 0, 90],   // inner left long
    [12, 0.5, 0, 90],    // inner right long
    [-12, 0.5, 44, 50],  // inner top
    [-12, 0.5, -44, 50], // inner bottom
  ];
  barrierPositions.forEach(([bx, by, bz, len], i) => {
    const isLong = len > 70;
    const barrier = new THREE.Mesh(
      new THREE.BoxGeometry(isLong ? 1 : len, 1, isLong ? len : 1),
      barrierMat,
    );
    barrier.name = `Barrier_${i}`;
    barrier.position.set(bx, by, bz);
    barrier.castShadow = true;
    scene.add(barrier);
  });

  // ── Grandstand Bleachers ──
  const standMat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.7 });
  for (let i = 0; i < 4; i++) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(6, 2 + i * 0.8, 3), standMat);
    stand.name = `Grandstand_${i}`;
    stand.position.set(-22 + i * 3, (2 + i * 0.8) / 2, -30 + i * 2);
    stand.castShadow = true;
    stand.receiveShadow = true;
    scene.add(stand);
  }

  // ── Player Car ──
  const carMat = new THREE.MeshStandardMaterial({ color: 0xff4400, roughness: 0.3, metalness: 0.6 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });

  const carBody = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 4.0), carMat);
  carBody.name = 'Car_Player';
  carBody.position.set(0, 0.6, -42);
  carBody.castShadow = true;
  carBody.userData.tag = 'PlayerCar';
  carBody.userData.__luaScript = SCRIPT_PLAYER_CAR;
  scene.add(carBody);

  // Spoiler
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 0.6), carMat);
  spoiler.position.set(0, 1.0, 1.7);
  carBody.add(spoiler);

  // Wheels
  [[1.3, 0, 1.4], [-1.3, 0, 1.4], [1.3, 0, -1.4], [-1.3, 0, -1.4]].forEach(([wx, wy, wz], i) => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 10), wheelMat);
    wheel.name = `Wheel_${i}`;
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, wy, wz);
    carBody.add(wheel);
  });

  // ── AI Car ──
  const aiMat = new THREE.MeshStandardMaterial({ color: 0x2255cc, roughness: 0.3, metalness: 0.5 });
  const aiCar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 4.0), aiMat);
  aiCar.name = 'AICar_0';
  aiCar.position.set(3, 0.6, -42);
  aiCar.castShadow = true;
  aiCar.userData.tag = 'AICar';
  aiCar.userData.__luaScript = SCRIPT_AI_RACER;
  scene.add(aiCar);

  [[1.3, 0, 1.4], [-1.3, 0, 1.4], [1.3, 0, -1.4], [-1.3, 0, -1.4]].forEach(([wx, wy, wz], i) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 10), wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, wy, wz);
    aiCar.add(w);
  });

  // ── Camera ──
  engine.camera.position.set(0, 8, -52);
  engine.camera.lookAt(0, 0, -42);

  // ── HUD ──
  const hud = document.getElementById('ui-overlay');
  const hudDiv = document.createElement('div');
  hudDiv.id = 'racing-hud';
  hudDiv.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;z-index:1000;font-family:monospace;';
  hudDiv.innerHTML = `
    <div style="display:flex;gap:24px;align-items:center;">
      <div style="background:rgba(0,0,0,0.7);padding:4px 16px;border-radius:8px;color:#ffd700;font-size:18px;font-weight:700;border:2px solid #ffd700;">LAP <span id="hud-lap">1</span>/3</div>
      <div style="background:rgba(0,0,0,0.7);padding:4px 16px;border-radius:8px;color:#fff;font-size:18px;font-weight:700;">⏱ <span id="hud-laptime">0.00</span>s</div>
      <div style="background:rgba(0,0,0,0.7);padding:4px 16px;border-radius:8px;color:#00aaff;font-size:18px;font-weight:700;">🏁 <span id="hud-place">1st</span></div>
    </div>
    <div style="background:rgba(0,0,0,0.7);padding:4px 20px;border-radius:8px;color:#ff4400;font-size:22px;font-weight:900;"><span id="hud-speed">0</span> <span style="font-size:13px;color:#aaa;">km/h</span></div>
    <div style="color:#888;font-size:10px;">WASD / Arrows: Drive | R: Reset | F9: Editor</div>
  `;
  hud?.appendChild(hudDiv);

  // ── Runtime State ──
  let carSpeed = 0;
  let carAngle = 0;
  const carPos = { x: 0, z: -42 };
  const initialCarPos = { x: 0, z: -42 };
  const MAX_SPEED = 30;
  const ACCEL = 18;
  const BRAKE = 26;
  const STEER = 2.1;
  const DRAG = 0.97;

  // AI state
  const aiWaypoints = checkpointPositions.map(([x, z]) => ({ x, z }));
  let aiWpIndex = 0;
  const aiPos = { x: 3, z: -42 };
  const initialAiPos = { x: 3, z: -42 };
  let aiAngle = 0;
  const AI_SPEED = 13;

  // Lap / checkpoint tracking
  let currentLap = 1;
  let lapTime = 0;
  let nextCheckpoint = 0;
  const TOTAL_LAPS = 3;
  const initialCamera = {
    x: 0,
    y: 8,
    z: -52,
    lookX: 0,
    lookY: 0,
    lookZ: -42,
  };

  const updateHudRacing = (speed: number) => {
    const lapEl = document.getElementById('hud-lap');
    const timeEl = document.getElementById('hud-laptime');
    const speedEl = document.getElementById('hud-speed');
    if (lapEl) lapEl.textContent = `${Math.min(currentLap, TOTAL_LAPS)}`;
    if (timeEl) timeEl.textContent = lapTime.toFixed(2);
    if (speedEl) speedEl.textContent = `${Math.abs(Math.round(speed * 3.6))}`;
  };

  const updateFn = (delta: number, _elapsed: number) => {
    if (engine.editorActive) return;

    const input = engine.input;

    // Player car physics
    const fwd = input.isKeyDown('w') || input.isKeyDown('arrowup');
    const bwd = input.isKeyDown('s') || input.isKeyDown('arrowdown');
    const left = input.isKeyDown('a') || input.isKeyDown('arrowleft');
    const right = input.isKeyDown('d') || input.isKeyDown('arrowright');

    if (fwd) carSpeed = Math.min(carSpeed + ACCEL * delta, MAX_SPEED);
    else if (bwd) carSpeed = Math.max(carSpeed - BRAKE * delta, -MAX_SPEED * 0.4);
    else carSpeed *= Math.pow(DRAG, delta * 60);

    if (Math.abs(carSpeed) > 0.3) {
      const steer = (left ? 1 : 0) - (right ? 1 : 0);
      carAngle += steer * STEER * delta * (carSpeed / MAX_SPEED);
    }

    carPos.x += Math.sin(carAngle) * carSpeed * delta;
    carPos.z += Math.cos(carAngle) * carSpeed * delta;

    carBody.position.set(carPos.x, 0.6, carPos.z);
    carBody.rotation.y = carAngle;

    // Checkpoint detection (simple radius check on Checkpoint_0)
    const cp = checkpointPositions[nextCheckpoint];
    const dx = carPos.x - cp[0];
    const dz = carPos.z - cp[1];
    if (Math.sqrt(dx * dx + dz * dz) < 6) {
      nextCheckpoint = (nextCheckpoint + 1) % checkpointPositions.length;
      if (nextCheckpoint === 0) {
        currentLap++;
        lapTime = 0;
      }
    }

    lapTime += delta;

    // AI car simple waypoint following
    const wpTarget = aiWaypoints[aiWpIndex];
    const adx = wpTarget.x - aiPos.x;
    const adz = wpTarget.z - aiPos.z;
    const aDist = Math.sqrt(adx * adx + adz * adz);
    if (aDist < 5) aiWpIndex = (aiWpIndex + 1) % aiWaypoints.length;

    const targetAngle = Math.atan2(adx, adz);
    let da = targetAngle - aiAngle;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    aiAngle += da * 2.0 * delta;

    aiPos.x += Math.sin(aiAngle) * AI_SPEED * delta;
    aiPos.z += Math.cos(aiAngle) * AI_SPEED * delta;
    aiCar.position.set(aiPos.x, 0.6, aiPos.z);
    aiCar.rotation.y = aiAngle;

    // Chase camera
    const camDist = 12;
    const camHeight = 4;
    const targetCamX = carPos.x - Math.sin(carAngle) * camDist;
    const targetCamZ = carPos.z - Math.cos(carAngle) * camDist;
    engine.camera.position.x += (targetCamX - engine.camera.position.x) * 6 * delta;
    engine.camera.position.y += (camHeight - engine.camera.position.y) * 6 * delta;
    engine.camera.position.z += (targetCamZ - engine.camera.position.z) * 6 * delta;
    engine.camera.lookAt(carPos.x, 0.6, carPos.z);

    updateHudRacing(carSpeed);
  };

  const resetState = () => {
    carSpeed = 0;
    carAngle = 0;
    carPos.x = initialCarPos.x;
    carPos.z = initialCarPos.z;
    carBody.position.set(carPos.x, 0.6, carPos.z);
    carBody.rotation.set(0, 0, 0);

    aiWpIndex = 0;
    aiAngle = 0;
    aiPos.x = initialAiPos.x;
    aiPos.z = initialAiPos.z;
    aiCar.position.set(aiPos.x, 0.6, aiPos.z);
    aiCar.rotation.set(0, 0, 0);

    currentLap = 1;
    lapTime = 0;
    nextCheckpoint = 0;

    engine.camera.position.set(initialCamera.x, initialCamera.y, initialCamera.z);
    engine.camera.lookAt(initialCamera.lookX, initialCamera.lookY, initialCamera.lookZ);

    updateHudRacing(0);
    const placeEl = document.getElementById('hud-place');
    if (placeEl) placeEl.textContent = '1st';
  };

  (updateFn as typeof updateFn & { resetState?: () => void }).resetState = resetState;

  return {
    updateFn,
    helpText: 'WASD / Arrows: Drive | Collect all Checkpoints each lap | 3 Laps to win | F9: Editor',
  };
}

// ═══════════════════════════════════════════════════════════════════
//  PUZZLE / ADVENTURE TEMPLATE
// ═══════════════════════════════════════════════════════════════════

const SCRIPT_PRESSURE_PLATE = `-- Pressure Plate
-- Activates when the player steps on it; holds while weight is present.
-- Connect to a Puzzle Door via events.
local pressed = false
local TRIGGER_RADIUS = 1.5

function onUpdate(dt)
  local dist = vec3.distance(player.position, self.position)
  local newPressed = dist < TRIGGER_RADIUS
  if newPressed ~= pressed then
    pressed = newPressed
    events.emit("pressure_plate", { id = self.userData.plateId, active = pressed })
  end
end`;

const SCRIPT_PUZZLE_DOOR = `-- Puzzle Door
-- Opens when all linked pressure plates are active.
-- Set linkedPlates to a list of plate IDs that must be active.
local open = false
local activePlates = {}
local OPEN_SPEED = 2.5

function onEvent(name, data)
  if name == "pressure_plate" then
    activePlates[data.id] = data.active
    local allActive = true
    for _, v in pairs(linkedPlates) do
      if not activePlates[v] then allActive = false end
    end
    if allActive ~= open then
      open = allActive
      events.emit("door_state", { door = self.name, open = open })
    end
  end
end

function onUpdate(dt)
  local targetY = open and 3.5 or 0
  self.position.y = self.position.y + (targetY - self.position.y) * OPEN_SPEED * dt
end`;

const SCRIPT_KEY_PICKUP = `-- Key Pickup
-- Collected by the player on contact; unlocks its paired lock.
-- keyId must match the LockMechanism this key belongs to.
local collected = false

function onTriggerEnter(other)
  if other.tag == "Player" and not collected then
    collected = true
    self.visible = false
    events.emit("key_collected", { keyId = self.userData.keyId })
    ui.showMessage("Key obtained!", 2)
  end
end`;

const SCRIPT_LOCK_MECHANISM = `-- Lock Mechanism
-- Unlocked by the matching Key Pickup.
-- Once unlocked, emits an event that can open doors or trigger traps.
local unlocked = false

function onEvent(name, data)
  if name == "key_collected" and data.keyId == self.userData.keyId and not unlocked then
    unlocked = true
    events.emit("lock_opened", { lockId = self.userData.keyId })
    ui.showMessage("Lock opened!", 2)
  end
end`;

const SCRIPT_MOVING_PLATFORM = `-- Moving Platform
-- Oscillates between two waypoints on its path axis.
-- Set speed and range in userData.
local t = 0
local speed = 0.8
local range = 4

function onUpdate(dt)
  t = t + dt * speed
  local offset = math.sin(t) * range
  self.position.y = self.userData.baseY + offset
end`;

function setupPuzzle(engine: Engine, scene: THREE.Scene): TemplateResult {
  scene.background = new THREE.Color(0x0d1117);

  // ── Lighting ──
  const torchAmb = new THREE.AmbientLight(0x553322, 0.5);
  torchAmb.name = 'PuzzleAmbient';
  scene.add(torchAmb);

  const mainTorch = new THREE.DirectionalLight(0xff9944, 1.2);
  mainTorch.name = 'PuzzleMainLight';
  mainTorch.position.set(10, 18, 8);
  mainTorch.castShadow = true;
  mainTorch.shadow.mapSize.set(1024, 1024);
  scene.add(mainTorch);

  const fillLight = new THREE.DirectionalLight(0x224488, 0.4);
  fillLight.name = 'PuzzleFillLight';
  fillLight.position.set(-8, 8, -10);
  scene.add(fillLight);

  // ── Floor ──
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3a3540, roughness: 0.85, metalness: 0.1 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(32, 0.5, 32), stoneMat);
  floor.name = 'PuzzleFloor';
  floor.position.y = -0.25;
  floor.receiveShadow = true;
  floor.userData.isCollider = true;
  scene.add(floor);

  // ── Walls ──
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2533, roughness: 0.9 });
  const wallDefs: Array<[number, number, number, number, number, number, string]> = [
    [-15.75, 2, 0, 0.5, 4.5, 32, 'WallWest'],
    [15.75, 2, 0, 0.5, 4.5, 32, 'WallEast'],
    [0, 2, -15.75, 32, 4.5, 0.5, 'WallNorth'],
    [0, 2, 15.75, 32, 4.5, 0.5, 'WallSouth'],
  ];
  wallDefs.forEach(([x, y, z, w, h, d, name]) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    wall.name = name;
    wall.position.set(x, y, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.userData.isCollider = true;
    scene.add(wall);
  });

  // Ceiling
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(32, 0.5, 32), wallMat);
  ceiling.name = 'PuzzleCeiling';
  ceiling.position.y = 4.75;
  scene.add(ceiling);

  // ── Interior partition walls (create puzzle zones) ──
  const partitions: Array<[number, number, number, number, number, number, string]> = [
    [-2, 2, -4, 12, 4, 0.4, 'Partition_N'],
    [6, 2, 2, 0.4, 4, 14, 'Partition_E'],
    [-4, 2, 6, 8, 4, 0.4, 'Partition_S'],
  ];
  partitions.forEach(([x, y, z, w, h, d, name]) => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stoneMat);
    part.name = name;
    part.position.set(x, y, z);
    part.castShadow = true;
    part.receiveShadow = true;
    part.userData.isCollider = true;
    scene.add(part);
  });

  // ── Pressure Plates ──
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x885500, emissive: 0x331100, roughness: 0.5 });
  const platePositions: Array<[number, number]> = [[-8, -8], [4, -10], [-5, 4]];
  platePositions.forEach(([px, pz], i) => {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.5), plateMat);
    plate.name = `PressurePlate_${i}`;
    plate.position.set(px, 0.05, pz);
    plate.userData.plateId = i;
    plate.userData.__luaScript = SCRIPT_PRESSURE_PLATE;
    scene.add(plate);

    // Decorative arrows pointing at the plate
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffcc44, emissive: 0xffcc44, emissiveIntensity: 0.4 });
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 6), arrowMat);
    arrow.position.set(px, 1.2, pz);
    arrow.rotation.z = Math.PI;
    scene.add(arrow);
  });

  // ── Puzzle Doors ──
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x4a3060, roughness: 0.6, metalness: 0.4 });
  const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x6644aa, emissive: 0x221133, roughness: 0.4 });
  const doorDefs: Array<[number, number, number, number, number, number, string]> = [
    [-2, 1.5, -4.2, 2.5, 3, 0.3, 'PuzzleDoor_0'],
    [6.2, 1.5, 2, 0.3, 3, 2.5, 'PuzzleDoor_1'],
  ];
  doorDefs.forEach(([x, y, z, w, h, d, name], i) => {
    const door = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), doorMat);
    door.name = name;
    door.position.set(x, y, z);
    door.castShadow = true;
    door.userData.isCollider = true;
    door.userData.__luaScript = SCRIPT_PUZZLE_DOOR;
    scene.add(door);

    // Frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, h + 0.4, d + 0.2), doorFrameMat);
    frame.position.set(x, y, z);
    scene.add(frame);
    door.renderOrder = 1;
  });

  // ── Key Pickups ──
  const keyMat = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xdd9900, emissiveIntensity: 0.8 });
  const keyPositions: Array<[number, number, number]> = [[-10, 0.5, -10], [8, 0.5, -8]];
  keyPositions.forEach(([kx, ky, kz], i) => {
    const key = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 8, 16), keyMat);
    key.name = `KeyPickup_${i}`;
    key.position.set(kx, ky, kz);
    key.userData.keyId = i;
    key.userData.__luaScript = SCRIPT_KEY_PICKUP;
    scene.add(key);

    // Glow orb
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.4 }));
    glow.position.set(kx, ky, kz);
    scene.add(glow);
  });

  // ── Lock Mechanisms ──
  const lockMat = new THREE.MeshStandardMaterial({ color: 0x774422, roughness: 0.5, metalness: 0.6 });
  [[8, 1.5, -5], [-3, 1.5, 4.5]].forEach(([lx, ly, lz], i) => {
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.6), lockMat);
    lock.name = `LockMechanism_${i}`;
    lock.position.set(lx, ly, lz);
    lock.userData.keyId = i;
    lock.userData.__luaScript = SCRIPT_LOCK_MECHANISM;
    lock.castShadow = true;
    scene.add(lock);
  });

  // ── Moving Platforms ──
  const platformMat = new THREE.MeshStandardMaterial({ color: 0x226688, roughness: 0.5, metalness: 0.3 });
  const platformDefs: Array<[number, number, number, number, number, number]> = [
    [0, 1, -8, 3, 0.3, 3],
    [5, 1.5, 8, 3, 0.3, 3],
  ];
  platformDefs.forEach(([px, py, pz, w, h, d], i) => {
    const plat = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), platformMat);
    plat.name = `MovingPlatform_${i}`;
    plat.position.set(px, py, pz);
    plat.castShadow = true;
    plat.receiveShadow = true;
    plat.userData.isCollider = true;
    plat.userData.baseY = py;
    plat.userData.__luaScript = SCRIPT_MOVING_PLATFORM;
    scene.add(plat);
  });

  // ── Hint Scrolls ──
  const scrollMat = new THREE.MeshStandardMaterial({ color: 0xf5e6c8, roughness: 0.9 });
  const hints = ['Step on all three plates to open the first door.', 'Collect both keys to open the locked passages.'];
  [[-12, 1, -12], [12, 1, 12]].forEach(([sx, sy, sz], i) => {
    const scroll = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.8, 8), scrollMat);
    scroll.name = `HintScroll_${i}`;
    scroll.position.set(sx, sy, sz);
    scroll.userData.__luaScript = `-- Hint Scroll\n-- Displays a hint message when the player interacts with it.\nlocal hint = "${hints[i]}"\nfunction onInteract(other)\n  if other.tag == "Player" then\n    ui.showMessage(hint, 4)\n  end\nend`;
    scroll.castShadow = true;
    scene.add(scroll);
  });

  // ── Exit Portal ──
  const portalMat = new THREE.MeshStandardMaterial({ color: 0x00ffaa, emissive: 0x00cc77, emissiveIntensity: 1.0, transparent: true, opacity: 0.8 });
  const portal = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.25, 12, 36), portalMat);
  portal.name = 'ExitPortal';
  portal.position.set(12, 2, -12);
  portal.rotation.y = Math.PI / 4;
  portal.userData.__luaScript = `-- Exit Portal\n-- Completes the puzzle level when the player enters it.\n-- Requires all keys collected and all doors opened.\nlocal active = false\nfunction onEvent(name, data)\n  if name == "all_puzzles_complete" then active = true end\nend\nfunction onTriggerEnter(other)\n  if other.tag == "Player" and active then\n    events.emit("level_complete", {})\n  end\nend`;
  scene.add(portal);

  const portalGlow = new THREE.PointLight(0x00ffaa, 2.5, 8);
  portalGlow.position.set(12, 2, -12);
  scene.add(portalGlow);

  // ── Torch Lights ──
  const torchPositions: Array<[number, number, number]> = [[-14, 2.5, -14], [14, 2.5, -14], [-14, 2.5, 14], [14, 2.5, 14]];
  torchPositions.forEach(([tx, ty, tz], i) => {
    const tl = new THREE.PointLight(0xff6622, 1.5, 12);
    tl.name = `TorchLight_${i}`;
    tl.position.set(tx, ty, tz);
    scene.add(tl);

    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xff8800 }));
    flame.position.set(tx, ty, tz);
    scene.add(flame);
  });

  // ── Player ──
  const playerMat = new THREE.MeshStandardMaterial({ color: 0x44aaff, roughness: 0.6 });
  const playerBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.0, 6, 12), playerMat);
  playerBody.name = 'PuzzlePlayer';
  playerBody.position.set(-12, 0.9, 12);
  playerBody.castShadow = true;
  playerBody.userData.tag = 'Player';
  playerBody.userData.__luaScript = `-- Puzzle Player Controller\n-- WASD: Move, Space: Jump, E: Interact\nlocal speed = 5\nlocal jumpForce = 7\nlocal vy = 0\nlocal grounded = false\n\nfunction onUpdate(dt)\n  local fwd = input.isKeyDown("w") and -1 or 0\n  local bwd = input.isKeyDown("s") and 1 or 0\n  local right = input.isKeyDown("d") and 1 or 0\n  local left = input.isKeyDown("a") and -1 or 0\n  self.position.x = self.position.x + (right + left) * speed * dt\n  self.position.z = self.position.z + (fwd + bwd) * speed * dt\n  vy = vy - 18 * dt\n  if grounded and input.isKeyJustPressed("space") then vy = jumpForce end\n  self.position.y = self.position.y + vy * dt\n  if self.position.y <= 0.9 then self.position.y = 0.9; vy = 0; grounded = true\n  else grounded = false end\nend`;
  scene.add(playerBody);

  // ── Camera ──
  engine.camera.position.set(-12, 6, 18);
  engine.camera.lookAt(-12, 0, 12);

  // ── HUD ──
  const hud = document.getElementById('ui-overlay');
  const hudDiv = document.createElement('div');
  hudDiv.id = 'puzzle-hud';
  hudDiv.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;gap:16px;pointer-events:none;z-index:1000;font-family:monospace;';
  hudDiv.innerHTML = `
    <div style="background:rgba(0,0,0,0.7);padding:6px 16px;border-radius:8px;color:#ffd700;font-size:14px;border:1px solid #554400;">🗝 Keys: <span id="hud-keys">0</span>/2</div>
    <div style="background:rgba(0,0,0,0.7);padding:6px 16px;border-radius:8px;color:#00ffaa;font-size:14px;border:1px solid #004433;">Plates: <span id="hud-plates">0</span>/3</div>
    <div style="background:rgba(0,0,0,0.7);padding:6px 16px;border-radius:8px;color:#aaa;font-size:10px;">WASD: Move | Space: Jump | E: Interact | F9: Editor</div>
  `;
  hud?.appendChild(hudDiv);

  // ── Runtime State ──
  let keysCollected = 0;
  let platesActive = 0;
  const playerPos = new THREE.Vector3(-12, 0.9, 12);
  const playerVel = new THREE.Vector3();
  const PLAYER_SPEED = 5;
  const JUMP_FORCE_PZ = 7;
  const GRAVITY_PZ = -18;
  let groundedPz = true;
  let playerAngle = 0;

  // Moving platform state
  const platformTimers = platformDefs.map(() => Math.random() * Math.PI * 2);

  const updateFn = (delta: number, _elapsed: number) => {
    if (engine.editorActive) return;

    const input = engine.input;

    // Player movement
    const moveX = (input.isKeyDown('d') ? 1 : 0) - (input.isKeyDown('a') ? 1 : 0);
    const moveZ = (input.isKeyDown('s') ? 1 : 0) - (input.isKeyDown('w') ? 1 : 0);

    if (moveX !== 0 || moveZ !== 0) {
      playerAngle = Math.atan2(moveX, moveZ);
    }

    playerPos.x += moveX * PLAYER_SPEED * delta;
    playerPos.z += moveZ * PLAYER_SPEED * delta;

    // Gravity
    playerVel.y += GRAVITY_PZ * delta;
    if (input.isKeyJustPressed('space') && groundedPz) {
      playerVel.y = JUMP_FORCE_PZ;
      groundedPz = false;
    }

    playerPos.y += playerVel.y * delta;

    if (playerPos.y <= 0.9) {
      playerPos.y = 0.9;
      playerVel.y = 0;
      groundedPz = true;
    }

    // Clamp to room bounds
    playerPos.x = Math.max(-14.5, Math.min(14.5, playerPos.x));
    playerPos.z = Math.max(-14.5, Math.min(14.5, playerPos.z));

    playerBody.position.copy(playerPos);
    playerBody.rotation.y = playerAngle;

    // Moving platforms animation
    platformDefs.forEach(([px, py, pz], i) => {
      platformTimers[i] += delta * 0.8;
      const plat = scene.getObjectByName(`MovingPlatform_${i}`) as THREE.Mesh | undefined;
      if (plat) {
        plat.position.y = py + Math.sin(platformTimers[i]) * 2;
        // Player on platform
        const platTop = plat.position.y + 0.2;
        const dxp = playerPos.x - plat.position.x;
        const dzp = playerPos.z - plat.position.z;
        if (Math.abs(dxp) < 1.5 && Math.abs(dzp) < 1.5 && Math.abs(playerPos.y - platTop) < 0.6) {
          playerPos.y = platTop + 0.9;
          playerVel.y = 0;
          groundedPz = true;
        }
      }
    });

    // Pressure plate detection
    let activePlatesCount = 0;
    platePositions.forEach(([px, pz], i) => {
      const plate = scene.getObjectByName(`PressurePlate_${i}`) as THREE.Mesh | undefined;
      const dist = Math.sqrt((playerPos.x - px) ** 2 + (playerPos.z - pz) ** 2);
      const active = dist < 1.2;
      if (active) activePlatesCount++;
      if (plate) {
        (plate.material as THREE.MeshStandardMaterial).emissiveIntensity = active ? 0.8 : 0.1;
        (plate.material as THREE.MeshStandardMaterial).color.set(active ? 0xffff00 : 0x885500);
      }
    });
    platesActive = activePlatesCount;

    // Key pickup detection
    keysCollected = 0;
    keyPositions.forEach(([kx, ky, kz], i) => {
      const key = scene.getObjectByName(`KeyPickup_${i}`) as THREE.Mesh | undefined;
      if (key && key.visible) {
        const dist = Math.sqrt((playerPos.x - kx) ** 2 + (playerPos.z - kz) ** 2);
        if (dist < 1.2) key.visible = false;
      }
      if (key && !key.visible) keysCollected++;
    });

    // Key rotation animation
    keyPositions.forEach(([kx, _ky, kz], i) => {
      const key = scene.getObjectByName(`KeyPickup_${i}`) as THREE.Mesh | undefined;
      if (key && key.visible) key.rotation.y += delta * 2;
    });

    // Portal active when all puzzles complete
    if (keysCollected >= 2 && platesActive >= 3) {
      portal.rotation.y += delta;
      (portal.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.0 + Math.sin(_elapsed * 3) * 0.3;
    } else {
      (portal.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.2;
    }

    // Torch flicker
    torchPositions.forEach(([tx, ty, tz], i) => {
      const tl = scene.getObjectByName(`TorchLight_${i}`) as THREE.PointLight | undefined;
      if (tl) tl.intensity = 1.3 + Math.sin(_elapsed * (7 + i * 1.3)) * 0.3;
    });

    // Chase camera
    const camTargetX = playerPos.x;
    const camTargetZ = playerPos.z + 10;
    engine.camera.position.x += (camTargetX - engine.camera.position.x) * 4 * delta;
    engine.camera.position.z += (camTargetZ - engine.camera.position.z) * 4 * delta;
    engine.camera.position.y += (7 - engine.camera.position.y) * 4 * delta;
    engine.camera.lookAt(playerPos.x, playerPos.y, playerPos.z);

    // HUD update
    const keysEl = document.getElementById('hud-keys');
    const platesEl = document.getElementById('hud-plates');
    if (keysEl) keysEl.textContent = `${keysCollected}`;
    if (platesEl) platesEl.textContent = `${platesActive}`;
  };

  return {
    updateFn,
    helpText: 'WASD: Move | Space: Jump | E: Interact | Collect keys, activate plates, open doors | Reach the Exit Portal | F9: Editor',
  };
}
