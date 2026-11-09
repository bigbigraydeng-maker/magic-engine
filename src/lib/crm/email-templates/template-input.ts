/**
 * 模板的写入：把浏览器传来的 JSON 严格解析成「一个新版本」，并在保存前检查文字。
 * 多余字段 / 类型不对一律拒绝，不悄悄丢弃；长度等细节由 `validateNewTemplateInput`（仓库层）再把一道关。
 */

import { getProvider } from './facts/registry'
import { evaluateContentGates } from './gates/content-gates'
import { substitute, validateTemplateText } from './placeholders'
import { TEMPLATE_KEY_RE } from './template-store'
import { FACT_SOURCES } from './types'
import type { EmailSettings, FactSource, PickFilter, PickMode, TemplateStatus } from './types'

export interface TemplateFields {
  name: string
  subject: string
  body: string
  factSource: FactSource
  pickMode: PickMode
  pickFilter: PickFilter
  status: TemplateStatus
  changeNote: string | null
}

export type ParsedTemplateWrite =
  | { ok: true; templateKey: string | null; baseVersion: number | null; fields: TemplateFields }
  | { ok: false; error: string }

const PICK_MODES: readonly PickMode[] = ['none', 'one', 'many']
const STATUSES: readonly TemplateStatus[] = ['active', 'disabled']
const FIELD_KEYS = ['name', 'subject', 'body', 'factSource', 'pickMode', 'pickFilter', 'status', 'changeNote']
const CREATE_KEYS = new Set([...FIELD_KEYS, 'templateKey'])
const UPDATE_KEYS = new Set([...FIELD_KEYS, 'baseVersion'])
const FILTER_KEYS = new Set(['destinations', 'tiers', 'departureMonths'])
const MAX_FILTER_ITEMS = 30
const MAX_FILTER_TEXT = 40

const bad = (error: string): ParsedTemplateWrite => ({ ok: false, error })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_FILTER_ITEMS) return null
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '' || item.length > MAX_FILTER_TEXT) return null
    out.push(item.trim())
  }
  return out
}

function readMonths(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > 12) return null
  const out: number[] = []
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 1 || item > 12) return null
    out.push(item)
  }
  return out
}

function parseFilter(raw: unknown): PickFilter | null {
  if (raw === undefined || raw === null) return {}
  if (!isRecord(raw)) return null
  const filter: PickFilter = {}
  for (const key of Object.keys(raw)) {
    if (!FILTER_KEYS.has(key)) return null
  }
  if (raw.destinations !== undefined) {
    const list = readStrings(raw.destinations)
    if (list === null) return null
    filter.destinations = list
  }
  if (raw.tiers !== undefined) {
    const list = readStrings(raw.tiers)
    if (list === null) return null
    filter.tiers = list
  }
  if (raw.departureMonths !== undefined) {
    const list = readMonths(raw.departureMonths)
    if (list === null) return null
    filter.departureMonths = list
  }
  return filter
}

function parseFields(raw: Record<string, unknown>, statusRequired: boolean): TemplateFields | string {
  const { name, subject, body, factSource, pickMode, status, changeNote } = raw
  if (typeof name !== 'string' || typeof subject !== 'string' || typeof body !== 'string') return '名称、主题、正文都要是文字。'
  if (typeof factSource !== 'string' || !FACT_SOURCES.includes(factSource as FactSource)) return '事实来源不对。'
  if (typeof pickMode !== 'string' || !PICK_MODES.includes(pickMode as PickMode)) return '选团方式不对。'
  if (status === undefined && statusRequired) return '要写明模板是启用还是停用。'
  const resolvedStatus = status === undefined ? 'disabled' : status
  if (typeof resolvedStatus !== 'string' || !STATUSES.includes(resolvedStatus as TemplateStatus)) return '模板状态不对。'
  if (changeNote !== undefined && changeNote !== null && typeof changeNote !== 'string') return '变更说明要是文字。'
  const pickFilter = parseFilter(raw.pickFilter)
  if (pickFilter === null) return '适用团的过滤条件格式不对。'
  return {
    name,
    subject,
    body,
    factSource: factSource as FactSource,
    pickMode: pickMode as PickMode,
    pickFilter,
    status: resolvedStatus as TemplateStatus,
    changeNote: typeof changeNote === 'string' ? changeNote : null,
  }
}

