/** The person on the card is the logged-in user, never a field from the request. */

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const confirmWinnerCard = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ card: null, resultLine: 'ok', wroteMeta: false })))

vi.mock('../winner-reel-execute', () => ({
  confirmWinnerCard,
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: async () => ({
    ok: true,
    user: { id: 'session-user' },
    role: 'admin',
    tier: 'paid_client',
    allowedClientId: null,
  }),
}))

import { confirmWinnerFromSession } from '../winner-reel-confirm'

describe('winner session', () => {
  it('derives the person from the confirming session', async () => {
    await confirmWinnerFromSession({} as SupabaseClient, {
      clientId: 'client-1',
      runId: 'run-1',
      decisionId: '11111111-1111-1111-1111-111111111111',
      fingerprint: 'a'.repeat(64),
      choice: 'confirm',
      clicker: { kind: 'opc', email: 'ray@example.com' },
    })
    const sent = confirmWinnerCard.mock.calls[0]?.[1] as { actor: { triggeredBy: string; triggeredByRef: string } } | undefined
    expect(sent?.actor).toEqual({ triggeredBy: 'human', triggeredByRef: 'session-user' })
  })
})
