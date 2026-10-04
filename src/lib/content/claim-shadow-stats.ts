/**
 * 影子统计 —— 价格/日期识别补强(2026-10-05)的对照工具。
 *
 * 只读纯函数:拿一批已发/待发文案,同时用「补强前冻结的旧正则」和「现行新正则」各扫一遍,
 * 报告新规则多命中多少条、哪些是新增命中(人工看是不是误伤)。
 *
 * 冻结副本只用于这次对照与回归测试,影子期结束后可以删。
 */

import { PRICE_CLAIM_RECALL_RE, PRICE_CLAIM_STRICT_RE } from './price-claim'
import { findDateClaims } from './date-claim'

/**
 * 2026-10-05 冻结,禁止修改;第 4 步接线 PR 合并且影子报告归档后整份删除。
 *
 * 三个正则都带 `g` 标志,只允许用 `String.prototype.match` 调用 —— `RegExp.test`
 * 会推进 `lastIndex`,跨模块共用同一个实例时会出现「隔次返回 false」的幽灵 bug。
 */
export const LEGACY_PRICE_RECALL_RE =
  /(?:\$|a\$|nz\$|\baud\b|￥)\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:%|\boff\b|\bdollars?\b|\bbucks\b|\/\s*m²|\/\s*m2|\/\s*sqm|\bper\s*m²?)|\d[\d,]*\s*\bfor\b\s*\d/gi

/**
 * 2026-10-05 冻结,禁止修改;第 4 步接线 PR 合并且影子报告归档后整份删除。
 */
export const LEGACY_PRICE_STRICT_RE = new RegExp(
  [
    String.raw`(?:\$|a\$|nz\$|\baud\b|￥)\s*\d[\d,]*(?:\.\d+)?`,
    String.raw`\d[\d,]*(?:\.\d+)?\s*(?:\bdollars?\b|\bbucks\b)`,
    String.raw`\d[\d,]*(?:\.\d+)?\s*%?\s*\boff\b`,
    String.raw`\b(?:save|saving|savings|discount|discounted|sale|rrp)\b[^\n]{0,12}?\d[\d,]*(?:\.\d+)?\s*%`,
    String.raw`\d[\d,]*(?:\.\d+)?\s*(?:\/\s*m²|\/\s*m2|\/\s*sqm|\bper\s*m²?\b)`,
    String.raw`\bbuy\s*\d[\d,]*\s*(?:\bfor\b|\bget\b)\s*\d`,
  ].join('|'),
  'gi',
)

/**
 * 2026-10-05 冻结,禁止修改;第 4 步接线 PR 合并且影子报告归档后整份删除。
 */
export const LEGACY_DATE_RE =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{2,4}\b|\b(?:19|20)\d{2}\b/gi

export type ClaimLayer = 'price_recall' | 'price_strict' | 'date_strict'

export interface ShadowRow {
  id: string
  source: string
  text: string | null
}

export interface ShadowHit {
  id: string
  source: string
  layer: ClaimLayer
  fragments: string[]
  excerpt: string
}

export interface ShadowLayerStats {
  legacyHits: number
  newHits: number
  newlyHit: number
  lostHits: number
}

export interface ShadowReport {
  total: number
  withText: number
  layers: Record<ClaimLayer, ShadowLayerStats>
  newlyHit: ShadowHit[]
  lostHits: ShadowHit[]
}

const LAYERS: readonly ClaimLayer[] = ['price_recall', 'price_strict', 'date_strict']

const MAX_FRAGMENTS = 5
const EXCERPT_LENGTH = 160
const ANCHOR_CONTEXT = 60

function emptyLayerStats(): ShadowLayerStats {
  return { legacyHits: 0, newHits: 0, newlyHit: 0, lostHits: 0 }
}

function emptyLayers(): Record<ClaimLayer, ShadowLayerStats> {
  return {
    price_recall: emptyLayerStats(),
    price_strict: emptyLayerStats(),
    date_strict: emptyLayerStats(),
  }
}

function dedupe(fragments: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const fragment of fragments) {
    if (seen.has(fragment)) continue
    seen.add(fragment)
    out.push(fragment)
    if (out.length >= MAX_FRAGMENTS) break
  }
  return out
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 生成摘录。给了 `anchor`(命中片段)时,窗口围绕命中位置展开,而不是永远截文案开头 ——
 * 否则长文案里的新增命中会被截掉,人工复核时看不到到底命中了什么。
 *
 * anchor 与正文都先折叠空白再查找,保证「片段来自折叠后的文本」这一前提成立。
 */
function makeExcerpt(text: string, anchor?: string): string {
  const collapsed = collapse(text)

  if (anchor) {
    const needle = collapse(anchor)
    const at = needle.length > 0 ? collapsed.indexOf(needle) : -1
    if (at >= 0) {
      const start = Math.max(0, at - ANCHOR_CONTEXT)
      const end = Math.min(collapsed.length, at + needle.length + ANCHOR_CONTEXT)
      const head = start > 0 ? '…' : ''
      const tail = end < collapsed.length ? '…' : ''
      return `${head}${collapsed.slice(start, end)}${tail}`
    }
  }

  return collapsed.length > EXCERPT_LENGTH ? collapsed.slice(0, EXCERPT_LENGTH) : collapsed
}

