import { PLAY_CATALOG, type PlayKey } from '../play-vocabulary'

/** 允许的广告打法（单一来源：play-vocabulary 的 PLAY_CATALOG）。 */
export const PLAY_KEYS: readonly PlayKey[] = Object.keys(PLAY_CATALOG) as PlayKey[]

/** 一条广告打法：步骤编号 + 打法。 */
export interface AdPlay {
  step_key: string
  play: PlayKey
}

const STEP_KEY_RE = /^[a-z0-9_-]+$/
const MAX_STEP_KEY_LEN = 40
const MAX_PLAYS = 8

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isPlayKey(v: unknown): v is PlayKey {
  return typeof v === 'string' && (PLAY_KEYS as readonly string[]).includes(v)
}

/**
 * 校验单条打法。合法返回 AdPlay（step_key 已 trim），否则返回错误原因字符串。
 * 严格版和宽松版共用这一份规则。
 */
function parseOne(item: unknown): AdPlay | string {
  if (!isPlainObject(item)) return '不是对象'
  const rawKey = item.step_key
  if (typeof rawKey !== 'string') return 'step_key 不合法'
  const stepKey = rawKey.trim()
  if (stepKey.length === 0 || stepKey.length > MAX_STEP_KEY_LEN || !STEP_KEY_RE.test(stepKey)) {
    return 'step_key 不合法'
  }
  if (!isPlayKey(item.play)) return 'play 不在允许范围内'
  return { step_key: stepKey, play: item.play }
}

/**
 * 严格解析广告打法列表。任何一条不合法都整体失败，返回中文错误信息。
 */
export function parseAdPlays(raw: unknown): { ok: true; plays: AdPlay[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: '广告打法必须是一个列表' }
  if (raw.length < 1 || raw.length > MAX_PLAYS) {
    return { ok: false, error: '广告打法至少 1 条、最多 8 条' }
  }
  const plays: AdPlay[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const res = parseOne(raw[i])
    if (typeof res === 'string') {
      if (res === '不是对象') return { ok: false, error: `第 ${i + 1} 项不是对象` }
      if (res === 'play 不在允许范围内') return { ok: false, error: `第 ${i + 1} 项的 play 不在允许范围内` }
      return {
        ok: false,
        error: `第 ${i + 1} 项的 step_key 不合法（只能用小写字母、数字、- 和 _，最长 40 个字符）`,
      }
    }
    if (seen.has(res.step_key)) {
      return { ok: false, error: `第 ${i + 1} 项的 step_key 和前面重复` }
    }
    seen.add(res.step_key)
    plays.push(res)
  }
  return { ok: true, plays }
}

/**
 * 宽松解析（用于 LLM 输出）：永不抛错。
 * 丢弃不合法项、丢弃重复 step_key（保留第一条），最多保留 8 条。
 */
export function lenientAdPlays(raw: unknown): AdPlay[] {
  if (!Array.isArray(raw)) return []
  const out: AdPlay[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (out.length >= MAX_PLAYS) break
    const res = parseOne(item)
    if (typeof res === 'string') continue
    if (seen.has(res.step_key)) continue
    seen.add(res.step_key)
    out.push({ step_key: res.step_key, play: res.play })
  }
  return out
}
