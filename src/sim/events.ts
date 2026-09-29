// Sim → view events (GDD §15.1). The sim pushes them; main.ts drains them each
// tick into FX, audio, HUD and the debug log. Render never peeks at transient sim state.

export type SimEvent =
  | { type: 'runStarted' }
  | { type: 'levelStarted'; level: number }
  | { type: 'eyeTaken'; level: number }
  /** `escapeTime` in seconds. */
  | { type: 'levelCleared'; level: number; escapeTime: number }
  | { type: 'died' }
  | { type: 'paused' }
  | { type: 'resumed' }
  /** Click or Space after the death lockout: main.ts starts a new run. */
  | { type: 'restartRequested' };
