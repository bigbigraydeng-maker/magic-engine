/**
 * 员工记完笔记，这个人必须还在「今天要联系」里（2026-10-30 CTS 员工实测）。
 *
 * 两张脸，同一个根：
 *   (a) Nathan —— 通话后记一笔，「刚通完电话…记下一步」提醒不消（员工以为没存上）。
 *       根因：规则 6.5 把员工手记（phone / outbound / spoke 兜底值）也当成「打通的电话」。
 *   (b) Andrea —— 笔记被解析出下一步（回电时间），人从「今天要联系」掉进「先放着」。
 *       根因：「全部客人」的两张名单是实时分段，从没走过 day-list 的「当天不变」。
 *
 * 用真实装配管道（contact-model → day-list → list-sections）端到端钉。
 */

import { describe, expect, it, vi } from 'vitest'
import { buildPriorityView } from '../contact-list-view'
import type { ContactRowLike, TouchpointRowLike } from '../contact-model'
import { buildContactModel } from '../contact-model'
import { contactsTouchedToday, localDayStartMs } from '../day-list'
import { segmentContact } from '../segments'
import { handledNextAction, nextActionFor } from '../next-action'

const TZ = 'Pacific/Auckland'
/** 新西兰 10/30 17:30（夏令时 UTC+13）。 */
const NOW = new Date('2026-10-30T04:30:00.000Z')
const DAY_START = localDayStartMs(NOW, TZ)

const CALL_AT = '2026-10-30T03:50:00.000Z' // 16:50 员工打通电话（电话系统记的）
const NOTE_AT = '2026-10-30T04:06:42.000Z' // 17:06 员工记笔记

function contact(id: string): ContactRowLike {
  return {
    id,
    display_name: id,
    primary_phone: '+64211230001',
    primary_email: `${id.toLowerCase()}@example.com`,
    do_not_contact: false,
    snooze_until: null,
    stage: null,
  }
}

/** 前天进线的新客人，今天早上还没人碰过 → 早上他在「今天要联系」。 */
function enquiry(id: string): TouchpointRowLike {
  return {
    contact_id: id,
    channel: 'web_form',
    direction: 'inbound',
    occurred_at: '2026-10-28T02:00:00.000Z',
    source: 'web_form',
    raw: null,
    metadata: null,
  }
}

/** 电话系统记的、真打通的外呼。 */
function twilioCall(id: string): TouchpointRowLike {
  return {
    contact_id: id,
    channel: 'phone',
    direction: 'outbound',
    occurred_at: CALL_AT,
    source: 'twilio',
    raw: null,
    metadata: { outcome: 'spoke', answered: true, reached: true },
  }
}

/** 员工在抽屉里「聊完了，记一笔」写的那条。 */
function staffNote(id: string, metadata: Record<string, unknown> = {}): TouchpointRowLike {
  return {
    contact_id: id,
    channel: 'phone',
    direction: 'outbound',
    occurred_at: NOTE_AT,
    source: 'me_manual',
    raw: '大瑞测试，可能感兴趣 14 days China unveiled',
    metadata: { outcome: 'spoke', logged_by: 'info@ctstours.co.nz', ...metadata },
  }
}

interface Out {
  id: string
  segment: string
  afterCall: boolean
  handled: boolean | undefined
}

function view(id: string, tps: TouchpointRowLike[], opts: { day: boolean }) {
  const { sections } = buildPriorityView<Out>(
    {
      contacts: [contact(id)],
      touchpoints: tps,
      stageMeta: new Map(),
      now: NOW,
      open: { hot: true, cold: true },
      ...(opts.day
        ? { dayStartMs: DAY_START, touchedToday: contactsTouchedToday(tps, NOW, TZ) }
        : {}),
    },
    (row, ranked) => ({
      id: row.id,
      segment: ranked.seg.segment,
      afterCall: ranked.seg.afterCall === true,
      handled: ranked.handled,
    }),
  )
  const hot = sections.find((s) => s.key === 'hot')?.items ?? []
  const cold = sections.find((s) => s.key === 'cold')?.items ?? []
  return { hot, cold }
}

describe('规则 6.5：员工手记不是「打通的电话」（Nathan）', () => {
  it('只有员工手记（兜底 spoke）、没有真通话 → 不出现「刚通完电话」提醒', () => {
    const tps = [enquiry('Nathan'), staffNote('Nathan')]
    const seg = segmentContact(buildContactModel(contact('Nathan'), tps, new Map()), NOW)
    expect(seg.afterCall).not.toBe(true)
  })

  it('真通话之后员工记了一笔 → 提醒消掉（有人跟了），不再催「记下一步」', () => {
    const tps = [enquiry('Nathan'), twilioCall('Nathan'), staffNote('Nathan')]
    const seg = segmentContact(buildContactModel(contact('Nathan'), tps, new Map()), NOW)
    expect(seg.afterCall).not.toBe(true)
  })

  it('对照：只有真通话、还没人记 → 提醒仍然在（没有误伤原功能）', () => {
    const tps = [enquiry('Nathan'), twilioCall('Nathan')]
    const seg = segmentContact(buildContactModel(contact('Nathan'), tps, new Map()), NOW)
    expect(seg.afterCall).toBe(true)
  })
})

