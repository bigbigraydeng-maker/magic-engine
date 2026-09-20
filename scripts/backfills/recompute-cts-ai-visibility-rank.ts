/**
 * 一次性回填：用修好的判定规则重算 CTS Tours NZ 的历史「客户排第几」
 * （`ai_visibility_runs.client_brand_rank` + `brands_mentioned`）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 默认 DRY-RUN（只读）。要写生产库必须同时给 `--apply --confirm --out <持久路径>`。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 背景：旧流程有两个 bug（PR #1823 / #1837 已修，merge commit 3644e7db）：
 *   ① 解析器把客户品牌名写进提示词，模型会把客户塞进根本没提到它的回答里 → 误记；
 *   ② 旧的「品牌名互相包含」比对太松 → 别的品牌冒领客户。
 * 修复只影响「以后新跑的」，历史行仍是旧判定。本脚本按新规则
 * （`src/lib/ai-tracker/client-brand-match.ts` 的 `resolveClientBrandRank`，纯函数、无副作用）
 * 离线重算，只改判定结果与现存值不同的行。
 *
 * 授权范围（PM 2026-09-20）：**只做 CTS 一个客户**。全库其余客户的同类问题不在本次授权内。
 * 所以这个脚本**故意不做成 `--client <id>` 可传参的**：参数化等于把「越界到别的客户」
 * 做成一条命令的距离。要泛化，等 PM 单独授权。
 *
 * 两条跳过规则（都是「没有证据就不判断」的同一个道理，子牙复审 2026-09-20 定）：
 *
 *   A. **没存原文的行跳过**。AI 调用当时失败、`raw_response` 是空的，
 *      既不能证明提到也不能证明没提到，改它等于凭空判断。
 *
 *   B. **原文有、但品牌列表是空的行跳过**。这类行是当年解析器整条失败留下的
 *      （根因：`parse_error_message` 这一列的 migration 从没在生产库跑过，
 *      orchestrator 写这一列的 update 被数据库整条拒掉且没检查返回错误）。
 *      没有竞品列表就没有「排第几」的参照系 —— 硬补出来的名次必然是「第 1 名」，
 *      实测 203 条全部会被补成第 1 名，抽样核对至少 10% 的原文里客户前面还列着别家公司。
 *      而且 `brands_mentioned` 会从空数组变成**只含客户一条**，周报表的品牌排行
 *      （进月报、客户看得到）就会在这些回答里只记客户、一家竞品都不记 —— 系统性偏向客户，
 *      违反 CLAUDE.md 铁律 8「绝不凭空注入客户业务数据」。
 *      这些行的正确修法是**拿原文重跑一次解析器**，那是另一件事，不在本次回填里。
 *
 * 其他安全闸：
 *   - 只 UPDATE `client_brand_rank` 和 `brands_mentioned` 两列，不碰其他字段，不删行、不插行。
 *   - `client_id` 硬过滤成 CTS，`--apply` 时每条 UPDATE 再带一次 `client_id` 条件（双保险）。
 *   - 分页按主键 `id` 排序（`ran_at` 不是唯一键，并列时翻页可能漏行）。
 *   - 幂等：重跑时这些行的新旧值已一致，不会再进改动清单（已实测连跑三遍收敛）。
 *   - 撤回：`--out` 写的计划文件里存了每行的旧值，`--revert <计划文件>` 可原样写回。
 *
 * 运行：
 *   npx tsx scripts/backfills/recompute-cts-ai-visibility-rank.ts                     # 只读，出计划
 *   npx tsx scripts/backfills/recompute-cts-ai-visibility-rank.ts --out plan.json \
 *     --apply --confirm                                                               # 真写（需 PM 点头）
 *   npx tsx scripts/backfills/recompute-cts-ai-visibility-rank.ts --revert plan.json  # 按旧值撤回
 *
 * 需要 .env.local 里的 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY。
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  resolveClientBrandRank,
  type ClientBrandIdentity,
} from '../../src/lib/ai-tracker/client-brand-match'
import type { BrandMention } from '../../src/types/magic-engine'

const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const PAGE = 500

/**
 * 手工核对后排除的 7 条 —— 「中国旅行社 / China Travel Service」是集团通名，
 * 澳洲、香港都有分公司，而 CTS Tours NZ 只服务新西兰。
 *
 * 这 7 条原文逐条读过，讲的都是**澳洲的中旅**（典型原话：“China Travel Service (CTS)
 * Australia, established in Sydney in 1985”、“China Travel Service (Australia) Pty Ltd / 中旅澳洲”、
 * “China Travel Service (Hong Kong) Ltd.”），一处新西兰信号都没有。新规则会把它们
 * 算成客户被提到 —— 跟这次要修的「泛称冒领客户」是同一类错，只是换了个语种。
 *
 * 为什么不是把别名 `china travel service` 从客户配置里摘掉（魏征复审 2026-09-20 的建议）：
 * 实测摘掉会**修好 7 条、弄坏 40 条** —— 那 40 条原文明确是新西兰语境，
 * AI 回答里客户的名字就写成 “China Travel Service (NZ) Ltd”，摘了别名它们会被压低名次或直接丢失。
 * 净效果是更差，所以配置不动，改为把这 7 条排除在本次回填之外（保持原样，不声称修好了）。
 *
 * 根治要给判定函数加「地域锚点」，那是改已上线的共享代码，另开一张单 —— 只在这个回填脚本里
 * 偷偷加规则的话，线上下周再跑还会造出同类行，历史和现在就永远对不上。
 */
