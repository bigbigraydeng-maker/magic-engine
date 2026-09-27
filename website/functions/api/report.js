/* POST /api/report — email the full free website check to the visitor.
   Receives: { leadId: string, email: string, consent: boolean }
   Returns:  { ok: true } | { error, code } with code in
             forbidden | bad_request | invalid_email | consent_required | no_visitor | report_not_ready |
             already_sent | daily_limit | unavailable | send_failed
   Guards (docs/specs/2026-09-27-tools-lab-step2-site-diagnosis-design.md §6 C):
   one email per lead (claimed atomically before sending), at most 5 per visitor per day, official site only,
   every value from the address or the model is escaped, and the email never carries links taken from site content.
*/

import { LIMITS, QuotaUnavailable, consumeQuota, dayStartUtc, escapeHtml, isAllowedOrigin, visitorKey } from '../_shared/site-check.js';

const CORS = { 'Access-Control-Allow-Origin': 'https://magicengine.com.au', 'Content-Type': 'application/json' };
const LAB_URL = 'https://magicengine.com.au/cn/lab/';

function reply(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: CORS });
}
function fail(status, code) {
  return reply(status, { error: code, code });
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function restHeaders(env, extra = {}) {
  return { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, ...extra };
}

async function getLead(env, leadId) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/discovery_leads?id=eq.${encodeURIComponent(leadId)}&select=id,url,market,status,findings`, { headers: restHeaders(env) });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

/** Atomically move scouted → report_sent for this lead. Returns true only for the one caller that wins. */
async function claimLead(env, leadId, email) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/discovery_leads?id=eq.${encodeURIComponent(leadId)}&status=eq.scouted`, {
    method: 'PATCH',
    headers: restHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ email, status: 'report_sent', consent_at: new Date().toISOString() }),
  });
  if (!res.ok) return false;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length === 1;
}

