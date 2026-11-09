// One line for the human review card. This file is imported by a client
// component, so it must not pull in the video downloader or the model SDK.
// The keys match SNAPSHOT_KEY / MACHINE_REVIEWED_KEY; the unit test locks that.

const CHECK_KEY = 'maliang_check'
const REVIEWED_KEY = 'machine_reviewed'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function verdictOf(output: Record<string, unknown>): { status: string; reasons: string[] } | null {
  const raw = asRecord(output[CHECK_KEY])
  if (!raw) return null
  if (raw.status !== 'pass' && raw.status !== 'fail' && raw.status !== 'unverifiable') return null
  if (!Array.isArray(raw.reasons) || !raw.reasons.every((r) => typeof r === 'string')) return null
  return { status: raw.status, reasons: raw.reasons as string[] }
}

export type MaliangReviewTone = 'pass' | 'fail' | 'pending'

export interface MaliangReviewNote {
  tone: MaliangReviewTone
  text: string
}

function failNotice(reasons: string[]): string {
  const head = reasons.map((r) => r.trim()).filter(Boolean).slice(0, 6).join('；')
  return head ? `马良没过：${head}` : '马良没过'
}

export function maliangReviewNote(output: unknown): MaliangReviewNote | null {
  const record = asRecord(output)
  if (!record) return null
  const check = verdictOf(record)
  if (check?.status === 'pass') return { tone: 'pass', text: '马良已看过画面，自检过关' }
  if (check?.status === 'fail') return { tone: 'fail', text: failNotice(check.reasons) }
  if (check?.status === 'unverifiable') {
    return { tone: 'pending', text: '马良没完成画面自检，这条还没经过机器审，请你自己逐镜看' }
  }
  if (record[REVIEWED_KEY] === false) {
    return { tone: 'pending', text: '马良还没审完这条片子，请你自己逐镜看' }
  }
  return null
}
