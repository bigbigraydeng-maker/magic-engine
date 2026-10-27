/**
 * S1: audience, exclusion list, creative and schedule for the plan seed. Read-only.
 * Every empty result carries a reason; nothing here fills a placeholder.
 * Audience size is shown in the basis only, never used to filter.
 */

import type { AdsDraftFacts, AudiencePoolItem, CreativePoolFact } from '@/lib/marketing-plan/promo/draft-ads'
import { nzToday, promoVerdict, type PromoVerdict } from '../promo-window'
import type { PlayKey } from '../play-vocabulary'
import type { ReadState } from './eligibility'
import type { AudienceState, Basis, CreativeState, Field } from './types'

/** Meta custom-audience status codes for one audience; null = not returned. */
export interface AudienceStatus {
  operation: number | null
  delivery: number | null
}
export type AudienceStatusRead = ReadState<Record<string, AudienceStatus>>

const AUDIENCE_SOURCE = '受众快照与 Meta 只读检查'
const CREATIVE_SOURCE = '素材库'
/** Same ceiling as AdDraft.audienceIds. */
const MAX_EXCLUDED = 10
/** At most this many ranked candidates get a status read. */
const MAX_STATUS_CANDIDATES = 3
/** Only the plays that target an existing pool get an included audience. */
const AUDIENCE_PLAYS: readonly PlayKey[] = ['warm_pool_retarget']

export interface AudienceOutcome {
  state: AudienceState
  ids: Field<string[]>
}

function empty<T>(why: string): Field<T> {
  return { ok: false, why_empty: why, notes: [] }
}

function usable(s: AudienceStatus | undefined): boolean | null {
  if (s === undefined || (s.operation === null && s.delivery === null)) return null
  return (s.operation === null || s.operation === 200) && (s.delivery === null || s.delivery === 200)
}

function rank(a: AudiencePoolItem, b: AudiencePoolItem): number {
  if (a.last_used_on !== b.last_used_on) {
    if (a.last_used_on === null) return 1
    if (b.last_used_on === null) return -1
    return a.last_used_on < b.last_used_on ? 1 : -1
  }
  return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0
}

function audienceBasis(item: AudiencePoolItem): Basis[] {
  const who = item.name ?? item.ref
  return [
    { label: '受众', value: who, source: AUDIENCE_SOURCE, as_of: item.as_of },
    // size is information only; it never decides whether the audience is picked
    { label: '人数下限（仅供参考）', value: item.size_lower === null ? '读不到' : String(item.size_lower), source: AUDIENCE_SOURCE, as_of: item.as_of },
    { label: '在投广告组还在用', value: item.last_used_on === null ? '现在没有' : `是（快照 ${item.last_used_on}）`, source: AUDIENCE_SOURCE, as_of: item.as_of },
  ]
}

/** Why the pool itself cannot be used; null when there is something to pick from. */
function poolUnreadable(f: AdsDraftFacts): string | null {
  if (f.audiences === null) return '读不到这个客户的受众池'
  if (f.audiences.length > 0) return null
  if (f.audiences_complete === true) return '这个客户名下还没有受众池'
  return '受众快照没读全，不能判断是真没有受众还是没读到'
}

/** Included audience for a retarget step: tri-state, empty unless a ranked candidate is confirmed usable. */
export function seedAudience(play: PlayKey, f: AdsDraftFacts | null, status: AudienceStatusRead | null): AudienceOutcome {
  if (!AUDIENCE_PLAYS.includes(play)) {
    return { state: 'read', ids: empty('这个打法不需要指定受众') }
  }
  const why = f === null ? '读不到这个客户的受众池' : poolUnreadable(f)
  if (f === null || why !== null || f.audiences === null) {
    return { state: 'unreadable', ids: empty(why ?? '读不到这个客户的受众池') }
  }
  const ranked = [...f.audiences].sort(rank).slice(0, MAX_STATUS_CANDIDATES)
  if (status === null || status.state === 'failed') {
    return { state: 'unreadable', ids: empty('读不到受众现在能不能投，先留空') }
  }
  const map = status.state === 'ok' ? status.value : {}
  let sawUnusable = false
  for (const item of ranked) {
    const ok = usable(map[item.ref])
    if (ok === true) {
      return { state: 'read', ids: { ok: true, value: [item.ref], basis: audienceBasis(item), notes: [] } }
    }
    if (ok === false) sawUnusable = true
  }
  if (sawUnusable) return { state: 'unusable', ids: empty('读到了受众，但状态是不可用（还没准备好或投不出去），先留空') }
  return { state: 'unreadable', ids: empty('读不到受众现在能不能投，先留空') }
}

