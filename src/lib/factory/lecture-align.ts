// 讲课式对轴 — 把「整段一镜到底的录像」按脚本切成 钩子/要点1..N/CTA 的时间段，
// 课件 slide 跟着换页；字幕从听写结果切成短句大字(见 memory: 视频字幕短句大字)。
// 全是纯函数：录像里人是自由发挥的，听写文本和脚本不会逐字一致，
// 所以用「比例定位 + 开头短语模糊匹配」找换页点，宁可保守也不乱跳。

export interface TranscriptSegment {
  start: number // 秒
  end: number
  text: string
}

export interface TimedPart {
  start: number
  end: number
}

export interface SubtitleChunk {
  start: number
  end: number
  text: string
}

/** 中文口播归一化：去空白和标点，转小写。比长度、做匹配都用这个。 */
const PUNCT_RE = /[\s!-/:-@[-`{-~，。！？；、：""''（）《》【】…—·～]/g
export function normalizeZh(text: string): string {
  return text.replace(PUNCT_RE, '').toLowerCase()
}

/** 字符 bigram 相似度(0-1)。中文没有词边界，bigram 足够稳。 */
export function bigramSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a && a === b ? 1 : 0
  const grams = (s: string) => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const ga = grams(a)
  const gb = grams(b)
  let hit = 0
  ga.forEach((g) => { if (gb.has(g)) hit++ })
  return (2 * hit) / (ga.size + gb.size)
}

const HEAD_LEN = 12          // 用下一部分开头 12 个字找换页点
const MATCH_WINDOW = 0.18    // 只在比例位置 ±18% 的范围内找，防匹配到别处的相似话
const MIN_MATCH_SCORE = 0.45 // 低于这个分就退回比例切，不硬蒙

/**
 * 把听写分段按脚本各部分(钩子/要点/CTA)切成时间段。
 * 返回和 parts 等长的时间段数组，首尾覆盖整条录像、中间无缝。
 */
export function alignPartsToSegments(parts: string[], segments: TranscriptSegment[]): TimedPart[] {
  if (parts.length === 0) throw new Error('parts is empty')
  if (segments.length === 0) throw new Error('transcript segments empty')

  const videoStart = segments[0].start
  const videoEnd = segments[segments.length - 1].end
  if (parts.length === 1) return [{ start: videoStart, end: videoEnd }]

  const partLens = parts.map((p) => Math.max(normalizeZh(p).length, 1))
  const totalLen = partLens.reduce((a, b) => a + b, 0)

  // 每个听写段的累计字数占比(段末)
  const segLens = segments.map((s) => normalizeZh(s.text).length)
  const totalSegLen = Math.max(segLens.reduce((a, b) => a + b, 0), 1)
  const cumFrac: number[] = []
  let acc = 0
  for (const l of segLens) {
    acc += l
    cumFrac.push(acc / totalSegLen)
  }

  // 逐个边界：part i 结束 = part i+1 开始
  const boundaries: number[] = [] // 边界时间，长度 parts.length - 1
  let cumPart = 0
  let prevBoundarySeg = 0
  for (let i = 0; i < parts.length - 1; i++) {
    cumPart += partLens[i]
    const targetFrac = cumPart / totalLen

    // 候选：比例位置 ± 窗口内的段，且不早于上一个边界
    const head = normalizeZh(parts[i + 1]).slice(0, HEAD_LEN)
    let best = -1
    let bestScore = 0
    for (let s = prevBoundarySeg; s < segments.length; s++) {
      const frac = s === 0 ? 0 : cumFrac[s - 1] // 段 s 开始处的累计占比
      if (frac < targetFrac - MATCH_WINDOW) continue
      if (frac > targetFrac + MATCH_WINDOW) break
      const segHead = normalizeZh(segments[s].text).slice(0, HEAD_LEN)
      const score = bigramSimilarity(head, segHead)
      if (score > bestScore) {
        bestScore = score
        best = s
      }
    }

    let boundarySeg: number
    if (best >= 0 && bestScore >= MIN_MATCH_SCORE) {
      boundarySeg = best
    } else {
      // 比例退路：第一个累计占比 ≥ 目标 的段的下一段开始
      boundarySeg = cumFrac.findIndex((f) => f >= targetFrac) + 1
      if (boundarySeg <= 0) boundarySeg = segments.length - 1
    }
    // 边界只能往后走，且给后面的部分留至少一段；
    // 段数比部分数还少的极端情况下切不动，收缩到最后一段(允许零时长部分，绝不越界崩)
    boundarySeg = Math.max(boundarySeg, prevBoundarySeg + 1)
    boundarySeg = Math.min(boundarySeg, segments.length - (parts.length - 1 - i))
    boundarySeg = Math.min(Math.max(boundarySeg, 0), segments.length - 1)
    boundaries.push(segments[boundarySeg].start)
    prevBoundarySeg = boundarySeg
  }

  const result: TimedPart[] = []
  for (let i = 0; i < parts.length; i++) {
    result.push({
      start: i === 0 ? videoStart : boundaries[i - 1],
      end: i === parts.length - 1 ? videoEnd : boundaries[i],
    })
  }
  return result
}

const HEAD_MAX_SKIP_SEC = 25   // 最多跳过前 25 秒找开场白，再多就是判错了
const HEAD_MIN_SCORE = 0.34    // 低于这个相似度不敢跳，宁可从第一句话起

/**
 * 找成片该从哪一秒开始：录像开头常有寒暄、清嗓、看提词器、重来一遍，
 * 这些都不在脚本里。拿脚本的开场白去比对听写分段，命中就从那一段起片。
 * 比不中(自由发挥/开场白改过)就退回第一句话，绝不乱切内容。
 */
export function findHeadStart(hookText: string, segments: TranscriptSegment[]): number {
  if (segments.length === 0) return 0
  const firstSpeech = segments[0].start
  const head = normalizeZh(hookText).slice(0, HEAD_LEN)
  if (head.length < 4) return firstSpeech

  let best = -1
  let bestScore = 0
  for (const seg of segments) {
    if (seg.start > firstSpeech + HEAD_MAX_SKIP_SEC) break
    const score = bigramSimilarity(head, normalizeZh(seg.text).slice(0, HEAD_LEN))
    if (score > bestScore) {
      bestScore = score
      best = seg.start
    }
  }
  return bestScore >= HEAD_MIN_SCORE && best >= 0 ? best : firstSpeech
}

const SUB_MAX_CHARS = 14 // 短句大字：一屏最多 14 个字

/** 一段文本按标点优先切成 ≤maxChars 的短句；没标点就硬切。 */
// 英文单词 / 网址 / 数字不能从中间切开(切了就成乱码:「business profile」→「siness profile」)。
// 所以切行的最小单位是「词」不是「字」：一串拉丁字母/数字/点斜杠算一个整体。
const LATIN_CH = /[A-Za-z0-9@._/-]/
// 一个中文字算 1 宽，英文字母窄得多算 0.55 —— 同一行能多放英文，视觉宽度才对得上
const LATIN_WIDTH = 0.55

/** 把一段文字拆成不可再分的单位：拉丁串整体一个，中文一字一个。 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  let buf = ''
  for (const ch of text) {
    if (LATIN_CH.test(ch)) {
      buf += ch
    } else {
      if (buf) { tokens.push(buf); buf = '' }
      if (ch !== ' ') tokens.push(ch)
      else if (tokens.length) tokens.push(' ')
    }
  }
  if (buf) tokens.push(buf)
  return tokens
}

function tokenWidth(t: string): number {
  let w = 0
  for (const ch of t) w += LATIN_CH.test(ch) || ch === ' ' ? LATIN_WIDTH : 1
  return w
}

// 断句用的标点。注意 `.` `,` `:` 只有在「不夹在英文/数字中间」时才算标点——
// 否则 business.google.com 会先被拆成三段，后面再怎么保护也拼不回来。
const SENTENCE_BREAK = /[，。！？；、：…—]+|[!?;]+|(?<![A-Za-z0-9])[.,:]+|[.,:]+(?![A-Za-z0-9])/

export function splitLine(text: string, maxChars = SUB_MAX_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  // 先按标点断句(标点本身丢掉，字幕不显示标点更清爽)
  const pieces = clean.split(SENTENCE_BREAK).map((p) => (p ?? '').trim()).filter(Boolean)

  const lines: string[] = []
  for (const piece of pieces) {
    let cur = ''
    let curW = 0
    for (const tok of tokenize(piece)) {
      const w = tokenWidth(tok)
      if (cur && curW + w > maxChars) {
        lines.push(cur.trim())
        cur = tok === ' ' ? '' : tok
        curW = tok === ' ' ? 0 : w
      } else {
        cur += tok
        curW += w
      }
    }
    if (cur.trim()) lines.push(cur.trim())
  }

  // 尾巴太短(1-2 个字)就并进上一行，避免屏幕上闪一个孤字
  const merged: string[] = []
  for (const line of lines) {
    const prev = merged[merged.length - 1]
    if (prev && line.length <= 2 && tokenWidth(prev) + tokenWidth(line) <= maxChars + 2) {
      merged[merged.length - 1] = prev + line
    } else {
      merged.push(line)
    }
  }
  return merged
}

/** 把听写分段切成「短句大字」字幕块，时间按各短句字数在原段里按比例分。 */
export function splitSubtitleChunks(
  segments: TranscriptSegment[],
  maxChars = SUB_MAX_CHARS,
): SubtitleChunk[] {
  const chunks: SubtitleChunk[] = []
  for (const seg of segments) {
    const lines = splitLine(seg.text, maxChars)
    if (lines.length === 0) continue
    const dur = Math.max(seg.end - seg.start, 0.2)
    const totalChars = lines.reduce((a, l) => a + l.length, 0)
    let t = seg.start
    for (const line of lines) {
      const d = (line.length / totalChars) * dur
      chunks.push({ start: t, end: t + d, text: line })
      t += d
    }
  }
  return chunks
}
