import { POINT_STATES, REQUIRED_FIELDS, type PointState, type SkillCardParseResult, type SkillPoint } from './types'
import { DEFAULT_PILLAR } from './pillars'

const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/
const URL_RE = /https?:\/\/[^\s|）)]+/
const CORRECTION_RE = /^## 复核更正/m
const INDEX_HEADING = '## 机器索引'

function fail(file: string, reason: string): SkillCardParseResult {
  return { ok: false, error: { file, reason } }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPointState(value: unknown): value is PointState {
  return typeof value === 'string' && (POINT_STATES as readonly string[]).includes(value)
}

/** 取一个去空白的字符串字段，非字符串或空白都算缺失 */
function str(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** 找第一行以 "# " 开头的标题，返回去掉前缀后的内容 */
function findTitle(lines: string[]): string | null {
  for (const line of lines) {
    if (line.startsWith('# ')) {
      const title = line.slice(2).trim()
      if (title !== '') return title
    }
  }
  return null
}

/** 找第一行以「来源：」或「来源:」开头的行，从中抽第一个 http(s) 链接 */
function findSourceUrl(lines: string[]): string | null {
  for (const line of lines) {
    if (!line.startsWith('来源：') && !line.startsWith('来源:')) continue
    const match = line.match(URL_RE)
    if (match !== null) return match[0]
  }
  return null
}

/** 从「## 机器索引」之后找 ```json ... ``` 块，返回块内文本；找不到返回 null */
function extractJsonBlock(lines: string[]): string | null {
  const headingIndex = lines.findIndex((line) => line.trimEnd() === INDEX_HEADING)
  if (headingIndex === -1) return null

  let openIndex = -1
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === '```json') {
      openIndex = i
      break
    }
  }
  if (openIndex === -1) return null

  for (let i = openIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === '```') {
      return lines.slice(openIndex + 1, i).join('\n')
    }
  }
  return null
}

/** 解析单个点；成功返回 SkillPoint，失败返回原因字符串 */
function parsePoint(raw: unknown, index: number): SkillPoint | string {
  if (!isPlainObject(raw)) return `第 ${index + 1} 个点不是对象`

  const key = str(raw, 'key')
  if (key === null || !KEY_RE.test(key)) return `第 ${index + 1} 个点 key 不合法`

  const text = str(raw, 'text')
  if (text === null) return `点 ${key} 缺少 text`

  const state = raw.state
  if (!isPointState(state)) return `点 ${key} 的 state「${String(state)}」不在词表里`

  const handoff = str(raw, 'handoff')
  const rule = str(raw, 'rule')
  const note = str(raw, 'note')
  const mergedInto = str(raw, 'merged_into')

  const values: Record<string, string | null> = { handoff, rule, note, merged_into: mergedInto }
  for (const field of REQUIRED_FIELDS[state]) {
    if (values[field] === null) return `点 ${key}（${state}）缺少 ${field}`
  }

  return { key, text, state, handoff, rule, note, mergedInto }
}

/** 校验可选字段：存在但不是字符串就报错 */
function badOptionalField(raw: Record<string, unknown>): string | null {
  for (const field of ['handoff', 'rule', 'note', 'merged_into']) {
    const value = raw[field]
    if (value !== undefined && typeof value !== 'string') return field
  }
  return null
}

/** 读取顶层 pillar 字段；缺失或空白回落到 DEFAULT_PILLAR，类型不对返回 null */
function readAgent(raw: Record<string, unknown>): string | null {
  const value = raw.pillar
  if (value === undefined) return DEFAULT_PILLAR
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? DEFAULT_PILLAR : trimmed
}

export function parseSkillCard(file: string, text: string): SkillCardParseResult {
  const normalised = text.replace(/\r\n/g, '\n')
  const lines = normalised.split('\n')
  const id = file.replace(/\.md$/, '')

  const title = findTitle(lines)
  if (title === null) return fail(file, '没有标题（第一行 # 开头）')

  const sourceUrl = findSourceUrl(lines)
  const hasCorrection = CORRECTION_RE.test(normalised)

  const jsonText = extractJsonBlock(lines)
  if (jsonText === null) {
    const hasHeading = lines.some((line) => line.trimEnd() === INDEX_HEADING)
    return fail(file, hasHeading ? '机器索引下面没有 ```json 代码块' : '没有「## 机器索引」一节')
  }

  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(file, 'JSON 不合法：' + message)
  }

  if (!isPlainObject(raw) || !Array.isArray(raw.points) || raw.points.length === 0) {
    return fail(file, '机器索引里没有 points 列表')
  }

  const pillar = readAgent(raw)
  if (pillar === null) return fail(file, 'pillar 不是字符串')

  const points: SkillPoint[] = []
  const seen = new Set<string>()

  for (let i = 0; i < raw.points.length; i++) {
    const item: unknown = raw.points[i]
    if (isPlainObject(item)) {
      const badField = badOptionalField(item)
      if (badField !== null) return fail(file, `第 ${i + 1} 个点的 ${badField} 不是字符串`)
    }
    const parsed = parsePoint(item, i)
    if (typeof parsed === 'string') return fail(file, parsed)
    if (seen.has(parsed.key)) return fail(file, `key 重复：${parsed.key}`)
    seen.add(parsed.key)
    points.push(parsed)
  }

  return {
    ok: true,
    card: { id, file, title, sourceUrl, hasCorrection, pillar, points },
  }
}
