# FISH EYE — Prototype v0 Specification

## 0. Purpose

This document defines the first playable prototype of **FISH EYE**.

The goal is not to build the final game.  
The goal is to validate one loop:

**START → follow green line → take EYE → line disappears → escape back to START while avoiding enemy → score → next level**

The prototype must be simple enough to implement quickly and easy to tune.

The project must **not require manual level design or manual 3D asset creation**.

Levels are generated automatically from rules.  
Environment art is generated from simple Three.js geometry.

---

# 1. Product target

## Platform

- Desktop web browser
- Keyboard + mouse
- PC-first
- Three.js
- TypeScript
- Vite

## Run length

Target successful run:

- 10–20 minutes
- many short procedural levels
- each next level is slightly harder

## Game identity

FISH EYE is:

- fast arcade movement
- procedural spatial memory
- one-hit death
- short levels
- horror presentation
- no combat
- no inventory
- no RPG systems
- no handcrafted levels required

---

# 2. Core loop

Each level works as follows:

1. Generate a new flat procedural level.
2. Place player at START.
3. Place a glowing WHITE exit wall directly behind the player.
4. Place EYE somewhere sufficiently far away.
5. Calculate a valid path from START to EYE.
6. Draw a GREEN line on the floor along that path.
7. Player follows the line.
8. Player touches EYE.
9. Remove GREEN line immediately.
10. Activate escape phase.
11. Spawn or activate enemy.
12. Player finds the way back using spatial memory.
13. Enemy touching player = instant death.
14. Player touching WHITE START wall = success.
15. Show short score interstitial.
16. Generate next level.

There is no health.

There is no combat.

There is no manual interaction key for EYE or EXIT.

Touching them is enough.

---

# 3. Controls

## Movement

- `W` = forward
- `S` = backward
- `A` = strafe left
- `D` = strafe right
- mouse = camera
- `Space + A` = dash left
- `Space + D` = dash right

No:

- jump
- crouch
- sprint button
- stamina

## Movement target

Movement must feel immediate and arcade-like.

Initial values:

```ts
moveSpeed = 9.0; // meters/sec
```

Do not simulate heavy body inertia.

The underwater feeling must come from:

- camera effects
- sound
- fog
- visual distortion
- enemy movement
- particles

not from sluggish controls.

---

# 4. Camera

## Perspective

First-person.

Use Pointer Lock.

## FOV

Prototype target:

```text
horizontal FOV ≈ 120°
```

Three.js `PerspectiveCamera.fov` is vertical, so compute vertical FOV from:

- horizontal target FOV
- viewport aspect ratio

Do not hardcode `camera.fov = 120`.

The camera system should allow later replacement with a custom nonlinear fisheye projection.

For v0 use normal PerspectiveCamera.

---

# 5. Dash

Dash is the only special movement ability.

## Rules

Dash works only sideways.

Valid:

- `A + Space`
- `D + Space`

Invalid:

- `W + Space`
- `S + Space`
- `Space` alone

## Initial values

```ts
dashDistance = 3.5;
dashDuration = 0.20;
dashCooldown = 1.0;
```

All values must be configurable.

## Forgiveness

Dash should slightly favor the player.

Allowed:

- short input buffer
- slight collision forgiveness
- wall correction if dash would end inside geometry
- short grace window during the dash

Do not make dash fully invulnerable yet unless required during testing.

---

# 6. Level topology

## Important rule

Do **not** generate a classic maze.

The level should behave more like:

- modern Hitman maps
- IKEA circulation
- interconnected interior spaces
- “Swiss cheese” topology

The player should usually have somewhere to continue running.

Avoid long dead ends.

## Representation

The logical level is a **2D graph**.

Each graph node represents a room.

Each graph edge represents a connection between rooms.

Example:

```text
      B────C
     / \  / \
START   D    E
     \ / \  /
      F────G
           |
          EYE
```

The graph is generated first.

The 3D level is built from that graph afterward.