/**
 * create：必须带 templateKey，不能带 baseVersion（新模板从版本 1 开始，默认停用）。
 * update：必须带 baseVersion（改的是哪一版，别人改过就 409），不能带 templateKey（来自网址），且必须写明 status。
 */
export function parseTemplateWrite(raw: unknown, mode: 'create' | 'update'): ParsedTemplateWrite {
  if (!isRecord(raw)) return bad('请求格式不对。')
  const allowed = mode === 'create' ? CREATE_KEYS : UPDATE_KEYS
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return bad(`请求里有不认识的字段：${key.slice(0, 30)}。`)
  }
  let templateKey: string | null = null
  let baseVersion: number | null = null
  if (mode === 'create') {
    if (typeof raw.templateKey !== 'string' || !TEMPLATE_KEY_RE.test(raw.templateKey)) return bad('模板标识不对（小写字母、数字、连字符，2–63 位）。')
    templateKey = raw.templateKey
  } else {
    const base = raw.baseVersion
    if (typeof base !== 'number' || !Number.isInteger(base) || base < 1) return bad('要写明改的是哪一版。')
    baseVersion = base
  }
  const fields = parseFields(raw, mode === 'update')
  if (typeof fields === 'string') return bad(fields)
  return { ok: true, templateKey, baseVersion, fields }
}

export interface SaveCheck {
  errors: string[]
  notices: string[]
}

/** 占位符换成一个中性词，让「文字红线」只检查模板里手写的部分（链接域名、禁用语句、残留标记）。 */
function neutral(text: string): string {
  return substitute(text, () => ({ ok: true, value: 'x' })).text
}

/**
 * 保存前检查：占位符合法；手写部分不踩红线（有发信设置时才查）。
 * 这里拦住的是「这份模板永远发不出去」的写法；真正发信时还会对最终全文再查一遍。
 */
export function checkTemplateForSave(
  template: Pick<TemplateFields, 'subject' | 'body' | 'factSource' | 'pickMode'>,
  settings: Pick<EmailSettings, 'guardrails'> | null,
): SaveCheck {
  const errors: string[] = []
  const notices: string[] = []
  const provider = template.factSource === 'none' ? null : getProvider(template.factSource)
  if (template.factSource !== 'none' && provider === null) errors.push('这个事实来源现在不可用。')
  const variables = provider?.variables ?? {}
  for (const message of validateTemplateText(template.subject, 'subject', template.pickMode, variables)) errors.push(`主题：${message}`)
  for (const message of validateTemplateText(template.body, 'body', template.pickMode, variables)) errors.push(`正文：${message}`)

  if (settings === null) {
    notices.push('发信设置还没配好，文字红线（禁用词、链接域名）这次没有检查。')
    return { errors, notices }
  }
  const gates = evaluateContentGates({
    subject: neutral(template.subject),
    body: neutral(template.body),
    footer: null,
    settings,
    provider: null,
    facts: null,
  })
  for (const block of gates.blocks) errors.push(`文字红线：${block.ruleId ?? block.code}${block.detail ? `（${block.detail}）` : ''}`)
  for (const warning of gates.warnings) notices.push(`提醒：${warning.detail}`)
  return { errors, notices }
}

/** 仓库层的结果 → HTTP 状态。 */
export function statusForAppend(reason: 'conflict' | 'invalid' | 'error'): 400 | 409 | 503 {
  if (reason === 'conflict') return 409
  return reason === 'invalid' ? 400 : 503
}
