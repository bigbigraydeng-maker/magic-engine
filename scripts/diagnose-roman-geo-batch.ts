/**
 * WP05 GEO Module v1 —— Roman 可选 batch_id 诊断（基于 scripts/diagnose-roman-geo.ts）
 *
 * 🔴 全程只读，零写。绝不 UPDATE/INSERT/DELETE。
 *
 * 用法：
 *   ROMAN_BATCH_ID=<batch_uuid> npx tsx --env-file=.env.local scripts/diagnose-roman-geo-batch.ts
 *   或
 *   npx tsx --env-file=.env.local scripts/diagnose-roman-geo-batch.ts <batch_uuid>
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { runGeoModule, type GeoEntityProfile, type GeoObservationRecord, type SitePageRow } from '../src/lib/geo-module'
import type { GeoEvidenceRow, GeoObservationRow } from '../src/lib/geo-measurement-store/types'
import type { GrowthMaybeUnknown } from '../src/lib/growth'

const ROMAN_CLIENT_ID = 'e7465ac7-4f3d-4d6a-afbe-d036ab419708'
// 可通过环境变量或命令行参数指定
const ROMAN_BATCH_ID = process.argv[2] || process.env.ROMAN_BATCH_ID || '688bd8ae-2db6-4300-b761-b850f30c32c5'

const ROMAN_ENTITY_PROFILE: GeoEntityProfile = {
  canonicalDisplayName: 'Roman Hu',
  disambiguationAnchors: ['real estate', 'realtor', 'realty', 'ray white'],
  geoAnchorsMultiword: ['auckland', 'new zealand', 'aotearoa'],
  geoAnchorsShortWordBoundary: ['nz'],
}

function loadEnvLocal(): Record<string, string> {
  const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

function makeReadOnlyClient(): SupabaseClient {
  const env = loadEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('缺 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

function orThrow<T>(op: string, data: T | null, error: { message?: string } | null): T {
  if (error) throw new Error(`${op} 失败：${error.message ?? '未知错误'}`)
  if (data === null) throw new Error(`${op} 返回 null data 且无 error`)
  return data
}

async function fetchObservations(sb: SupabaseClient): Promise<GeoObservationRow[]> {
  const { data, error } = await sb
    .from('geo_observations')
    .select('*')
    .eq('client_id', ROMAN_CLIENT_ID)
    .eq('batch_id', ROMAN_BATCH_ID)
    .order('observed_at', { ascending: true })
  return orThrow('读 geo_observations', data, error) as GeoObservationRow[]
}

async function fetchEvidence(sb: SupabaseClient, observationIds: string[]): Promise<Map<string, GeoEvidenceRow>> {
  const map = new Map<string, GeoEvidenceRow>()
  const CHUNK = 50
  for (let i = 0; i < observationIds.length; i += CHUNK) {
    const chunk = observationIds.slice(i, i + CHUNK)
    const { data, error } = await sb
      .from('geo_evidence')
      .select('*')
      .eq('client_id', ROMAN_CLIENT_ID)
      .in('observation_id', chunk)
    const rows = orThrow('读 geo_evidence', data, error) as GeoEvidenceRow[]
    for (const row of rows) map.set(row.observation_id, row)
  }
  return map
}

async function fetchBatchQuerySetId(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb
    .from('geo_batches')
    .select('query_set_id')
    .eq('client_id', ROMAN_CLIENT_ID)
    .eq('id', ROMAN_BATCH_ID)
    .limit(1)
  const rows = orThrow('读 geo_batches', data, error) as { query_set_id: string }[]
  if (rows.length === 0) throw new Error(`批次 ${ROMAN_BATCH_ID} 读不到`)
  return rows[0].query_set_id
}

async function fetchQuestionMap(
  sb: SupabaseClient,
  querySetId: string,
): Promise<Map<string, GrowthMaybeUnknown<string>>> {
  const { data, error } = await sb
    .from('geo_queries')
    .select('query_key, question_text')
    .eq('client_id', ROMAN_CLIENT_ID)
    .eq('query_set_id', querySetId)
  const rows = orThrow('读 geo_queries', data, error) as { query_key: string; question_text: string }[]
  const seen = new Map<string, string>()
  const conflict = new Set<string>()
  for (const r of rows) {
    const prev = seen.get(r.query_key)
    if (prev !== undefined && prev !== r.question_text) conflict.add(r.query_key)
    else seen.set(r.query_key, r.question_text)
  }
  const map = new Map<string, GrowthMaybeUnknown<string>>()
  for (const [k, v] of Array.from(seen.entries())) {
    map.set(k, conflict.has(k) ? { known: false, reason: 'source_ambiguous' } : { known: true, value: v })
  }
  return map
}

async function fetchLedgerPages(sb: SupabaseClient): Promise<SitePageRow[]> {
  const { data, error } = await sb
    .from('client_site_pages')
    .select('client_id, url')
    .eq('client_id', ROMAN_CLIENT_ID)
    .order('url', { ascending: true })
  return orThrow('读 client_site_pages', data, error) as SitePageRow[]
}

function assembleRecords(
  observations: GeoObservationRow[],
  evidenceByObs: Map<string, GeoEvidenceRow>,
  questionMap: Map<string, GrowthMaybeUnknown<string>>,
): GeoObservationRecord[] {
  return observations.map((observation) => {
    const evidence = evidenceByObs.get(observation.id) ?? null
    const questionText: GrowthMaybeUnknown<string> =
      observation.query_key !== null
        ? questionMap.get(observation.query_key) ?? { known: false, reason: 'not_recorded_by_source' }
        : { known: false, reason: 'not_recorded_by_source' }
    return { observation, evidence, questionText }
  })
}

function line(s = ''): void {
  process.stdout.write(s + '\n')
}

function main(): void {
  const sb = makeReadOnlyClient()

  Promise.resolve()
    .then(async () => {
      line('══════════════════════════════════════════════════════════════════')
      line('WP05 GEO Module v1 —— Roman 诊断')
      line(`client_id=${ROMAN_CLIENT_ID}  batch=${ROMAN_BATCH_ID.slice(0, 8)}...`)
      line('🔴 只读：本脚本不写任何表。')
      line('══════════════════════════════════════════════════════════════════')

      const observations = await fetchObservations(sb)
      line(`\n① 基线观测：${observations.length} 条`)
      if (observations.length === 0) {
        line('⚠️ 该批次下读不到观测 —— 请核对 batch_id / client_id（不是「没有」，是没读到）。')
        return
      }
      const evidenceByObs = await fetchEvidence(sb, observations.map((o) => o.id))
      const querySetId = await fetchBatchQuerySetId(sb)
      const questionMap = await fetchQuestionMap(sb, querySetId)
      const ledgerPages = await fetchLedgerPages(sb)
      line(`   证据行：${evidenceByObs.size}  ·  问句映射：${questionMap.size}  ·  台账页：${ledgerPages.length}`)

      const records = assembleRecords(observations, evidenceByObs, questionMap)
      const targetPageUrl = ledgerPages.length > 0 ? ledgerPages[0].url : ''

      const outcome = runGeoModule({
        clientId: ROMAN_CLIENT_ID,
        records,
        entityProfile: ROMAN_ENTITY_PROFILE,
        brandAliases: [],
        ledgerPages,
        target: { pageUrl: targetPageUrl, intents: [] },
      })

      // ② 每观测 M1 判定
      line('\n② 每观测 M1 判定')
      for (const it of outcome.chain.interpretations) {
        const qk = it.queryKey.known ? it.queryKey.value : `(unknown:${it.queryKey.reason})`
        line(`   · ${it.observationId} [query=${qk} locale=${it.locale.known ? it.locale.value : '?'}]`)
        line(`     disposition=${it.disposition}  entity=${it.entityMatch.kind}  disambig=${it.disambiguation.qualified}`)
        line(`     qualified_mention=${it.qualifiedMention.qualified}  recommendation=${it.recommendation}  rank=${it.rank.status}${it.rank.status === 'computed' ? `(#${it.rank.position})` : ''}`)
        line(`     reasons=[${it.reasonCodes.join(', ')}]`)
      }

      // ③ 聚合覆盖
      line('\n③ 聚合覆盖')
      const cov = outcome.chain.coverage
      line(
        `   query 数=${cov.queryCount}  合格提及=${cov.qualifiedMentionQueries}  explicit_positive=${cov.explicitPositiveQueries}  defer=${cov.fullyDeferredQueries}`,
      )

      // ⑥ 汇总统计
      line('\n④ 汇总（简版）')
      const totalObs = outcome.chain.interpretations.length
      const deferred = outcome.chain.interpretations.filter((i) => i.disposition === 'defer').length
      const mentionObs = outcome.chain.interpretations.filter((i) => i.qualifiedMention.qualified).length
      const posObs = outcome.chain.interpretations.filter((i) => i.recommendation === 'explicit_positive').length
      line(`   观测：${totalObs}  defer=${deferred}  合格提及（观测级）=${mentionObs}  explicit_positive=${posObs}`)
      line(
        `   query 级：${cov.queryCount} 问里合格提及 ${cov.qualifiedMentionQueries} 个、正向推荐 ${cov.explicitPositiveQueries} 个。`,
      )

      line('\n完成。全程只读。')
    })
    .catch((err) => {
      line(`\n🔴 诊断中止：${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    })
}

main()
