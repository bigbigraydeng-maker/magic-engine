/**
 * 「看着不是客人来咨询」的降级：只从「今天要联系」挪到「先放着」，不删不藏。
 * 判据本身的用例在 enquiry-screen/__tests__/sender-shape.test.ts，这里只测接线。
 */
import { describe, it, expect } from 'vitest'
import { buildPriorityView } from '../contact-list-view'
import type { ContactRowLike, TouchpointRowLike } from '../contact-model'

const NOW = new Date('2026-10-25T09:00:00+13:00')

function contact(id: string, email: string | null, name: string | null): ContactRowLike {
  return { id, display_name: name, primary_phone: null, primary_email: email, do_not_contact: false, snooze_until: null, stage: null }
}
/** 一条刚进来、没人回过的入站触点 —— 这种人本来一定在「今天要联系」。 */
function freshInbound(id: string): TouchpointRowLike {
  return { contact_id: id, channel: 'email', direction: 'inbound', occurred_at: '2026-10-24T20:00:00Z', source: 'email/outlook', raw: null, metadata: null }
}

function run(rows: Array<[string, string | null, string | null]>) {
  const contacts = rows.map(([id, e, n]) => contact(id, e, n))
  const out = buildPriorityView(
    { contacts, touchpoints: contacts.map((c) => freshInbound(c.id)), stageMeta: new Map(), now: NOW, perPage: 100, open: { hot: true, cold: true } },
    (row, ranked) => ({ id: row.id, segment: ranked.seg.segment, reason: ranked.seg.reason }),
  )
  const find = (key: string) => out.sections.find((s) => s.key === key)
  return {
    hot: (find("hot")?.items ?? []) as Array<{ id: string; segment: string; reason: string }>,
    cold: (find('cold')?.items ?? []) as Array<{ id: string; segment: string; reason: string }>,
  }
}

describe('buildPriorityView — 不像客人来咨询的发件人', () => {
  it('真客人留在「今天要联系」', () => {
    const { hot, cold } = run([['a', 'r.sgoodin@xtra.co.nz', 'Sharyn Goodin']])
    expect(hot.map((r) => r.id)).toEqual(['a'])
    expect(cold).toHaveLength(0)
  })

  it.each([
    ['群发中转', 'anzacvn@221832422.mailchimpapp.com', 'Vietnam Tours Direct'],
    ['供应商通知', 'numbers-regulatory-review@twilio.com', null],
    ['推销', 'outreach@nzingadigital.com', 'ZORAVYO'],
    ['群发子域', 'hello@mail.grokbot.com', null],
    ['系统账号', null, 'WhatsApp Business'],
  ])('%s 被挪到「先放着」，不是消失', (_n, email, name) => {
    const { hot, cold } = run([['a', email, name]])
    expect(hot).toHaveLength(0)
    expect(cold.map((r) => r.id)).toEqual(['a'])
    expect(cold[0].segment).toBe('not_enquiry_suspect')
    expect(cold[0].reason).toContain('看着不是客人来咨询')
  })

  it('一批人里只挪走垃圾，真客人一个不少', () => {
    const { hot, cold } = run([
      ['real1', 'r.sgoodin@xtra.co.nz', 'Sharyn Goodin'],
      ['junk1', 'hello@info.e.afterpay.com', 'Afterpay Team'],
      ['real2', 'jenny.wang@cnsst.org.nz', 'Jenny Wang'],
      ['junk2', 'chajense@chajense.com', null],
      ['real3', 'sales@tasukitravel.com', 'Sales TASUKI'],
    ])
    expect(hot.map((r) => r.id).sort()).toEqual(['real1', 'real2', 'real3'])
    expect(cold.map((r) => r.id).sort()).toEqual(['junk1', 'junk2'])
  })

  it('本来就在「先放着」的人不会被这条规则抬上来（只降不升）', () => {
    const rows = [contact('x', 'outreach@nzingadigital.com', 'ZORAVYO')]
    rows[0].do_not_contact = true // 别再联系 —— 已经是 cold
    const out = buildPriorityView(
      { contacts: rows, touchpoints: [freshInbound('x')], stageMeta: new Map(), now: NOW, perPage: 100, open: { hot: true, cold: true } },
      (row, ranked) => ({ id: row.id, segment: ranked.seg.segment }),
    )
    const cold = (out.sections.find((s) => s.key === 'cold')?.items ?? []) as Array<{ segment: string }>
    expect(cold[0].segment).toBe('excluded')
  })
})
