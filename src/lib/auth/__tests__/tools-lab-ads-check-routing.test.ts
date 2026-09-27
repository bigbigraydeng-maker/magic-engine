import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), record: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/tools-lab/lead-events', () => ({ recordToolSignupOnce: mocks.record }))

import { ADS_CHECK_ENTRY, normalizeSelfServeTarget, resolveSelfServeLanding } from '../self-serve-routing'

const CLIENT = '11111111-1111-1111-1111-111111111111'

function onboarding(done: boolean) {
  mocks.from.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { onboarding_completed_at: done ? '2026-09-01T00:00:00Z' : null } }),
  })
}

beforeEach(() => { vi.clearAllMocks(); mocks.record.mockResolvedValue(undefined) })

describe('Tools Lab ad check-up entry', () => {
  it('the identity-free entry is rewritten to the caller\'s own check-up page', () => {
    expect(ADS_CHECK_ENTRY).toBe('/meta-ads-ai/mine')
    expect(normalizeSelfServeTarget(CLIENT, ADS_CHECK_ENTRY)).toBe(`/meta-ads-ai/${CLIENT}`)
  })

  it('another client\'s check-up page still falls back to the caller\'s home', () => {
    expect(normalizeSelfServeTarget(CLIENT, '/meta-ads-ai/22222222-2222-2222-2222-222222222222')).toBe(`/dashboard/clients/${CLIENT}`)
  })

  it('arriving through the entry skips the onboarding wizard and records the lead once', async () => {
    onboarding(false)
    await expect(resolveSelfServeLanding(CLIENT, ADS_CHECK_ENTRY, true)).resolves.toBe(`/meta-ads-ai/${CLIENT}`)
    expect(mocks.record).toHaveBeenCalledWith(CLIENT, 'ads-check')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('a returning customer coming back through the entry (not a first sign-in) is not counted again', async () => {
    onboarding(true)
    await expect(resolveSelfServeLanding(CLIENT, ADS_CHECK_ENTRY, false)).resolves.toBe(`/meta-ads-ai/${CLIENT}`)
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('an explicit own check-up link also skips the wizard but is not counted as a Tools Lab lead', async () => {
    onboarding(false)
    await expect(resolveSelfServeLanding(CLIENT, `/meta-ads-ai/${CLIENT}`, false)).resolves.toBe(`/meta-ads-ai/${CLIENT}`)
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('every other destination keeps the wizard gate unchanged', async () => {
    onboarding(false)
    await expect(resolveSelfServeLanding(CLIENT, `/dashboard/clients/${CLIENT}`, true)).resolves.toBe(`/dashboard/clients/${CLIENT}/onboarding?welcome=1`)
    expect(mocks.record).not.toHaveBeenCalled()
  })
})
