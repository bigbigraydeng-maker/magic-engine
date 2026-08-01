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

const SUB_MAX_CHARS = 14 // 短句大字：一屏最多 14 个字

/** 一段文本按标点优先切成 ≤maxChars 的短句；没标点就硬切。 */
export function splitLine(text: string, maxChars = SUB_MAX_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  // 先按标点断开
  const pieces = clean.split(/[，。！？；、,.!?;:…—]+/).map((p) => p.trim()).filter(Boolean)
  const lines: string[] = []
  for (const piece of pieces) {
    if (piece.length <= maxChars) {
      lines.push(piece)
    } else {
      for (let i = 0; i < piece.length; i += maxChars) {
        lines.push(piece.slice(i, i + maxChars))
      }
    }
  }
  return lines
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
