/**
 * Roman 两批观测对比（放在 scripts/ 里能找到项目依赖）
 *
 * 🔴 全程只读，零写。
 * 🔴 `geo_observations` 没有 `entity_match` / `qualified_mention` 字段，`geo_evidence` 也没有
 *    `cited_domains` —— 这些都是 GEO Module v1（`runGeoModule`）推导出来的解释结果，不是
 *    库里的原始列。跟 `diagnose-roman-geo-batch.ts` 一样，先把两批观测各自喂给 `runGeoModule`，
 *    再从 `chain.interpretations` 读 entity / 合格提及，从证据的 `citations` 读引用域名。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  runGeoModule,
  type GeoEntityProfile,
  type GeoObservationInterpretation,
  type GeoObservationRecord,
  type SitePageRow,
} from '../src/lib/geo-module'
import type { GeoCitation } from '../src/lib/geo-measurement/types'
import type { GeoEvidenceRow, GeoObservationRow } from '../src/lib/geo-measurement-store/types'
import type { GrowthMaybeUnknown } from '../src/lib/growth'

const ROMAN_CLIENT_ID = 'e7465ac7-4f3d-4d6a-afbe-d036ab419708'
const OLD_BATCH = '688bd8ae-2db6-4300-b761-b850f30c32c5'
const NEW_BATCH = '41952296-9d26-458a-92f0-250200985f3a'

const ROMAN_ENTITY_PROFILE: GeoEntityProfile = {
  canonicalDisplayName: 'Roman Hu',
  disambiguationAnchors: ['real estate', 'realtor', 'realty', 'ray white'],
  geoAnchorsMultiword: ['auckland', 'new zealand', 'aotearoa'],
  geoAnchorsShortWordBoundary: ['nz'],
}

function loadEnv(): Record<string, string> {
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
  const env = loadEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('缺 Supabase 凭据')
  return createClient(url, key, { auth: { persistSession: false } })
}

function orThrow<T>(op: string, data: T | null, error: { message?: string } | null): T {
  if (error) throw new Error(`${op} 失败：${error.message ?? '未知错误'}`)
  if (data === null) throw new Error(`${op} 返回 null data 且无 error`)
  return data
}

async function fetchObservations(sb: SupabaseClient, batchId: string): Promise<GeoObservationRow[]> {
  const { data, error } = await sb
    .from('geo_observations')
    .select('*')
    .eq('client_id', ROMAN_CLIENT_ID)
    .eq('batch_id', batchId)
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

async function fetchBatchQuerySetId(sb: SupabaseClient, batchId: string): Promise<string> {
  const { data, error } = await sb
    .from('geo_batches')
    .select('query_set_id')
    .eq('client_id', ROMAN_CLIENT_ID)
    .eq('id', batchId)
    .limit(1)
  const rows = orThrow('读 geo_batches', data, error) as { query_set_id: string }[]
  if (rows.length === 0) throw new Error(`批次 ${batchId} 读不到`)
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

interface BatchResult {
  readonly interpretations: readonly GeoObservationInterpretation[]
  readonly citedDomainsByObs: Map<string, readonly string[]>
}

/** 读一批的观测/证据，喂给 GEO Module v1，取回 entity / 合格提及的解释结果与引用域名。 */
async function loadBatch(sb: SupabaseClient, batchId: string): Promise<BatchResult> {
  const observations = await fetchObservations(sb, batchId)
  const evidenceByObs = await fetchEvidence(sb, observations.map((o) => o.id))
  const querySetId = await fetchBatchQuerySetId(sb, batchId)
  const questionMap = await fetchQuestionMap(sb, querySetId)
  const ledgerPages = await fetchLedgerPages(sb)
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

  const citedDomainsByObs = new Map<string, readonly string[]>()
  for (const observation of observations) {
    const citations = (evidenceByObs.get(observation.id)?.citations ?? []) as readonly GeoCitation[]
    citedDomainsByObs.set(observation.id, citations.map((c) => c.domain))
  }

  return { interpretations: outcome.chain.interpretations, citedDomainsByObs }
}

function queryKeyOf(it: GeoObservationInterpretation): string {
  return it.queryKey.known ? it.queryKey.value : 'unknown'
}

function line(s = ''): void {
  process.stdout.write(s + '\n')
}

function printBatch(label: string, result: BatchResult): void {
  const sorted = [...result.interpretations].sort((a, b) => queryKeyOf(a).localeCompare(queryKeyOf(b)))
  line(`│ ${label}`)
  line(`│ ─────────────────────────────────────────────────────`)
  for (const it of sorted) {
    const cited = result.citedDomainsByObs.get(it.observationId) ?? []
    const qualified = it.qualifiedMention.qualified ? '✓' : '✗'
    const citedText = cited.length > 0 ? cited.slice(0, 2).join(', ') : '-'
    line(
      `│   ${queryKeyOf(it).slice(0, 12)}... ${qualified} entity=${it.entityMatch.kind} cited=[${citedText}${cited.length > 2 ? '...' : ''}]`,
    )
  }
}

async function main() {
  const sb = makeReadOnlyClient()

  line('╭─ Roman 两批观测对比（经 GEO Module v1 解释）───────────')
  line('│')

  const old = await loadBatch(sb, OLD_BATCH)
  const newBatch = await loadBatch(sb, NEW_BATCH)

  printBatch(`旧批次 ${OLD_BATCH.slice(0, 8)}... (2026-08-12 基线)`, old)
  line(`│`)
  printBatch(`新批次 ${NEW_BATCH.slice(0, 8)}... (2026-09-28)`, newBatch)

  line(`│`)
  line(`│ 变化汇总`)
  line(`│ ─────────────────────────────────────────────────────`)

  const oldQualified = old.interpretations.filter((it) => it.qualifiedMention.qualified).length
  const newQualified = newBatch.interpretations.filter((it) => it.qualifiedMention.qualified).length

  line(`│   合格提及观测：${oldQualified} → ${newQualified} (+${newQualified - oldQualified})`)

  const oldQualKeys = new Set(
    old.interpretations.filter((it) => it.qualifiedMention.qualified).map((it) => queryKeyOf(it)),
  )
  const newQualKeys = newBatch.interpretations
    .filter((it) => it.qualifiedMention.qualified)
    .map((it) => queryKeyOf(it))
  const deltaKeys = newQualKeys.filter((k) => !oldQualKeys.has(k))

  if (deltaKeys.length > 0) {
    line(`│`)
    line(`│   新增合格提及的引用源：`)
    for (const key of deltaKeys) {
      const it = newBatch.interpretations.find((i) => queryKeyOf(i) === key)
      const cited = it ? (newBatch.citedDomainsByObs.get(it.observationId) ?? []) : []
      line(`│     · query_key=${key.slice(0, 12)}...`)
      line(`│       sources: ${cited.length > 0 ? cited.join(', ') : '(direct answer)'}`)
    }
  }

  line(`│`)
  line('╰─────────────────────────────────────────────────────')
}

main().catch((err) => {
  console.error('❌', err.message)
  process.exit(1)
})
