// Runs the three checks and, only for a material-only order, archives it and enters the pool.

import type { CreativePoolEntry, ConfigVersion } from '@/lib/ads-strategy/config'
import {
  collectFactClaims,
  decideAssetDualReview,
  UNREADABLE,
  withDualReview,
  type DualReviewDecision,
  type PoolMark,
} from './asset-dual-review'
import { poolAfterPass } from './asset-dual-review-pool'
import { isAssetOnly } from './deliverable'
import type { RemotionMusicClearance } from './remotion-music-options.mjs'
import { officialWebsiteUrl } from './topic-alignment'

export interface AssetOrder {
  id: string
  clientId: string
  status: string
  brief: unknown
  output: unknown
  reviewRef: unknown
}

export interface DualReviewIo {
  loadOrder(id: string): Promise<AssetOrder | null | 'unreadable'>
  loadHosts(clientId: string): Promise<string[] | null>
  readPage(url: string, hosts: readonly string[]): Promise<string | null>
  musicOf(brief: unknown): RemotionMusicClearance
  loadPool(clientId: string): Promise<{ version: ConfigVersion; pool: CreativePoolEntry[] } | null>
  writePool(clientId: string, pool: CreativePoolEntry[], version: ConfigVersion): Promise<'ok' | 'conflict' | 'error'>
  writeOrder(id: string, patch: Record<string, unknown>, expectStatus: string): Promise<'ok' | 'conflict' | 'error'>
  now(): string
}

