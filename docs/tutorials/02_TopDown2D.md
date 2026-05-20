# Tutorial 2: Top-Down 2D Game

Build a top-down action game with sprite animations, tilemaps, enemies, and combat.

---

## What You'll Build
A small top-down dungeon with a player who can move in 8 directions, swing a sword, and fight slime enemies on a tiled map.

## Prerequisites
- BlindFake: Phantom running
- A new 2D project from the Project Hub
- A sprite sheet image (16×16 pixel tiles) or use the placeholder graphics below

---

## Step 1: Create a Sprite Sheet

For this tutorial, we'll use a simple tile set. Place your sprite sheet at `assets/public/tileset.png`.

A basic layout (16×16 tiles, 8 columns × 4 rows):
- Row 0: Player walk (4 frames) + Player idle (4 frames)
- Row 1: Slime walk (4 frames) + Slime idle (4 frames)
- Row 2: Terrain tiles (grass, stone, wall, water, path, bush, door, chest)
- Row 3: Effects (sword slash ×4) + UI (heart, empty heart, coin, key)

```typescript
import { SpriteSheet, Sprite2D, Camera2D, Tilemap, SpriteBatch } from './2d/Sprite2D';

// Load texture
const textureLoader = new THREE.TextureLoader();
const tilesetTex = textureLoader.load('/tileset.png');
tilesetTex.magFilter = THREE.NearestFilter;
tilesetTex.minFilter = THREE.NearestFilter;

// Create sprite sheet
const tileSheet = new SpriteSheet({
  texture: tilesetTex,
  frameWidth: 16,
  frameHeight: 16,
  columns: 8,
  rows: 4,
});
```

---

## Step 2: Build the Tilemap

```typescript
const tilemap = new Tilemap(tileSheet, 16, 16, 16);

// Define tile types (id, name, frame index in sheet, walkable)
tilemap.defineTile(1, 'grass', 16, true);    // Row 2, Col 0
tilemap.defineTile(2, 'stone', 17, true);    // Row 2, Col 1
tilemap.defineTile(3, 'wall', 18, false);    // Row 2, Col 2 (not walkable!)
tilemap.defineTile(4, 'water', 19, false);   // Row 2, Col 3
tilemap.defineTile(5, 'path', 20, true);     // Row 2, Col 4

// Create a 12×10 dungeon map
const mapData = [
  [3,3,3,3,3,3,3,3,3,3,3,3],
  [3,1,1,1,5,5,5,1,1,1,1,3],
  [3,1,1,1,5,1,5,1,1,2,1,3],
  [3,1,2,1,5,1,5,1,1,1,1,3],
  [3,1,1,1,5,1,5,5,5,1,1,3],
  [3,1,1,1,1,1,1,1,5,1,1,3],
  [3,1,1,2,1,1,2,1,5,1,1,3],
  [3,1,1,1,1,1,1,1,5,1,1,3],
  [3,1,1,1,1,1,1,1,5,5,1,3],
  [3,3,3,3,3,3,3,3,3,3,3,3],
];

tilemap.addLayer({ name: 'ground', data: mapData });
tilemap.build();
scene.add(tilemap.root);
```

---

## Step 3: Create the Player Sprite

```typescript
const player = new Sprite2D(tileSheet);
player.setPosition(2, -2); // World units (grid pos 2,2)
player.layer = 10; // Above the tilemap

// Walking animations (using frames from row 0)
player.addAnimation({ name: 'walk_down',  frames: [0, 1, 2, 3], fps: 8, loop: true });
player.addAnimation({ name: 'walk_right', frames: [4, 5, 6, 7], fps: 8, loop: true });
player.addAnimation({ name: 'idle',       frames: [0],           fps: 1, loop: true });

scene.add(player.mesh);

// Player state
let playerGridX = 2;
let playerGridY = 2;
let playerHP = 3;
const MOVE_SPEED = 3; // World units per second
```

---

## Step 4: Player Movement with Collision

```typescript
const cam2d = new Camera2D(16);

engine.onUpdate = (delta) => {
  if (engine.editorActive) return;

  const input = engine.input;
  let dx = 0, dy = 0;

  if (input.isKeyDown('w') || input.isKeyDown('arrowup'))    dy += 1;
  if (input.isKeyDown('s') || input.isKeyDown('arrowdown'))  dy -= 1;
  if (input.isKeyDown('a') || input.isKeyDown('arrowleft'))  dx -= 1;
  if (input.isKeyDown('d') || input.isKeyDown('arrowright')) dx += 1;

  if (dx !== 0 || dy !== 0) {
    // Normalize diagonal movement
    const len = Math.sqrt(dx * dx + dy * dy);
    dx /= len;
    dy /= len;

    // Next position
    const nextX = player.mesh.position.x + dx * MOVE_SPEED * delta;
    const nextY = player.mesh.position.y + dy * MOVE_SPEED * delta;

    // Check tilemap collision
    const gridPos = tilemap.worldToGrid(nextX, -nextY);
    if (tilemap.isWalkable(gridPos.x, gridPos.y)) {
      player.mesh.position.x = nextX;
      player.mesh.position.y = nextY;
    }

    // Play walk animation
    if (dx > 0) { player.play('walk_right'); player.flipX = false; }
    else if (dx < 0) { player.play('walk_right'); player.flipX = true; }
    else { player.play('walk_down'); }
  } else {
    player.play('idle');
  }

  player.update(delta);

  // Camera follows player
  cam2d.follow(player.mesh.position.x, player.mesh.position.y);
  cam2d.update(delta);
};
```

