/* POST /api/report
   Receives: { leadId: string, email: string, consent: boolean }
   Returns:  { ok: true }
   Flow: fetch lead → render HTML email → send via Resend → update Supabase
*/

const LOCALE_LABEL = { AU: 'Australia', NZ: 'New Zealand' };

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function getLead(env, leadId) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/discovery_leads?id=eq.${encodeURIComponent(leadId)}&select=*`,
    {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

async function updateLead(env, leadId, email) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
  await fetch(
    `${env.SUPABASE_URL}/rest/v1/discovery_leads?id=eq.${encodeURIComponent(leadId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ email, status: 'report_sent', consent_at: new Date().toISOString() }),
    }
  );
}

function severityColour(sev) {
  if (sev === 'NOW')  return '#E07B39';
  if (sev === 'GAP')  return '#BE8A2E';
  if (sev === 'GOOD') return '#1F7A55';
  return '#BE8A2E';
}

function severityLabel(sev) {
  if (sev === 'NOW')  return '⚡ Act now';
  if (sev === 'GAP')  return '⚠ Gap found';
  if (sev === 'GOOD') return '✓ Looking good';
  return sev;
}

function buildEmail({ lead, email }) {
  const findings = lead?.findings?.findings || [];
  const market = lead?.market || 'AU';
  const url = lead?.url || '';
  const marketName = LOCALE_LABEL[market] || market;
  const fyEnd = market === 'NZ' ? '31 March' : '30 June';
  const gst = market === 'NZ' ? '15%' : '10%';
  const summary = lead?.findings?.summary || '';
  const topOpp = lead?.findings?.top_opportunity;

  const findingsHtml = findings.map(f => `
    <div style="background:#fff;border-radius:12px;padding:20px 24px;border-left:4px solid ${severityColour(f.severity)};margin-bottom:14px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${severityColour(f.severity)};margin-bottom:6px;">${severityLabel(f.severity)}</div>
      <div style="font-size:16px;font-weight:600;color:#16181D;margin-bottom:6px;">${f.title || ''}</div>
      <div style="font-size:14px;color:#555;line-height:1.65;">${f.desc || ''}</div>
      ${f.fix ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #eee;font-size:13px;color:#1F7A55;font-weight:500;">→ ${f.fix}</div>` : ''}
    </div>`).join('');

  const subject = topOpp?.title
    ? `${topOpp.title} — your Magic Engine report is here`
    : `Your ${marketName} visibility report is ready — Magic Engine`;

  const body = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Magic Engine Report</title></head>
<body style="margin:0;padding:0;background:#F0EFE9;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0EFE9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:#16181D;border-radius:18px 18px 0 0;padding:32px 40px;">
          <div style="font-size:22px;font-weight:700;color:#FBFAF7;margin-bottom:4px;">Magic Engine</div>
          <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.35);">张骞 Discovery Report</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#FBFAF7;padding:36px 40px;border-radius:0 0 18px 18px;">

          <p style="font-size:15px;color:#16181D;margin:0 0 8px;">Hi there,</p>
          <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 28px;">
            Here is your personalised 张骞 Discovery report for
            <strong style="color:#16181D;">${url || 'your business'}</strong>
            — analysed for the <strong>${marketName}</strong> market
            (EOFY: <strong>${fyEnd}</strong>, GST: <strong>${gst}</strong>).
          </p>

          ${summary ? `<div style="background:#FBF5E8;border-radius:12px;padding:18px 22px;margin-bottom:28px;font-size:14px;color:#9A6F1E;line-height:1.65;">${summary}</div>` : ''}

          <h2 style="font-size:18px;font-weight:700;color:#16181D;margin:0 0 16px;">Your findings</h2>
          ${findingsHtml || '<p style="color:#888;">No findings available.</p>'}

          ${topOpp ? `
          <div style="background:#16181D;border-radius:14px;padding:28px 32px;margin:28px 0;text-align:center;">
            <div style="font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.4);margin-bottom:8px;">Top opportunity</div>
            <div style="font-size:18px;font-weight:700;color:#FBFAF7;margin-bottom:20px;">${topOpp.title}</div>
            <a href="https://app.magicengine.com.au/portal/login" style="display:inline-block;padding:13px 28px;background:#BE8A2E;color:#fff;font-weight:600;font-size:15px;border-radius:10px;text-decoration:none;">Open your portal →</a>
          </div>` : ''}

          <hr style="border:none;border-top:1px solid rgba(22,24,29,.08);margin:28px 0;">

          <p style="font-size:13px;color:#888;line-height:1.65;margin:0;">
            Magic Engine — AI-era visibility for ${marketName} businesses.<br>
            <a href="https://magicengine.com.au/privacy" style="color:#BE8A2E;">Privacy Policy</a> ·
            <a href="https://magicengine.com.au/terms" style="color:#BE8A2E;">Terms</a> ·
            You received this because you ran a free discovery at magicengine.com.au.
          </p>

        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, body };
}

async function sendEmail(env, { to, subject, htmlBody }) {
  if (!env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured — skipping email send');
    return;
  }

  const from = env.RESEND_FROM || 'Magic Engine <hello@magicengine.com.au>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from, to, subject, html: htmlBody }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('Resend error:', res.status, txt);
    throw new Error(`Resend ${res.status}`);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const body = await request.json();
    const { leadId, email, consent } = body;

    // Validate
    if (!email || !isValidEmail(email)) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), { status: 400, headers: corsHeaders });
    }
    if (consent !== true) {
      return new Response(JSON.stringify({ error: 'Consent required' }), { status: 400, headers: corsHeaders });
    }

    // Fetch lead
    let lead = null;
    if (leadId && !leadId.startsWith('demo-') && !leadId.startsWith('fallback-')) {
      lead = await getLead(env, leadId);
    }

    // Build and send email
    const { subject, body: htmlBody } = buildEmail({ lead: lead || {}, email });
    await sendEmail(env, { to: email, subject, htmlBody });

    // Update lead record
    if (lead?.id) {
      await updateLead(env, lead.id, email);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });

  } catch (err) {
    console.error('Report fatal error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to send report — please try again' }),
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
