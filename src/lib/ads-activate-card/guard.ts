/**
 * Fresh read before the one write.
 * The ad must still be paused, and its ad set and campaign must each be on.
 */

export interface ActivateLive {
  readonly adStatus: string | null
  readonly accountId: string | null
  readonly adsetStatus: string | null
  readonly campaignStatus: string | null
  readonly owned: boolean | null
}

export function liveReason(
  live: ActivateLive | null,
  holdAccountId: string | null,
): string | null {
  if (!live || live.owned == null || live.adStatus == null) return '这条广告现在读不到，没有打开。'
  if (!live.owned) return '这条广告不在这个客户的广告账户里，没有打开。'
  if (holdAccountId && live.accountId && !sameAccount(holdAccountId, live.accountId)) {
    return '这条广告不在这个客户的广告账户里，没有打开。'
  }
  if (live.adStatus !== 'PAUSED') return '这条广告已经不是暂停，没有打开。'
  if (live.adsetStatus !== 'ACTIVE') return '广告组现在不是在投，没有打开。'
  if (live.campaignStatus !== 'ACTIVE') return '广告系列现在不是在投，没有打开。'
  return null
}

export function sameAccount(left: string, right: string): boolean {
  const a = left.startsWith('act_') ? left.slice(4) : left
  const b = right.startsWith('act_') ? right.slice(4) : right
  return a.length > 0 && a === b
}
