// Orchestrates the read-only booking import preview: parse -> read -> plan -> render.
// Pure glue: no IO of its own, no logging, no writes. The Supabase client is passed in.
// Invalid rows are reported by label and code only; contact details are never printed.
// Returns the preview lines, the plan items, the plan fingerprint and a few counters.
// The fingerprint hashes the plan items only. It is NOT an authorisation: a future write step must re-read the
// database, rebuild the plan from the input file, compare, and re-check every invoice at write time.

import type { SupabaseClient } from '@supabase/supabase-js'
import { guestLabel, renderPreview } from './mask'
import { parseRows } from './parse'
import { buildPlan, markInvoiceCheckUnavailable, planHash, summarise } from './plan'
import { readFacts, type Normalisers } from './reader'
import type { ImportRow, PlanItem } from './types'

export interface PreviewInput {
  clientId: string
  rawJson: string
  db: SupabaseClient
  norm: Normalisers
}

export interface PreviewOutput {
  lines: string[]
  items: PlanItem[]
  planSha: string
  invalidCount: number
  originColumnsMissing: boolean
}

const NO_FINGERPRINT_LINE = '计划指纹：不给（订单表缺列，发票号查重没做过，这份计划不能用来导入）'
const BAD_JSON_LINE = '输入文件不是合法的 JSON'
const MISSING_COLUMNS_LINE =
  '提醒：订单表里还没有「来源」「发票号」两列（迁移没应用），所以无法核对发票号是否已导入。'

function parseJson(rawJson: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(rawJson) }
  } catch {
    return { ok: false }
  }
}

function invalidLine(index: number, code: string): string {
  if (index < 0) return `输入文件整体读不懂：${code}`
  return `${guestLabel(index)} · 读不懂这一行：${code}`
}

interface SplitRows {
  rows: ImportRow[]
  invalidLines: string[]
}

function splitRows(raw: unknown): SplitRows {
  const rows: ImportRow[] = []
  const invalidLines: string[] = []
  for (const outcome of parseRows(raw)) {
    if (outcome.ok) {
      rows.push(outcome.row)
    } else {
      invalidLines.push(invalidLine(outcome.index, outcome.code))
    }
  }
  return { rows, invalidLines }
}

function emptyOutput(lines: string[]): PreviewOutput {
  return {
    lines,
    items: [],
    planSha: '',
    invalidCount: 0,
    originColumnsMissing: false,
  }
}

/** Run the whole preview. Never throws on bad input; only on unexpected read errors. */
export async function runPreview(input: PreviewInput): Promise<PreviewOutput> {
  const parsed = parseJson(input.rawJson)
  if (!parsed.ok) return emptyOutput([BAD_JSON_LINE])

  const { rows, invalidLines } = splitRows(parsed.value)
  const { facts, originColumnsMissing } = await readFacts(
    input.db,
    input.clientId,
    rows,
    input.norm,
  )
  const planned = buildPlan(rows, facts)
  // Without the invoice column the "already imported?" check was not done: nothing is ready, and no fingerprint is given.
  const items = originColumnsMissing ? markInvoiceCheckUnavailable(planned) : planned
  const summary = summarise(items)
  const planSha = originColumnsMissing ? '' : await planHash(items)

  const lines: string[] = []
  if (invalidLines.length > 0) {
    lines.push('读不懂的行：')
    for (const line of invalidLines) lines.push(line)
  }
  for (const line of renderPreview(items, summary)) lines.push(line)
  if (originColumnsMissing) lines.push(MISSING_COLUMNS_LINE)
  lines.push(originColumnsMissing ? NO_FINGERPRINT_LINE : `计划指纹：${planSha}`)

  return {
    lines,
    items,
    planSha,
    invalidCount: invalidLines.length,
    originColumnsMissing,
  }
}