export interface DualReviewReceipt {
  applicable: boolean
  passed: boolean
  pooled: boolean
  status: 'skipped' | 'recorded' | 'pooled' | 'unreadable' | 'pool_blocked' | 'conflict' | 'invalid_payload'
  reason?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function passedByUs(reviewRef: unknown): boolean {
  if (!isRecord(reviewRef) || !isRecord(reviewRef.dual_review)) return false
  const dual = reviewRef.dual_review
  return dual.passed === true && (dual.pool === 'pending' || dual.pool === 'entered')
}

function skipped(reason?: string): DualReviewReceipt {
  return { applicable: false, passed: false, pooled: false, status: 'skipped', reason }
}

async function readClaimPages(
  io: DualReviewIo,
  claims: ReturnType<typeof collectFactClaims>,
  hosts: string[] | null,
): Promise<Record<string, string | null>> {
  const pages: Record<string, string | null> = {}
  if (!hosts || hosts.length === 0) return pages
  for (const claim of claims) {
    if (claim.sourceUrl in pages || !officialWebsiteUrl(claim.sourceUrl, hosts)) continue
    pages[claim.sourceUrl] = await io.readPage(claim.sourceUrl, hosts)
  }
  return pages
}

async function decideFor(io: DualReviewIo, order: AssetOrder): Promise<DualReviewDecision> {
  const hosts = await io.loadHosts(order.clientId)
  const claims = collectFactClaims(order.brief)
  const pages = await readClaimPages(io, claims, hosts)
  const output = isRecord(order.output) ? order.output : {}
  const check = isRecord(output.maliang_check) ? output.maliang_check : {}
  return decideAssetDualReview({
    assetOnly: true,
    maliangStatus: check.status,
    machineReviewed: output.machine_reviewed,
    maliangReasons: check.reasons,
    claims,
    officialHosts: hosts,
    pages,
    music: io.musicOf(order.brief),
  })
}

async function recordStay(
  io: DualReviewIo,
  order: AssetOrder,
  decision: DualReviewDecision,
  pool: PoolMark,
  status: DualReviewReceipt['status'],
  reason?: string,
): Promise<DualReviewReceipt> {
  const at = io.now()
  const wrote = await io.writeOrder(order.id, {
    review_ref: withDualReview(order.reviewRef, decision, at, pool),
    updated_at: at,
  }, 'in_review')
  if (wrote !== 'ok') return { applicable: true, passed: false, pooled: false, status: 'conflict' }
  return { applicable: true, passed: false, pooled: false, status, reason }
}

async function writePoolOnce(
  io: DualReviewIo,
  clientId: string,
  workOrderId: string,
  at: string,
): Promise<'ok' | 'blocked' | 'unreadable' | 'conflict'> {
  const loaded = await io.loadPool(clientId)
  if (!loaded) return 'unreadable'
  const next = poolAfterPass(loaded.pool, workOrderId, at)
  if (!next.ok) return 'blocked'
  if (next.pool === loaded.pool) return 'ok'
  const wrote = await io.writePool(clientId, next.pool, loaded.version)
  if (wrote === 'ok') return 'ok'
  return wrote === 'conflict' ? 'conflict' : 'unreadable'
}

async function writePoolRetry(io: DualReviewIo, clientId: string, workOrderId: string, at: string) {
  const first = await writePoolOnce(io, clientId, workOrderId, at)
  if (first !== 'conflict') return first
  return writePoolOnce(io, clientId, workOrderId, at)
}

async function markEntered(io: DualReviewIo, order: AssetOrder, decision: DualReviewDecision): Promise<void> {
  const at = io.now()
  await io.writeOrder(order.id, {
    review_ref: withDualReview(order.reviewRef, decision, at, 'entered'),
    updated_at: at,
  }, 'archived')
}

async function enterPool(io: DualReviewIo, order: AssetOrder, decision: DualReviewDecision): Promise<DualReviewReceipt> {
  const at = io.now()
  const loaded = await io.loadPool(order.clientId)
  if (!loaded) return recordStay(io, order, decision, 'not_entered', 'unreadable', UNREADABLE)
  const planned = poolAfterPass(loaded.pool, order.id, at)
  if (!planned.ok) return recordStay(io, order, decision, 'blocked', 'pool_blocked', planned.reason)
  const archived = await io.writeOrder(order.id, {
    status: 'archived',
    review_ref: withDualReview(order.reviewRef, decision, at, 'pending'),
    updated_at: at,
  }, 'in_review')
  if (archived !== 'ok') return { applicable: true, passed: true, pooled: false, status: 'conflict' }
  const pooled = await writePoolRetry(io, order.clientId, order.id, at)
  if (pooled !== 'ok') {
    return { applicable: true, passed: true, pooled: false, status: pooled === 'conflict' ? 'conflict' : 'unreadable', reason: UNREADABLE }
  }
  await markEntered(io, order, decision)
  return { applicable: true, passed: true, pooled: true, status: 'pooled' }
}

async function resumeArchived(io: DualReviewIo, order: AssetOrder): Promise<DualReviewReceipt> {
  if (order.status !== 'archived' || !passedByUs(order.reviewRef)) {
    return { applicable: true, passed: false, pooled: false, status: 'skipped' }
  }
  const pooled = await writePoolRetry(io, order.clientId, order.id, io.now())
  return {
    applicable: true,
    passed: true,
    pooled: pooled === 'ok',
    status: pooled === 'ok' ? 'pooled' : pooled === 'conflict' ? 'conflict' : 'unreadable',
    reason: pooled === 'ok' ? undefined : UNREADABLE,
  }
}

export async function runAssetDualReview(
  io: DualReviewIo,
  input: { workOrderId: string; clientId: string },
): Promise<DualReviewReceipt> {
  const order = await io.loadOrder(input.workOrderId)
  if (order === 'unreadable') return { applicable: false, passed: false, pooled: false, status: 'unreadable', reason: UNREADABLE }
  if (order === null) return skipped('工单不存在')
  if (order.clientId !== input.clientId) return skipped('客户对不上')
  if (!isAssetOnly(order.brief)) return skipped()
  if (order.status !== 'in_review') return resumeArchived(io, order)
  const decision = await decideFor(io, order)
  if (!decision.passed) return recordStay(io, order, decision, 'not_entered', 'recorded')
  return enterPool(io, order, decision)
}
