/**
 * 把浏览器传来的 `template` 字段严格解析成 `TemplateRequest`。
 * 多余的字段、类型不对、过长一律拒绝（400），不悄悄丢弃——销售以为选了的东西不能被系统默默改掉。
 */

import type { PickInput } from './facts/types'
import type { TemplateRequest } from './send-gates'
import { TEMPLATE_KEY_RE } from './template-store'
import type { CallBasis } from './types'

export type ParsedTemplateRequest = { ok: true; template: TemplateRequest | null } | { ok: false; error: string }

const ALLOWED_KEYS: ReadonlySet<string> = new Set(['key', 'version', 'catalogVersion', 'picks', 'inputs', 'callBasis'])
const CALL_BASES: readonly CallBasis[] = ['none', 'system_call', 'staff_attested']
const MAX_PICKS = 10
const MAX_INPUTS = 20
const MAX_INPUT_LEN = 2000
const INPUT_KEY_RE = /^[a-z][a-z0-9_]{0,30}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const bad = (error: string): ParsedTemplateRequest => ({ ok: false, error })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInt(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min
}

function parsePicks(raw: unknown): PickInput[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > MAX_PICKS) return null
  const picks: PickInput[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) return null
    const { tourId, departOn } = entry
    if (typeof tourId !== 'string' || tourId.length === 0 || tourId.length > 64) return null
    if (departOn !== null && departOn !== undefined && (typeof departOn !== 'string' || !DATE_RE.test(departOn))) return null
    picks.push({ tourId, departOn: typeof departOn === 'string' ? departOn : null })
  }
  return picks
}

function parseInputs(raw: unknown): Record<string, string> | null {
  if (raw === undefined) return {}
  if (!isRecord(raw)) return null
  const entries = Object.entries(raw)
  if (entries.length > MAX_INPUTS) return null
  const inputs: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (!INPUT_KEY_RE.test(key) || typeof value !== 'string' || value.length > MAX_INPUT_LEN) return null
    inputs[key] = value
  }
  return inputs
}

export function parseTemplateRequest(raw: unknown): ParsedTemplateRequest {
  if (raw === undefined || raw === null) return { ok: true, template: null }
  if (!isRecord(raw)) return bad('模板参数格式不对。')
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) return bad(`模板参数里有不认识的字段：${key.slice(0, 30)}。`)
  }
  const { key, version, catalogVersion } = raw
  if (typeof key !== 'string' || !TEMPLATE_KEY_RE.test(key)) return bad('模板标识不对。')
  if (!isInt(version, 1)) return bad('模板版本号不对。')
  if (catalogVersion !== undefined && catalogVersion !== null && !isInt(catalogVersion, 0)) return bad('目录版本号不对。')
  const picks = parsePicks(raw.picks)
  if (picks === null) return bad('所选的团 / 班期格式不对。')
  const inputs = parseInputs(raw.inputs)
  if (inputs === null) return bad('手填的内容格式不对。')
  const callBasis = raw.callBasis === undefined ? 'none' : raw.callBasis
  if (typeof callBasis !== 'string' || !CALL_BASES.includes(callBasis as CallBasis)) return bad('通话依据不对。')
  return {
    ok: true,
    template: { key, version, catalogVersion: catalogVersion ?? null, picks, inputs, callBasis: callBasis as CallBasis },
  }
}
