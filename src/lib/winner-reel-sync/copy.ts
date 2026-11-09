/** Words on the winner-sync cards. No server imports — the card list is a client component. */

export const WINNER_ADD_WHAT = '建议把跑赢的自然帖建成暂停广告'
export const WINNER_PAUSE_WHAT = '建议暂停一条点击率过低的广告'
export const WINNER_ACTIVATE_WHAT = '把这条已暂停的新广告打开'
export const WINNER_OBSERVATION_DAYS = 7

export function isWinnerReelCard(what: string): boolean {
  return what === WINNER_ADD_WHAT || what === WINNER_PAUSE_WHAT || what === WINNER_ACTIVATE_WHAT
}
