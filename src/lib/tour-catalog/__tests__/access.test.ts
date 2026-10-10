import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const memberLookup = vi.hoisted(() => ({
  rows: [] as Array<{ client_id: string; email: string }>,
  error: null as { message: string } | null,
  throws: false,
  calls: [] as Array<{ table: string; clientId: string; email: string }>,
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))

// Table-shaped fake: answers by filtering the rows, not by call order.
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from(table: string) {
      const filters: Record<string, string> = {}
      const builder = {
        select() {
          return builder
        },
        eq(column: string, value: string) {
          filters[column] = value
          return builder
        },
        async limit() {
          memberLookup.calls.push({ table, clientId: filters.client_id, email: filters.email })
          if (memberLookup.throws) throw new Error('network down')
          if (memberLookup.error) return { data: null, error: memberLookup.error }
          if (table !== 'tour_catalog_members') return { data: [], error: null }
          return {
            data: memberLookup.rows.filter(
              (row) => row.client_id === filters.client_id && row.email === filters.email,
            ),
            error: null,
          }
        },
      }
      return builder
    },
  },
}))

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import type { ClientAccessResult } from '@/lib/auth/client-access'
import type { AccessTier } from '@/lib/auth/access-types'
import { CAPABILITIES, permissionsFor, requireCatalogAccess } from '../access'
import type { CatalogCapability } from '../catalog-contract'

const dashboardAccess = vi.mocked(requireDashboardClientAccess)

const CLIENT = 'client-1'
const ALL_CAPABILITIES: CatalogCapability[] = [
  'view',
  'edit',
  'edit_site',
  'assistant',
  'request_publish',
  'import',
  'aliases',
  'seed',
  'publish',
  'manage_members',
  'manage_settings',
]
const EDITOR_ALLOWED: CatalogCapability[] = ['view', 'edit', 'assistant', 'request_publish']
const EDITOR_DENIED = ALL_CAPABILITIES.filter((c) => !EDITOR_ALLOWED.includes(c))

function session(
  email: string | undefined,
  role: 'admin' | 'client-viewer',
  tier: AccessTier,
  allowedClientId: string | null,
): ClientAccessResult {
  return { ok: true, user: { email } as never, role, tier, allowedClientId }
}

function addMember(email: string, clientId = CLIENT): void {
  memberLookup.rows.push({ client_id: clientId, email })
}

async function statusOf(capability: CatalogCapability, clientId = CLIENT): Promise<number> {
  const result = await requireCatalogAccess(clientId, capability)
  return result.ok ? 200 : result.response.status
}

beforeEach(() => {
  vi.clearAllMocks()
  memberLookup.rows = []
  memberLookup.error = null
  memberLookup.throws = false
  memberLookup.calls = []
  delete process.env.TOUR_CATALOG_LOCAL_TEST
  delete process.env.TOUR_CATALOG_LOCAL_ROLE
  delete process.env.TOUR_CATALOG_LOCAL_EMAIL
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('capability table', () => {
  it('gives a global admin everything', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(CAPABILITIES[capability].me_admin, capability).toBe(true)
    }
  })

  it('gives a client editor exactly view / edit / assistant / request_publish', () => {
    const allowed = ALL_CAPABILITIES.filter((c) => CAPABILITIES[c].client_editor)
    expect(allowed.sort()).toEqual([...EDITOR_ALLOWED].sort())
  })

  it('lists every capability and nothing else', () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual([...ALL_CAPABILITIES].sort())
    expect(Object.keys(permissionsFor('client_editor')).sort()).toEqual([...ALL_CAPABILITIES].sort())
  })

  it('permissionsFor mirrors the table', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(permissionsFor('me_admin')[capability]).toBe(true)
      expect(permissionsFor('client_editor')[capability]).toBe(EDITOR_ALLOWED.includes(capability))
    }
  })
})

