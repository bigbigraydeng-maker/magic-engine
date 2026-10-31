// One line for the human review card. This file is imported by a client
// component, so it must not pull in the video downloader or the model SDK.
// The keys match SNAPSHOT_KEY / MACHINE_REVIEWED_KEY; the unit test locks that.

const CHECK_KEY = 'maliang_check'
const REVIEWED_KEY = 'machine_reviewed'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function verdictOf(output: Record<string, unknown>): {
  status: string
  reasons: string[]
  expected: string[]
  seen: string[]
  textRecheck: boolean
} | null {
  const raw = asRecord(output[CHECK_KEY])
  if (!raw) return null
  if (raw.status !== 'pass' && raw.status !== 'fail' && raw.status !== 'unverifiable') return null
  if (!Array.isArray(raw.reasons) || !raw.reasons.every((r) => typeof r === 'string')) return null
  const expected = Array.isArray(raw.expected_text)
    ? raw.expected_text.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
    : []
  const seen = Array.isArray(raw.frames)
    ? raw.frames.flatMap((frame) => {
        const row = asRecord(frame)
        return row && typeof row.text_seen === 'string' && row.text_seen.trim() ? [row.text_seen.trim()] : []
      })
    : []
  return {
    status: raw.status,
    reasons: raw.reasons as string[],
    expected,
    seen,
    textRecheck: raw.text_recheck === 'false_positive',
  }
}

export type MaliangReviewTone = 'pass' | 'fail' | 'pending'

export interface MaliangReviewNote {
  tone: MaliangReviewTone
  text: string
}

function failNotice(reasons: string[], expected: string[], seen: string[]): string {
  const head = reasons.map((r) => r.trim()).filter(Boolean).slice(0, 6).join('；')
  const lines = [head ? `马良没过：${head}` : '马良没过']
  if (expected.length > 0) lines.push(`预期：${expected.join(' / ')}`)
  if (seen.length > 0) lines.push(`画面看到：${seen.join(' / ')}`)
  return lines.join('\n')
}

export function maliangReviewNote(output: unknown): MaliangReviewNote | null {
  const record = asRecord(output)
  if (!record) return null
  const check = verdictOf(record)
  if (check?.status === 'pass') {
    const extra = check.textRecheck ? '（已复核为模型误报）' : ''
    return { tone: 'pass', text: `马良已看过画面，自检过关${extra}` }
  }
  if (check?.status === 'fail') return { tone: 'fail', text: failNotice(check.reasons, check.expected, check.seen) }
  if (check?.status === 'unverifiable') {
    return { tone: 'pending', text: '马良没完成画面自检，这条还没经过机器审，请你自己逐镜看' }
  }
  if (record[REVIEWED_KEY] === false) {
    return { tone: 'pending', text: '马良还没审完这条片子，请你自己逐镜看' }
  }
  return null
}
