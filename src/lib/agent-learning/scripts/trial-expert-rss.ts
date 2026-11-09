/**
 * L56-P1.R14 当场试跑脚本（专家 RSS 抓取 → 蒸馏 → 账面结算）。
 *
 * 硬约束（必须在代码里也遵守）：
 * 1. 不 import supabase / inngest，**不写任何数据库、不写任何文件**，只往 stdout 打印。
 * 2. 文章正文只留在内存里，**绝不打印正文**；只打印标题、链接、发布日期、规则句、
 *    引用（≤2 行）、丢弃原因、token 数与花费。
 * 3. 账本用内存版 fake ledger，日花费上限取真实的 DISTILL_DAILY_USD_CAP（0.20 美元），
 *    硬上限由 distillOne 内部的 reserveDistillBudget 执行（预留被拒就不外呼）。
 * 4. `--llm=fake`（默认）用预录响应，不产生任何 LLM 网络请求；`--llm=real` 用
 *    createDeepSeekClient() 从 process.env 读 DEEPSEEK_API_KEY，失败时打印错误码并以 2 退出。
 *    **任何情况下都不打印密钥。**
 *
 * 用法：npx tsx src/lib/agent-learning/scripts/trial-expert-rss.ts [--llm=fake|real] [--per-source=3] [--prior-spent-usd=0]
 */

import { createFakeLedger, type FakeLedger } from '@/lib/agent-learning/budget/fake-ledger'
import { createFetchText, fetchFeedItems, contentHash } from '@/lib/agent-learning/collect/feeds'
import { createDeepSeekClient, DEEPSEEK_FLASH_PRICE, type CompleteJsonRequest } from '@/lib/agent-learning/llm/deepseek-client'
import { DISTILL_DAILY_USD_CAP, distillPeriodKeys } from '@/lib/agent-learning/distill/cost-gate'
import { distillOne, type DistillLlm, type DistillSource } from '@/lib/agent-learning/distill/run'
import type { RawItem } from '@/lib/agent-learning/contracts'

/** 试跑用的三个真实 RSS 来源（公开信息，不含任何客户数据） */
export const TRIAL_SOURCES: Array<DistillSource & { feedUrl: string }> = [
  {
    sourceKey: 'jon-loomer',
    expert: 'Jon Loomer',
    domain: 'paid_social',
    feedUrl: 'https://www.jonloomer.com/feed/',
  },
  {
    sourceKey: 'glenn-gabe',
    expert: 'Glenn Gabe',
    domain: 'seo',
    feedUrl: 'https://www.gsqi.com/marketing-blog/feed/',
  },
  {
    sourceKey: 'common-thread-collective',
    expert: 'Common Thread Collective',
    domain: 'paid_social',
    feedUrl: 'https://commonthreadco.com/blogs/coachs-corner.atom',
  },
]

/** 正文少于这个字符数就不花额度（正文太短蒸馏不出东西） */
const MIN_TEXT_CHARS = 200

/** 预录响应：--llm=fake 与并发演示共用，保证两次运行结果可比 */
const PRE_RECORDED_RULES_JSON = JSON.stringify({
  rules: [
    {
      rule: 'Pre-recorded rule: test one change at a time.',
      rationale: 'Pre-recorded response for the dry run.',
      quote: 'pre-recorded',
      authorClaims: [],
    },
  ],
})

/** 直接从注入的客户端签名推导返回类型，避免额外 import */
type CompleteJsonResult = Awaited<ReturnType<DistillLlm['completeJson']>>

/** 命令行模式 */
export type TrialLlmMode = 'fake' | 'real'

/** 一条规则在报告里的展示形态（只含可打印字段） */
export interface TrialRuleLine {
  rule: string
  quote: string
  authorClaims: Array<{ text: string; kind: string }>
}

