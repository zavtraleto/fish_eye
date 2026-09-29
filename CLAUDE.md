# Fish Eye

PC-first, first-person arcade horror roguelite prototype: follow the green line to the EYE, escape back to the white START from memory, dodge the enemy. Feel modeled on Devil Daggers / Hyper Demon / Quake 3, level topology on Hitman.
Vite + TypeScript (strict) + Three.js. Target: desktop Chrome, keyboard + mouse, Pointer Lock. Maximum FPS on PC with a modest render budget. Mobile maybe later, only after the prototype works.

- Spec: `docs/GDD.md` (Russian). It is the contract: read the relevant section before changing gameplay. Original source: `docs/FISH_EYE_Prototype_v0.md` (English); the GDD refines it and marks deviations.
- Look: `docs/VISUAL.md` (Russian). Before changing how anything looks, read its code map and pitfalls.
- Current plan: `docs/plans/` — the newest file is the active plan; each task records its status and decisions there.
- Live build: <!-- TODO: GitHub Pages URL once the repo exists -->

## Status

Game designed (GDD), implementation not started. `src/sim/world.ts` and `src/render/scene.ts` still hold the template demo (a cube collecting pips on a grid): replace it with the real game in plan phase 1, keep the infrastructure.

## Language

- Talk to the user in Russian. `docs/*.md` and `README.md` are Russian (the original prototype spec stays English).
- Code, comments, identifiers, commit messages: English.
- Everything the player sees is English and comes from `src/i18n/en.ts` via `t('key')`. Never put player-facing literals in view code.

## Commands

```bash
npm run dev        # Vite dev server on :5173
npm test           # Vitest, node environment
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
```

Before every commit: `npm test` and `npm run build` must pass. Pushing to `main` runs `.github/workflows/deploy-pages.yml` (test → build → GitHub Pages); a red test blocks the deploy.

## Design rules

- **Source of truth for anything the GDD leaves open:** Devil Daggers for feel, speed, death, restart and score; Hitman for level topology. Visual references are listed in VISUAL.md. Labels in docs: `[решение YYYY-MM-DD]`, `[оценка]`, `[Devil Daggers]`, `[Hitman]`, …
- **Deliberate deviations from the original spec — do not undo them:**
  - Levels are built around a big START↔EYE loop, not a chain (GDD §6).
  - The room graph is generated directly on the coarse grid, not generated abstractly and then embedded (GDD §7).
  - The enemy has a WINDUP telegraph before CHARGE (GDD §11.3).
  - The projection is chosen by a spike in phase 1, not deferred (GDD §4).
- **Colour code:** green = route / EYE, red = enemy / threat / rear vision, white = START / EXIT, everything else dark. No other bright gameplay colours. The world may look as strange as it likes; the signal colours stay clean (VISUAL.md §1).
- When behavior changes, update the GDD in the same change. Keep GDD §17 (tuning table) in sync with `src/config/tuning.ts`.
- Lock the core loop in greybox before investing in presentation. Playtest findings go into the active plan.
- Pick the cheapest visual that reads well: high FPS on PC is a hard requirement.

## Architecture

```
src/sim/      pure simulation: no DOM, no Three.js — World, player, enemy, run, 2D level geometry
src/sim/level/  room graph, generation on a grid, layout, build (rects → wall segments, route)
src/render/   Three.js view: reads sim state, never mutates it; camera/ holds the projections
src/core/     fixed-step loop, seeded RNG, input (keyboard, mouse / Pointer Lock)
src/data/     content as data (difficulty table, …)
src/ui/       DOM screens and HUD
src/audio/    WebAudio synthesis driven by SimEvents
src/config/tuning.ts   every gameplay number (seconds, meters), live-editable in the debug panel
src/debug/    Tweakpane panel (lazy-loaded; folder tree in tuningLayout.ts), stats overlay, URL params
src/i18n/     player-facing strings
```

Invariants:

- **Fixed 60 Hz step.** Durations live in `tuning` as seconds; convert with `secondsToTicks()`. Never hardcode numbers in logic.
- **The sim world is the (x, z) plane in meters.** Player and enemy are circles, walls are segments. Height exists only as render data.
- **Mouse look is applied to the camera every render frame**, not per tick. The sim receives the current yaw in `StepInput` each tick.
- **Two clocks in `World`:** `tick` advances only while playing; `uiTick` always advances. Gameplay timers use `tick`, so they freeze on pause. Render with `alpha = 0` while `world.simFrozen`.
- **Input is abstract.** Devices push `Command`s into `InputState`; `World.step()` consumes them once per tick.
- **Sim → view via events.** The sim pushes `SimEvent`s (`src/sim/events.ts`); `main.ts` drains them each tick into FX, audio, HUD and the debug log. Add an event instead of letting render peek at transient sim state.
- **Determinism.** All sim randomness uses forked `Rng` streams owned by `World` (one per system). Level N of a run uses `fork('level', N)`. No `Math.random()` in `src/sim`.
- **New tunables** go into the right group in `tuning.ts` (one flat group per system; keys without a group prefix). The debug panel picks them up; add a slider range in `RANGES` (`debug/tuningLayout.ts`) if the auto range is wrong. A new group must be placed in `TUNE_LAYOUT` — a test checks it.
- **Feedback is immediate:** a control reacts in the same frame; animations tied to outcomes are driven by `SimEvent`s and never delay the action.

Comments cite GDD sections (`// GDD §8.2`). Match the surrounding style: short doc comments, no narration.

## Testing

- Tests drive `World` directly with `step({ commands, held, yaw })`.
- Reset tuning in `beforeEach`: `mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)))`.
- Compute tick expectations from tuning (`T(tuning.x.Y)`), never from literal frame counts.
- Level generation: test invariants over many seeds and levels, plus determinism.

## Verifying in the browser

- Dev-only handle: `window.__game` (`world`, `input`, `loop`, `view`, `tuning`, `cheats`, `restart`).
- URL params: `?debug=1&seed=123&god=1&timescale=0.5`.
- The in-app Browser pane does not run `requestAnimationFrame` while hidden, so the game looks frozen there. Use the Chrome DevTools MCP at a desktop viewport (1920x1080) for anything time-based.
- Automated checks cannot grab Pointer Lock: drive yaw and movement through `__game`.
- Pause the sim for screenshots with `__game.loop.clock.paused = true` and `stepOnce(n)`.
- Check layouts at 16:9 (1920x1080, 1280x720), 16:10 and ultrawide 21:9.
- Do not run benchmarks or CPU-throttled measurements unless the user asks (the phase 1 projection spike's FPS comparison is approved).

## Working with the user

- Do the work yourself; do not spawn cold-start subagents. The user is fine waiting.

## Environment gotchas (Windows)

- **Vite may miss a second write to the same file within a moment** (stale CSS/modules). Apply all edits to a file in one write; if the page looks stale, `touch` the file or restart the dev server.
- `gh` is not on the bash `PATH`: use `"/c/Program Files/GitHub CLI/gh.exe"`.
- The global git email is a work address; this repo has a local `user.email`. Do not change global git config.
- `.gitattributes` enforces LF; CRLF warnings on commit are expected.

## Git

- Commit or push only when asked. Subject line in imperative English (`M1: ...`, `ci: ...`, `docs: ...`), body lists the user-visible changes.
- End commit messages with the `Co-Authored-By` trailer given by the harness.