describe('记完笔记，人留在「今天要联系」原位（Nathan / Andrea）', () => {
  it('Nathan：通话 + 笔记之后仍在 hot，标成已处理，不掉进先放着', () => {
    const tps = [enquiry('Nathan'), twilioCall('Nathan'), staffNote('Nathan')]
    const { hot, cold } = view('Nathan', tps, { day: true })
    expect(hot.map((r) => r.id)).toEqual(['Nathan'])
    expect(cold).toEqual([])
    expect(hot[0].handled).toBe(true)
  })

  it('Andrea：笔记解析出未来回电（下周一）也不把人挪出 hot', () => {
    const nextMonday = '2026-11-02T20:00:00.000Z'
    const tps = [
      enquiry('Andrea'),
      twilioCall('Andrea'),
      staffNote('Andrea', { callback_at: nextMonday }),
    ]
    const { hot, cold } = view('Andrea', tps, { day: true })
    expect(hot.map((r) => r.id)).toEqual(['Andrea'])
    expect(cold).toEqual([])
    expect(hot[0].handled).toBe(true)
  })

  it('对照（证明冻结确实在起作用）：不传 dayStartMs 的实时分段，Andrea 会掉进先放着', () => {
    const tps = [
      enquiry('Andrea'),
      twilioCall('Andrea'),
      staffNote('Andrea', { callback_at: '2026-11-02T20:00:00.000Z' }),
    ]
    const { hot, cold } = view('Andrea', tps, { day: false })
    expect(hot).toEqual([])
    expect(cold.map((r) => r.id)).toEqual(['Andrea'])
  })

  it('客人今天回话照常实时升上来：笔记之后客人来信 → 不再标已处理', () => {
    const reply: TouchpointRowLike = {
      contact_id: 'Nathan',
      channel: 'email',
      direction: 'inbound',
      occurred_at: '2026-10-30T04:20:00.000Z',
      source: 'email',
      raw: null,
      metadata: null,
    }
    const tps = [enquiry('Nathan'), twilioCall('Nathan'), staffNote('Nathan'), reply]
    const { hot } = view('Nathan', tps, { day: true })
    expect(hot[0]?.id).toBe('Nathan')
    expect(hot[0]?.handled).toBe(false)
  })
})

describe('contactsTouchedToday：笔记算「今天联系过」，机器和按钮不算', () => {
  const base = (over: Partial<TouchpointRowLike>): TouchpointRowLike => ({
    contact_id: 'X',
    channel: 'phone',
    direction: 'outbound',
    occurred_at: NOTE_AT,
    source: 'me_manual',
    raw: null,
    metadata: { outcome: 'spoke' },
    ...over,
  })
  it('员工手记算', () => {
    expect(contactsTouchedToday([base({})], NOW, TZ).has('X')).toBe(true)
  })
  it('昨天的不算', () => {
    expect(contactsTouchedToday([base({ occurred_at: '2026-10-28T04:00:00.000Z' })], NOW, TZ).has('X')).toBe(false)
  })
  it('推迟按钮不算', () => {
    expect(
      contactsTouchedToday([base({ metadata: { outcome: 'spoke', action: 'snooze' } })], NOW, TZ).has('X'),
    ).toBe(false)
  })
  it('群发不算', () => {
    expect(contactsTouchedToday([base({ source: 'mailchimp', channel: 'email' })], NOW, TZ).has('X')).toBe(false)
  })
})

/** 20 天前咨询、19 天前我们回过 —— 早上是「聊过一轮就断了」（先放着）。 */
function oldCustomer(id: string): TouchpointRowLike[] {
  return [
    { ...enquiry(id), occurred_at: '2026-10-10T02:00:00.000Z' },
    {
      contact_id: id,
      channel: 'email',
      direction: 'outbound',
      occurred_at: '2026-10-11T02:00:00.000Z',
      source: 'me_manual',
      raw: null,
      metadata: { outcome: 'spoke' },
    },
  ]
}

