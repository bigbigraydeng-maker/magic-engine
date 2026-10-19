import { describe, expect, it } from 'vitest'
import {
  GATE_LABELS,
  applyKnownIssues,
  judgePostLaunch,
  judgePreflightGates,
  overallLight,
  preconditionsMet,
} from '../judge'
import {
  HARD_GATE,
  POST_GATE_KEYS,
  PREFLIGHT_GATE_KEYS,
  type JudgeInput,
  type PostLaunchFacts,
  type PreflightGateKey,
  type TrackingGateReceipt,
} from '../types'

// 全部用虚构编号：平台通用代码的测试里不许出现任何真实客户的编号 / 域名。
const OFFICIAL = '1000000000000001'
const OTHER_OFFICIAL = '1000000000000002'
const SITE_ONLY = '1000000000000009'
const ELSEWHERE = '1000000000000077'

const NOW = new Date('2026-10-19T10:30:00.000Z')
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString()

function baseInput(): JudgeInput {
  return {
    now: NOW,
    config: {
      ad_account_id: 'act_1111111111',
      site_url: 'https://www.example-shop.test',
      landing_targets: [{ label: '落地页 A', url: 'https://www.example-shop.test/p?utm_content=a' }],
      ga4_lead_events: ['generate_lead', 'enquiry_thank_you'],
      web_form_to_crm: true,
      planned_daily_budget_cents: 10100,
      official_daily_cap_cents: 11000,
      currency: 'NZD',
    },
    meta: {
      read: true,
      as_of: NOW.toISOString(),
      account_dataset_ids: [OFFICIAL, OTHER_OFFICIAL],
      datasets: [
        {
          id: OFFICIAL, name: 'Main', last_fired_at: hoursAgo(2),
          events_24h: { PageView: 120, Lead: 2 }, events_7d: { PageView: 900, Lead: 13 },
          match_quality: { Lead: 9.3, PageView: 6.1 },
        },
        { id: OTHER_OFFICIAL, name: 'Unused', last_fired_at: null, events_24h: {}, events_7d: {}, match_quality: null },
      ],
      account: {
        status: 1, disable_reason: 0, has_funding_source: true,
        spend_cap_minor: 0, amount_spent_minor: 29434, currency: 'NZD',
      },
    },
    landing: {
      as_of: NOW.toISOString(),
      probes: [{
        label: '落地页 A', url: 'https://www.example-shop.test/p?utm_content=a', http_status: 200,
        final_url: 'https://www.example-shop.test/p?utm_content=a', redirects: 0,
        utm_preserved: true, pixel_ids: [OFFICIAL, SITE_ONLY], error: null,
      }],
    },
    ga4: { read: true, error: null, events_7d: { generate_lead: 8, enquiry_thank_you: 5 }, as_of: NOW.toISOString() },
    crm: { read: true, error: null, web_form_touchpoints_7d: 6, latest_web_form_at: hoursAgo(5), as_of: NOW.toISOString() },
    env: {
      capi_target: { status: 'configured', pixel_id: OFFICIAL },
      capi_preflight: { ok: true, stage: null, token_valid: true, pixel_visible: true },
      capi_events_7d: { confirmed: 4, in_doubt: 0, failed: 0 },
      meta_token_resolved: true,
      jobs: [
        { job: 'meta-leads-sync', max_age_hours: 3, last_finished_at: hoursAgo(1), last_status: 'completed' },
        { job: 'messenger-sync-hourly', max_age_hours: 3, last_finished_at: hoursAgo(0.5), last_status: 'completed' },
      ],
      as_of: NOW.toISOString(),
    },
  }
}

function judge(mutate?: (i: JudgeInput) => void): TrackingGateReceipt[] {
  const input = JSON.parse(JSON.stringify(baseInput())) as JudgeInput
  input.now = NOW
  mutate?.(input)
  return judgePreflightGates(input)
}

