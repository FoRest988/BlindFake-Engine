# BlindFake: Phantom â€?Getting Started

Welcome to **BlindFake: Phantom**, a web-based 3D/2D game engine built with Three.js, TypeScript, and an ECS architecture. This guide will walk you through creating your first project.

---

## 1. Installation

### Prerequisites
- **Node.js** 18+ ([download](https://nodejs.org))
- **npm** (comes with Node.js)
- A modern browser (Chrome, Firefox, Edge)

### Clone & Install
```bash
git clone https://github.com/FoRest988/BlindFake-Engine.git
cd BlindFake-Engine
npm install
```

### Start the Engine
```bash
npm run dev:all
```
This starts:
- **Vite dev server** on `http://localhost:3000` (editor + game)
- **WebSocket server** on `http://localhost:4000` (multiplayer)

Open `http://localhost:3000` in your browser.

---

## 2. Creating Your First Project

When you open the engine, you'll see the **Project Hub** â€?similar to Unity Hub or Unreal's Project Browser.

1. Click **+ New Project**
2. Enter a project name (e.g. "My First Game")
3. Choose a template:
   - **3D** â€?Full 3D scene with lighting, physics, terrain, and a player character
   - **2D** â€?Orthographic camera setup for sprite-based games
4. Click **Create Project**

The engine automatically opens the **Editor**.

---

## 3. Editor Overview

The editor has several panels:

| Panel | Purpose |
|-------|---------|
| **Viewport** | 3D/2D scene view with camera controls |
| **Hierarchy** | Tree view of all objects in the scene |
| **Inspector** | Properties of the selected object (transform, material, components) |
| **Toolbar** | Add objects (cube, sphere, light, etc.), transform mode (translate/rotate/scale) |
| **Console** | Log output and errors |
| **Asset Browser** | Browse and manage project assets |
| **Menu Bar** | File (save/load/export), Edit (undo/redo), View (layout presets) |

### Camera Controls (Viewport)
- **Right-click + drag**: Rotate camera
- **Middle-click + drag**: Pan camera
- **Scroll wheel**: Zoom in/out
- **F**: Focus on selected object
- **1-5**: Switch to preset camera angles

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Save project |
| `Ctrl+D` | Duplicate selected |
| `Delete` | Delete selected |
| `W` | Translate mode |
| `E` | Rotate mode |
| `R` | Scale mode |
| `F9` | Toggle Play Mode |

---

## 4. Adding Objects

### From the Toolbar
Click the **+** buttons in the toolbar to add:
- **Primitives**: Cube, Sphere, Cylinder, Cone, Torus, Plane
- **Lights**: Directional, Point, Spot, Ambient
- **Camera**: Perspective camera
- **Empty**: Empty group node for organization

### From Code (Scripting)
```typescript
// Create a mesh
const geo = new THREE.BoxGeometry(1, 1, 1);
const mat = new THREE.MeshStandardMaterial({ color: 0x3498db });
const cube = new THREE.Mesh(geo, mat);
cube.name = 'MyCube';
cube.position.set(0, 1, 0);
scene.add(cube);
```

---

## 5. ECS (Entity-Component-System)

BlindFake uses an ECS architecture for game logic:

### Entities
Containers that hold components:
```typescript
const player = engine.world.createEntity('Player');
```

### Components
Data attached to entities:
```typescript
import { TransformComponent, MeshComponent, PhysicsBodyComponent } from './ecs/components/GameComponents';

player
  .add(new TransformComponent().setPosition(0, 2, 0))
  .add(new MeshComponent(playerMesh))
  .add(new PhysicsBodyComponent())
  .addTag('player');
```

### Systems
Logic that operates on entities with specific components:
```typescript
class MovementSystem extends System {
  requiredComponents = [TransformComponent, PhysicsBodyComponent];

  update(delta: number): void {
    for (const entity of this.getEntities()) {
      const transform = entity.get(TransformComponent);
      const body = entity.get(PhysicsBodyComponent);
      // movement logic...
    }
  }
}
```

---

## 6. Physics

BlindFake uses **Rapier3D** (WASM) for physics:

```typescript
// Add physics to an entity
player.add(new PhysicsBodyComponent());

// The PhysicsSystem handles simulation automatically
// Configure body type:
const body = player.get(PhysicsBodyComponent);
body.bodyType = 'dynamic'; // 'static', 'dynamic', 'kinematic'
body.mass = 1.0;
```

---

## 7. 2D Games

### Sprites
```typescript
import { SpriteSheet, Sprite2D, Camera2D } from './2d/Sprite2D';

// Load a sprite sheet
const sheet = new SpriteSheet({
  texture: myTexture,
  frameWidth: 16,
  frameHeight: 16,
  columns: 8,
  rows: 4,
});

// Create a sprite
const player = new Sprite2D(sheet);
player.setPosition(5, 3);
player.addAnimation({ name: 'walk', frames: [0,1,2,3], fps: 8, loop: true });
player.play('walk');

// 2D Camera
const cam = new Camera2D(16); // 16 pixels per unit
cam.follow(5, 3);
```

### Tilemaps
```typescript
import { Tilemap } from './2d/Sprite2D';

const tilemap = new Tilemap(tilesetSheet, 16, 16, 16);
tilemap.defineTile(1, 'grass', 0, true);
tilemap.defineTile(2, 'wall', 1, false);

tilemap.addLayer({
  name: 'ground',
  data: [
    [1, 1, 1, 1],
    [1, 2, 2, 1],
    [1, 1, 1, 1],
  ],
});

tilemap.build(); // Creates batched geometry (1 draw call per layer)
scene.add(tilemap.root);

// Dynamically change tiles:
tilemap.setTile(0, 1, 1, 1); // layerIndex, x, y, tileId
tilemap.flush(); // Rebuild dirty layers
```

### Sprite Batching
For hundreds of sprites sharing the same sprite sheet:
```typescript
import { SpriteBatch } from './2d/Sprite2D';

const batch = new SpriteBatch(sheet, 16);
batch.add(0, 0, 0);  // x, y, frame
batch.add(1, 0, 1);
batch.add(2, 0, 2);
scene.add(batch.group);

// Update positions per frame
batch.entries[0].x += delta * speed;
batch.markDirty();
batch.flush(); // Rebuilds geometry (1 draw call for all sprites)
```

---

## 8. Audio

```typescript
import { AudioManager } from './engine/AudioManager';

const audio = new AudioManager(camera);

// Load and play
await audio.load('explosion', '/assets/sounds/explosion.mp3');
audio.play('explosion', { volume: 0.8 });

// Spatial audio (3D positioned sound)
audio.play('footsteps', { position: player.position, spatial: true });

// Background music
audio.playMusic('/assets/music/theme.mp3', { loop: true, volume: 0.5 });
```

---

## 9. Saving & Exporting

### Save Project
`Ctrl+S` saves the current scene to the project (localStorage-based).

### Export Game
From the menu bar: **File â†?Export**

| Format | Description |
|--------|-------------|
| **HTML** | Single self-contained HTML file with embedded Three.js |
| **JSON** | Scene data as JSON (for external tools) |
| **ZIP** | Folder with index.html + scene.json + assets/ |
| **Desktop** | Electron-wrapped standalone executable |

---

## 10. Play Mode

Press **F9** to toggle Play Mode. This:
1. Hides the editor panels
2. Enables physics simulation
3. Activates game scripts and player controls
4. Shows the game as players would see it

Press **F9** again to return to the editor. All scene changes during play mode are reverted.

---

## 11. Visual Scripting

For non-programmers, the **Visual Script Editor** lets you create game logic with nodes:

1. Open the Visual Script tab
2. Right-click to add nodes:
   - **Events**: On Start, On Update, On Collision
   - **Actions**: Move, Rotate, Play Sound, Spawn Object
   - **Logic**: If/Else, And/Or, Compare
   - **Variables**: Get/Set number, string, boolean
3. Connect node ports by dragging
4. The script compiles to runtime code automatically

---

## 12. Multiplayer

BlindFake includes a WebSocket-based multiplayer server:

```typescript
import { NetworkManager } from './network/NetworkManager';

const net = new NetworkManager('ws://localhost:4000/ws');
net.connect('PlayerName');

// Create/join rooms
net.createRoom('My Room', 8);
net.joinRoom(roomId);

// Sync player state
net.sendState({ position, rotation, animation });

// Listen for other players
net.onPlayerJoin((playerId, name) => { ... });
net.onPlayerState((playerId, state) => { ... });
```

---

## Next Steps
- Read the [API Reference](./API.md) for detailed class documentation
- Follow the [Tutorials](./tutorials/) for step-by-step game creation guides
- Check the [Roadmap](../ROADMAP.md) for upcoming features

---

*BlindFake: Phantom v0.1.0 â€?https://github.com/FoRest988/BlindFake-Engine*
