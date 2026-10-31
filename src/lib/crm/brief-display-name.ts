/**
 * Legacy AI briefs sometimes transliterated an English contact name at the
 * beginning of a Chinese summary. Restore the CRM's original name only in
 * that narrow, recognisable form; never guess a translation elsewhere.
 */
export function preserveOriginalName(summary: string, originalName: string): string {
  const name = originalName.trim()
  if (!/[A-Za-z]/.test(name) || !summary) return summary
  return summary.replace(
    /^(\s*客户\s*)?[\p{Script=Han}]{1,4}?(?:[·・][\p{Script=Han}]{1,4}?){1,3}(?=通过|填写|表示|希望|询问|提到|已|正在|对|想|计划|说|请求|联系|收到|需要|打算|参加|感兴趣)/u,
    (_match, prefix: string | undefined) => `${prefix?.trimEnd() ? `${prefix.trimEnd()} ` : ''}${name} `,
  )
}
