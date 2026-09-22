/**
 * 广告只读诊断 · 内部版日报（ads IMPACT 阶段 1 第 7 步，设计 §6 / §9 / §14 C6）。
 *
 * 🔴 只发内部邮箱。收件人（含环境变量里的兜底地址）一律按内部域名核对，客户邮箱丢弃并计数；
 *    一个内部收件人都没有 → 不发，回执写错误（不会退而发给客户）。
 *    客户版是阶段 3 的事：默认关闭、每周一封、Gmail 通道、按收件人语言——**不在这里**。
 * 🔴 只读诊断，不出任何挪预算/改广告的操作建议；「要人处理」只写怎么查。
 *
 * 结构：先一句结论 → 按漏斗角色分组列命中 → 判不了的（折叠，写明「不是没问题」）→ 被排除的 → 老体检待处理系列。
 * 防疲劳：有命中才发；前一天有命中、今天没有且没有判不了 → 「恢复」；前一天有命中、今天判不了 → 「🟡 判不了」；
 * 周一（按数据日期）发一封例行信；其余不发。
 *
 * 为什么暂不上 Inngest（CLAUDE.md 铁律 3 要求写明）：单步、只发内部邮箱、与原日报同一条 cron 同一个发送点的替换，
 * 没有跨步骤接力；回执落在 ad_health_narratives（payload.portfolio_diagnoses + email_status），当天没有体检记录时
 * 回执只在 cron_run_logs 的 summary 里（这种情况下重跑可能重复发一封内部信，已接受）。
 * 恢复条件：阶段 2 诊断开始驱动处方（§4.4 `ads.diagnosis.created` 事件链）时迁入 Inngest，并给诊断自己的表。
 */

