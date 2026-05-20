# Tutorial 4: Visual Scripting â€?No-Code Game Logic

Create game behaviors without writing any code, using the Visual Script Editor.

---

## What You'll Build
A simple interactive scene where clicking a button opens a door, a pickup heals the player, and a trigger zone spawns enemies â€?all using visual nodes.

## Prerequisites
- BlindFake: Phantom running
- A new 3D project

---

## Step 1: Open the Visual Script Editor

1. In the editor, click the **Visual Script** tab (or find it in the menu: **View â†?Visual Script Editor**)
2. You'll see a node graph canvas with a grid background
3. **Right-click** on the canvas to open the node menu

---

## Step 2: Understanding Nodes

Visual scripts are built from connected nodes:

| Node Type | Color | Description |
|-----------|-------|-------------|
| **Event** | ðŸŸ¢ Green | Triggers that start execution (On Start, On Update, On Collision) |
| **Action** | ðŸ”µ Blue | Things that happen (Move, Rotate, Play Sound, Spawn) |
| **Condition** | ðŸŸ¡ Yellow | Logic decisions (If/Else, Compare, And/Or) |
| **Variable** | ðŸŸ£ Purple | Data storage (Get/Set number, string, boolean) |
| **Math** | âš?Gray | Math operations (Add, Multiply, Random, Clamp) |

### Connections
- **White lines**: Execution flow (which node runs next)
- **Colored lines**: Data flow (passing values between nodes)
- Drag from an **output port** to an **input port** to connect

---

## Step 3: "Hello World" â€?Rotate on Start

Let's make an object rotate continuously:

1. **Right-click** â†?**Events** â†?**On Update** (runs every frame)
2. **Right-click** â†?**Actions** â†?**Rotate Object**
3. Connect the **On Update** execution output â†?**Rotate Object** execution input
4. In the Rotate Object node:
   - **Target**: Select your cube from the dropdown
   - **Axis**: Y
   - **Speed**: 45 (degrees per second)

Press **F9** to play â€?your cube now rotates!

---

## Step 4: Interactive Button â†?Open Door

### Set up the scene
1. Add a **Cube** and name it "Door" â€?scale to (1, 3, 0.2)
2. Add another **Cube** and name it "Button" â€?scale to (0.5, 0.5, 0.5), color red

### Build the script

```
[On Collision: "Player" hits "Button"]
    â†?
[Set Variable: "doorOpen" = true]
    â†?
[If: doorOpen == true]
   â”œâ”€ True â†?[Move Object: "Door", Y: +3, Duration: 1s, Easing: EaseOut]
   â””â”€ False â†?(nothing)
```

Steps:
1. Add **On Collision** event â†?set Object A to "Player", Object B to "Button"
2. Add **Set Variable** â†?name "doorOpen", type Boolean, value True
3. Add **If** condition â†?connect to Get Variable "doorOpen"
4. Add **Move Object** on the True branch â†?target "Door", offset Y=3, duration 1

---

## Step 5: Health Pickup

```
[On Collision: "Player" hits "HealthPack"]
    â†?
[Get Variable: "playerHP"]
    â†?
[Math: Add (playerHP + 25)]
    â†?
[Math: Clamp (0, 100)]
    â†?
[Set Variable: "playerHP" = result]
    â†?
[Play Sound: "heal.mp3"]
    â†?
[Destroy Object: "HealthPack"]
```

This chain:
1. Detects when the player touches the health pack
2. Reads current HP
3. Adds 25 and clamps to 0-100
4. Saves the new HP
5. Plays a sound
6. Removes the pickup from the scene

---

## Step 6: Trigger Zone â€?Spawn Enemies

```
[On Trigger Enter: zone "SpawnZone"]
    â†?
[If: Get Variable "enemiesSpawned" == false]
   â”œâ”€ True â†?
   â”?    [Set Variable: "enemiesSpawned" = true]
   â”?        â†?
   â”?    [Loop: 3 times]
   â”?        â†?
   â”?    [Spawn Prefab: "EnemyPrefab" at Random Position in radius 5]
   â”?        â†?
   â”?    [Play Sound: "alert.mp3"]
   â””â”€ False â†?(skip)
```

### Creating a Trigger Zone
1. Add an **Empty** object, name it "SpawnZone"
2. In the Inspector, add a **Trigger Collider** component (box, size 5Ã—2Ã—5)
3. Mark it as "Trigger" (not solid)

---

## Step 7: Variable Dashboard

The Visual Script Editor shows all variables in a sidebar:

| Variable | Type | Default |
|----------|------|---------|
| playerHP | Number | 100 |
| doorOpen | Boolean | false |
| enemiesSpawned | Boolean | false |
| score | Number | 0 |

You can add, rename, and delete variables from the sidebar.

---

## Step 8: Tips & Best Practices

### Organization
- **Comment nodes**: Right-click â†?Add Comment to label groups of nodes
- **Color coding**: Event chains should flow left-to-right
- **Groups**: Select multiple nodes and press `Ctrl+G` to group them

### Performance
- Avoid heavy logic in **On Update** â€?it runs 60 times per second
- Use **On Collision/Trigger** events instead of distance checks in Update
- Variables are faster than repeated Get Property nodes

### Debugging
- Click any node while in Play Mode to see its current values
- The Console shows errors if connections are invalid
- Use **Print** nodes to log values

---

## Step 9: Converting to Code

If you outgrow visual scripting, you can export a script to TypeScript:

1. Right-click the visual script canvas
2. Select **Export as TypeScript**
3. The generated code appears in the Script Editor

This is a great way to learn code from visual prototypes.

---

**Congratulations!** You've built interactive gameplay without writing a single line of code.

---

## Summary of All Tutorials
1. [3D Platformer](./01_Platformer3D.md) â€?Player, platforms, collectibles, physics
2. [Top-Down 2D](./02_TopDown2D.md) â€?Sprites, tilemaps, enemies, combat
3. [FPS Shooter](./03_FPS.md) â€?First-person camera, raycasting, enemies
4. **Visual Scripting** (this tutorial) â€?No-code game logic with nodes

*BlindFake: Phantom v0.1.0 â€?https://github.com/FoRest988/BlindFake-Engine*