describe('requireCatalogAccess — identity', () => {
  it('passes through a 401 when the caller is not logged in, without touching the member list', async () => {
    dashboardAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized', reason: 'unauthorized' })

    const result = await requireCatalogAccess(CLIENT, 'view')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.response.status).toBe(401)
    await expect(result.response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(memberLookup.calls).toHaveLength(0)
  })

  it('passes through a 403 and a 500 from the dashboard gate', async () => {
    dashboardAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden', reason: 'forbidden' })
    expect(await statusOf('view')).toBe(403)
    dashboardAccess.mockResolvedValue({ ok: false, status: 500, error: 'Authorization check failed', reason: 'lookup_failed' })
    expect(await statusOf('view')).toBe(500)
    expect(memberLookup.calls).toHaveLength(0)
  })

  it('rejects a session without an email with 403, even for an admin', async () => {
    for (const email of [undefined, '', '   ']) {
      dashboardAccess.mockResolvedValue(session(email, 'admin', 'admin', null))
      const result = await requireCatalogAccess(CLIENT, 'view')
      expect(result.ok, String(email)).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.response.status).toBe(403)
      await expect(result.response.json()).resolves.toEqual({ error: 'Forbidden' })
    }
    expect(memberLookup.calls).toHaveLength(0)
  })

  it('checks the dashboard gate for the requested client', async () => {
    dashboardAccess.mockResolvedValue(session('admin@example.com', 'admin', 'admin', null))
    await requireCatalogAccess('client-xyz', 'view')
    expect(dashboardAccess).toHaveBeenCalledWith('client-xyz')
  })
})

describe('requireCatalogAccess — global admin', () => {
  it('is me_admin and passes every capability without a member lookup', async () => {
    dashboardAccess.mockResolvedValue(session('admin@example.com', 'admin', 'admin', null))

    for (const capability of ALL_CAPABILITIES) {
      const result = await requireCatalogAccess(CLIENT, capability)
      expect(result, capability).toEqual({
        ok: true,
        actor: 'admin@example.com',
        viewer: { email: 'admin@example.com', role: 'me_admin' },
        permissions: permissionsFor('me_admin'),
      })
    }
    expect(memberLookup.calls).toHaveLength(0)
  })

  it('normalises the email (case and whitespace) into the actor', async () => {
    dashboardAccess.mockResolvedValue(session('  Admin@Example.COM ', 'admin', 'admin', null))
    const result = await requireCatalogAccess(CLIENT, 'publish')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.actor).toBe('admin@example.com')
    expect(result.viewer.email).toBe('admin@example.com')
  })
})

describe('requireCatalogAccess — client-restricted admin', () => {
  it('is refused when not on the member list', async () => {
    dashboardAccess.mockResolvedValue(session('demo@example.com', 'admin', 'admin', CLIENT))
    for (const capability of ALL_CAPABILITIES) {
      expect(await statusOf(capability), capability).toBe(403)
    }
  })

  it('is only a client_editor when on the member list', async () => {
    addMember('demo@example.com')
    dashboardAccess.mockResolvedValue(session('demo@example.com', 'admin', 'admin', CLIENT))

    const result = await requireCatalogAccess(CLIENT, 'edit')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.viewer.role).toBe('client_editor')
    expect(result.permissions).toEqual(permissionsFor('client_editor'))
    for (const capability of EDITOR_DENIED) {
      expect(await statusOf(capability), capability).toBe(403)
    }
  })
})