function gate(gates: TrackingGateReceipt[], key: PreflightGateKey): TrackingGateReceipt {
  const found = gates.find(g => g.key === key)
  if (!found) throw new Error(`gate ${key} missing`)
  return found
}

describe('judgePreflightGates · 基线', () => {
  it('每一项都满足 → 十道门全绿，顺序和词表一致，硬/软标记对得上', () => {
    const gates = judge()
    expect(gates.map(g => g.key)).toEqual([...PREFLIGHT_GATE_KEYS])
    for (const g of gates) {
      expect(g.status, `${g.key}: ${g.reason}`).toBe('green')
      expect(g.hard).toBe(HARD_GATE[g.key])
      expect(g.reason.length).toBeGreaterThan(0)
      expect(g.na).toBeUndefined()
    }
    expect(overallLight(gates)).toBe('green')
    expect(preconditionsMet(gates)).toBe(true)
  })

  it('每道门都有中文名', () => {
    for (const key of [...PREFLIGHT_GATE_KEYS, ...POST_GATE_KEYS]) {
      expect(GATE_LABELS[key].length).toBeGreaterThan(0)
    }
  })
})

describe('tracking.account_dataset_aligned', () => {
  const KEY = 'tracking.account_dataset_aligned'

  it('官网在往官方数据集发、ME 回传目标也是它 → 绿', () => {
    expect(gate(judge(), KEY).status).toBe('green')
  })

  it('官网页面上的像素一个都不在官方账户的数据集里 → 红，证据里列出双方编号', () => {
    const g = gate(judge(i => { i.landing.probes[0].pixel_ids = [SITE_ONLY] }), KEY)
    expect(g.status).toBe('red')
    expect(g.hard).toBe(true)
    expect(g.evidence.official_dataset_ids).toEqual([OFFICIAL, OTHER_OFFICIAL])
    expect(g.evidence.site_pixel_ids).toEqual([SITE_ONLY])
  })

  it('官网在发官方数据集，但 ME 回传目标是另一个 → 黄，且回执里不出现 ME 回传目标的编号', () => {
    const g = gate(judge(i => { i.env.capi_target = { status: 'configured', pixel_id: ELSEWHERE } }), KEY)
    expect(g.status).toBe('yellow')
    expect(g.reason).toContain('回传')
    expect(JSON.stringify(g)).not.toContain(ELSEWHERE)
  })

  it('ME 没配回传目标 → 黄', () => {
    const g = gate(judge(i => { i.env.capi_target = { status: 'not_configured', pixel_id: null } }), KEY)
    expect(g.status).toBe('yellow')
  })

  it('黄灯的「怎么办」要提醒：改回传目标是改生产配置，要 PM 同意，改完要手动重新部署', () => {
    const g = gate(judge(i => { i.env.capi_target = { status: 'configured', pixel_id: ELSEWHERE } }), KEY)
    expect(g.how).toContain('PM')
    expect(g.how).toContain('部署')
  })

  it('回传目标读不出来 → 灰（硬门灰 = 挡住）', () => {
    const g = gate(judge(i => { i.env.capi_target = { status: 'unreadable', pixel_id: null } }), KEY)
    expect(g.status).toBe('gray')
  })

  it('官方账户的数据集没读到 → 灰', () => {
    const g = gate(judge(i => { i.meta.read = false; i.meta.account_dataset_ids = [] }), KEY)
    expect(g.status).toBe('gray')
  })

  it('官方账户读到了但名下一个数据集都没有 → 红', () => {
    const g = gate(judge(i => { i.meta.account_dataset_ids = []; i.meta.datasets = [] }), KEY)
    expect(g.status).toBe('red')
  })

  it('官网一个页面都没探通 → 灰（没证据不等于对齐）', () => {
    const g = gate(judge(i => { i.landing.probes[0].http_status = null; i.landing.probes[0].pixel_ids = []; i.landing.probes[0].error = 'timeout' }), KEY)
    expect(g.status).toBe('gray')
  })
})

