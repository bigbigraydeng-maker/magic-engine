import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

const TO_EMAIL = 'raydeng@magicengine.com.au'

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

  const { name, email, company, message } = body as Record<string, string>

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return NextResponse.json({ error: 'Name, email, and message are required.' }, { status: 400 })
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 })
  }

  if (message.length > 4000) {
    return NextResponse.json({ error: 'Message too long.' }, { status: 400 })
  }

  const resend = new Resend(apiKey)

  const { error } = await resend.emails.send({
    from: 'Magic Engine Contact <onboarding@resend.dev>',
    to: [TO_EMAIL],
    replyTo: email,
    subject: `New enquiry from ${name.trim()} — Magic Engine`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 20px;font-size:18px;color:#0f172a">New contact form submission</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr>
            <td style="padding:8px 12px;background:#f8fafc;font-weight:600;width:100px;color:#475569">Name</td>
            <td style="padding:8px 12px;border-left:3px solid #e2e8f0">${escapeHtml(name.trim())}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#475569">Email</td>
            <td style="padding:8px 12px;border-left:3px solid #e2e8f0">${escapeHtml(email.trim())}</td>
          </tr>
          ${company?.trim() ? `
          <tr>
            <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#475569">Company</td>
            <td style="padding:8px 12px;border-left:3px solid #e2e8f0">${escapeHtml(company.trim())}</td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding:8px 12px;background:#f8fafc;font-weight:600;vertical-align:top;color:#475569">Message</td>
            <td style="padding:8px 12px;border-left:3px solid #e2e8f0;white-space:pre-wrap">${escapeHtml(message.trim())}</td>
          </tr>
        </table>
        <p style="margin-top:20px;font-size:12px;color:#94a3b8">
          Sent from the Magic Engine contact form. Reply directly to this email to respond to ${escapeHtml(name.trim())}.
        </p>
      </div>
    `,
  })

  if (error) {
    console.error('[contact] Resend error:', error)
    return NextResponse.json({ error: 'Failed to send message. Please try again.' }, { status: 500 })
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
