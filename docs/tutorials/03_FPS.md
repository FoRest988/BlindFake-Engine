# Tutorial 3: First-Person Shooter

Build a basic FPS with a gun, enemies, health, and ammo.

---

## What You'll Build
A first-person arena where you move with WASD, look with the mouse, and shoot enemies that charge at you.

## Prerequisites
- BlindFake: Phantom running
- A new 3D project

---

## Step 1: FPS Camera

Replace the default 3rd-person camera with a first-person setup:

```typescript
import { RaycastUtils } from './engine/RaycastUtils';

// Lock pointer for FPS controls
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
canvas.addEventListener('click', () => canvas.requestPointerLock());

// Camera vars
let yaw = 0;
let pitch = 0;
const MOUSE_SENSITIVITY = 0.002;

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * MOUSE_SENSITIVITY;
  pitch -= e.movementY * MOUSE_SENSITIVITY;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
});

// Position camera at eye level
engine.camera.position.set(0, 1.7, 0);
```

---

## Step 2: Player Movement

```typescript
const MOVE_SPEED = 6;
const moveDirection = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();

engine.onUpdate = (delta) => {
  if (engine.editorActive) return;
  const input = engine.input;

  // Calculate forward/right from yaw
  forward.set(Math.sin(yaw), 0, Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));

  moveDirection.set(0, 0, 0);
  if (input.isKeyDown('w')) moveDirection.add(forward);
  if (input.isKeyDown('s')) moveDirection.sub(forward);
  if (input.isKeyDown('a')) moveDirection.sub(right);
  if (input.isKeyDown('d')) moveDirection.add(right);

  if (moveDirection.length() > 0) {
    moveDirection.normalize().multiplyScalar(MOVE_SPEED * delta);
    engine.camera.position.add(moveDirection);
  }

  // Apply rotation
  engine.camera.rotation.order = 'YXZ';
  engine.camera.rotation.y = yaw;
  engine.camera.rotation.x = pitch;
};
```

---

## Step 3: Build the Arena

```typescript
// Floor
const floorGeo = new THREE.PlaneGeometry(50, 50);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Walls
function createWall(x: number, z: number, w: number, d: number): void {
  const geo = new THREE.BoxGeometry(w, 4, d);
  const mat = new THREE.MeshStandardMaterial({ color: 0x887766 });
  const wall = new THREE.Mesh(geo, mat);
  wall.position.set(x, 2, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);
}

// Arena boundaries
createWall(0, -25, 50, 1);
createWall(0, 25, 50, 1);
createWall(-25, 0, 1, 50);
createWall(25, 0, 1, 50);

// Some cover
createWall(5, 5, 3, 1);
createWall(-8, -3, 1, 5);
createWall(10, -10, 4, 1);
```

---

## Step 4: Crosshair & HUD

```typescript
// Crosshair
const crosshair = document.createElement('div');
crosshair.style.cssText = `
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 4px; height: 4px;
  background: white; border-radius: 50%;
  pointer-events: none; z-index: 1000;
  box-shadow: 0 0 4px rgba(255,255,255,0.5);
`;
document.getElementById('ui-overlay')?.appendChild(crosshair);

// HUD
let hp = 100;
let ammo = 30;
let maxAmmo = 30;
let kills = 0;

const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;bottom:20px;left:20px;color:white;font:bold 18px monospace;text-shadow:1px 1px 2px #000;';
document.getElementById('ui-overlay')?.appendChild(hud);

// Update HUD in game loop
hud.innerHTML = `HP: ${hp} | Ammo: ${ammo}/${maxAmmo} | Kills: ${kills}`;
```

---

## Step 5: Shooting