describe('tracking.pixel_alive', () => {
  const KEY = 'tracking.pixel_alive'

  it('24 小时内触发过且 24 小时内有 PageView → 绿', () => {
    expect(gate(judge(), KEY).status).toBe('green')
  })

  it('从没触发过且没有 PageView → 红', () => {
    const g = gate(judge(i => { i.meta.datasets[0].last_fired_at = null; i.meta.datasets[0].events_24h = {} }), KEY)
    expect(g.status).toBe('red')
    expect(g.hard).toBe(true)
  })

  it('最后触发在 30 小时前且 24 小时内没有 PageView → 红', () => {
    const g = gate(judge(i => { i.meta.datasets[0].last_fired_at = hoursAgo(30); i.meta.datasets[0].events_24h = {} }), KEY)
    expect(g.status).toBe('red')
  })

  it('最后触发时间显示很旧，但 24 小时内确实有 PageView → 黄（多半是 Meta 显示延迟）', () => {
    const g = gate(judge(i => { i.meta.datasets[0].last_fired_at = hoursAgo(30); i.meta.datasets[0].events_24h = { PageView: 5 } }), KEY)
    expect(g.status).toBe('yellow')
  })

  it('刚好 24 小时前触发 → 还算在线；再多一分钟就不算', () => {
    const edge = gate(judge(i => { i.meta.datasets[0].last_fired_at = hoursAgo(24) }), KEY)
    expect(edge.status).toBe('green')
    const over = gate(judge(i => { i.meta.datasets[0].last_fired_at = hoursAgo(24 + 1 / 60) }), KEY)
    expect(over.status).toBe('yellow')
  })

  it('最近触发过但 24 小时内一条 PageView 都没有 → 红', () => {
    const g = gate(judge(i => { i.meta.datasets[0].events_24h = { Lead: 2 } }), KEY)
    expect(g.status).toBe('red')
  })

  it('事件统计没读到 → 灰', () => {
    const g = gate(judge(i => { i.meta.datasets[0].events_24h = null }), KEY)
    expect(g.status).toBe('gray')
  })

  it('官网同时发两个官方数据集，一个在线一个已死 → 黄', () => {
    const g = gate(judge(i => {
      i.landing.probes[0].pixel_ids = [OFFICIAL, OTHER_OFFICIAL]
      i.meta.datasets[1].events_24h = {}
    }), KEY)
    expect(g.status).toBe('yellow')
  })

  it('官网没往官方数据集发数据 → 灰（先把数据集对上）', () => {
    const g = gate(judge(i => { i.landing.probes[0].pixel_ids = [SITE_ONLY] }), KEY)
    expect(g.status).toBe('gray')
  })
})

describe('tracking.lead_event_seen', () => {
  const KEY = 'tracking.lead_event_seen'

  it('近 7 天收到留资事件 → 绿', () => {
    expect(gate(judge(), KEY).status).toBe('green')
  })

  it('刚好 1 条也算绿；0 条是红', () => {
    expect(gate(judge(i => { i.meta.datasets[0].events_7d = { Lead: 1 } }), KEY).status).toBe('green')
    const zero = gate(judge(i => { i.meta.datasets[0].events_7d = { PageView: 900 } }), KEY)
    expect(zero.status).toBe('red')
    expect(zero.hard).toBe(true)
  })

  it('事件统计没读到、也没有别处能证明 → 灰', () => {
    const g = gate(judge(i => { i.meta.datasets[0].events_7d = null }), KEY)
    expect(g.status).toBe('gray')
  })

  it('按客户配置的留资事件名数；默认的 Lead 不再算', () => {
    const custom = judge(i => {
      i.config.lead_event_names = ['lead_form']
      i.meta.datasets[0].events_7d = { lead_form: 3, Lead: 0 }
    })
    expect(gate(custom, 'tracking.lead_event_seen').status).toBe('green')
    const ignored = judge(i => {
      i.config.lead_event_names = ['lead_form']
      i.meta.datasets[0].events_7d = { Lead: 50 }
    })
    expect(gate(ignored, 'tracking.lead_event_seen').status).toBe('red')
  })
})

