# BlindFake: Phantom

> **Phantom Edition — v0.2.0**

A full-featured 3D/2D web game engine with a Unity/Unreal-style editor, ECS architecture, visual scripting, terrain editing, cinematics, particle systems, AI, physics, and multiplayer — all running in the browser.

> **Status:** Private repository — heading toward public Beta release.

---

## New in Phantom Edition (v0.2.0)

20-phase rework delivering production-quality systems across every layer of the engine.

| Phase | Feature |
|-------|---------|
| 1 | Rebrand to BlindFake: Phantom |
| 2 | Performance: Physics Worker, Object Pool, Memory Budget |
| 3 | Rendering: WebGPU pathway, static batching, LOD, shadow tiers |
| 4 | Asset Pipeline: KTX2, streaming queue, LRU cache |
| 5 | ECS: archetype query cache, system graph, component pooling |
| 6 | Editor Architecture: typed EventBus, KeybindEditor, PanelPersistence |
| 7 | Viewport: render overlays, F8 profiler, camera bookmarks, 4-way split |
| 8 | Terrain: GPU-instanced foliage painting, water wave config |
| 9–13 | Texture, Modeling, Animation, Visual Scripting, Lua Scripting |
| 14 | Templates: Fighting, Racing, Puzzle/Adventure |
| 15 | Network: Room management, entity replication, client prediction |
| 16 | Audio: Mixer buses, DSP effects (chorus/limiter/phaser), adaptive music, HRTF |
| 17 | **UI System**: full widget set, anchor presets, theme engine, world-space UI |
| 18 | **Mobile & PWA**: touch gestures, virtual joystick, PWA manifest |
| 19 | **Testing & Stability**: 345 tests, BenchmarkRunner utility, performance budgets |
| 20 | **Website, Docs & Community Launch** |

### Phase 17 — UI System

`client/src/engine/UISystem.ts` — Canvas-overlay 2D UI with full widget set:
- Widgets: `UIPanel`, `UILabel`, `UIButton`, `UIProgressBar`, `UISlider`, `UIToggle`, `UIImage`, `UIScrollView`
- `UICanvas` root container with pointer input routing, z-ordering, `getWidgets()`
- 9 anchor presets (`top-left` → `stretch-full`) for responsive layouts
- Themeable via `UITheme` / `DEFAULT_THEME` — colors, fonts, border radius, padding
- `WorldSpaceUI` interface for billboard UI on 3D objects

### Phase 18 — Mobile & PWA

`client/src/engine/TouchInputManager.ts`:
- Unified Pointer Events API — works on touch and mouse/pen
- Gestures: `tap`, `doubletap`, `longpress`, `swipe`, `pinch`, `pan`, `pointerraw`
- Up to 10 simultaneous pointers, configurable thresholds via `TouchManagerConfig`

`client/src/engine/VirtualJoystick.ts`:
- `fixed` or `follow` mode with dead zone and normalised axis output
- 8-directional snapping (`JoystickDirection8`)
- `DualJoystickController` for left/right split-screen on mobile
- `render(ctx)` method for Canvas-overlay drawing

### Phase 19 — Testing & Stability

`client/src/engine/Benchmark.ts`:
- `BenchmarkRunner` — suites with warmup, statistical reporting (min/max/mean/median/p95/stddev/opsPerSec)
- `time(label, fn)` — single-shot timing helper
- `assertUnder(budgetMs, fn)` — performance budget assertion (throws on regression)

**Test suite**: 345 tests across 36 files — all green, zero TypeScript errors.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Rendering** | Three.js 0.170 (WebGL 2) |
| **Language** | TypeScript 5.6 (strict mode) |
| **Physics** | Rapier 3D (WASM) |
| **Build** | Vite 6.0 with HMR |
| **Architecture** | ECS (Entity → Component → System) |
| **Scripting** | Visual node graphs + Lua (cinematics) |
| **Server** | Node.js + Express + WebSocket |
| **Audio** | Web Audio API with spatial 3D sound |

---

## Getting Started

```bash
# Install dependencies
npm install

# Run client + server (dev mode)
npm run dev:all

# Client only
npm run dev

# Server only
npm run dev:server

# Production build
npm run build
```

Open `http://localhost:3000` in a modern browser.

You can also double-click **start-server.bat** on Windows.

---

## Landing Page

On launch you get a **Unity Hub / Roblox Studio-style** project selector:

- Recent projects stored in localStorage
- Create new project (3D or 2D template)
- Learning section with quick links
- Project management (delete, restore)

---

## Editor

The editor is a complete development environment with multiple tabs and floating panels.

### Scene Tab (Main)

