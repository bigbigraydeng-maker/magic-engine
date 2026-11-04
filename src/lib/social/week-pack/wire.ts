/**
 * Production ports. Story authorise / revoke are the existing story-lite functions.
 * Reel go-public calls the existing promote action only after promoteReelGated says yes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { CardClicker } from '@/lib/confirmation-card/actor'
import { decideConfirmationCard, issueConfirmationCard } from '@/lib/confirmation-card'
import type { KernelDeps } from '@/lib/kernel/deps'
import { authorizeLitePack, revokeLitePack, type LiteResult, type LiteServicePorts } from '@/lib/social/story-lite/service'
import type { LiteActor } from '@/lib/social/story-lite/types'

import { cadenceFromConfig, type WeeklyPackCadence } from './cadence'
import { storyAuthorizeLifetime } from './lifetime'
import type { WeekPackPorts, RevokeStoryResult } from './flow'
import { promotedReelLine, type ReelPromoteResult, type StoryAuthResult } from './lines'
import { loadWeekPackManifest, readClientPackSettings, type ClientPackSettings } from './load'
import { recordUnpublishedOnCard } from './persist-held'
import { voidPendingWeekPackCards } from './void-pending'
import { promoteReelGated } from './promote-guard'
import { reelCardMode, type WeekPackEnv } from './switches'
import { targetWeek } from './cadence'
import { reelListLines } from './reel-list-lines'
import type { ReelListApproval, WeekPackLine } from './types'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'

export interface WireInput {
  litePorts: LiteServicePorts
  db: SupabaseClient
  kernel: KernelDeps
  clicker: CardClicker
  actor: LiteActor
  clientId: string
  now: Date
  env: WeekPackEnv
  settings?: ClientPackSettings
}

export function createWeekPackPorts(input: WireInput): WeekPackPorts & { settings: Promise<ClientPackSettings> } {
  const settings = input.settings
    ? Promise.resolve(input.settings)
    : readClientPackSettings(input.db, input.clientId)
  const reelMode = reelCardMode(input.env)
  const reelGoPublic = reelMode !== 'off'
  return {
    settings,
    reelGoPublic,
    reelScheduled: reelMode === 'scheduled',
    loadManifest: (clientId) => loadWeekPackManifest({
      ports: input.litePorts, db: input.db, clientId, now: input.now,
    }),
    accountLabel: async () => (await settings).label,
    cadence: () => cadenceOf(input.settings),
    issueCard: (facts) => issueConfirmationCard(input.kernel, {
      clientId: input.clientId, clicker: input.clicker, facts, now: input.now,
    }),
    decideCard: (decision) => decideConfirmationCard(input.kernel, {
      clientId: input.clientId,
      clicker: input.clicker,
      now: input.now,
      ...decision,
    }),
    authorizeStory: (packId, contentHash) => authorizeStory(input, packId, contentHash),
    revokeStory: (packId, reason) => revokeStory(input, packId, reason),
    recordUnpublished: ({ runId, clientId, lines }) => recordUnpublishedOnCard(input.db, {
      runId, clientId, lines, now: input.now,
    }),
    voidPending: (subjectKey) => voidPendingWeekPackCards(input.kernel, input.clientId, subjectKey),
    promoteReel: (workOrderId, previewToken) => promoteReelGated({
      enabled: reelGoPublic,
      allowedClientId: input.actor.allowedClientId,
      email: input.actor.email,
      run: () => reelMode === 'scheduled'
        ? callAuthorizeScheduled(workOrderId, previewToken, input.actor.email, settings)
        : callRunPromote(workOrderId, previewToken, input.actor.email),
    }),
    approveReels: (approvals) => approveReelsFromWeekList(input, reelMode === 'scheduled', approvals),
  }
}

/** Week card, scheduled mode: the ticked reels are approved against the server-rebuilt list for next week. */
export async function approveReelsFromWeekList(
  input: Pick<WireInput, 'actor' | 'clientId' | 'now' | 'db'>, scheduled: boolean, approvals: readonly ReelListApproval[],
): Promise<WeekPackLine[]> {
  if (!scheduled) return [{ kind: 'reel', stable_id: null, code: 'skipped_switch_off', ok: true, text: '按日公开没打开，视频这一周不授权。' }]
  if (input.actor.allowedClientId !== null || !isGlobalAdminEmail(input.actor.email)) {
    return [{ kind: 'reel', stable_id: null, code: 'reel_forbidden', ok: false, text: '批视频仍要全局管理员。视频这一周没有授权，其他内容照常。' }]
  }
  if (approvals.length === 0) return [{ kind: 'reel', stable_id: null, code: 'reel_none', ok: true, text: '没有勾选视频，这一周视频都不发。' }]
  const { decideDailyList } = await import('@/lib/social/daily-list/decide')
  const { createDailyListPorts } = await import('@/lib/social/daily-list/db')
  const { createProductionPromoteDeps } = await import('@/lib/factory/publish/promote/deps')
  const { weekStart, weekEnd } = targetWeek(input.now)
  const receipt = await decideDailyList(createDailyListPorts(input.db, createProductionPromoteDeps()), {
    clientId: input.clientId, adminEmail: input.actor.email, switchOn: true, agentOn: true, approve: [...approvals], exclude: [],
    dryRun: false, now: input.now, requestId: crypto.randomUUID(), window: { from: weekStart, to: weekEnd },
  })
  return reelListLines(receipt)
}