/** Exclusion list: only audiences the account's delivering ad sets already exclude. All-or-nothing, fail closed. */
export function seedExcluded(f: AdsDraftFacts | null, status: AudienceStatusRead | null): Field<string[]> {
  const inUse = f?.excluded_in_use
  if (inUse === undefined || inUse === null) return empty('读不到在投广告组用的排除名单')
  if (inUse.length === 0) return empty('在投广告组没有用排除名单，这里不新建、不上传')
  if (status === null || status.state !== 'ok') return empty('读不到排除名单现在能不能用，先留空')
  const picked = inUse.slice(0, MAX_EXCLUDED)
  const bad = picked.filter(p => usable(status.value[p.ref]) !== true)
  if (bad.length > 0) {
    return empty(`排除名单 ${bad.map(b => b.ref).join('、')} 不可用或读不到状态；排除名单失效 = 老客人仍会看到广告，先留空`)
  }
  return {
    ok: true,
    value: picked.map(p => p.ref),
    basis: [{ label: '在投广告组已在用的排除名单', value: picked.map(p => `${p.ref}（${p.adsets} 个广告组）`).join('、'), source: AUDIENCE_SOURCE, as_of: null }],
    notes: inUse.length > MAX_EXCLUDED ? [`还有 ${inUse.length - MAX_EXCLUDED} 个没列出（最多 ${MAX_EXCLUDED} 个）`] : [],
  }
}

/** Ids the status read needs for one step: ranked candidates plus the exclusion list. */
export function audienceIdsToRead(play: PlayKey, f: AdsDraftFacts | null): string[] {
  if (f === null) return []
  const included = AUDIENCE_PLAYS.includes(play) && f.audiences ? [...f.audiences].sort(rank).slice(0, MAX_STATUS_CANDIDATES).map(a => a.ref) : []
  const excluded = (f.excluded_in_use ?? []).slice(0, MAX_EXCLUDED).map(e => e.ref)
  return [...new Set([...included, ...excluded])]
}

const VERDICT_WHY: Record<Exclude<PromoVerdict, 'ok'>, string> = {
  undeclared: '推广期没声明',
  expired: '推广期已过',
  not_started: '推广期还没开始',
  expires_before_use_end: '推广期在计划结束前就到期',
}

export interface CreativeOutcome {
  state: CreativeState
  refs: Field<string[]>
}

function creativeOk(entry: CreativePoolFact, today: string, period: { start_date: string; end_date: string }): boolean {
  return entry.status === 'approved' && promoVerdict(entry.promo_window, today, { start: period.start_date, end: period.end_date }) === 'ok'
}

/** Five states; only an approved entry whose promo window covers the period counts. 素材待批 is never a pass. */
export function seedCreatives(
  f: AdsDraftFacts | null,
  period: { start_date: string; end_date: string },
  nowMs: number,
): CreativeOutcome {
  const pool = f?.creative_pool
  if (pool === undefined || pool === null) return { state: 'unreadable', refs: empty('读不到素材池') }
  const today = nzToday(nowMs)
  const good = pool.filter(e => creativeOk(e, today, period))
  if (good.length > 0) {
    const taken = good.slice(0, f?.max_creatives ?? good.length).map(e => e.ref)
    return {
      state: 'ready',
      refs: {
        ok: true,
        value: taken,
        basis: [{ label: '素材', value: `已批准且推广期覆盖计划的共 ${good.length} 个，取了 ${taken.length} 个`, source: CREATIVE_SOURCE, as_of: null }],
        notes: [],
      },
    }
  }
  const approved = pool.filter(e => e.status === 'approved')
  if (approved.length > 0) {
    const reasons = new Set(
      approved.map(e => promoVerdict(e.promo_window, today, { start: period.start_date, end: period.end_date })).filter((v): v is Exclude<PromoVerdict, 'ok'> => v !== 'ok').map(v => VERDICT_WHY[v]),
    )
    return { state: 'window_mismatch', refs: empty(`已批准的素材没有一个能覆盖这个计划：${[...reasons].join('、')}`) }
  }
  if (pool.some(e => e.status !== 'rejected' && e.status !== 'retired')) {
    return { state: 'pending_approval', refs: empty('素材待批，还没有已批准的素材；待批不算通过') }
  }
  return { state: 'none', refs: empty('素材池里没有可用素材') }
}

/** Start and end date from the goal period. Empty when there is no period or it has already ended (NZ date). */
export function seedSchedule(
  period: { start_date: string; end_date: string } | null,
  nowMs: number,
): Field<{ start_date: string; end_date: string }> {
  if (period === null) return empty('目标没有周期，不猜起止日')
  if (period.end_date < period.start_date) return empty('目标周期的结束日早于开始日')
  const today = nzToday(nowMs)
  if (period.end_date < today) return empty(`目标周期已在 ${period.end_date} 结束`)
  return {
    ok: true,
    value: { start_date: period.start_date, end_date: period.end_date },
    basis: [{ label: '起止日', value: `${period.start_date} 至 ${period.end_date}`, source: '目标周期', as_of: null }],
    notes: period.start_date < today ? ['开始日已过，开投日以实际批准后为准'] : [],
  }
}
