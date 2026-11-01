/**
 * Confirmation-card facts for one weekly pack.
 * The digest sits in `scope` so a changed list changes the card fingerprint.
 */

import { contentFingerprint, normalizeFacts, type CardFacts, type HardCheck } from '@/lib/confirmation-card/facts'

import { manifestDigest } from './fingerprint'
import type { WeekPackManifest } from './types'

const WHAT = '同意按清单发布下周的 Story 和 Reel。改过的会单独拦住。'

export function weekPackSubject(clientId: string, weekStart: string): string {
  return `social:week-pack:${clientId.toLowerCase()}:${weekStart}`
}

export function plainLabel(value: string | null | undefined): string {
  const text = (value ?? '').replace(/[{}[\]`]/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 80) : '这位客户'
}

function countText(label: string, count: number | null): string {
  if (count === null) return `${label} 读不到`
  return count === 0 ? `${label} 没有` : `${label} ${count} 条`
}

export function scopeLine(manifest: WeekPackManifest, digest: string): string {
  const story = countText('Story', manifest.story.read_state === 'ok' ? manifest.story.items.length : null)
  const reel = countText('Reel', manifest.reels.read_state === 'ok' ? datedCount(manifest) : null)
  const extra = undatedCount(manifest)
  const tail = extra > 0 ? `，另有 ${extra} 条发布日读不到` : ''
  return `下周 ${story}、${reel}${tail}，图文尚未接入。核对码 ${digest}`
}

function datedCount(manifest: WeekPackManifest): number {
  return manifest.reels.items.filter((item) => item.date_state === 'in_week').length
}

function undatedCount(manifest: WeekPackManifest): number {
  if (manifest.reels.read_state !== 'ok') return 0
  return manifest.reels.items.filter((item) => item.date_state !== 'in_week').length
}

function listCheck(manifest: WeekPackManifest): HardCheck {
  if (manifest.story.read_state === 'unread' || manifest.reels.read_state === 'unread') {
    return { label: '清单', state: 'unread', reason: '有一路读不到，没有当成没有内容' }
  }
  return { label: '清单', state: 'green', reason: 'Story 和 Reel 都读到了' }
}

function reelCheck(manifest: WeekPackManifest, reelGoPublic: boolean): HardCheck {
  if (manifest.reels.read_state === 'unread') {
    return { label: 'Reel', state: 'unread', reason: '读不到，没有转公开' }
  }
  if (!reelGoPublic) return { label: 'Reel', state: 'green', reason: '本版不在这里转公开' }
  return { label: 'Reel', state: 'green', reason: '只会处理已经预览过的，没预览的单独拦住' }
}

export function buildWeekPackFacts(input: {
  manifest: WeekPackManifest
  accountLabel: string
  reelGoPublic: boolean
}): { facts: CardFacts; digest: string; fingerprint: string } {
  const digest = manifestDigest(input.manifest)
  const facts = normalizeFacts({
    subjectKey: weekPackSubject(input.manifest.client_id, input.manifest.week_start),
    what: WHAT,
    account: plainLabel(input.accountLabel),
    amount: '不涉及广告花费',
    date: `${input.manifest.week_start} 至 ${input.manifest.week_end}（新西兰，周一至周日）`,
    scope: scopeLine(input.manifest, digest),
    hardChecks: [
      listCheck(input.manifest),
      { label: '图文', state: 'green', reason: '尚未接入，本版不授权' },
      reelCheck(input.manifest, input.reelGoPublic),
    ],
  })
  return { facts, digest, fingerprint: contentFingerprint(facts) }
}

export function scopeHasDigest(scope: string, digest: string): boolean {
  return digest.length === 64 && scope.endsWith(digest)
}
