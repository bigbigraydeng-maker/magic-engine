// 出片经验沉淀 —— 让内容工厂「越做越懂这个客户」。
//
// 问题:客户每条片都在纠同样的东西(术语写错、片头要多剪、脸的位置)，
// 但系统每次都从零开始，等于把同一课重复上给它听。
//
// 三条学习线(都存在 clients.factory_config.lecture，不加新表):
// ① 术语:客户校准字幕时「A 改成 B」，同一改法出现 2 次就进这个客户的词表，以后自动纠
// ② 习惯:片头多剪几秒、人脸取景位置，做一次记一次，下条片直接用
// ③ 打回原因:同一个原因出现 3 次 → 提示把它固化成规则
//
// 学习必须保守:宁可少学，不能学错——学错了会把客户改对的字又改回去。

import { supabaseAdmin } from '@/lib/supabase'

export interface GlossaryEntry {
  to: string
  hits: number
  updatedAt: string
}

export interface RedoReason {
  reason: string
  count: number
  lastAt: string
}

export interface LecturePrefs {
  /** 这个客户的术语表:写错的写法 → 规范写法。 */
  glossary: Record<string, GlossaryEntry>
  /** 片头习惯多剪几秒(客户反复要求就记住)。 */
  headTrimSec: number | null
  /** 人脸在画面高度的位置(0-1),下次认不出脸时用它兜底。 */
  faceY: number | null
  /** 打回重做的原因统计。 */
  redoReasons: RedoReason[]
}

export const EMPTY_PREFS: LecturePrefs = {
  glossary: {},
  headTrimSec: null,
  faceY: null,
  redoReasons: [],
}

const PROMOTE_AT = 2        // 同一改法出现几次才进词表
const MIN_TERM_LEN = 3      // 太短的词不学(容易误伤)
const RULE_SUGGEST_AT = 3   // 同一打回原因出现几次就提示固化成规则

/** 只学「独立的拉丁词」——中文改动多是措辞偏好，学了会把客户的话改乱。 */
const LATIN_TOKEN = /^[A-Za-z][A-Za-z0-9 .&-]*$/

/**
 * 对比校准前后的字幕，抽出「客户把 A 改成了 B」的替换对。
 * 只在「整条只差一个拉丁词」时才算数——整句重写学不出可靠规律。
 */
export function extractTermEdits(
  before: string[],
  after: string[],
): { from: string; to: string }[] {
  const edits: { from: string; to: string }[] = []
  const n = Math.min(before.length, after.length)
  for (let i = 0; i < n; i++) {
    const b = (before[i] ?? '').trim()
    const a = (after[i] ?? '').trim()
    if (!b || !a || b === a) continue

    // 找出两边不同的部分:去掉公共前缀/后缀，剩下的就是被替换的片段
    let head = 0
    while (head < b.length && head < a.length && b[head] === a[head]) head++
    let tail = 0
    while (
      tail < b.length - head && tail < a.length - head &&
      b[b.length - 1 - tail] === a[a.length - 1 - tail]
    ) tail++

    // 差异片段要扩到完整的词再学:thruplay→ThruPlay 只有首尾字母大小写不同，
    // 直接取差异段会切成 thrup→ThruP，学到的规则就是错的。
    const expand = (str: string, lo: number, hi: number): string => {
      let s2 = lo
      let e2 = hi
      while (s2 > 0 && /[A-Za-z0-9]/.test(str[s2 - 1])) s2--
      while (e2 < str.length && /[A-Za-z0-9]/.test(str[e2])) e2++
      return str.slice(s2, e2).trim()
    }
    const from = expand(b, head, b.length - tail)
    const to = expand(a, head, a.length - tail)
    if (!from || !to) continue
    if (from.length < MIN_TERM_LEN || to.length < MIN_TERM_LEN) continue
    if (!LATIN_TOKEN.test(from) || !LATIN_TOKEN.test(to)) continue
    if (from.toLowerCase() === to.toLowerCase() && from === to) continue
    edits.push({ from, to })
  }
  return edits
}

/**
 * 把新学到的替换并进词表。同一改法累计到 PROMOTE_AT 次才算数(第一次可能只是手滑)。
 * 已经在表里的直接累加并更新写法。
 */
export function mergeGlossary(
  current: Record<string, GlossaryEntry>,
  edits: { from: string; to: string }[],
  now: string,
): Record<string, GlossaryEntry> {
  const next = { ...current }
  for (const { from, to } of edits) {
    const key = from.toLowerCase()
    const prev = next[key]
    next[key] = {
      to,
      hits: (prev?.hits ?? 0) + 1,
      updatedAt: now,
    }
  }
  return next
}

/** 用这个客户学到的词表纠正一条字幕(只换独立出现的词，和全局术语表同样的边界规则)。 */
export function applyClientGlossary(text: string, glossary: Record<string, GlossaryEntry>): string {
  let out = text ?? ''
  for (const [key, entry] of Object.entries(glossary)) {
    if (entry.hits < PROMOTE_AT) continue         // 还没学扎实的不用
    let from = 0
    for (;;) {
      const idx = out.toLowerCase().indexOf(key, from)
      if (idx < 0) break
      const before = idx > 0 ? out[idx - 1] : ''
      const after = idx + key.length < out.length ? out[idx + key.length] : ''
      const standalone = !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)
      if (standalone && out.slice(idx, idx + key.length) !== entry.to) {
        out = out.slice(0, idx) + entry.to + out.slice(idx + key.length)
        from = idx + entry.to.length
      } else {
        from = idx + key.length
      }
    }
  }
  return out
}

/** 记一次打回原因；返回更新后的列表和「要不要提示固化成规则」。 */
export function recordRedoReason(
  reasons: RedoReason[],
  reason: string,
  now: string,
): { reasons: RedoReason[]; suggestRule: boolean } {
  const clean = (reason ?? '').trim()
  if (!clean) return { reasons, suggestRule: false }
  const next = [...reasons]
  const hit = next.find((r) => r.reason === clean)
  if (hit) {
    hit.count += 1
    hit.lastAt = now
  } else {
    next.push({ reason: clean, count: 1, lastAt: now })
  }
  const count = next.find((r) => r.reason === clean)?.count ?? 1
  return { reasons: next.slice(-30), suggestRule: count >= RULE_SUGGEST_AT }
}

// ---------- 读写(存在 clients.factory_config.lecture，不加新表) ----------

export async function loadLecturePrefs(clientId: string): Promise<LecturePrefs> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('factory_config')
    .eq('id', clientId)
    .single()
  const cfg = (data?.factory_config as { lecture?: Partial<LecturePrefs> } | null)?.lecture
  return {
    glossary: cfg?.glossary ?? {},
    headTrimSec: cfg?.headTrimSec ?? null,
    faceY: cfg?.faceY ?? null,
    redoReasons: cfg?.redoReasons ?? [],
  }
}

export async function saveLecturePrefs(clientId: string, patch: Partial<LecturePrefs>): Promise<void> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('factory_config')
    .eq('id', clientId)
    .single()
  const cfg = (data?.factory_config as Record<string, unknown> | null) ?? {}
  const prev = (cfg.lecture as Partial<LecturePrefs> | undefined) ?? {}
  const { error } = await supabaseAdmin
    .from('clients')
    .update({ factory_config: { ...cfg, lecture: { ...prev, ...patch } } })
    .eq('id', clientId)
  if (error) throw error
}
