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
  type CrmFacts,
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
      planned_daily_budget_cents: null,
      official_daily_cap_cents: null,
      currency: 'NZD',
    },
    // 预算事实：库里的日上限（账户级 + 客户级）+ Meta 现读的在投日预算合计（虚构数字，凑一个“在上限内”的基线）
    budget: {
      read: true, error: null, as_of: NOW.toISOString(),
      account_cap_cents: 15000, client_cap_cents: 15000, registered_account_count: 1,
      live_daily_budget_cents: 13400, live_lifetime_budget_count: 0, live_entity_count: 3,
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

  it('页面里一个像素标记都没找到 → 红，原因是「没找到像素标记」（不是「不是官方像素」）', () => {
    const g = gate(judge(i => { i.landing.probes[0].pixel_ids = [] }), KEY)
    expect(g.status).toBe('red')
    expect(g.reason).toContain('没找到')
    expect(g.reason).not.toContain('都不是官方')
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

  // 🔴 审查整改（子牙 + 魏征）：每一个落地页都必须挂着官方数据集的像素，
  //    不能把所有页面的像素凑成一个并集，让「别的页面有官方像素」替这一页顶罪。
  const pageB = (pixelIds: string[]): JudgeInput['landing']['probes'][number] => ({
    label: '落地页 B', url: 'https://www.example-shop.test/q?utm_content=b', http_status: 200,
    final_url: 'https://www.example-shop.test/q?utm_content=b', redirects: 0,
    utm_preserved: true, pixel_ids: pixelIds, error: null,
  })

  it('页 A 挂着官方像素、页 B 只有旧像素（不在官方账户里）→ 红，点出是页 B，证据里列出页 B', () => {
    const g = gate(judge(i => { i.landing.probes.push(pageB([SITE_ONLY])) }), KEY)
    expect(g.status).toBe('red')
    expect(g.hard).toBe(true)
    expect(g.reason).toContain('落地页 B')
    expect(g.reason).not.toContain('落地页 A')
    expect(g.evidence.pages_without_official_pixel).toEqual(['落地页 B'])
  })

  it('每一页都挂着官方像素（各挂各的官方数据集也行）→ 绿，证据里没有缺官方像素的页', () => {
    const g = gate(judge(i => { i.landing.probes.push(pageB([OTHER_OFFICIAL])) }), KEY)
    expect(g.status).toBe('green')
    expect(g.evidence.pages_without_official_pixel).toEqual([])
  })

  it('单页：页面上只有旧像素、没有任何官方像素 → 红', () => {
    const g = gate(judge(i => { i.landing.probes[0].pixel_ids = [SITE_ONLY] }), KEY)
    expect(g.status).toBe('red')
    expect(g.reason).toContain('官方')
  })

  it('官方账户的数据集没读到、没法核对「是不是官方像素」→ 黄（不是绿）：原因里说清楚没核对', () => {
    const g = gate(judge(i => {
      i.meta.read = false
      i.meta.account_dataset_ids = []
      i.landing.probes[0].pixel_ids = [SITE_ONLY]
    }), KEY)
    expect(g.status).toBe('yellow')
    expect(g.reason).toContain('没核对')
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

  // 🔴 审查整改：绿灯判据缩到「48 小时内进过一条」（设计稿是「试跑线索 1 小时内进 CRM」，被动看 48 小时是近似）
  it('最近一条官网表单线索在 48 小时内 → 绿；刚好 48 小时也算', () => {
    expect(gate(judge(i => { i.crm.latest_web_form_at = hoursAgo(47) }), KEY).status).toBe('green')
    expect(gate(judge(i => { i.crm.latest_web_form_at = hoursAgo(48) }), KEY).status).toBe('green')
  })

  it('近 7 天有线索，但最近一条已超过 48 小时 → 黄（不是绿）：写明几小时前，怎么办里让人做一次试跑提交', () => {
    const g = gate(judge(i => { i.crm.web_form_touchpoints_7d = 6; i.crm.latest_web_form_at = hoursAgo(48 + 1 / 60) }), KEY)
    expect(g.status).toBe('yellow')
    expect(g.hard).toBe(true)
    expect(g.reason).toContain('48')
    expect(g.how).toContain('试')
    expect(g.evidence.crm_web_form_touchpoints_7d).toBe(6)
  })

  it('近 7 天有线索，却读不出最近一条的时间 → 黄（没法确认新鲜度，不能当绿）', () => {
    expect(gate(judge(i => { i.crm.latest_web_form_at = null }), KEY).status).toBe('yellow')
    expect(gate(judge(i => { i.crm.latest_web_form_at = 'garbage' }), KEY).status).toBe('yellow')
  })

  // 🔴 第二轮审查整改：线索时间不能是「未来」。时钟偏差 / 脏数据不能让绿灯自己造出来
  it('最近一条线索的时间晚于现在（时钟偏差 / 脏数据）→ 黄，不是绿；晚 5 分钟以内的时钟误差仍算正常', () => {
    const at = (offsetMin: number) => new Date(NOW.getTime() + offsetMin * 60_000).toISOString()
    const future = gate(judge(i => { i.crm.latest_web_form_at = at(6) }), KEY)
    expect(future.status).toBe('yellow')
    expect(future.reason).toContain('未来')
    expect(gate(judge(i => { i.crm.latest_web_form_at = at(5) }), KEY).status).toBe('green')
    expect(gate(judge(i => { i.crm.latest_web_form_at = at(4) }), KEY).status).toBe('green')
    expect(gate(judge(i => { i.crm.latest_web_form_at = at(60 * 24 * 365) }), KEY).status).toBe('yellow')
  })

  it('48 小时内有线索时，哪怕网站留资信号很多也是绿（红只留给「一条都没有」）', () => {
    const g = gate(judge(i => { i.crm.web_form_touchpoints_7d = 1; i.crm.latest_web_form_at = hoursAgo(1) }), KEY)
    expect(g.status).toBe('green')
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

describe('tracking.lead_reaches_crm · 只认广告落地页上提交的表单（只验证了联系页表单 = 灰，挡开投）', () => {
  const KEY = 'tracking.lead_reaches_crm'
  /** 按广告落地页分过类的 CRM 事实：近 7 天官网表单共 6 条（基线），其中从广告落地页提交的由 over 决定 */
  const classified = (over: Partial<CrmFacts> = {}) => (i: JudgeInput): void => {
    i.crm = { ...i.crm, ad_landing_paths: ['/p'], ad_landing_form_touchpoints_7d: 2, latest_ad_landing_form_at: hoursAgo(3), ...over }
  }
  const noAdLanding = { ad_landing_form_touchpoints_7d: 0, latest_ad_landing_form_at: null }

  it('近 48 小时有从广告落地页提交的线索 → 绿；证据里把「全部官网表单」和「广告落地页上的」分开写，并写出认的页面路径', () => {
    const g = gate(judge(classified()), KEY)
    expect(g.status).toBe('green')
    expect(g.reason).toContain('广告落地页')
    expect(g.evidence).toMatchObject({
      crm_web_form_touchpoints_7d: 6,
      ad_landing_form_touchpoints_7d: 2,
      latest_ad_landing_form_at: hoursAgo(3),
      ad_landing_paths: ['/p'],
    })
  })

  it('官网表单线索一直在进（联系页，5 小时前），但近 7 天没有一条来自广告落地页 → 灰「只验证了联系页等其它表单」（没有广告路径的证据），怎么办是可照做的测试步骤', () => {
    const g = gate(judge(classified(noAdLanding)), KEY)
    expect(g.status).toBe('gray')
    expect(g.hard).toBe(true)
    expect(g.reason).toContain('只验证了')
    expect(g.reason).toContain('联系页')
    expect(g.how).toContain('非本公司邮箱')
    expect(g.how).toContain('广告落地页')
    expect(g.how).toContain('内部测试')
    expect(g.evidence).toMatchObject({ ad_landing_form_touchpoints_7d: 0, crm_web_form_touchpoints_7d: 6, ad_landing_paths: ['/p'] })
  })

  it('这种灰灯是硬门灰：挡「前置条件」（广告落地页上的表单没有证据，不能显示「满足」），总灯是灰、不是绿也不是黄', () => {
    const gates = judge(classified(noAdLanding))
    expect(overallLight(gates)).toBe('gray')
    expect(preconditionsMet(gates)).toBe(false)
  })

  it('广告落地页上有证据（绿）时不挡；广告落地页的线索只是过期（黄）时也不挡——挡的只有「一点证据都没有」', () => {
    expect(preconditionsMet(judge(classified()))).toBe(true)
    expect(preconditionsMet(judge(classified({ latest_ad_landing_form_at: hoursAgo(60) })))).toBe(true)
  })

  it('其它表单线索再新也换不来绿：联系页刚进了一条（1 小时前），广告落地页那边 0 条 → 仍是灰', () => {
    const g = gate(judge(i => { i.crm.latest_web_form_at = hoursAgo(1); classified(noAdLanding)(i) }), KEY)
    expect(g.status).toBe('gray')
  })

  it('广告落地页的线索有，但最近一条超过 48 小时 → 黄（以前通过，不能说现在通），写明几小时前；刚好 48 小时仍是绿', () => {
    const stale = gate(judge(classified({ latest_ad_landing_form_at: hoursAgo(48 + 1 / 60) })), KEY)
    expect(stale.status).toBe('yellow')
    expect(stale.reason).toContain('广告落地页')
    expect(stale.reason).toContain('48')
    expect(stale.how).toContain('广告落地页')
    expect(gate(judge(classified({ latest_ad_landing_form_at: hoursAgo(48) })), KEY).status).toBe('green')
  })

  // 第五轮（74 号）：开投后，落地页上的内部测试线索 48 小时后过期变黄——这时多半只是还没有新的真实线索，不能写成故障
  it('广告落地页的线索超过 48 小时 → 黄，说成「多半在等真实线索」而不是故障；怎么办先教怎么分辨，再给测试步骤；GA4 事件名取自客户配置', () => {
    const g = gate(judge(classified({ latest_ad_landing_form_at: hoursAgo(60) })), KEY)
    expect(g.status).toBe('yellow')
    expect(g.reason).toContain('等真实线索')
    expect(g.reason).toContain('60 小时前')
    expect(g.reason).not.toContain('没法确认')
    expect(g.how).toContain('不一定是故障')
    expect(g.how).toContain('generate_lead')
    expect(g.how).toContain('enquiry_thank_you')
    expect(g.how).toContain('非本公司邮箱')
    expect(preconditionsMet(judge(classified({ latest_ad_landing_form_at: hoursAgo(60) })))).toBe(true)
    // 事件名不写死：换一套配置，文案跟着变
    const other = gate(judge(i => { classified({ latest_ad_landing_form_at: hoursAgo(60) })(i); i.config.ga4_lead_events = ['purchase_x'] }), KEY)
    expect(other.how).toContain('purchase_x')
    expect(other.how).not.toContain('enquiry_thank_you')
  })

  it('读不出时间 / 时间在未来是数据问题，仍按原来的说法（没法确认），不说成「等真实线索」', () => {
    for (const latest of [null, 'garbage', new Date(NOW.getTime() + 6 * 60_000).toISOString()]) {
      const g = gate(judge(classified({ latest_ad_landing_form_at: latest })), KEY)
      expect(g.status).toBe('yellow')
      expect(g.reason).toContain('没法确认')
      expect(g.reason).not.toContain('等真实线索')
    }
  })

  it('没按落地页分类的老路径（配置里没落地页）过期仍是原来的说法，不受影响', () => {
    const g = gate(judge(i => { i.crm.latest_web_form_at = hoursAgo(60) }), KEY)
    expect(g.status).toBe('yellow')
    expect(g.reason).toContain('没法确认')
    expect(g.reason).not.toContain('等真实线索')
  })

  it('广告落地页的线索读不出时间 / 时间在未来 → 黄，不是绿；晚 5 分钟以内的时钟误差仍算正常', () => {
    expect(gate(judge(classified({ latest_ad_landing_form_at: null })), KEY).status).toBe('yellow')
    expect(gate(judge(classified({ latest_ad_landing_form_at: 'garbage' })), KEY).status).toBe('yellow')
    const at = (offsetMin: number) => new Date(NOW.getTime() + offsetMin * 60_000).toISOString()
    const future = gate(judge(classified({ latest_ad_landing_form_at: at(6) })), KEY)
    expect(future.status).toBe('yellow')
    expect(future.reason).toContain('未来')
    expect(gate(judge(classified({ latest_ad_landing_form_at: at(5) })), KEY).status).toBe('green')
  })

  it('回执里没有 ad_landing_paths（没配落地页 / 老回执）或是空数组 → 不分类，和以前完全一样：任何官网表单线索 48 小时内就绿', () => {
    const plain = gate(judge(), KEY)
    expect(plain.status).toBe('green')
    expect(plain.evidence).not.toHaveProperty('ad_landing_paths')
    expect(gate(judge(i => { i.crm.ad_landing_paths = [] }), KEY).status).toBe('green')
    // 路径是空的、计数却有（0 条）也不分类：不能因为「广告落地页 0 条」把没配落地页的客户判黄
    expect(gate(judge(i => { i.crm.ad_landing_paths = []; i.crm.ad_landing_form_touchpoints_7d = 0; i.crm.latest_ad_landing_form_at = null }), KEY).status).toBe('green')
    // 有路径却没有计数（读取器没给）也当不分类，不拿「没有」去判黄
    expect(gate(judge(i => { i.crm.ad_landing_paths = ['/p'] }), KEY).status).toBe('green')
  })

  it('CRM 里一条官网表单线索都没有：红 / 灰不受影响；红灯的怎么办写成可照做的测试步骤（分类与否都一样）', () => {
    const zero = (i: JudgeInput): void => { i.crm.web_form_touchpoints_7d = 0; i.crm.latest_web_form_at = null }
    for (const mutate of [zero, (i: JudgeInput) => { classified(noAdLanding)(i); zero(i) }]) {
      const red = gate(judge(mutate), KEY)
      expect(red.status).toBe('red')
      expect(red.how).toContain('formEnquiries')
      expect(red.how).toContain('非本公司邮箱')
      expect(red.how).toContain('广告落地页')
      expect(red.how).toContain('内部测试')
    }
    expect(gate(judge(i => { classified()(i); i.crm.read = false; i.crm.error = 'boom' }), KEY).status).toBe('gray')
  })

  it('该客户没有官网表单 → 仍然不适用，哪怕回执里带着落地页分类', () => {
    const g = gate(judge(i => { classified()(i); i.config.web_form_to_crm = false }), KEY)
    expect(g.na).toBe(true)
    expect(g.hard).toBe(false)
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

  // 🔴 审查整改：探活走到一半就停了（配置不全等），令牌有效性是 null（未知）——不能因为「没发现坏」就判绿
  it('探活没走到验证令牌那一步（token_valid 是 null）→ 黄，不是绿；怎么办里说清楚', () => {
    const stopped = gate(judge(i => { i.env.capi_preflight = { ok: false, stage: 'config', token_valid: null, pixel_visible: null } }), KEY)
    expect(stopped.status).toBe('yellow')
    expect(stopped.hard).toBe(true)
    expect(stopped.reason).toContain('验证')
    expect(stopped.how.length).toBeGreaterThan(0)
  })

  it('探活通过但没给出令牌有效性（token_valid 是 null）→ 同样是黄', () => {
    expect(gate(judge(i => { i.env.capi_preflight = { ok: true, stage: null, token_valid: null, pixel_visible: true } }), KEY).status).toBe('yellow')
  })

  it('令牌有效性明确为 true 才是绿', () => {
    expect(gate(judge(i => { i.env.capi_preflight = { ok: true, stage: null, token_valid: true, pixel_visible: true } }), KEY).status).toBe('green')
  })

  it('已经确定令牌失效 / 没有令牌 / 定时任务有问题时仍是红，不被「未知 → 黄」盖住', () => {
    expect(gate(judge(i => { i.env.capi_preflight = { ok: false, stage: 'token', token_valid: false, pixel_visible: null } }), KEY).status).toBe('red')
    expect(gate(judge(i => { i.env.capi_preflight = null; i.env.meta_token_resolved = false }), KEY).status).toBe('red')
    expect(gate(judge(i => { i.env.capi_preflight = { ok: false, stage: 'config', token_valid: null, pixel_visible: null }; i.env.jobs[0].last_status = 'failed' }), KEY).status).toBe('red')
  })
})

describe('env.account_billing', () => {
  const KEY = 'env.account_billing'
  const budget = (patch: Partial<JudgeInput['budget']>) => (i: JudgeInput): void => { Object.assign(i.budget, patch) }
  const unreadBudget = (error: string) => budget({
    read: false, error, account_cap_cents: null, client_cap_cents: null, registered_account_count: null, live_daily_budget_cents: null,
  })

  it('绿：账户正常、有付款方式、库里有日上限、现在在投的合计没超——文案只说「本账户现在在投的部分」，写明不含本次要新开的计划预算', () => {
    const g = gate(judge(), KEY)
    expect(g.status).toBe('green')
    expect(g.reason).toContain('134.00')
    expect(g.reason).toContain('150.00')
    expect(g.reason).toContain('本账户')
    expect(g.reason).toContain('不含本次要新开的计划预算')
    expect(g.evidence).toMatchObject({
      account_cap_cents: 15000, client_cap_cents: 15000, registered_account_count: 1, live_daily_budget_cents: 13400,
      live_lifetime_budget_count: 0, budget_read: true,
    })
  })

  it('红：账户不是正常状态 / 被停用 / 没有付款方式', () => {
    for (const patch of [{ status: 2 }, { disable_reason: 1 }, { has_funding_source: false }]) {
      const g = gate(judge(i => { Object.assign(i.meta.account!, patch) }), KEY)
      expect(g.status, JSON.stringify(patch)).toBe('red')
      expect(g.hard).toBe(true)
    }
  })

  it('🔴 红：在投日预算合计超过库里的账户级日上限；刚好等于 → 绿', () => {
    const over = gate(judge(budget({ live_daily_budget_cents: 15001 })), KEY)
    expect(over.status).toBe('red')
    expect(over.reason).toContain('150.01')
    expect(gate(judge(budget({ live_daily_budget_cents: 15000 })), KEY).status).toBe('green')
  })

  it('🔴 红：超过客户级日上限（单账户、账户级没设时客户级顶上）；多账户时一个账户就超过客户总上限，同样必然是超了', () => {
    expect(gate(judge(budget({ account_cap_cents: null, client_cap_cents: 12000 })), KEY).status).toBe('red')
    expect(gate(judge(budget({ account_cap_cents: null, client_cap_cents: 13400 })), KEY).status).toBe('green')
    expect(gate(judge(budget({ account_cap_cents: 20000, client_cap_cents: 13000 })), KEY).status).toBe('red')
    expect(gate(judge(budget({ account_cap_cents: null, registered_account_count: 2, client_cap_cents: 12000 })), KEY).status).toBe('red')
  })

  it('账户级、客户级是同一个数（老客户回落时必然如此）：绿 / 红的文案只说一遍，不重复；两个数不同才分开说；多账户时只声明账户级', () => {
    const count = (text: string, needle: string): number => text.split(needle).length - 1

    const green = gate(judge(budget({ account_cap_cents: 15000, client_cap_cents: 15000 })), KEY)
    expect(green.status).toBe('green')
    expect(green.reason).toContain('账户级与客户级日上限')
    expect(count(green.reason, '150.00')).toBe(1)

    const red = gate(judge(budget({ account_cap_cents: 15000, client_cap_cents: 15000, live_daily_budget_cents: 16000 })), KEY)
    expect(red.status).toBe('red')
    expect(count(red.reason, '超过库里的')).toBe(1)
    expect(red.reason).toContain('账户级与客户级日上限')

    const different = gate(judge(budget({ account_cap_cents: 20000, client_cap_cents: 25000 })), KEY)
    expect(different.status).toBe('green')
    expect(different.reason).toContain('账户级日上限')
    expect(different.reason).toContain('客户级日上限')
    expect(different.reason).not.toContain('账户级与客户级')

    const multi = gate(judge(budget({ account_cap_cents: 15000, client_cap_cents: 15000, registered_account_count: 2 })), KEY)
    expect(multi.status).toBe('yellow')
    expect(multi.reason).toContain('没超库里的账户级日上限')
    expect(multi.reason).not.toContain('账户级与客户级')
  })

  it('🔴 写死的配置数字再也不能让它变绿：配置说「计划 10100 ≤ 上限 11000」，但库里上限 15000、Meta 现读在投 16000 → 红', () => {
    const g = gate(judge(i => {
      i.config.planned_daily_budget_cents = 10100
      i.config.official_daily_cap_cents = 11000
      Object.assign(i.budget, { live_daily_budget_cents: 16000 })
    }), KEY)
    expect(g.status).toBe('red')
  })

  // ── 灰：读不到 / 没设 / 算不全。硬门的灰会挡住计划批准，黄不挡，所以这些一律不能出黄 ──
  it('🔴 灰（不是黄）：库里的上限 / Meta 现读的在投预算没读到（库读失败、令牌、上限配置无效…）——哪怕客户配置里写死的数字看起来都对', () => {
    const configLooksFine = (i: JudgeInput): void => {
      i.config.planned_daily_budget_cents = 10100
      i.config.official_daily_cap_cents = 11000
    }
    for (const error of ['读库里的账户级日上限失败', '没有可用的 Meta 令牌', '库里该广告账户的日预算上限配置无效']) {
      const g = gate(judge(i => { configLooksFine(i); unreadBudget(error)(i) }), KEY)
      expect(g.status, error).toBe('gray')
      expect(g.hard, error).toBe(true)
      expect(g.reason, error).toContain('没读到')
      expect(g.reason, error).toContain(error)
    }
    // 只有库那半边读失败（Meta 读到了）也是灰
    const dbOnly = gate(judge(budget({ read: false, error: '读库失败', account_cap_cents: null, client_cap_cents: null, registered_account_count: null })), KEY)
    expect(dbOnly.status).toBe('gray')
  })

  it('🔴 灰：库里账户级和客户级上限都没设', () => {
    const g = gate(judge(budget({ account_cap_cents: null, client_cap_cents: null })), KEY)
    expect(g.status).toBe('gray')
    expect(g.reason).toContain('没设')
  })

  it('🔴 灰：客户有多个登记账户、这个账户自己的上限没设（客户总上限顶替不了账户上限）；账户自己有上限的多账户客户不灰', () => {
    const g = gate(judge(budget({ account_cap_cents: null, registered_account_count: 2, client_cap_cents: 30000 })), KEY)
    expect(g.status).toBe('gray')
    expect(g.reason).toContain('2 个')
    expect(g.reason).toContain('账户')
    expect(gate(judge(budget({ registered_account_count: 2, client_cap_cents: 30000 })), KEY).status).not.toBe('gray')
  })

  it('🔴 灰：有用终身预算的在投系列 / 广告组（日预算折不出来，合计不全），写明个数', () => {
    const g = gate(judge(budget({ live_lifetime_budget_count: 2 })), KEY)
    expect(g.status).toBe('gray')
    expect(g.reason).toContain('2')
    expect(g.reason).toContain('终身')
  })

  it('灰：账户信息没读到；有没有付款方式没读到', () => {
    expect(gate(judge(i => { i.meta.account = null }), KEY).status).toBe('gray')
    expect(gate(judge(i => { i.meta.account!.has_funding_source = null }), KEY).status).toBe('gray')
  })

  // ── 黄：读全了、算得对，但还有不放心的地方（不挡批准）──
  it('🔴 黄（不出绿）：账户里一个在投的都没有——空返回可能是读取出了问题，不能判成「预算在上限内」', () => {
    const g = gate(judge(budget({ live_daily_budget_cents: 0, live_entity_count: 0 })), KEY)
    expect(g.status).toBe('yellow')
    expect(g.reason).toContain('一个在投的')
    expect(g.reason).toContain('日预算不超上限')
  })

  it('黄：客户有多个登记账户 → 只核对这一个账户，文案不说客户级；客户总上限是各账户加起来比的，这里没算', () => {
    const g = gate(judge(budget({ registered_account_count: 2, client_cap_cents: 30000 })), KEY)
    expect(g.status).toBe('yellow')
    expect(g.reason).toContain('这一个账户')
    expect(g.reason).toContain('没算')
    // 已核对的部分只声明「没超账户级上限」，不声明客户级（客户总上限是各账户加起来比的）
    expect(g.reason).toContain('没超库里的账户级日上限 150.00')
    expect(g.reason).not.toMatch(/没超库里的[^；]*客户级/)
  })

  it('黄的原因里照实带上已经核对过的数（在投合计、没超的上限），不只写「但是」', () => {
    const g = gate(judge(i => { i.config.official_daily_cap_cents = 11000 }), KEY)
    expect(g.status).toBe('yellow')
    expect(g.reason).toContain('134.00')
    expect(g.reason).toContain('但：')
  })

  it('黄：配置里的官方日上限跟库里不一致（要求以库为准）；一致 → 不因此变黄；配置没写 → 不比', () => {
    const mismatch = gate(judge(i => { i.config.official_daily_cap_cents = 11000 }), KEY)
    expect(mismatch.status).toBe('yellow')
    expect(mismatch.reason).toContain('110.00')
    expect(mismatch.reason).toContain('150.00')
    expect(gate(judge(i => { i.config.official_daily_cap_cents = 15000 }), KEY).status).toBe('green')
    expect(gate(judge(i => { i.config.official_daily_cap_cents = null }), KEY).status).toBe('green')
    // 账户级没设、只有客户级（单账户）时，配置跟客户级比
    expect(gate(judge(i => { budget({ account_cap_cents: null })(i); i.config.official_daily_cap_cents = 15000 }), KEY).status).toBe('green')
    expect(gate(judge(i => { budget({ account_cap_cents: null })(i); i.config.official_daily_cap_cents = 11000 }), KEY).status).toBe('yellow')
  })

  it('黄：配置里的计划日预算跟 Meta 现读的在投合计不一致；相等 → 绿；没写 → 不比', () => {
    const mismatch = gate(judge(i => { i.config.planned_daily_budget_cents = 10100 }), KEY)
    expect(mismatch.status).toBe('yellow')
    expect(mismatch.reason).toContain('101.00')
    expect(mismatch.reason).toContain('134.00')
    expect(gate(judge(i => { i.config.planned_daily_budget_cents = 13400 }), KEY).status).toBe('green')
  })

  it('账户自己设了花费上限，剩余额度不够「在投日预算合计」→ 红；在投合计没读到时不拿它去比（灰，不是红）', () => {
    const g = gate(judge(i => { Object.assign(i.meta.account!, { spend_cap_minor: 50000, amount_spent_minor: 45000 }) }), KEY)
    expect(g.status).toBe('red')
    const unknownLive = gate(judge(i => {
      Object.assign(i.meta.account!, { spend_cap_minor: 50000, amount_spent_minor: 45000 })
      unreadBudget('x')(i)
    }), KEY)
    expect(unknownLive.status).toBe('gray')
  })

  it('红灯优先于灰、黄；灰优先于黄', () => {
    const redOverGray = gate(judge(i => { unreadBudget('x')(i); i.meta.account!.has_funding_source = false }), KEY)
    expect(redOverGray.status).toBe('red')
    const redOverYellow = gate(judge(i => { i.config.official_daily_cap_cents = 11000; budget({ live_daily_budget_cents: 16000 })(i) }), KEY)
    expect(redOverYellow.status).toBe('red')
    const grayOverYellow = gate(judge(i => { i.config.official_daily_cap_cents = 11000; budget({ live_lifetime_budget_count: 1 })(i) }), KEY)
    expect(grayOverYellow.status).toBe('gray')
  })

  it('灰、黄的「怎么办」都不是空的（待办 / 清单直接用它）', () => {
    for (const mutate of [unreadBudget('x'), budget({ live_lifetime_budget_count: 1 }), budget({ live_daily_budget_cents: 0, live_entity_count: 0 })]) {
      expect(gate(judge(mutate), KEY).how.length).toBeGreaterThan(0)
    }
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

  // 第三轮整改：「没读到」的灰灯会变成开发欠账，它的「怎么办」要让开发照着做（令牌 / 接口 / 范围配置 / 手动补读回）
  it('没读到的灰灯：原因带上读取错误，「怎么办」说清令牌、接口、系列配置和手动补读回', () => {
    const g = judgePostLaunch('post_t24h', facts({ read: false, error: '令牌失效' }))
    expect(g.reason).toContain('开投后读回没读到')
    expect(g.reason).toContain('令牌失效')
    expect(g.how).toContain('令牌')
    expect(g.how).toContain('client-config')
    expect(g.how).toContain('管理员')
    expect(judgePostLaunch('post_t1h', facts({ read: false, error: null })).reason).toBe('开投后读回没读到')
  })

  it('还没花钱的灰灯：不是读取失败，「怎么办」仍是等有花费后再读', () => {
    const g = judgePostLaunch('post_t1h', facts({ spend_cents: 0 }))
    expect(g.reason).toContain('还没开始花钱')
    expect(g.how).toBe('等有花费后再读回')
  })

  it('花了钱一次点击都没有：1 小时读回是黄，24 小时读回是红', () => {
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 0, landing_page_views: 0 })).status).toBe('yellow')
    expect(judgePostLaunch('post_t24h', facts({ link_clicks: 0, landing_page_views: 0 })).status).toBe('red')
  })

  it('点击 ≥ 10 但落地页浏览为 0 → 红', () => {
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 10, landing_page_views: 0 })).status).toBe('red')
  })

  // 🔴 审查整改：点击不到 10 次，样本太小，什么都看不出来——不能判绿，改黄「样本不足」
  it('点击 1–9 次：样本不足 → 黄（1 小时、24 小时读回都一样），原因点明点击数和阈值，怎么办里让人再看下一份', () => {
    for (const phase of ['post_t1h', 'post_t24h'] as const) {
      for (const clicks of [1, 9]) {
        const g = judgePostLaunch(phase, facts({ link_clicks: clicks, landing_page_views: 0, leads: 0 }))
        expect(g.status, `${phase} ${clicks}`).toBe('yellow')
        expect(g.reason).toContain('样本不足')
        expect(g.reason).toContain(String(clicks))
        expect(g.how.length).toBeGreaterThan(0)
        expect(g.hard).toBe(false)
      }
    }
  })

  it('点击刚好 10 次就够判断落地页浏览了（不再是样本不足）', () => {
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 10, landing_page_views: 9, leads: 0 })).status).toBe('green')
  })

  it('点击 ≥ 10 且浏览/点击 < 0.5 → 黄；刚好 0.5 → 绿', () => {
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 20, landing_page_views: 9 })).status).toBe('yellow')
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 20, landing_page_views: 10 })).status).toBe('green')
  })

  it('24 小时读回：点击 ≥ 50 却一条留资都没有 → 黄；1 小时读回不看留资', () => {
    const enough = judgePostLaunch('post_t24h', facts({ link_clicks: 50, landing_page_views: 45, leads: 0 }))
    expect(enough.status).toBe('yellow')
    // 够样本了才说「一条留资都没有」，不是「样本不足」
    expect(enough.reason).toContain('一条留资都没有')
    expect(enough.reason).not.toContain('样本不足')
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 50, landing_page_views: 45, leads: 0 })).status).toBe('green')
  })

  it('24 小时读回：点击 10–49 次且一条留资都没有 → 黄「样本不足」（还看不出留资有没有在记），不是绿；有留资就是绿', () => {
    const g = judgePostLaunch('post_t24h', facts({ link_clicks: 49, landing_page_views: 45, leads: 0 }))
    expect(g.status).toBe('yellow')
    expect(g.reason).toContain('样本不足')
    expect(g.reason).toContain('49')
    expect(judgePostLaunch('post_t24h', facts({ link_clicks: 49, landing_page_views: 45, leads: 1 })).status).toBe('green')
    // 1 小时读回本来就不看留资
    expect(judgePostLaunch('post_t1h', facts({ link_clicks: 49, landing_page_views: 45, leads: 0 })).status).toBe('green')
  })
})
