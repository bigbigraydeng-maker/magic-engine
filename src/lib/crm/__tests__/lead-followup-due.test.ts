/**
 * 「客人填了表还没人回」判据 + 取数测试。
 *
 * 每一条都对着 `lead-followup-due` 文件头里某一条**具体**的红线。首版的教训是
 * 判据测得很密、取数层一条没测，而两个 P0（重复填表、AI 外呼算成真人）
 * 恰好一个在取数层、一个在判定顺序上（子牙/魏征复审 2026-09-24）。
 */
import { describe, it, expect } from 'vitest'
import {
  pickLeadFollowupDue,
  isHumanFollowup,
  rateLeadFollowupWithinSla,
  findLeadFollowupDue,
  countLeadFollowupBacklog,
  loadLeadCandidates,
  LEAD_SLA_HOURS,
  LEAD_WINDOW_DAYS,
  type LeadCandidate,
  type LeadTouch,
} from '../lead-followup-due'
import type { SupabaseClient } from '@supabase/supabase-js'

const NOW = new Date('2026-09-24T00:00:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR

function iso(msAgo: number): string {
  return new Date(NOW.getTime() - msAgo).toISOString()
}

function touch(over: Partial<LeadTouch> = {}): LeadTouch {
  return {
    channel: 'email',
    direction: 'outbound',
    occurredAt: iso(DAY),
    source: 'microsoft_mail',
    metadata: null,
    ...over,
  }
}

function candidate(over: Partial<LeadCandidate> = {}): LeadCandidate {
  return {
    clientId: 'client-1',
    contactId: 'p1',
    displayName: '王女士',
    leadAt: iso(2 * DAY),
    interest: 'Best of China',
    touches: [],
    doNotContactFlag: false,
    stage: 'new',
    snoozeUntil: null,
    ...over,
  }
}

describe('isHumanFollowup —— 什么才算真人跟过', () => {
  it('info@ 发出去的邮件算', () => {
    expect(isHumanFollowup(touch({ channel: 'email', source: 'microsoft_mail' }))).toBe(true)
  })

  it('电话记录算，打不通也算（打过了就是打过了）', () => {
    expect(isHumanFollowup(touch({ channel: 'phone', direction: 'inbound', source: null }))).toBe(true)
  })

  it('🔴 AI 外呼**不算** —— 判定顺序反了的话，voice/crm-bridge 写的 phone+automated 会被当成真人', () => {
    expect(isHumanFollowup(touch({ channel: 'phone', direction: 'outbound', source: 'voice', metadata: { automated: true } }))).toBe(false)
  })

  it('有人在系统里手写了一笔算', () => {
    expect(isHumanFollowup(touch({ channel: 'email', direction: 'inbound', source: 'me_manual' }))).toBe(true)
  })

  it('🔴 Facebook 私信的外发整类不算 —— Meta 的 AI 客服在库里跟真人回复长得一模一样', () => {
    expect(isHumanFollowup(touch({ channel: 'messenger', source: 'messenger' }))).toBe(false)
  })

  it('Mailchimp 群发不算（isAutomatedTouch 整类认掉）', () => {
    expect(isHumanFollowup(touch({ channel: 'email', source: 'mailchimp' }))).toBe(false)
  })

  it('写入方自己标了 automated 的不算', () => {
    expect(isHumanFollowup(touch({ metadata: { automated: true } }))).toBe(false)
  })

  it('客人自己发进来的不算「我们跟过他」', () => {
    expect(isHumanFollowup(touch({ direction: 'inbound', source: 'microsoft_mail' }))).toBe(false)
  })

  it('生产里 direction / metadata 都是 NOT NULL，空 metadata 是 {} 不是 null', () => {
    expect(isHumanFollowup({ channel: 'email', direction: 'outbound', occurredAt: iso(DAY), source: 'microsoft_mail', metadata: {} })).toBe(true)
  })
})

describe('pickLeadFollowupDue', () => {
  it('没人回的进名单', () => {
    const r = pickLeadFollowupDue([candidate()], NOW)
    expect(r.items.map((i) => i.contactId)).toEqual(['p1'])
    expect(r.outsideWindow).toBe(0)
  })

  it('有真人回过的不进', () => {
    expect(pickLeadFollowupDue([candidate({ touches: [touch()] })], NOW).items).toEqual([])
  })

  it('🔴 只被 Facebook AI 客服回过的**照样进** —— 这正是 PM 反映的那批人', () => {
    const r = pickLeadFollowupDue(
      [candidate({ touches: [touch({ channel: 'messenger', source: 'messenger' })] })],
      NOW,
    )
    expect(r.items.map((i) => i.contactId)).toEqual(['p1'])
  })

  it(`刚填完不到 ${LEAD_SLA_HOURS} 小时的不催`, () => {
    const r = pickLeadFollowupDue([candidate({ leadAt: iso(2 * HOUR) })], NOW)
    expect(r.items).toEqual([])
    expect(r.outsideWindow).toBe(0)
  })

  it(`窗口（${LEAD_WINDOW_DAYS} 天）之外的不逐条列，但要计数`, () => {
    const r = pickLeadFollowupDue([candidate({ leadAt: iso(40 * DAY) })], NOW)
    expect(r.items).toEqual([])
    expect(r.outsideWindow).toBe(1)
  })

  it('标了别再联系的不进', () => {
    expect(pickLeadFollowupDue([candidate({ doNotContactFlag: true })], NOW).items).toEqual([])
  })

  it('别再联系被人推翻过的，重新进名单（判据只有 crm/dnc 一份）', () => {
    const r = pickLeadFollowupDue(
      [candidate({
        doNotContactFlag: true,
        touches: [touch({ direction: 'inbound', source: 'messenger', channel: 'messenger', metadata: { outcome: 'dnc_cleared' }, occurredAt: iso(DAY) })],
      })],
      NOW,
    )
    expect(r.items.map((i) => i.contactId)).toEqual(['p1'])
  })

  it('🔴 抑制哪些阶段由调用方按客户配置传进来，不在这里写死行业阶段名', () => {
    const suppressedStages = new Set(['purchased'])
    // 旅游那套的 deposit_paid 在这个客户的配置里不存在 → 不抑制
    expect(pickLeadFollowupDue([candidate({ stage: 'deposit_paid' })], NOW, { suppressedStages }).items).toHaveLength(1)
    expect(pickLeadFollowupDue([candidate({ stage: 'purchased' })], NOW, { suppressedStages }).items).toEqual([])
  })

  it('没传抑制集合时谁都不抑制 —— 宁可多列，不静默埋人', () => {
    expect(pickLeadFollowupDue([candidate({ stage: 'paid_full' })], NOW).items).toHaveLength(1)
  })

  it('🔴 停在「已联系」的照样提醒 —— 这一档可能是系统从 AI 对话里自动推出来的', () => {
    const suppressedStages = new Set(['deposit_paid', 'paid_full'])
    expect(pickLeadFollowupDue([candidate({ stage: 'contacted' })], NOW, { suppressedStages }).items).toHaveLength(1)
  })

  it('被按了「过阵子再提醒」且还没到点的不进', () => {
    const until = new Date(NOW.getTime() + 3 * DAY).toISOString()
    expect(pickLeadFollowupDue([candidate({ snoozeUntil: until })], NOW).items).toEqual([])
  })

  it('「过阵子再提醒」已经到点的重新进', () => {
    const until = new Date(NOW.getTime() - DAY).toISOString()
    expect(pickLeadFollowupDue([candidate({ snoozeUntil: until })], NOW).items).toHaveLength(1)
  })

  it('等最久的排最前', () => {
    const r = pickLeadFollowupDue(
      [candidate({ contactId: 'new', leadAt: iso(2 * DAY) }), candidate({ contactId: 'old', leadAt: iso(6 * DAY) })],
      NOW,
    )
    expect(r.items.map((i) => i.contactId)).toEqual(['old', 'new'])
  })

  it('封顶之后被压掉的要计数，不能静默消失', () => {
    const many = Array.from({ length: 5 }, (_, i) => candidate({ contactId: `p${i}`, leadAt: iso((2 + i) * DAY) }))
    const r = pickLeadFollowupDue(many, NOW, { maxPerClient: 2 })
    expect(r.items).toHaveLength(2)
    expect(r.dropped).toBe(3)
  })

  it('maxPerClient = 0 表示不封顶（积压统计要用）', () => {
    const many = Array.from({ length: 5 }, (_, i) => candidate({ contactId: `p${i}` }))
    expect(pickLeadFollowupDue(many, NOW, { maxPerClient: 0 }).items).toHaveLength(5)
  })

  it('时间戳坏掉的不丢，计进窗口外', () => {
    const r = pickLeadFollowupDue([candidate({ leadAt: 'not-a-date' })], NOW)
    expect(r.items).toEqual([])
    expect(r.outsideWindow).toBe(1)
  })
})

/* ------------------------------------------------------------------ *
 * 取数层 —— 两个 P0 都藏在这一半，首版一条没测
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>

/** 够用就好的假 supabase：支持 eq / in / gte / not / order / range。 */
function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  const build = (name: string) => {
    let rows = [...(tables[name] ?? [])]
    const api = {
      select: () => api,
      eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return api },
      in: (col: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[col])); return api },
      gte: (col: string, v: string) => { rows = rows.filter((r) => String(r[col]) >= v); return api },
      not: (col: string, _op: string, _v: unknown) => { rows = rows.filter((r) => r[col] != null); return api },
      order: (col: string) => { rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col]))); return api },
      range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
    }
    return api
  }
  return { from: (name: string) => build(name) } as unknown as SupabaseClient
}