describe('老客人被我们自己的电话聊热 → 记完笔记仍在今天要联系（魏征 P1-2）', () => {
  const NOTE2 = '发了邮件，等他回'
  const noteRow = (id: string): TouchpointRowLike => ({
    ...staffNote(id),
    raw: NOTE2,
    metadata: { outcome: 'spoke', logged_by: 'info@ctstours.co.nz' },
  })

  it('第一步：早上他在先放着', () => {
    const { hot, cold } = view('Old', oldCustomer('Old'), { day: true })
    expect(hot).toEqual([])
    expect(cold.map((r) => r.segment)).toEqual(['stale_conversation'])
  })

  it('第二步：打通电话后抬进今天要联系，带「刚聊过」提醒，还没灰', () => {
    const { hot } = view('Old', [...oldCustomer('Old'), twilioCall('Old')], { day: true })
    expect(hot.map((r) => r.id)).toEqual(['Old'])
    expect(hot[0].afterCall).toBe(true)
    expect(hot[0].handled).toBe(false)
  })

  it('第三步：员工记完笔记 → 仍在今天要联系、变灰打勾、提醒撤掉，不退回先放着', () => {
    const { hot, cold } = view('Old', [...oldCustomer('Old'), twilioCall('Old'), noteRow('Old')], { day: true })
    expect(cold).toEqual([])
    expect(hot.map((r) => r.id)).toEqual(['Old'])
    expect(hot[0].handled).toBe(true)
    expect(hot[0].afterCall).toBe(false)
  })

  it('对照：笔记没带通话（只有笔记）时，早上在先放着的人不会被抬进今天要联系', () => {
    const { hot, cold } = view('Old', [...oldCustomer('Old'), noteRow('Old')], { day: true })
    expect(hot).toEqual([])
    expect(cold.map((r) => r.id)).toEqual(['Old'])
  })
})

describe('灰卡和提醒不能同时出现（魏征 P2-b）', () => {
  it('通话后还没记笔记：有提醒、不灰', () => {
    const { hot } = view('Nathan', [enquiry('Nathan'), twilioCall('Nathan')], { day: true })
    expect(hot[0].afterCall).toBe(true)
    expect(hot[0].handled).toBe(false)
  })
  it('记完笔记：没提醒、灰', () => {
    const { hot } = view('Nathan', [enquiry('Nathan'), twilioCall('Nathan'), staffNote('Nathan')], { day: true })
    expect(hot[0].afterCall).toBe(false)
    expect(hot[0].handled).toBe(true)
  })
  it('handledNextAction：动词改「先别打」，理由换成今天做了什么，名单不变', () => {
    const na = nextActionFor({ seg: segmentContact(buildContactModel(contact('N'), [enquiry('N')], new Map()), NOW), intent: null, aiNextAction: null })
    const h = handledNextAction(na, '今天联系过了，他还没回')
    expect(h.verb).toBe('hold')
    expect(h.list).toBe(na.list)
    expect(h.line).toBe('先别打 —— 今天联系过了，他还没回')
  })
})

describe('今天被推到成交 / 停止营销：两页行为一致（魏征 P2-c）', () => {
  const stages = new Map([['won', { label: '已成交', suppressed: true }]])
  const wonContact: ContactRowLike = { ...contact('Won'), stage: 'won' }

  function viewWon(ids: ReadonlySet<string>) {
    const tps = [enquiry('Won')]
    const { sections } = buildPriorityView<{ id: string; handled: boolean | undefined }>(
      {
        contacts: [wonContact],
        touchpoints: tps,
        stageMeta: stages,
        now: NOW,
        open: { hot: true, cold: true },
        dayStartMs: DAY_START,
        touchedToday: contactsTouchedToday(tps, NOW, TZ),
        stageSuppressedTodayIds: ids,
      },
      (row, ranked) => ({ id: row.id, handled: ranked.handled }),
    )
    return { hot: sections[0].items ?? [], cold: sections[1].items ?? [] }
  }

  it('今天从「还在名单上」被推到成交 → 留在今天要联系，变灰', () => {
    const { hot, cold } = viewWon(new Set(['Won']))
    expect(cold).toEqual([])
    expect(hot.map((r) => r.id)).toEqual(['Won'])
    expect(hot[0].handled).toBe(true)
  })

  it('对照：没有「今天被推」这份证据（昨天就成交）→ 本来就在先放着', () => {
    const { hot, cold } = viewWon(new Set())
    expect(hot).toEqual([])
    expect(cold.map((r) => r.id)).toEqual(['Won'])
  })
})

describe('loadStageSuppressedTodayIds：只认改之前还在名单上的（today 与全部客人共用）', () => {
  it('首条 from_stage 抑制 → 不算；为空或不抑制 → 算；一天多次只看最早那条', async () => {
    const events = [
      { contact_id: 'A', from_stage: 'new', created_at: '2026-10-29T20:00:00Z' },
      { contact_id: 'B', from_stage: 'won', created_at: '2026-10-29T20:01:00Z' },
      { contact_id: 'C', from_stage: null, created_at: '2026-10-29T20:02:00Z' },
      { contact_id: 'A', from_stage: 'won', created_at: '2026-10-29T21:00:00Z' },
    ]
    vi.resetModules()
    vi.doMock('@/lib/supabase', () => ({
      supabaseAdmin: {
        from: () => ({
          select: () => ({ eq: () => ({ gte: () => ({ order: async () => ({ data: events }) }) }) }),
        }),
      },
    }))
    const { loadStageSuppressedTodayIds } = await import('../day-stage-events')
    const ids = await loadStageSuppressedTodayIds('cts', 0, (k) => k === 'won')
    expect([...ids].sort()).toEqual(['A', 'C'])
    vi.doUnmock('@/lib/supabase')
  })
})
