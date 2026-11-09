// 李白 · 文案逐句溯源（agent 自治计划 B2，docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md §4.1）。
// 每篇对外文案生成后，逐句标「官网可溯 / brief 可溯 / 无事实断言 / 未证实」（CLAUDE.md 铁律 8 已有规则，
// 此前靠人记）。「未证实」句汇成今日待办三件套；本模块只出判定，不改文案、不发布。
// 读不到官网 = 不判（抛错，由工作流层记成 unverifiable），不给默认值。
import { z } from 'zod'
import { callClaudeChat, MODEL_HAIKU } from '@/lib/anthropic/client'

// 事件契约（同 events.ts 惯例：只声明事件名 + payload 形状，不碰 Inngest/数据库，保持可脱网单测）。
export const LIBAI_COPY_GENERATED_EVENT = 'me/libai.copy.generated' as const

const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid id')

export const LibaiCopyGeneratedSchema = z.object({
  client_id: uuidLike,
  post_id: uuidLike,
})
export type LibaiCopyGeneratedData = z.infer<typeof LibaiCopyGeneratedSchema>

export type ProvenanceLabel = 'website' | 'brief' | 'no_claim' | 'unverified'

export const PROVENANCE_LABEL_ZH: Record<ProvenanceLabel, string> = {
  website: '官网可溯',
  brief: 'brief 可溯',
  no_claim: '无事实断言',
  unverified: '未证实',
}

export interface CopyField {
  field: string
  text: string
}

export interface CopySentence {
  field: string
  index: number
  text: string
}

export interface LabelledSentence extends CopySentence {
  label: ProvenanceLabel
  note: string
}

export interface ProvenanceReport {
  status: 'labelled'
  checked_at: string
  website_url: string | null
  brief_id: string | null
  sentences: LabelledSentence[]
  unverified_count: number
  cost_usd: number
}

export interface ProvenanceUnverifiable {
  status: 'unverifiable'
  checked_at: string
  reason: string
}

export type ProvenanceSnapshot = ProvenanceReport | ProvenanceUnverifiable

export type ProvenanceLlm = typeof callClaudeChat

export const MAX_SENTENCES = 60
export const SNAPSHOT_KEY = 'libai_provenance'

const LABELS: readonly ProvenanceLabel[] = ['website', 'brief', 'no_claim', 'unverified']

/**
 * 断句：中英句末标点（。！？!?.）后跟空白/结尾，以及换行。
 * 保留 【…】 占位符（占位符内不含句末标点，天然不会被切开）。
 * 丢弃 < 2 字的碎片（纯标点/单字噪声，喂给 LLM 只会浪费 token）。
 */
export function splitSentences(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return []
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    // 全角句末标点（。！？）后面从不跟空格，见到就切；半角 .!? 后跟空白或结尾才切，
    // 避免把 "3.5" 这类小数点、网址里的点切开。
    const parts = line.split(/(?<=[。！？])|(?<=[!?.])(?=\s|$)/)
    for (const p of parts) {
      const t = p.trim()
      if (t.length >= 2) out.push(t)
    }
  }
  return out
}

/**
 * 按字段顺序收集句子，index 每字段从 0 重开（便于回填到原字段）。
 * 总数封顶 MAX_SENTENCES：超出直接丢弃（保留前 N 条），避免一次喂爆 LLM。
 */
export function collectSentences(fields: CopyField[]): CopySentence[] {
  const out: CopySentence[] = []
  for (const f of fields) {
    const pieces = splitSentences(f.text)
    for (let i = 0; i < pieces.length; i++) {
      if (out.length >= MAX_SENTENCES) return out
      out.push({ field: f.field, index: i, text: pieces[i] })
    }
  }
  return out
}

const WEBSITE_CHAR_CAP = 12000

/**
 * 构造溯源 prompt。system 用英文（模型对英文指令更稳），user 里塞官网正文 + brief + 编号句子。
 * 关键约束：**绝不往有利于文案的方向猜**——半支持的断言一律判 unverified 并指出哪半没依据。
 */
export function buildProvenancePrompt(input: {
  sentences: CopySentence[]
  websiteText: string
  briefText: string | null
  brandName: string
}): { system: string; user: string } {
  const { sentences, websiteText, briefText, brandName } = input
  const system =
    `You are a fact-provenance auditor for "${brandName}" marketing copy. ` +
    `For EACH numbered sentence choose exactly one label:\n` +
    `- "website": the factual claim is directly supported by the WEBSITE text.\n` +
    `- "brief": supported only by the BRAND BRIEF text.\n` +
    `- "no_claim": no verifiable factual claim (greeting, question, hook, opinion, generic advice, ` +
    `or a 【placeholder】 the client will fill).\n` +
    `- "unverified": a factual claim about products, prices, dates, durations, itineraries, places, ` +
    `policies, numbers or results that appears in NEITHER source.\n` +
    `Rules: never guess in favour of the copy; when a claim is partially supported label "unverified" ` +
    `and say which part; note ≤ 20 words. ` +
    `Output ONLY JSON {"sentences":[{"i":0,"label":"website","note":"..."}]} with one entry per input ` +
    `sentence, same order.`
  const website = websiteText.slice(0, WEBSITE_CHAR_CAP)
  const brief = briefText && briefText.trim().length > 0 ? briefText : '(none provided)'
  const numbered = sentences.map((s, i) => `[${i}] ${s.text}`).join('\n')
  const user =
    `WEBSITE TEXT:\n${website}\n\n` +
    `BRAND BRIEF TEXT:\n${brief}\n\n` +
    `SENTENCES:\n${numbered}`
  return { system, user }
}