| Panel | Features |
|-------|----------|
| **Viewport 3D** | Orientation gizmos, configurable grid, orbit/pan/zoom, axis navigation |
| **Hierarchy** | Scene tree with select, rename, drag-reorder, search |
| **Inspector** | Transform, material, light, shadows, ECS components, physics, scripts |
| **Timeline** | Keyframe animation editor |
| **Console** | Logs, warnings, errors — filterable |
| **Asset Browser** | Grid/list view, drag-and-drop to viewport, import .glb/.gltf with textures |
| **Material Editor** | PBR properties, live preview sphere, texture slots |
| **Engine Systems** | Weather, post-processing, particles, audio, splines, plugins config |

### Terrain Tab

- Real-time 3D preview with orbit camera
- **Brushes:** Raise, Lower, Smooth, Flatten, Paint
- 4 texture layers with splatmap blending (GLSL shader)
- Multi-tile terrain grid system — add tiles in any direction
- Import/export heightmaps (PNG grayscale)
- Apply to Scene with progress bar (batched processing)
- Collision mesh generation

### Blueprints Tab (Visual Scripting)

- Node-based graph editor (drag, connect, delete)
- Node categories: Events, Actions, Conditions, Variables, Math, Flow Control
- Data flow + execution flow sockets
- Compile to runtime-executable graph
- Copy/paste, undo, search palette, mini-map

### Animation Tab

- Expanded animation timeline
- State machine graph editor (drag states, draw transitions)
- Blend trees (1D parameter-based blending)
- Layer system with additive/override modes

### Cinematic Tab

- Multi-track sequencer timeline
- Tracks: Camera Position, LookAt, FOV, Subtitles, Events, Fade
- Keyframe editing with detailed property panels
- Capture camera from editor viewport
- Playback preview with animated playhead

### Editor Features

- **Play/Stop/Pause** — test your game in the viewport (physics, player controls, game systems)
- **Undo/Redo** — full history for transforms, properties, materials, add/remove
- **Multi-Select** — Shift+click, Ctrl+A, selection badges with batch operations
- **Autosave** — configurable interval to localStorage
- **Drag-Drop Assets** — drag models from Asset Browser to viewport with raycast placement
- **Layout Presets** — Default, Wide, Animation, Scripting, Compact + custom layouts
- **Custom Keybinds** — editable keyboard shortcuts
- **Scene Versioning** — version history with restore
- **Preferences** — snap, grid, camera speed, 25+ CSS theme variables
- **Export to HTML** — one-click standalone game export with loading screen, FPS controls

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| W / E / R / Q | Translate / Rotate / Scale / Select tool |
| Delete | Delete selected object |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+S | Save scene |
| Ctrl+C / Ctrl+V | Copy / Paste |
| Ctrl+D | Duplicate |
| Ctrl+A | Select all |
| F | Focus on selected object |
| H | Toggle visibility |
| G | Toggle grid |
| 1 / 2 | Toggle wireframe / bones |
| F9 | Toggle Play Mode |

---

## Engine Systems (57 modules)

### Core

| System | Description |
|--------|-------------|
| **Engine** | Game loop, renderer, camera, subsystem orchestration |
| **ECS World** | Entity creation/destruction, component queries, system scheduling |
| **Event Bus** | Global pub/sub with once-listeners and event replay |
| **Input Manager** | Keyboard, mouse, gamepad with raw + action-based input mapping |
| **Scene Manager** | Scene lifecycle (load, unload, switch, transitions) |
| **Save Manager** | Save/load slots with thumbnails |
| **Timer / Tween** | Countdown timers + procedural animations with 20+ easing functions |
| **Object Pool** | Generic pooling for bullets, particles, effects |
| **Hot Reload** | Vite HMR integration for live code changes |
| **Worker Manager** | Web Worker pool for async background tasks |
| **Plugin System** | Extensible hooks (init, update, editor events, custom panels) |
| **Profiler** | Frame timing instrumentation + performance monitor |

### Rendering & Graphics

| System | Description |
|--------|-------------|
| **Post-Processing** | Bloom, Vignette, Color Grading, FXAA, DOF, Motion Blur, Chromatic Aberration |
| **LOD System** | Automatic Level-of-Detail with geometry simplification |
| **Instanced Renderer** | GPU-instanced rendering for forests, crowds, etc. |
| **Billboard System** | Camera-facing sprites with sheet animation |
| **Decal System** | Projected decals onto surfaces with pooling |
| **Occlusion Culling** | Hierarchical frustum + software occlusion + portal culling + distance LOD |
| **Light Probes** | Indirect lighting probes with SH sampling |
| **Material Library** | PBR material presets and management |
| **Sky System** | Dynamic sky (atmospheric scattering, day/night) |
| **Water System** | Reflective/refractive water planes |
| **Fog System** | Distance + height-based fog with exponential density |
| **Vegetation System** | Grass and tree scattering on terrain |
| **WebGPU Renderer** | Next-gen rendering backend (experimental) |

