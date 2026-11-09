import { describe, expect, it } from 'vitest'
import { recentStaffNotes } from '../recent-staff-notes'

const now = new Date('2026-10-31T01:00:00Z')
const note = (id: string, at: string, raw = '发送行程资料') => ({
  id: `${id}-${at}`,
  contact_id: id, source: 'me_manual', direction: 'outbound' as const,
  occurred_at: at, raw, metadata: {} as Record<string, unknown>,
})

describe('recentStaffNotes', () => {
  it('第三页的最近手记仍进入快捷入口；按最近一笔去重，跳过机器、旧记录和按钮动作', () => {
    const contacts = Array.from({ length: 230 }, (_, i) => ({ id: `c${i}`, display_name: `Guest ${i}` }))
    const touches = [
      note('c228', '2026-10-30T23:00:00Z', '答应发送 catalogue'),
      note('c211', '2026-10-30T22:00:00Z', '周一 9 点回电'),
      note('c228', '2026-10-30T20:00:00Z', '旧的一笔'),
      note('c5', '2026-10-20T01:00:00Z'),
      { ...note('c6', '2026-10-30T23:30:00Z'), metadata: { action: 'snooze' } },
      { ...note('c7', '2026-10-30T23:30:00Z'), source: 'call_analysis' },
      note('outsider', '2026-10-30T23:30:00Z'),
    ]
    expect(recentStaffNotes(contacts, touches, now)).toEqual([
      { touchpointId: 'c228-2026-10-30T23:00:00Z', contactId: 'c228', name: 'Guest 228', at: '2026-10-30T23:00:00Z', occurredAt: '2026-10-30T23:00:00Z', preview: '答应发送 catalogue', content: '答应发送 catalogue' },
      { touchpointId: 'c211-2026-10-30T22:00:00Z', contactId: 'c211', name: 'Guest 211', at: '2026-10-30T22:00:00Z', occurredAt: '2026-10-30T22:00:00Z', preview: '周一 9 点回电', content: '周一 9 点回电' },
    ])
  })

  it('显示最近最多 50 位，手记是查找入口，不改变主名单排序', () => {
    const contacts = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, display_name: `Guest ${i}` }))
    const touches = contacts.map((contact, i) => note(contact.id, new Date(now.getTime() - i * 60_000).toISOString()))
    const result = recentStaffNotes(contacts, touches, now)
    expect(result).toHaveLength(50)
    expect(result[0].contactId).toBe('c0')
    expect(result[49].contactId).toBe('c49')
  })

  it('补记昨天的电话按今天写入时间显示，保留原通话时间', () => {
    const contacts = [{ id: 'late', display_name: 'Late log' }, { id: 'normal', display_name: 'Normal' }]
    const touches = [
      { ...note('late', '2026-10-20T01:00:00Z'), created_at: '2026-10-31T00:30:00Z' },
      { ...note('normal', '2026-10-30T23:00:00Z'), created_at: '2026-10-30T23:10:00Z' },
    ]
    const result = recentStaffNotes(contacts, touches, now)
    expect(result.map((item) => item.contactId)).toEqual(['late', 'normal'])
    expect(result[0].occurredAt).toBe('2026-10-20T01:00:00Z')
  })

  it('员工手记的来电也在找回区，自动触点不混入', () => {
    const contacts = [{ id: 'caller', display_name: 'Caller' }]
    const touches = [
      { ...note('caller', '2026-10-30T23:00:00Z', '客户回电'), direction: 'inbound' as const },
      { ...note('caller', '2026-10-30T23:30:00Z', '机器同步'), source: 'telephony' },
    ]
    expect(recentStaffNotes(contacts, touches, now).map((item) => item.preview)).toEqual(['客户回电'])
  })
})
