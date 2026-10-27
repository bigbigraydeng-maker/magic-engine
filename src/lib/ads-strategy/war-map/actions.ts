/**
 * ③ 今天要怎么调：把账户、素材池、频率、池子、经营视图里「该有人处理」的事排成一张清单。
 *
 * 🔴 第三句话不许在前两句判不了的时候说「今天没有要调的」：那是把「没看清」说成「没事」
 *    （魏征 2026-10-16 必改 3）。
 */

import { DATA_STALE_DAYS } from './frequency'
import { diffDays, nzDay, shortDay } from './util'
import type {
  AccountView, ActionRow, ActionSeverity, FrequencyRow, GrowthInput, Headline, PoolRow, WarMapInput,
} from './types'

/** 账户状态是几个小时前读的；超过就不能说「正常」 */
export const ACCOUNT_STALE_HOURS = 36

function accountActions(accounts: AccountView[]): ActionRow[] {
  if (accounts.length === 0) {
    return [{
      key: 'accounts-empty', severity: 'red',
      what: '读不到任何广告账户的状态',
      how: '稍后重试；持续读不出来找开发', owner: 'dev',
    }]
  }
  const out: ActionRow[] = []
  for (const a of accounts) {
    if (a.statusCode === null || a.light === 'unknown') {
      out.push({
        key: `account-status-${a.adAccountId}`, severity: 'yellow',
        what: `${a.name}：${a.sentence}`,
        how: '稍后重试；持续读不出来找开发', owner: 'dev',
      })
    } else if (a.statusCode !== 1) {
      out.push({
        key: `account-${a.adAccountId}`, severity: 'red',
        what: `${a.name} 广告账户状态异常（状态码 ${a.statusCode}）`,
        how: a.statusCode === 3
          ? '状态码 3 一般是欠款：结清后要看到当天有新数据、线索回流，才算恢复'
          : '去 Ads Manager 看账户提示',
        owner: 'pm',
      })
    }
  }
  return out
}

function creativeActions(approved: number | null): ActionRow[] {
  if (approved === null) {
    return [{ key: 'creative-pool-unreadable', severity: 'yellow', what: '读不到素材池', how: '稍后重试；持续读不出来找开发', owner: 'dev' }]
  }
  if (approved > 0) return []
  return [{
    key: 'creative-pool-empty', severity: 'red',
    what: '素材池里批准过的素材是 0 条（新建广告只能用批准过的素材）',
    how: '把过审的视频放进素材池并批准（走视频工厂审查）', owner: 'pm',
  }]
}

function frequencyActions(rows: FrequencyRow[], staleNote: string): ActionRow[] {
  return rows.flatMap((r): ActionRow[] => {
    if (r.light !== 'red' || r.frequency7d === null) return []
    return [{
      key: `freq-${r.campaignId}`, severity: 'red',
      what: `${r.campaignName} 频率 ${r.frequency7d.toFixed(2)}，高于 3${staleNote}`,
      how: '先换受众（扩大或轮换），再考虑降预算；改动前先看点击率有没有在掉', owner: 'agent',
    }]
  })
}

function poolHow(isVideo: boolean): string {
  return isVideo
    ? '查有没有广告在给它补人；没有就补一条攒池子的视频广告'
    : '这类池子靠视频广告补不了：先查它的收人规则有没有变'
}

function poolActions(rows: PoolRow[], videoIds: Set<string>): ActionRow[] {
  return rows.flatMap((r): ActionRow[] => {
    if (r.trend !== 'shrinking') return []
    return [{
      key: `pool-shrink-${r.id}`,
      severity: r.light === 'red' ? 'red' : 'yellow',
      what: `${r.name}：${r.trendNote}`,
      how: poolHow(videoIds.has(r.id)), owner: 'agent',
    }]
  })
}

function growthActions(g: GrowthInput | null, input: WarMapInput, accountsUnhealthy: boolean): ActionRow[] {
  if (g === null) {
    return [{ key: 'growth-missing', severity: 'info', what: '经营视图一行都没有', how: '等每天巡察；持续没有就找开发', owner: 'dev' }]
  }
  const today = nzDay(input.now)
  // 经营视图的日期是「数据截至日」：每天早上巡察时写的是昨天，所以截至昨天也算新；落后 2 天以上才是旧的
  const days = diffDays(g.date, today)
  const stale = days > 1
  const tag = stale ? `（${shortDay(g.date)} 的旧数据）` : ''
  const out: ActionRow[] = []
  if (stale) {
    out.push({
      key: 'growth-stale', severity: 'yellow',
      what: `经营视图是 ${shortDay(g.date)} 的，今天还没跑`,
      how: '等今天巡察；超过一天没有就找开发', owner: 'dev',
    })
  }
  g.problems.forEach((p, i) => {
    if (p.code === 'D7' && accountsUnhealthy) return // 只是重复「账户欠款」这件事
    out.push({ key: `growth-${p.code}-${i}`, severity: 'yellow', what: `${p.title}${tag}`, how: p.how ?? '见经营视图', owner: 'agent' })
  })
  g.opportunities.forEach((o, i) => {
    out.push({ key: `opp-${o.code}-${i}`, severity: 'info', what: `${o.title}${tag}`, how: '经营视图里有详情；加预算要你本人批', owner: 'pm' })
  })
  return out
}

const ORDER: Record<ActionSeverity, number> = { red: 0, yellow: 1, info: 2 }

function sortStable(actions: ActionRow[]): ActionRow[] {
  return actions
    .map((a, i) => ({ a, i }))
    .sort((x, y) => ORDER[x.a.severity] - ORDER[y.a.severity] || x.i - y.i)
    .map(x => x.a)
}

export interface AdjustContext {
  input: WarMapInput
  accounts: AccountView[]
  poolRows: PoolRow[]
  videoPoolIds: Set<string>
  frequencyRows: FrequencyRow[]
  upstream: Headline[]
  /** 表头同一口径的数据日 / 停了几天 */
  dataDay: string | null
  staleDays: number | null
}

function staleNote(ctx: AdjustContext): string {
  const { staleDays, dataDay } = ctx
  return staleDays !== null && staleDays > DATA_STALE_DAYS && dataDay ? `（数据停在 ${shortDay(dataDay)}）` : ''
}

export function buildAdjust(ctx: AdjustContext): { headline: Headline; actions: ActionRow[] } {
  const unhealthy = ctx.accounts.some(a => a.statusCode !== null && a.statusCode !== 1)
  const actions = sortStable([
    ...accountActions(ctx.accounts),
    ...creativeActions(ctx.input.creativePoolApproved),
    ...frequencyActions(ctx.frequencyRows, staleNote(ctx)),
    ...poolActions(ctx.poolRows, ctx.videoPoolIds),
    ...growthActions(ctx.input.growth, ctx.input, unhealthy),
  ])
  const red = actions.filter(a => a.severity === 'red')
  const yellow = actions.filter(a => a.severity === 'yellow').length
  if (red.length > 0) return { headline: { light: 'red', sentence: `今天有 ${red.length} 件要处理，最急：${red[0].what}` }, actions }
  if (yellow > 0) return { headline: { light: 'yellow', sentence: `今天有 ${yellow} 件要留意` }, actions }
  const blind = ctx.upstream.filter(h => h.light === 'unknown').length
  if (blind > 0) return { headline: { light: 'yellow', sentence: `没有明确要调的，但前两句里有 ${blind} 项判不了，先别当没事` }, actions }
  return { headline: { light: 'green', sentence: '今天没有要调的' }, actions }
}
