import type { KernelDeps } from '@/lib/kernel/deps'
import { KernelError } from '@/lib/kernel/errors'
import { approveRun, rejectRun } from '@/lib/kernel/human-approval'
import type { CardClicker, ClickGrant } from './actor'
import { assertMayClick } from './actor'
import { confirmBlockReason } from './facts'
import { notesFor } from './records'
import { ConfirmationCardError } from './errors'
import { settleExpired } from './settle'
import { isExpired, presentCard, readStoredCard, type ConfirmationCardView } from './view'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'

export type CardResolution = 'confirm' | 'decline'

function sameCard(runClient: string, actionKey: string, clientId: string): boolean {
  return runClient === clientId && actionKey === CONFIRMATION_ACTION_KEY
}

async function presentSettled(
  deps: KernelDeps,
  runId: string,
  clicker: CardClicker,
  now: Date,
): Promise<ConfirmationCardView> {
  const run = await deps.requireRun(runId)
  const decisionId = run.authorization_decision_id
  if (!decisionId) throw new ConfirmationCardError('invalid', '这张卡没有审批编号。')
  const notes = await notesFor(deps.supabase, [decisionId])
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

async function closedMessage(deps: KernelDeps, decisionId: string | null): Promise<string> {
  if (!decisionId) return '这张卡已经有结果了，不能再点。'
  const notes = await notesFor(deps.supabase, [decisionId])
  const reason = notes.get(decisionId)?.reason ?? ''
  if (reason.includes('整包已停')) return '这张卡已经作废，不能再用来发布。'
  return '这张卡已经有结果了，不能再点。'
}

function assertFingerprint(stored: string, given: string): void {
  if (given !== stored) {
    throw new ConfirmationCardError('stale', '你看到的内容已经不是这一张卡了。请刷新后再点。')
  }
}

async function writeDecision(
  deps: KernelDeps,
  runId: string,
  grant: ClickGrant,
  resolution: CardResolution,
  expectedDecisionId: string,
): Promise<void> {
  const note = grant.role === 'OPC' ? 'OPC' : '这位客户的执行同事'
  if (resolution === 'decline') {
    await rejectRun(deps, runId, grant.email, `${note}不做`, { expectedDecisionId })
    return
  }
  await approveRun(deps, runId, grant.email, {
    expectedDecisionId,
    reason: `${note}确认`,
  })
}

export async function decideConfirmationCard(
  deps: KernelDeps,
  args: {
    clientId: string
    runId: string
    clicker: CardClicker
    resolution: CardResolution
    expectedDecisionId: string
    fingerprint: string
    now?: Date
  },
): Promise<ConfirmationCardView> {
  const now = args.now ?? deps.now()
  const grant = assertMayClick(args.clicker, args.clientId)
  const run = await deps.requireRun(args.runId)
  if (!sameCard(run.client_id, run.action_key, args.clientId)) {
    throw new ConfirmationCardError('not_found', '找不到这张确认卡。')
  }
  const stored = readStoredCard(run.input)
  if (!stored) throw new ConfirmationCardError('invalid', '这张卡的内容读不出来，没有点成。')
  assertFingerprint(stored.fingerprint, args.fingerprint)
  if (run.status === 'pending_approval' && isExpired(stored.issuedAt, now)) {
    await settleExpired(deps, run)
    return presentSettled(deps, run.id, args.clicker, now)
  }
  if (run.status !== 'pending_approval') {
    throw new ConfirmationCardError('not_waiting', await closedMessage(deps, run.authorization_decision_id))
  }
  if (args.resolution === 'confirm') {
    const block = confirmBlockReason(stored.hardChecks)
    if (block) throw new ConfirmationCardError('hard_check', block)
  }
  try {
    await writeDecision(deps, run.id, grant, args.resolution, args.expectedDecisionId)
  } catch (error) {
    if (error instanceof KernelError) throw new ConfirmationCardError('stale', error.humanReason)
    throw error
  }
  return presentSettled(deps, run.id, args.clicker, now)
}
