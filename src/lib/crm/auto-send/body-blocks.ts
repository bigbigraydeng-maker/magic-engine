/**
 * 信的正文（纯文本）→ 页面用的块（小标题 / 段落 / 要点）。
 * 页面不解析任何标记语言，所以这里只认最朴素的写法：
 *  - 空行分段；
 *  - 一段里每一行都以「- / • / * / 1.」开头 → 要点列表；
 *  - 以「# 」开头的单行 → 小标题；
 *  - 单独成段、不长、结尾没有标点的一行 → 小标题（例如「What March will feel like」）；
 *  - 其余是段落，段内的换行保留（落款、地址这类会靠换行）。
 */

import type { BodyBlock } from './types'

const BULLET_RE = /^\s*(?:[-•*]|\d+[.)])\s+/
const HEADING_MARK_RE = /^#{1,3}\s+/
const TERMINAL_PUNCTUATION_RE = /[.,;:!?。，；：！？]$/
const MAX_PLAIN_HEADING = 70

function chunkToBlocks(chunk: string): BodyBlock[] {
  const lines = chunk.split('\n').map((line) => line.trimEnd())
  if (lines.length > 0 && lines.every((line) => BULLET_RE.test(line))) {
    return lines.map((line) => ({ kind: 'bullet' as const, text: line.replace(BULLET_RE, '').trim() }))
  }
  if (lines.length === 1) {
    const only = lines[0].trim()
    if (HEADING_MARK_RE.test(only)) return [{ kind: 'heading', text: only.replace(HEADING_MARK_RE, '').trim() }]
    if (only.length <= MAX_PLAIN_HEADING && !TERMINAL_PUNCTUATION_RE.test(only) && !only.includes('{')) {
      return [{ kind: 'heading', text: only }]
    }
  }
  return [{ kind: 'paragraph', text: lines.join('\n').trim() }]
}

export function bodyTextToBlocks(text: string | null | undefined): BodyBlock[] {
  if (typeof text !== 'string') return []
  const normalised = text.replace(/\r\n?/g, '\n').trim()
  if (normalised === '') return []
  return normalised
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '')
    .flatMap(chunkToBlocks)
}
