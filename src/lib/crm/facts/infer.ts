/**
 * 「读对话得出事实」的编排层 —— 不直接碰 supabase / OpenAI，只调 FactsIo。
 *
 * 挂在**已经在跑**的 `messenger-brief-hourly` 上，不新注册 cron：新 cron 要手工
 * link 密钥的环境变量组，漏了就每天 401 静默失败（daily-cron-digest 哑了 51 天
 * 那次就是这么来的，见 stage-infer.ts 头注）。
 *
 * 默认**关着**：`CRM_FACTS_CLIENT_IDS` 没列出这个客户就一步都不走（fail closed）。
 * 先 claim 再调模型：Inngest 重试与每小时 cron 并发时，靠数据库里那一次原子
 * claim 保证同一段对话不会被两边各烧一次钱。
 */

import {
  buildTranscript,
  findCanned,
  lastSpeaker,
  type FactsMsg,
} from './canned'
import { sanitizeFacts } from './checks'
import { FACTS_PROMPT_VERSION, type Facts } from './schema'
import type { ConvRow, FactsIo, FactsRow } from './io'

export const CLAIM_STALE_MS = 15 * 60_000
export const RETRY_AFTER_MS = 6 * 3_600_000
export const PER_CALL_TIMEOUT_MS = 20_000
export const RUN_BUDGET_MS = 60_000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface FactsConfig {
  clientIds: string[]
  model: string
  dailyLimit: number
  perRun: number
}

function positiveInt(raw: string | undefined, fallback: number, max?: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  const v = Math.floor(n)
  return max !== undefined ? Math.min(v, max) : v
}

export function readFactsConfig(
  env: Record<string, string | undefined> = process.env,
): FactsConfig {
  const raw = env.CRM_FACTS_CLIENT_IDS ?? ''
  const clientIds = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s))
  return {
    clientIds,
    model: env.CRM_FACTS_MODEL ?? 'gpt-4o',
    dailyLimit: positiveInt(env.CRM_FACTS_DAILY_LIMIT, 80),
    perRun: positiveInt(env.CRM_FACTS_PER_RUN, 5, 20),
  }
}

function parseMs(s: string | null): number | null {
  if (s === null) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

export function needsFacts(conv: ConvRow, row: FactsRow | null, now: Date): boolean {
  if (!row) return true
  const nowMs = now.getTime()
  if (row.status === 'pending') {
    const claimed = parseMs(row.claimed_at)
    return claimed === null || nowMs - claimed > CLAIM_STALE_MS
  }
  if (row.status === 'failed') {
    const retry = parseMs(row.retry_after)
    return retry === null || retry <= nowMs
  }
  // ready：只有对话在那之后又动过才重算。
  const convAt = parseMs(conv.last_message_at)
  const rowAt = parseMs(row.last_message_at)
  if (convAt === null) return false
  if (rowAt === null) return true
  return convAt > rowAt
}

export function pickCandidates(
  convs: ConvRow[],
  rows: FactsRow[],
  now: Date,
  limit: number,
): ConvRow[] {
  const byId = new Map(rows.map((r) => [r.conversation_id, r]))
  const out: ConvRow[] = []
  for (const c of convs) {
    if (out.length >= limit) break
    if (needsFacts(c, byId.get(c.id) ?? null, now)) out.push(c)
  }
  return out
}

export interface FactsRunResult {
  enabled: boolean
  reason?: 'off' | 'no_key'
  candidates: number
  claimed: number
  written: number
  failed: number
  notClaimed: number
  costUsd: number
  dryRun?: Array<{ facts: Facts; level: string }>
}

export interface RunOptions {
  dryRun?: boolean
  onlyConversationIds?: string[]
  config?: FactsConfig
  io: FactsIo
  nowMs?: () => number
  hasKey?: boolean
}

const ZEROS = {
  candidates: 0,
  claimed: 0,
  written: 0,
  failed: 0,
  notClaimed: 0,
  costUsd: 0,
}

/** gpt-4o 列表价（每百万 token）—— 只是给 cost 列一个估算，不是账单。 */
function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 2.5 + outputTokens * 10) / 1_000_000
}

/** 把引文/理由全部抹掉 —— dry-run 结果里不许带任何客户原话。 */
function maskFacts(f: Facts): Facts {
  return {
    ...f,
    decline_quote: '',
    customer_quote: '',
    our_quote: '',
    progression: '',
    reason: '',
  }
}

interface ClientCache {
  business: string
  canned: Set<string>
}

/**
 * 「固定回复」口径要读整个客户的出站消息，比每轮那 5 次模型调用贵得多（魏征复审建议）。
 * 同一个进程里 30 分钟内复用一份；换进程就重读一次，无害。
 */
const CACHE_TTL_MS = 30 * 60_000
const processCache = new Map<string, { at: number; value: ClientCache }>()
export function clearFactsCache(): void {
  processCache.clear()
}