---

# 7. Level generation algorithm

The player should not manually design rooms.

Use the following generation process.

## Step 1 — Choose difficulty parameters

Example for first level:

```ts
roomCount = 5;
minConnectionsPerRoom = 2;
maxConnectionsPerRoom = 3;
loopCount = 1;
targetCriticalPathRooms = 3;
```

Difficulty later increases these values.

---

## Step 2 — Create the main route

Create a simple chain first:

```text
START → A → B → C → EYE
```

This guarantees a valid route.

The chain length is controlled by:

```ts
targetCriticalPathRooms
```

---

## Step 3 — Add side rooms

Add additional rooms connected to existing rooms.

Prefer rooms that connect to more than one existing room.

Bad:

```text
A → B → C → D → dead end
```

Better:

```text
A ─ B
│   │
D ─ C
```

---

## Step 4 — Add loops

Add extra connections between non-adjacent nodes.

Target:

```text
early levels: 1–2 loops
mid levels:   2–4 loops
deep levels:  4+
```

The purpose of loops:

- reduce dead ends
- allow alternate escape routes
- support continuous movement
- create spatial decisions

---

## Step 5 — Validate graph

Reject and regenerate if:

- graph is disconnected
- START cannot reach EYE
- too many rooms have only one connection
- the EYE is too close to START
- there are long dead-end chains
- the graph has no loop when a loop is required

Recommended rule:

```text
at least 70% of normal rooms should have 2 or more connections
```

Dead-end rooms should be rare.

For v0:

```text
maxDeadEndRooms = 1
```

excluding START and EYE if required.

---

# 8. Converting graph to physical rooms

The player does not need to manually model rooms.

Each graph node becomes a rectangular room generated from dimensions.

## Room presets

Use only these initial types.

### SMALL ROOM

```text
6–8 m wide
6–10 m long
```

### NORMAL ROOM

```text
9–12 m wide
9–14 m long
```

### HALL

```text
6–10 m wide
14–20 m long
```

### JUNCTION ROOM

```text
8–12 m wide
8–12 m long
3–4 exits
```

Do not create more room types for v0.

---

# 9. Corridors

Connections between rooms become corridors.

## Width presets

```text
narrow: 2.8–3.2 m
normal: 3.5–4.5 m
wide:   5–6 m
```

Use normal corridors most of the time.

Avoid extremely tight corridors because movement is fast.

## Length

Typical:

```text
4–12 m
```

Occasionally:

```text
15–20 m
```

Do not make every corridor identical.

Variation in length helps spatial memory.

---

# 10. Physical layout placement

Graph generation and world placement are separate problems.

For v0, use a simple grid-based placement system.

## Recommended approach

Use an invisible coarse 2D placement grid.

Example:

```ts
cellSize = 14; // meters
```

Each room occupies one or more placement cells.

Generation process:

1. Place START room at `(0, 0)`.
2. Traverse graph.
3. Place connected rooms into available nearby grid cells.
4. Prefer:
   - north
   - south
   - east
   - west
5. Avoid room overlaps.
6. If a placement cannot be found after several attempts:
   - restart layout generation.

This is acceptable for v0.

Do not attempt sophisticated architectural packing yet.

---

# 11. Openings between rooms

Each graph edge creates a physical opening.

An opening should be easy to see while moving quickly.

## Opening dimensions

Recommended:

```text
width: 2.5–4.5 m
height: 2.5–4 m
```

Avoid tiny doors.

Most connections should visually read as:

- doorway
- wall opening
- corridor opening

Do not require door interaction.

No doors need to open or close in v0.

---

# 12. Floor, walls and ceiling

No manual modeling.

Each room can be generated from boxes or planes.

## Walls

Build from:

- BoxGeometry
or
- merged PlaneGeometry

Recommended visual properties:

- flat shading
- dark grey
- slightly uneven geometry later

## Floor

Single flat surface per room/corridor.

