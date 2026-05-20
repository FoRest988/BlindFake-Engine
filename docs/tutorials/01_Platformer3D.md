# Tutorial 1: 3D Platformer

Build a complete 3D platformer with a player character, platforms, collectibles, and a goal.

---

## What You'll Build
A small 3D platformer level where the player runs, jumps across platforms, collects coins, and reaches a goal flag.

## Prerequisites
- BlindFake: Phantom running (`npm run dev:all`)
- A new 3D project created from the Project Hub

---

## Step 1: Set Up the Scene

When you create a 3D project, you get a default terrain and player capsule. Let's customize it.

### Remove the Default Terrain
In the Hierarchy panel, select "Terrain" and delete it (press `Delete`). We'll make our own platforms.

### Set Background
Select the Scene in the Inspector. Change the background color to a sky blue: `#87CEEB`.

---

## Step 2: Create the Player

### Using the ECS
Open the Script Editor (or edit `main.ts` directly):

```typescript
import { TransformComponent, MeshComponent, PhysicsBodyComponent } from './ecs/components/GameComponents';

// Player mesh
const playerGeo = new THREE.CapsuleGeometry(0.4, 1.0, 8, 16);
const playerMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c });
const playerMesh = new THREE.Mesh(playerGeo, playerMat);
playerMesh.castShadow = true;

// Create entity
const player = engine.world.createEntity('Player');
player
  .add(new TransformComponent().setPosition(0, 3, 0))
  .add(new MeshComponent(playerMesh))
  .add(new PhysicsBodyComponent())
  .addTag('player');
```

### Player Movement
```typescript
const MOVE_SPEED = 8;
const JUMP_FORCE = 12;

engine.onUpdate = (delta) => {
  if (engine.editorActive) return;

  const transform = player.get(TransformComponent);
  const body = player.get(PhysicsBodyComponent);
  const input = engine.input;

  // Movement
  const moveDir = new THREE.Vector3();
  if (input.isKeyDown('w')) moveDir.z -= 1;
  if (input.isKeyDown('s')) moveDir.z += 1;
  if (input.isKeyDown('a')) moveDir.x -= 1;
  if (input.isKeyDown('d')) moveDir.x += 1;

  if (moveDir.length() > 0) {
    moveDir.normalize().multiplyScalar(MOVE_SPEED);
    body.velocity.x = moveDir.x;
    body.velocity.z = moveDir.z;
  }

  // Jump
  if (input.isKeyJustPressed(' ') && body.grounded) {
    body.velocity.y = JUMP_FORCE;
    body.grounded = false;
  }

  // Respawn if fallen
  if (transform.position.y < -20) {
    transform.position.set(0, 3, 0);
    body.velocity.set(0, 0, 0);
  }
};
```

---

## Step 3: Build Platforms

### Using the Editor
1. Click **+ Cube** in the toolbar
2. Scale it to (5, 0.5, 5) using the Inspector
3. Position it at (0, 0, 0) â€?this is the starting platform
4. Rename it "Platform_Start"

Repeat to create more platforms:
| Platform | Position | Scale |
|----------|----------|-------|
| Start | (0, 0, 0) | (5, 0.5, 5) |
| Step 1 | (8, 1, 0) | (3, 0.5, 3) |
| Step 2 | (8, 2.5, 8) | (3, 0.5, 3) |
| Step 3 | (0, 4, 8) | (3, 0.5, 3) |
| Goal | (0, 5.5, 16) | (5, 0.5, 5) |

### Via Code
```typescript
function createPlatform(x: number, y: number, z: number, w: number, d: number): void {
  const geo = new THREE.BoxGeometry(w, 0.5, d);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2ecc71 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  scene.add(mesh);
}

createPlatform(0, 0, 0, 5, 5);
createPlatform(8, 1, 0, 3, 3);
createPlatform(8, 2.5, 8, 3, 3);
createPlatform(0, 4, 8, 3, 3);
createPlatform(0, 5.5, 16, 5, 5);
```

---

## Step 4: Add Collectibles

```typescript
const coins: THREE.Mesh[] = [];
const coinGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16);
const coinMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, emissive: 0xf1c40f, emissiveIntensity: 0.3 });

function addCoin(x: number, y: number, z: number): void {
  const coin = new THREE.Mesh(coinGeo, coinMat);
  coin.position.set(x, y, z);
  coin.rotation.x = Math.PI / 2;
  coin.castShadow = true;
  scene.add(coin);
  coins.push(coin);
}

addCoin(4, 1.5, 0);
addCoin(8, 2, 4);
addCoin(4, 4, 8);

let score = 0;

// In update loop â€?check coin collection
const playerPos = player.get(TransformComponent).position;
for (let i = coins.length - 1; i >= 0; i--) {
  const coin = coins[i];
  coin.rotation.z += delta * 2; // Spin animation
  if (playerPos.distanceTo(coin.position) < 1.0) {
    scene.remove(coin);
    coins.splice(i, 1);
    score++;
    audio.play('coin_pickup');
  }
}
```

---

## Step 5: Add a Goal

```typescript
const flagGeo = new THREE.BoxGeometry(0.1, 3, 1);
const flagMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c });
const flag = new THREE.Mesh(flagGeo, flagMat);
flag.position.set(0, 7.5, 16);
scene.add(flag);

// Check goal
if (playerPos.distanceTo(flag.position) < 2.0) {
  console.log(`Level Complete! Score: ${score}`);
}
```

---

## Step 6: Camera Setup

The default 3D template already includes a 3rd-person camera. To customize:

```typescript
const cameraOffset = new THREE.Vector3(0, 5, 10); // Behind and above
const followSmoothing = 0.15;

// In update:
const target = player.get(TransformComponent).position.clone();
target.y += 1.5; // Look at player's head
const desired = target.clone().add(cameraOffset);
engine.camera.position.lerp(desired, followSmoothing);
engine.camera.lookAt(target);
```

---

## Step 7: Polish

### Add fog for depth
```typescript
scene.fog = new THREE.Fog(0x87CEEB, 30, 100);
```

### Play the game
Press **F9** to enter Play Mode. Move with WASD, jump with Space.

**Congratulations!** You've built your first 3D platformer with BlindFake: Phantom.

---

## Next: [Tutorial 2: Top-Down 2D Game](./02_TopDown2D.md)