import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase'
import { meMailFrom, ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { describeSendError } from '@/lib/ads-strategy/digest'
import type { Diagnosis, DiagnosisRun } from './diagnostics/types'
import type { FunnelRole } from './roles'
import { bareAddress, isInternalEmail, splitAddresses } from './diagnostics/internal-email'

export type InternalDigestDecision = 'alert' | 'uncertain' | 'recovery' | 'weekly' | 'skip'

const APP_BASE = 'https://app.magicengine.com.au'

const ROLE_ORDER: Array<{ key: FunnelRole | 'account'; label: string }> = [
  { key: 'account', label: '账户层面' },
  { key: 'awareness', label: '破冰（让没见过的人看到）' },
  { key: 'acquisition', label: '获客（冷流量要留资/私信）' },
  { key: 'retargeting', label: '再营销（找回看过/互动过的人）' },
  { key: 'expansion', label: '扩量（类似人群）' },
  { key: 'mixed', label: '角色说不清' },
  { key: 'unknown', label: '角色未识别' },
]

const NOT_COMPARABLE_LABEL: Record<string, string> = {
  no_hourly_data: '没拿到按小时数据',
  night_trough: '夜间低谷',
  scheduled_delivery: '排期投放',
  report_lag: '报表还没到',
  target_cost_not_configured: '没设置目标单次成本',
  outcome_not_configured: '没设置结果怎么算',
  primary_result_unknown: '真实生意归不到广告',
  primary_not_attributable: '真实生意归不到广告',
  audience_below_floor: '受众人数太少看不准',
  audience_too_new: '受众刚建',
  page_audience_unverifiable: '主页受众无法确认',
  no_video_creatives: '找不到视频',
  missing_data: '缺数据',
  cbo_internal: '同一系列内部不比',
  shared_account: '共用账户',
  below_min_sample: '数量太少',
  single_unit: '只有一个单位',
}

/** 只留内部收件人（环境变量兜底地址也要过内部核对）。返回裸地址。 */
export function resolveInternalRecipients(configured: string[]): { to: string[]; dropped: number } {
  const all = splitAddresses(configured)
  const internal = all.filter(isInternalEmail).map(bareAddress)
  const fallback = splitAddresses([process.env.AD_HEALTH_DIGEST_TO, ME_MAIL_TO_ADDRESS]).filter(isInternalEmail).map(bareAddress)
  const to = internal.length > 0 ? internal : fallback.slice(0, 1)
  return { to: Array.from(new Set(to)), dropped: all.length - internal.length }
}

export function decideInternalSend(
  today: { hits: number; notComparable: number },
  previousHitCount: number | null,
  isWeeklyDay: boolean,
): InternalDigestDecision {
  if (today.hits > 0) return 'alert'
  if ((previousHitCount ?? 0) > 0) return today.notComparable > 0 ? 'uncertain' : 'recovery'
  if (isWeeklyDay) return 'weekly'
  return 'skip'
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function absoluteHref(href: string): string {
  return href.startsWith('http') ? href : `${APP_BASE}${href.startsWith('/') ? '' : '/'}${href}`
}

function roleOf(d: Diagnosis): FunnelRole | 'account' {
  const u = d.units[0]
  if (!u || u.level === 'account') return 'account'
  return u.role ?? 'unknown'
}

function sampleLine(d: Diagnosis): string {
  return d.sample.map(s => `${s.label} ${s.value}`).join(' · ')
}

function hitCard(d: Diagnosis): string {
  const units = d.units.filter(u => u.level !== 'account').map(u => u.name ?? u.id).join('、')
  const t = d.manualTask
  const task = t
    ? `<div style="margin-top:6px;font-size:12px;color:#7c2d12"><b>下一步（只看不改）：</b>${esc(t.what)} ${esc(t.how)}${t.href ? ` <a href="${esc(absoluteHref(t.href))}" style="color:#b45309">打开 →</a>` : ''}</div>`
    : ''
  return `
    <div style="margin:10px 0;padding:10px 12px;background:#fef2f2;border-radius:8px">
      <div style="font-weight:600;color:#0f172a">${esc(d.title)}</div>
      ${units ? `<div style="margin-top:3px;font-size:12px;color:#475569">涉及：${esc(units)}</div>` : ''}
      <div style="margin-top:3px;font-size:12px;color:#64748b">${esc(d.reasons.join('；'))}</div>
      ${sampleLine(d) ? `<div style="margin-top:3px;font-size:11px;color:#94a3b8">样本：${esc(sampleLine(d))}</div>` : ''}
      ${task}
    </div>`
}

export interface LegacyCampaign {
  campaign_name: string
  verdict: string
  headline: string
}

function leadLine(decision: Exclude<InternalDigestDecision, 'skip'>, date: string, hits: number, nc: number): string {
  if (decision === 'alert') return `🔴 ${date} 发现 ${hits} 件要看的事`
  if (decision === 'recovery') return `🟢 ${date} 之前报的问题今天没再出现`
  if (decision === 'uncertain') return `🟡 ${date} 之前报的问题今天没再报，但有 ${nc} 条数据不够、判不了（见下），不代表已经好了`
  return nc > 0
    ? `🟡 ${date} 没发现新问题，但有 ${nc} 条数据不够、判不了（见下）`
    : `🟢 ${date} 没发现需要看的事（周一例行一封）`
}

export function buildInternalDigest(opts: {
  clientName: string
  date: string
  run: DiagnosisRun
  decision: Exclude<InternalDigestDecision, 'skip'>
  legacyNeedsAction: LegacyCampaign[]
  droppedRecipients: number
}): { subject: string; html: string } {
  const hits = opts.run.diagnoses.filter(d => d.status === 'hit')
  const nc = opts.run.diagnoses.filter(d => d.status === 'not_comparable')
  const lead = leadLine(opts.decision, opts.date, hits.length, nc.length)
  const subjectLabel = { alert: `🔴 ${hits.length} 件要看`, recovery: '🟢 已恢复', uncertain: '🟡 判不了', weekly: nc.length > 0 ? '🟡 例行' : '🟢 例行' }[opts.decision]

  const groups = ROLE_ORDER.map(({ key, label }) => {
    const items = hits.filter(d => roleOf(d) === key)
    return items.length > 0 ? `<h3 style="font-size:14px;margin:16px 0 4px;color:#334155">${esc(label)}</h3>${items.map(hitCard).join('')}` : ''
  }).join('')

  const ncBlock = nc.length > 0
    ? `<h3 style="font-size:14px;margin:16px 0 4px;color:#92400e">判不了的 ${nc.length} 条（不是没问题，是数据不够下结论）</h3>
        <ul style="font-size:12px;color:#64748b">${nc.map(d => `<li>${esc(d.title)}（${esc(NOT_COMPARABLE_LABEL[d.notComparableReason ?? ''] ?? '判不了')}${sampleLine(d) ? ` · ${esc(sampleLine(d))}` : ''}）</li>`).join('')}</ul>`
    : ''

  const excludedBlock = opts.run.excluded.length > 0
    ? `<p style="margin-top:12px;font-size:12px;color:#64748b"><b>没参与诊断：</b>${opts.run.excluded.map(e => esc(`${e.name ?? e.id}（${e.reason === 'meta_experiment' ? '在 Meta 对比测试中，测试结束前不下结论' : '共用广告账户，只看账户层面'}）`)).join('；')}</p>`
    : ''

  const legacyBlock = opts.legacyNeedsAction.length > 0
    ? `<h3 style="font-size:14px;margin:16px 0 4px;color:#334155">原有体检：还需要看的广告系列</h3><ul style="font-size:12px;color:#475569">${opts.legacyNeedsAction.map(c => `<li>${esc(c.campaign_name)}：${esc(c.headline)}</li>`).join('')}</ul>`
    : ''

  const droppedNote = opts.droppedRecipients > 0
    ? `<p style="margin-top:12px;font-size:11px;color:#b45309">⚠️ 设置里有 ${opts.droppedRecipients} 个非内部收件人，这封内部日报没有发给他们。</p>`
    : ''

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a">
      <p style="font-size:16px;font-weight:600;margin:0 0 6px">${esc(lead)}</p>
      <p style="font-size:12px;color:#64748b;margin:0">只读诊断，没有改任何广告和预算。仅限内部。</p>
      ${groups}
      ${ncBlock}
      ${excludedBlock}
      ${legacyBlock}
      ${droppedNote}
      <p style="margin-top:18px;font-size:11px;color:#94a3b8">Magic Engine 广告诊断（内部版）· 有事才发，周一例行一封。</p>
    </div>`
  return { subject: `[${opts.clientName} 广告诊断·内部] ${opts.date} · ${subjectLabel}`, html }
}

export interface InternalDigestResult {
  decision: InternalDigestDecision
  sent: boolean
  recipients_dropped: number
  persisted: boolean
  error?: string
}

/**
 * 把诊断结果并进当天的 ad_health_narratives.payload，按规则决定发不发，只发内部。尽力而为，不抛。
 */
export async function persistAndSendInternalDigest(opts: {
  clientId: string
  clientName: string
  date: string
  run: DiagnosisRun
  configuredRecipients: string[]
}): Promise<InternalDigestResult> {
  const hits = opts.run.diagnoses.filter(d => d.status === 'hit').length
  const notComparable = opts.run.diagnoses.length - hits
  const { to, dropped } = resolveInternalRecipients(opts.configuredRecipients)
  let decision: InternalDigestDecision = 'skip'
  let persisted = false
  try {
    const [today, prev] = await Promise.all([
      supabaseAdmin.from('ad_health_narratives').select('payload, email_status').eq('client_id', opts.clientId).eq('insight_date', opts.date).maybeSingle(),
      supabaseAdmin.from('ad_health_narratives').select('payload').eq('client_id', opts.clientId).lt('insight_date', opts.date).order('insight_date', { ascending: false }).limit(1).maybeSingle(),
    ])
    const payload = (today.data?.payload ?? null) as Record<string, unknown> | null
    const prevDiag = (prev.data?.payload as { portfolio_diagnoses?: { hit_count?: number } } | null)?.portfolio_diagnoses
    decision = decideInternalSend({ hits, notComparable }, prevDiag?.hit_count ?? null, new Date(`${opts.date}T00:00:00Z`).getUTCDay() === 1)

    if (payload) {
      const { error } = await supabaseAdmin.from('ad_health_narratives')
        .update({ payload: { ...payload, portfolio_diagnoses: { ...opts.run, hit_count: hits } }, updated_at: new Date().toISOString() })
        .eq('client_id', opts.clientId).eq('insight_date', opts.date)
      persisted = !error
    }

    if (decision === 'skip') return { decision, sent: false, recipients_dropped: dropped, persisted }
    if (today.data?.email_status === 'sent') return { decision, sent: false, recipients_dropped: dropped, persisted }
    if (to.length === 0) return { decision, sent: false, recipients_dropped: dropped, persisted, error: 'no internal recipient (configured and fallback addresses are all non-internal)' }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) return { decision, sent: false, recipients_dropped: dropped, persisted, error: 'RESEND_API_KEY not configured' }

    const campaigns = ((payload?.campaigns ?? []) as LegacyCampaign[]).filter(c => c.verdict === 'alert' || c.verdict === 'watch')
    const { subject, html } = buildInternalDigest({ clientName: opts.clientName, date: opts.date, run: opts.run, decision, legacyNeedsAction: campaigns, droppedRecipients: dropped })
    const { error } = await new Resend(apiKey).emails.send({ from: meMailFrom('Magic Engine 广告诊断（内部）'), to, subject, html })
    const status = error ? 'failed' : 'sent'
    if (payload) {
      await supabaseAdmin.from('ad_health_narratives').update({ email_status: status, updated_at: new Date().toISOString() })
        .eq('client_id', opts.clientId).eq('insight_date', opts.date)
    }
    if (error) return { decision, sent: false, recipients_dropped: dropped, persisted, error: describeSendError(error) }
    return { decision, sent: true, recipients_dropped: dropped, persisted }
  } catch (err) {
    return { decision, sent: false, recipients_dropped: dropped, persisted, error: err instanceof Error ? err.message : String(err) }
  }
}
