// Shared upload ceiling. Storage rejects objects over 50 MB; 48 MB leaves headroom.
// The encode-rate cap (PR #3245, encode-cap.mjs / render.mjs) is separate and is not set here.
// That PR should re-export this constant instead of defining its own:
//   export { MAX_UPLOAD_BYTES } from './upload-size-gate.mjs'

export const MAX_UPLOAD_BYTES = 48_000_000

/** Plain-language refusal. `label` is "成片" for the primary file. */
export function oversizeUploadMessage(sizeBytes, label = '成片') {
  const mb = (Number(sizeBytes) / 1e6).toFixed(1)
  const capMb = MAX_UPLOAD_BYTES / 1e6
  return `成片体检没过：${label} ${mb} MB，超过存储上限（${capMb} MB）。请缩短时长或换更静的镜头后重出`
}
