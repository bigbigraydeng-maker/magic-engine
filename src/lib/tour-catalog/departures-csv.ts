import { isValidIsoDate } from './dates'
import type { CatalogDepartureInternal, DepartureStatus } from './types'

export const MAX_CSV_BYTES = 2 * 1024 * 1024
export const MAX_CSV_ROWS = 2000

const BOM = '\uFEFF'

/** Parse RFC 4180 style CSV into a matrix of string cells. */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith(BOM) ? text.slice(BOM.length) : text
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }

    if (ch === ',') {
      record.push(field)
      field = ''
      i += 1
      continue
    }

    if (ch === '\r' || ch === '\n') {
      record.push(field)
      field = ''
      records.push(record)
      record = []
      if (ch === '\r' && input[i + 1] === '\n') {
        i += 2
      } else {
        i += 1
      }
      continue
    }

    field += ch
    i += 1
  }

  // Flush the final field/record unless the input ended exactly on a newline.
  const endedOnNewline =
    input.length > 0 && (input[input.length - 1] === '\n' || input[input.length - 1] === '\r')
  if (!endedOnNewline) {
    record.push(field)
    records.push(record)
  }

  return records
}

export interface ParsedDepartureRow {
  line: number
  tourName: string
  departOn: string
  returnOn: string
  status: DepartureStatus | null
  internal: CatalogDepartureInternal
}

export interface RejectedCsvRow {
  line: number
  reason: string
  detail?: string
}

export interface ParsedDeparturesCsv {
  rows: ParsedDepartureRow[]
  rejected: RejectedCsvRow[]
  fatal: string | null
}

type FieldKey =
  | 'tourName'
  | 'departOn'
  | 'returnOn'
  | 'status'
  | 'airline'
  | 'capacity'
  | 'outboundRoute'
  | 'inboundRoute'

const HEADER_ALIASES: Record<FieldKey, readonly string[]> = {
  tourName: ['行程名称', 'tour'],
  departOn: ['出团日期', 'depart_on'],
  returnOn: ['返程日期', 'return_on'],
  status: ['状态', 'status'],
  airline: ['航空公司', 'airline'],
  capacity: ['人数', 'capacity'],
  outboundRoute: ['去程航段', 'outbound_route'],
  inboundRoute: ['返程航段', 'inbound_route'],
}

const REQUIRED_FIELDS: readonly FieldKey[] = ['tourName', 'departOn', 'returnOn']

/** Chinese labels for each status, shared with UIs. */
export const STATUS_LABELS: Record<DepartureStatus, string> = {
  open: '可订',
  limited: '少量余位',
  sold_out: '已满团',
  closed: '已关闭',
  cancelled: '已取消',
}

/** Accepted status words: English codes (case-insensitive) and Chinese words (exact). */
const STATUS_ALIASES: Record<DepartureStatus, readonly string[]> = {
  open: ['open', '可订', '开放'],
  limited: ['limited', '少量余位', '余位不多'],
  sold_out: ['sold_out', '满团', '已满', '已售罄', '售罄'],
  closed: ['closed', '关闭', '已关闭'],
  cancelled: ['cancelled', '取消', '已取消'],
}

const TEXT_FIELDS: readonly FieldKey[] = ['tourName', 'airline', 'outboundRoute', 'inboundRoute']

const FORMULA_PREFIXES = ['=', '+', '@', '\t', '\r']

/** Map header cells to field keys using trimmed, case-insensitive aliases. */
function mapHeaders(header: string[]): Partial<Record<FieldKey, number>> {
  const mapping: Partial<Record<FieldKey, number>> = {}
  header.forEach((cell, index) => {
    const norm = cell.trim().toLowerCase()
    if (norm === '') {
      return
    }
    for (const key of Object.keys(HEADER_ALIASES) as FieldKey[]) {
      if (mapping[key] !== undefined) {
        continue
      }
      if (HEADER_ALIASES[key].some((alias) => alias.toLowerCase() === norm)) {
        mapping[key] = index
        return
      }
    }
  })
  return mapping
}

/** Read a cell by field key, trimmed; empty string when column or cell is absent. */
function cellAt(record: string[], mapping: Partial<Record<FieldKey, number>>, key: FieldKey): string {
  const index = mapping[key]
  if (index === undefined) {
    return ''
  }
  const value = record[index]
  return value === undefined ? '' : value.trim()
}

/** True when every cell in the record is empty after trimming. */
function isBlankRecord(record: string[]): boolean {
  return record.every((cell) => cell.trim() === '')
}

/**
 * True when a text cell starts with a formula-injection prefix.
 * Checks the RAW cell too: trimming would otherwise hide a leading tab or CR.
 */
function hasFormulaPrefix(raw: string): boolean {
  if (raw === '') {
    return false
  }
  const trimmed = raw.trim()
  return FORMULA_PREFIXES.includes(raw[0]) || (trimmed !== '' && FORMULA_PREFIXES.includes(trimmed[0]))
}