describe('tracking.lead_event_quality', () => {
  const KEY = 'tracking.lead_event_quality'

  it('匹配质量 ≥ 7 → 绿，且是软门', () => {
    const g = gate(judge(), KEY)
    expect(g.status).toBe('green')
    expect(g.hard).toBe(false)
  })

  it('刚好 7 分 → 绿；6.9 分 → 黄', () => {
    expect(gate(judge(i => { i.meta.datasets[0].match_quality = { Lead: 7 } }), KEY).status).toBe('green')
    expect(gate(judge(i => { i.meta.datasets[0].match_quality = { Lead: 6.9 } }), KEY).status).toBe('yellow')
  })

  it('没有留资事件的质量分 → 灰', () => {
    expect(gate(judge(i => { i.meta.datasets[0].match_quality = null }), KEY).status).toBe('gray')
    expect(gate(judge(i => { i.meta.datasets[0].match_quality = { PageView: 6.1 } }), KEY).status).toBe('gray')
  })

  it('几个数据集都在发时取最低分', () => {
    const g = gate(judge(i => {
      i.landing.probes[0].pixel_ids = [OFFICIAL, OTHER_OFFICIAL]
      i.meta.datasets[1].match_quality = { Lead: 5 }
    }), KEY)
    expect(g.status).toBe('yellow')
  })
})

describe('tracking.ga4_events', () => {
  const KEY = 'tracking.ga4_events'

  it('配置里的留资事件近 7 天都收到 → 绿，软门', () => {
    const g = gate(judge(), KEY)
    expect(g.status).toBe('green')
    expect(g.hard).toBe(false)
  })

  it('有一个事件是 0 → 黄，原因里点出是哪个', () => {
    const g = gate(judge(i => { i.ga4.events_7d = { generate_lead: 8 } }), KEY)
    expect(g.status).toBe('yellow')
    expect(g.reason).toContain('enquiry_thank_you')
  })

  it('全是 0 → 红', () => {
    expect(gate(judge(i => { i.ga4.events_7d = {} }), KEY).status).toBe('red')
  })

  it('GA4 没读到 → 灰，原因带上读取失败的说明', () => {
    const g = gate(judge(i => { i.ga4.read = false; i.ga4.error = '这个客户还没有可用的 Google 授权' }), KEY)
    expect(g.status).toBe('gray')
    expect(g.reason).toContain('Google 授权')
  })

  it('没读到时证据里不能出现「0 次」（没读到 ≠ 0）；读到了才有每个事件的次数', () => {
    const unread = gate(judge(i => { i.ga4.read = false; i.ga4.error = 'x'; i.ga4.events_7d = {} }), KEY)
    expect(Object.keys(unread.evidence).filter(k => k.startsWith('ga4_'))).toEqual([])
    const read = gate(judge(), KEY)
    expect(read.evidence).toMatchObject({ ga4_generate_lead: 8, ga4_enquiry_thank_you: 5 })
  })
})