/** 一条条目在报告里的展示形态 */
export interface TrialItemLine {
  title: string
  url: string
  publishedAt: string | null
  textChars: number
  status: 'ok' | 'failed' | 'skipped'
  error: string | null
  rules: TrialRuleLine[]
  dropped: string[]
  inputTokens: number
  outputTokens: number
  actualUsd: number
  truncated: boolean
}

/** 一个来源的抓取与逐条结果 */
export interface TrialSourceLine {
  sourceKey: string
  feedUrl: string
  fetched: number
  fetchedError: string | null
  items: TrialItemLine[]
}

/** 全次试跑的汇总数字 */
export interface TrialTotals {
  sourcesOk: number
  sourcesFailed: number
  fetched: number
  deduped: number
  distilled: number
  itemsFailed: number
  itemsSkipped: number
  rulesKept: number
  rulesDropped: number
  costUsd: number
}

/** 试跑报告（不含任何正文） */
export interface TrialReport {
  sources: TrialSourceLine[]
  totals: TrialTotals
  ledgerUsdSpent: number
  ledgerUsdReserved: number
  ledgerItemsSpent: number
  capUsd: number
}

/** 并发演示结果 */
export interface ConcurrencyReport {
  attempted: number
  llmCalls: number
  succeeded: number
  denied: number
  deniedReasons: string[]
  usdSpent: number
}

/** 预录 LLM 替身：不发网络请求，只按入参长度估算输入 token */
export function fakeLlm(): DistillLlm {
  return {
    price: DEEPSEEK_FLASH_PRICE,
    async completeJson(req: CompleteJsonRequest): Promise<CompleteJsonResult> {
      return {
        ok: true,
        value: {
          text: PRE_RECORDED_RULES_JSON,
          inputTokens: Math.ceil((req.system.length + req.user.length) / 4),
          outputTokens: 60,
          model: 'fake-prerecorded',
        },
      }
    },
  }
}

/** 从丢弃项里安全取出原因码（不依赖该类型的完整形状） */
function droppedReason(entry: unknown): string {
  if (typeof entry === 'object' && entry !== null && 'reason' in entry) {
    const reason = (entry as { reason?: unknown }).reason
    if (typeof reason === 'string' && reason.length > 0) return reason
  }
  return 'unknown_drop_reason'
}

/** 正文对应的去重 hash：正文为空时退回标题 */
function itemHash(item: RawItem): string {
  return contentHash(item.text.length > 0 ? item.text : item.title)
}

