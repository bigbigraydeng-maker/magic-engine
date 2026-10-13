import {
  LEDGER_ID_PATTERN,
  PROBE_NAMES,
  type ParsedDescription,
  type ParsedProbe,
  type ProbeName,
} from './types'

/** Whole-line ledger-id line: `ledger-id: <token>` */
const LEDGER_LINE = /^ledger-id:\s*(\S+)$/
/** 描述总长与单行长度上限：日历描述是外部可写数据，超长直接截断/拒绝，防正则与内存被拖垮 */
const MAX_DESCRIPTION_CHARS = 8000
const MAX_LINE_CHARS = 300
/** Probe 行前缀；参数部分故意不用嵌套量词的正则（曾被构造输入造成指数回溯），改成 split 逐个校验 */
const PROBE_PREFIX = /^probe:\s*/
/** Param key: lowercase letters and underscores only */
const PARAM_KEY = /^[a-z][a-z_]*$/
/** Param value: conservative charset, bounded length */
const PARAM_VALUE = /^[A-Za-z0-9_.:-]{1,80}$/
/** cron_run_ok.job value */
const JOB_VALUE = /^[a-z0-9-]{1,60}$/
/** ledger_card_status.status allowed values */
const CARD_STATUSES: readonly string[] = ['decided', 'done', 'verified', 'failed']

/** Required params per probe: exact key set, no extras. */
const REQUIRED_PARAMS: Record<ProbeName, readonly string[]> = {
  cron_run_ok: ['job', 'within_hours'],
  todo_item_present: ['kind', 'client'],
  ledger_card_status: ['id', 'status'],
}

/** Split into trimmed lines, tolerating CRLF / CR / LF. */
function splitLines(description: string): string[] {
  return description
    .slice(0, MAX_DESCRIPTION_CHARS)
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
}

/** Parse `k=v` tokens into a record; returns null on any malformed token. */
function parseParams(tokens: string[]): Record<string, string> | null {
  const params: Record<string, string> = {}
  for (const token of tokens) {
    const eq = token.indexOf('=')
    if (eq <= 0) return null
    const key = token.slice(0, eq)
    const value = token.slice(eq + 1)
    if (!PARAM_KEY.test(key)) return null
    if (!PARAM_VALUE.test(value)) return null
    if (Object.prototype.hasOwnProperty.call(params, key)) return null
    params[key] = value
  }
  return params
}

/** Validate a probe's params against its per-probe required schema. */
function validateProbeParams(name: ProbeName, params: Record<string, string>): string | null {
  const required = REQUIRED_PARAMS[name]
  const keys = Object.keys(params)
  if (keys.length !== required.length) return '参数数量不符'
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) return `缺少参数 ${key}`
  }
  for (const key of keys) {
    if (!required.includes(key)) return `多余参数 ${key}`
  }

  if (name === 'cron_run_ok') {
    if (!JOB_VALUE.test(params.job)) return 'job 值不合格'
    if (!/^\d+$/.test(params.within_hours)) return 'within_hours 不是整数'
    const hours = Number(params.within_hours)
    if (hours < 1 || hours > 720) return 'within_hours 超出范围'
  } else if (name === 'ledger_card_status') {
    if (!LEDGER_ID_PATTERN.test(params.id)) return 'id 格式不合格'
    if (!CARD_STATUSES.includes(params.status)) return 'status 值不合格'
  }
  // todo_item_present: kind/client already validated by charset rules.
  return null
}

/**
 * Parse a calendar description into a strict, whitelisted candidate.
 * Never throws; untrusted input yields nulls plus a human-readable reason.
 */
export function parseDescription(description: string): ParsedDescription {
  const lines = splitLines(description)

  const ledgerTokens: string[] = []
  const probeMatches: { name: string; tokens: string[] }[] = []
  // 以 ledger-id: / probe: 开头的行一律计数——格式不合格的行也算"出现过"，不许悄悄忽略
  let ledgerLikeCount = 0
  let probeLikeCount = 0
  for (const line of lines) {
    if (/^ledger-id:/.test(line)) ledgerLikeCount += 1
    if (/^probe:/.test(line)) probeLikeCount += 1
    // 超长行不进任何正则/拆分：算"出现过但格式不合格"
    if (line.length > MAX_LINE_CHARS) continue
    const ledger = LEDGER_LINE.exec(line)
    if (ledger) {
      ledgerTokens.push(ledger[1])
      continue
    }
    if (PROBE_PREFIX.test(line)) {
      const tokens = line.replace(PROBE_PREFIX, '').split(/\s+/).filter((t) => t.length > 0)
      if (tokens.length > 0) probeMatches.push({ name: tokens[0], tokens: tokens.slice(1) })
    }
  }

  // --- ledger-id resolution ---
  let ledgerId: string | null = null
  let reason: string | null = null
  let ambiguous = false

  if (ledgerLikeCount > 1) {
    ambiguous = true
    reason = '描述里出现多个 ledger-id'
  } else if (ledgerLikeCount === 1 && ledgerTokens.length === 0) {
    reason = 'ledger-id 格式不合格'
  } else if (ledgerTokens.length === 0) {
    reason = '描述里没有 ledger-id'
  } else if (ledgerTokens.length > 1) {
    ambiguous = true
    reason = '描述里出现多个 ledger-id'
  } else if (!LEDGER_ID_PATTERN.test(ledgerTokens[0])) {
    reason = 'ledger-id 格式不合格'
  } else {
    ledgerId = ledgerTokens[0]
  }

  // --- probe resolution ---
  let probe: ParsedProbe | null = null

  if (probeLikeCount > probeMatches.length && probeLikeCount === 1) {
    if (reason === null) reason = 'probe 行不合格：格式错误'
  } else if (probeLikeCount > 1) {
    ambiguous = true
    probe = null
    if (reason === null) reason = '描述里出现多个 probe 行'
  } else if (probeMatches.length > 1) {
    ambiguous = true
    probe = null
    if (reason === null) reason = '描述里出现多个 probe 行'
  } else if (probeMatches.length === 1) {
    const { name, tokens } = probeMatches[0]

    if (!PROBE_NAMES.includes(name as ProbeName)) {
      if (reason === null) reason = `probe 行不合格：未知 probe ${name}`
    } else {
      const params = parseParams(tokens)
      if (params === null) {
        if (reason === null) reason = 'probe 行不合格：参数格式错误'
      } else {
        const paramError = validateProbeParams(name as ProbeName, params)
        if (paramError !== null) {
          if (reason === null) reason = `probe 行不合格：${paramError}`
        } else if (ledgerId === null) {
          // A probe is only meaningful when driven by a valid ledger-id.
          if (reason === null) reason = 'probe 行缺少有效 ledger-id'
        } else {
          probe = { name: name as ProbeName, params }
        }
      }
    }
  }

  return { ledgerId, probe, ambiguous, reason }
}

/** Titles starting with these markers are treated as already closed. */
const CLOSED_TITLE_PREFIXES: readonly string[] = ['✅', '❌', '作废', '（已验证', '【已验证']

/** True when the trimmed title starts with a closed marker. */
export function isClosedTitle(title: string): boolean {
  const trimmed = title.trim()
  return CLOSED_TITLE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}
