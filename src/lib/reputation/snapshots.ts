/**
 * Weekly reputation capture (DataForSEO 接入计划 阶段 2).
 *
 * 对每个配了口碑身份的 active 客户：
 *   - 客户自己（gbp_place_id 精确身份，缺了用 "name city country" 关键词兜底）
 *   - 竞品（clients.competitor_gbp 数组，Settings 页配置）
 *   - Tripadvisor（clients.tripadvisor_keyword，旅游类客户）
 * 每实体一行 reputation_snapshots（评分/评论数）+ 增量 review_items（评论明细）。
 *
 * is_new 语义 = "本轮采集新出现"：本轮开始先把该客户的旧 is_new 全翻 false，
 * 再用 ignoreDuplicates upsert —— 只有真正首见的评论行落库且 is_new=true。
 *
 * 范围铁律（spec 魏征 ⚠️2）：只做快照落库，不动华佗 scoreReputation 生产路径。
 *
 * spec: docs/superpowers/specs/2026-08-01-dataforseo-integration-plan.md § 阶段 2
 */

import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import {
  getGbpReviewsByIdentity,
  getGmbInfo,
  getTripadvisorSnapshot,
  type GbpReviewItem,
} from '@/lib/dataforseo/business-data'

export interface ReputationClient {
  id: string
  name: string
  city: string | null
  country: string | null
  gbp_place_id: string | null
  tripadvisor_keyword: string | null
  competitor_gbp: unknown
}

export interface CompetitorGbpEntry {
  name: string
  place_id: string
}

export interface ReputationEntity {
  entity_type: 'client' | 'competitor'
  name: string
  place_id: string | null
}

export interface ReputationSnapshotRow {
  client_id: string
  entity_type: 'client' | 'competitor'
  entity_name: string
  place_id: string | null
  source: 'gbp' | 'tripadvisor' | 'trustpilot'
  rating: number | null
  review_count: number | null
  snapshot_date: string
  measured_at: string
}

export interface ReviewItemRow {
  client_id: string
  entity_type: 'client' | 'competitor'
  entity_name: string
  source: 'gbp' | 'tripadvisor' | 'trustpilot'
  review_uid: string
  author: string | null
  rating: number | null
  text: string | null
  review_date: string | null
}

export interface ReputationCaptureResult {
  client_id: string
  entities_captured: number
  entities_failed: number
  snapshots_written: number
  reviews_written: number
}

// ── Pure helpers ────────────────────────────────────────────────────────────────

/** competitor_gbp jsonb → 合法条目（name + place_id 都非空才算）。 */
export function parseCompetitorGbp(raw: unknown): CompetitorGbpEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (e): e is CompetitorGbpEntry =>
      typeof e === 'object' && e !== null &&
      typeof (e as CompetitorGbpEntry).name === 'string' &&
      (e as CompetitorGbpEntry).name.trim().length > 0 &&
      typeof (e as CompetitorGbpEntry).place_id === 'string' &&
      (e as CompetitorGbpEntry).place_id.trim().length > 0,
  )
}

/** 客户 + 竞品 → 待采集实体列表。 */
export function buildEntities(client: ReputationClient): ReputationEntity[] {
  const entities: ReputationEntity[] = [
    { entity_type: 'client', name: client.name, place_id: client.gbp_place_id },
  ]
  for (const comp of parseCompetitorGbp(client.competitor_gbp)) {
    entities.push({ entity_type: 'competitor', name: comp.name, place_id: comp.place_id })
  }
  return entities
}

/** 无 place_id 时的 GBP 搜索词 —— 与 scoreReputation 现状同款 "name city country"。 */
export function gbpKeywordFor(client: { name: string; city: string | null; country: string | null }): string {
  return [client.name, client.city, client.country].filter(Boolean).join(' ')
}

/** API review_id 缺失时的稳定去重键：author+date+文本前缀哈希。 */
export function reviewUid(review: GbpReviewItem): string {
  if (review.review_id) return review.review_id
  const basis = `${review.author ?? ''}|${review.date ?? ''}|${review.text.slice(0, 80)}`
  return `h_${createHash('sha256').update(basis).digest('hex').slice(0, 24)}`
}

// ── Orchestration ───────────────────────────────────────────────────────────────

/** 有任何口碑身份配置才值得跑（成本闸门：没配的客户一分不花）。 */
export function hasReputationIdentity(client: ReputationClient): boolean {
  return (
    (client.gbp_place_id ?? '').trim().length > 0 ||
    (client.tripadvisor_keyword ?? '').trim().length > 0 ||
    parseCompetitorGbp(client.competitor_gbp).length > 0
  )
}