/** 跑一次完整试跑：逐来源抓取 → 去重 → 逐条蒸馏，返回报告（不打印） */
export async function runTrial(opts: { llm: DistillLlm; perSource: number; now: Date; priorSpentUsd?: number }): Promise<TrialReport> {
  const ledger: FakeLedger = createFakeLedger()
  await chargePriorSpend(ledger, opts.now, opts.priorSpentUsd ?? 0)
  const fetchText = createFetchText()
  const seen = new Set<string>()
  const sources: TrialSourceLine[] = []
  let deduped = 0

  for (const source of TRIAL_SOURCES) {
    const line: TrialSourceLine = {
      sourceKey: source.sourceKey,
      feedUrl: source.feedUrl,
      fetched: 0,
      fetchedError: null,
      items: [],
    }

    const feed = await fetchFeedItems(
      { fetchText },
      { sourceKey: source.sourceKey, feedUrl: source.feedUrl },
      { limit: opts.perSource },
    )

    if (!feed.ok) {
      line.fetchedError = feed.error
      sources.push(line)
      continue
    }

    const items: RawItem[] = feed.value
    line.fetched = items.length

    for (const item of items) {
      const hash = itemHash(item)
      if (seen.has(hash)) {
        deduped += 1
        continue
      }
      seen.add(hash)

      const base = {
        title: item.title,
        url: item.externalRef,
        publishedAt: item.publishedAt,
        textChars: item.text.length,
      }

      if (item.text.trim().length < MIN_TEXT_CHARS) {
        line.items.push({
          ...base,
          status: 'skipped',
          error: 'text_too_short',
          rules: [],
          dropped: [],
          inputTokens: 0,
          outputTokens: 0,
          actualUsd: 0,
          truncated: false,
        })
        continue
      }

      const result = await distillOne(
        { llm: opts.llm, ledger, now: () => opts.now },
        {
          externalRef: item.externalRef,
          title: item.title,
          text: item.text,
          publishedAt: item.publishedAt,
        },
        { sourceKey: source.sourceKey, expert: source.expert, domain: source.domain },
        1,
      )

      if (!result.ok) {
        line.items.push({
          ...base,
          status: 'failed',
          error: result.error,
          rules: [],
          dropped: [],
          inputTokens: 0,
          outputTokens: 0,
          actualUsd: 0,
          truncated: false,
        })
        continue
      }

      const outcome = result.value
      line.items.push({
        ...base,
        status: 'ok',
        error: null,
        rules: outcome.rules.map((rule) => ({
          rule: rule.rule,
          quote: rule.sourceCard.quote,
          authorClaims: rule.authorClaims.map((claim) => ({ text: claim.text, kind: claim.kind })),
        })),
        dropped: outcome.dropped.map(droppedReason),
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        actualUsd: outcome.actualUsd,
        truncated: outcome.truncated,
      })
    }

    sources.push(line)
  }

  const keys = distillPeriodKeys(opts.now)
  const usdRow = ledger.row(keys.usdDay)
  const itemsRow = ledger.row(keys.itemsDay)

  const totals: TrialTotals = {
    sourcesOk: sources.filter((source) => source.fetchedError === null).length,
    sourcesFailed: sources.filter((source) => source.fetchedError !== null).length,
    fetched: sources.reduce((sum, source) => sum + source.fetched, 0),
    deduped,
    distilled: sources.reduce(
      (sum, source) => sum + source.items.filter((item) => item.status === 'ok').length,
      0,
    ),
    itemsFailed: sources.reduce(
      (sum, source) => sum + source.items.filter((item) => item.status === 'failed').length,
      0,
    ),
    itemsSkipped: sources.reduce(
      (sum, source) => sum + source.items.filter((item) => item.status === 'skipped').length,
      0,
    ),
    rulesKept: sources.reduce(
      (sum, source) => sum + source.items.reduce((count, item) => count + item.rules.length, 0),
      0,
    ),
    rulesDropped: sources.reduce(
      (sum, source) => sum + source.items.reduce((count, item) => count + item.dropped.length, 0),
      0,
    ),
    costUsd: sources.reduce(
      (sum, source) => sum + source.items.reduce((count, item) => count + item.actualUsd, 0),
      0,
    ),
  }

  return {
    sources,
    totals,
    ledgerUsdSpent: usdRow === undefined ? 0 : usdRow.spent,
    ledgerUsdReserved: usdRow === undefined ? 0 : usdRow.reserved,
    ledgerItemsSpent: itemsRow === undefined ? 0 : itemsRow.spent,
    capUsd: DISTILL_DAILY_USD_CAP,
  }
}

/**
 * 并发演示：10 路同时预留，价格调成最坏用量 0.06 美元/次，
 * 因此在 0.20 美元日上限下最多 3 路获批，其余在预留阶段就被拒（零外呼）。
 */
