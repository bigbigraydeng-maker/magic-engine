/**
 * 点击外呼（Twilio）：先打给员工的手机，员工接起后再接通客户；全程录音，进同一条分析线。
 *
 * 为什么这样做：员工手机自己拨出去，系统看不到，录音/分析/CRM 记录都没有。这里用 Twilio 的外呼接口
 * 一次建立「员工 ← CTS 号码 → 客户」两段，回调仍走既有的 status / dial / recording 接收口。
 * 对方号码放在回调地址的 cp 参数里（地址在建立通话时由我们自己生成，Twilio 验签覆盖整个地址，别人改不了）。
 */

import { RECORDING_NOTICE } from './twiml'

export const OUTBOUND_CP_PARAM = 'cp'
export const E164 = /^\+[1-9][0-9]{7,14}$/

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 客户接起时先听到的告知（<Number url> 指向这里）。 */
export function noticeTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="en-AU">${esc(RECORDING_NOTICE)}</Say></Response>`
}

/** 员工接起后执行：呼客户（客户接起时先放告知），接通后双声道录音。 */
export function outboundBridgeTwiml(args: {
  customer: string
  callerId: string
  dialActionUrl: string
  recordingCallbackUrl: string
  noticeUrl: string
  timeoutSeconds?: number
}): string {
  if (!E164.test(args.customer) || !E164.test(args.callerId)) throw new Error('号码格式不对')
  return (
    '<?xml version="1.0" encoding="UTF-8"?><Response>' +
    `<Dial answerOnBridge="true" timeout="${args.timeoutSeconds ?? 30}" callerId="${esc(args.callerId)}" record="record-from-answer-dual"` +
    ` action="${esc(args.dialActionUrl)}" recordingStatusCallback="${esc(args.recordingCallbackUrl)}"` +
    ' recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST">' +
    `<Number url="${esc(args.noticeUrl)}">${esc(args.customer)}</Number></Dial></Response>`
  )
}

/** 员工登录邮箱 → 员工手机号。分机表是「号码 → 邮箱」，反查；没登记或同一邮箱对应多个号码都不猜。 */
export function staffPhoneForEmail(extensionMap: Record<string, string>, email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  if (!e) return null
  const hits = Object.entries(extensionMap).filter(([phone, mail]) => E164.test(phone) && mail.trim().toLowerCase() === e)
  return hits.length === 1 ? hits[0][0] : null
}

export interface StartOutboundArgs {
  accountSid: string
  authToken: string
  connectionId: string
  staffPhone: string
  customer: string
  baseUrl: string
  fetcher?: typeof fetch
}

const API = 'https://api.twilio.com/2010-04-01/Accounts'

/** 外呼用的主叫号码：账号里把来电地址指向这条连接的那个号码（不另存配置，配置和现实不会漂移）。 */
export async function findCallerNumber(a: Pick<StartOutboundArgs, 'accountSid' | 'authToken' | 'connectionId' | 'fetcher'>): Promise<string> {
  const f = a.fetcher ?? fetch
  const res = await f(`${API}/${a.accountSid}/IncomingPhoneNumbers.json?PageSize=100`, {
    headers: { Authorization: `Basic ${Buffer.from(`${a.accountSid}:${a.authToken}`).toString('base64')}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`读号码失败 ${res.status}`)
  const body = (await res.json()) as { incoming_phone_numbers?: Array<{ phone_number?: string; voice_url?: string | null }> }
  const hit = (body.incoming_phone_numbers ?? []).find((n) => (n.voice_url ?? '').includes(`/api/webhooks/twilio/${a.connectionId}/voice`) && E164.test(n.phone_number ?? ''))
  if (!hit?.phone_number) throw new Error('找不到这条连接对应的 Twilio 号码')
  return hit.phone_number
}

export async function startOutboundCall(a: StartOutboundArgs): Promise<{ callSid: string }> {
  if (!E164.test(a.staffPhone) || !E164.test(a.customer)) throw new Error('号码格式不对')
  const f = a.fetcher ?? fetch
  const from = await findCallerNumber(a)
  const root = `${a.baseUrl}/api/webhooks/twilio/${a.connectionId}`
  const cp = `${OUTBOUND_CP_PARAM}=${encodeURIComponent(a.customer)}`
  const twiml = outboundBridgeTwiml({
    customer: a.customer,
    callerId: from,
    dialActionUrl: `${root}/dial?${cp}`,
    recordingCallbackUrl: `${root}/recording?${cp}`,
    noticeUrl: `${root}/notice`,
  })
  const form = new URLSearchParams()
  form.set('To', a.staffPhone)
  form.set('From', from)
  form.set('Twiml', twiml)
  form.set('Timeout', '30')
  form.set('StatusCallback', `${root}/status?${cp}`)
  form.set('StatusCallbackMethod', 'POST')
  for (const ev of ['initiated', 'ringing', 'answered', 'completed']) form.append('StatusCallbackEvent', ev)
  const res = await f(`${API}/${a.accountSid}/Calls.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${a.accountSid}:${a.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`外呼失败 ${res.status}`)
  const out = (await res.json()) as { sid?: string }
  if (!out.sid) throw new Error('外呼没有返回编号')
  return { callSid: out.sid }
}

/** 默认只放行新西兰（PM 2026-10-15 定：CTS 外呼只限新西兰境内）；要加别的国家，在服务器环境变量里逐个加（带 +）。 */
export const DEFAULT_OUTBOUND_PREFIXES = ['+64'] as const
/** 高价 / 付费号段：新西兰 0900、澳洲 190x。放行的国家里也不许拨。 */
const PREMIUM = [/^\+64900/, /^\+6119[0-9]/]

export function outboundNumberAllowed(e164: string, allowedPrefixes: readonly string[] = DEFAULT_OUTBOUND_PREFIXES): boolean {
  if (!E164.test(e164)) return false
  if (PREMIUM.some((r) => r.test(e164))) return false
  return allowedPrefixes.some((p) => /^\+[1-9][0-9]{0,3}$/.test(p) && e164.startsWith(p))
}

/** 读环境变量里的放行国家前缀（逗号分隔）；没配 / 全是坏值就用默认。 */
export function parseAllowedPrefixes(raw: string | undefined): readonly string[] {
  const list = (raw ?? '').split(',').map((x) => x.trim()).filter((x) => /^\+[1-9][0-9]{0,3}$/.test(x))
  return list.length > 0 ? list : DEFAULT_OUTBOUND_PREFIXES
}