describe('tracking.landing_ok', () => {
  const KEY = 'tracking.landing_ok'

  it('200、跳转后 UTM 还在、页面里有像素标记 → 绿', () => {
    expect(gate(judge(), KEY).status).toBe('green')
  })

  it('404 / 500 / 204 都是红（只有 200 算通过）', () => {
    for (const status of [404, 500, 204]) {
      const g = gate(judge(i => { i.landing.probes[0].http_status = status }), KEY)
      expect(g.status, String(status)).toBe('red')
      expect(g.hard).toBe(true)
    }
  })

  it('跳转后 UTM 丢了 → 红', () => {
    expect(gate(judge(i => { i.landing.probes[0].utm_preserved = false }), KEY).status).toBe('red')
  })

  it('请求地址本来就没有 UTM（utm_preserved 为空）→ 不因此扣分', () => {
    expect(gate(judge(i => { i.landing.probes[0].utm_preserved = null }), KEY).status).toBe('green')
  })

  it('页面里一个像素标记都没找到 → 红', () => {
    expect(gate(judge(i => { i.landing.probes[0].pixel_ids = [] }), KEY).status).toBe('red')
  })

  it('没连上（超时）→ 灰，不是红也不是绿', () => {
    const g = gate(judge(i => { Object.assign(i.landing.probes[0], { http_status: null, final_url: null, pixel_ids: [], error: 'timeout' }) }), KEY)
    expect(g.status).toBe('gray')
  })

  it('一个通过、一个 404 → 红，原因点出是哪个落地页', () => {
    const g = gate(judge(i => {
      i.landing.probes.push({ ...i.landing.probes[0], label: '落地页 B', http_status: 404 })
    }), KEY)
    expect(g.status).toBe('red')
    expect(g.reason).toContain('落地页 B')
  })

  it('一个红、一个没连上 → 红（有确定的坏比没证据更要紧）', () => {
    const g = gate(judge(i => {
      i.landing.probes.push({ ...i.landing.probes[0], label: '落地页 B', http_status: null, pixel_ids: [], error: 'dns' })
      i.landing.probes[0].http_status = 404
    }), KEY)
    expect(g.status).toBe('red')
  })

  it('客户配置里没有任何落地页 → 灰，并告诉人去补配置', () => {
    const g = gate(judge(i => { i.config.landing_targets = []; i.landing.probes = [] }), KEY)
    expect(g.status).toBe('gray')
    expect(g.how).toContain('配置')
  })
})

describe('tracking.lead_reaches_crm', () => {
  const KEY = 'tracking.lead_reaches_crm'

  it('近 7 天 CRM 里有官网表单线索 → 绿；刚好 1 条也是绿', () => {
    expect(gate(judge(), KEY).status).toBe('green')
    expect(gate(judge(i => { i.crm.web_form_touchpoints_7d = 1 }), KEY).status).toBe('green')
  })

  it('网站有留资信号但 CRM 一条都没有 → 红，写明两边的数', () => {
    const g = gate(judge(i => { i.crm.web_form_touchpoints_7d = 0; i.crm.latest_web_form_at = null }), KEY)
    expect(g.status).toBe('red')
    expect(g.hard).toBe(true)
    expect(g.evidence.crm_web_form_touchpoints_7d).toBe(0)
    expect(Number(g.evidence.lead_signal_7d)).toBeGreaterThan(0)
  })

  it('CRM 没有、网站也没有留资信号 → 灰（没法验证，请做一次试跑提交）', () => {
    const g = gate(judge(i => {
      i.crm.web_form_touchpoints_7d = 0
      i.meta.datasets[0].events_7d = { PageView: 100 }
      i.ga4.events_7d = {}
    }), KEY)
    expect(g.status).toBe('gray')
    expect(g.how).toContain('试')
  })

  it('CRM 没读到 → 灰', () => {
    expect(gate(judge(i => { i.crm.read = false; i.crm.error = 'boom' }), KEY).status).toBe('gray')
  })

  it('该客户没有官网表单 → 不适用：标 na、非硬门，不计入总灯和前置条件', () => {
    const gates = judge(i => { i.config.web_form_to_crm = false; i.crm.web_form_touchpoints_7d = 0 })
    const g = gate(gates, KEY)
    expect(g.na).toBe(true)
    expect(g.hard).toBe(false)
    expect(overallLight(gates)).toBe('green')
    expect(preconditionsMet(gates)).toBe(true)
  })
})

