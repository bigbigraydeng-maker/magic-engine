import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existing: [] as unknown[],
  readError: null as null | { message: string },
  insertError: null as null | { message: string },
  insertedId: 'lead-event-1',
  insert: vi.fn(),
  contains: vi.fn(),
  send: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = vi.fn(() => chain)
      chain.contains = vi.fn((...args: unknown[]) => {
        mocks.contains(...args)
        return chain
      })
      chain.limit = vi.fn(async () => ({ data: mocks.existing, error: mocks.readError }))
      chain.insert = vi.fn((row: unknown) => {
        mocks.insert(row)
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => (mocks.insertError ? { data: null, error: mocks.insertError } : { data: { id: mocks.insertedId }, error: null })),
          })),
        }
      })
      return chain
    },
  },
}))
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: mocks.send } }))
vi.mock('@/lib/inngest/functions/tools-lab-lead-followup', () => ({ TOOLS_LAB_LEAD_CAPTURED_EVENT: 'tools_lab/lead.captured' }))

import { recordToolLead } from '../lead-events'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.existing = []
  mocks.readError = null
  mocks.insertError = null
  mocks.send.mockResolvedValue(undefined)
})

describe('recordToolLead', () => {
  it('writes one tool_signup row with the required columns, keyed by the caller-chosen dedupe key', async () => {
    await recordToolLead({ tool: 'ads-check', pagePath: '/meta-ads-ai/mine', targetHref: '/meta-ads-ai/mine', dedupeKey: { client_id: 'c-1' } })
    expect(mocks.insert).toHaveBeenCalledWith({
      page_path: '/meta-ads-ai/mine', cta_key: 'tool_signup', destination: 'ads-check',
      target_href: '/meta-ads-ai/mine', source: 'tools_lab', metadata: { client_id: 'c-1' },
    })
  })

  it('extraMetadata and email are stored alongside the dedupe key (email is how a human follows up) but neither is required for the duplicate check', async () => {
    await recordToolLead({
      tool: 'site-check', pagePath: '/cn/discover', targetHref: '/cn/discover',
      dedupeKey: { lead_id: 'lead-1' }, extraMetadata: { url: 'https://acme.com/' }, email: 'a@b.com',
    })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { lead_id: 'lead-1', url: 'https://acme.com/', email: 'a@b.com' },
    }))
  })

  it('no email (ads-check) → metadata has no email field at all, not an empty one', async () => {
    await recordToolLead({ tool: 'ads-check', pagePath: '/x', targetHref: '/x', dedupeKey: { client_id: 'c-1' } })
    const row = mocks.insert.mock.calls[0][0] as { metadata: Record<string, unknown> }
    expect('email' in row.metadata).toBe(false)
  })

  it('does nothing when this dedupe key was already recorded', async () => {
    mocks.existing = [{ id: 'x' }]
    await recordToolLead({ tool: 'ads-check', pagePath: '/x', targetHref: '/x', dedupeKey: { client_id: 'c-1' } })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('the duplicate check filters by THIS lead\'s own dedupe key, not an unfiltered read of the whole table', async () => {
    await recordToolLead({ tool: 'site-check', pagePath: '/cn/discover', targetHref: '/cn/discover', dedupeKey: { lead_id: 'lead-42' } })
    expect(mocks.contains).toHaveBeenCalledWith('metadata', { lead_id: 'lead-42' })
  })

  it('does not write when the duplicate check itself fails (never double-counts)', async () => {
    mocks.readError = { message: 'down' }
    await recordToolLead({ tool: 'ads-check', pagePath: '/x', targetHref: '/x', dedupeKey: { client_id: 'c-1' } })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('a failed write never throws into the caller\'s own flow', async () => {
    mocks.insertError = { message: 'down' }
    await expect(recordToolLead({ tool: 'ads-check', pagePath: '/x', targetHref: '/x', dedupeKey: { client_id: 'c-1' } })).resolves.toBeUndefined()
  })

  it('a successful new write emits tools_lab/lead.captured with the lead event id and email', async () => {
    await recordToolLead({ tool: 'site-check', pagePath: '/cn/discover', targetHref: '/cn/discover', dedupeKey: { lead_id: 'lead-1' }, email: 'a@b.com' })
    expect(mocks.send).toHaveBeenCalledWith({
      name: 'tools_lab/lead.captured',
      data: expect.objectContaining({ leadEventId: 'lead-event-1', tool: 'site-check', dedupeKey: { lead_id: 'lead-1' }, email: 'a@b.com' }),
    })
  })

  it('a lead with no email (ads-check) emits the event with email: null', async () => {
    await recordToolLead({ tool: 'ads-check', pagePath: '/x', targetHref: '/x', dedupeKey: { client_id: 'c-1' } })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: null }) }))
  })

  it('a failed insert never emits the event either (nothing was actually recorded) — reaches this via the explicit insert-error check, not the outer catch', async () => {
    mocks.insertError = { message: 'down' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await recordToolLead({ tool: 'ads-check', pagePath: '/x', targetHref: '/x', dedupeKey: { client_id: 'c-1' } })
    expect(mocks.send).not.toHaveBeenCalled()
    // Anchors on the specific failure reason ('down') so a mutation that instead falls through and
    // crashes on a null insert result (caught by the outer try/catch, reason would be a TypeError
    // message, not 'down') is caught, not silently mistaken for the same outcome.
    expect(warn).toHaveBeenCalledWith('[tools-lab] lead not recorded', { tool: 'ads-check', reason: 'down' })
    warn.mockRestore()
  })

  it('a duplicate never emits the event (only a genuinely new lead does)', async () => {
    mocks.existing = [{ id: 'x' }]
    await recordToolLead({ tool: 'ads-check', pagePath: '/x', targetHref: '/x', dedupeKey: { client_id: 'c-1' } })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('a failed emit never throws (the row is already durably written)', async () => {
    mocks.send.mockRejectedValueOnce(new Error('inngest down'))
    await expect(
      recordToolLead({ tool: 'ads-check', pagePath: '/x', targetHref: '/x', dedupeKey: { client_id: 'c-1' } }),
    ).resolves.toBeUndefined()
  })
})
