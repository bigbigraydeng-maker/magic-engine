/**
 * 从上一小时的盯盘回执里取出「Meta 线索比 CRM 多」是从什么时候开始的。
 * 读不懂 = null（当作第一次看见，这一小时先记时刻，不停）。
 */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function previousSurplusSince(summary: unknown, clientId: string, campaignId: string): string | null {
  if (!isRecord(summary) || !Array.isArray(summary.clients)) return null
  for (const client of summary.clients) {
    if (!isRecord(client) || client.client_id !== clientId) continue
    const watch = client.objective_watch
    if (!isRecord(watch) || !Array.isArray(watch.series)) return null
    for (const series of watch.series) {
      if (!isRecord(series) || series.campaign_id !== campaignId) continue
      const since = series.crm_surplus_since
      return typeof since === 'string' && !Number.isNaN(Date.parse(since)) ? since : null
    }
    return null
  }
  return null
}

/** 上一份回执里有没有这个系列。有、但盈余时刻是空的 = 已经对上了，不要再往更早的回执里翻。 */
export function summaryMentionsCampaign(summary: unknown, clientId: string, campaignId: string): boolean {
  if (!isRecord(summary) || !Array.isArray(summary.clients)) return false
  for (const client of summary.clients) {
    if (!isRecord(client) || client.client_id !== clientId) continue
    const watch = client.objective_watch
    if (!isRecord(watch) || !Array.isArray(watch.series)) return false
    return watch.series.some(series => isRecord(series) && series.campaign_id === campaignId)
  }
  return false
}
