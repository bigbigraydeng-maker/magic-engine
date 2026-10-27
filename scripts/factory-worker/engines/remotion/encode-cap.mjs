// Bitrate ceiling for finished renders, so every final.mp4 fits the storage object limit (50 MB).
// CRF 18 stays the quality target; the ceiling only bites on busy footage (aerials, water, foliage),
// where CRF alone produced 15–21 Mbps for 1080x1920. The destination platform re-encodes short
// video to about 4–6 Mbps, so anything above about 10 Mbps is wasted bytes.

export const STORAGE_TARGET_BYTES = 45_000_000 // headroom under the 50 MB bucket limit
export const MAX_VIDEO_KBPS = 10_000 // ~10 Mbps ceiling for 1080x1920@30
export const MIN_VIDEO_KBPS = 2_500 // never starve long renders below this
export const AUDIO_KBPS_ALLOWANCE = 320 // remotion default AAC is ~317 kbps

/**
 * @param {number} durationSec composition length in seconds
 * @returns {{ encodingMaxRate: string, encodingBufferSize: string, videoKbps: number }}
 */
export function encodingCapFor(durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`encodingCapFor: bad duration ${durationSec}`)
  }
  // Total-bits budget minus audio, with 10% slack for container overhead / VBV overshoot.
  const budgetKbps = Math.floor(((STORAGE_TARGET_BYTES * 8) / durationSec / 1000 - AUDIO_KBPS_ALLOWANCE) * 0.9)
  const videoKbps = Math.max(MIN_VIDEO_KBPS, Math.min(MAX_VIDEO_KBPS, budgetKbps))
  return {
    videoKbps,
    encodingMaxRate: `${videoKbps}k`,
    // 1 s of buffer: tight enough that the average stays near the ceiling over a 15–90 s reel.
    encodingBufferSize: `${videoKbps}k`,
  }
}

/** Hard gate before upload (worker side). Slightly above the target, still under the 50 MB limit. */
export const MAX_UPLOAD_BYTES = 48_000_000

/** Plain-language refusal. `label` is "成片" for the primary file and "${aspect} 成片" for an extra. */
export function oversizeUploadMessage(sizeBytes, label = '成片') {
  const mb = (Number(sizeBytes) / 1e6).toFixed(1)
  const capMb = MAX_UPLOAD_BYTES / 1e6
  return `成片体检没过：${label} ${mb} MB，超过存储上限（${capMb} MB）。请缩短时长或换更静的镜头后重出`
}
