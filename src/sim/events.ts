// Sim → view events (GDD §15.1). The sim pushes them; main.ts drains them each
// tick into FX, audio, HUD and the debug log. Render never peeks at transient sim state.

export type SimEvent =
  | { type: 'runStarted' }
  | { type: 'levelStarted'; level: number }
  | { type: 'jumped'; kind: 'jump' | 'bhop' | 'slide' }
  | { type: 'dashed' }
  | { type: 'slideStarted' }
  | { type: 'slideEnded' }
  | { type: 'landed' }
  | { type: 'eyeTaken'; level: number }
  /** `escapeTime` in seconds. */
  | { type: 'levelCleared'; level: number; escapeTime: number }
  | { type: 'enemySpawned' }
  | { type: 'enemyWindup' }
  | { type: 'enemyCharged' }
  | { type: 'enemyStunned' }
  | { type: 'died' }
  | { type: 'paused' }
  | { type: 'resumed' }
  /** Click or Space after the death lockout: main.ts starts a new run. */
  | { type: 'restartRequested' };

/** What the movement code reports (GDD §5). */
export type MoveEvent = Extract<SimEvent, { type: 'jumped' | 'dashed' | 'slideStarted' | 'slideEnded' | 'landed' }>;
