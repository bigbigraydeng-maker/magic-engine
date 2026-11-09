import type { KernelDeps } from '@/lib/kernel/deps'
import type { ActionRun } from '@/lib/kernel/types'
import type { CardClicker } from './actor'
import { listPendingCards, listShownCards, notesFor, type DecisionNote } from './records'
import { settleExpired } from './settle'
import { isExpired, presentCard, readStoredCard, type ConfirmationCardView } from './view'

async function expirePending(deps: KernelDeps, clientId: string, now: Date): Promise<void> {
  const pending = await listPendingCards(deps.supabase, clientId)
  for (const run of pending) {
    const stored = readStoredCard(run.input)
    if (!stored || !isExpired(stored.issuedAt, now)) continue
    await settleExpired(deps, run)
  }
}

function viewOf(
  run: ActionRun,
  notes: Map<string, DecisionNote>,
  clicker: CardClicker,
  now: Date,
): ConfirmationCardView | null {
  const decisionId = run.authorization_decision_id
  if (!decisionId || !readStoredCard(run.input)) return null
  const note = notes.get(decisionId)
  return presentCard({
    run,
    decisionId,
    decisionReason: note?.reason ?? '',
    decidedBy: note?.decidedBy ?? null,
    clicker,
    now,
  })
}

export async function listConfirmationCards(
  deps: KernelDeps,
  clientId: string,
  clicker: CardClicker,
  now: Date = deps.now(),
): Promise<ConfirmationCardView[]> {
  await expirePending(deps, clientId, now)
  const runs = await listShownCards(deps.supabase, clientId)
  const ids = runs.map((run) => run.authorization_decision_id).filter((id): id is string => Boolean(id))
  const notes = await notesFor(deps.supabase, ids)
  const views: ConfirmationCardView[] = []
  for (const run of runs) {
    const view = viewOf(run, notes, clicker, now)
    if (view) views.push(view)
  }
  return views
}
