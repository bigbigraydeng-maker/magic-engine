/** Words on creative-state cards. No server imports — the card list is a client component. */

export const CREATIVE_MOVE_WHAT = '把跑赢的广告放进放量组，先建成暂停'
export const CREATIVE_PLAN_WHAT = '为跑赢的广告另提一份新计划'
export const CREATIVE_PAUSE_WHAT = '建议暂停一条获客成本过高的广告'

export function isCreativeStateCard(what: string): boolean {
  return what === CREATIVE_MOVE_WHAT || what === CREATIVE_PLAN_WHAT || what === CREATIVE_PAUSE_WHAT
}
