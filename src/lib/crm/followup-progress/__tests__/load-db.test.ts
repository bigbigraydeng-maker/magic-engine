// @vitest-environment node
/**
 * The loader against the real Supabase client with a stubbed network (same harness as the AI pickup tests):
 * the whole-book read, and the one-guest read the release re-check uses, must judge every guest the same way.
 */
import { describe, expect, it } from 'vitest'
import { CLIENT, OTHER, db, type Row } from '@/lib/crm/ai-takeover/__tests__/pickup-db'
import { loadFollowupProgress } from '../load'
import { DEFAULT_GROUP_CONFIG } from '../groups'

const NOW = new Date('2026-11-28T02:00:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()
const guest = (id: string, over: Row = {}): Row => ({ id, client_id: CLIENT, display_name: `Guest ${id}`, do_not_contact: false, stage: 'contacted', ai_takeover_since: null, snooze_until: null, primary_email: `${id}@x.co`, primary_phone: '+64210000000', ...over })
let n = 0
const touch = (contact: string, over: Row): Row => ({ id: `t${String(++n).padStart(3, '0')}`, client_id: CLIENT, contact_id: contact, channel: 'email', direction: 'outbound', source: 'microsoft_mail', occurred_at: ago(40), summary: null, metadata: null, ...over })

function tables(): Record<string, Row[]> {
  return {
    contacts: [
      guest('warm'), guest('cold'), guest('wait'), guest('lead', { stage: 'new' }), guest('quoted', { stage: 'quoted' }), guest('booked'),
      guest('ai', { ai_takeover_since: ago(5) }), guest('dnc', { do_not_contact: true }), guest('closed', { stage: 'paid' }), guest('nobody', { primary_email: null, primary_phone: null }),
      guest('other', { client_id: OTHER }),
    ],
    contact_touchpoints: [
      touch('warm', {}), touch('warm', { source: 'mailchimp', direction: 'inbound', occurred_at: ago(3), metadata: { email_opened: true, email_campaign_id: 'bf1' } }),
      touch('cold', {}),
      touch('wait', {}), touch('wait', { direction: 'inbound', occurred_at: ago(2) }),
      touch('lead', { channel: 'meta_lead_form', source: 'meta_lead_form', direction: 'inbound', occurred_at: ago(3) }),
      touch('quoted', {}), touch('booked', {}), touch('ai', {}), touch('dnc', {}), touch('closed', {}),
      touch('nobody', { channel: 'messenger', source: 'messenger', direction: 'inbound' }),
      touch('other', { client_id: OTHER }),
    ],
    client_pipeline_stages: [
      { client_id: CLIENT, stage_key: 'new', marketing_action: 'nurture', is_terminal: false },
      { client_id: CLIENT, stage_key: 'contacted', marketing_action: 'nurture', is_terminal: false },
      { client_id: CLIENT, stage_key: 'quoted', marketing_action: 'nurture', is_terminal: false },
      { client_id: CLIENT, stage_key: 'paid', marketing_action: 'won', is_terminal: true },
    ],
    crm_bookings: [{ id: 'b1', client_id: CLIENT, contact_id: 'booked', status: 'active', created_at: ago(2) }],
    contact_identities: [{ id: 'i1', client_id: CLIENT, contact_id: 'warm', kind: 'email', value: 'warm@x.co' }],
    ad_strategy_configs: [{ client_id: CLIENT, qualified_stage_keys: ['quoted', 'paid'] }],
    clients: [{ id: CLIENT, leads_config: {} }],
    contact_stage_events: [{ id: 's1', client_id: CLIENT, contact_id: 'quoted', from_stage: 'contacted', to_stage: 'quoted', created_at: ago(1) }],
    contact_automation_events: [{ id: 'e1', client_id: CLIENT, contact_id: 'ai', kind: 'ai_takeover_on', created_at: ago(5) }],
  }
}

describe('loadFollowupProgress against the database client', () => {
  it('sorts the whole book: one guest per group, another client\'s guest never counted', async () => {
    const p = await loadFollowupProgress(db(tables(), []), CLIENT, NOW)
    const group = (id: string) => { const v = p.verdicts.get(id); return v?.inScope ? v.group : v?.why }
    expect({ warm: group('warm'), cold: group('cold'), wait: group('wait'), lead: group('lead'), quoted: group('quoted'), booked: group('booked'), ai: group('ai'), dnc: group('dnc'), closed: group('closed'), nobody: group('nobody') })
      .toEqual({ warm: 'warm', cold: 'cold', wait: 'awaiting_reply', lead: 'new_lead', quoted: 'qualified', booked: 'booked', ai: 'ai', dnc: 'do_not_contact', closed: 'closed_stage', nobody: 'no_contact_details' })
    expect(p.verdicts.has('other')).toBe(false)
    expect(p.counts.total).toBe(10)
    expect(p.week).toMatchObject({ newEnquiries: 1, guestsWhoReplied: 1, movedToQualified: 1, newBookings: 1, takenByAi: 1 })
    expect(p.dates.get('warm')).toMatchObject({ lastStaffAt: ago(40), lastEngagedAt: ago(3), bulkLast7Days: 1 })
  })

  it('writes nothing', async () => {
    const writes: string[] = []
    await loadFollowupProgress(db(tables(), writes), CLIENT, NOW)
    await loadFollowupProgress(db(tables(), writes), CLIENT, NOW, DEFAULT_GROUP_CONFIG, 'warm')
    expect(writes).toEqual([])
  })

  it('reading one guest gives that guest exactly the verdict and dates of the whole-book read (what the release re-check relies on)', async () => {
    const whole = await loadFollowupProgress(db(tables(), []), CLIENT, NOW)
    for (const id of whole.verdicts.keys()) {
      const one = await loadFollowupProgress(db(tables(), []), CLIENT, NOW, DEFAULT_GROUP_CONFIG, id)
      expect([...one.verdicts.keys()], id).toEqual([id])
      expect(one.verdicts.get(id), id).toEqual(whole.verdicts.get(id))
      expect(one.dates.get(id), id).toEqual(whole.dates.get(id))
    }
  })

  it('a guest of another client cannot be read through this client\'s id', async () => {
    const one = await loadFollowupProgress(db(tables(), []), CLIENT, NOW, DEFAULT_GROUP_CONFIG, 'other')
    expect(one.verdicts.size).toBe(0)
  })
})
