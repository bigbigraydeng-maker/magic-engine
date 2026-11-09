/**
 * The only budget write used by a confirmed money card.
 * Cuts reuse the stop-loss kernel submit. A raise of a live plan is refused.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import { refuseLivePlanIncrease } from '@/lib/ads-strategy/live-plan-budget'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { submitStopLossThroughKernel } from './stop-loss'
import type { MoneyHold, MoneyWriteResult } from './money-card'

const NO_WRITE: MoneyWriteResult = { wroteMeta: false, readbackCents: null, reason: '这次没有改。' }

export async function writeHeldBudget(kernel: KernelDeps, clientId: string, hold: MoneyHold): Promise<MoneyWriteResult> {
  return hold.raising ? refuseLivePlanIncrease() : writeCut(kernel, clientId, hold)
}

async function writeCut(kernel: KernelDeps, clientId: string, hold: MoneyHold): Promise<MoneyWriteResult> {
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok || access.role !== 'admin' || !hold.cycleDate || !hold.requestId) return NO_WRITE
  const campaignId = hold.level === 'campaign' ? hold.entityId : hold.campaignId
  if (!campaignId) return NO_WRITE
  const submitted = await submitStopLossThroughKernel(kernel, {
    clientId,
    access,
    ...(hold.goalId ? { goalId: hold.goalId } : {}),
    campaignId,
    adAccountId: hold.adAccountId,
    requestId: hold.requestId,
    cycleDate: hold.cycleDate,
    action: hold.level === 'campaign' ? 'cut_campaign' : 'cut_unit',
    targets: [{ id: hold.entityId, name: hold.name ?? hold.entityId, currentCents: hold.beforeCents, afterCents: hold.afterCents }],
  })
  const run = submitted.runs[0]
  const wrote = run?.kind === 'succeeded' || run?.kind === 'idempotent_hit'
  return { wroteMeta: wrote, readbackCents: wrote ? hold.afterCents : null, reason: run?.humanReason ?? (wrote ? '已改。' : '没有改成。') }
}
