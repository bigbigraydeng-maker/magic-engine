import { afterEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { gateFake } from './gate-test-kit'
import { identityFromSlug, ProtectedPageError } from '../protected-pages'

const holder: { fake: ReturnType<typeof gateFake> } = { fake: gateFake({}) }
vi.mock('@/lib/supabase', () => ({
  get supabaseAdmin() { return holder.fake.client },
}))

import { buildRouteGuard, protectedPageResponse } from '../protected-pages-route'

const user = (email: string, confirmed = true) => ({ email, email_confirmed_at: confirmed ? '2026-01-01T00:00:00Z' : undefined }) as User

afterEach(() => { vi.unstubAllEnvs() })

describe('buildRouteGuard — who is acting', () => {
  it('🔴 a normal logged-in user cannot touch a protected page, and a denial receipt is written', async () => {
    vi.stubEnv('PROTECTED_PAGE_OVERRIDE_EMAILS', 'pm@example.com')
    holder.fake = gateFake({ meta_cycle_protected_slugs: ['about'] })
    await expect(buildRouteGuard(user('fde@example.com'), 'c1', 'r').assert(identityFromSlug('about'))).rejects.toBeInstanceOf(ProtectedPageError)
    expect(holder.fake.receipts[0]?.summary).toMatchObject({ decision: 'denied_not_pm', route: 'r' })
  })

  it('the listed owner (case/space-insensitive, verified email) can, and the override is receipted', async () => {
    vi.stubEnv('PROTECTED_PAGE_OVERRIDE_EMAILS', ' PM@Example.com ')
    holder.fake = gateFake({ meta_cycle_protected_slugs: ['about'] })
    await expect(buildRouteGuard(user('pm@example.com'), 'c1', 'r').assert(identityFromSlug('about'))).resolves.toBeUndefined()
    expect(holder.fake.receipts[0]?.summary).toMatchObject({ decision: 'allowed_pm_override' })
  })

  it('🔴 an UNVERIFIED email on the owner list is not the owner', async () => {
    vi.stubEnv('PROTECTED_PAGE_OVERRIDE_EMAILS', 'pm@example.com')
    holder.fake = gateFake({ meta_cycle_protected_slugs: ['about'] })
    await expect(buildRouteGuard(user('pm@example.com', false), 'c1', 'r').assert(identityFromSlug('about'))).rejects.toBeInstanceOf(ProtectedPageError)
  })

  it('🔴 variable not set => nobody can override (fail-closed)', async () => {
    vi.stubEnv('PROTECTED_PAGE_OVERRIDE_EMAILS', '')
    holder.fake = gateFake({ meta_cycle_protected_slugs: ['about'] })
    await expect(buildRouteGuard(user('pm@example.com'), 'c1', 'r').assert(identityFromSlug('about'))).rejects.toBeInstanceOf(ProtectedPageError)
  })
})

describe('protectedPageResponse', () => {
  it('maps a gate refusal to 403 PROTECTED_PAGE and ignores every other error', async () => {
    const res = protectedPageResponse(new ProtectedPageError('unknown', 'x'))
    expect(res?.status).toBe(403)
    expect(await res?.json()).toMatchObject({ code: 'PROTECTED_PAGE' })
    expect(await protectedPageResponse(new ProtectedPageError('protected', 'x'))?.json()).not.toHaveProperty('decision') // no probing which pages are listed
    expect(protectedPageResponse(new Error('boom'))).toBeNull()
  })
})
