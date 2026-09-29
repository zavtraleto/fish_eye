// Sim → view events (GDD §15.1). The sim pushes them; main.ts drains them each
// tick into FX, HUD and the debug log. Render never peeks at transient sim state.

export type SimEvent =
  | { type: 'moved'; x: number; y: number }
  | { type: 'bumped'; x: number; y: number }
  | { type: 'pickup'; x: number; y: number; score: number };