function cadenceOf(settings: ClientPackSettings | undefined): WeeklyPackCadence {
  return cadenceFromConfig(settings?.configReadable ? settings.config : null)
}

async function authorizeStory(input: WireInput, packId: string, contentHash: string): Promise<StoryAuthResult> {
  const result = await authorizeLitePack({
    ports: input.litePorts,
    packId,
    clientId: input.clientId,
    actor: input.actor,
    confirm: true,
    lifetimeDays: storyAuthorizeLifetime(input.now),
    expectedContentHash: contentHash,
    now: input.now,
  })
  return mapStory(result)
}

function mapStory(result: LiteResult<{ mode: string }>): StoryAuthResult {
  if (result.ok && result.value.mode === 'AUTHORIZED') return { ok: true, code: 'story_authorized' }
  if (!result.ok && result.error === 'ALREADY_AUTHORIZED') return { ok: true, code: 'story_already_authorized' }
  if (!result.ok && result.status === 403) return { ok: false, code: 'story_forbidden' }
  return { ok: false, code: 'story_failed' }
}

async function revokeStory(input: WireInput, packId: string, reason: string): Promise<RevokeStoryResult> {
  const result = await revokeLitePack({
    ports: input.litePorts, packId, clientId: input.clientId, actor: input.actor, reason, now: input.now,
  })
  if (result.ok) {
    return {
      ok: true, code: 'revoked', sent: result.value.sent.length,
      inFlight: result.value.in_flight.length, summaryAvailable: result.value.summary_available,
    }
  }
  if (result.error === 'NOTHING_TO_REVOKE') return { ok: false, code: 'nothing', sent: 0, inFlight: 0, summaryAvailable: true }
  if (result.status === 403) return { ok: false, code: 'forbidden', sent: 0, inFlight: 0, summaryAvailable: true }
  return { ok: false, code: 'failed', sent: 0, inFlight: 0, summaryAvailable: true }
}

async function callRunPromote(workOrderId: string, previewToken: string, adminEmail: string): Promise<ReelPromoteResult> {
  const { runPromote } = await import('@/lib/factory/publish/promote/action')
  const { createProductionPromoteDeps } = await import('@/lib/factory/publish/promote/deps')
  const result = await runPromote(createProductionPromoteDeps(), {
    orderId: workOrderId, adminEmail, confirm: true, previewToken,
  })
  if (!result.ok) return { ok: false, code: 'reel_failed', text: safePromoteText(result.error) }
  if (result.kind !== 'promoted' && result.kind !== 'synced') {
    return { ok: false, code: 'reel_failed', text: '这条视频没能转公开。' }
  }
  return promotedReelLine(result.data.first_comment_status)
}

async function callAuthorizeScheduled(
  workOrderId: string, previewToken: string, adminEmail: string, settings: Promise<ClientPackSettings>,
): Promise<ReelPromoteResult> {
  const { authorizeScheduledReel } = await import('@/lib/factory/publish/promote/scheduled-authorize')
  const { publishHourOf } = await import('@/lib/factory/publish/promote/scheduled-grant')
  const { createProductionPromoteDeps } = await import('@/lib/factory/publish/promote/deps')
  const result = await authorizeScheduledReel(createProductionPromoteDeps(), {
    orderId: workOrderId, adminEmail, previewToken, source: 'week-card',
  })
  if (!result.ok) return { ok: false, code: 'reel_failed', text: safePromoteText(result.error) }
  return {
    ok: true,
    code: 'reel_scheduled',
    text: `已授权：${result.publishOn} 新西兰时间 ${publishHourOf((await settings).config)}:00 自动公开，当天公开前会再核一遍。`,
  }
}

function safePromoteText(error: string): string {
  const text = error.trim()
  if (!text || /[{}[\]`]/.test(text) || /\d{6,}/.test(text)) return '这条视频没能转公开。'
  return text.slice(0, 160)
}
