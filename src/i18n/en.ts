// Every player-facing string. Code reads them through t('key').

export const en = {
  'hud.score': 'SCORE {score}',
} as const;

export type StringKey = keyof typeof en;
