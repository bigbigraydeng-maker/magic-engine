import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MetaReadError } from '../../graph-read'

const mocks = vi.hoisted(() => ({
  requireOnboardingClientAccess: vi.fn(),
  requirePilotLifecycleAccess: vi.fn(),
  isSelfServeClient: vi.fn(),
  requirePilotActive: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireOnboardingClientAccess: mocks.requireOnboardingClientAccess,
}))

vi.mock('../entitlement', () => ({
  requirePilotLifecycleAccess: mocks.requirePilotLifecycleAccess,
  isSelfServeClient: mocks.isSelfServeClient,
  requirePilotActive: mocks.requirePilotActive,
}))

import { pilotDashboardAccess } from '../http'

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'

function accessFor(tier: string) {
  return {
    ok: true as const,
    user: { id: 'u', email: 'a@x.test' },
    role: 'client-viewer',
    tier,
    allowedClientId: CLIENT_ID,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pilotDashboardAccess', () => {
  it('resolves with the access object when lifecycle access succeeds, for any tier', async () => {
    const access = accessFor('paid_client')
    mocks.requireOnboardingClientAccess.mockResolvedValue(access)
    mocks.requirePilotLifecycleAccess.mockResolvedValue(undefined)

    await expect(pilotDashboardAccess(CLIENT_ID)).resolves.toEqual(access)
    expect(mocks.isSelfServeClient).not.toHaveBeenCalled()
  })

  it('resolves when lifecycle throws pilot_required, tier self_serve, and client is self-serve', async () => {
    const access = accessFor('self_serve')
    mocks.requireOnboardingClientAccess.mockResolvedValue(access)
    mocks.requirePilotLifecycleAccess.mockRejectedValue(new MetaReadError('pilot_required', 404))
    mocks.isSelfServeClient.mockResolvedValue(true)

    await expect(pilotDashboardAccess(CLIENT_ID)).resolves.toEqual(access)
    expect(mocks.isSelfServeClient).toHaveBeenCalledWith(CLIENT_ID)
  })

  it('rejects pilot_required when tier is paid_client', async () => {
    mocks.requireOnboardingClientAccess.mockResolvedValue(accessFor('paid_client'))
    mocks.requirePilotLifecycleAccess.mockRejectedValue(new MetaReadError('pilot_required', 404))
    mocks.isSelfServeClient.mockResolvedValue(true)

    await expect(pilotDashboardAccess(CLIENT_ID)).rejects.toMatchObject({ code: 'pilot_required' })
    expect(mocks.isSelfServeClient).not.toHaveBeenCalled()
  })

  it('rejects pilot_required when tier is admin', async () => {
    mocks.requireOnboardingClientAccess.mockResolvedValue(accessFor('admin'))
    mocks.requirePilotLifecycleAccess.mockRejectedValue(new MetaReadError('pilot_required', 404))
    mocks.isSelfServeClient.mockResolvedValue(true)

    await expect(pilotDashboardAccess(CLIENT_ID)).rejects.toMatchObject({ code: 'pilot_required' })
    expect(mocks.isSelfServeClient).not.toHaveBeenCalled()
  })

  it('rejects pilot_required when tier is self_serve but client is not self-serve', async () => {
    mocks.requireOnboardingClientAccess.mockResolvedValue(accessFor('self_serve'))
    mocks.requirePilotLifecycleAccess.mockRejectedValue(new MetaReadError('pilot_required', 404))
    mocks.isSelfServeClient.mockResolvedValue(false)

    await expect(pilotDashboardAccess(CLIENT_ID)).rejects.toMatchObject({ code: 'pilot_required' })
    expect(mocks.isSelfServeClient).toHaveBeenCalledWith(CLIENT_ID)
  })

  it('rejects authorization_unavailable even for self_serve (only pilot_required is relaxed)', async () => {
    mocks.requireOnboardingClientAccess.mockResolvedValue(accessFor('self_serve'))
    mocks.requirePilotLifecycleAccess.mockRejectedValue(new MetaReadError('authorization_unavailable', 503))
    mocks.isSelfServeClient.mockResolvedValue(true)

    await expect(pilotDashboardAccess(CLIENT_ID)).rejects.toMatchObject({ code: 'authorization_unavailable' })
    expect(mocks.isSelfServeClient).not.toHaveBeenCalled()
  })
})
