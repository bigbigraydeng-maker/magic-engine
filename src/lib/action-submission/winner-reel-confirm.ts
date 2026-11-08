/** The confirming session is the only place a winner card may say a person pressed it. */

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { CardClicker } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { confirmWinnerCard, type WinnerPorts, type WinnerResult } from './winner-reel-execute'

export async function confirmWinnerFromSession(
  sb: KernelDeps['supabase'],
  input: {
    clientId: string
    runId: string
    decisionId: string
    fingerprint: string
    choice: 'confirm' | 'decline'
    clicker: CardClicker
  },
  ports?: WinnerPorts,
): Promise<WinnerResult> {
  const access = await requirePaidClientAccess(input.clientId)
  if (!access.ok || !access.user.id) {
    throw new ConfirmationCardError('forbidden', '请先登录后再确认。')
  }
  const actor = { triggeredBy: 'human' as const, triggeredByRef: access.user.id }
  return confirmWinnerCard(sb, { ...input, actor }, ports)
}