### Terrain

| Feature | Description |
|---------|-------------|
| **Heightmap terrain** | Custom GLSL shader with 4-layer splatmap blending |
| **Brush editing** | Raise, Lower, Smooth, Flatten, Paint — all real-time |
| **Multi-tile grid** | Seamless tile system, add tiles in any direction |
| **Import/Export** | PNG grayscale heightmaps |
| **Collision mesh** | Auto-generated for physics |
| **Resolution** | Up to 512x512 vertices per tile (safe for all browsers) |

### Physics (Rapier 3D)

| Feature | Description |
|---------|-------------|
| **Rigid bodies** | Dynamic, static, kinematic |
| **Colliders** | Box, sphere, capsule, trimesh, heightfield |
| **Character controller** | Grounded detection, velocity-based movement |
| **Ragdoll** | Multi-joint ragdoll physics for character impact |
| **Cloth simulation** | Verlet-integration cloth with tearing, pinning, sphere/plane colliders |
| **Joints** | Ball, revolute, prismatic, fixed |

### Audio

| Feature | Description |
|---------|-------------|
| **Audio Manager** | Groups: SFX, Music, Ambient, UI, Voice — independent volume |
| **3D Spatial Sound** | PannerNode with distance attenuation |
| **Playlist** | Shuffle, crossfade, queue |
| **Audio Effects** | Reverb, delay, EQ chain, snapshot system |
| **Music Layers** | Vertical remixing (additive layers with fading) |

### Animation

| Feature | Description |
|---------|-------------|
| **Animation State Machine** | States, transitions, parameters (float/int/bool/trigger) |
| **Blend Trees** | 1D parameter-based animation blending |
| **Layers** | Additive/Override with per-bone masking |
| **IK System** | Inverse Kinematics limb solver (CCD) |

### Particles

| Feature | Description |
|---------|-------------|
| **Particle System** | Configurable emitters (point, sphere, box, cone) |
| **Presets** | Fire, Debris, Magic, Sparkle, Snow, Rain, Smoke |
| **Visual Editor** | Real-time parameter tuning in Inspector panel |

### AI & Navigation

| Feature | Description |
|---------|-------------|
| **Behavior Trees** | Sequence, Selector, Parallel + decorators (Inverter, Repeater, Cooldown, Condition) |
| **A\* Pathfinding** | Grid-based with octile heuristic, path smoothing, dynamic obstacles |
| **NavMesh** | Polygon-based navigation with A* search, edge links, area costs, string-pulling |
| **State Machines** | Generic FSM with history stack, parallel regions |

### Camera

| Feature | Description |
|---------|-------------|
| **Camera Effects** | Trauma-based shake, zoom punch, FOV kick, slow motion, dutch tilt |
| **Cinematic Bars** | Letterbox with animated transitions |
| **Scene Transitions** | Fade, slide, custom shaders |

### UI

| Feature | Description |
|---------|-------------|
| **UI Manager** | In-game widgets (label, button, progress, image, panel, notifications) |
| **UI Editor** | Visual layout editor with drag, resize, zoom, pan |
| **Minimap** | Configurable minimap overlay with entity tracking |
| **Damage Popups** | Floating damage numbers with animation |

### Spline Paths

| Feature | Description |
|---------|-------------|
| **Spline Path System** | CatmullRom paths for movement, camera rails, collision walls |
| **Visual Drawing** | Click-to-place drawing mode — left-click places points, right-click finishes |
| **Path Follower** | Speed, easing, loop/pingpong modes, look-ahead alignment |

### Cinematics

| Feature | Description |
|---------|-------------|
| **Cinematic Engine** | Multi-track keyframe sequencer |
| **Lua Scripting** | Custom Lua parser for cinematic definitions |
| **Track Types** | Camera, LookAt, FOV, Subtitles, Events, Fade, Wait |

### Networking

| Feature | Description |
|---------|-------------|
| **WebSocket** | Room-based multiplayer (up to 8 players) |
| **Modes** | Story co-op, PvP, Explore |
| **Sync** | Position/rotation sync, entity spawning |
| **Chat** | In-game chat + auto-reconnect |

### Gameplay Systems

| System | Description |
|--------|-------------|
| **Inventory** | Item slots, stacking, equipment |
| **Abilities** | Cooldown-based skills with combo chains |
| **Status Effects** | Buffs/debuffs with stacking, timed duration |
| **Dialogue** | Branching dialogue trees with choices |
| **Quests** | Multi-objective quest tracking |
| **Achievements** | Condition-based unlock system |
| **Spawn System** | Entity spawning with wave management |

### 2D Systems

| System | Description |
|--------|-------------|
| **Sprite2D** | 2D sprite rendering with animation |
| **Physics2D** | 2D collision and physics |

---

## Game Controls (Play Mode)

