/**
 * P21.K.4 — Ad Strategy Engine daily email digest.
 *
 * Turns the day's ad_health_narrative into an email to the FDE/PM inbox, using
 * ME's own Resend integration (replacing the unreliable Zapier Gmail path,
 * which 402s once its free tier is spent).
 *
 * The point is anti-fatigue (板桥): a PM who gets a "🟢 all good" every single
 * day filters the thread and misses the real 🔴. So green is de-frequenced —
 * only a state change or a weekly summary sends when healthy; alerts always
 * send. Everything is best-effort: a send failure never affects data or the
 * cron, because the narrative is already stored and visible on the dashboard.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { meMailFrom, ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { resolveAdsPlaybook } from './playbooks'

type Verdict = 'healthy' | 'watch' | 'alert' | 'insufficient_history' | 'paused'

interface CampaignNarrative {
  campaign_name: string
  verdict: Verdict
  headline: string
  latest_spend_7d: number
  latest_results_7d: number
}

interface NarrativePayload {
  overall_verdict: Verdict
  headline: string
  campaigns: CampaignNarrative[]
  evaluated: number
  generated_for: string
}

export type SendDecision = 'alert' | 'watch' | 'recovery' | 'weekly_healthy' | 'skip'

/**
 * Decide whether today's narrative warrants an email, and why.
 *
 * - alert / watch      → always send (actionable, persists until fixed)
 * - healthy after bad  → send (good news worth a state-change ping)
 * - healthy, weekly    → send a light "still healthy" summary once a week
 * - healthy, otherwise → skip (don't nag with daily green)
 * - insufficient       → skip (nothing to report yet)
 */
export function decideSend(
  current: Verdict,
  previous: Verdict | null,
  isWeeklyDay: boolean,
): SendDecision {
  if (current === 'alert') return 'alert'
  if (current === 'watch') return 'watch'
  if (current === 'healthy') {
    if (previous === 'alert' || previous === 'watch') return 'recovery'
    if (isWeeklyDay) return 'weekly_healthy'
    return 'skip'
  }
  // insufficient_history or any unexpected value → never email on a non-verdict.
  return 'skip'
}

const STATUS_LABEL: Record<SendDecision, string> = {
  alert: '🔴 需要动手',
  watch: '🟡 留意',
  recovery: '🟢 已恢复',
  weekly_healthy: '🟢 本周持续健康',
  skip: '',
}

