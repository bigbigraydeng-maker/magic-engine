import type { PickMode } from './types'
import type { ProviderValue, VariableSpec } from './facts/types'

export interface PlaceholderRef {
  raw: string
  name: string
  count: number | null
  start: number
  end: number
}

export const COMMON_VARIABLES: readonly string[] = ['first_name', 'sender_name', 'call_when', 'catalogue_url']

export const INPUT_VARIABLE_RE: RegExp = /^input\.[a-z][a-z0-9_]{0,30}$/

const VARIABLE_LABELS: Readonly<Record<string, string>> = {
  first_name: '客人名字',
  sender_name: '销售名字',
  call_when: '通话时间',
  catalogue_url: '目录链接',
  tour_name: '团名',
  tour_duration: '几天',
  tour_price: '价格',
  departure_date: '出发日期',
  tour_url: '团页链接',
  tour_highlights: '行程亮点',
  tour_inclusions: '费用包含',
  tour_cards: '多个团卡片',
  all_tours_url: '全部团链接',
}

export function variableLabel(name: string): string {
  if (name.startsWith('input.')) {
    const tail = name.slice('input.'.length).replace(/_/g, ' ')
    return tail === '' ? name : `手填：${tail}`
  }
  return VARIABLE_LABELS[name] ?? name
}

// {{ name }} or {{ name:N }} with optional inner spaces; N is 1-2 digits.
const PLACEHOLDER_RE = /\{\{\s*([a-z_][a-z0-9_.]*)\s*(?::\s*(\d{1,2})\s*)?\}\}/g

const MAX_COUNT = 20

export function scanPlaceholders(text: string): PlaceholderRef[] {
  const refs: PlaceholderRef[] = []
  const re = new RegExp(PLACEHOLDER_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const raw = match[0]
    const name = match[1]
    const countStr = match[2]
    refs.push({
      raw,
      name,
      count: countStr === undefined ? null : Number(countStr),
      start: match.index,
      end: match.index + raw.length,
    })
  }
  return refs
}

export function hasUnresolvedBraces(text: string): boolean {
  return text.includes('{{') || text.includes('}}')
}

function stripPlaceholders(text: string): string {
  return text.replace(new RegExp(PLACEHOLDER_RE.source, 'g'), '')
}

function isKnownName(
  name: string,
  providerVars: Readonly<Record<string, VariableSpec>>,
): boolean {
  if (COMMON_VARIABLES.includes(name)) return true
  if (INPUT_VARIABLE_RE.test(name)) return true
  return Object.prototype.hasOwnProperty.call(providerVars, name)
}

function checkCount(ref: PlaceholderRef, spec: VariableSpec | undefined): string | null {
  if (ref.count === null) return null
  if (!spec || !spec.list) return `变量 {{${ref.name}}} 不支持数量后缀`
  if (ref.count < 1 || ref.count > MAX_COUNT) {
    return `变量 {{${ref.name}}} 的数量后缀超出范围（1-${MAX_COUNT}）`
  }
  return null
}

function checkOne(
  ref: PlaceholderRef,
  field: 'subject' | 'body',
  pickMode: PickMode,
  providerVars: Readonly<Record<string, VariableSpec>>,
): string | null {
  if (!isKnownName(ref.name, providerVars)) {
    return `未知变量 {{${ref.name}}}`
  }
  const spec = Object.prototype.hasOwnProperty.call(providerVars, ref.name)
    ? providerVars[ref.name]
    : undefined
  if (!spec) {
    // Common and input variables never take a count suffix.
    return checkCount(ref, undefined)
  }
  if (!spec.pickModes.includes(pickMode)) {
    return `变量 {{${ref.name}}} 与选团方式不匹配`
  }
  const countError = checkCount(ref, spec)
  if (countError) return countError
  if (field === 'subject' && spec.multiline) {
    return `主题里不能用多行变量 {{${ref.name}}}`
  }
  return null
}

export function validateTemplateText(
  text: string,
  field: 'subject' | 'body',
  pickMode: PickMode,
  providerVars: Readonly<Record<string, VariableSpec>>,
): string[] {
  const errors: string[] = []
  const push = (msg: string): void => {
    if (!errors.includes(msg)) errors.push(msg)
  }

  if (hasUnresolvedBraces(stripPlaceholders(text))) {
    push('占位符格式不正确')
  }

  for (const ref of scanPlaceholders(text)) {
    const err = checkOne(ref, field, pickMode, providerVars)
    if (err) push(err)
  }

  return errors
}

export function substitute(
  text: string,
  resolve: (ref: PlaceholderRef) => ProviderValue,
): { text: string; missing: string[] } {
  const missing: string[] = []
  const re = new RegExp(PLACEHOLDER_RE.source, 'g')
  const out = text.replace(re, (raw: string, name: string, countStr: string | undefined, offset: number) => {
    const ref: PlaceholderRef = {
      raw,
      name,
      count: countStr === undefined ? null : Number(countStr),
      start: offset,
      end: offset + raw.length,
    }
    const value = resolve(ref)
    if (value.ok) return value.value
    if (!missing.includes(value.missing)) missing.push(value.missing)
    return raw
  })
  return { text: out, missing }
}