/**
 * 对一行文案跑某一层的旧 / 新匹配器。
 *
 * price_strict 是**会挡住发布**的硬闸,所以这一层的新增命中要重点人工复核。
 * date_strict 只是信息性的:精确日期识别器还没接进任何渠道,这里的「新增命中」
 * 意思是「旧日期正则漏了,但精确识别器看到了一个日期」。
 */
function matchLayer(layer: ClaimLayer, text: string): { oldFragments: string[]; newFragments: string[] } {
  switch (layer) {
    case 'price_recall':
      return {
        oldFragments: text.match(LEGACY_PRICE_RECALL_RE) ?? [],
        newFragments: text.match(PRICE_CLAIM_RECALL_RE) ?? [],
      }
    case 'price_strict':
      return {
        oldFragments: text.match(LEGACY_PRICE_STRICT_RE) ?? [],
        newFragments: text.match(PRICE_CLAIM_STRICT_RE) ?? [],
      }
    case 'date_strict':
      return {
        oldFragments: text.match(LEGACY_DATE_RE) ?? [],
        newFragments: findDateClaims(text),
      }
  }
}

/**
 * 单层扫描:更新该层计数,并把新增 / 丢失命中追加到对应列表。
 *
 * date_strict 层不统计 lostHits —— 旧日期正则的命中几乎全是裸年份(2027),
 * 所以这一层的「新增命中」只说明精确识别器多看见了日期,不代表误伤;
 * 而精确识别器有意比旧正则窄,「丢失」在这里没有意义。
 *
 * 对 price_recall / price_strict 两层,lostHits 恒为 0 是结构性的(旧源原样排在
 * 新正则最前面),它只是一道回退报警:一旦非 0,说明新正则漏掉了旧正则能抓的东西。
 */
function scanLayer(
  layer: ClaimLayer,
  row: ShadowRow,
  text: string,
  stats: ShadowLayerStats,
  newlyHit: ShadowHit[],
  lostHits: ShadowHit[],
): void {
  const { oldFragments, newFragments } = matchLayer(layer, text)

  if (oldFragments.length > 0) stats.legacyHits += 1
  if (newFragments.length > 0) stats.newHits += 1

  if (newFragments.length > 0 && oldFragments.length === 0) {
    stats.newlyHit += 1
    const fragments = dedupe(newFragments)
    newlyHit.push({
      id: row.id,
      source: row.source,
      layer,
      fragments,
      excerpt: makeExcerpt(text, fragments[0]),
    })
  }

  if (layer === 'date_strict') return

  if (oldFragments.length > 0 && newFragments.length === 0) {
    stats.lostHits += 1
    const fragments = dedupe(oldFragments)
    lostHits.push({
      id: row.id,
      source: row.source,
      layer,
      fragments,
      excerpt: makeExcerpt(text, fragments[0]),
    })
  }
}

export function compareClaimRules(rows: ReadonlyArray<ShadowRow>): ShadowReport {
  const layers = emptyLayers()
  const newlyHit: ShadowHit[] = []
  const lostHits: ShadowHit[] = []
  let withText = 0

  for (const row of rows) {
    const text = row.text
    if (typeof text !== 'string' || text.length === 0) continue
    withText += 1

    for (const layer of LAYERS) {
      scanLayer(layer, row, text, layers[layer], newlyHit, lostHits)
    }
  }

  return {
    total: rows.length,
    withText,
    layers,
    newlyHit,
    lostHits,
  }
}

function formatHit(hit: ShadowHit): string {
  return `- [${hit.layer}] ${hit.source}/${hit.id}: ${hit.fragments.join(' | ')} —— ${hit.excerpt}`
}

export function formatShadowReport(report: ShadowReport): string {
  const lines: string[] = []

  lines.push('# 价格/日期识别补强影子报告')
  lines.push('')
  lines.push(`总行数:${report.total} · 有文案行数:${report.withText}`)
  lines.push('')
  lines.push('| 层 | 旧命中 | 新命中 | 新增命中 | 丢失命中 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const layer of LAYERS) {
    const stats = report.layers[layer]
    lines.push(
      `| ${layer} | ${stats.legacyHits} | ${stats.newHits} | ${stats.newlyHit} | ${stats.lostHits} |`,
    )
  }
  lines.push('')

  lines.push('## 新增命中明细')
  lines.push('')
  if (report.newlyHit.length === 0) {
    lines.push('无')
  } else {
    for (const hit of report.newlyHit) lines.push(formatHit(hit))
  }
  lines.push('')

  lines.push('## 丢失命中(应为 0)')
  lines.push('')
  if (report.lostHits.length === 0) {
    lines.push('无')
  } else {
    for (const hit of report.lostHits) lines.push(formatHit(hit))
  }
  lines.push('')

  return lines.join('\n')
}
