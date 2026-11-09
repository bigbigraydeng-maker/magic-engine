/**
 * 在投预算合计的口径（系列级预算优先、其下广告组不再单独计入；终身预算不折算日预算、只数个数）。
 * 从 budget-reader.ts 挪出，让「读 Meta 现读的在投预算」和「读库里快照的其它账户在投预算」共用同一个口径，不要各写一份。
 */

export interface LiveEntity {
  id: string
  campaignId: string | null
  daily: number
  lifetime: number
}

export interface LiveTotals {
  daily: number
  lifetime: number
  entities: number
}

/** 系列级预算（日预算或终身预算）的系列，旗下广告组不再单独算；其余在投广告组用自己的预算。 */
export function totalLive(campaigns: readonly LiveEntity[], adsets: readonly LiveEntity[]): LiveTotals {
  const totals: LiveTotals = { daily: 0, lifetime: 0, entities: 0 }
  const campaignBudgeted = new Set<string>()
  for (const c of campaigns) {
    if (c.daily > 0) {
      totals.daily += c.daily
      totals.entities += 1
      campaignBudgeted.add(c.id)
    } else if (c.lifetime > 0) {
      totals.lifetime += 1
      campaignBudgeted.add(c.id)
    }
  }
  for (const a of adsets) {
    if (a.campaignId !== null && campaignBudgeted.has(a.campaignId)) continue
    if (a.daily > 0) {
      totals.daily += a.daily
      totals.entities += 1
    } else if (a.lifetime > 0) {
      totals.lifetime += 1
    } else {
      throw new Error(`在投的广告组 ${a.id} 一个预算都没读到，合计会漏算`)
    }
  }
  return totals
}