/** Read a cell by field key without trimming. */
function rawCellAt(record: string[], mapping: Partial<Record<FieldKey, number>>, key: FieldKey): string {
  const index = mapping[key]
  if (index === undefined) {
    return ''
  }
  return record[index] ?? ''
}

/** True when the value is a positive integer made only of digits. */
function isPositiveInteger(value: string): boolean {
  return /^[0-9]+$/.test(value) && Number(value) > 0
}

/** Resolve a status cell to a status code, or null when it is not recognised. */
function resolveStatus(value: string): DepartureStatus | null {
  const lower = value.toLowerCase()
  for (const key of Object.keys(STATUS_ALIASES) as DepartureStatus[]) {
    if (STATUS_ALIASES[key].some((alias) => alias === value || alias === lower)) {
      return key
    }
  }
  return null
}

/** Build the internal object, including only non-empty cells. */
function buildInternal(
  record: string[],
  mapping: Partial<Record<FieldKey, number>>,
): CatalogDepartureInternal {
  const internal: CatalogDepartureInternal = {}
  const airline = cellAt(record, mapping, 'airline')
  const capacity = cellAt(record, mapping, 'capacity')
  const outboundRoute = cellAt(record, mapping, 'outboundRoute')
  const inboundRoute = cellAt(record, mapping, 'inboundRoute')

  if (airline !== '') {
    internal.airline = airline
  }
  if (capacity !== '') {
    internal.capacity = Number(capacity)
  }
  if (outboundRoute !== '') {
    internal.outboundRoute = outboundRoute
  }
  if (inboundRoute !== '') {
    internal.inboundRoute = inboundRoute
  }
  return internal
}

/** Validate a single data record; returns a row or a rejection. */
function validateRecord(
  record: string[],
  mapping: Partial<Record<FieldKey, number>>,
  line: number,
): ParsedDepartureRow | RejectedCsvRow {
  const tourName = cellAt(record, mapping, 'tourName')
  const departOn = cellAt(record, mapping, 'departOn')
  const returnOn = cellAt(record, mapping, 'returnOn')
  const statusCell = cellAt(record, mapping, 'status')
  const capacity = cellAt(record, mapping, 'capacity')

  if (tourName === '') {
    return { line, reason: 'missing_tour_name' }
  }
  if (!isValidIsoDate(departOn)) {
    return { line, reason: 'invalid_depart_date', detail: departOn }
  }
  if (returnOn === '') {
    return { line, reason: 'missing_return_date' }
  }
  if (!isValidIsoDate(returnOn)) {
    return { line, reason: 'invalid_return_date', detail: returnOn }
  }
  if (returnOn < departOn) {
    return { line, reason: 'return_before_depart' }
  }

  let status: DepartureStatus | null = null
  if (statusCell !== '') {
    const resolved = resolveStatus(statusCell)
    if (resolved === null) {
      return { line, reason: 'invalid_status', detail: statusCell }
    }
    status = resolved
  }

  for (const key of TEXT_FIELDS) {
    if (hasFormulaPrefix(rawCellAt(record, mapping, key))) {
      return { line, reason: 'formula_injection', detail: key }
    }
  }

  if (capacity !== '' && !isPositiveInteger(capacity)) {
    return { line, reason: 'invalid_capacity', detail: capacity }
  }

  return {
    line,
    tourName,
    departOn,
    returnOn,
    status,
    internal: buildInternal(record, mapping),
  }
}

/** True when a value is a ParsedDepartureRow rather than a rejection. */
function isParsedRow(value: ParsedDepartureRow | RejectedCsvRow): value is ParsedDepartureRow {
  return 'tourName' in value
}

/** Parse a departures CSV file into accepted rows and rejections. */
export function parseDeparturesCsv(text: string): ParsedDeparturesCsv {
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) {
    return { rows: [], rejected: [], fatal: 'file_too_large' }
  }

  const records = parseCsv(text)
  const header = records[0]
  if (header === undefined) {
    return { rows: [], rejected: [], fatal: 'missing_required_columns' }
  }

  const mapping = mapHeaders(header)
  for (const key of REQUIRED_FIELDS) {
    if (mapping[key] === undefined) {
      return { rows: [], rejected: [], fatal: 'missing_required_columns' }
    }
  }

  const dataRecords: { record: string[]; line: number }[] = []
  for (let i = 1; i < records.length; i += 1) {
    const record = records[i]
    if (isBlankRecord(record)) {
      continue
    }
    dataRecords.push({ record, line: i + 1 })
  }

  if (dataRecords.length > MAX_CSV_ROWS) {
    return { rows: [], rejected: [], fatal: 'too_many_rows' }
  }

  const rows: ParsedDepartureRow[] = []
  const rejected: RejectedCsvRow[] = []
  for (const { record, line } of dataRecords) {
    const result = validateRecord(record, mapping, line)
    if (isParsedRow(result)) {
      rows.push(result)
    } else {
      rejected.push(result)
    }
  }

  return { rows, rejected, fatal: null }
}
