import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  createKernel: vi.fn(() => ({ name: 'kernel' })),
  issueConfirmationCard: vi.fn(),
  decideConfirmationCard: vi.fn(),
  listConfirmationCards: vi.fn(),
  applyConfirmationDecision: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.requirePaidClientAccess,
}))
vi.mock('@/lib/kernel', () => ({ createKernel: mocks.createKernel }))
vi.mock('@/lib/marketing-plan/plan-card-decision', () => ({
  applyConfirmationDecision: mocks.applyConfirmationDecision,
}))
vi.mock('@/lib/confirmation-card', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/confirmation-card')>()
  return {
    ...actual,
    issueConfirmationCard: mocks.issueConfirmationCard,
    decideConfirmationCard: mocks.decideConfirmationCard,
    listConfirmationCards: mocks.listConfirmationCards,
  }
})

import { GET, POST } from '../route'
import { POST as decidePOST } from '../[runId]/decision/route'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'
const RUN = '40000000-0000-4000-8000-000000001111'
const DECISION = 'dec00000-0000-4000-8000-000000000001'
const FINGERPRINT = 'a'.repeat(64)

function access(role: 'admin' | 'client-viewer', allowedClientId: string | null) {
  return {
    ok: true as const,
    user: { email: role === 'admin' ? 'opc@example.com' : 'staff@example.com' },
    role,
    tier: role === 'admin' ? 'admin' as const : 'paid_client' as const,
    allowedClientId,
  }
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('confirmation card routes', () => {
  it('does not let client staff or an agent click', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue(access('client-viewer', CLIENT))
    const staff = await decidePOST(
      post(`http://localhost/api/clients/${CLIENT}/confirmation-cards/${RUN}/decision`, {
        resolution: 'confirm',
        expectedDecisionId: DECISION,
        fingerprint: FINGERPRINT,
      }),
      { params: { id: CLIENT, runId: RUN } },
    )
    expect(staff.status).toBe(403)
    expect(mocks.applyConfirmationDecision).not.toHaveBeenCalled()

    mocks.requirePaidClientAccess.mockResolvedValue(access('admin', null))
    const agent = await decidePOST(
      post(`http://localhost/api/clients/${CLIENT}/confirmation-cards/${RUN}/decision`, {
        resolution: 'confirm',
        expectedDecisionId: DECISION,
        fingerprint: FINGERPRINT,
      }, { 'x-me-actor': 'agent' }),
      { params: { id: CLIENT, runId: RUN } },
    )
    expect(agent.status).toBe(403)
    expect(mocks.applyConfirmationDecision).not.toHaveBeenCalled()
  })

  it('lets this client\'s FDE confirm, and not as an agent', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue({
      ok: true as const,
      user: { email: 'fde@example.com' },
      role: 'admin' as const,
      tier: 'admin' as const,
      allowedClientId: CLIENT,
    })
    mocks.applyConfirmationDecision.mockResolvedValue({ status: 'declined' })
    const res = await decidePOST(
      post(`http://localhost/api/clients/${CLIENT}/confirmation-cards/${RUN}/decision`, {
        resolution: 'decline',
        expectedDecisionId: DECISION,
        fingerprint: FINGERPRINT,
      }),
      { params: { id: CLIENT, runId: RUN } },
    )
    expect(res.status).toBe(200)
    expect(mocks.applyConfirmationDecision).toHaveBeenCalledWith(
      { name: 'kernel' },
      expect.objectContaining({
        resolution: 'decline',
        clicker: { kind: 'fde', email: 'fde@example.com', clientId: CLIENT },
      }),
    )
  })

  it('lets OPC post a confirm, including who approved', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue(access('admin', null))
    mocks.applyConfirmationDecision.mockResolvedValue({ status: 'confirmed', what: '记下' })
    const res = await decidePOST(
      post(`http://localhost/api/clients/${CLIENT}/confirmation-cards/${RUN}/decision`, {
        resolution: 'confirm',
        expectedDecisionId: DECISION,
        fingerprint: FINGERPRINT,
      }),
      { params: { id: CLIENT, runId: RUN } },
    )
    expect(res.status).toBe(200)
    expect(mocks.applyConfirmationDecision).toHaveBeenCalledWith(
      { name: 'kernel' },
      expect.objectContaining({
        resolution: 'confirm',
        approvedBy: 'opc@example.com',
        clicker: { kind: 'opc', email: 'opc@example.com' },
      }),
    )
  })

  it('refuses extra fields and chat words before any write', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue(access('admin', null))
    const extra = await decidePOST(
      post(`http://localhost/api/clients/${CLIENT}/confirmation-cards/${RUN}/decision`, {
        resolution: 'confirm',
        expectedDecisionId: DECISION,
        fingerprint: FINGERPRINT,
        launch: true,
      }),
      { params: { id: CLIENT, runId: RUN } },
    )
    expect(extra.status).toBe(400)
    const chat = await POST(
      post(`http://localhost/api/clients/${CLIENT}/confirmation-cards`, { resolution: '可以' }),
      { params: { id: CLIENT } },
    )
    expect(chat.status).toBe(400)
    expect(mocks.applyConfirmationDecision).not.toHaveBeenCalled()
    expect(mocks.issueConfirmationCard).not.toHaveBeenCalled()
  })

  it('lets staff see the list, with their clicker marked as staff', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue(access('client-viewer', CLIENT))
    mocks.listConfirmationCards.mockResolvedValue([])
    const res = await GET(
      new Request(`http://localhost/api/clients/${CLIENT}/confirmation-cards`),
      { params: { id: CLIENT } },
    )
    expect(res.status).toBe(200)
    expect(mocks.listConfirmationCards).toHaveBeenCalledWith(
      { name: 'kernel' },
      CLIENT,
      { kind: 'client_staff', email: 'staff@example.com' },
    )
  })
})