const CLIENT = 'client-1'

function leadRow(contactId: string, occurredAt: string, interest?: string): Row {
  return {
    id: `lead-${contactId}-${occurredAt}`,
    client_id: CLIENT,
    contact_id: contactId,
    channel: 'meta_lead_form',
    direction: 'inbound',
    occurred_at: occurredAt,
    source: 'meta_lead_form',
    metadata: interest ? { tour_interest_raw: interest } : {},
  }
}

function contactRow(id: string, over: Row = {}): Row {
  return { id, client_id: CLIENT, display_name: `人 ${id}`, do_not_contact: false, stage: 'new', snooze_until: null, ...over }
}

describe('取数层 · findLeadFollowupDue', () => {
  it('🔴 填过两次表：第一次被跟过、第二次还没人理 —— 必须按**最近**那次算，人不能消失', async () => {
    const db = fakeDb({
      contact_touchpoints: [
        leadRow('p1', iso(60 * DAY), '旧行程'),
        // 对第一次留资的真人跟进
        { id: 't1', client_id: CLIENT, contact_id: 'p1', channel: 'email', direction: 'outbound', occurred_at: iso(59 * DAY), source: 'microsoft_mail', metadata: {} },
        leadRow('p1', iso(2 * DAY), '新行程'),
      ],
      contacts: [contactRow('p1')],
      client_pipeline_stages: [],
    })
    const r = await findLeadFollowupDue(db, CLIENT, NOW)
    expect(r.items.map((i) => i.contactId)).toEqual(['p1'])
    // 展示的也必须是最近那次选的团 —— 55 个重复填表的人里 44 个两次选的不一样
    expect(r.items[0].interest).toBe('新行程')
    expect(r.items[0].leadAt).toBe(iso(2 * DAY))
  })

  it('最近那次留资之后有真人跟进的，不进名单', async () => {
    const db = fakeDb({
      contact_touchpoints: [
        leadRow('p1', iso(3 * DAY)),
        { id: 't1', client_id: CLIENT, contact_id: 'p1', channel: 'phone', direction: 'outbound', occurred_at: iso(2 * DAY), source: 'me_manual', metadata: {} },
      ],
      contacts: [contactRow('p1')],
      client_pipeline_stages: [],
    })
    expect((await findLeadFollowupDue(db, CLIENT, NOW)).items).toEqual([])
  })

  it('留资**之前**的往来不算对这条线索的跟进', async () => {
    const db = fakeDb({
      contact_touchpoints: [
        { id: 't1', client_id: CLIENT, contact_id: 'p1', channel: 'email', direction: 'outbound', occurred_at: iso(5 * DAY), source: 'microsoft_mail', metadata: {} },
        leadRow('p1', iso(3 * DAY)),
      ],
      contacts: [contactRow('p1')],
      client_pipeline_stages: [],
    })
    expect((await findLeadFollowupDue(db, CLIENT, NOW)).items).toHaveLength(1)
  })

  it('🔴 抑制阶段按这个客户自己的配置算，用的是 crm/pipeline 那份判据', async () => {
    const db = fakeDb({
      contact_touchpoints: [leadRow('p1', iso(3 * DAY)), leadRow('p2', iso(3 * DAY))],
      contacts: [contactRow('p1', { stage: 'purchased' }), contactRow('p2', { stage: 'viewing' })],
      client_pipeline_stages: [
        { id: 's1', client_id: CLIENT, stage_key: 'purchased', marketing_action: 'won', is_terminal: true },
        { id: 's2', client_id: CLIENT, stage_key: 'viewing', marketing_action: 'nurture', is_terminal: false },
      ],
    })
    const r = await findLeadFollowupDue(db, CLIENT, NOW)
    expect(r.items.map((i) => i.contactId)).toEqual(['p2'])
  })

  it('🔴 表单指向的人在 contacts 里查不到 —— 不静默跳过，要计数', async () => {
    const db = fakeDb({
      contact_touchpoints: [leadRow('p1', iso(3 * DAY)), leadRow('ghost', iso(3 * DAY))],
      contacts: [contactRow('p1')],
      client_pipeline_stages: [],
    })
    const r = await findLeadFollowupDue(db, CLIENT, NOW)
    expect(r.items).toHaveLength(1)
    expect(r.orphans).toBe(1)
  })

  it('别的客户的数据不串进来', async () => {
    const db = fakeDb({
      contact_touchpoints: [leadRow('p1', iso(3 * DAY)), { ...leadRow('x1', iso(3 * DAY)), client_id: 'other' }],
      contacts: [contactRow('p1'), { ...contactRow('x1'), client_id: 'other' }],
      client_pipeline_stages: [],
    })
    expect((await findLeadFollowupDue(db, CLIENT, NOW)).items.map((i) => i.contactId)).toEqual(['p1'])
  })

  it('一条表单都没有时干净返回，不去查后面那几张表', async () => {
    const db = fakeDb({ contact_touchpoints: [], contacts: [], client_pipeline_stages: [] })
    expect(await findLeadFollowupDue(db, CLIENT, NOW)).toEqual({ items: [], dropped: 0, orphans: 0 })
  })

  it('超过一页（1000 行）的表单照样读全 —— fetchAll 分页', async () => {
    const leads: Row[] = []
    const contacts: Row[] = []
    for (let i = 0; i < 1200; i++) {
      leads.push(leadRow(`p${String(i).padStart(4, '0')}`, iso(3 * DAY)))
      contacts.push(contactRow(`p${String(i).padStart(4, '0')}`))
    }
    const db = fakeDb({ contact_touchpoints: leads, contacts, client_pipeline_stages: [] })
    const r = await findLeadFollowupDue(db, CLIENT, NOW, 0)
    expect(r.items).toHaveLength(1200)
  })
})