export function buildSubject(clientName: string, insightDate: string, decision: SendDecision): string {
  const alerts = decision === 'alert'
  const label = alerts ? '🔴 有广告要动手' : STATUS_LABEL[decision]
  return `[${clientName} 广告自检] ${insightDate} · ${label}`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Inverted-pyramid body: lead with the conclusion, then at most the campaigns
 * that need action, then a link. All-healthy sends collapse to a single line.
 */
export function buildBody(
  payload: NarrativePayload,
  decision: SendDecision,
  dashboardUrl: string,
  industry: string | null = null,
): string {
  const playbook = resolveAdsPlaybook(industry)
  const campaigns = payload.campaigns ?? []
  const needAction = campaigns.filter(c => c.verdict === 'alert' || c.verdict === 'watch')
  // Count ONLY campaigns actually judged healthy. `evaluated` includes paused
  // ones — using it here re-created the exact lie this engine exists to kill
  // ("其余 7 条健康" when 5 of them were stopped; 魏征 review of PR #631).
  const healthyCount = campaigns.filter(c => c.verdict === 'healthy').length
  const pausedCount  = campaigns.filter(c => c.verdict === 'paused').length
  const pausedNote   = pausedCount > 0 ? `(另 ${pausedCount} 条已停投)` : ''

  let lead: string
  let items = ''

  if (decision === 'weekly_healthy' || decision === 'recovery') {
    const active = campaigns.length - pausedCount
    lead = decision === 'recovery'
      ? `🟢 广告恢复健康了 —— 在投的 ${active} 条广告目前都无需动手。${pausedNote}`
      : `🟢 本周你在投的 ${active} 条广告持续健康,无需动手。${pausedNote}系统仍每天替你盯着。`
  } else {
    const n = needAction.length
    lead = `${decision === 'alert' ? '🔴' : '🟡'} 今天有 ${n} 件事${decision === 'alert' ? '要看' : '可以留意'}:`
    items = needAction.map((c, i) => {
      const cpl = c.latest_results_7d > 0 ? ` · ${playbook.costPerResultLabel} $${(c.latest_spend_7d / c.latest_results_7d).toFixed(1)}` : ''
      return `
        <div style="margin:12px 0;padding:12px 14px;background:#fef2f2;border-radius:8px">
          <div style="font-weight:600;color:#0f172a">${i + 1}. ${esc(c.campaign_name)}</div>
          <div style="margin-top:4px;font-size:14px;color:#475569">${esc(c.headline)}</div>
          <div style="margin-top:6px;font-size:12px;color:#94a3b8">近 7 天花费 $${c.latest_spend_7d.toFixed(0)} · ${playbook.resultNoun} ${c.latest_results_7d}${cpl}</div>
          <div style="margin-top:6px;font-size:12px;color:#64748b">→ 具体怎么处理,下一步的处方会给到,无需你手动操作。</div>
        </div>`
    }).join('')
    if (healthyCount > 0) items += `<p style="font-size:13px;color:#16a34a;margin:10px 0 0">✅ 其余 ${healthyCount} 条广告健康,无需动手。${pausedNote}</p>`
    else if (pausedCount > 0) items += `<p style="font-size:13px;color:#94a3b8;margin:10px 0 0">另 ${pausedCount} 条已停投。</p>`
  }

  return `
    <div style="font-family:sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#0f172a">
      <p style="font-size:16px;font-weight:600;margin:0 0 4px">${lead}</p>
      ${items}
      <p style="margin-top:20px;font-size:13px">
        <a href="${dashboardUrl}" style="color:#d97706">→ 打开广告健康页看详情</a>
      </p>
      <p style="margin-top:16px;font-size:11px;color:#94a3b8">
        Magic Engine 广告自检 · 每天自动体检,没事不发、有事才推。
      </p>
    </div>`
}

export interface DigestResult {
  decision: SendDecision
  sent: boolean
  error?: string
}

/**
 * Send the day's digest for one client if warranted, and record the outcome on
 * the narrative row (email_status). Best-effort: returns rather than throws.
 * Loads the day's narrative payload itself so callers stay simple.
 */
export async function sendAdHealthDigest(
  clientId: string,
  clientName: string,
  insightDate: string,
  recipients?: string[],
): Promise<DigestResult> {
  try {
    // Today's narrative (+ its email state, for idempotency) and the previous
    // day's verdict (for green de-frequency).
    const [todayRes, prevRes, clientRes] = await Promise.all([
      supabaseAdmin
        .from('ad_health_narratives')
        .select('payload, email_status')
        .eq('client_id', clientId)
        .eq('insight_date', insightDate)
        .maybeSingle(),
      supabaseAdmin
        .from('ad_health_narratives')
        .select('overall_verdict')
        .eq('client_id', clientId)
        .lt('insight_date', insightDate)
        .order('insight_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Industry only picks the result noun in the body (ads playbook, G11).
      supabaseAdmin
        .from('clients')
        .select('industry')
        .eq('id', clientId)
        .maybeSingle(),
    ])
    if (clientRes.error) {
      console.warn('[ads-strategy/digest] 读客户行业失败，文案改用中性词', { clientId, error: clientRes.error.message })
    }
    const industry = (clientRes.data as { industry?: string | null } | null)?.industry ?? null

    const payload = todayRes.data?.payload as NarrativePayload | undefined
    if (!payload) return { decision: 'skip', sent: false, error: 'narrative not found' }

    const previous = (prevRes.data?.overall_verdict ?? null) as Verdict | null
    // Weekly "still healthy" summary on Mondays (UTC day 1 of the insight date).
    const isWeeklyDay = new Date(`${insightDate}T00:00:00Z`).getUTCDay() === 1

    const decision = decideSend(payload.overall_verdict, previous, isWeeklyDay)

    if (decision === 'skip') {
      await markEmailStatus(clientId, insightDate, 'skipped')
      return { decision, sent: false }
    }

    // Idempotency: if today's digest already went out (cron re-run / manual
    // retry / scheduler retry), do not send a duplicate. evaluate's daily upsert
    // does not touch email_status, so a prior 'sent' survives its re-runs.
    if (todayRes.data?.email_status === 'sent') {
      return { decision, sent: false }
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      await markEmailStatus(clientId, insightDate, 'failed')
      return { decision, sent: false, error: 'RESEND_API_KEY not configured' }
    }

    const to = recipients && recipients.length > 0
      ? recipients
      : [process.env.AD_HEALTH_DIGEST_TO || ME_MAIL_TO_ADDRESS]
    const dashboardUrl = `https://app.magicengine.com.au/dashboard/clients/${clientId}/ads-health`

    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: meMailFrom('Magic Engine 广告自检'),
      to,
      subject: buildSubject(clientName, insightDate, decision),
      html: buildBody(payload, decision, dashboardUrl, industry),
    })

    if (error) {
      await markEmailStatus(clientId, insightDate, 'failed')
      // Resend returns a plain object ({name, message, statusCode}); String()
      // on it yields "[object Object]", which swallowed the only clue we had
      // when the 2026-07-23 Oztop alert failed to send. Keep it readable.
      return { decision, sent: false, error: describeSendError(error) }
    }

    await markEmailStatus(clientId, insightDate, 'sent')
    return { decision, sent: true }
  } catch (err) {
    return { decision: 'skip', sent: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Render a Resend send error as something a human can act on.
 *
 * Resend's `error` is `{ name, message, statusCode }` — not an Error — so both
 * `String(e)` and `e.message` on the union lose it. Fall back to JSON so a new
 * error shape is still legible rather than silently blank.
 */
export function describeSendError(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; message?: unknown; statusCode?: unknown }
    const parts = [
      typeof e.statusCode === 'number' ? `HTTP ${e.statusCode}` : null,
      typeof e.name === 'string' ? e.name : null,
      typeof e.message === 'string' ? e.message : null,
    ].filter(Boolean)
    if (parts.length > 0) return parts.join(': ')
    try {
      return JSON.stringify(error)
    } catch {
      return 'Unserialisable Resend error'
    }
  }
  return String(error)
}

async function markEmailStatus(
  clientId: string,
  insightDate: string,
  status: 'sent' | 'failed' | 'skipped',
): Promise<void> {
  await supabaseAdmin
    .from('ad_health_narratives')
    .update({ email_status: status, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('insight_date', insightDate)
    .then(() => {}, () => { /* non-fatal — email already sent, status is cosmetic */ })
}
