/**
 * What the week-overview page shows. Sentences only — the page must not print the raw payload.
 */

import type { ConfirmationCardView } from '@/lib/confirmation-card/view'

import { cadenceSentence, type WeeklyPackCadence } from './cadence'
import type { WeekPackManifest, WeekPackReceipt } from './types'

export interface WeekPackCardView {
  run_id: string
  expected_decision_id: string
  fingerprint: string
  what: string
  date: string
  display_scope: string
  status_line: string
  confirm_enabled: boolean
  decline_enabled: boolean
  blocked_reason: string | null
}

export interface WeekPackPage {
  success: true
  enabled: boolean
  reel_go_public: boolean
  headline: string
  lines: string[]
  posts_line: string
  cadence_line: string
  message: string | null
  card: WeekPackCardView | null
  reels: Array<{ work_order_id: string; title: string }>
  receipt_lines: string[]
}

const POSTS_LINE = '图文尚未接入。这一周不会授权图文，也没有把它显示成 0 条。'

export function displayScope(scope: string): string {
  const cut = scope.indexOf('。核对码')
  return cut === -1 ? scope : scope.slice(0, cut + 1)
}

export function toWeekPackPage(input: {
  enabled: boolean
  reelGoPublic: boolean
  cadence: WeeklyPackCadence
  configReadable?: boolean
  manifest: WeekPackManifest | null
  card: ConfirmationCardView | null
  message: string | null
  receipt: WeekPackReceipt | null
}): WeekPackPage {
  const lines = input.manifest ? describeManifest(input.manifest) : ['清单读不到，没有当成这一周没有内容。']
  if (!input.enabled) lines.unshift('打开之前不会授权，也不会把视频公开。')
  const rhythm = cadenceSentence(input.cadence)
  return {
    success: true,
    enabled: input.enabled,
    reel_go_public: input.reelGoPublic,
    headline: headline(input.enabled, input.card),
    lines,
    posts_line: POSTS_LINE,
    cadence_line: input.configReadable === false ? `节奏配置读不到，暂时用默认。${rhythm}` : rhythm,
    message: input.message,
    card: input.card ? cardView(input.card) : null,
    reels: input.reelGoPublic && input.manifest?.reels.read_state === 'ok'
      ? input.manifest.reels.items.map((item) => ({ work_order_id: item.work_order_id, title: item.title }))
      : [],
    receipt_lines: input.receipt?.lines.map((line) => line.text) ?? [],
  }
}

function headline(enabled: boolean, card: ConfirmationCardView | null): string {
  if (!enabled) return '整包批准还没打开'
  if (!card) return '下一周的整包还没出卡'
  if (card.status === 'waiting') return '下一周可以批了'
  if (card.status === 'confirmed') return '这一周已经点过同意'
  if (card.status === 'declined') return '这一周先不发'
  if (card.status === 'expired') return '这张卡过了时间，重新打开页面会再出一张'
  return '这张卡已作废，重新打开页面会再出一张'
}

function cardView(card: ConfirmationCardView): WeekPackCardView {
  return {
    run_id: card.runId,
    expected_decision_id: card.expectedDecisionId,
    fingerprint: card.fingerprint,
    what: card.what,
    date: card.date,
    display_scope: displayScope(card.scope),
    status_line: card.statusLine,
    confirm_enabled: card.confirmEnabled,
    decline_enabled: card.declineEnabled,
    blocked_reason: card.blockedReason,
  }
}

export function describeManifest(manifest: WeekPackManifest): string[] {
  return [describeStory(manifest), ...describeReels(manifest)]
}

function describeStory(manifest: WeekPackManifest): string {
  if (manifest.story.read_state !== 'ok') return 'Story 读不到，没有当成 0 条。'
  if (!manifest.story.pack_id) return '下一周还没有 Story 周包。'
  const outside = manifest.story.items.filter((item) => !item.in_target_week).length
  const title = (manifest.story.title ?? '未命名').replace(/[{}[\]`]/g, ' ').slice(0, 40)
  const state = storyState(manifest.story.state)
  const extra = outside > 0 ? ` 其中 ${outside} 条日期不在这一周，授权仍是整包一起。` : ''
  return `Story「${title}」共 ${manifest.story.items.length} 条，现在是${state}。${extra}`.trim()
}

function storyState(state: WeekPackManifest['story']['state']): string {
  if (state === 'AUTHORIZED') return '已授权'
  if (state === 'REVOKED') return '已停'
  if (state === 'EXPIRED') return '已过期'
  return '草稿'
}

function describeReels(manifest: WeekPackManifest): string[] {
  if (manifest.reels.read_state !== 'ok') return ['视频读不到，没有当成 0 条。']
  const dated = manifest.reels.items.filter((item) => item.date_state === 'in_week').length
  const other = manifest.reels.items.length - dated
  const lines = [dated === 0 && other === 0
    ? '下一周没有已过审、还在草稿的视频。'
    : `已过审且仍是草稿的视频，有 ${dated} 条落在这一周。`]
  if (other > 0) lines.push(`另有 ${other} 条读不到建议发布日，或分不清是否还是草稿，没有替它们排进某一天。`)
  if (manifest.reels.truncated) lines.push('只看了最近 30 条视频，更早的没有算进来。')
  return lines
}