describe('取数层 · countLeadFollowupBacklog', () => {
  it('只数窗口外的，窗口内的不重复计', async () => {
    const db = fakeDb({
      contact_touchpoints: [leadRow('inWin', iso(3 * DAY)), leadRow('old1', iso(40 * DAY)), leadRow('old2', iso(90 * DAY))],
      contacts: [contactRow('inWin'), contactRow('old1'), contactRow('old2')],
      client_pipeline_stages: [],
    })
    const r = await countLeadFollowupBacklog(db, CLIENT, NOW)
    expect(r.backlog).toBe(2)
    expect(r.lookbackDays).toBeGreaterThan(LEAD_WINDOW_DAYS)
  })

  it('窗口外但已经有真人跟过的不算积压', async () => {
    const db = fakeDb({
      contact_touchpoints: [
        leadRow('old1', iso(40 * DAY)),
        { id: 't1', client_id: CLIENT, contact_id: 'old1', channel: 'phone', direction: 'outbound', occurred_at: iso(39 * DAY), source: 'me_manual', metadata: {} },
      ],
      contacts: [contactRow('old1')],
      client_pipeline_stages: [],
    })
    expect((await countLeadFollowupBacklog(db, CLIENT, NOW)).backlog).toBe(0)
  })
})

describe('rateLeadFollowupWithinSla', () => {
  it('24 小时跟进率只认真人跟进，Messenger 不算', () => {
    const human = candidate({ contactId: 'a', touches: [touch({ occurredAt: iso(2 * DAY - 2 * HOUR) })] })
    const messenger = candidate({
      contactId: 'b',
      touches: [touch({ channel: 'messenger', source: 'messenger', occurredAt: iso(2 * DAY - 2 * HOUR) })],
    })
    expect(rateLeadFollowupWithinSla([human, messenger], NOW)).toEqual({
      scored: 2,
      followedWithinSla: 1,
      rate: 0.5,
    })
  })

  it('跟进率结果里没有客人姓名；挑出来的条目带广告组编号', () => {
    const picked = pickLeadFollowupDue([candidate({ adsetId: 'set-1' })], NOW, { maxPerClient: 0 })
    expect(picked.items[0]?.adsetId).toBe('set-1')
    expect(JSON.stringify(rateLeadFollowupWithinSla([candidate({ adsetId: 'set-1' })], NOW))).not.toContain('王女士')
  })
})

describe('loadLeadCandidates', () => {
  it('lookback 之外的表单根本不读进来', async () => {
    const db = fakeDb({
      contact_touchpoints: [leadRow('recent', iso(3 * DAY)), leadRow('ancient', iso(400 * DAY))],
      contacts: [contactRow('recent'), contactRow('ancient')],
      client_pipeline_stages: [],
    })
    const r = await loadLeadCandidates(db, CLIENT, NOW, 30)
    expect(r.candidates.map((c) => c.contactId)).toEqual(['recent'])
  })
})