```typescript
// Gun flash light
const muzzleFlash = new THREE.PointLight(0xffaa00, 0, 5);
engine.camera.add(muzzleFlash);
muzzleFlash.position.set(0.3, -0.2, -1);
scene.add(engine.camera); // Camera needs to be in scene for child lights

let shootCooldown = 0;
const FIRE_RATE = 0.12; // seconds between shots

// Bullet impact markers
const impactGeo = new THREE.SphereGeometry(0.05, 8, 8);
const impactMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });

function shoot(): void {
  if (ammo <= 0 || shootCooldown > 0) return;
  ammo--;
  shootCooldown = FIRE_RATE;

  // Muzzle flash
  muzzleFlash.intensity = 3;
  setTimeout(() => { muzzleFlash.intensity = 0; }, 50);

  // Raycast from camera center
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), engine.camera);

  // Check enemies first
  const enemyMeshes = fpsEnemies.map(e => e.mesh);
  const hits = raycaster.intersectObjects(enemyMeshes, true);

  if (hits.length > 0) {
    const hitObj = hits[0].object;
    const enemy = fpsEnemies.find(e => e.mesh === hitObj || e.mesh.children.includes(hitObj));
    if (enemy) {
      enemy.hp -= 25;
      if (enemy.hp <= 0) {
        scene.remove(enemy.mesh);
        fpsEnemies.splice(fpsEnemies.indexOf(enemy), 1);
        kills++;
      }
    }
  } else {
    // Check world geometry
    const worldHits = raycaster.intersectObjects(scene.children, true);
    if (worldHits.length > 0 && worldHits[0].distance < 100) {
      const mark = new THREE.Mesh(impactGeo, impactMat);
      mark.position.copy(worldHits[0].point);
      scene.add(mark);
      // Remove after 3 seconds
      setTimeout(() => scene.remove(mark), 3000);
    }
  }
}

// In update loop:
shootCooldown -= delta;
if (input.isMouseDown(0)) shoot(); // Left click to shoot

// Reload
if (input.isKeyJustPressed('r')) {
  ammo = maxAmmo;
}
```

---

## Step 6: Enemies

```typescript
interface FPSEnemy {
  mesh: THREE.Mesh;
  hp: number;
  speed: number;
}

const fpsEnemies: FPSEnemy[] = [];

function spawnFPSEnemy(): void {
  const geo = new THREE.CapsuleGeometry(0.4, 1.2, 8, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0x00bb00 });
  const mesh = new THREE.Mesh(geo, mat);

  // Random spawn at arena edge
  const angle = Math.random() * Math.PI * 2;
  const radius = 20;
  mesh.position.set(Math.cos(angle) * radius, 1, Math.sin(angle) * radius);
  mesh.castShadow = true;
  scene.add(mesh);

  fpsEnemies.push({ mesh, hp: 50, speed: 3 });
}

// Spawn initial wave
for (let i = 0; i < 5; i++) spawnFPSEnemy();
```

### Enemy AI â€?Chase Player
```typescript
// In update loop:
const camPos = engine.camera.position;

for (const enemy of fpsEnemies) {
  // Move toward player
  const dir = new THREE.Vector3()
    .subVectors(camPos, enemy.mesh.position)
    .setY(0)
    .normalize();
  enemy.mesh.position.add(dir.multiplyScalar(enemy.speed * delta));
  enemy.mesh.lookAt(camPos.x, enemy.mesh.position.y, camPos.z);

  // Damage player on contact
  if (enemy.mesh.position.distanceTo(camPos) < 1.5) {
    hp -= 10 * delta; // Continuous damage
    if (hp <= 0) {
      console.log('Game Over! Kills:', kills);
    }
  }
}

// Spawn more enemies over time
if (Math.random() < 0.01) spawnFPSEnemy(); // ~1 per 1.6 seconds at 60fps
```

---

## Step 7: Weapon Model (Simple)

```typescript
// Simple gun geometry attached to camera
const gunGroup = new THREE.Group();
const barrel = new THREE.Mesh(
  new THREE.BoxGeometry(0.05, 0.05, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x333333 })
);
barrel.position.set(0.3, -0.2, -0.5);
const grip = new THREE.Mesh(
  new THREE.BoxGeometry(0.06, 0.15, 0.06),
  new THREE.MeshStandardMaterial({ color: 0x222222 })
);
grip.position.set(0.3, -0.3, -0.35);
gunGroup.add(barrel, grip);
engine.camera.add(gunGroup);

// Gun recoil animation in shoot():
gunGroup.position.z = 0.05;
setTimeout(() => { gunGroup.position.z = 0; }, 60);
```

---

## Step 8: Polish

### Lighting
```typescript
// Moody arena lighting
const dirLight = new THREE.DirectionalLight(0xffeedd, 1.5);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
scene.add(dirLight);

const ambient = new THREE.AmbientLight(0x334455, 0.5);
scene.add(ambient);
```

### Damage flash
```typescript
const damageOverlay = document.createElement('div');
damageOverlay.style.cssText = `
  position:fixed;top:0;left:0;right:0;bottom:0;
  background:rgba(255,0,0,0);pointer-events:none;transition:background 0.1s;
`;
document.getElementById('ui-overlay')?.appendChild(damageOverlay);

// Show red flash when hit:
damageOverlay.style.background = 'rgba(255,0,0,0.3)';
setTimeout(() => { damageOverlay.style.background = 'rgba(255,0,0,0)'; }, 200);
```

---

**Congratulations!** You've built a basic FPS arena shooter.

## Next: [Tutorial 4: Visual Scripting](./04_VisualScripting.md)
