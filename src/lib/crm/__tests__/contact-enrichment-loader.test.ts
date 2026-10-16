import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadEnrichmentInputs } from '../contact-enrichment-loader'

/** 只实现装载器真的会调用的链：from().select().eq()/in()/not().order().range() → 一页结果。 */
function fakeSb(tables: Record<string, unknown[]>, failTable?: string): SupabaseClient {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      for (const m of ['select', 'eq', 'in', 'not', 'order']) chain[m] = self
      chain.range = async () =>
        table === failTable ? { data: null, error: { message: 'boom' } } : { data: tables[table] ?? [], error: null }
      return chain
    },
  } as unknown as SupabaseClient
}

describe('loadEnrichmentInputs', () => {
  it('会话 → 渠道线索；邮件会话里：我们发出的 → 外发邮件，对方来信的真名 → 线索；邮箱当名字的发件人不当线索', async () => {
    const sb = fakeSb({
      conversations: [
        { id: 'v1', contact_id: 'c1', channel: 'email', participant_name: 'chris@x.com' },
        { id: 'v2', contact_id: 'c2', channel: 'messenger', participant_name: 'Wang Lei' },
        { id: 'v3', contact_id: null, channel: 'messenger', participant_name: 'Orphan' },
      ],
      conversation_messages: [
        { id: 'm1', conversation_id: 'v1', direction: 'outbound', sender_name: null, sent_at: '2026-09-25T03:46:34Z' },
        { id: 'm2', conversation_id: 'v1', direction: 'inbound', sender_name: 'Chris Kavy', sent_at: '2026-09-26T00:00:00Z' },
        { id: 'm3', conversation_id: 'v1', direction: 'inbound', sender_name: 'chris@x.com', sent_at: '2026-09-26T01:00:00Z' },
      ],
    })
    const r = await loadEnrichmentInputs(sb, 'client-a')
    expect(r.outboundEmails).toEqual([{ contactId: 'c1', sentAt: '2026-09-25T03:46:34Z', messageId: 'm1' }])
    expect(r.hints.filter((h) => h.contactId === 'c1').map((h) => h.participantName)).toEqual(['chris@x.com', 'Chris Kavy'])
    expect(r.hints.some((h) => h.contactId === 'c2' && h.channel === 'messenger' && h.participantName === 'Wang Lei')).toBe(true)
    expect(r.hints.some((h) => h.participantName === 'Orphan')).toBe(false)
  })

  it('「Automatic reply」之类的自动回执线程不算我们人工发出的邮件', async () => {
    const sb = fakeSb({
      conversations: [
        { id: 'v1', contact_id: 'c1', channel: 'email', participant_name: 'a@x.com', subject: 'Automatic reply: your enquiry' },
        { id: 'v2', contact_id: 'c2', channel: 'email', participant_name: 'b@x.com', subject: 'Your China tour itinerary' },
      ],
      conversation_messages: [
        { id: 'm1', conversation_id: 'v1', direction: 'outbound', sender_name: null, sent_at: '2026-09-25T03:46:34Z' },
        { id: 'm2', conversation_id: 'v2', direction: 'outbound', sender_name: null, sent_at: '2026-09-25T04:00:00Z' },
      ],
    })
    const r = await loadEnrichmentInputs(sb, 'client-a')
    expect(r.outboundEmails.map((m) => m.contactId)).toEqual(['c2'])
  })

  it('只查指定的人时，空名单直接返回空，不碰数据库', async () => {
    const from = vi.fn()
    const r = await loadEnrichmentInputs({ from } as unknown as SupabaseClient, 'client-a', [])
    expect(r).toEqual({ hints: [], outboundEmails: [] })
    expect(from).not.toHaveBeenCalled()
  })

  it('读失败 → 返回空（名单退回原样），不抛错', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const r = await loadEnrichmentInputs(fakeSb({}, 'conversations'), 'client-a')
    expect(r).toEqual({ hints: [], outboundEmails: [] })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