describe('requireCatalogAccess — client staff', () => {
  it('a paid member on the list is a client_editor: four capabilities pass', async () => {
    addMember('staff@example.com')
    dashboardAccess.mockResolvedValue(session('staff@example.com', 'client-viewer', 'paid_client', CLIENT))

    for (const capability of EDITOR_ALLOWED) {
      const result = await requireCatalogAccess(CLIENT, capability)
      expect(result, capability).toEqual({
        ok: true,
        actor: 'staff@example.com',
        viewer: { email: 'staff@example.com', role: 'client_editor' },
        permissions: permissionsFor('client_editor'),
      })
    }
  })

  it.each(EDITOR_DENIED)('a paid member on the list is refused %s with a plain 403', async (capability) => {
    addMember('staff@example.com')
    dashboardAccess.mockResolvedValue(session('staff@example.com', 'client-viewer', 'paid_client', CLIENT))

    const result = await requireCatalogAccess(CLIENT, capability)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.response.status).toBe(403)
    await expect(result.response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('a paid member who is not on the list is refused everything', async () => {
    addMember('someone-else@example.com')
    dashboardAccess.mockResolvedValue(session('staff@example.com', 'client-viewer', 'paid_client', CLIENT))
    for (const capability of ALL_CAPABILITIES) {
      expect(await statusOf(capability), capability).toBe(403)
    }
  })

  it('being on another client\'s list does not count', async () => {
    addMember('staff@example.com', 'client-2')
    dashboardAccess.mockResolvedValue(session('staff@example.com', 'client-viewer', 'paid_client', CLIENT))
    expect(await statusOf('view')).toBe(403)
    expect(memberLookup.calls).toEqual([
      { table: 'tour_catalog_members', clientId: CLIENT, email: 'staff@example.com' },
    ])
  })

  it.each(['self_serve', 'portal_only'] as const)(
    '%s is refused even when on the list, without a member lookup',
    async (tier) => {
      addMember('staff@example.com')
      dashboardAccess.mockResolvedValue(session('staff@example.com', 'client-viewer', tier, CLIENT))
      for (const capability of ALL_CAPABILITIES) {
        expect(await statusOf(capability), capability).toBe(403)
      }
      expect(memberLookup.calls).toHaveLength(0)
    },
  )

  it('looks the member up by lower-cased, trimmed email', async () => {
    addMember('staff@example.com')
    dashboardAccess.mockResolvedValue(session(' Staff@Example.com  ', 'client-viewer', 'paid_client', CLIENT))

    const result = await requireCatalogAccess(CLIENT, 'edit')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.actor).toBe('staff@example.com')
    expect(memberLookup.calls[0]).toEqual({
      table: 'tour_catalog_members',
      clientId: CLIENT,
      email: 'staff@example.com',
    })
  })

  it('a failed member lookup is a 500, never a pass', async () => {
    addMember('staff@example.com')
    memberLookup.error = { message: 'relation "tour_catalog_members" does not exist' }
    dashboardAccess.mockResolvedValue(session('staff@example.com', 'client-viewer', 'paid_client', CLIENT))

    const result = await requireCatalogAccess(CLIENT, 'view')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.response.status).toBe(500)
    const body = (await result.response.json()) as { error: string }
    expect(body.error).not.toContain('tour_catalog_members')
  })

  it('a member lookup that throws is a 500, never a pass', async () => {
    addMember('staff@example.com')
    memberLookup.throws = true
    dashboardAccess.mockResolvedValue(session('staff@example.com', 'client-viewer', 'paid_client', CLIENT))
    expect(await statusOf('view')).toBe(500)
  })
})

// Guard rail: no environment variable may ever switch the gate off. A local-only bypass that
// gets committed by mistake turns this red in CI (design §6.8.1 item 10).
describe('requireCatalogAccess ignores local-test environment flags', () => {
  it('still rejects logged-out and unlisted callers when TOUR_CATALOG_LOCAL_TEST=1 (with or without ROLE / EMAIL)', async () => {
    const variants: Array<{ role?: string; email?: string }> = [
      {},
      { role: 'editor', email: 'local-editor@test.local' },
      { role: 'admin', email: 'someone@test.local' },
    ]
    for (const env of variants) {
      process.env.TOUR_CATALOG_LOCAL_TEST = '1'
      delete process.env.TOUR_CATALOG_LOCAL_ROLE
      delete process.env.TOUR_CATALOG_LOCAL_EMAIL
      if (env.role !== undefined) process.env.TOUR_CATALOG_LOCAL_ROLE = env.role
      if (env.email !== undefined) process.env.TOUR_CATALOG_LOCAL_EMAIL = env.email

      dashboardAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized', reason: 'unauthorized' })
      expect(await statusOf('view'), JSON.stringify(env)).toBe(401)

      dashboardAccess.mockResolvedValue(session('viewer@example.com', 'client-viewer', 'paid_client', CLIENT))
      expect(await statusOf('view'), JSON.stringify(env)).toBe(403)
      expect(await statusOf('publish'), JSON.stringify(env)).toBe(403)
    }
  })
})
