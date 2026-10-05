import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import { normaliseAttribution } from '@/lib/marketing/attribution'
import { meMailFrom, ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'

const TO_EMAIL = ME_MAIL_TO_ADDRESS
const META_ADS_AI_PILOT_FORM = 'meta_ads_ai_pilot'

export async function POST(req: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Email service not configured.' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const payload = body as Record<string, unknown>
  const name = typeof payload.name === 'string' ? payload.name : ''
  const email = typeof payload.email === 'string' ? payload.email : ''
  const company = typeof payload.company === 'string' ? payload.company : ''
  const message = typeof payload.message === 'string' ? payload.message : ''
  const isMetaAdsAiPilotApplication = payload.formType === META_ADS_AI_PILOT_FORM
  const attribution = normaliseAttribution({
    ...payload,
    referrer: typeof payload.referrer === 'string' ? payload.referrer : req.headers.get('referer'),
  })

  if (!name.trim() || !email.trim() || !message.trim()) {
    return NextResponse.json({ error: 'Name, email, and message are required.' }, { status: 400 })
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 })
  }

  if (message.length > 4000) {
    return NextResponse.json({ error: 'Message too long.' }, { status: 400 })
  }

  const resend = new Resend(apiKey)
  const attributionRows = attribution
    ? Object.entries(attribution)
        .map(([key, value]) => `
          <tr>
            <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#475569">${escapeHtml(key)}</td>
            <td style="padding:8px 12px;border-left:3px solid #e2e8f0">${escapeHtml(value)}</td>
          </tr>
        `)
        .join('')
    : ''

  let internalError: unknown
  try {
    const result = await resend.emails.send({
      from: meMailFrom(isMetaAdsAiPilotApplication ? 'Magic Engine 工具实验室' : 'Magic Engine Contact'),
      to: [TO_EMAIL],
      replyTo: email.trim(),
      subject: isMetaAdsAiPilotApplication
        ? `工具实验室留言：${name.trim()}`
        : `New enquiry from ${name.trim()} - Magic Engine`,
      html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 20px;font-size:18px;color:#0f172a">${isMetaAdsAiPilotApplication ? '工具实验室留言（官网留邮箱表单）' : 'New contact form submission'}</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr>
            <td style="padding:8px 12px;background:#f8fafc;font-weight:600;width:100px;color:#475569">Name</td>
            <td style="padding:8px 12px;border-left:3px solid #e2e8f0">${escapeHtml(name.trim())}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#475569">Email</td>
            <td style="padding:8px 12px;border-left:3px solid #e2e8f0">${escapeHtml(email.trim())}</td>
          </tr>
          ${company.trim() ? `
          <tr>
            <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#475569">Company</td>
            <td style="padding:8px 12px;border-left:3px solid #e2e8f0">${escapeHtml(company.trim())}</td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding:8px 12px;background:#f8fafc;font-weight:600;vertical-align:top;color:#475569">Message</td>
            <td style="padding:8px 12px;border-left:3px solid #e2e8f0;white-space:pre-wrap">${escapeHtml(message.trim())}</td>
          </tr>
          ${attributionRows}
        </table>
        <p style="margin-top:20px;font-size:12px;color:#94a3b8">
          Sent from the Magic Engine contact form. Reply directly to this email to respond to ${escapeHtml(name.trim())}.
        </p>
      </div>
    `,
    })
    internalError = result.error
  } catch (error) {
    internalError = error
  }

  if (internalError) {
    console.error('[contact] Internal notification delivery failed:', internalError)
    return NextResponse.json({ error: 'Failed to send message. Please try again.' }, { status: 500 })
  }

  if (isMetaAdsAiPilotApplication) {
    let confirmationError: unknown
    try {
      const result = await resend.emails.send({
        from: meMailFrom('Magic Engine'),
        to: [email.trim().toLowerCase()],
        replyTo: TO_EMAIL,
        subject: '我们收到你的留言了 · Magic Engine',
        html: buildMetaAdsAiPilotConfirmation(name.trim()),
      })
      confirmationError = result.error
    } catch (error) {
      confirmationError = error
    }

    if (confirmationError) {
      console.error('[contact] Applicant confirmation delivery failed after internal notification succeeded:', confirmationError)
      return NextResponse.json(
        {
          error: `留言已收到，但确认邮件发送失败。如需帮助，请联系 ${TO_EMAIL}。`,
          code: 'APPLICANT_CONFIRMATION_FAILED',
          received: true,
        },
        { status: 502 },
      )
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (supabaseUrl && serviceRoleKey) {
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const sourceLabel = attribution?.entry_page || attribution?.utm_source || 'contact'
    const { error: trackingError } = await supabase.from('website_lead_events').insert({
      page_path: '/contact',
      cta_key: 'contact_submit',
      destination: 'email',
      target_href: `mailto:${TO_EMAIL}`,
      source: sourceLabel,
      referrer: attribution?.referrer || req.headers.get('referer'),
      metadata: {
        attribution,
        company: company.trim() || null,
        contact_email: email.trim().toLowerCase(),
        user_agent: req.headers.get('user-agent'),
        origin: req.headers.get('origin'),
      },
    })

    if (trackingError) {
      console.error('[contact] website_lead_events insert failed:', trackingError.message)
    }
  }

  return NextResponse.json({ ok: true })
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildMetaAdsAiPilotConfirmation(name: string) {
  return `
    <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937;line-height:1.7">
      <h2 style="margin:0 0 20px;font-size:20px;color:#111827">我们收到你的留言了</h2>
      <p>${escapeHtml(name)}，你好：</p>
      <p>谢谢你在 Magic Engine 工具实验室留言。工具上线、或者需要跟你确认需求时，我们会通过这个邮箱联系你。</p>
      <p>想现在就体检你的 Facebook 广告，可以直接免费注册：<a href="https://app.magicengine.com.au/meta-ads-ai/mine" style="color:#1d4ed8">免费体检我的广告</a>。</p>
      <p>我们不会向你要 Facebook 密码，也不需要你发广告报表。</p>
      <p>如果有问题，可以直接回复这封邮件，或联系 <a href="mailto:${escapeHtml(TO_EMAIL)}" style="color:#1d4ed8">${escapeHtml(TO_EMAIL)}</a>。</p>
      <p style="margin-top:24px">Magic Engine 团队</p>
    </div>
  `
}