## Ceiling

Flat ceiling.

Height:

```text
3.5–6 m
```

Randomize within limits.

Different ceiling heights help rooms feel distinct.

Do not add vertical navigation.

---

# 13. Procedural visual landmarks

Landmarks exist only for spatial memory.

They do not affect gameplay.

Do not manually model them.

Use Three.js primitives.

Initial landmark library:

```text
GIANT SPHERE
TORUS
MONOLITH
HANGING CUBE
ROTATING RING
GIANT CROSS
PILLAR CLUSTER
VOID / BLACK DISC
```

## Placement rule

A landmark may be assigned to a room with approximately:

```ts
landmarkChance = 0.35;
```

Never place more than one dominant landmark in one room.

## Landmark size

Landmarks should be large.

Approximate footprint:

```text
2–6 m
```

They should remain recognizable at a distance and in fog.

## Examples

### GIANT SPHERE

```ts
SphereGeometry(
  random(1.5, 3.5),
  8,
  6
)
```

### MONOLITH

```text
width: 1–2 m
height: 4–7 m
depth: 1–2 m
```

### TORUS

```text
radius: 2–4 m
tube: 0.2–0.8 m
```

### PILLAR CLUSTER

Create:

```text
3–8 cylinders
```

with random:

- spacing
- height
- radius

No gameplay collision complexity is required beyond normal solid geometry.

---

# 14. START / EXIT

START and EXIT are the same location.

Visual:

- large white wall or white portal plane
- slightly emissive
- visible from nearby
- no text required

The player begins facing away from it.

On escape, touching it ends the level.

Color:

```text
WHITE
```

---

# 15. EYE

EYE is the only collectible.

Prototype model may be fully procedural.

Recommended structure:

```text
outer sphere
+
smaller dark pupil
+
slightly flattened scale
+
slow rotation
```

No texture required.

Before pickup:

- GREEN accent allowed
- small emissive glow allowed

On pickup:

- eye disappears
- GREEN line disappears immediately
- short audio hit
- short visual glitch
- escape phase begins

---

# 16. Green navigation line

The GREEN line must always show the route from START to EYE.

Use the path calculated on the room graph.

Then convert the graph path into physical waypoints.

Recommended visual:

- thin emissive line
- placed slightly above floor
- bright GREEN
- visible through darkness but not through walls

It should follow:

```text
START room center
→ room exits
→ corridor centers
→ next room
→ EYE
```

It does not need to follow perfect curves.

Simple segmented line is enough.

After EYE pickup:

```ts
greenLine.visible = false;
```

Do not leave breadcrumbs.

---

# 17. Enemy

Only one enemy type exists in v0.

Do not build a roster.

The enemy has three states:

```text
HUNT
CHARGE
RECOVER
```

---

# 18. Enemy navigation

Use the same room graph generated for the level.

Do not use navmesh in v0.

The enemy tracks:

```text
currentRoom
targetRoom
nextRoom
```

To chase player:

1. determine player current room
2. run shortest-path search on graph
3. choose next graph node
4. move toward the opening to that node

If player and enemy are in the same room, use direct steering.

---

# 19. HUNT

In HUNT:

- enemy follows graph toward player
- normal speed
- steering is responsive enough to navigate
- enemy looks for charge opportunity

Initial value:

```ts
enemyMoveSpeed = 7.5;
```

Player should generally be slightly faster in free movement.

---

# 20. CHARGE

Enemy may start CHARGE when:

- enemy and player are in same room or corridor
- distance is within charge range
- line of sight is clear enough

Initial range:

```text
8–15 m
```

During charge:

```ts
enemyChargeSpeed = 15.0;
```

Important:

Enemy steering becomes very weak.

It should commit to a direction.

This allows the player to dodge sideways.

---

# 21. RECOVER

If charge misses:

- enemy continues forward briefly
- slows down
- turns slowly
- cannot immediately charge again

Initial:

