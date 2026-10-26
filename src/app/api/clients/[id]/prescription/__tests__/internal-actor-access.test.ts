/**
 * Knife 3 + 19: real session gates on the four prescription write routes.
 * OPC, this client's FDE, another client's FDE, a client employee, and no session.
 * Model and landing helpers are mocked so a passed gate cannot call them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const spies = vi.hoisted(() => ({
  runHuatuo: vi.fn(),
  refine: vi.fn(),
  land: vi.fn(),
  generate: vi.fn(),
  attach: vi.fn(async (content: unknown) => content),
}))

vi.mock('@/lib/auth/require-session', () => ({ requireSession: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/huatuo/agent', () => ({
  runHuatuo: (...args: unknown[]) => spies.runHuatuo(...args),
  refineHuatuoPrescription: (...args: unknown[]) => spies.refine(...args),
  coerceWeaknesses: () => [],
}))
vi.mock('@/lib/diagnostic/prescription-generator', () => ({
  generatePrescription: (...args: unknown[]) => spies.generate(...args),
}))
vi.mock('@/lib/diagnostic/prescription-landing', () => ({
  landPrescription: (...args: unknown[]) => spies.land(...args),
}))
vi.mock('@/lib/ads-strategy/plan-seed/attach', () => ({
  attachPlanSeed: (...args: unknown[]) => spies.attach(...args),
}))
vi.mock('@/lib/case-library/saver', () => ({
  savePrescriptionCase: vi.fn(),
  deriveCrisisType: vi.fn(),
}))
vi.mock('@/lib/memory', () => ({ loadMemoryForClient: vi.fn() }))

import { PATCH } from '../[pId]/route'
import { POST as generate } from '../generate/route'
import { POST as refine } from '../[pId]/refine/route'
import { POST as manual } from '../../prescriptions/manual/route'
import { requireSession } from '@/lib/auth/require-session'
import { supabaseAdmin } from '@/lib/supabase'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ENV_KEYS = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'CLIENT_VIEWERS', 'DEMO_ADMINS'] as const

type Who = 'opc' | 'ownFde' | 'otherFde' | 'employee' | 'anon'

const ACTORS: Who[] = ['opc', 'ownFde', 'otherFde', 'employee', 'anon']

const savedEnv: Record<string, string | undefined> = {}
let portalRows: Array<{ client_id: string; access_type: string; scoped_admin: boolean }> = []

const mockSession = vi.mocked(requireSession)
const mockFrom = vi.mocked(supabaseAdmin.from)

function setEnv(next: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) {
    if (next[key] === undefined) delete process.env[key]
    else process.env[key] = next[key]
  }
}

function signIn(email: string | null): void {
  if (!email) {
    mockSession.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    return
  }
  mockSession.mockResolvedValue({
    ok: true,
    user: { id: 'user-1', email },
  } as Awaited<ReturnType<typeof requireSession>>)
}

function arrange(who: Who): void {
  portalRows = []
  if (who === 'anon') {
    setEnv({})
    signIn(null)
    return
  }
  if (who === 'opc') {
    setEnv({ ADMIN_EMAILS: 'opc@magiclab.test' })
    signIn('opc@magiclab.test')
    return
  }
  if (who === 'ownFde') {
    setEnv({ DEMO_ADMINS: `fde-own@client.test:${CLIENT}` })
    signIn('fde-own@client.test')
    return
  }
  if (who === 'otherFde') {
    setEnv({ DEMO_ADMINS: `fde-other@client.test:${OTHER}` })
    signIn('fde-other@client.test')
    return
  }
  setEnv({})
  signIn('staff@client.test')
  portalRows = [{ client_id: CLIENT, access_type: 'client', scoped_admin: false }]
}

function fluent(result: { data: unknown; error: unknown | null }) {
  const builder: Record<string, unknown> = {}
  const self = () => builder
  for (const name of ['select', 'eq', 'order', 'limit']) builder[name] = self
  const done = async () => result
  builder.in = done
  builder.single = done
  builder.maybeSingle = done
  return builder
}

function request(url: string, method: string, body: string): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

function allowed(route: 'approve' | 'draft', who: Who): boolean {
  if (who === 'anon') return false
  if (route === 'approve') return who === 'opc'
  return who === 'opc' || who === 'ownFde'
}

function expectGate(route: 'approve' | 'draft', who: Who, status: number, passed: number): void {
  if (!allowed(route, who)) {
    expect(status).toBe(who === 'anon' ? 401 : 403)
    return
  }
  expect(status).toBe(passed)
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  mockFrom.mockImplementation((table: string) => {
    if (table === 'client_portal_users') {
      return fluent({ data: portalRows, error: null }) as ReturnType<typeof supabaseAdmin.from>
    }
    return fluent({ data: null, error: { message: 'missing' } }) as ReturnType<typeof supabaseAdmin.from>
  })
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('PATCH prescription approve/reject', () => {
  const params = { id: CLIENT, pId: 'presc-1' }

  for (const who of ACTORS) {
    it(`${who} hits the OPC-only gate`, async () => {
      arrange(who)
      const res = await PATCH(
        request(`http://test/api/clients/${CLIENT}/prescription/presc-1`, 'PATCH', '{"status":"nope"}'),
        { params },
      )
      expectGate('approve', who, res.status, 400)
      expect(spies.land).not.toHaveBeenCalled()
      expect(spies.runHuatuo).not.toHaveBeenCalled()
    })
  }
})

describe('POST prescription generate', () => {
  const params = { id: CLIENT }

  for (const who of ACTORS) {
    it(`${who} hits the drafter gate`, async () => {
      arrange(who)
      const res = await generate(
        request(`http://test/api/clients/${CLIENT}/prescription/generate`, 'POST', '{}'),
        { params },
      )
      expectGate('draft', who, res.status, 400)
      expect(spies.runHuatuo).not.toHaveBeenCalled()
      expect(spies.generate).not.toHaveBeenCalled()
    })
  }
})

describe('POST prescription refine', () => {
  const params = { id: CLIENT, pId: 'presc-1' }

  for (const who of ACTORS) {
    it(`${who} hits the drafter gate`, async () => {
      arrange(who)
      const res = await refine(
        request(`http://test/api/clients/${CLIENT}/prescription/presc-1/refine`, 'POST', '{}'),
        { params },
      )
      expectGate('draft', who, res.status, 404)
      expect(spies.refine).not.toHaveBeenCalled()
    })
  }
})

describe('POST prescriptions manual paste', () => {
  const params = { id: CLIENT }

  for (const who of ACTORS) {
    it(`${who} hits the drafter gate`, async () => {
      arrange(who)
      const res = await manual(
        request(`http://test/api/clients/${CLIENT}/prescriptions/manual`, 'POST', 'not-json'),
        { params },
      )
      expectGate('draft', who, res.status, 400)
      expect(spies.attach).not.toHaveBeenCalled()
      expect(spies.land).not.toHaveBeenCalled()
    })
  }
})