describe('tracking.capi_ready', () => {
  const KEY = 'tracking.capi_ready'

  it('探活通过且近 7 天没有失败 → 绿，软门', () => {
    const g = gate(judge(), KEY)
    expect(g.status).toBe('green')
    expect(g.hard).toBe(false)
  })

  it('探活没通过 → 红（但只是软门）', () => {
    const g = gate(judge(i => { i.env.capi_preflight = { ok: false, stage: 'config', token_valid: null, pixel_visible: null } }), KEY)
    expect(g.status).toBe('red')
    expect(g.hard).toBe(false)
  })

  it('近 7 天有失败的回传 → 黄；有「不确定」的 → 黄', () => {
    expect(gate(judge(i => { i.env.capi_events_7d = { confirmed: 4, in_doubt: 0, failed: 1 } }), KEY).status).toBe('yellow')
    expect(gate(judge(i => { i.env.capi_events_7d = { confirmed: 4, in_doubt: 1, failed: 0 } }), KEY).status).toBe('yellow')
  })

  it('探活通过但没读到回传统计 → 黄', () => {
    expect(gate(judge(i => { i.env.capi_events_7d = null }), KEY).status).toBe('yellow')
  })

  it('探活没跑成 → 灰', () => {
    expect(gate(judge(i => { i.env.capi_preflight = null }), KEY).status).toBe('gray')
  })
})

describe('env.token_and_crons', () => {
  const KEY = 'env.token_and_crons'

  it('令牌可用、定时任务都在期 → 绿', () => {
    expect(gate(judge(), KEY).status).toBe('green')
  })

  it('没有可用的 Meta 令牌 → 红；令牌已失效 → 红', () => {
    expect(gate(judge(i => { i.env.meta_token_resolved = false }), KEY).status).toBe('red')
    const dead = gate(judge(i => { i.env.capi_preflight = { ok: false, stage: null, token_valid: false, pixel_visible: null } }), KEY)
    expect(dead.status).toBe('red')
    expect(dead.hard).toBe(true)
  })

  it('定时任务刚好 3 小时 → 在期；多一分钟 → 红', () => {
    expect(gate(judge(i => { i.env.jobs[0].last_finished_at = hoursAgo(3) }), KEY).status).toBe('green')
    const g = gate(judge(i => { i.env.jobs[0].last_finished_at = hoursAgo(3 + 1 / 60) }), KEY)
    expect(g.status).toBe('red')
    expect(g.reason).toContain('meta-leads-sync')
  })

  it('定时任务从没跑过 / 最近一次是失败 → 红', () => {
    expect(gate(judge(i => { i.env.jobs[1].last_finished_at = null; i.env.jobs[1].last_status = null }), KEY).status).toBe('red')
    expect(gate(judge(i => { i.env.jobs[1].last_status = 'failed' }), KEY).status).toBe('red')
  })

  it('令牌有、但没做过有效性验证 → 黄', () => {
    expect(gate(judge(i => { i.env.capi_preflight = null }), KEY).status).toBe('yellow')
  })
})

describe('env.account_billing', () => {
  const KEY = 'env.account_billing'

  it('账户正常、有付款方式、日上限不低于计划日预算 → 绿', () => {
    expect(gate(judge(), KEY).status).toBe('green')
  })

  it('账户不是正常状态 / 被停用 / 没有付款方式 → 红', () => {
    for (const patch of [{ status: 2 }, { disable_reason: 1 }, { has_funding_source: false }]) {
      const g = gate(judge(i => { Object.assign(i.meta.account!, patch) }), KEY)
      expect(g.status, JSON.stringify(patch)).toBe('red')
      expect(g.hard).toBe(true)
    }
  })

  it('计划日预算比官方日上限高 → 红；刚好相等 → 绿', () => {
    expect(gate(judge(i => { i.config.planned_daily_budget_cents = 11001 }), KEY).status).toBe('red')
    expect(gate(judge(i => { i.config.planned_daily_budget_cents = 11000 }), KEY).status).toBe('green')
  })

  it('账户自己设了花费上限，剩余额度不够一天的计划预算 → 红', () => {
    const g = gate(judge(i => { Object.assign(i.meta.account!, { spend_cap_minor: 50000, amount_spent_minor: 45000 }) }), KEY)
    expect(g.status).toBe('red')
  })

  it('没配计划日预算或官方日上限 → 黄（没法核对）', () => {
    expect(gate(judge(i => { i.config.planned_daily_budget_cents = null }), KEY).status).toBe('yellow')
    expect(gate(judge(i => { i.config.official_daily_cap_cents = null }), KEY).status).toBe('yellow')
  })

  it('账户信息没读到 → 灰；有没有付款方式没读到 → 灰', () => {
    expect(gate(judge(i => { i.meta.account = null }), KEY).status).toBe('gray')
    expect(gate(judge(i => { i.meta.account!.has_funding_source = null }), KEY).status).toBe('gray')
  })
})

