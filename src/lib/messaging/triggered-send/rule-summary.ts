/**
 * A rule snapshot in plain words, for the person who authorizes it. Pure, and type-only imports, so the dashboard
 * page can import it too. Every line comes from a value of the rule itself; nothing here is client-specific.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §3.1 (plan: §17).
 */

import type { TriggeredSendRule } from './rule'

const SOURCE_WORDS: Readonly<Record<string, string>> = {
  meta_lead_form: 'Facebook 表单留资的新客人',
}

function list(items: readonly string[]): string {
  return items.length === 0 ? '（无）' : items.join('、')
}

function audienceLines(rule: TriggeredSendRule): string[] {
  const sources = rule.audience.sources.map((s) => SOURCE_WORDS[s] ?? s)
  const lines = [
    `谁会收到：${list(sources)}；只看最近 ${rule.audience.max_age_days} 天进来的，进来第二天早上才发，历史老客人一个都不发`,
  ]
  if (rule.recipient_allowlist !== null) {
    lines.push(`试跑：只发给这 ${rule.recipient_allowlist.length} 个地址：${list(rule.recipient_allowlist)}；别的客人一个都不发`)
  } else {
    lines.push('正式：所有符合条件的新客人都会收到')
  }
  lines.push(`同意依据只认：${list(rule.consent.accepted_bases)}`)
  lines.push(`同一位客人 ${rule.frequency_cap.window_days} 天内最多收 ${rule.frequency_cap.max} 封（所有邮件合计）`)
  lines.push(`销售已经亲自写过信的客人不发；为此要一直能读到这些销售邮箱：${list(rule.human_mail.required_mailboxes)}`)
  lines.push(
    `旧群发：标题以「${rule.legacy.mailchimp_campaign_title_prefix}」开头的活动算旧欢迎信；带这些标签的客人不发：${list(rule.legacy.excluded_tags)}`,
  )
  return lines
}

function sendLines(rule: TriggeredSendRule, dailyCap: number): string[] {
  const send = rule.send
  if (send === undefined) return ['这份提案没有发信设置：只能彩排，不能授权']
  const b = send.health_breaker
  return [
    `发件人：${send.identity.from}；客人回信到：${send.identity.reply_to}`,
    `用的模板：${send.template.key}`,
    `只在客户所在时区（${rule.schedule.timezone}）的 ${send.send_window.start}–${send.send_window.end} 之间发，不按每位客人自己的时区；每天最多 ${dailyCap} 封`,
    `自动停发：${b.window_days} 天内发满 ${b.bounce_min_sent} 封后硬退信 ≥ ${b.bounce_min_count} 个且超过 ${b.bounce_rate_pct}%；或投诉 ≥ ${b.complaint_max} 次；或连续 ${b.provider_reject_streak} 封被拒收`,
  ]
}

export function describeRule(rule: TriggeredSendRule, dailyCap: number): string[] {
  return [...audienceLines(rule), ...sendLines(rule, dailyCap)]
}