async function loadClientCache(io: FactsIo, clientId: string, nowMs: number): Promise<ClientCache> {
  const hit = processCache.get(clientId)
  if (hit && nowMs - hit.at < CACHE_TTL_MS) return hit.value
  const [business, outbound] = await Promise.all([
    io.businessName(clientId),
    io.loadClientOutbound(clientId),
  ])
  const value = { business, canned: findCanned(outbound) }
  processCache.set(clientId, { at: nowMs, value })
  return value
}

async function askWithTimeout(
  io: FactsIo,
  model: string,
  business: string,
  transcript: string,
): Promise<{ facts: Facts | null; inputTokens: number; outputTokens: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS)
  try {
    return await io.ask(model, business, transcript, controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

async function processCandidate(
  io: FactsIo,
  conv: ConvRow,
  cache: ClientCache,
  config: FactsConfig,
  now: Date,
  dryRun: boolean,
  result: FactsRunResult,
): Promise<void> {
  const msgs = await io.loadMessages(conv.id)
  if (msgs.length === 0) {
    // 空对话不能静默返回：下一轮它仍是「没有行」，会天天占掉 5 个名额里的一个。
    if (!dryRun) await io.markEmpty(conv.id, conv.client_id, new Date(now.getTime() + RETRY_AFTER_MS))
    return
  }

  if (!dryRun) {
    const ok = await io.claim(conv.id, conv.client_id, config.dailyLimit)
    if (!ok) {
      result.notClaimed++
      return
    }
    result.claimed++
  }

  const transcript = buildTranscript(msgs, cache.canned)
  const res = await askWithTimeout(io, config.model, cache.business, transcript)
  if (res.facts === null) {
    if (!dryRun) {
      await io.writeFailed(conv.id, '模型没给出可用的事实', new Date(now.getTime() + RETRY_AFTER_MS))
    }
    result.failed++
    return
  }

  const facts = sanitizeFacts(res.facts, transcript, msgs, cache.canned)

  if (dryRun) {
    result.dryRun?.push({ facts: maskFacts(facts), level: '' })
    return
  }

  const costUsd = estimateCost(res.inputTokens, res.outputTokens)
  const ok = await io.writeReady({
    conversationId: conv.id,
    clientId: conv.client_id,
    facts,
    lastSpeaker: lastSpeaker(msgs, cache.canned),
    lastMessageAt: conv.last_message_at,
    sourceMessageCount: msgs.length,
    model: config.model,
    promptVersion: FACTS_PROMPT_VERSION,
    costUsd,
    now,
  })
  if (ok) {
    result.written++
    result.costUsd += costUsd
  } else {
    result.failed++
  }
}

export async function inferConversationFacts(
  now: Date,
  opts: RunOptions,
): Promise<FactsRunResult> {
  const { io } = opts
  const config = opts.config ?? readFactsConfig()
  const onlyIds = opts.onlyConversationIds ?? null
  const dryRun = opts.dryRun === true

  if (config.clientIds.length === 0 && !onlyIds) {
    return { enabled: false, reason: 'off', ...ZEROS }
  }
  // `onlyConversationIds` 是干跑试跑用的旁路（绕开客户白名单）。真写库时绝不许走它 ——
  // 这道防线不能只靠调用方自觉（子牙 2026-10-11 复审必改 2）。
  if (onlyIds && !dryRun) {
    throw new Error('onlyConversationIds 只能配合 dryRun 使用')
  }
  const hasKey = opts.hasKey ?? Boolean(process.env.OPENAI_API_KEY)
  if (!hasKey) return { enabled: false, reason: 'no_key', ...ZEROS }

  const convs = await io.listConversations(config.clientIds, onlyIds)
  // 指定对话时不判「需不需要读」，也就不必先读事实表（干跑试跑时迁移还没上线，表还不存在）。
  const rows = onlyIds ? [] : await io.listFactsRows(convs.map((c) => c.id))
  const cands = onlyIds
    ? convs.slice(0, config.perRun)
    : pickCandidates(convs, rows, now, config.perRun)

  const result: FactsRunResult = { enabled: true, ...ZEROS, candidates: cands.length }
  if (dryRun) result.dryRun = []
  if (cands.length === 0) return result

  const nowMs = opts.nowMs ?? Date.now
  const start = nowMs()
  const caches = new Map<string, ClientCache>()

  for (const conv of cands) {
    if (nowMs() - start > RUN_BUDGET_MS) break
    try {
      let cache = caches.get(conv.client_id)
      if (!cache) {
        cache = await loadClientCache(io, conv.client_id, nowMs())
        caches.set(conv.client_id, cache)
      }
      await processCandidate(io, conv, cache, config, now, dryRun, result)
    } catch (err) {
      result.failed++
      const message = err instanceof Error ? err.message : String(err)
      if (!dryRun) {
        try {
          await io.writeFailed(conv.id, message, new Date(now.getTime() + RETRY_AFTER_MS))
        } catch (werr) {
          console.error(`[facts-infer] 写失败状态也失败 ${conv.id}:`, werr)
        }
      }
      console.warn(`[facts-infer] ${conv.id} 处理失败：`, message)
    }
  }

  return result
}
