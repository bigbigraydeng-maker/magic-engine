/**
 * A still counts as finished only after the copy gate and the image check pass.
 * A miss is not usable. A failed image check is marked on the asset so the same picture is not reviewed again.
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import { factCheckToday } from '@/lib/social/weekly-loop/reel-facts'

import { appendStillReview, recordStillSpend, type StillOrder } from './still-order'
import { STILL_REVIEWER_ID, STILL_VISUAL_COST_ESTIMATE_USD } from './still-config'
import {
  buildStillReview,
  reviewStillCopy,
  reviewStillImage,
  stillFactLink,
  type StillCopyVerdict,
  type StillVisualVerdict,
} from './still-review'
import type { StillSlot } from './still-plan'

export interface StillAcceptDeps {
  supabase: SupabaseClient
  now?: () => Date
  hashUrl?: (url: string) => Promise<string | null>
  reviewCopy?: typeof reviewStillCopy
  reviewVisual?: typeof reviewStillImage
}

interface LoadedStill {
  url: string
  meta: Record<string, unknown>
}

export async function acceptFactoryStill(
  clientId: string,
  slot: StillSlot,
  tour: PublishedTourFact,
  website: string | null,
  assetId: string,
  order: StillOrder,
  cap: number,
  deps: StillAcceptDeps,
): Promise<{ ok: boolean; spent: number | null; stopped: string | null }> {
  const loaded = await loadStillAsset(deps.supabase, clientId, assetId)
  if (!loaded) return drop(deps, slot, order, assetId, failCopy(['静图成片读不到'], 'unreadable'), null)
  const overlay = overlayOf(loaded.meta)
  const caption = tour.name.trim()
  const place = tour.destination.trim()
  if (!overlay || !caption || !place) {
    return drop(deps, slot, order, assetId, failCopy(['没有可核对的画面文字、说明或目的地'], 'unreadable'), null)
  }
  const now = (deps.now ?? (() => new Date()))()
  const copy = await (deps.reviewCopy ?? reviewStillCopy)({
    supabase: deps.supabase,
    clientId,
    overlay,
    caption,
    linkUrl: stillFactLink(website, tour.slug),
    today: factCheckToday(now),
  })
  if (!copy.pass) return drop(deps, slot, order, assetId, copy, null)
  if (order.spentUsd + STILL_VISUAL_COST_ESTIMATE_USD > cap + 1e-9) {
    return drop(deps, slot, order, assetId, failCopy(['本周静图花费不够做画面审'], copy.factVerdict), 'weekly_cap_reached')
  }
  return finishVisual(clientId, slot, tour, website, assetId, order, loaded, overlay, place, copy, deps)
}

async function finishVisual(
  clientId: string,
  slot: StillSlot,
  tour: PublishedTourFact,
  website: string | null,
  assetId: string,
  order: StillOrder,
  loaded: LoadedStill,
  overlay: string,
  place: string,
  copy: StillCopyVerdict,
  deps: StillAcceptDeps,
): Promise<{ ok: boolean; spent: number | null; stopped: string | null }> {
  const visual = await (deps.reviewVisual ?? reviewStillImage)({ imageUrl: loaded.url, place, overlay })
  const spent = await chargeVisual(deps.supabase, order, visual)
  if (spent === 'ledger_failed') return { ok: false, spent: null, stopped: 'ledger_failed' }
  order.spentUsd = spent
  if (!visual.pass) {
    const marked = await stampFailed(deps, clientId, assetId, loaded.meta, slot, order.id, tour, visual.reasons)
    if (!marked) return { ok: false, spent, stopped: 'still_stamp_failed' }
    return drop(deps, slot, order, assetId, { ...copy, pass: false, reasons: visual.reasons }, null, visual.model)
  }
  const hash = await (deps.hashUrl ?? sha256OfHttps)(loaded.url)
  if (!hash) return drop(deps, slot, order, assetId, failCopy(['文件校验算不出来'], copy.factVerdict), null, visual.model)
  const recorded = await remember(deps, slot, order, assetId, 'pass', ['画面和文字都过了'], copy, visual.model)
  if (!recorded) return { ok: false, spent, stopped: 'still_review_unrecorded' }
  const stamped = await stampPassed(deps, clientId, assetId, loaded.meta, slot, order.id, website, tour, hash)
  if (!stamped) return { ok: false, spent, stopped: 'still_stamp_failed' }
  return { ok: true, spent, stopped: null }
}

function failCopy(reasons: string[], factVerdict: string): StillCopyVerdict {
  return { pass: false, reasons, redlineHits: [], factVerdict }
}

async function drop(
  deps: StillAcceptDeps,
  slot: StillSlot,
  order: StillOrder,
  assetId: string | null,
  copy: StillCopyVerdict,
  stopped: string | null,
  model: string | null = null,
): Promise<{ ok: boolean; spent: number | null; stopped: string | null }> {
  const recorded = await remember(deps, slot, order, assetId, 'fail', copy.reasons, copy, model)
  if (!recorded) return { ok: false, spent: order.spentUsd, stopped: 'still_review_unrecorded' }
  return { ok: false, spent: order.spentUsd, stopped }
}

async function remember(
  deps: StillAcceptDeps,
  slot: StillSlot,
  order: StillOrder,
  assetId: string | null,
  verdict: 'pass' | 'fail',
  reasons: string[],
  copy: StillCopyVerdict,
  model: string | null,
): Promise<boolean> {
  const now = (deps.now ?? (() => new Date()))()
  return appendStillReview(deps.supabase, order.id, buildStillReview({
    assetId,
    role: slot.role,
    aspect: slot.aspect,
    slotDate: slot.date,
    verdict,
    reasons,
    redlineHits: copy.redlineHits,
    factVerdict: copy.factVerdict,
    model,
    checkedAt: now.toISOString(),
  }))
}

async function chargeVisual(
  supabase: SupabaseClient,
  order: StillOrder,
  visual: StillVisualVerdict,
): Promise<number | 'ledger_failed'> {
  const amount = visual.costUsd ?? (visual.billed ? STILL_VISUAL_COST_ESTIMATE_USD : 0)
  return recordStillSpend(supabase, order, amount, 'visual-review')
}

async function loadStillAsset(
  supabase: SupabaseClient,
  clientId: string,
  assetId: string,
): Promise<LoadedStill | null> {
  const { data, error } = await supabase
    .from('client_assets')
    .select('storage_url, vision_metadata')
    .eq('id', assetId)
    .eq('client_id', clientId)
    .limit(1)
  if (error) return null
  const row = (data ?? [])[0] as { storage_url?: unknown; vision_metadata?: unknown } | undefined
  const url = typeof row?.storage_url === 'string' ? row.storage_url : ''
  const meta = record(row?.vision_metadata)
  if (!url.startsWith('https://') || !meta) return null
  return { url, meta }
}

function overlayOf(meta: Record<string, unknown>): string {
  const lines = record(meta.poster)?.text_lines
  if (!Array.isArray(lines)) return ''
  return lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0).join('\n')
}

async function stampFailed(
  deps: StillAcceptDeps,
  clientId: string,
  assetId: string,
  meta: Record<string, unknown>,
  slot: StillSlot,
  workOrderId: string,
  tour: PublishedTourFact,
  reasons: string[],
): Promise<boolean> {
  const tourId = tour.id.trim()
  const { error } = await deps.supabase.from('client_assets').update({
    vision_metadata: {
      ...meta,
      kind: 'factory_still',
      factory_still: {
        work_order_id: workOrderId,
        aspect: slot.aspect,
        role: slot.role,
        slot_date: slot.date,
        tour_id: tourId.length > 0 ? tourId : null,
        review: {
          verdict: 'fail',
          reviewer: STILL_REVIEWER_ID,
          reasons: reasons.filter((line) => line.trim().length > 0).slice(0, 4),
        },
      },
    },
  }).eq('id', assetId).eq('client_id', clientId)
  return !error
}

async function stampPassed(
  deps: StillAcceptDeps,
  clientId: string,
  assetId: string,
  meta: Record<string, unknown>,
  slot: StillSlot,
  workOrderId: string,
  website: string | null,
  tour: PublishedTourFact,
  hash: string,
): Promise<boolean> {
  const text = tour.name.trim()
  const tourId = tour.id.trim()
  // Machine review is not a person. Leave verified_by / verified_at alone so the poster sign gate stays unsigned.
  const { error } = await deps.supabase.from('client_assets').update({
    vision_metadata: {
      ...meta,
      kind: 'factory_still',
      factory_still: {
        work_order_id: workOrderId,
        aspect: slot.aspect,
        role: slot.role,
        slot_date: slot.date,
        sha256: hash,
        text_line: text.length >= 1 && text.length <= 200 ? text : null,
        source_ref: website !== null && website.startsWith('https://') ? website : null,
        tour_id: tourId.length > 0 ? tourId : null,
        review: { verdict: 'pass', reviewer: STILL_REVIEWER_ID },
      },
    },
  }).eq('id', assetId).eq('client_id', clientId)
  return !error
}

function sha256OfHttps(url: string): Promise<string | null> {
  if (!url.startsWith('https://')) return Promise.resolve(null)
  return fetch(url).then(async (res) => {
    if (!res.ok) return null
    return createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex')
  }).catch(() => null)
}

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}
