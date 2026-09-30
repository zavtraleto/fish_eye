// Every player-facing string. Code reads them through t('key').

export const en = {
  'title.name': 'FISH EYE',
  'title.start': 'CLICK TO START',
  'title.controls': 'MOUSE  LOOK    WASD  MOVE    SPACE  JUMP / AIR DASH / HOLD TO SLIDE    ESC  PAUSE',
  'best.line': 'BEST  {eyes} EYES  {time}',
  'hud.eyes': 'EYES {eyes}',
  'hud.escape': 'ESCAPE',
  'clear.line': 'EYE {eye}  /  ESCAPE {escape}  /  TOTAL {total}',
  'pause.title': 'PAUSED',
  'pause.resume': 'CLICK TO RESUME',
  'dead.title': 'DEAD',
  'dead.eyes': 'EYES EXTRACTED  {eyes}',
  'dead.time': 'TIME  {time}',
  'dead.newBest': 'NEW BEST',
  'dead.restart': 'CLICK OR SPACE TO RESTART',
} as const;

export type StringKey = keyof typeof en;
