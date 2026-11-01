export function encodingCapFor(durationSec: number): {
  encodingMaxRate: string
  encodingBufferSize: string
  videoKbps: number
}

export function encodeCapLimit(durationSec: number): {
  encodingMaxRate: string
  encodingBufferSize: string
  videoKbps: number
  maxBytes: number
  slackBytes: number
  slackBps: number
}

export function encodeCapVerdict(input: {
  sizeBytes: number
  durationSec: number
  videoBitrateBps?: number
  label?: string
}): { ok: true } | { ok: false; message: string }

export function oversizeUploadMessage(sizeBytes: number, label?: string): string
export const MAX_UPLOAD_BYTES: number
