// Second look at a text-only miss. The model sometimes says a word is missing
// when the frame already shows the whole line. Case, spaces, and line breaks
// are ignored before that comparison. A real wrong word still fails.

import type { NineGridFrame } from './render-check'

const TEXT_REASON = /^第 \d+ 镜文字：/

export function normalizeCompareText(value: string): string {
  return value.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function textSeenCovers(frames: readonly Pick<NineGridFrame, 'text_seen'>[], expected: readonly string[]): boolean {
  const wanted = expected.map(normalizeCompareText).filter((line) => line.length > 0)
  if (wanted.length === 0) return false
  const seen = normalizeCompareText(frames.map((frame) => frame.text_seen).join('\n'))
  return wanted.every((line) => seen.includes(line))
}

export function reconcileTextOnlyMiss(
  verdict: { status: 'pass' | 'fail'; reasons: string[] },
  frames: readonly Pick<NineGridFrame, 'text_seen'>[],
  expected: readonly string[],
): { status: 'pass' | 'fail'; reasons: string[]; text_recheck: 'false_positive' | null } {
  if (verdict.status !== 'fail') return { ...verdict, text_recheck: null }
  const onlyText = verdict.reasons.length > 0 && verdict.reasons.every((reason) => TEXT_REASON.test(reason))
  if (!onlyText || !textSeenCovers(frames, expected)) {
    return { status: verdict.status, reasons: verdict.reasons, text_recheck: null }
  }
  return { status: 'pass', reasons: [], text_recheck: 'false_positive' }
}