const EXCLUDED_AMBIGUOUS_IDS = new Set([
  // 「Major Chinese Tour Operators in Australia … CTS is a premier Australian travel agency」
  '21dc3d0c-0de0-4d8b-8766-5b79f37d8472', // 名次 6→1
  '2fa4ddfe-af46-4813-83d7-6ad434110ca3', // 空→2
  // 「Backed by China Travel Service …」讲的是 HelloChinaTrip
  'a16a88aa-fffa-41e5-b79e-ae13d043f82b', // 空→4
  'dbf5c1ea-1558-4335-91ce-0b35f51e1c19', // 空→4
  // 「China Travel Service (Australia) Pty Ltd / 中旅澳洲」
  'b71a6c4b-5e17-4f59-a7b4-dd366d129021', // 空→2
  'd9e47341-7c05-42df-95a4-09931c69d0da', // 空→1
  // 「curated by China Travel Service」讲的是 ExploreChina Holidays（澳洲）
  'c07dc2df-c6c4-4dd0-a2cb-9d3476ca4471', // 空→3
])

// ── env ──────────────────────────────────────────────────────────────────────

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

function makeClient(): SupabaseClient {
  const env = loadEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('缺 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// ── 客户身份（与 orchestrator.loadClientContext 同一口径）────────────────────

interface ClientRow {
  id: string
  name: string
  domain: string | null
  brand_aliases: string[] | null
}

async function loadIdentity(sb: SupabaseClient): Promise<ClientBrandIdentity & { name: string }> {
  const { data: client, error } = await sb
    .from('clients')
    .select('id, name, domain, brand_aliases')
    .eq('id', CTS_CLIENT_ID)
    .single<ClientRow>()
  if (error || !client) throw new Error(`读不到客户: ${error?.message}`)

  const { data: brief } = await sb
    .from('master_briefs')
    .select('brand_name')
    .eq('client_id', CTS_CLIENT_ID)
    .eq('status', 'active')
    .maybeSingle<{ brand_name: string | null }>()

  return {
    name: client.name,
    brandName: brief?.brand_name?.trim() || client.name,
    domain: client.domain,
    aliases: client.brand_aliases,
  }
}

// ── 读全部历史回答 ───────────────────────────────────────────────────────────

export interface RunRow {
  id: string
  ran_at: string
  raw_response: string | null
  brands_mentioned: BrandMention[] | null
  client_brand_rank: number | null
}

async function loadRuns(sb: SupabaseClient): Promise<RunRow[]> {
  const out: RunRow[] = []
  // 按主键排序翻页：ran_at 不是唯一键，并列时跨查询顺序不保证，边界会漏行或重复。
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('ai_visibility_runs')
      .select('id, ran_at, raw_response, brands_mentioned, client_brand_rank')
      .eq('client_id', CTS_CLIENT_ID)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`读 ai_visibility_runs 失败: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...(data as RunRow[]))
    if (data.length < PAGE) break
  }
  return out
}

// ── 重算 ─────────────────────────────────────────────────────────────────────

export type ChangeKind = 'false_positive' | 'missed' | 'rank_changed' | 'brands_only'

export interface Change {
  id: string
  ran_at: string
  kind: ChangeKind
  old_rank: number | null
  new_rank: number | null
  old_brands: BrandMention[]
  new_brands: BrandMention[]
}

export interface Plan {
  changes: Change[]
  /** 没存原文，无从判断。 */
  skippedNoRaw: number
  /** 有原文但当年解析整条失败（品牌列表是空的），没有排名参照系。 */
  skippedNoParse: number
  /** 上面两类里「居然已经带着名次」的行 —— 不该存在，出现就要报出来。 */
  skippedButRanked: string[]
  /** 手工核对为「澳洲/香港的中旅」而排除的行。 */
  skippedAmbiguous: string[]
}

/** 两个品牌列表在「要写回库」的意义上是否相同（顺序 + brand + rank + snippet + url）。 */
function brandsEqual(a: readonly BrandMention[], b: readonly BrandMention[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]
    return (
      x.brand === y.brand &&
      x.rank === y.rank &&
      (x.snippet ?? null) === (y.snippet ?? null) &&
      (x.url ?? null) === (y.url ?? null)
    )
  })
}

function classify(oldRank: number | null, newRank: number | null): ChangeKind {
  if (oldRank !== null && newRank === null) return 'false_positive'
  if (oldRank === null && newRank !== null) return 'missed'
  if (oldRank !== newRank) return 'rank_changed'
  return 'brands_only'
}

export function planChanges(runs: readonly RunRow[], identity: ClientBrandIdentity): Plan {
  const changes: Change[] = []
  let skippedNoRaw = 0
  let skippedNoParse = 0
  const skippedButRanked: string[] = []
  const skippedAmbiguous: string[] = []

  for (const run of runs) {
    const raw = run.raw_response ?? ''
    const oldBrands = Array.isArray(run.brands_mentioned) ? run.brands_mentioned : []

    // 跳过规则 A：没原文 = 没证据。
    if (raw.trim().length === 0) {
      skippedNoRaw++
      if (run.client_brand_rank !== null) skippedButRanked.push(run.id)
      continue
    }
    // 跳过规则 B：品牌列表是空的 = 当年解析整条失败，没有排名参照系。
    if (oldBrands.length === 0) {
      skippedNoParse++
      if (run.client_brand_rank !== null) skippedButRanked.push(run.id)
      continue
    }

    // 跳过规则 C：手工核对为「澳洲/香港的中旅」的行，保持原样。
    if (EXCLUDED_AMBIGUOUS_IDS.has(run.id)) {
      skippedAmbiguous.push(run.id)
      continue
    }

    const resolved = resolveClientBrandRank(oldBrands, raw, identity)
    const rankSame = resolved.client_brand_rank === run.client_brand_rank
    const brandsSame = brandsEqual(oldBrands, resolved.brands)
    if (rankSame && brandsSame) continue
    changes.push({
      id: run.id,
      ran_at: run.ran_at,
      kind: classify(run.client_brand_rank, resolved.client_brand_rank),
      old_rank: run.client_brand_rank,
      new_rank: resolved.client_brand_rank,
      old_brands: oldBrands,
      new_brands: resolved.brands,
    })
  }
  return { changes, skippedNoRaw, skippedNoParse, skippedButRanked, skippedAmbiguous }
}

// ── 写回 / 撤回（只有 --apply / --revert）───────────────────────────────────

async function writeRows(
  sb: SupabaseClient,
  rows: ReadonlyArray<{ id: string; rank: number | null; brands: BrandMention[] }>,
  label: string
): Promise<number> {
  let done = 0
  for (const r of rows) {
    const { error } = await sb
      .from('ai_visibility_runs')
      .update({ client_brand_rank: r.rank, brands_mentioned: r.brands })
      .eq('id', r.id)
      .eq('client_id', CTS_CLIENT_ID) // 双保险：绝不越过 CTS
    if (error) throw new Error(`${label} ${r.id} 失败（已处理 ${done} 条）: ${error.message}`)
    done++
    if (done % 50 === 0) console.log(`  …已处理 ${done}/${rows.length}`)
  }
  return done
}

async function revert(sb: SupabaseClient, planPath: string): Promise<void> {
  const saved = JSON.parse(readFileSync(planPath, 'utf8')) as { changes: Change[] }
  console.log(`按 ${planPath} 撤回 ${saved.changes.length} 条到旧值…`)
  const n = await writeRows(
    sb,
    saved.changes.map(c => ({ id: c.id, rank: c.old_rank, brands: c.old_brands })),
    '撤回'
  )
  console.log(`\n✅ 已撤回 ${n} 条。`)
}

// ── main ─────────────────────────────────────────────────────────────────────

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i < 0) return undefined
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : undefined
}

/**
 * 判断解析后的绝对路径是否落在某个临时目录下——不能只查 `--out` 有没有出现，
 * 还要查它真正指向哪：传 `/tmp/plan.json` 一样会在进程/主机重启后连同底稿一起丢，
 * 唯一的撤回依据就没了。
 */
function isTempPath(p: string): boolean {
  const resolved = resolve(p)
  const tmpCandidates = [resolve(tmpdir()), '/tmp', '/var/tmp']
  return tmpCandidates.some(t => resolved === t || resolved.startsWith(t + '/'))
}

async function main(): Promise<void> {
  const sb = makeClient()

  const revertPath = argValue('--revert')
  if (revertPath) {
    if (!existsSync(revertPath)) throw new Error(`找不到计划文件: ${revertPath}`)
    await revert(sb, revertPath)
    return
  }

  const apply = process.argv.includes('--apply')
  const confirmed = process.argv.includes('--confirm')
  const outPath = argValue('--out') ?? '/tmp/cts-ai-rank-plan.json'

  // A 级不可逆操作：不许只隔一个 flag，也不许把唯一的旧值底稿写进 /tmp。
  if (apply && !confirmed) {
    throw new Error('要真写生产库，必须同时给 --confirm（A 级不可逆操作，二次确认）')
  }
  if (apply) {
    const outArg = argValue('--out')
    if (!outArg) {
      throw new Error('要真写生产库，必须用 --out <持久路径> 指定计划文件 —— 那份文件是唯一的撤回底稿，不能留在 /tmp')
    }
    if (isTempPath(outArg)) {
      throw new Error(
        `--out ${outArg} 解析后落在临时目录下 —— 那份文件是唯一的撤回底稿，进程或主机重启就可能丢失，换一个非临时目录的持久路径`
      )
    }
  }

  const baselinePath = outPath.replace(/\.json$/, '') + '.baseline.json'
  // 重试保护：--apply 时如果这条路径已经有计划文件或底稿，说明上一次 apply 在这条路径上
  // 跑过（很可能是逐行写入中途失败）。这时候绝不能重新生成计划覆盖它 ——
  // 新计划只含「还没改成功」的行，会把第一次已写成功的那些行的旧值底稿冲掉，
  // 之后 --revert 就再也撤不回那些行了。换一个新 --out 路径重跑，
  // 或者先用 --revert <旧计划> 撤回旧计划再重试。
  if (apply && (existsSync(outPath) || existsSync(baselinePath))) {
    throw new Error(
      `${outPath} 或 ${baselinePath} 已存在，像是同一路径上跑过一次 --apply（可能是重试）。` +
        `为了不覆盖第一次的撤回底稿，换一个新的 --out 路径重跑；` +
        `如果要重来，先用 --revert ${outPath} 把旧计划撤回，再删掉这两个文件重跑。`
    )
  }

  const identity = await loadIdentity(sb)
  console.log('客户:', identity.name)
  console.log('  品牌名:', identity.brandName)
  console.log('  域名  :', identity.domain)
  console.log('  别名  :', JSON.stringify(identity.aliases))
  console.log(apply ? '\n🔴 模式：--apply（真写生产库）\n' : '\n🟢 模式：DRY-RUN（只读，不写任何东西）\n')

  const runs = await loadRuns(sb)
  console.log('读到历史回答:', runs.length, '条')

  const plan = planChanges(runs, identity)
  const counts: Record<ChangeKind, number> = {
    false_positive: 0,
    missed: 0,
    rank_changed: 0,
    brands_only: 0,
  }
  for (const c of plan.changes) counts[c.kind]++

  console.log('\n── 重算结果 ──')
  console.log('  跳过（没存原文，无从判断）        :', plan.skippedNoRaw, '条')
  console.log('  跳过（当年解析整条失败，没有参照系）:', plan.skippedNoParse, '条')
  console.log('  跳过（手工核对为澳洲/香港的中旅）  :', plan.skippedAmbiguous.length, '条')
  if (plan.skippedButRanked.length > 0) {
    console.log(
      '  ⚠️ 被跳过却已经带着名次的:',
      plan.skippedButRanked.length,
      '条 →',
      plan.skippedButRanked.slice(0, 5).join(', ')
    )
  }
  console.log('  要改的行数合计:', plan.changes.length)
  console.log('    · 误记（有名次 → 改成空）:', counts.false_positive)
  console.log('    · 漏记（空 → 补上名次）  :', counts.missed)
  console.log('    · 名次数字要改            :', counts.rank_changed)
  console.log('    · 只有品牌列表要改        :', counts.brands_only)

  const before = runs.filter(r => r.client_brand_rank !== null).length
  const after = before - counts.false_positive + counts.missed
  console.log(`\n  记了名次的行：${before} → ${after}`)

  writeFileSync(outPath, JSON.stringify({ identity, counts, ...plan }, null, 2))
  console.log('\n完整改动清单（含每行旧值，撤回就靠它）已写到:', outPath)

  if (!apply) {
    console.log('\n没有写任何数据。要真写：--out <持久路径> --apply --confirm')
    return
  }
  // 写之前先把 CTS 全部 3827 行的这两列整表存一份底稿。
  // `ai_visibility_runs` 没有 updated_at，改完在库里查不出哪些行被动过 ——
  // 只有改动清单不够，整表底稿才是真正能无条件还原的那份。
  writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        taken_at: new Date().toISOString(),
        client_id: CTS_CLIENT_ID,
        rows: runs.map(r => ({
          id: r.id,
          client_brand_rank: r.client_brand_rank,
          brands_mentioned: r.brands_mentioned ?? [],
        })),
      },
      null,
      2
    )
  )
  console.log('整表底稿（全部', runs.length, '行）已写到:', baselinePath)

  const n = await writeRows(
    sb,
    plan.changes.map(c => ({ id: c.id, rank: c.new_rank, brands: c.new_brands })),
    '写入'
  )
  console.log(`\n✅ 已写回 ${n} 条（只改了 client_brand_rank 和 brands_mentioned 两列）。`)
  console.log(`   撤回命令：npx tsx ${process.argv[1]} --revert ${outPath}`)
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