| Key | Action |
|-----|--------|
| WASD / Arrows | Move |
| Space | Jump |
| Mouse | Look around (pointer lock) |
| Shift | Sprint |

---

## Export / Build

**File → Export Game HTML** produces a standalone HTML file containing:

- Full Three.js runtime (CDN)
- Serialized scene data with embedded textures
- Loading screen with progress bar
- **FPS controls** — click to enter pointer lock, WASD + mouse look, Space/C for up/down
- **Orbit controls** fallback when pointer lock is not active

---

## Asset Pipeline

### Importing 3D Models

1. Model and animate in 3ds Max, Blender, or any DCC tool
2. Export as **.glb** (recommended) or **.gltf** + texture files
3. In the editor: **Asset Browser → Import** or drag-drop into viewport
4. Textures are auto-resolved (supports spaces in filenames, UUID-prefixed names)

### Supported Formats

| Type | Formats |
|------|---------|
| Models | .glb, .gltf |
| Textures | .png, .jpg, .jpeg (auto-configured colorSpace) |
| Audio | via Web Audio API |
| Heightmaps | .png (grayscale) |

---

## Project Structure

```
BlindFake/
├── client/
│   ├── src/
│   │   ├── main.ts                    # Entry point
│   │   ├── LandingPage.ts             # Project selector (Unity Hub style)
│   │   ├── engine/                    # Engine core (57 modules)
│   │   │   ├── Engine.ts              # Game loop, renderer, subsystems
│   │   │   ├── RapierPhysics.ts       # Rapier 3D physics wrapper
│   │   │   ├── TerrainSystem.ts       # Heightmap terrain
│   │   │   ├── PostProcessing.ts      # Bloom, SSAO, DOF, etc.
│   │   │   ├── AudioManager.ts        # 3D spatial audio
│   │   │   ├── ParticleSystem.ts      # Particle emitters
│   │   │   ├── NavMeshSystem.ts       # Navigation mesh + A*
│   │   │   ├── AnimationStateMachine.ts
│   │   │   ├── SplinePathSystem.ts    # Spline paths + followers
│   │   │   ├── GameExporter.ts        # HTML export
│   │   │   └── ... (47 more)
│   │   ├── ecs/                       # Entity Component System
│   │   │   ├── World.ts / Entity.ts / Component.ts / System.ts
│   │   │   ├── components/            # Transform, Mesh, Physics, Light, Script
│   │   │   └── systems/               # Render, Physics, Animation, AI, CharCtrl
│   │   ├── editor/                    # Full editor (31 files)
│   │   │   ├── EditorApp.ts           # Main orchestrator
│   │   │   ├── PlayModeSystem.ts      # Play/Pause/Stop with snapshot
│   │   │   ├── TerrainEditorPanel.ts  # Terrain brushes + tiles
│   │   │   ├── UndoManager.ts         # Undo/redo stack
│   │   │   └── panels/               # 15 editor panels
│   │   │       ├── VisualScriptEditor.ts
│   │   │       ├── AssetBrowser.ts
│   │   │       ├── EditorHierarchy.ts
│   │   │       ├── EditorInspector.ts
│   │   │       ├── MaterialEditor.ts
│   │   │       └── ...
│   │   ├── ai/                        # Behavior Trees, Pathfinding, FSM
│   │   ├── gameplay/                  # Inventory, Abilities, Quests, Dialogue
│   │   ├── cinematics/                # Cinematic engine + Lua runner
│   │   ├── network/                   # WebSocket multiplayer
│   │   ├── 2d/                        # 2D sprite + physics
│   │   └── styles/                    # CSS (main, editor, landing)
│   └── index.html
├── server/src/index.ts                # Express + WebSocket server
├── shared/types.ts                    # Shared client/server types
├── vite.config.ts                     # Vite config (HMR, proxy, aliases)
├── tsconfig.json                      # TypeScript config
├── package.json
└── start-server.bat                   # Windows launcher
```

---

## Development

```bash
# Type check (no emit)
npx tsc --noEmit

# Dev mode with HMR
npm run dev:all
```

### Path Aliases (vite.config.ts)

| Alias | Path |
|-------|------|
| `@engine` | `client/src/engine` |
| `@editor` | `client/src/editor` |
| `@game` | `client/src/gameplay` |
| `@shared` | `shared/` |

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| three | ^0.170.0 | 3D rendering |
| @dimforge/rapier3d-compat | ^0.19.3 | Physics engine (WASM) |
| express | ^4.21.0 | HTTP server |
| ws | ^8.18.0 | WebSocket |
| fengari-web | ^0.1.4 | Lua runtime |
| uuid | ^10.0.0 | Unique IDs |
| typescript | ^5.6.0 | Language |
| vite | ^6.0.0 | Build tool |

---

## License

MIT
