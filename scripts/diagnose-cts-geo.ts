/**
 * WP05 GEO Module v1 —— CTS 真实基线**只读**诊断（Issue #879）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 全程只读，零写。绝不 UPDATE/INSERT/DELETE，绝不回写 #883，绝不 apply migration。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 用主库 service-role 凭据（不走 MCP —— MCP 连不到 magic-engine 主库）**只 select**：
 *   - CTS 基线观测 geo_observations（按 batch 过滤）
 *   - 对应证据 geo_evidence（按 observation_id）
 *   - 问句原文 geo_queries（query_key → question_text）
 *   - CTS 台账 client_site_pages
 * 然后跑 WP05 pipeline（evidence→M1→finding→prescription→candidate→page-request，
 * fail-closed 租户闸），可读地打印 CTS 真实诊断。
 *
 * 运行（由协调会话发起，PO 放行权限弹窗）：
 *   cd <worktree 根>
 *   npx tsx scripts/diagnose-roman-geo.ts
 *
 * 需要 .env.local 里的 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY。
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { runGeoModule, type GeoEntityProfile, type GeoObservationRecord, type SitePageRow } from '../src/lib/geo-module'
import type { GeoEvidenceRow, GeoObservationRow } from '../src/lib/geo-measurement-store/types'
import type { GrowthMaybeUnknown } from '../src/lib/growth'

const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CTS_BATCH_ID = '77124a10-d22b-4722-94c2-aeae69f73d76'

/**
 * CTS 显式 entity profile —— shared GEO Module 已 de-hardcode，CTS 调用方必须显式传。
 * 字段值由 PM 2026-09-04 提供（官方名 CTS Tours；别名 UNKNOWN 暂空；行业/地域锚点见下）。
 */
const CTS_ENTITY_PROFILE: GeoEntityProfile = {
  canonicalDisplayName: 'CTS Tours',
  // 行业锚点：PM 2026-09-04 定稿。中文「旅游 / 入境旅游」→ 英文；tour/tours/travel 是 AI 答案
  // 描述 CTS 时实际使用的词（锚点敏感度探针实证：覆盖全部 13 条正文提及的最小集）。
  disambiguationAnchors: ['tourism', 'inbound tourism', 'tour', 'tours', 'travel'],
  geoAnchorsMultiword: ['new zealand', 'auckland'],
  geoAnchorsShortWordBoundary: ['nz'],
}

// ── 极简 .env.local 解析（不引 dotenv 依赖）────────────────────────────────────

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

// ── 只读客户端 ────────────────────────────────────────────────────────────────

function makeReadOnlyClient(): SupabaseClient {
  const env = loadEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('缺 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY —— 无法连主库')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

/** 查询失败一律抛（绝不把「查炸了」当「没有」）。 */
function orThrow<T>(op: string, data: T | null, error: { message?: string } | null): T {
  if (error) throw new Error(`${op} 失败：${error.message ?? '未知错误'}`)
  if (data === null) throw new Error(`${op} 返回 null data 且无 error —— 客户端行为异常`)
  return data
}

// ── 读取（全部 select，零写）──────────────────────────────────────────────────

async function fetchObservations(sb: SupabaseClient): Promise<GeoObservationRow[]> {
  const { data, error } = await sb
    .from('geo_observations')
    .select('*')
    .eq('client_id', CTS_CLIENT_ID)
    .eq('batch_id', CTS_BATCH_ID)
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
      .eq('client_id', CTS_CLIENT_ID)
      .in('observation_id', chunk)
    const rows = orThrow('读 geo_evidence', data, error) as GeoEvidenceRow[]
    for (const row of rows) map.set(row.observation_id, row)
  }
  return map
}

/** 读该批次所属的查询集 id —— 问句必须限定到这个集合（query_key 只在单个集合内唯一）。 */
async function fetchBatchQuerySetId(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb
    .from('geo_batches')
    .select('query_set_id')
    .eq('client_id', CTS_CLIENT_ID)
    .eq('id', CTS_BATCH_ID)
    .limit(1)
  const rows = orThrow('读 geo_batches', data, error) as { query_set_id: string }[]
  if (rows.length === 0) throw new Error(`批次 ${CTS_BATCH_ID} 读不到 —— 无法确定查询集`)
  return rows[0].query_set_id
}

/**
 * query_key → question_text，**限定到该批次的查询集**（Codex #1032 P2）。
 * `geo_queries.query_key` 只在单个 query_set 内唯一，跨集合取会撞车。同 key 文本冲突则标未知。
 */
async function fetchQuestionMap(
  sb: SupabaseClient,
  querySetId: string,
): Promise<Map<string, GrowthMaybeUnknown<string>>> {
  const { data, error } = await sb
    .from('geo_queries')
    .select('query_key, question_text')
    .eq('client_id', CTS_CLIENT_ID)
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
    .eq('client_id', CTS_CLIENT_ID)
    .order('url', { ascending: true })
  return orThrow('读 client_site_pages', data, error) as SitePageRow[]
}

// ── 组装 + 跑 pipeline ────────────────────────────────────────────────────────

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

// ── 打印 ──────────────────────────────────────────────────────────────────────

function line(s = ''): void {
  process.stdout.write(s + '\n')
}