---

## Step 5: Add Enemies

```typescript
interface Enemy {
  sprite: Sprite2D;
  hp: number;
  speed: number;
  direction: THREE.Vector2;
  changeTimer: number;
}

const enemies: Enemy[] = [];

function spawnEnemy(x: number, y: number): void {
  const sprite = new Sprite2D(tileSheet);
  sprite.setPosition(x, -y);
  sprite.layer = 10;
  sprite.setFrame(8); // Slime frame (row 1, col 0)
  sprite.addAnimation({ name: 'walk', frames: [8, 9, 10, 11], fps: 6, loop: true });
  sprite.play('walk');
  scene.add(sprite.mesh);

  enemies.push({
    sprite,
    hp: 2,
    speed: 1.5,
    direction: new THREE.Vector2(1, 0),
    changeTimer: 2,
  });
}

// Spawn some enemies
spawnEnemy(5, 3);
spawnEnemy(8, 6);
spawnEnemy(3, 7);
```

### Enemy AI (Simple Patrol)
Add this inside the update loop:

```typescript
for (const enemy of enemies) {
  enemy.changeTimer -= delta;
  if (enemy.changeTimer <= 0) {
    // Change direction randomly
    const angle = Math.random() * Math.PI * 2;
    enemy.direction.set(Math.cos(angle), Math.sin(angle));
    enemy.changeTimer = 1 + Math.random() * 2;
  }

  const nextX = enemy.sprite.mesh.position.x + enemy.direction.x * enemy.speed * delta;
  const nextY = enemy.sprite.mesh.position.y + enemy.direction.y * enemy.speed * delta;
  const gridPos = tilemap.worldToGrid(nextX, -nextY);

  if (tilemap.isWalkable(gridPos.x, gridPos.y)) {
    enemy.sprite.mesh.position.x = nextX;
    enemy.sprite.mesh.position.y = nextY;
  } else {
    enemy.direction.negate(); // Bounce off walls
    enemy.changeTimer = 0.5;
  }

  enemy.sprite.update(delta);
}
```

---

## Step 6: Combat

```typescript
let attackCooldown = 0;
const ATTACK_RANGE = 1.2;
const ATTACK_COOLDOWN = 0.4;

// In update loop:
attackCooldown -= delta;

if (input.isKeyJustPressed(' ') && attackCooldown <= 0) {
  attackCooldown = ATTACK_COOLDOWN;

  // Check enemies in range
  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    const dist = player.mesh.position.distanceTo(enemy.sprite.mesh.position);
    if (dist < ATTACK_RANGE) {
      enemy.hp--;
      // Knockback
      const kb = new THREE.Vector2(
        enemy.sprite.mesh.position.x - player.mesh.position.x,
        enemy.sprite.mesh.position.y - player.mesh.position.y,
      ).normalize().multiplyScalar(0.5);
      enemy.sprite.mesh.position.x += kb.x;
      enemy.sprite.mesh.position.y += kb.y;

      if (enemy.hp <= 0) {
        scene.remove(enemy.sprite.mesh);
        enemy.sprite.dispose();
        enemies.splice(i, 1);
      }
    }
  }

  // Camera shake on attack
  cam2d.shake(0.1, 0.15);
}
```

---

## Step 7: HUD

```typescript
const hudEl = document.createElement('div');
hudEl.style.cssText = 'position:fixed;top:10px;left:10px;color:white;font:bold 20px monospace;text-shadow:1px 1px 2px #000;';
document.getElementById('ui-overlay')?.appendChild(hudEl);

// In update loop:
hudEl.textContent = '❤️'.repeat(playerHP) + '🖤'.repeat(3 - playerHP);
```

---

## Step 8: Polish

### Damage to player
```typescript
// In update loop �?check enemy collision with player
for (const enemy of enemies) {
  const dist = player.mesh.position.distanceTo(enemy.sprite.mesh.position);
  if (dist < 0.6 && attackCooldown <= 0) {
    playerHP--;
    cam2d.shake(0.2, 0.3);
    if (playerHP <= 0) {
      console.log('Game Over!');
      // Reset...
    }
  }
}
```

### SpriteBatch for decorations
If you want to scatter many grass/flower decorations efficiently:

```typescript
const decorBatch = new SpriteBatch(tileSheet, 16);
for (let i = 0; i < 50; i++) {
  const x = 1 + Math.random() * 10;
  const y = 1 + Math.random() * 8;
  decorBatch.add(x, -y, 21, 5); // bush frame, layer 5
}
decorBatch.flush();
scene.add(decorBatch.group);
```

---

**Congratulations!** You've built a top-down 2D dungeon crawler.

## Next: [Tutorial 3: First-Person Shooter](./03_FPS.md)