```ts
enemyRecoveryTime = 0.8;
```

After recovery:

```text
RECOVER → HUNT
```

---

# 22. Enemy contact

Any collision between enemy and player:

```text
DEATH
```

No health.

No damage numbers.

No knockback.

---

# 23. Enemy activation

No enemy before EYE pickup on first prototype levels.

After EYE pickup:

1. select a room not directly adjacent to player
2. place enemy there
3. activate AI
4. play distant sound
5. enable rear-vision representation

Enemy should not spawn directly in player's face.

---

# 24. Rear vision

If enemy is behind the camera, display a RED holographic proxy.

This proxy is only visual.

Gameplay enemy remains at its real world position.

## Proxy should communicate

- relative direction
- rough distance
- whether enemy is approaching

## Visual style

- RED
- transparent
- emissive
- unstable
- low-poly
- slight glitch
- slight scale distortion allowed

Do not implement a second full camera render for v0.

---

# 25. Darkness and visibility

The world is dark but readable.

Recommended starting distances:

```text
0–5 m:
clear

5–12 m:
readable

12–20 m:
mostly silhouettes

20+ m:
darkness / fog
```

Openings must remain readable at running speed.

Darkness must create uncertainty, not navigation frustration.

---

# 26. Visual language

Gameplay colors are strict.

```text
BLACK / DARK GREY
world / unknown

DIRTY WHITE
architecture

GREEN
route / EYE / inward objective

RED
enemy / threat / rear vision

WHITE
START / EXIT
```

Do not introduce extra bright gameplay colors.

---

# 27. Visual implementation for v0

Use:

- low polygon counts
- flat colors
- fog
- reduced internal render resolution
- simple vertex wobble later
- limited glitch pass later

Avoid:

- PBR material workflow
- texture-heavy environments
- dynamic shadows
- skeletal animation
- complex postprocessing stack

The environment should be possible to generate entirely from code.

---

# 28. Level difficulty

Difficulty should primarily increase through topology.

Priority order:

1. more rooms
2. longer START → EYE graph distance
3. more junctions
4. more loops
5. more spatial similarity
6. eventually more enemies
7. eventually slightly stronger enemies

Do not primarily scale difficulty by making enemies faster.

---

# 29. Suggested progression

## Level 1

```text
rooms: 4–5
loops: 1
enemy: none
critical path: 3 rooms
```

Goal:

teach route → EYE → return.

## Level 2

```text
rooms: 5–6
loops: 1
enemy: 1
```

Goal:

introduce RED rear vision.

## Level 3

```text
rooms: 6–7
loops: 1–2
enemy: 1
```

Ensure at least one good long corridor for first obvious CHARGE.

## Levels 4–6

Increase:

- rooms
- junctions
- path length

## Later

Gradually approach:

```text
10–18 rooms
3–6 loops
multiple route choices
```

Exact limits should be tuned through playtesting.

---

# 30. Score

Primary score:

```text
EYES EXTRACTED
```

Leaderboard sorting:

1. higher EYES
2. lower TOTAL RUN TIME

Example:

```text
01 VOID       21 EYES   12:43.18
02 MAX        21 EYES   13:02.44
03 FISHERMAN  20 EYES   11:21.03
```

Track:

```ts
eyesExtracted
runTime
currentLevel
inwardTime
escapeTime
bestEscapeTime
distanceTravelled
```

Do not implement online backend before core loop works.

Score state should be structured so leaderboard integration can be added later.

---

# 31. Level completion screen

After touching START during escape:

Show a short transition.

Duration:

```text
0.6–1.2 sec
```

Example:

```text
EYE 07

ESCAPE 12.48

TOTAL 02:41.22
```

Then immediately load next level.

No menu.

No upgrade choice.

No player input required.

---

# 32. Death

On enemy contact:

```text
hit
→ red / white flash
→ short sound
→ screen collapse
→ run result
→ restart
```

Death sequence must be short.

Target:

```text
under 2 seconds before restart is available
```

---

# 33. Configuration

All important values must be centralized.

Example:

```ts
export const GAME_CONFIG = {
  player: {
    moveSpeed: 9,
    dashDistance: 3.5,
    dashDuration: 0.2,
    dashCooldown: 1.0,
  },

  camera: {
    horizontalFov: 120,
  },

  level: {
    cellSize: 14,
    minRoomSize: 6,
    maxRoomSize: 14,
  },

  enemy: {
    moveSpeed: 7.5,
    chargeSpeed: 15,
    recoveryTime: 0.8,
  },

  render: {
    fogNear: 5,
    fogFar: 20,
    internalScale: 0.75,
  },
};
```

Do not scatter tuning values across code.

---

# 34. Implementation order

## Phase 1 — Movement sandbox

Build one empty room.

Implement:

- Pointer Lock
- mouse look
- WASD
- player collision
- 120° horizontal FOV

Do not continue until movement already feels good.

---

## Phase 2 — Hand-built temporary test level

Use only boxes.

Create manually in code:

```text
START
→ corridor
→ room
→ junction
→ room
→ EYE
```

This is not level design work.

It is only a temporary test arrangement.

Implement:

- START
- EYE
- GREEN line
- pickup
- return
- score transition

---

## Phase 3 — Dash

Implement lateral dash.

Tune:

- distance
- duration
- collision handling
- cooldown

---

## Phase 4 — Enemy

Implement:

- HUNT
- CHARGE
- RECOVER
- one-hit death

Use the temporary test level first.

---

## Phase 5 — Rear vision

Implement RED rear proxy.

---

## Phase 6 — Procedural graph

Implement:

- main chain
- side rooms
- loops
- validation
- START and EYE placement

---

## Phase 7 — Physical layout generation

Convert graph into:

- rooms
- corridors
- openings

Use coarse 2D placement grid.

Reject invalid overlapping layouts.

---

## Phase 8 — Procedural landmarks

Add simple primitive landmarks.

---

## Phase 9 — Progression

Scale topology with `eyesExtracted`.

---

## Phase 10 — Visual pass

Only after loop works:

- fog tuning
- low-resolution rendering
- vertex wobble
- simple glitch
- sounds
- transition polish

---

# 35. Non-goals

Do not build these for v0:

- weapons
- combat
- HP
- stamina
- inventory
- perks
- meta progression
- upgrades
- multiple enemy types
- handcrafted maps
- handcrafted 3D assets
- vertical levels
- stairs
- multiple floors
- elevators
- interactable doors
- keys
- traps
- gameplay landmarks
- advanced physics
- procedural creature system
- skeletal animation
- multiplayer
- full online leaderboard
- nonlinear fisheye projection
- large postprocessing pipeline

If a feature does not directly improve:

```text
MOVE
→ FIND EYE
→ ESCAPE
→ DODGE
→ SCORE
```

it is outside v0.

---

# 36. Prototype success criteria

The prototype is successful if:

1. Running feels good before any art is added.
2. Player understands that GREEN means “go there”.
3. Player understands that touching EYE changes the phase.
4. Player understands they need to return to WHITE START.
5. Player recognizes at least some rooms on the way back.
6. Generated levels rarely trap the player in dead ends.
7. Alternate routes exist naturally.
8. Enemy attacks are readable.
9. Dash reliably avoids a correctly read charge.
10. RED rear vision helps without becoming confusing.
11. Death feels caused by player error.
12. Level completion immediately creates desire to continue.
13. Procedural generation can create many playable levels without manual editing.

---

# 37. Core engineering principle

Prefer simple systems that are easy to tune.

For the challenge version:

```text
GOOD FEEL
>
CONTENT

GOOD TOPOLOGY
>
COMPLEX GENERATION

CLEAR RULES
>
REALISM

FAST ITERATION
>
PERFECT ARCHITECTURE
```

The prototype should be playable as early as possible.