export async function captureReputationForClient(
  client: ReputationClient,
): Promise<ReputationCaptureResult> {
  const result: ReputationCaptureResult = {
    client_id: client.id,
    entities_captured: 0,
    entities_failed: 0,
    snapshots_written: 0,
    reviews_written: 0,
  }

  const measuredAt = new Date()
  const measuredAtIso = measuredAt.toISOString()
  const snapshotDate = measuredAtIso.slice(0, 10)

  // 本轮开始：上轮的"新评论"退位（is_new 只表示最近一轮新增）
  const { error: flipErr } = await supabaseAdmin
    .from('review_items')
    .update({ is_new: false })
    .eq('client_id', client.id)
    .eq('is_new', true)
  if (flipErr) {
    throw new Error(`review_items is_new flip failed: ${flipErr.message}`)
  }

  const snapshotRows: ReputationSnapshotRow[] = []
  const reviewRows: ReviewItemRow[] = []

  // 评论走 DataForSEO 队列模式（无 live，实测 404），单任务 ~40-60s 才出结果。
  // 实体并发提交各自的任务再各自等结果 —— 每客户墙钟 ≈ 一个任务的时长，
  // 顺序跑的话 3 实体就要 3 分钟，8 客户直接顶穿 cron 900s 预算。
  const isNz = (client.country ?? '').toUpperCase() === 'NZ'
  const locationCode = isNz ? 2554 : 2036
  const entities = buildEntities(client)

  // Tripadvisor（配了才拉 —— 旅游类客户）。同为 40-240s 的队列任务，
  // 与实体批并发提交，不串行挂在后面白等一轮（魏征 🟡3）
  const taKeyword = (client.tripadvisor_keyword ?? '').trim()
  const taPromise = taKeyword
    ? getTripadvisorSnapshot(taKeyword, { locationName: isNz ? 'New Zealand' : 'Australia' })
        .then(ta => ({ ta, taError: null as string | null }))
        .catch((err: unknown) => ({
          ta: null,
          taError: err instanceof Error ? err.message : String(err),
        }))
    : null

  const entityOutcomes = await Promise.all(
    entities.map(async entity => {
      try {
        const identity = entity.place_id
          ? { place_id: entity.place_id }
          : entity.entity_type === 'client'
            ? { keyword: gbpKeywordFor(client) }
            : { keyword: entity.name }

        const gbp = await getGbpReviewsByIdentity(identity, 30, { locationCode })

        // 评论结果没带档案时（部分商家）补一发 my_business_info。
        // 它只收 keyword —— 绝不能把 place_id 字符串塞进去搜（会搜出错商家，魏征 🔴1）
        let profile = gbp?.profile ?? null
        if (!profile) {
          const fallbackKeyword =
            entity.entity_type === 'client' ? gbpKeywordFor(client) : entity.name
          const info = await getGmbInfo(fallbackKeyword)
          if (info) profile = { rating: info.rating, review_count: info.review_count }
        }

        return { entity, gbp, profile }
      } catch (err) {
        console.error(
          `[reputation] entity "${entity.name}" (${entity.entity_type}) failed:`,
          err instanceof Error ? err.message : err,
        )
        return { entity, gbp: null, profile: null, failed: true as const }
      }
    }),
  )

  for (const outcome of entityOutcomes) {
    const { entity, gbp, profile } = outcome
    if ('failed' in outcome || (!profile && !(gbp && gbp.reviews.length > 0))) {
      result.entities_failed++
      continue
    }
    snapshotRows.push({
      client_id: client.id,
      entity_type: entity.entity_type,
      entity_name: entity.name,
      place_id: entity.place_id,
      source: 'gbp',
      rating: profile?.rating ?? null,
      review_count: profile?.review_count ?? null,
      snapshot_date: snapshotDate,
      measured_at: measuredAtIso,
    })
    for (const review of gbp?.reviews ?? []) {
      reviewRows.push({
        client_id: client.id,
        entity_type: entity.entity_type,
        entity_name: entity.name,
        source: 'gbp',
        review_uid: reviewUid(review),
        author: review.author,
        rating: review.rating,
        text: review.text || null,
        review_date: review.date,
      })
    }
    result.entities_captured++
  }

  if (taPromise) {
    const { ta, taError } = await taPromise
    if (taError) {
      console.error('[reputation] tripadvisor failed:', taError)
      result.entities_failed++
    } else if (ta && (ta.rating !== null || ta.review_count !== null)) {
      snapshotRows.push({
        client_id: client.id,
        entity_type: 'client',
        entity_name: ta.name ?? client.name,
        place_id: null,
        source: 'tripadvisor',
        rating: ta.rating,
        review_count: ta.review_count,
        snapshot_date: snapshotDate,
        measured_at: measuredAtIso,
      })
      result.entities_captured++
    } else {
      // 搜不到同名 listing（getTripadvisorSnapshot 按名字匹配，绝不拿第一条充数）
      result.entities_failed++
    }
  }

  // 全实体失败 = 这个客户本周 0 数据 —— 必须响，不能记成 completed
  // （daily-cron-digest 51 天静默事故的同款盲区：跑了但全空也算成功）
  if (result.entities_captured === 0 && result.entities_failed > 0) {
    throw new Error(
      `all ${result.entities_failed} entities failed — check place_id / identity config`,
    )
  }

  if (snapshotRows.length > 0) {
    const { data: written, error: snapErr } = await supabaseAdmin
      .from('reputation_snapshots')
      .upsert(snapshotRows, {
        onConflict: 'client_id,entity_type,entity_name,source,snapshot_date',
      })
      .select('id')
    if (snapErr) {
      throw new Error(`reputation_snapshots upsert failed: ${snapErr.message}`)
    }
    result.snapshots_written = written?.length ?? snapshotRows.length
  }

  if (reviewRows.length > 0) {
    // ignoreDuplicates：已见过的评论行原样保留（is_new 不被顶回 true）
    const { data: inserted, error: revErr } = await supabaseAdmin
      .from('review_items')
      .upsert(reviewRows, {
        onConflict: 'client_id,entity_type,entity_name,source,review_uid',
        ignoreDuplicates: true,
      })
      .select('id')
    if (revErr) {
      throw new Error(`review_items upsert failed: ${revErr.message}`)
    }
    result.reviews_written = inserted?.length ?? 0
  }

  return result
}
