/**
 * 广告草案的「禁用词」：加载 + 比对。
 *
 * ── 为什么不在 /draft 路由里自己拼 ───────────────────────────────────────
 * `draft-listing` 路由已经把 `clients.brand_redline_phrases` 和 `master_briefs`
 * 的 `avoid_words` / `excluded_topics` 并在一起当禁用词。通用 `/draft` 如果只读
 * 其中一个，就比 `draft-listing` 更松 —— 同一个客户走哪个入口，红线不一样。
 *
 * ── 比对口径 ──────────────────────────────────────────────────────────────
 * 复用 `scanRedlineHits`（出片线、`listing-draft-builder` 用的同一把尺），前面多
 * 一道 `foldForRedline`：全角数字 / 字母折成半角，去掉零宽字符和软连字符。
 * 否则全角数字或夹了零宽字符的词，都能绕过子串匹配。
 *
 * 这里只管**文字**。视频画面、缩略图上印的字扫不到，仍靠人看。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { scanRedlineHits } from '@/lib/factory/worker-guard'
import type { AdDraft, DraftProblem } from './ad-draft'

/** 零宽空格 / 连接符 / 方向标记 / 词连接符 / BOM / 软连字符。 */
const INVISIBLE = /[​-‏⁠﻿­]/g

/** 标点和符号（逗号、连字符、引号……）。 */
const PUNCT = /[\p{P}\p{S}]+/gu

/**
 * 折叠成「人眼看起来一样的字」再比：全角转半角、去零宽字符、标点当空格。
 * 挡不住的：`ninety-eight years`、同形异码字母、`一九二八年`。
 */
export function foldForRedline(s: string): string {
  return s.normalize('NFKC').replace(INVISIBLE, '').replace(PUNCT, ' ').replace(/\s+/g, ' ')
}

/** 折叠后短于这个长度的短语不参与比对（见 `unusableRedlinePhrases`）。 */
const MIN_PHRASE_LEN = 2

/** 纯 ASCII 字母数字 + 空格 → 按整词比（`ai` 不该命中 `email`）；有中文 / 其它文字的按子串比。 */
const ASCII_WORDS = /^[\x20-\x7E]+$/

/** 词边界标记：用一个不会出现在正常文案里的控制字符，借 `scanRedlineHits` 的子串比对做整词比对。 */
const SEP = '\u0001'
const asWords = (folded: string): string => `${SEP}${folded.trim().replace(/ /g, SEP)}${SEP}`

/**
 * 折叠后太短、不拿来比的短语 —— 空串会让 `includes('')` 恒真，每条广告都命中。
 * 单独导出是为了**不静默忽略**：调用方要把它们记进回执，让人知道名单里有条目没生效。
 */
export function unusableRedlinePhrases(phrases: readonly string[]): string[] {
  return phrases.filter((p) => foldForRedline(p).trim().length < MIN_PHRASE_LEN)
}

/**
 * 哪些禁用词出现在这些文字里。返回的是**调用方传进来的原短语**（不是折叠后的），
 * 方便原样报给人。
 */
export function findRedlineHits(
  texts: ReadonlyArray<string | null | undefined>,
  phrases: readonly string[],
): string[] {
  const words = new Map<string, string>() // 整词比
  const substrings = new Map<string, string>() // 子串比
  for (const p of phrases) {
    const f = foldForRedline(p).trim()
    if (f.length < MIN_PHRASE_LEN) continue
    const target = ASCII_WORDS.test(f) ? words : substrings
    const key = target === words ? asWords(f) : f
    if (!target.has(key)) target.set(key, p)
  }
  if (words.size === 0 && substrings.size === 0) return []

  const folded = texts.map((t) => (typeof t === 'string' ? foldForRedline(t) : null))
  const hits = new Set<string>()
  const scan = (surface: Array<string | null>, m: Map<string, string>) => {
    if (m.size === 0) return
    for (const hit of scanRedlineHits(surface, [...m.keys()], [])) hits.add(m.get(hit) ?? hit)
  }
  scan(folded, substrings)
  scan(folded.map((t) => (t === null ? null : asWords(t))), words)
  return [...hits]
}

/** 草案里买家会读到的、由我们传给 Meta 的所有字（正文 / 标题 / 描述）。 */
function draftTexts(d: AdDraft): string[] {
  // 请求体形状没人保证过：条目可能是 null / 数字。形状错误由 `validateDraft` 报，这里不能抛。
  return d.creatives.flatMap((c) =>
    typeof c === 'object' && c !== null ? [c.primaryText, c.headline, c.description ?? ''] : [],
  )
}

/**
 * 建之前的红线检查，结果并进 `validateDraft` 的问题清单一起报。
 *
 * - `redlines === undefined`：**没加载**。私信类型 fail-closed（拒），其它类型沿用旧行为
 *   （不查）。
 * - `redlines === []`：查过，这个客户没配。放行。
 * 这两个值绝不能混 —— 混了，「红线没生效」就长得和「红线是空的」一模一样。
 *
 * 放在这里而不在 `validateDraft` 里：`ad-draft.ts` 是审批页也会引用的轻模块，
 * 不该为了一个子串扫描把出片线的依赖链拖进去（子牙 2026-10-04）。
 */
export function checkDraftRedlines(
  d: AdDraft,
  redlines: readonly string[] | undefined,
): DraftProblem[] {
  if (redlines === undefined) {
    return d.kind === 'messenger_conversation'
      ? [{ field: 'brandRedlines', message: '没拿到这个客户的禁用词（读库失败或没传）—— 私信广告不允许在没查红线的情况下建' }]
      : []
  }
  if (!Array.isArray(d.creatives)) return []
  const hits = findRedlineHits(draftTexts(d), redlines)
  return hits.length === 0
    ? []
    : [{ field: 'creatives', message: `文案里出现了客户的禁用词：${hits.join('、')}` }]
}

/** 字段读成 null / 缺失 = 没配 → []；数组 = 取其中的字符串；其它任何形状 = 读不懂 → null。 */
function readList(v: unknown): string[] | null {
  if (v === null || v === undefined) return []
  if (!Array.isArray(v)) return null
  return v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
}

/**
 * 读一个客户的全部禁用词。
 *
 * 返回 `null`（= 没读到 / 读不懂），**不是**空数组：空数组的意思是「查过，这个客户
 * 没配」。把这两件事混成一件，就是「红线没生效」和「红线是空的」分不出来。
 * 下面每一种意外都按 null 处理：读库报错、客户行读不到、字段被存成了字符串 /
 * 对象而不是数组。
 */
export async function loadDraftRedlines(
  supabase: SupabaseClient,
  clientId: string,
): Promise<string[] | null> {
  const [client, brief] = await Promise.all([
    supabase.from('clients').select('brand_redline_phrases').eq('id', clientId).maybeSingle(),
    supabase
      .from('master_briefs')
      .select('avoid_words, excluded_topics')
      .eq('client_id', clientId)
      .eq('is_active', true)
      .maybeSingle(),
  ])
  if (client.error || brief.error) return null
  if (!client.data) return null // 连客户这一行都读不到，不能说「这个客户没配红线」

  const c = client.data as { brand_redline_phrases?: unknown }
  const b = (brief.data ?? {}) as { avoid_words?: unknown; excluded_topics?: unknown }
  const lists = [readList(c.brand_redline_phrases), readList(b.avoid_words), readList(b.excluded_topics)]
  return lists.some((l) => l === null) ? null : lists.flat() as string[]
}