async function releaseLead(env, leadId) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/discovery_leads?id=eq.${encodeURIComponent(leadId)}&status=eq.report_sent`, {
    method: 'PATCH',
    headers: restHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ email: null, status: 'scouted', consent_at: null }),
  }).catch(() => undefined);
}

const SEVERITY = {
  en: { NOW: ['#E07B39', 'Act now'], GAP: ['#BE8A2E', 'Gap found'], GOOD: ['#1F7A55', 'Looking good'] },
  zh: { NOW: ['#E07B39', '先改这条'], GAP: ['#BE8A2E', '可以补上'], GOOD: ['#1F7A55', '做得好'] },
};

function siteLabel(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** Exported for tests. Every interpolated value goes through escapeHtml; no links come from site content. */
export function buildEmail(lead) {
  const f = lead.findings || {};
  const lang = f.lang === 'zh' ? 'zh' : 'en';
  const findings = Array.isArray(f.findings) ? f.findings : [];
  const site = siteLabel(lead.url) || (lang === 'zh' ? '你的业务' : 'your business');
  const sev = SEVERITY[lang];
  const items = findings.map((x) => {
    const [colour, label] = sev[x.severity] || sev.GAP;
    const where = x.where ? `<div style="font-size:12px;color:#888;margin-top:6px;">${lang === 'zh' ? '在哪里看到：' : 'Seen on: '}${escapeHtml(x.where)}</div>` : '';
    return `<div style="border:1px solid rgba(22,24,29,.08);border-radius:12px;padding:16px 18px;margin-bottom:12px;">
      <div style="font-size:12px;font-weight:700;color:${colour};margin-bottom:6px;">${escapeHtml(label)}</div>
      <div style="font-size:15px;font-weight:700;color:#16181D;margin-bottom:6px;">${escapeHtml(x.title)}</div>
      <div style="font-size:14px;color:#555;line-height:1.65;">${escapeHtml(x.desc)}</div>
      ${x.fix ? `<div style="font-size:14px;color:#16181D;line-height:1.65;margin-top:8px;"><strong>${lang === 'zh' ? '怎么改：' : 'What to do: '}</strong>${escapeHtml(x.fix)}</div>` : ''}
      ${where}
    </div>`;
  }).join('');
  const fromAnswers = f.source === 'answers';
  const t = lang === 'zh'
    ? {
      subject: `你的网站诊断结果：${site}，共 ${findings.length} 条建议`,
      hello: '你好，',
      intro: fromAnswers
        ? `这是 Magic Engine 根据你填写的业务介绍写的免费建议（我们没有看过网站），按重要程度排好了。`
        : `这是 Magic Engine 对 ${escapeHtml(site)} 首页的免费诊断，按「最影响客户联系你」的顺序排好了。`,
      heading: '诊断结果',
      outro: '看完不知道先改哪条？直接回复这封邮件跟我们聊，可以用中文。',
      footer: `你收到这封邮件，是因为你在 Magic Engine 工具实验室（${LAB_URL}）用了免费网站诊断。`,
      html: 'zh-CN',
    }
    : {
      subject: `Your website check for ${site} — ${findings.length} findings`,
      hello: 'Hi there,',
      intro: fromAnswers
        ? 'Here is Magic Engine\'s free advice based on the business details you entered (we did not look at a website).'
        : `Here is Magic Engine's free check of the ${escapeHtml(site)} homepage, most important first.`,
      heading: 'Your findings',
      outro: 'Not sure where to start? Just reply to this email.',
      footer: 'You received this because you ran the free website check at magicengine.com.au.',
      html: 'en',
    };
  const summary = f.summary ? `<div style="background:#FBF5E8;border-radius:12px;padding:16px 20px;margin-bottom:24px;font-size:14px;color:#9A6F1E;line-height:1.65;">${escapeHtml(f.summary)}</div>` : '';
  const body = `<!DOCTYPE html>
<html lang="${t.html}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Magic Engine</title></head>
<body style="margin:0;padding:0;background:#F0EFE9;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei','Inter',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0EFE9;padding:32px 16px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="background:#16181D;border-radius:18px 18px 0 0;padding:28px 36px;"><div style="font-size:22px;font-weight:700;color:#FBFAF7;">Magic Engine</div></td></tr>
<tr><td style="background:#FBFAF7;padding:32px 36px;border-radius:0 0 18px 18px;">
<p style="font-size:15px;color:#16181D;margin:0 0 8px;">${t.hello}</p>
<p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 24px;">${t.intro}</p>
${summary}
<h2 style="font-size:18px;font-weight:700;color:#16181D;margin:0 0 14px;">${t.heading}</h2>
${items}
<p style="font-size:15px;color:#16181D;line-height:1.7;margin:24px 0 0;">${t.outro}</p>
<hr style="border:none;border-top:1px solid rgba(22,24,29,.08);margin:24px 0;">
<p style="font-size:12px;color:#888;line-height:1.6;margin:0;">${escapeHtml(t.footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: t.subject, body };
}

async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) throw new Error('email not configured');
  const from = env.RESEND_FROM || 'Magic Engine <hello@magicengine.cloud>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from, to, subject, html, reply_to: 'hello@magicengine.cloud' }),
  });
  if (!res.ok) throw new Error(`email ${res.status}`);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isAllowedOrigin(request)) return fail(403, 'forbidden');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return fail(503, 'unavailable');
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return fail(400, 'bad_request');
    const { leadId, email, consent } = body;
    if (!isValidEmail(email)) return fail(400, 'invalid_email');
    if (consent !== true) return fail(400, 'consent_required');
    if (typeof leadId !== 'string' || !/^[0-9a-f-]{36}$/i.test(leadId)) return fail(400, 'report_not_ready');

    const lead = await getLead(env, leadId);
    if (!lead || !Array.isArray(lead.findings?.findings) || lead.findings.findings.length === 0) return fail(400, 'report_not_ready');
    if (lead.status !== 'scouted') return fail(409, 'already_sent');

    const key = await visitorKey(request, env);
    if (!key) return fail(400, 'no_visitor');
    try {
      if (!(await consumeQuota(env, 'site_report_ip', key, dayStartUtc(), LIMITS.reportPerVisitorPerDay))) return fail(429, 'daily_limit');
    } catch (err) {
      if (err instanceof QuotaUnavailable) return fail(503, 'unavailable');
      throw err;
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!(await claimLead(env, lead.id, cleanEmail))) return fail(409, 'already_sent');
    const { subject, body: html } = buildEmail(lead);
    try {
      await sendEmail(env, { to: cleanEmail, subject, html });
    } catch (err) {
      console.error('site-check report email failed:', err instanceof Error ? err.message : String(err));
      await releaseLead(env, lead.id);
      return fail(502, 'send_failed');
    }
    return reply(200, { ok: true });
  } catch (err) {
    console.error('site-check report fatal error:', err instanceof Error ? err.message : String(err));
    return fail(500, 'send_failed');
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://magicengine.com.au',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