describe('overallLight / preconditionsMet', () => {
  const mk = (key: PreflightGateKey, status: TrackingGateReceipt['status'], extra: Partial<TrackingGateReceipt> = {}): TrackingGateReceipt => ({
    key, status, reason: 'r', how: 'h', evidence: {}, as_of: null, hard: HARD_GATE[key], ...extra,
  })

  it('总灯取最差：红 > 灰 > 黄 > 绿', () => {
    expect(overallLight([mk('tracking.pixel_alive', 'green'), mk('tracking.ga4_events', 'yellow')])).toBe('yellow')
    expect(overallLight([mk('tracking.pixel_alive', 'yellow'), mk('tracking.ga4_events', 'gray')])).toBe('gray')
    expect(overallLight([mk('tracking.pixel_alive', 'gray'), mk('tracking.ga4_events', 'red')])).toBe('red')
  })

  it('没有适用的门 → 灰（没证据不能当绿）', () => {
    expect(overallLight([])).toBe('gray')
    expect(overallLight([mk('tracking.lead_reaches_crm', 'gray', { na: true, hard: false })])).toBe('gray')
  })

  it('硬门红或灰 → 前置条件没满足；软门红、硬门黄不挡', () => {
    expect(preconditionsMet([mk('tracking.pixel_alive', 'red')])).toBe(false)
    expect(preconditionsMet([mk('tracking.pixel_alive', 'gray')])).toBe(false)
    expect(preconditionsMet([mk('tracking.ga4_events', 'red')])).toBe(true)
    expect(preconditionsMet([mk('tracking.pixel_alive', 'yellow')])).toBe(true)
  })

  it('「不适用」的硬门灰不挡', () => {
    expect(preconditionsMet([mk('tracking.lead_reaches_crm', 'gray', { na: true, hard: false })])).toBe(true)
  })
})

describe('applyKnownIssues', () => {
  const green: TrackingGateReceipt = {
    key: 'tracking.lead_event_quality', status: 'green', reason: '匹配质量 9.3', how: '', evidence: {}, as_of: null, hard: false,
  }
  const issue = {
    gate: 'tracking.lead_event_quality' as const, note: '留资事件带固定占位金额', observed_on: '2026-10-19', expires_on: '2026-11-19',
  }

  it('绿灯遇到还没到期的已知问题 → 压成黄，说明写进原因', () => {
    const [g] = applyKnownIssues([green], [issue], NOW)
    expect(g.status).toBe('yellow')
    expect(g.reason).toContain('留资事件带固定占位金额')
    expect(g.reason).toContain('2026-10-19')
  })

  it('到期当天及之后不再生效', () => {
    const [g] = applyKnownIssues([green], [{ ...issue, expires_on: '2026-10-19' }], NOW)
    expect(g.status).toBe('green')
  })

  it('不是这道门的已知问题 → 不动', () => {
    const [g] = applyKnownIssues([green], [{ ...issue, gate: 'tracking.pixel_alive' }], NOW)
    expect(g.status).toBe('green')
  })

  it('本来就是红的门 → 保持红，只追加说明', () => {
    const [g] = applyKnownIssues([{ ...green, status: 'red', reason: '分数很低' }], [issue], NOW)
    expect(g.status).toBe('red')
    expect(g.reason).toContain('分数很低')
    expect(g.reason).toContain('留资事件带固定占位金额')
  })

  it('绿灯压成黄灯时，「怎么办」用已知问题自己写的；没写就用兜底说法（三件套不缺项）', () => {
    const [withHow] = applyKnownIssues([green], [{ ...issue, how: '等官网事件修复上线后删掉这条' }], NOW)
    expect(withHow.how).toBe('等官网事件修复上线后删掉这条')
    const [fallback] = applyKnownIssues([green], [issue], NOW)
    expect(fallback.how.length).toBeGreaterThan(0)
    expect(fallback.how).not.toBe(issue.note)
  })

  it('原本就有「怎么办」的门，不被已知问题覆盖', () => {
    const [g] = applyKnownIssues([{ ...green, status: 'red', how: '原来的办法' }], [{ ...issue, how: '别的办法' }], NOW)
    expect(g.how).toBe('原来的办法')
  })

  it('judgePreflightGates 自己会套用客户配置里的已知问题', () => {
    const gates = judge(i => { i.config.known_issues = [issue] })
    expect(gate(gates, 'tracking.lead_event_quality').status).toBe('yellow')
  })
})

