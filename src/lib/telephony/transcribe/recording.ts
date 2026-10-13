/**
 * 从 Twilio 下载一条录音。
 *
 * 只允许 https://api.twilio.com 下的 Recordings 路径（链接来自已验签的回调，但下载前仍当不可信处理，
 * 防止将来哪天有人把别的地址塞进来变成服务器端请求伪造）。令牌只在这里用来做 Basic 认证，不进日志。
 */

export const MAX_RECORDING_BYTES = 25 * 1024 * 1024
const ALLOWED = /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/(AC[0-9a-f]{32})\/Recordings\/(RE[0-9a-f]{32})$/i

export class RecordingFetchError extends Error {
  constructor(public readonly code: 'bad_url' | 'account_mismatch' | 'http_error' | 'too_large' | 'empty', message: string) {
    super(message)
  }
}

export interface FetchedRecording {
  bytes: Uint8Array
  contentType: string
  recordingSid: string
}

export async function downloadTwilioRecording(args: {
  url: string
  accountSid: string
  authToken: string
  fetcher?: typeof fetch
}): Promise<FetchedRecording> {
  const base = args.url.replace(/\.(mp3|wav)$/i, '')
  const m = ALLOWED.exec(base)
  if (!m) throw new RecordingFetchError('bad_url', '录音地址不是 Twilio 官方录音路径')
  if (m[1].toLowerCase() !== args.accountSid.toLowerCase()) throw new RecordingFetchError('account_mismatch', '录音属于别的账号')
  const f = args.fetcher ?? fetch
  const res = await f(`${base}.mp3`, {
    headers: { Authorization: `Basic ${Buffer.from(`${args.accountSid}:${args.authToken}`).toString('base64')}` },
    redirect: 'follow',
  })
  if (!res.ok) throw new RecordingFetchError('http_error', `下载录音失败 HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > MAX_RECORDING_BYTES) throw new RecordingFetchError('too_large', '录音超过大小上限')
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.byteLength === 0) throw new RecordingFetchError('empty', '录音是空的')
  if (buf.byteLength > MAX_RECORDING_BYTES) throw new RecordingFetchError('too_large', '录音超过大小上限')
  return { bytes: buf, contentType: res.headers.get('content-type') ?? 'audio/mpeg', recordingSid: m[2] }
}

/** 从 Twilio 录音链接里取录音编号（RE 开头）；不是官方录音路径就返回 null。 */
export function recordingSidFromUrl(url: string): string | null {
  const m = ALLOWED.exec(url.split(/[?#]/)[0].replace(/\.(mp3|wav|json)$/i, ''))
  return m ? m[2] : null
}
