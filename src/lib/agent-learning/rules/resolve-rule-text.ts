import { createHash } from 'node:crypto'
import type { Result } from '@/lib/agent-learning/contracts'
import { findRuleRows, RULE_ID_RE, rowMentionsCard } from '@/lib/skill-cards/board'

/** 规则句取不到的原因码；错误串固定为 `rule_unresolved:<reason>` */
export type RuleUnresolvedReason =
  | 'row_not_found'
  | 'row_ambiguous'
  | 'header_not_found'
  | 'no_body_column'
  | 'row_shape_mismatch'
  | 'body_empty'
  | 'too_long'

/** 规则句最大长度：超长不截断，直接判失败 */
export const RULE_TEXT_MAX_CHARS = 600

export interface ResolvedRule {
  /** 注入用的规则句正文（只含条件/判据列，必要时接动作列） */
  text: string
  /** 编号列里编号后面的短标题：不是正文，不得当规则句 */
  title: string
  /** text 的 sha256（与 rule_text_sha 同值） */
  textSha: string
}

type FailCode = 'validation' | 'not_found' | 'conflict'

type Failure = { ok: false; error: string; code: FailCode }

function fail(reason: RuleUnresolvedReason, code: FailCode): Failure {
  return { ok: false, error: `rule_unresolved:${reason}`, code }
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 按 | 拆单元格：不拆转义的 \| ，也不拆反引号内的 |；去掉首尾外框后逐格 trim */
export function splitTableRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inCode = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i)
    if (ch === '\\' && line.charAt(i + 1) === '|') {
      current += '\\|'
      i += 1
      continue
    }
    if (ch === '`') {
      inCode = !inCode
      current += ch
      continue
    }
    if (ch === '|' && !inCode) {
      cells.push(current)
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current)
  if (cells.length > 0 && cells[0].trim() === '') cells.shift()
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.map((cell) => cell.trim())
}

/** 去掉 ** 、首尾空白，把连续空白合成一个空格；反引号里的代码名保留 */
export function normalizeCell(cell: string): string {
  return cell.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
}

/** 分隔行：每一格都只有 - : 和空格，如 |---|---| */
function isSeparatorLine(line: string): boolean {
  if (!line.trimStart().startsWith('|')) return false
  const cells = splitTableRow(line)
  if (cells.length === 0) return false
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

/** 从命中行往上，找到最近的分隔行，它正上方那一行就是本表的表头 */
function findHeaderLine(lines: string[], rowIndex: number): string | null {
  let i = rowIndex - 1
  while (i >= 0) {
    const line = lines[i] ?? ''
    if (!line.trimStart().startsWith('|')) return null
    if (isSeparatorLine(line)) {
      const header = i - 1 >= 0 ? lines[i - 1] ?? '' : ''
      if (!header.trimStart().startsWith('|')) return null
      return header
    }
    i -= 1
  }
  return null
}

interface PickedRow {
  row: string
  index: number
}

/** 定位规则行：多行时只认写了本卡文件名的行，多行或零行都不猜 */
function pickRow(
  lines: string[],
  rows: string[],
  cardId: string,
): { ok: true; value: PickedRow } | Failure {
  if (rows.length === 0) return fail('row_not_found', 'not_found')
  let chosen = rows[0] ?? ''
  if (rows.length > 1) {
    const mine = rows.filter((row) => rowMentionsCard(row, cardId))
    if (mine.length !== 1) return fail('row_ambiguous', 'conflict')
    chosen = mine[0] ?? ''
  }
  const index = lines.indexOf(chosen)
  if (index < 0) return fail('row_not_found', 'not_found')
  return { ok: true, value: { row: chosen, index } }
}

function headerCellsOf(header: string): string[] {
  return splitTableRow(header).map((cell) => normalizeCell(cell).replace(/\*/g, ''))
}

/** 正文列 = 表头以「条件」或「判据」开头的列（第 0 列是编号，不算） */
function bodyIndexesOf(headerCells: string[]): number[] {
  const indexes: number[] = []
  for (let i = 1; i < headerCells.length; i += 1) {
    const name = headerCells[i] ?? ''
    if (name.startsWith('条件') || name.startsWith('判据')) indexes.push(i)
  }
  return indexes
}

/** 单独命名为「动作」的列接在条件列之后 */
function actionIndexOf(headerCells: string[]): number {
  for (let i = 1; i < headerCells.length; i += 1) {
    if ((headerCells[i] ?? '') === '动作') return i
  }
  return -1
}

function buildBodyText(rowCells: string[], bodyIndexes: number[], actionIndex: number): string {
  const parts = bodyIndexes
    .map((i) => normalizeCell(rowCells[i] ?? ''))
    .filter((cell) => cell !== '')
  if (actionIndex >= 0) {
    const action = normalizeCell(rowCells[actionIndex] ?? '')
    if (action !== '') parts.push(action)
  }
  return parts.join(' → ')
}

/** 规则编号 → 规则句：编号只在第 0 列，正文只取条件/判据列，取不到就失败不充数 */
export function resolveRuleText(
  rulebookText: string,
  ruleId: string,
  cardId: string,
): Result<ResolvedRule> {
  const lines = rulebookText.split('\n')
  const picked = pickRow(lines, findRuleRows(rulebookText, ruleId), cardId)
  if (!picked.ok) return picked

  const header = findHeaderLine(lines, picked.value.index)
  if (header === null) return fail('header_not_found', 'validation')

  const headerCells = headerCellsOf(header)
  const rowCells = splitTableRow(picked.value.row)
  if (rowCells.length !== headerCells.length) return fail('row_shape_mismatch', 'validation')

  const idCell = normalizeCell(rowCells[0] ?? '')
  if (!idCell.startsWith(ruleId)) return fail('row_not_found', 'not_found')
  const title = idCell.slice(ruleId.length).trim()

  const bodyIndexes = bodyIndexesOf(headerCells)
  if (bodyIndexes.length === 0) return fail('no_body_column', 'validation')

  const text = buildBodyText(rowCells, bodyIndexes, actionIndexOf(headerCells))
  if (text === '' || text === title || RULE_ID_RE.test(text)) return fail('body_empty', 'validation')
  if (text.length > RULE_TEXT_MAX_CHARS) return fail('too_long', 'validation')

  return { ok: true, value: { text, title, textSha: sha256Hex(text) } }
}
