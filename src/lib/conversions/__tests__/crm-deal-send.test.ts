import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { autoPassMessage, classifyDealSend, dispatchCrmDeal, partyReadNote } from '../crm-deal-send'

describe('auto-pass send result', () => {
  it('names a held queue, a real send, an expiry, and a blocked row differently', () => {
    expect(classifyDealSend({ status: 'queued', preview: { held: true } })).toBe('held')
    expect(classifyDealSend({ status: 'confirmed', preview: { held: false } })).toBe('sent')
    expect(classifyDealSend({ status: 'expired_no_send' })).toBe('expired')
    expect(classifyDealSend({ status: 'redacted' })).toBe('blocked')
    expect(classifyDealSend({ status: 'queued' })).toBe('not_sent')
    expect(classifyDealSend({ status: 'dry_run' })).toBe('not_sent')
    expect(classifyDealSend({ status: 'failed' })).toBe('failed')
    expect(classifyDealSend({ status: 'in_doubt' })).toBe('failed')
  })

  it('says the row was approved even when the send did not leave', () => {
    expect(autoPassMessage('recorded', 'sent')).toContain('已发给广告平台')
    expect(autoPassMessage('recorded', 'sent')).not.toContain('等审核')
    expect(autoPassMessage('recorded', 'held')).toContain('名单先停住')
    expect(autoPassMessage('recorded', 'expired')).toContain('7 天')
    expect(autoPassMessage('restored', 'sent')).toContain('重新打开')
    expect(partyReadNote('记下了。', true)).toContain('往来或跟进记录')
    expect(partyReadNote('记下了。', false)).toBe('记下了。')
  })

  it('a sender that throws is a failed send, not a lost row', async () => {
    const result = await dispatchCrmDeal({} as SupabaseClient, 'outcome-1', async () => {
      throw new Error('down')
    })
    expect(result).toBe('failed')
  })
})
