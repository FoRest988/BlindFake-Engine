# BlindFake: Phantom — API Reference

Complete class and module reference for BlindFake: Phantom v0.2.0-phantom.

---

## Table of Contents
1. [Engine Core](#engine-core)
2. [ECS (Entity-Component-System)](#ecs)
3. [Rendering & Scene](#rendering--scene)
4. [Physics](#physics)
5. [2D System](#2d-system)
6. [Audio](#audio)
7. [Input](#input)
8. [Animation](#animation)
9. [AI & Navigation](#ai--navigation)
10. [Gameplay Systems](#gameplay-systems)
11. [Editor](#editor)
12. [Network](#network)
13. [Build & Export](#build--export)
14. [Utilities](#utilities)

---

## Engine Core

### `Engine` �?`engine/Engine.ts`
Main engine class. Manages the renderer, scene, camera, input, and game loop.

| Property | Type | Description |
|----------|------|-------------|
| `renderer` | `THREE.WebGLRenderer` | The WebGL renderer |
| `camera` | `THREE.PerspectiveCamera` | Main camera |
| `world` | `World` | ECS world |
| `input` | `InputManager` | Input system |
| `scenes` | `SceneManager` | Scene management |
| `fps` | `number` | Current FPS (read-only) |
| `editorActive` | `boolean` | Whether editor mode is active |
| `onUpdate` | `(delta, elapsed) => void` | Game update callback |

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `void` | Start the game loop |
| `stop()` | `void` | Stop the game loop |
| `dispose()` | `void` | Clean up all resources |

### `SceneManager` �?`engine/SceneManager.ts`
Manages multiple Three.js scenes.

| Method | Returns | Description |
|--------|---------|-------------|
| `create(name)` | `THREE.Scene` | Create a new scene |
| `get(name)` | `THREE.Scene \| undefined` | Get scene by name |
| `setActive(name)` | `void` | Set the active scene |
| `addDefaultLighting(scene)` | `void` | Add ambient + directional light |
| `remove(name)` | `void` | Remove and dispose a scene |

### `EventBus` �?`engine/EventBus.ts`
Global event system for decoupled communication.

| Method | Returns | Description |
|--------|---------|-------------|
| `on(event, callback)` | `void` | Subscribe to an event |
| `off(event, callback)` | `void` | Unsubscribe |
| `emit(event, ...args)` | `void` | Emit an event |
| `once(event, callback)` | `void` | Subscribe once |

### `Timer` �?`engine/Timer.ts`
Frame-accurate timer for game logic.

| Method | Returns | Description |
|--------|---------|-------------|
| `after(seconds, callback)` | `TimerHandle` | Execute after delay |
| `every(seconds, callback)` | `TimerHandle` | Execute repeatedly |
| `cancel(handle)` | `void` | Cancel a timer |
| `update(delta)` | `void` | Advance timers |

---

## ECS

### `World` �?`ecs/World.ts`
Container for all entities and systems.

| Method | Returns | Description |
|--------|---------|-------------|
| `createEntity(name?)` | `Entity` | Create a new entity |
| `destroyEntity(entity)` | `void` | Destroy an entity |
| `getEntity(id)` | `Entity \| undefined` | Find entity by ID |
| `getEntitiesByTag(tag)` | `Entity[]` | Find entities with tag |
| `addSystem(system)` | `void` | Register a system |
| `getSystem(SystemClass)` | `System \| undefined` | Get a system instance |
| `update(delta)` | `void` | Update all systems |
| `entityCount` | `number` | Total entity count |

### `Entity` �?`ecs/Entity.ts`
An entity in the ECS world.

| Method | Returns | Description |
|--------|---------|-------------|
| `add(component)` | `this` | Add a component |
| `remove(ComponentClass)` | `this` | Remove a component |
| `get(ComponentClass)` | `T` | Get a component |
| `has(ComponentClass)` | `boolean` | Check for component |
| `addTag(tag)` | `this` | Add a tag |
| `hasTag(tag)` | `boolean` | Check for tag |
| `removeTag(tag)` | `this` | Remove a tag |

### `System` �?`ecs/System.ts`
Base class for ECS systems.

| Property | Type | Description |
|----------|------|-------------|
| `requiredComponents` | `ComponentClass[]` | Components an entity must have |
| `enabled` | `boolean` | Whether system runs |

| Method | Returns | Description |
|--------|---------|-------------|
| `update(delta)` | `void` | Called each frame (override) |
| `getEntities()` | `Entity[]` | Get matching entities |

### Built-in Components �?`ecs/components/GameComponents.ts`

| Component | Properties | Description |
|-----------|------------|-------------|
| `TransformComponent` | `position, rotation, scale` | 3D transform |
| `MeshComponent` | `mesh` | Three.js mesh renderer |
| `PhysicsBodyComponent` | `bodyType, mass, velocity, grounded` | Rapier physics body |
| `CameraFollowComponent` | `offset, smoothing` | Camera follow target |

---

## Rendering & Scene

### `PostProcessing` �?`engine/PostProcessing.ts`
Screen-space effects pipeline.

| Method | Returns | Description |
|--------|---------|-------------|
| `addBloom(threshold, strength, radius)` | `void` | HDR bloom |
| `addSSAO(radius, intensity)` | `void` | Screen-space AO |
| `addFXAA()` | `void` | Anti-aliasing |
| `setToneMapping(type)` | `void` | ACES, Reinhard, Cineon |
| `render(scene, camera)` | `void` | Render with effects |

### `InstancedRenderer` �?`engine/InstancedRenderer.ts`
Efficient rendering of many identical meshes.

| Method | Returns | Description |
|--------|---------|-------------|
| `create(geometry, material, count)` | `InstanceGroup` | Create instance group |
| `setTransform(group, index, matrix)` | `void` | Set instance transform |
| `setColor(group, index, color)` | `void` | Set instance color |
| `update()` | `void` | Upload changes to GPU |

### `LODSystem` �?`engine/LODSystem.ts`
Level-of-detail management.

| Method | Returns | Description |
|--------|---------|-------------|
| `register(object, levels)` | `void` | Register LOD levels |
| `update(camera)` | `void` | Update LOD selections |

### `OcclusionCulling` �?`engine/OcclusionCulling.ts`
Frustum and occlusion culling.

| Method | Returns | Description |
|--------|---------|-------------|
| `update(camera, scene)` | `CullResult` | Cull invisible objects |

### `DecalSystem` �?`engine/DecalSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `project(position, normal, size, texture)` | `THREE.Mesh` | Project decal onto surface |

### `BillboardSystem` �?`engine/BillboardSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `add(object)` | `void` | Make object always face camera |
| `update(camera)` | `void` | Update billboard rotations |

### `TrailRenderer` �?`engine/TrailRenderer.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `create(options)` | `Trail` | Create a trail effect |
| `update(delta)` | `void` | Update all trails |

---

## Physics

### `RapierPhysics` �?`engine/RapierPhysics.ts`
Rapier3D physics world wrapper.

| Method | Returns | Description |
|--------|---------|-------------|
| `init()` | `Promise<void>` | Initialize WASM physics |
| `createRigidBody(options)` | `RigidBody` | Create a physics body |
| `createCollider(body, shape)` | `Collider` | Attach collision shape |
| `raycast(origin, direction, maxDist)` | `RayHit \| null` | Cast a ray |
| `step(delta)` | `void` | Advance simulation |

### `RagdollSystem` �?`engine/RagdollSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `create(skeleton, options)` | `Ragdoll` | Create ragdoll from skeleton |
| `activate(ragdoll)` | `void` | Switch to ragdoll mode |
| `deactivate(ragdoll)` | `void` | Return to animation |

---

## 2D System

### `SpriteSheet` �?`2d/Sprite2D.ts`
Manages a texture atlas with uniform frame sizes.

| Constructor | `SpriteSheet(config: SpriteSheetConfig)` |
|-------------|------------------------------------------|

| Property | Type | Description |
|----------|------|-------------|
| `texture` | `THREE.Texture` | Atlas texture |
| `frames` | `SpriteFrame[]` | All frame definitions |
| `frameWidth/frameHeight` | `number` | Frame dimensions in pixels |
| `columns/rows` | `number` | Grid dimensions |

| Method | Returns | Description |
|--------|---------|-------------|
| `getFrameUVs(frameIndex)` | `{offsetX, offsetY, repeatX, repeatY}` | Get UV coords for a frame |

### `Sprite2D` �?`2d/Sprite2D.ts`
Individual 2D sprite with animation support.

| Constructor | `Sprite2D(texture, width?, height?, pixelsPerUnit?)` |
|-------------|------------------------------------------------------|

| Property | Type | Description |
|----------|------|-------------|
| `mesh` | `THREE.Mesh` | The renderable mesh |
| `spriteSheet` | `SpriteSheet \| null` | Source sprite sheet |
| `layer` | `number` | Z-order (higher = in front) |
| `flipX/flipY` | `boolean` | Flip sprite |
| `anchor` | `{x, y}` | Pivot point (0-1) |
| `tint` | `THREE.Color` | Color tint |

| Method | Returns | Description |
|--------|---------|-------------|
| `addAnimation(clip)` | `this` | Register animation clip |
| `play(name)` | `void` | Play named animation |
| `stop()` | `void` | Stop animation |
| `setFrame(index)` | `void` | Set sprite sheet frame |
| `setPosition(x, y)` | `void` | Set world position |
| `setScale(x, y)` | `void` | Set scale |
| `setRotation(angle)` | `void` | Set rotation (radians) |
| `setOpacity(alpha)` | `void` | Set opacity (0-1) |
| `update(delta)` | `void` | Advance animation |
| `dispose()` | `void` | Clean up resources |

### `Camera2D` �?`2d/Sprite2D.ts`
Orthographic camera for 2D games.

| Method | Returns | Description |
|--------|---------|-------------|
| `follow(x, y)` | `void` | Set follow target |
| `shake(intensity, duration)` | `void` | Camera shake |
| `setBounds(minX, minY, maxX, maxY)` | `void` | Clamp camera to bounds |
| `screenToWorld(screenX, screenY)` | `{x, y}` | Convert screen to world coords |
| `update(delta)` | `void` | Update camera |
| `resize(width, height)` | `void` | Handle viewport resize |

### `Tilemap` �?`2d/Sprite2D.ts`
Grid-based tile map with batched rendering.

| Constructor | `Tilemap(tilesetSheet, tileWidth, tileHeight, pixelsPerUnit?)` |
|-------------|----------------------------------------------------------------|

| Method | Returns | Description |
|--------|---------|-------------|
| `defineTile(id, name, frame, walkable?, props?)` | `this` | Define a tile type |
| `addLayer(config)` | `TilemapLayer` | Add a tile layer |
| `build()` | `void` | Build all layer meshes |
| `flush()` | `void` | Rebuild dirty layers |
| `getTile(layer, x, y)` | `number` | Get tile ID |
| `setTile(layer, x, y, tileId)` | `void` | Set tile ID |
| `isWalkable(x, y)` | `boolean` | Check walkability |
| `worldToGrid(worldX, worldY)` | `{x, y}` | World �?grid coords |
| `gridToWorld(gridX, gridY)` | `{x, y}` | Grid �?world coords |
| `dispose()` | `void` | Clean up |

### `SpriteBatch` �?`2d/Sprite2D.ts`
Renders many sprites sharing one SpriteSheet in a single draw call.

| Constructor | `SpriteBatch(spriteSheet, pixelsPerUnit?)` |
|-------------|---------------------------------------------|

| Method | Returns | Description |
|--------|---------|-------------|
| `add(x, y, frame?, layer?)` | `number` | Add sprite, returns index |
| `markDirty()` | `void` | Flag for rebuild |
| `flush()` | `void` | Rebuild if dirty |
| `dispose()` | `void` | Clean up |

---

## Audio

### `AudioManager` �?`engine/AudioManager.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `load(name, url)` | `Promise<void>` | Load audio file |
| `play(name, options?)` | `AudioSource` | Play a sound |
| `playMusic(url, options?)` | `void` | Play background music |
| `stopMusic()` | `void` | Stop music |
| `setMasterVolume(vol)` | `void` | Set master volume (0-1) |
| `setSFXVolume(vol)` | `void` | Set SFX volume |
| `setMusicVolume(vol)` | `void` | Set music volume |
| `stopAll()` | `void` | Stop everything |
| `dispose()` | `void` | Clean up |

### `AudioEffects` �?`engine/AudioEffects.ts`
Audio effect nodes (reverb, delay, distortion, EQ).

---

## Input

### `InputManager` �?`engine/InputManager.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `isKeyDown(key)` | `boolean` | Key currently held |
| `isKeyJustPressed(key)` | `boolean` | Key pressed this frame |
| `isKeyJustReleased(key)` | `boolean` | Key released this frame |
| `isMouseDown(button)` | `boolean` | Mouse button held |
| `getMousePosition()` | `{x, y}` | Mouse screen position |
| `getMouseDelta()` | `{x, y}` | Mouse movement delta |
| `getScrollDelta()` | `number` | Scroll wheel delta |

### `InputActions` �?`engine/InputActions.ts`
Action-mapping system (bind actions to keys/buttons).

| Method | Returns | Description |
|--------|---------|-------------|
| `define(action, keys)` | `void` | Define an input action |
| `isActive(action)` | `boolean` | Check if action is active |
| `getAxis(negative, positive)` | `number` | Get axis value (-1 to 1) |

---

## Animation

### `AnimationStateMachine` �?`engine/AnimationStateMachine.ts`
State machine for animation blending and transitions.

| Method | Returns | Description |
|--------|---------|-------------|
| `addState(name, clip)` | `void` | Add animation state |
| `addTransition(from, to, condition)` | `void` | Add transition rule |
| `play(state)` | `void` | Force play a state |
| `setParameter(name, value)` | `void` | Set a condition parameter |
| `update(delta)` | `void` | Advance state machine |

### `IKSystem` �?`engine/IKSystem.ts`
Inverse kinematics for procedural animation.

| Method | Returns | Description |
|--------|---------|-------------|
| `createChain(bones, target)` | `IKChain` | Create an IK chain |
| `solve(chain)` | `void` | Solve IK for a chain |

### `TweenManager` �?`engine/TweenManager.ts`
Property interpolation system.

| Method | Returns | Description |
|--------|---------|-------------|
| `to(target, properties, duration)` | `Tween` | Tween to values |
| `from(target, properties, duration)` | `Tween` | Tween from values |
| `update(delta)` | `void` | Advance all tweens |

---

## AI & Navigation

### `NavMeshSystem` �?`engine/NavMeshSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `build(geometry)` | `void` | Build navmesh from geometry |
| `findPath(start, end)` | `Vector3[]` | A* pathfinding |
| `getClosestPoint(position)` | `Vector3` | Snap to navmesh |

### `BehaviorTree` �?`gameplay/BehaviorTree.ts`
AI behavior tree system.

| Node Types | Description |
|------------|-------------|
| `Selector` | Try children until one succeeds |
| `Sequence` | Run children in order, fail on first failure |
| `Condition` | Check a boolean condition |
| `Action` | Execute a game action |
| `Repeater` | Repeat child N times |
| `Inverter` | Invert child result |

---

## Gameplay Systems

### `InventorySystem` �?`gameplay/InventorySystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `addItem(entityId, item)` | `boolean` | Add item to inventory |
| `removeItem(entityId, itemId)` | `boolean` | Remove item |
| `getItems(entityId)` | `Item[]` | Get all items |
| `hasItem(entityId, itemId)` | `boolean` | Check for item |

### `QuestSystem` �?`gameplay/QuestSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `addQuest(quest)` | `void` | Register a quest |
| `startQuest(questId)` | `void` | Begin a quest |
| `completeObjective(questId, objectiveId)` | `void` | Mark objective done |
| `isComplete(questId)` | `boolean` | Check completion |

### `DialogueSystem` �?`gameplay/DialogueSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `loadDialogue(tree)` | `void` | Load dialogue tree |
| `start(nodeId)` | `DialogueNode` | Start dialogue |
| `choose(optionIndex)` | `DialogueNode` | Choose response |

### `AbilitySystem` �?`gameplay/AbilitySystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `registerAbility(ability)` | `void` | Register an ability |
| `cast(entityId, abilityId)` | `boolean` | Use ability |
| `getCooldown(entityId, abilityId)` | `number` | Remaining cooldown |

### `AchievementSystem` �?`gameplay/AchievementSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `define(id, name, condition)` | `void` | Define achievement |
| `check(event)` | `void` | Check achievements against event |
| `getUnlocked()` | `Achievement[]` | Get unlocked achievements |

### `SpawnSystem` �?`gameplay/SpawnSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `addSpawner(config)` | `Spawner` | Create a spawn point |
| `update(delta)` | `void` | Process spawn timers |

### `StatusEffectSystem` �?`gameplay/StatusEffectSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `apply(entityId, effect)` | `void` | Apply status effect |
| `remove(entityId, effectId)` | `void` | Remove effect |
| `update(delta)` | `void` | Tick all effects |

---

## Editor

### `UndoManager` �?`editor/UndoManager.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `execute(command)` | `void` | Execute and push to stack |
| `pushDirect(command)` | `void` | Push without executing |
| `undo()` | `boolean` | Undo last command |
| `redo()` | `boolean` | Redo |
| `canUndo/canRedo` | `boolean` | Check availability |
| `getHistory()` | `string[]` | Get undo labels |
| `clear()` | `void` | Clear all history |

### Built-in Undo Commands

| Command | Description |
|---------|-------------|
| `TransformCommand` | Position/rotation/scale change |
| `AddObjectCommand` | Add object to scene |
| `RemoveObjectCommand` | Remove object from scene |
| `PropertyCommand<T,K>` | Change any property on any object |
| `MaterialColorCommand` | Material color change |
| `GroupCommand` | Group multiple commands |
| `ReparentCommand` | Change object parent |

---

## Network

### `NetworkManager` �?`network/NetworkManager.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `connect(playerName)` | `Promise<void>` | Connect to server |
| `disconnect()` | `void` | Disconnect |
| `createRoom(name, maxPlayers)` | `void` | Create a room |
| `joinRoom(roomId)` | `void` | Join a room |
| `leaveRoom()` | `void` | Leave current room |
| `sendState(state)` | `void` | Send player state |
| `sendAction(action)` | `void` | Send game action |
| `sendChat(message)` | `void` | Send chat message |
| `getRooms()` | `void` | Request room list |

---

## Build & Export

### `GameExporter` �?`engine/GameExporter.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `exportAsHTML(scene, options?)` | `Promise<Blob>` | Export standalone HTML |
| `exportAsJSON(scene)` | `Blob` | Export scene as JSON |
| `exportAsFolder(scene, options?)` | `Promise<Blob>` | Export as ZIP folder |
| `download(blob, filename)` | `void` | Download a blob |

### `BuildSystem` �?`engine/BuildExportSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `build(scene)` | `Promise<BuildResult>` | Full build pipeline |
| `downloadResult(result)` | `Promise<void>` | Download build |
| `exportSceneJSON(scene, filename?)` | `void` | Quick JSON export |
| `importSceneJSON(json, scene)` | `boolean` | Import from JSON |

---

## Utilities

### `ObjectPool` �?`engine/ObjectPool.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `get()` | `T` | Get object from pool |
| `release(object)` | `void` | Return to pool |

### `Profiler` �?`engine/Profiler.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `begin(label)` | `void` | Start timing |
| `end(label)` | `number` | End timing, return ms |
| `getStats()` | `ProfileStats` | Get all stats |

### `Localization` �?`engine/Localization.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `setLocale(locale)` | `void` | Set language |
| `t(key, params?)` | `string` | Translate key |
| `loadLanguage(locale, data)` | `void` | Load translations |

### `WorkerManager` �?`engine/WorkerManager.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `run(fn, data)` | `Promise<any>` | Run function in Web Worker |
| `pool(count)` | `WorkerPool` | Create worker pool |

---

## Environment Systems

### `TerrainSystem` �?`engine/TerrainSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `getHeightAt(x, z)` | `number` | Get terrain height |
| `sculpt(x, z, radius, strength)` | `void` | Sculpt terrain |
| `paint(x, z, radius, textureIndex)` | `void` | Paint terrain |
| `generateCollisionMesh()` | `THREE.Mesh` | Get physics mesh |

### `WeatherSystem` �?`engine/WeatherSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `setWeather(type)` | `void` | Set weather (clear, rain, snow, fog) |
| `setIntensity(value)` | `void` | Set effect intensity |
| `update(delta)` | `void` | Update particles/effects |

### `WaterSystem` �?`engine/WaterSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `create(width, depth, options?)` | `Water` | Create water plane |
| `setWaveParams(height, speed)` | `void` | Configure waves |

### `SkySystem` �?`engine/SkySystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `setTimeOfDay(hours)` | `void` | Set sun position (0-24) |
| `setClouds(density, speed)` | `void` | Configure clouds |
| `update(delta)` | `void` | Animate sky |

### `FogSystem` �?`engine/FogSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `setLinear(near, far, color)` | `void` | Linear fog |
| `setExponential(density, color)` | `void` | Exponential fog |

### `VegetationSystem` �?`engine/VegetationSystem.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `scatter(terrain, density, mesh)` | `void` | Scatter vegetation |
| `setWindStrength(value)` | `void` | Animate wind |

### `LightingManager` �?`engine/LightingManager.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `addDirectional(options)` | `THREE.DirectionalLight` | Add sun light |
| `addPoint(options)` | `THREE.PointLight` | Add point light |
| `addSpot(options)` | `THREE.SpotLight` | Add spot light |
| `setAmbient(color, intensity)` | `void` | Set ambient light |
| `removeAll()` | `void` | Remove all lights |

### `CameraController` �?`engine/CameraController.ts`

| Method | Returns | Description |
|--------|---------|-------------|
| `setMode(mode)` | `void` | Set mode (orbit, fps, follow) |
| `setTarget(position)` | `void` | Set orbit/follow target |
| `update(delta)` | `void` | Update camera |

---

---

## Phantom Edition Systems

### `UICanvas` / `UIWidget` — `engine/UISystem.ts`
Canvas-overlay 2D UI system with full widget set, anchor presets, and themes.

#### `UICanvas`

| Constructor | `UICanvas(width: number, height: number)` |
|-------------|--------------------------------------------|

| Method | Returns | Description |
|--------|---------|-------------|
| `add(widget)` | `void` | Add a top-level widget |
| `remove(widget)` | `void` | Remove a widget |
| `clear()` | `void` | Remove all widgets |
| `setTheme(theme)` | `void` | Apply a `UITheme` |
| `render(ctx)` | `void` | Draw all widgets |
| `pointerDown(x, y)` | `void` | Dispatch pointer down |
| `pointerUp(x, y)` | `void` | Dispatch pointer up |
| `pointerMove(x, y)` | `void` | Dispatch pointer move |
| `resize(w, h)` | `void` | Handle viewport resize |
| `getWidgets()` | `UIWidget[]` | Get all top-level widgets |

#### Built-in Widgets

| Widget | Key Properties | Description |
|--------|----------------|-------------|
| `UIPanel` | `title`, `showBorder` | Container panel with optional title bar |
| `UILabel` | `text`, `color`, `bold`, `textAlign` | Text label |
| `UIButton` | `label`, `onClick` | Clickable button with hover/press states |
| `UIProgressBar` | `value` (0–1), `showLabel`, `labelFormat` | Horizontal progress bar |
| `UISlider` | `min`, `max`, `value`, `onChange` | Draggable value slider |
| `UIToggle` | `checked`, `label`, `onChange` | Toggle checkbox |
| `UIImage` | `image`, `tint` | Image / bitmap display |
| `UIScrollView` | `scrollY`, `contentHeight` | Scrollable container |

#### Anchor Presets
`'top-left'` | `'top-center'` | `'top-right'` | `'middle-left'` | `'middle-center'` | `'middle-right'` | `'bottom-left'` | `'bottom-center'` | `'bottom-right'` | `'stretch-full'`

---

### `TouchInputManager` — `engine/TouchInputManager.ts`
Unified touch and pointer gesture recognition.

| Constructor | `TouchInputManager(element: HTMLElement, config?: TouchManagerConfig)` |
|-------------|------------------------------------------------------------------------|

| Method | Returns | Description |
|--------|---------|-------------|
| `on(event, handler)` | `void` | Subscribe to a gesture event |
| `off(event, handler)` | `void` | Unsubscribe |
| `dispose()` | `void` | Remove all listeners |
| `activePointerCount` | `number` | Number of active pointers |
| `getActivePointers()` | `TouchPoint[]` | All currently active pointers |

#### Gesture Events

| Event | Payload | Description |
|-------|---------|-------------|
| `tap` | `TapEvent` | Single short tap |
| `doubletap` | `DoubleTapEvent` | Two taps in quick succession |
| `longpress` | `LongPressEvent` | Held without moving |
| `swipe` | `SwipeEvent` | Fast directional flick |
| `pinch` | `PinchEvent` | Two-finger zoom |
| `pan` | `PanEvent` | One-finger drag |
| `pointerraw` | `PointerRawEvent` | Raw pointer event passthrough |

#### Default Thresholds (`TouchManagerConfig`)

| Option | Default | Description |
|--------|---------|-------------|
| `tapMaxMs` | 250 | Max ms for tap |
| `tapMaxPx` | 10 | Max movement px for tap |
| `doubleTapMaxMs` | 300 | Max ms between taps |
| `longPressMs` | 600 | Hold duration for long press |
| `swipeMinPx` | 50 | Min distance for swipe |
| `swipeMaxMs` | 400 | Max ms for swipe |
| `panMinPx` | 5 | Min distance to start pan |

---

### `VirtualJoystick` — `engine/VirtualJoystick.ts`
On-screen analogue joystick for mobile/touch games.

| Constructor | `VirtualJoystick(options: JoystickOptions)` |
|-------------|---------------------------------------------|

| Property | Type | Description |
|----------|------|-------------|
| `axis` | `JoystickAxis` | `{ x, y }` normalised (-1 to 1) |
| `active` | `boolean` | Whether joystick is being held |
| `direction8` | `JoystickDirection8` | 8-way snap direction (N/NE/E/…/none) |
| `onChange` | `((axis, dir) => void) \| undefined` | Callback when axis changes |

| Method | Returns | Description |
|--------|---------|-------------|
| `pointerDown(id, x, y)` | `boolean` | Begin drag |
| `pointerMove(id, x, y)` | `void` | Update position |
| `pointerUp(id)` | `void` | Release |
| `render(ctx)` | `void` | Draw to Canvas 2D context |
| `setPosition(x, y)` | `void` | Reposition base |

#### `DualJoystickController`
Manages left + right joysticks split across a canvas.

| Constructor | `DualJoystickController(canvasWidth, canvasHeight, options?)` |
|-------------|---------------------------------------------------------------|
| `left` / `right` | `VirtualJoystick` | Access individual joysticks |
| `handlePointerDown(id, x, y)` | `void` | Route by canvas half |
| `handlePointerMove(id, x, y)` | `void` | Forward to correct joystick |
| `handlePointerUp(id)` | `void` | Release |
| `resize(w, h)` | `void` | Update canvas dimensions |
| `render(ctx)` | `void` | Draw both joysticks |

---

### `AudioMixer` — `engine/AudioMixer.ts`
Professional named-bus audio routing.

| Constructor | `AudioMixer(context: AudioContext)` |
|-------------|-------------------------------------|

| Method | Returns | Description |
|--------|---------|-------------|
| `createBus(id, name, options?)` | `MixerBus` | Create a named mix bus |
| `getBus(id)` | `MixerBus \| undefined` | Get bus by ID |
| `getMasterBus()` | `MixerBus` | Get master output bus |
| `removeBus(id)` | `void` | Remove and disconnect a bus |
| `getBusIds()` | `string[]` | List all bus IDs |
| `setSolo(id, solo)` | `void` | Toggle solo mode |
| `addSend(fromId, toId, level?)` | `void` | Route bus to another bus |
| `saveSnapshot(name)` | `void` | Save current fader/mute state |
| `recallSnapshot(name)` | `boolean` | Restore a saved snapshot |
| `dispose()` | `void` | Disconnect all buses |

#### `MixerBus` Properties

| Property | Type | Description |
|----------|------|-------------|
| `volume` | `number` | Fader level (0–∞, 1 = unity) |
| `pan` | `number` | Stereo pan (-1 to 1) |
| `mute` | `boolean` | Mute flag |
| `solo` | `boolean` | Solo flag (read) |
| `input` | `GainNode` | Connect sources here |
| `getRMS()` | `number` | Current RMS level (0–1) |

---

### `AdaptiveMusicSystem` — `engine/AdaptiveMusicSystem.ts`
State-machine driven adaptive music with layers.

| Method | Returns | Description |
|--------|---------|-------------|
| `addState(id, config)` | `void` | Define a music state with layers |
| `addTransition(from, to, condition?)` | `void` | Add state transition rule |
| `transitionTo(stateId, mode?)` | `void` | Switch state (`'crossfade'\|'immediate'`) |
| `setIntensity(value)` | `void` | Set intensity 0–1 |
| `update(delta)` | `void` | Advance crossfades |
| `dispose()` | `void` | Stop all playback |

---

### `SpatialAudioManager` — `engine/SpatialAudioManager.ts`
HRTF 3D positional audio with room acoustics.

| Method | Returns | Description |
|--------|---------|-------------|
| `registerSource(id, config)` | `void` | Register a 3D audio source |
| `setSourcePosition(id, x, y, z)` | `void` | Update source position |
| `setListenerPose(pos, forward, up)` | `void` | Set listener transform |
| `setOcclusion(id, factor)` | `void` | Apply occlusion filter (0–1) |
| `setRoomAcoustics(config)` | `void` | Configure reverb room model |
| `play(id)` | `void` | Start a registered source |
| `stop(id)` | `void` | Stop a source |
| `dispose()` | `void` | Clean up |

---

### `RoomManager` — `network/RoomManager.ts`
High-level room lifecycle management.

| Method | Returns | Description |
|--------|---------|-------------|
| `createRoom(name, maxPlayers)` | `Promise<string>` | Create and return room ID |
| `joinRoom(id)` | `Promise<void>` | Join an existing room |
| `leaveRoom()` | `void` | Leave current room |
| `listRooms()` | `Promise<RoomInfo[]>` | Fetch available rooms |

### `EntityReplicator` — `network/EntityReplicator.ts`
Delta-compressed entity state sync.

| Method | Returns | Description |
|--------|---------|-------------|
| `register(entityId, components)` | `void` | Track entity for replication |
| `unregister(entityId)` | `void` | Stop replicating entity |
| `snapshot()` | `ReplicationPacket` | Capture current state diff |
| `apply(packet)` | `void` | Apply received packet |

### `ClientPrediction` — `network/ClientPrediction.ts`
Client-side prediction with server reconciliation.

| Method | Returns | Description |
|--------|---------|-------------|
| `applyInput(input)` | `void` | Apply and buffer an input |
| `reconcile(serverState)` | `void` | Rollback and replay from server state |
| `getState()` | `PredictedState` | Current predicted state |

---

### `BenchmarkRunner` — `engine/Benchmark.ts`
Lightweight performance benchmarking utility.

| Constructor | `BenchmarkRunner()` |
|-------------|---------------------|

| Method | Returns | Description |
|--------|---------|-------------|
| `suite(name, define)` | `this` | Define a benchmark suite |
| `runAll()` | `Promise<BenchmarkSuiteResult[]>` | Run all suites |
| `runSuite(name)` | `Promise<BenchmarkSuiteResult \| null>` | Run one suite by name |
| `formatReport(results)` | `string` | Human-readable report string |

#### `BenchmarkSuiteBuilder`

| Method | Returns | Description |
|--------|---------|-------------|
| `add(name, fn, opts?)` | `this` | Add a benchmark case |

#### `BenchmarkStats` Shape
`name` · `iterations` · `min` · `max` · `mean` · `median` · `p95` · `stddev` · `opsPerSec`

#### Helper Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `time(label, fn)` | `{ label, ms }` | Single-shot timing |
| `assertUnder(budgetMs, fn)` | `void` | Throws if `fn` exceeds budget |

---

*BlindFake: Phantom v0.2.0-phantom — [GitHub](https://github.com/FoRest988/BlindFake-Engine)*
