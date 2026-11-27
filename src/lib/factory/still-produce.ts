/**
 * Make the week's stills on one work order. Each billed image is a ledger row.
 * The switch defaults off: nothing here runs unless factory_stills.enabled is true.
 */

import { loadRankableClientAssets, type RankableAssetRow } from '@/lib/factory/client-asset-pool'
import type { ComposeTourPosterResult } from '@/lib/social/image-post-poster'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { loadPublishedTourFacts } from '@/lib/tour-catalog/store-publish'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import { isoDate, nzCalendar, targetWeek } from '@/lib/social/week-pack/cadence'
import type { WeekWindow } from '@/lib/social/image-post-week'

import { loadFactoryStills, type FactoryStill } from './still-library'
import { loadHandledStillSlots, openStillOrder, recordStillSpend, type HandledStillSlot, type StillOrder } from './still-order'
import { planStillSlots, roomForAnother, type StillSlot } from './still-plan'
import { FACTORY_STILL_COST_ESTIMATE_USD, readFactoryStillConfig } from './still-config'
import { composeFactoryStill } from './still-compose'
import { acceptFactoryStill, noteFailedStill, type StillAcceptDeps } from './still-accept'

export interface StillProduceReceipt {
  drafted: number
  skipped: string | null
  error: string | null
  spentUsd: number
  note: string
}

export interface StillProduceDeps extends StillAcceptDeps {
  compose?: (input: {
    clientId: string
    date: string
    tour: PublishedTourFact
    asset: RankableAssetRow
    website: string | null
    aspect: StillSlot['aspect']
  }) => Promise<ComposeTourPosterResult>
}

export async function produceFactoryStills(
  clientId: string,
  config: unknown,
  now: Date,
  deps: StillProduceDeps,
): Promise<StillProduceReceipt> {
  const settings = readFactoryStillConfig(config)
  if (!settings.enabled) {
    return { drafted: 0, skipped: 'factory_stills_off', error: null, spentUsd: 0, note: '静图开关关着，没有生成，也没有记账。' }
  }
  const cap = settings.weeklyCapUsd ?? 0
  if (cap <= 0) {
    return { drafted: 0, skipped: 'still_cap_zero', error: null, spentUsd: 0, note: '每周静图花费帽是 0，没有生成。' }
  }
  const week = targetWeek(now)
  const slots = planStillSlots({ config, week, today: isoDate(nzCalendar(now)) })
  if (slots.length === 0) {
    return { drafted: 0, skipped: 'no_still_slots', error: null, spentUsd: 0, note: '这一周没有要出的静图。' }
  }
  return fillSlots(clientId, week, slots, cap, deps)
}

async function fillSlots(
  clientId: string,
  week: WeekWindow,
  slots: StillSlot[],
  cap: number,
  deps: StillProduceDeps,
): Promise<StillProduceReceipt> {
  const have = await loadFactoryStills(deps.supabase, clientId)
  if (have === 'unreadable') return fail('factory_stills_unreadable', '已有静图读不到，为避免重复没有再生成。')
  const handled = await loadHandledStillSlots(deps.supabase, clientId, week.weekStart)
  if (handled === 'unreadable') return fail('order_unreadable', '工单读不到，没有生成。')
  const missing = slots.filter((slot) => !slotTaken(have, handled, slot))
  if (missing.length === 0) {
    return { drafted: 0, skipped: 'stills_already_made', error: null, spentUsd: 0, note: '这一周的静图成片已经有了。' }
  }
  const order = await openStillOrder(deps.supabase, clientId, week, cap, (deps.now ?? (() => new Date()))())
  if (typeof order === 'string') return fail(order, skipNote(order))
  return makeMissing(clientId, missing, order, cap, deps)
}

async function makeMissing(
  clientId: string,
  slots: StillSlot[],
  order: StillOrder,
  cap: number,
  deps: StillProduceDeps,
): Promise<StillProduceReceipt> {
  const tourRead = await loadPublishedTourFacts(deps.supabase, clientId, slots[0]?.date ?? '')
  if (!tourRead.published) return fail('no_published_tours', '没有已发布的线路，没有出静图。')
  const tour = tourRead.tours[0]
  if (!tour) return fail('no_published_tours', '没有已发布的线路，没有出静图。')
  const assets = await loadRankableClientAssets(clientId, deps.supabase)
  const asset = assets.find((row) => row.storage_url)
  if (!asset) return fail('no_base_photo', '没有可用的底图，没有出静图。')
  const brief = await getActiveBrief(clientId).catch(() => null)
  const website = typeof brief?.website === 'string' ? brief.website : null
  let spent = order.spentUsd
  let drafted = 0
  let stopped: string | null = null
  for (const slot of slots) {
    if (!roomForAnother(spent, cap)) { stopped = 'weekly_cap_reached'; break }
    const made = await makeOne(clientId, slot, tour, asset, website, order, cap, deps)
    if (made.spent !== null) spent = made.spent
    if (made.ok) drafted += 1
    if (made.stopped) { stopped = made.stopped; break }
  }
  return {
    drafted,
    skipped: stopped,
    error: null,
    spentUsd: spent,
    note: resultNote(drafted, stopped),
  }
}