function main(): void {
  const sb = makeReadOnlyClient()

  Promise.resolve()
    .then(async () => {
      line('══════════════════════════════════════════════════════════════════')
      line('WP05 GEO Module v1 —— CTS 真实基线只读诊断')
      line(`client_id=${CTS_CLIENT_ID}  batch=${CTS_BATCH_ID}`)
      line('🔴 只读：本脚本不写任何表、不回写 #883、不 apply migration。')
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

      // 目标页取台账第一条（真实存在的页）；intents 留空 —— WP05 不凭空造文案，
      // 所以预期诚实 defer 到 unattributable_proposed_value，但链会带全到 candidate。
      const targetPageUrl = ledgerPages.length > 0 ? ledgerPages[0].url : ''

      const outcome = runGeoModule({
        clientId: CTS_CLIENT_ID,
        records,
        entityProfile: CTS_ENTITY_PROFILE, // CTS 显式传（shared runtime 无 CTS fallback）
        brandAliases: [], // 权威注册表当前为空（M1 §1）
        ledgerPages,
        target: { pageUrl: targetPageUrl, intents: [] },
      })

      // ② 每观测 M1 判定
      line('\n② 每观测 M1 判定（geo-module/m1/v1）')
      for (const it of outcome.chain.interpretations) {
        const qk = it.queryKey.known ? it.queryKey.value : `(unknown:${it.queryKey.reason})`
        line(`   · ${it.observationId} [query=${qk} locale=${it.locale.known ? it.locale.value : '?'}]`)
        line(`     disposition=${it.disposition}  entity=${it.entityMatch.kind}  disambig=${it.disambiguation.qualified}`)
        line(`     qualified_mention=${it.qualifiedMention.qualified}  recommendation=${it.recommendation}  rank=${it.rank.status}${it.rank.status === 'computed' ? `(#${it.rank.position})` : ''}`)
        line(`     reasons=[${it.reasonCodes.join(', ')}]`)
      }

      // ③ 聚合 finding
      line('\n③ 聚合覆盖 + Finding')
      const cov = outcome.chain.coverage
      line(`   query 数=${cov.queryCount}  可解释 query=${cov.interpretableQueries}（覆盖率分母）  合格提及 query=${cov.qualifiedMentionQueries}  explicit_positive query=${cov.explicitPositiveQueries}  conditional query=${cov.conditionalQueries}  全 defer query=${cov.fullyDeferredQueries}`)
      if (outcome.chain.finding) {
        const f = outcome.chain.finding
        line(`   Finding：支柱=${f.pillar}  严重度=${f.severity}  证据数=${f.evidence.length}`)
        line(`   陈述：${f.statement}`)
      } else {
        line('   Finding：无（证据不足，未构建）')
      }

      // ④ prescription
      line('\n④ Prescription')
      if (outcome.chain.prescription) {
        const p = outcome.chain.prescription
        line(`   覆盖 finding 数=${p.covers.length}  刻意不做=${p.notDoing.length} 条`)
        for (const nd of p.notDoing) line(`     ✗ ${nd.statement}（因：${nd.reason}）`)
        line(`   排序理由：${p.orderingRationale}`)
      } else {
        line('   无')
      }

      // ⑤ candidate + PageOptimizationRequest / defer
      line('\n⑤ ActionCandidate + PageOptimizationRequest')
      if (outcome.chain.candidate) {
        const c = outcome.chain.candidate
        line(`   候选身份：${c.identity.domain}/${c.identity.intent}  预期影响=${c.expectedImpact}  花钱=${c.cost.spendsMoney}`)
        line(`   input=${JSON.stringify(c.input)}`)
        line(`   verification.metricRef=${c.verification.metricRef}  window=${c.verification.windowDays}d`)
      } else {
        line('   候选：无（未到构建条件）')
      }
      if (outcome.ok) {
        line(`   ✅ PageOptimizationRequest 产出：page=${outcome.request.page.url}`)
        line(`      intents=${outcome.request.intents.length}  doNotTouch=[${outcome.request.constraints.doNotTouch.join(', ')}]`)
        line(`      lineage.findingRefs=[${outcome.request.lineage.findingRefs.join(', ')}]`)
      } else if (outcome.disposition === 'no_gap') {
        line('   ✅ 无可见度缺口（可解释覆盖已满）—— 不产出 finding / 请求。这是正向结论，不是 defer。')
      } else {
        line(`   ⏸️ 诚实 defer：reason=${outcome.reason}`)
        line('      （intents 留空是刻意的：WP05 只推理、不凭空造页面文案；proposedValue 须上游 grounding 后传入。）')
      }

      // ⑥ 汇总统计 vs 冻结基线
      line('\n⑥ 汇总统计（对照冻结基线，绝不把 citation 当 mention）')
      const totalObs = outcome.chain.interpretations.length
      const deferred = outcome.chain.interpretations.filter((i) => i.disposition === 'defer').length
      const mentionObs = outcome.chain.interpretations.filter((i) => i.qualifiedMention.qualified).length
      const posObs = outcome.chain.interpretations.filter((i) => i.recommendation === 'explicit_positive').length
      line(`   观测：${totalObs}  其中 defer=${deferred}  合格提及（观测级）=${mentionObs}  explicit_positive（观测级）=${posObs}`)
      line(`   query 级：${cov.queryCount} 问里合格提及 ${cov.qualifiedMentionQueries} 个、正向推荐 ${cov.explicitPositiveQueries} 个。`)
      line('   注：冻结基线的「owned citation 2/12」是**引用**覆盖，M1 §7 明令不得当作提及/推荐 —— 上面两数与它不可混。')
      line('\n完成。全程只读，未写任何数据。')
    })
    .catch((err) => {
      line(`\n🔴 诊断中止：${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    })
}

main()
