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

export function maliangReviewNote(output: unknown): string | null {
  const record = asRecord(output)
  if (!record) return null
  const check = verdictOf(record)
  if (check?.status === 'pass') return '马良已看过画面，自检过关'
  if (check?.status === 'fail') {
    const head = check.reasons.slice(0, 2).join('；')
    return head ? `马良画面自检没过：${head}` : '马良画面自检没过'
  }
  if (check?.status === 'unverifiable') return '马良没完成画面自检，这条还没经过机器审，请你自己逐镜看'
  if (record[REVIEWED_KEY] === false) return '马良还没审完这条片子，请你自己逐镜看'
  return null
}
