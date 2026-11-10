import type { KernelDeps } from '@/lib/kernel/deps'
import type { ActionRun } from '@/lib/kernel/types'
import { KernelError } from '@/lib/kernel/errors'
import { rejectRun } from '@/lib/kernel/human-approval'
import type { CardLifetime } from './view'

const SYSTEM = '系统'
export const EXPIRED_REASON = '过了 30 分钟没人点，这张卡作废了'
export const NZ_DAY_EXPIRED_REASON = '过了当天新西兰时间 23:59，这张卡作废了'

export function expiredReason(lifetime: CardLifetime): string {
  return lifetime === 'nz_day' ? NZ_DAY_EXPIRED_REASON : EXPIRED_REASON
}
export const VOID_REASON = '要确认的内容变了，这张旧卡作废'
export const STOPPED_PACK_REASON = '整包已停，这张还没点的卡作废'

async function rejectPending(deps: KernelDeps, run: ActionRun, reason: string): Promise<void> {
  if (run.status !== 'pending_approval' || !run.authorization_decision_id) return
  try {
    await rejectRun(deps, run.id, SYSTEM, reason, {
      expectedDecisionId: run.authorization_decision_id,
    })
  } catch (error) {
    if (error instanceof KernelError && (error.code === 'INVALID_STATE' || error.code === 'STALE_DECISION')) {
      return
    }
    throw error
  }
}

export async function settleExpired(
  deps: KernelDeps,
  run: ActionRun,
  lifetime: CardLifetime = 'urgent_30m',
): Promise<void> {
  await rejectPending(deps, run, expiredReason(lifetime))
}

export async function voidStaleCard(deps: KernelDeps, run: ActionRun): Promise<void> {
  await rejectPending(deps, run, VOID_REASON)
}

export async function voidStoppedPackCard(deps: KernelDeps, run: ActionRun): Promise<void> {
  await rejectPending(deps, run, STOPPED_PACK_REASON)
}