export async function runConcurrencyDemo(now: Date): Promise<ConcurrencyReport> {
  const ledger = createFakeLedger()
  const scale = 0.06 / 0.0042
  let llmCalls = 0

  const llm: DistillLlm = {
    price: {
      inputPerMTokUsd: 0.3 * scale,
      outputPerMTokUsd: 1.2 * scale,
      source: 'demo',
      checkedOn: 'demo',
    },
    async completeJson(): Promise<CompleteJsonResult> {
      llmCalls += 1
      return {
        ok: true,
        value: {
          text: PRE_RECORDED_RULES_JSON,
          inputTokens: 1000,
          outputTokens: 100,
          model: 'demo-counting',
        },
      }
    },
  }

  const indexes = Array.from({ length: 10 }, (_unused, index) => index + 1)
  const results = await Promise.all(
    indexes.map((index) =>
      distillOne(
        { llm, ledger, now: () => now },
        {
          externalRef: `demo-${index}`,
          title: `demo item ${index}`,
          text: `demo item ${index} ` + 'unique text for the concurrency demo. '.repeat(20),
          publishedAt: now.toISOString(),
        },
        { sourceKey: 'demo-source', expert: 'Example Expert', domain: 'paid_social' },
        1,
      ),
    ),
  )

  let succeeded = 0
  const deniedReasons: string[] = []
  for (const result of results) {
    if (result.ok) {
      succeeded += 1
    } else if (!deniedReasons.includes(result.error)) {
      deniedReasons.push(result.error)
    }
  }

  const usdRow = ledger.row(distillPeriodKeys(now).usdDay)

  return {
    attempted: results.length,
    llmCalls,
    succeeded,
    denied: results.length - succeeded,
    deniedReasons,
    usdSpent: usdRow === undefined ? 0 : usdRow.spent,
  }
}

/** 金额统一四位小数打印 */
function formatUsd(value: number): string {
  return value.toFixed(4)
}

/** 打印逐来源、逐条目的结果（标题/链接/规则句/引用，不含正文） */
function printReport(report: TrialReport): void {
  for (const source of report.sources) {
    const errorSuffix = source.fetchedError === null ? '' : ` error=${source.fetchedError}`
    console.log(`[source] ${source.sourceKey} fetched=${source.fetched}${errorSuffix}`)

    for (const item of source.items) {
      console.log(`  [item] ${item.title}`)
      console.log(`    url: ${item.url}`)
      console.log(`    published: ${item.publishedAt === null ? 'unknown' : item.publishedAt}`)
      console.log(`    chars: ${item.textChars}`)

      if (item.status === 'skipped') {
        console.log(`    skipped: ${item.error === null ? 'unknown' : item.error}`)
        continue
      }
      if (item.status === 'failed') {
        console.log(`    failed: ${item.error === null ? 'unknown' : item.error}`)
        continue
      }

      console.log(
        `    tokens: in=${item.inputTokens} out=${item.outputTokens} usd=${formatUsd(item.actualUsd)} truncated=${item.truncated}`,
      )
      for (const rule of item.rules) {
        console.log(`    rule: ${rule.rule}`)
        console.log(`      quote: ${rule.quote}`)
        for (const claim of rule.authorClaims) {
          console.log(`      author_claim(${claim.kind}): ${claim.text}`)
        }
      }
      if (item.dropped.length > 0) {
        console.log(`    dropped: ${item.dropped.join(', ')}`)
      }
    }
  }

  const totals = report.totals
  console.log(
    `[totals] sources_ok=${totals.sourcesOk} sources_failed=${totals.sourcesFailed} fetched=${totals.fetched} deduped=${totals.deduped} distilled=${totals.distilled} items_failed=${totals.itemsFailed} items_skipped=${totals.itemsSkipped}`,
  )
  console.log(
    `[totals] rules_kept=${totals.rulesKept} rules_dropped=${totals.rulesDropped} cost_usd=${formatUsd(totals.costUsd)}`,
  )
  console.log(
    `[ledger] usd_spent=${formatUsd(report.ledgerUsdSpent)} usd_reserved=${formatUsd(report.ledgerUsdReserved)} items_spent=${report.ledgerItemsSpent} cap_usd=${report.capUsd.toFixed(2)}`,
  )
}

/** 打印并发演示结果 */
function printConcurrency(report: ConcurrencyReport): void {
  console.log(
    `[concurrency] attempted=${report.attempted} llm_calls=${report.llmCalls} succeeded=${report.succeeded} denied=${report.denied} usd_spent=${formatUsd(report.usdSpent)}`,
  )
  if (report.deniedReasons.length > 0) {
    console.log(`[concurrency] denied_reasons=${report.deniedReasons.join(', ')}`)
  }
}