async function makeOne(
  clientId: string,
  slot: StillSlot,
  tour: PublishedTourFact,
  asset: RankableAssetRow,
  website: string | null,
  order: StillOrder,
  cap: number,
  deps: StillProduceDeps,
): Promise<{ ok: boolean; spent: number | null; stopped: string | null }> {
  const compose = deps.compose ?? ((input) => composeFactoryStill(deps.supabase, input))
  const result = await compose({ clientId, date: slot.date, tour, asset, website, aspect: slot.aspect })
  const unknownBill = unknownProviderBill(result)
  const billed = unknownBill ? FACTORY_STILL_COST_ESTIMATE_USD : knownBill(result)
  const spent = await recordStillSpend(deps.supabase, order, billed, `${slot.role}-${slot.date}`)
  if (spent === 'ledger_failed') return { ok: false, spent: null, stopped: 'ledger_failed' }
  order.spentUsd = spent
  if (unknownBill || !result.ok) {
    const blocked = billed > 0
      ? await markChargedMiss(deps, clientId, slot, tour, order, result, unknownBill)
      : null
    if (blocked) return { ok: false, spent, stopped: blocked }
    if (unknownBill) return { ok: false, spent, stopped: 'provider_unknown_billing' }
    return { ok: false, spent, stopped: null }
  }
  return acceptFactoryStill(clientId, slot, tour, website, result.assetId, order, cap, deps)
}

async function markChargedMiss(
  deps: StillProduceDeps,
  clientId: string,
  slot: StillSlot,
  tour: PublishedTourFact,
  order: StillOrder,
  result: ComposeTourPosterResult,
  unknownBill: boolean,
): Promise<string | null> {
  const assetId = result.ok ? null : (typeof result.receipt.poster_asset_id === 'string' ? result.receipt.poster_asset_id : null)
  const reason = unknownBill || result.ok ? '改图没有回报价，已按估价记账' : result.reason
  const noted = await noteFailedStill(deps, clientId, slot, order, assetId, tour, [reason], { redlineHits: [], factVerdict: 'unreadable' }, null)
  return noted === 'unrecorded' ? 'still_review_unrecorded' : null
}

function unknownProviderBill(result: ComposeTourPosterResult): boolean {
  if (result.ok || !result.reason.includes('edit_failed_maybe_billed')) return false
  const requestId = result.receipt.provider_request_id
  return result.receipt.cost_usd == null && (requestId === null || requestId === '')
}

function knownBill(result: ComposeTourPosterResult): number {
  return result.receipt.cost_usd ?? (result.receipt.provider_request_id ? FACTORY_STILL_COST_ESTIMATE_USD : 0)
}

function sameSlot(still: FactoryStill, slot: StillSlot): boolean {
  return still.role === slot.role && still.aspect === slot.aspect && still.slotDate === slot.date
}

function slotTaken(have: FactoryStill[], handled: HandledStillSlot[], slot: StillSlot): boolean {
  if (have.some((still) => sameSlot(still, slot))) return true
  return handled.some((row) => row.role === slot.role && row.aspect === slot.aspect && row.slotDate === slot.date)
}

function fail(skipped: string, note: string): StillProduceReceipt {
  return { drafted: 0, skipped, error: null, spentUsd: 0, note }
}

function skipNote(code: string): string {
  const notes: Record<string, string> = {
    weekly_cap_reached: '静图花费到了本周上限，剩下的没有再生成。',
    ledger_failed: '静图花费记不进账，停下了，避免接着花。',
    provider_unknown_billing: '改图没有回报价，已按估价记账并停下，避免接着花。',
    still_stamp_failed: '静图成片没有标上工单血统，停下了。',
    still_review_unrecorded: '静图审片结果写不进工单，停下了，没有把它当成可用。',
    daily_order_cap: '今天的工单已经到了每天上限，没有再开工单。',
    no_factory_goal: '没有进行中的目标，没有开工单。',
    no_master_brief: '没有在用的简报，没有开工单。',
    order_unreadable: '工单读不到，没有生成。',
    no_published_tours: '没有已发布的线路，没有出静图。',
    no_base_photo: '没有可用的底图，没有出静图。',
    factory_stills_unreadable: '已有静图读不到，为避免重复没有再生成。',
  }
  return notes[code] ?? code
}

function resultNote(drafted: number, stopped: string | null): string {
  if (stopped) return skipNote(stopped)
  if (drafted === 0) return '静图没有通过审片，没有拿去用。'
  return `静图成片新生成 ${drafted} 张。`
}
