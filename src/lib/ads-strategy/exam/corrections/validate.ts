import {
  CORRECTION_RECORD_SCHEMA_VERSION,
  type AdsAgentCorrection,
  type AdsCorrectionKind,
  type AdsCorrectionRecordsFile,
} from './types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ID_RE = /^CR-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/
const ACCOUNT_RE = /\d{10,}/
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

const KINDS: readonly AdsCorrectionKind[] = [
  'diagnosis',
  'draft_advice',
  'metrics_read',
  'suggestion',
]

export interface CorrectionValidationError {
  readonly path: string
  readonly reason: string
}

export interface CorrectionValidationResult {
  readonly ok: boolean
  readonly errors: readonly CorrectionValidationError[]
}

function err(path: string, reason: string): CorrectionValidationError {
  return { path, reason }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function scanSensitive(text: string, path: string, errors: CorrectionValidationError[]): void {
  if (ACCOUNT_RE.test(text)) {
    errors.push(err(path, '正文含 10 位以上连续数字'))
  }
  if (EMAIL_RE.test(text)) {
    errors.push(err(path, '正文含邮箱形态'))
  }
}

function validateOne(raw: unknown, index: number): CorrectionValidationError[] {
  const errors: CorrectionValidationError[] = []
  const base = `corrections[${index}]`
  if (typeof raw !== 'object' || raw === null) {
    return [err(base, '必须是对象')]
  }
  const o = raw as Record<string, unknown>

  const id = str(o.id)
  if (id === null) errors.push(err(`${base}.id`, '必填'))
  else if (!ID_RE.test(id)) errors.push(err(`${base}.id`, '格式须为 CR-YYYY-MM-DD-…'))

  const recordedOn = str(o.recordedOn)
  if (recordedOn === null) errors.push(err(`${base}.recordedOn`, '必填'))
  else if (!DATE_RE.test(recordedOn)) errors.push(err(`${base}.recordedOn`, '须为 YYYY-MM-DD'))

  if (o.saidBy !== 'pm') errors.push(err(`${base}.saidBy`, '须为 pm'))

  const kind = str(o.kind)
  if (kind === null || !KINDS.includes(kind as AdsCorrectionKind)) {
    errors.push(err(`${base}.kind`, `须为 ${KINDS.join(' | ')} 之一`))
  }

  for (const key of ['wrongSummary', 'correctSummary', 'source'] as const) {
    const value = str(o[key])
    if (value === null) errors.push(err(`${base}.${key}`, '必填'))
    else scanSensitive(value, `${base}.${key}`, errors)
  }

  const promoted = o.promoted_to
  if (promoted !== undefined && promoted !== null) {
    const pq = str(promoted)
    if (pq === null || !/^Q\d{2}$/.test(pq)) {
      errors.push(err(`${base}.promoted_to`, '须为 Q01 样式或省略'))
    }
  }

  return errors
}

export function validateCorrectionRecord(record: AdsAgentCorrection): CorrectionValidationResult {
  return {
    ok: true,
    errors: validateOne(record, 0).map((e) => ({
      ...e,
      path: e.path.replace('corrections[0]', record.id),
    })),
  }
}

export function validateCorrectionsFile(data: unknown): CorrectionValidationResult {
  const errors: CorrectionValidationError[] = []
  if (typeof data !== 'object' || data === null) {
    return { ok: false, errors: [err('root', '必须是对象')] }
  }
  const root = data as Record<string, unknown>
  if (root.schemaVersion !== CORRECTION_RECORD_SCHEMA_VERSION) {
    errors.push(err('schemaVersion', `须为 ${CORRECTION_RECORD_SCHEMA_VERSION}`))
  }
  const list = root.corrections
  if (!Array.isArray(list)) {
    errors.push(err('corrections', '必须是数组'))
    return { ok: false, errors }
  }
  const seen = new Set<string>()
  for (let i = 0; i < list.length; i++) {
    errors.push(...validateOne(list[i], i))
    const id = str((list[i] as Record<string, unknown>)?.id)
    if (id !== null) {
      if (seen.has(id)) errors.push(err(`corrections[${i}].id`, '题内 id 重复'))
      seen.add(id)
    }
  }
  return { ok: errors.length === 0, errors }
}

export function assertValidCorrectionsFile(data: unknown): asserts data is AdsCorrectionRecordsFile {
  const result = validateCorrectionsFile(data)
  if (!result.ok) {
    const detail = result.errors.map((e) => `${e.path}: ${e.reason}`).join('; ')
    throw new Error(`广告纠正记录校验失败：${detail}`)
  }
}