describe('judgePostLaunch', () => {
  const facts = (patch: Partial<PostLaunchFacts> = {}): PostLaunchFacts => ({
    read: true, error: null, as_of: NOW.toISOString(),
    spend_cents: 2500, link_clicks: 40, landing_page_views: 32, leads: 1, ...patch,
  })

  it('点击和落地页浏览都正常 → 绿，不是硬门', () => {
    const g = judgePostLaunch('post_t1h', facts())
    expect(g.key).toBe('post.t1h')
    expect(g.status).toBe('green')
    expect(g.hard).toBe(false)
    expect(judgePostLaunch('post_t24h', facts()).key).toBe('post.t24h')
  })

  it('回执带上读到的数字和取数时间（证据在 evidence，时间在 as_of）', () => {
    const g = judgePostLaunch('post_t24h', facts({ link_clicks: 20, landing_page_views: 9 }))
    expect(g.evidence).toEqual({ spend_cents: 2500, link_clicks: 20, landing_page_views: 9, leads: 1 })
    expect(g.as_of).toBe(NOW.toISOString())
  })

  it('没读到 → 灰；还没花钱 → 灰', () => {
    expect(judgePostLaunch('post_t1h', facts({ read: false, error: 'boom' })).status).toBe('gray')
    expect(judgePostLaunch('post_t1h', facts({ spend_cents: 0 })).status).toBe('gray')
  })

  it('花了钱一次点击都没有：1 小时读回是黄，24 小时读回是红', () => {
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 0, landing_page_views: 0 })).status).toBe('yellow')
    expect(judgePostLaunch('post_t24h', facts({ link_clicks: 0, landing_page_views: 0 })).status).toBe('red')
  })

  it('点击 ≥ 10 但落地页浏览为 0 → 红；9 个点击还不够下结论', () => {
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 10, landing_page_views: 0 })).status).toBe('red')
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 9, landing_page_views: 0 })).status).toBe('green')
  })

  it('点击 ≥ 10 且浏览/点击 < 0.5 → 黄；刚好 0.5 → 绿', () => {
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 20, landing_page_views: 9 })).status).toBe('yellow')
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 20, landing_page_views: 10 })).status).toBe('green')
  })

  it('24 小时读回：点击 ≥ 50 却一条留资都没有 → 黄；49 个点击不判；1 小时读回不看留资', () => {
    expect(judgePostLaunch('post_t24h', facts({ link_clicks: 50, landing_page_views: 45, leads: 0 })).status).toBe('yellow')
    expect(judgePostLaunch('post_t24h', facts({ link_clicks: 49, landing_page_views: 45, leads: 0 })).status).toBe('green')
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 50, landing_page_views: 45, leads: 0 })).status).toBe('green')
  })
})
