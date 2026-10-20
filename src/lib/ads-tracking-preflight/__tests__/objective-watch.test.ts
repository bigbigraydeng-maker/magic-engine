/**
 * 按目标盯盘 · 纯判定逻辑（不读网络、不读库、不读时钟）。
 *
 * 播放量系列看 完整播放 / 触达 / 频次；聊天系列看 开始聊天数 / 单个成本 / ME 有没有收到；
 * 所有系列都盯「改动后一直没花钱」。系列停了就自动不盯。只出提醒，从不动广告。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FREQUENCY_RED,
  DEFAULT_FREQUENCY_YELLOW,
  DEFAULT_ZERO_SPEND_RED_HOURS,
  DEFAULT_ZERO_SPEND_YELLOW_HOURS,
  FREQUENCY_MIN_REACH,
  OBJECTIVE_ALERT_MAX_TICK_AGE_MS,
  isInPlay,
  judgeSeries,
  latestObjectiveAlerts,
  type CampaignFact,
  type EntityFact,
  type JudgeSeriesInput,
  type MetricsRow,
  type SeriesFacts,
} from '../objective-watch'
import type { ObjectiveWatchConfig, ObjectiveWatchSeries } from '../types'

const NOW = new Date('2026-10-21T10:00:00.000Z')
const ago = (hours: number): string => new Date(NOW.getTime() - hours * 3_600_000).toISOString()

const CAMPAIGN_ID = '111111111111'
const AWARENESS: ObjectiveWatchSeries = { campaign_id: CAMPAIGN_ID, kind: 'awareness', label: '播放量系列' }
const MESSAGING: ObjectiveWatchSeries = { campaign_id: CAMPAIGN_ID, kind: 'whatsapp', label: '聊天系列' }
const WATCH: ObjectiveWatchConfig = { series: [AWARENESS, MESSAGING] }
const LINKS = { ads_manager: 'https://ads.example.test/manage', crm: 'https://app.example.test/crm' }

function campaign(over: Partial<CampaignFact> = {}): CampaignFact {
  return {
    id: CAMPAIGN_ID, name: '测试系列', objective: 'OUTCOME_AWARENESS', status: 'ACTIVE', effective_status: 'ACTIVE',
    created_at: ago(30), updated_at: ago(20), ...over,
  }
}
const adset = (id: string, over: Partial<EntityFact> = {}): EntityFact => ({
  id, name: `广告组 ${id}`, parent_id: null, status: 'ACTIVE', effective_status: 'ACTIVE', updated_at: ago(10), ...over,
})
const ad = (id: string, adsetId: string, over: Partial<EntityFact> = {}): EntityFact => ({
  id, name: `广告 ${id}`, parent_id: adsetId, status: 'ACTIVE', effective_status: 'ACTIVE', updated_at: ago(10), ...over,
})
const row = (id: string, over: Partial<MetricsRow> = {}): MetricsRow => ({
  id, name: `行 ${id}`, spend_cents: 0, impressions: 0, reach: null, frequency: null,
  thruplays: 0, cost_per_thruplay: null, conversations: 0, cost_per_conversation: null, ...over,
})
function facts(over: Partial<SeriesFacts> = {}): SeriesFacts {
  return {
    read: true, as_of: NOW.toISOString(), campaign: campaign(),
    adsets: [adset('s1')], ads: [ad('a1', 's1'), ad('a2', 's1')],
    total: null, by_adset: [], by_ad: [], ...over,
  }
}
function judge(over: Partial<JudgeSeriesInput> = {}) {
  return judgeSeries({ watch: WATCH, series: AWARENESS, facts: facts(), me: null, now: NOW, currency: 'NZD', links: LINKS, ...over })
}
const spending = (over: Partial<MetricsRow> = {}): MetricsRow => row(CAMPAIGN_ID, { spend_cents: 5000, impressions: 4000, reach: 1000, frequency: 1.2, ...over })

describe('isInPlay · 哪些状态算「还在投」', () => {
  it('暂停 / 广告组暂停 / 系列暂停 / 归档 / 删除 = 停了；其余（含审核中、被拒登、读不出）都还算在盯', () => {
    for (const s of ['PAUSED', 'ADSET_PAUSED', 'CAMPAIGN_PAUSED', 'ARCHIVED', 'DELETED']) expect(isInPlay(s)).toBe(false)
    for (const s of ['ACTIVE', 'PENDING_REVIEW', 'IN_PROCESS', 'DISAPPROVED', 'WITH_ISSUES', 'PENDING_BILLING_INFO', 'WHATEVER_NEW', null]) {
      expect(isInPlay(s)).toBe(true)
    }
  })
})

describe('judgeSeries · 状态', () => {
  it('系列整体暂停 → stopped，没有任何提醒（哪怕没花钱）', () => {
    const v = judge({ facts: facts({ campaign: campaign({ status: 'PAUSED', effective_status: 'PAUSED' }), ads: [ad('a1', 's1', { effective_status: 'CAMPAIGN_PAUSED', updated_at: ago(40) })] }) })
    expect(v.state).toBe('stopped')
    expect(v.alerts).toEqual([])
    expect(v.headline).toContain('播放量系列')
    expect(v.headline).toContain('不盯')
  })

  it('系列开着、但里面的广告组和广告都停了 → stopped（比如旧版本被换掉了）', () => {
    const v = judge({
      facts: facts({
        adsets: [adset('s1', { effective_status: 'PAUSED', updated_at: ago(50) })],
        ads: [ad('a1', 's1', { effective_status: 'ADSET_PAUSED', updated_at: ago(50) })],
      }),
    })
    expect(v.state).toBe('stopped')
    expect(v.alerts).toEqual([])
  })

  it('有在投的广告、系列一共还没花钱 → waiting_first_spend；有花费 → delivering', () => {
    expect(judge({ facts: facts({ total: null }) }).state).toBe('waiting_first_spend')
    expect(judge({ facts: facts({ total: row(CAMPAIGN_ID, { spend_cents: 0 }) }) }).state).toBe('waiting_first_spend')
    expect(judge({ facts: facts({ total: spending() }) }).state).toBe('delivering')
  })

  it('读不到 → unread，一条黄灯 read_failed（写明系列名和原因），不抛错', () => {
    const v = judge({ facts: { read: false, error: 'Meta 400：令牌过期（code 190）' } })
    expect(v.state).toBe('unread')
    expect(v.error).toBe('Meta 400：令牌过期（code 190）')
    expect(v.alerts).toHaveLength(1)
    expect(v.alerts[0]).toMatchObject({ code: 'read_failed', level: 'yellow', href: LINKS.ads_manager })
    expect(v.alerts[0].what).toContain('播放量系列')
    expect(v.alerts[0].what).toContain('令牌过期')
  })

  it('读到了但整个系列没有任何「最后修改时间」可用 → 当成读不全（unread），不是安静地放过', () => {
    const v = judge({
      facts: facts({
        campaign: campaign({ updated_at: null, created_at: null }),
        adsets: [adset('s1', { updated_at: null })],
        ads: [ad('a1', 's1', { updated_at: null })],
      }),
    })
    expect(v.state).toBe('unread')
    expect(v.alerts.map(a => a.code)).toEqual(['read_failed'])
  })
})

describe('judgeSeries · 改动后一直没花钱', () => {
  it('从「在投的」系列 / 广告组 / 广告里最晚的修改时间起算；已停掉的东西的修改不算', () => {
    const v = judge({
      facts: facts({
        campaign: campaign({ updated_at: ago(9) }),
        adsets: [adset('s2', { updated_at: ago(8) }), adset('old', { effective_status: 'PAUSED', updated_at: ago(1) })],
        ads: [
          ad('a3', 's2', { effective_status: 'PENDING_REVIEW', updated_at: ago(7.5) }),
          ad('a1', 'old', { effective_status: 'ADSET_PAUSED', updated_at: ago(1) }),
        ],
      }),
    })
    expect(v.anchor_at).toBe(ago(7.5))
    expect(v.hours_since_anchor).toBe(7.5)
    expect(v.alerts.map(a => a.code)).toEqual(['zero_spend'])
    expect(v.alerts[0].level).toBe('yellow')
  })

  it('默认阈值：不到 6 小时不提醒；满 6 小时黄灯；满 24 小时红灯（边界含等号）', () => {
    expect(DEFAULT_ZERO_SPEND_YELLOW_HOURS).toBe(6)
    expect(DEFAULT_ZERO_SPEND_RED_HOURS).toBe(24)
    const at = (h: number) => judge({ facts: facts({ campaign: campaign({ updated_at: ago(h) }), adsets: [adset('s1', { updated_at: ago(h) })], ads: [ad('a1', 's1', { updated_at: ago(h) })] }) })
    expect(at(5.9).alerts).toEqual([])
    expect(at(6).alerts.map(a => a.level)).toEqual(['yellow'])
    expect(at(23.9).alerts.map(a => a.level)).toEqual(['yellow'])
    expect(at(24).alerts.map(a => a.level)).toEqual(['red'])
    expect(at(100).alerts.map(a => a.level)).toEqual(['red'])
  })

  it('系列里单独配了阈值就按它的来', () => {
    const watch: ObjectiveWatchConfig = { series: [AWARENESS], zero_spend_yellow_hours: 2, zero_spend_red_hours: 3 }
    const at = (h: number) => judge({ watch, facts: facts({ campaign: campaign({ updated_at: ago(h) }), adsets: [adset('s1', { updated_at: ago(h) })], ads: [ad('a1', 's1', { updated_at: ago(h) })] }) })
    expect(at(1.9).alerts).toEqual([])
    expect(at(2).alerts.map(a => a.level)).toEqual(['yellow'])
    expect(at(3).alerts.map(a => a.level)).toEqual(['red'])
  })

  it('已经花过钱 → 不出「没花钱」提醒（就算最后修改时间很久以前）', () => {
    const v = judge({ facts: facts({ campaign: campaign({ updated_at: ago(80) }), adsets: [adset('s1', { updated_at: ago(80) })], ads: [ad('a1', 's1', { updated_at: ago(80) })], total: spending() }) })
    expect(v.alerts.find(a => a.code === 'zero_spend')).toBeUndefined()
  })

  it('提醒用大白话：说清是哪个系列、过了几小时、广告现在是什么状态，并指向广告管理工具', () => {
    const v = judge({
      facts: facts({
        campaign: campaign({ updated_at: ago(7) }),
        adsets: [adset('s1', { updated_at: ago(7) })],
        ads: [
          ad('a1', 's1', { name: 'A2 价格悬念', effective_status: 'PENDING_REVIEW', updated_at: ago(7) }),
          ad('a2', 's1', { name: 'B3 故事', effective_status: 'DISAPPROVED', updated_at: ago(7) }),
        ],
      }),
    })
    const alert = v.alerts[0]
    expect(alert.what).toContain('播放量系列')
    expect(alert.what).toContain('7 小时')
    expect(alert.what).toContain('一分钱都没花')
    expect(alert.what).toContain('审核')
    expect(alert.what).toContain('B3 故事')
    expect(alert.what).toContain('拒登')
    expect(alert.how).toContain('没有动')
    expect(alert.href).toBe(LINKS.ads_manager)
  })

  it('广告都显示「投放中」却不花钱 → 提示多半是受众或出价', () => {
    const v = judge({
      facts: facts({ campaign: campaign({ updated_at: ago(8) }), adsets: [adset('s1', { updated_at: ago(8) })], ads: [ad('a1', 's1', { updated_at: ago(8) })] }),
    })
    expect(v.alerts[0].what).toContain('投放中')
    expect(v.alerts[0].what).toMatch(/受众|出价/)
  })

  it('统计在投广告各状态的个数（停掉的不算）', () => {
    const v = judge({
      facts: facts({
        ads: [
          ad('a1', 's1', { effective_status: 'PENDING_REVIEW' }),
          ad('a2', 's1', { effective_status: 'PENDING_REVIEW' }),
          ad('a3', 's1', { effective_status: 'ACTIVE' }),
          ad('a4', 's1', { effective_status: 'ADSET_PAUSED' }),
        ],
      }),
    })
    expect(v.ad_status_counts).toEqual({ PENDING_REVIEW: 2, ACTIVE: 1 })
  })
})

describe('judgeSeries · 播放量系列的频次', () => {
  it('默认 3 / 4，严格大于才提醒', () => {
    expect(DEFAULT_FREQUENCY_YELLOW).toBe(3)
    expect(DEFAULT_FREQUENCY_RED).toBe(4)
    const at = (f: number) => judge({ facts: facts({ total: spending({ frequency: f, reach: 1000 }) }) })
    expect(at(3).alerts).toEqual([])
    expect(at(3.01).alerts.map(a => [a.code, a.level])).toEqual([['frequency', 'yellow']])
    expect(at(4).alerts.map(a => a.level)).toEqual(['yellow'])
    expect(at(4.01).alerts.map(a => a.level)).toEqual(['red'])
  })

  it('每个视频（广告）各自看：把超线的列出来，没超的不列', () => {
    const v = judge({
      facts: facts({
        ads: [ad('a1', 's1', { name: 'A2 价格悬念' }), ad('a2', 's1', { name: 'B3 故事' })],
        total: spending({ frequency: 2.5 }),
        by_ad: [
          row('a1', { name: 'A2 价格悬念', spend_cents: 3000, reach: 500, frequency: 4.3 }),
          row('a2', { name: 'B3 故事', spend_cents: 2000, reach: 500, frequency: 2.1 }),
        ],
      }),
    })
    expect(v.alerts).toHaveLength(1)
    expect(v.alerts[0]).toMatchObject({ code: 'frequency', level: 'red', href: LINKS.ads_manager })
    expect(v.alerts[0].what).toContain('播放量系列')
    expect(v.alerts[0].what).toContain('A2 价格悬念')
    expect(v.alerts[0].what).toContain('4.3')
    expect(v.alerts[0].what).not.toContain('B3 故事')
    expect(v.alerts[0].how).toContain('没有动')
  })

  it('整个系列超线也列出来', () => {
    const v = judge({ facts: facts({ total: spending({ frequency: 3.4, reach: 1000 }) }) })
    expect(v.alerts[0].level).toBe('yellow')
    expect(v.alerts[0].what).toContain('整个系列')
    expect(v.alerts[0].what).toContain('3.4')
  })

  it('触达太少（样本不够）时不判频次', () => {
    expect(FREQUENCY_MIN_REACH).toBe(100)
    const v = judge({ facts: facts({ total: spending({ frequency: 5, reach: FREQUENCY_MIN_REACH - 1 }) }) })
    expect(v.alerts).toEqual([])
    const enough = judge({ facts: facts({ total: spending({ frequency: 5, reach: FREQUENCY_MIN_REACH }) }) })
    expect(enough.alerts.map(a => a.code)).toEqual(['frequency'])
  })

  it('已停掉的广告的频次不算；聊天系列不判频次', () => {
    const stopped = judge({
      facts: facts({
        ads: [ad('a1', 's1'), ad('old', 's1', { effective_status: 'ADSET_PAUSED' })],
        total: spending({ frequency: 2 }),
        by_ad: [row('old', { name: '旧版本', spend_cents: 100, reach: 900, frequency: 6 })],
      }),
    })
    expect(stopped.alerts).toEqual([])
    const messaging = judge({ series: MESSAGING, facts: facts({ total: spending({ frequency: 9, reach: 1000 }) }) })
    expect(messaging.alerts.find(a => a.code === 'frequency')).toBeUndefined()
  })

  it('系列里单独配了频次阈值就按它的来', () => {
    const series: ObjectiveWatchSeries = { ...AWARENESS, frequency_yellow: 5, frequency_red: 8 }
    const at = (f: number) => judge({ series, facts: facts({ total: spending({ frequency: f, reach: 1000 }) }) })
    expect(at(5).alerts).toEqual([])
    expect(at(5.5).alerts.map(a => a.level)).toEqual(['yellow'])
    expect(at(8.5).alerts.map(a => a.level)).toEqual(['red'])
  })
})

describe('judgeSeries · 聊天系列：ME 有没有收到', () => {
  const chatting = (conversations: number, over: Partial<MetricsRow> = {}) =>
    facts({ total: spending({ conversations, cost_per_conversation: 3.2, ...over }) })
  const me = (count: number) => ({ read: true as const, count, since: ago(30) })

  it('Meta 说有人开始聊天、ME 一个都没收到 → 红灯，指向 CRM', () => {
    const v = judge({ series: MESSAGING, facts: chatting(5), me: me(0) })
    expect(v.alerts).toHaveLength(1)
    expect(v.alerts[0]).toMatchObject({ code: 'me_not_receiving', level: 'red', href: LINKS.crm })
    expect(v.alerts[0].what).toContain('聊天系列')
    expect(v.alerts[0].what).toContain('5')
    expect(v.alerts[0].how).toContain('CRM')
  })

  it('Meta 只有 1 个、ME 一个都没收到，也是红灯', () => {
    expect(judge({ series: MESSAGING, facts: chatting(1), me: me(0) }).alerts.map(a => a.level)).toEqual(['red'])
  })

  it('ME 收到不到一半 → 黄灯；收到一半以上、或 Meta 只有 1～2 个而 ME 至少收到 1 个 → 不提醒', () => {
    expect(judge({ series: MESSAGING, facts: chatting(5), me: me(2) }).alerts.map(a => a.level)).toEqual(['yellow'])
    expect(judge({ series: MESSAGING, facts: chatting(5), me: me(3) }).alerts).toEqual([])
    expect(judge({ series: MESSAGING, facts: chatting(2), me: me(1) }).alerts).toEqual([])
    expect(judge({ series: MESSAGING, facts: chatting(6), me: me(9) }).alerts).toEqual([])
  })

  it('Meta 还没有聊天数 → 不比；ME 没读到 → 不比（记下原因），也不当成「没收到」', () => {
    expect(judge({ series: MESSAGING, facts: chatting(0), me: me(0) }).alerts).toEqual([])
    const unread = judge({ series: MESSAGING, facts: chatting(5), me: { read: false, error: '库连不上' } })
    expect(unread.alerts).toEqual([])
    expect(unread.me).toMatchObject({ read: false, count: null, meta_conversations: 5, error: '库连不上' })
  })

  it('播放量系列不做这项比对', () => {
    const v = judge({ series: AWARENESS, facts: chatting(5), me: me(0) })
    expect(v.alerts.find(a => a.code === 'me_not_receiving')).toBeUndefined()
    expect(v.me).toBeNull()
  })
})

describe('judgeSeries · 回执里的数字与一句话摘要', () => {
  it('播放量系列：完整播放 / 单个成本 / 触达 / 频次 / 花费', () => {
    const v = judge({ facts: facts({ total: spending({ spend_cents: 1240, thruplays: 120, cost_per_thruplay: 0.05, reach: 4300, frequency: 1.3 }) }) })
    expect(v.headline).toContain('播放量系列')
    expect(v.headline).toContain('完整播放 120')
    expect(v.headline).toContain('NZ$0.05')
    expect(v.headline).toContain('4,300')
    expect(v.headline).toContain('1.3')
    expect(v.headline).toContain('NZ$12.40')
    expect(v.total).toMatchObject({ thruplays: 120, cost_per_thruplay: 0.05 })
  })

  it('聊天系列：开始聊天数 / 单个成本 / 花费 / ME 收到几个', () => {
    const v = judge({
      series: MESSAGING,
      facts: facts({ total: spending({ spend_cents: 1600, conversations: 5, cost_per_conversation: 3.2 }) }),
      me: { read: true, count: 4, since: ago(30) },
    })
    expect(v.headline).toContain('聊天系列')
    expect(v.headline).toContain('开始聊天 5')
    expect(v.headline).toContain('NZ$3.20')
    expect(v.headline).toContain('NZ$16.00')
    expect(v.headline).toContain('ME 收到 4')
    expect(v.me).toMatchObject({ read: true, count: 4, meta_conversations: 5 })
  })

  it('没花钱时摘要写「还没花钱」和距离最后一次修改的小时数', () => {
    const v = judge({ facts: facts({ campaign: campaign({ updated_at: ago(2) }), adsets: [adset('s1', { updated_at: ago(2) })], ads: [ad('a1', 's1', { updated_at: ago(2), effective_status: 'PENDING_REVIEW' })] }) })
    expect(v.headline).toContain('还没花钱')
    expect(v.headline).toContain('2')
  })

  it('按广告组（受众）和按广告（视频）拆开：在投的都列出来（没数据也列），停掉的只在有花费时列', () => {
    const v = judge({
      series: MESSAGING,
      facts: facts({
        adsets: [adset('s1', { name: '受众甲' }), adset('s2', { name: '受众乙' }), adset('old', { name: '旧受众', effective_status: 'PAUSED' }), adset('old2', { name: '更旧受众', effective_status: 'PAUSED' })],
        ads: [
          ad('a1', 's1', { name: '视频 A2' }),
          ad('a2', 's2', { name: '视频 B3', effective_status: 'PENDING_REVIEW' }),
          ad('o1', 'old', { name: '旧视频', effective_status: 'ADSET_PAUSED' }),
        ],
        total: spending({ conversations: 3 }),
        by_adset: [
          row('s1', { name: '受众甲', spend_cents: 4000, conversations: 3, cost_per_conversation: 13.3 }),
          row('old', { name: '旧受众', spend_cents: 1000, conversations: 0 }),
        ],
        by_ad: [row('a1', { name: '视频 A2', spend_cents: 4000, conversations: 3 })],
      }),
      me: { read: true, count: 3, since: ago(30) },
    })
    expect(v.by_adset.map(s => [s.id, s.in_play])).toEqual([['s1', true], ['s2', true], ['old', false]])
    expect(v.by_adset.find(s => s.id === 's2')).toMatchObject({ spend_cents: 0, effective_status: 'ACTIVE' })
    expect(v.by_ad.map(s => [s.id, s.in_play])).toEqual([['a1', true], ['a2', true]])
    expect(v.by_ad.find(s => s.id === 'a2')).toMatchObject({ effective_status: 'PENDING_REVIEW', spend_cents: 0 })
  })

  it('回执里不带任何令牌样子的东西（只有数字和名字）', () => {
    const v = judge({ facts: facts({ total: spending() }) })
    expect(JSON.stringify(v)).not.toMatch(/access_token|Bearer|EAAB/)
  })
})

describe('latestObjectiveAlerts · 今日待办从盯盘回执里取提醒', () => {
  const alert = (code: string, level: string) => ({ code, level, what: `什么-${code}`, how: `怎么办-${code}`, href: `https://x.test/${code}` })
  const entry = (alerts: unknown[], clientId = 'c1') => ({
    client_id: clientId, active: false, spend_seen: null, series_found: null, sent: [], error: null,
    objective_watch: { as_of: ago(1), error: null, series: [{ campaign_id: CAMPAIGN_ID, label: '播放量系列', alerts }] },
  })
  const tick = (hoursAgo: number, clients: unknown[], status: string | null = 'completed') => ({
    status, started_at: ago(hoursAgo), summary: { checked_at: ago(hoursAgo), no_publish: true, clients },
  })

  it('取最新一次盯盘里这个客户的提醒', () => {
    const out = latestObjectiveAlerts([tick(1, [entry([alert('zero_spend', 'red')])])], 'c1', NOW)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ code: 'zero_spend', level: 'red', what: '什么-zero_spend', how: '怎么办-zero_spend', href: 'https://x.test/zero_spend', campaign_id: CAMPAIGN_ID, label: '播放量系列' })
  })

  it('只看最新一次：更早那次有提醒、最新这次没有 → 没有（问题已经消了）', () => {
    const rows = [tick(5, [entry([alert('zero_spend', 'red')])]), tick(1, [entry([])])]
    expect(latestObjectiveAlerts(rows, 'c1', NOW)).toEqual([])
  })

  it('记录顺序不重要；还在跑的记录不算', () => {
    const rows = [tick(1, [entry([alert('frequency', 'yellow')])]), tick(0.2, [entry([alert('zero_spend', 'red')])], 'running'), tick(4, [entry([alert('zero_spend', 'red')])])]
    expect(latestObjectiveAlerts(rows, 'c1', NOW).map(a => a.code)).toEqual(['frequency'])
  })

  it('最新一次盯盘已经超过 3 小时 → 不出（是盯盘自己没在跑，不是系列有事）', () => {
    expect(OBJECTIVE_ALERT_MAX_TICK_AGE_MS).toBe(3 * 3_600_000)
    expect(latestObjectiveAlerts([tick(2.9, [entry([alert('zero_spend', 'red')])])], 'c1', NOW)).toHaveLength(1)
    expect(latestObjectiveAlerts([tick(3.1, [entry([alert('zero_spend', 'red')])])], 'c1', NOW)).toEqual([])
  })

  it('别的客户的提醒不算；这个客户没有按目标盯盘的字段 → 没有', () => {
    expect(latestObjectiveAlerts([tick(1, [entry([alert('zero_spend', 'red')], 'other')])], 'c1', NOW)).toEqual([])
    const bare = { client_id: 'c1', active: false, spend_seen: null, series_found: null, sent: [], error: null }
    expect(latestObjectiveAlerts([tick(1, [bare])], 'c1', NOW)).toEqual([])
  })

  it('格式不对的记录 / 提醒被丢掉，不抛错', () => {
    const bad = [
      { status: 'completed', started_at: ago(1), summary: null },
      { status: 'completed', started_at: ago(1), summary: { checked_at: 'not-a-date', clients: [] } },
      tick(1, [entry([alert('zero_spend', 'purple'), { code: 'zero_spend', level: 'red' }, 'junk', alert('frequency', 'yellow')])]),
    ]
    const out = latestObjectiveAlerts(bad, 'c1', NOW)
    expect(out.map(a => a.code)).toEqual(['frequency'])
  })
})
