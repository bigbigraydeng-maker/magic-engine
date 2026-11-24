/**
 * 每日咨询早报的主题行、正文和发信。判据与归类在 `enquiry-daily-digest`。
 *
 * 正文用英文：这封信最终是给客户的销售看的（CTS 是英文团、英文团队）。
 * 测试期只发 ME 自己的信箱，顶上那条测试提示用中文给 PM 看。
 *
 * 发送函数永不抛异常：发信失败不该把上游那趟定时任务一起带崩。
 */

import {
  contactUrl,
  esc,
  sendDigestMail,
  type DigestMailer,
  type DigestSendResult,
} from './digest-shared'
import {
  ENQUIRY_DIGEST_TEST_PREFIX,
  channelCounts,
  channelLabel,
  topInterests,
  type EnquiryDigest,
  type EnquiryEntry,
} from './enquiry-daily-digest'

/** 「Tue 24 Nov」—— 按客户所在地的日历日显示。 */
export function dayLabel(dayStartMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(dayStartMs))
}

function timeLabel(ms: number, timeZone: string): string {
  if (!Number.isFinite(ms)) return 'time unknown'
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ms))
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function buildEnquirySubject(clientName: string, day: string, digest: EnquiryDigest): string {
  const n = digest.enquiries.length
  const chats = digest.chats.length
  const chatPart = chats > 0 ? ` + ${plural(chats, 'chat', 'chats')}` : ''
  return `${ENQUIRY_DIGEST_TEST_PREFIX}${clientName} · ${day}: ${plural(n, 'new enquiry', 'new enquiries')}${chatPart}`
}

function renderEntry(e: EnquiryEntry, clientId: string, timeZone: string): string {
  const link = e.contactId
    ? ` · <a href="${esc(contactUrl(clientId, e.contactId))}" style="color:#2563eb">open in CRM</a>`
    : ''
  const via = e.channels.map(channelLabel).join(' + ')
  const interest = e.interest ? `<div style="margin-top:2px">Interested in: <b>${esc(e.interest)}</b></div>` : ''
  const message = e.message
    ? `<div style="margin-top:4px;color:#334155;font-style:italic">“${esc(e.message)}”</div>`
    : ''
  return `
    <div style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px">
      <div><b>${esc(e.name)}</b> <span style="color:#64748b">· ${esc(via)} · ${esc(timeLabel(e.firstAtMs, timeZone))}</span>${link}</div>
      ${interest}${message}
    </div>`
}

function renderOverview(digest: EnquiryDigest): string {
  if (digest.enquiries.length === 0) {
    return '<p style="font-size:15px;margin:0 0 12px">No new enquiries came in through Facebook forms or the website yesterday.</p>'
  }
  const byChannel = channelCounts(digest.enquiries)
    .map((c) => `${esc(channelLabel(c.channel))}: ${c.count}`)
    .join(' · ')
  const topics = topInterests(digest.enquiries)
    .map((t) => `<li>${esc(t.interest)} — ${t.count}</li>`)
    .join('')
  return `
    <p style="font-size:15px;margin:0 0 6px"><b>${plural(digest.enquiries.length, 'new enquiry', 'new enquiries')}</b> yesterday (${byChannel}).</p>
    <p style="font-size:14px;margin:0 0 4px">What they asked about:</p>
    <ul style="margin:0 0 14px;padding-left:20px;font-size:14px">${topics}</ul>`
}

function renderChats(digest: EnquiryDigest, clientId: string, timeZone: string): string {
  if (digest.chats.length === 0) return ''
  const rows = digest.chats.map((e) => renderEntry(e, clientId, timeZone)).join('')
  return `
    <p style="font-size:15px;font-weight:600;margin:22px 0 2px">Also active on Messenger / WhatsApp (${digest.chats.length})</p>
    <p style="font-size:12px;color:#64748b;margin:0">Not counted above — these may be existing customers replying in an ongoing chat.</p>
    ${rows}`
}

function testNote(n: number): string {
  return n > 0 ? ` ${n} internal test ${n === 1 ? 'lead was' : 'leads were'} left out.` : ''
}

function testBanner(): string {
  return `
    <p style="margin:0 0 18px;padding:12px 14px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:14px;color:#92400e">
      <b>${ENQUIRY_DIGEST_TEST_PREFIX}</b>这是 Magic Engine 每日咨询早报的测试版，现在只发给 ME 自己。
      内容确认准了以后，才会改成发给客户的信箱。这封信不会替任何人联系客人。
    </p>`
}

export function buildEnquiryBody(params: {
  clientId: string
  clientName: string
  day: string
  timeZone: string
  digest: EnquiryDigest
}): string {
  const { clientId, clientName, day, timeZone, digest } = params
  const rows = [...digest.enquiries]
    .sort((a, b) => a.firstAtMs - b.firstAtMs)
    .map((e) => renderEntry(e, clientId, timeZone))
    .join('')
  return `
    <div style="font-family:sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#0f172a">
      ${testBanner()}
      <p style="font-size:17px;font-weight:600;margin:0 0 10px">${esc(clientName)} — enquiries on ${esc(day)}</p>
      ${renderOverview(digest)}
      ${rows}
      ${renderChats(digest, clientId, timeZone)}
      <p style="margin-top:20px;font-size:11px;color:#94a3b8">
        Counts Facebook lead forms and website forms only (not emails or phone calls).${testNote(digest.testExcluded)}
        Contact details are left out on purpose — open the CRM link to see them.
      </p>
    </div>`
}

/** 发一封早报。永不抛异常。收件人必须由调用方显式给，一个都没有就不发。 */
export async function sendEnquiryDailyDigest(params: {
  clientId: string
  clientName: string
  day: string
  timeZone: string
  digest: EnquiryDigest
  recipients: string[]
  apiKey?: string
  mailerFactory?: (apiKey: string) => DigestMailer
}): Promise<DigestSendResult> {
  const { recipients } = params
  if (recipients.length === 0) {
    return { sent: false, reason: '没有收件人（调用方必须显式指定，本函数不猜）', recipients }
  }
  return sendDigestMail({
    fromLabel: `${ENQUIRY_DIGEST_TEST_PREFIX}Magic Engine 每日咨询早报`,
    recipients,
    subject: buildEnquirySubject(params.clientName, params.day, params.digest),
    html: buildEnquiryBody(params),
    apiKey: params.apiKey,
    mailerFactory: params.mailerFactory,
  })
}
