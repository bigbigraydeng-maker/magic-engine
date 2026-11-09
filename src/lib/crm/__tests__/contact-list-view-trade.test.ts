/**
 * 同行（旅行社 / 分销）不在「今天先联系」散客名单里：挪到先放着、写明原因，不删不藏。
 * 域名是否算同行由路由用 contactKindOf 算好传进来（tradeIds）；这里只测接线。
 */
import { describe, it, expect } from 'vitest'
import { buildPriorityView } from '../contact-list-view'
import type { ContactRowLike, TouchpointRowLike } from '../contact-model'

const NOW = new Date('2026-10-29T09:00:00+13:00')

const contact = (id: string, name: string): ContactRowLike => ({
  id, display_name: name, primary_phone: null, primary_email: `${id}@example.com`, do_not_contact: false, snooze_until: null, stage: null,
})
const fresh = (id: string): TouchpointRowLike => ({
  contact_id: id, channel: 'email', direction: 'inbound', occurred_at: '2026-10-28T20:00:00Z', source: 'email/outlook', raw: null, metadata: null,
})

function run(tradeIds?: Set<string>) {
  const contacts = [contact('agent', 'Melissa Agent'), contact('guest', 'Sue Guest')]
  const out = buildPriorityView(
    { contacts, touchpoints: contacts.map((c) => fresh(c.id)), stageMeta: new Map(), now: NOW, perPage: 100, open: { hot: true, cold: true }, tradeIds },
    (row, ranked) => ({ id: row.id, segment: ranked.seg.segment, reason: ranked.seg.reason }),
  )
  const items = (k: string) => (out.sections.find((s) => s.key === k)?.items ?? []) as Array<{ id: string; segment: string; reason: string }>
  return { hot: items('hot'), cold: items('cold') }
}

describe('buildPriorityView — 同行不进今天名单', () => {
  it('没传 tradeIds：行为不变，两个人都在今天要联系', () => {
    expect(run().hot.map((r) => r.id).sort()).toEqual(['agent', 'guest'])
  })

  it('同行被挪到先放着并写明原因，散客留在今天要联系；人没有消失', () => {
    const { hot, cold } = run(new Set(['agent']))
    expect(hot.map((r) => r.id)).toEqual(['guest'])
    expect(cold.map((r) => r.id)).toEqual(['agent'])
    expect(cold[0].reason).toContain('同行')
  })
})
