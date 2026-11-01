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
import type { ReelPromoteResult, StoryAuthResult } from './lines'
import { loadWeekPackManifest, readClientPackSettings, type ClientPackSettings } from './load'
import { promoteReelGated } from './promote-guard'
import { reelGoPublicOnApproveEnabled, type WeekPackEnv } from './switches'

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
  const reelGoPublic = reelGoPublicOnApproveEnabled(input.env)
  return {
    settings,
    reelGoPublic,
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
    promoteReel: (workOrderId, previewToken) => promoteReelGated({
      enabled: reelGoPublic,
      allowedClientId: input.actor.allowedClientId,
      email: input.actor.email,
      run: () => callRunPromote(workOrderId, previewToken, input.actor.email),
    }),
  }
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
  return { ok: true, code: 'reel_promoted', text: '这条视频已按预览转公开。' }
}

function safePromoteText(error: string): string {
  const text = error.trim()
  if (!text || /[{}[\]`]/.test(text) || /\d{6,}/.test(text)) return '这条视频没能转公开。'
  return text.slice(0, 160)
}