interface ParsedEntry {
  i: number
  label: ProvenanceLabel
  note: string
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isLabel(v: unknown): v is ProvenanceLabel {
  return typeof v === 'string' && (LABELS as readonly string[]).includes(v)
}

/** 剥掉 ``` 围栏（LLM 常带），再 JSON.parse。 */
function stripFences(raw: string): string {
  const t = raw.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return m ? m[1] : t
}

/**
 * 解析 LLM 溯源结果。任何形状不对 → 抛错（读不到 = 不判，绝不默认放行）。
 * 无 any：先 parse 成 unknown 再逐层收窄。
 */
export function parseProvenanceResponse(raw: string, expected: number): ParsedEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch {
    throw new Error('溯源结果不是合法 JSON，无法判定')
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.sentences)) {
    throw new Error('溯源结果缺少 sentences 数组，无法判定')
  }
  const arr = parsed.sentences
  if (arr.length !== expected) {
    throw new Error(`溯源结果条数不符（期望 ${expected}，实得 ${arr.length}），无法判定`)
  }
  const out: ParsedEntry[] = []
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i]
    if (!isPlainObject(e)) throw new Error(`溯源结果第 ${i} 条不是对象，无法判定`)
    if (e.i !== i) throw new Error(`溯源结果第 ${i} 条序号错位，无法判定`)
    if (!isLabel(e.label)) throw new Error(`溯源结果第 ${i} 条标签非法，无法判定`)
    const note = typeof e.note === 'string' ? e.note : ''
    out.push({ i, label: e.label, note })
  }
  return out
}

/**
 * 有界合并：只写 SNAPSHOT_KEY，绝不碰 snapshot 里其它键（endcard / offer_key 也住那）。
 * current 不是普通对象 → 从 {} 起（不信任脏数据）。
 */
export function mergeProvenanceIntoSnapshot(
  current: unknown,
  snap: ProvenanceSnapshot,
): Record<string, unknown> {
  const base: Record<string, unknown> = isPlainObject(current) ? { ...current } : {}
  base[SNAPSHOT_KEY] = snap
  return base
}

/** 从 snapshot 读回溯源结果；形状不对 → null（不抛，读侧宽容）。 */
export function readProvenanceFromSnapshot(snapshot: unknown): ProvenanceSnapshot | null {
  if (!isPlainObject(snapshot)) return null
  const v = snapshot[SNAPSHOT_KEY]
  if (!isPlainObject(v)) return null
  if (v.status === 'labelled') {
    if (typeof v.unverified_count !== 'number') return null
    if (!Array.isArray(v.sentences)) return null
    return v as unknown as ProvenanceReport
  }
  if (v.status === 'unverifiable') {
    if (typeof v.reason !== 'string') return null
    return v as unknown as ProvenanceUnverifiable
  }
  return null
}

const MIN_WEBSITE_CHARS = 200

/**
 * 逐句溯源主入口。官网正文太短 → 抛错（工作流层记 unverifiable，不给默认值）。
 * 无句子 → 空报告，不调 LLM（省 token）。LLM/解析错误一律上抛，由调用方记 unverifiable。
 */
export async function labelProvenance(
  input: {
    fields: CopyField[]
    websiteText: string
    websiteUrl: string | null
    briefText: string | null
    briefId: string | null
    brandName: string
    now?: Date
  },
  llm: ProvenanceLlm = callClaudeChat,
): Promise<ProvenanceReport> {
  const { fields, websiteText, websiteUrl, briefText, briefId, brandName, now } = input
  if (typeof websiteText !== 'string' || websiteText.trim().length < MIN_WEBSITE_CHARS) {
    throw new Error('官网正文太短或为空，无法溯源')
  }
  const checkedAt = (now ?? new Date()).toISOString()
  const sentences = collectSentences(fields)
  if (sentences.length === 0) {
    return {
      status: 'labelled',
      checked_at: checkedAt,
      website_url: websiteUrl,
      brief_id: briefId,
      sentences: [],
      unverified_count: 0,
      cost_usd: 0,
    }
  }
  const { system, user } = buildProvenancePrompt({ sentences, websiteText, briefText, brandName })
  const res = await llm({
    systemPrompt: system,
    messages: [{ role: 'user', content: user }],
    model: MODEL_HAIKU,
    singleAttempt: true,
    maxOutputTokens: 4000,
  })
  const parsed = parseProvenanceResponse(res.text, sentences.length)
  const labelled: LabelledSentence[] = sentences.map((s, i) => ({
    ...s,
    label: parsed[i].label,
    note: parsed[i].note,
  }))
  const unverifiedCount = labelled.filter((s) => s.label === 'unverified').length
  return {
    status: 'labelled',
    checked_at: checkedAt,
    website_url: websiteUrl,
    brief_id: briefId,
    sentences: labelled,
    unverified_count: unverifiedCount,
    cost_usd: res.cost_usd,
  }
}