/**
 * 同一天之前几次试跑已经花掉/占用的钱，先记进这次的内存账本，
 * 让 0.20 美元日上限对当天所有试跑合计生效（内存账本每次重建，不记就会每次重新给 0.20）。
 */
async function chargePriorSpend(ledger: FakeLedger, now: Date, priorSpentUsd: number): Promise<void> {
  if (!(priorSpentUsd > 0)) return
  const { usdDay } = distillPeriodKeys(now)
  const id = `prior:${now.toISOString()}`
  const reserved = await ledger.reserve(id, 'distill', [{ periodKey: usdDay, unit: 'usd', cap: DISTILL_DAILY_USD_CAP, amount: priorSpentUsd }])
  if (!reserved.ok || !reserved.value.ok) throw new Error('prior_spend_exceeds_daily_cap')
  const settled = await ledger.settle(id, [{ periodKey: usdDay, actual: priorSpentUsd }])
  if (!settled.ok) throw new Error('prior_spend_settle_failed')
}

/** 解析 `--llm=` 与 `--per-source=`（默认 fake / 3，per-source 夹在 1..10） */
function parseArgs(argv: string[]): { mode: TrialLlmMode; perSource: number; priorSpentUsd: number } {
  let mode: TrialLlmMode = 'fake'
  let perSource = 3
  let priorSpentUsd = 0

  for (const arg of argv) {
    if (arg.startsWith('--llm=')) {
      const value = arg.slice('--llm='.length)
      if (value === 'real' || value === 'fake') mode = value
    } else if (arg.startsWith('--per-source=')) {
      const parsed = Number.parseInt(arg.slice('--per-source='.length), 10)
      if (Number.isFinite(parsed)) perSource = Math.min(Math.max(parsed, 1), 10)
    } else if (arg.startsWith('--prior-spent-usd=')) {
      const parsed = Number.parseFloat(arg.slice('--prior-spent-usd='.length))
      if (Number.isFinite(parsed) && parsed > 0) priorSpentUsd = parsed
    }
  }

  return { mode, perSource, priorSpentUsd }
}

/** 入口：解析参数 → 跑试跑 → 跑并发演示 → 打印 → 按结果给退出码（0 成功 / 1 异常 / 2 客户端不可用） */
async function main(): Promise<void> {
  const { mode, perSource, priorSpentUsd } = parseArgs(process.argv.slice(2))
  const now = new Date()

  console.log(
    `[trial] mode=${mode} started=${now.toISOString()} per_source=${perSource} prior_spent_usd=${priorSpentUsd.toFixed(4)} cap_usd=${DISTILL_DAILY_USD_CAP.toFixed(2)}`,
  )

  let llm: DistillLlm
  if (mode === 'real') {
    const client = createDeepSeekClient()
    if (!client.ok) {
      console.error(`[trial] deepseek_client_unavailable: ${client.error}`)
      process.exit(2)
    }
    llm = {
      completeJson: (req) => client.value.completeJson(req),
      price: client.value.price,
    }
  } else {
    llm = fakeLlm()
  }

  const report = await runTrial({ llm, perSource, now, priorSpentUsd })
  printReport(report)

  const concurrency = await runConcurrencyDemo(now)
  printConcurrency(concurrency)

  const allSourcesFetched = report.sources.every((source) => source.fetchedError === null)
  const withinCap = report.ledgerUsdSpent + report.ledgerUsdReserved <= report.capUsd
  const noItemFailed = report.totals.itemsFailed === 0
  console.log(`[result] all_sources_fetched=${allSourcesFetched} within_cap=${withinCap} no_item_failed=${noItemFailed}`)
  process.exit(allSourcesFetched && withinCap && noItemFailed ? 0 : 1)
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('trial-expert-rss.ts')) {
  main().catch((error: unknown) => {
    console.error('trial_failed', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
