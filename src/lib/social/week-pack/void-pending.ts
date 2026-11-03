/**
 * Stop must cancel unclicked cards for this client and week.
 * A card left pending can still be confirmed from an old page.
 */

import { listPendingCards } from '@/lib/confirmation-card/records'
import { voidStoppedPackCard } from '@/lib/confirmation-card/settle'
import { readStoredCard } from '@/lib/confirmation-card/view'
import type { KernelDeps } from '@/lib/kernel/deps'

export async function voidPendingWeekPackCards(
  deps: KernelDeps,
  clientId: string,
  subjectKey: string,
): Promise<'voided' | 'failed'> {
  try {
    const pending = await listPendingCards(deps.supabase, clientId)
    for (const run of pending) {
      if (readStoredCard(run.input)?.subjectKey !== subjectKey) continue
      await voidStoppedPackCard(deps, run)
    }
    return 'voided'
  } catch {
    return 'failed'
  }
}
