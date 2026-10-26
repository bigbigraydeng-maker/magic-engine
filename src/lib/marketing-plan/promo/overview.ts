/**
 * 推广计划「大白话总览」：把 PromoSpec 翻成 PM 看得懂的阶段卡片（纯函数，可测试）。
 * 另提供一份通用示例计划，只用于页面预览，永远不入库、不当真数据。
 *
 * 平台通用：不出现任何客户名 / 行业词；示例里的名称和数字都是占位，页面上会标「示例」。
 */

import { publicAdAccountName } from '@/lib/ads/spend-figures'
import type { PromoPhase, PromoSpec, PromoStep } from './spec'

export type StepGroup = 'ads' | 'social' | 'blog' | 'newsletter'

export interface StepView {
  id: string
  group: StepGroup
  title: string
  lines: string[]
}

export interface PhaseView {
  id: string
  name: string
  range: string
  days: number
  steps: StepView[]
}

const MS_PER_DAY = 86_400_000

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY)
}

function inclusiveDays(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from) + 1
}

function addDays(date: string, n: number): string {
  const d = new Date((dayNumber(date) + n) * MS_PER_DAY)
  return d.toISOString().slice(0, 10)
}

/** 日预算单位是「分」，总览统一换成元（账户币种）。 */
function money(cents: number): string {
  return (cents / 100).toFixed(2)
}

function adsView(step: Extract<PromoStep, { kind: 'ads_campaign' }>, accountLabels: Record<string, string | null>): StepView {
  const s = step.settings
  const lines = [
    `每天预算 ${money(s.daily_budget_cents)}（按广告账户的币种）`,
    `广告账户：${publicAdAccountName(accountLabels[s.ad_account_id], s.ad_account_id)} · 受众：${s.audience_ref}`,
    s.creative_refs.length > 0 ? `用 ${s.creative_refs.length} 个已批准的素材` : '还没选素材',
  ]
  if (s.paused_ranges.length > 0) {
    lines.push(`暂停：${s.paused_ranges.map(r => `${r.from} 至 ${r.to}`).join('；')}`)
  }
  return { id: step.id, group: 'ads', title: '投广告', lines }
}

function socialView(step: Extract<PromoStep, { kind: 'social_cadence' }>): StepView {
  const s = step.settings
  const parts = [
    s.posts_per_week > 0 ? `每周 ${s.posts_per_week} 条帖子` : '',
    s.stories_per_week > 0 ? `每周 ${s.stories_per_week} 条快拍` : '',
    s.reels_per_month > 0 ? `每月 ${s.reels_per_month} 条短视频` : '',
  ].filter(Boolean)
  return { id: step.id, group: 'social', title: '发社媒', lines: [parts.length > 0 ? parts.join('，') : '这个阶段不安排社媒'] }
}

function stepView(step: PromoStep, accountLabels: Record<string, string | null>): StepView {
  switch (step.kind) {
    case 'ads_campaign': return adsView(step, accountLabels)
    case 'social_cadence': return socialView(step)
    case 'blog_article':
      return {
        id: step.id, group: 'blog', title: '写博客',
        lines: [`主题：${step.settings.topic}`, `截止 ${step.settings.due_date}`],
      }
    case 'newsletter_email':
      return {
        id: step.id, group: 'newsletter', title: '发邮件',
        lines: [`主题：${step.settings.topic}`, `截止 ${step.settings.due_date}`, step.settings.requires_link ? '信里必须放真实链接' : '不要求放链接'],
      }
  }
}

function phaseView(phase: PromoPhase, accountLabels: Record<string, string | null>): PhaseView {
  return {
    id: phase.id,
    name: phase.name,
    range: `${phase.start_date} 至 ${phase.end_date}`,
    days: inclusiveDays(phase.start_date, phase.end_date),
    steps: phase.steps.map(step => stepView(step, accountLabels)),
  }
}

export function describePromoSpec(spec: PromoSpec, accountLabels: Record<string, string | null> = {}): PhaseView[] {
  return [...spec.phases].sort((a, b) => a.start_date.localeCompare(b.start_date)).map(phase => phaseView(phase, accountLabels))
}

/**
 * 通用示例：预热 → 主推 → 收尾三段，从 today 起算。
 * 通过 parsePromoSpec 校验（测试保证），但 goal / 账户 / 受众都是占位，不能存进真实计划。
 */
export function buildPromoSample(today: string): PromoSpec {
  const s1 = today
  const e1 = addDays(today, 13)
  const s2 = addDays(today, 14)
  const e2 = addDays(today, 41)
  const s3 = addDays(today, 42)
  const e3 = addDays(today, 55)
  return {
    schema: 'promo_v1',
    goal_id: 'sample-goal',
    checks: [],
    phases: [
      {
        id: 'sample-warmup', name: '预热', start_date: s1, end_date: e1,
        steps: [{ id: 'sample-warmup-social', kind: 'social_cadence', settings: { posts_per_week: 3, stories_per_week: 2, reels_per_month: 2 } }],
      },
      {
        id: 'sample-main', name: '主推', start_date: s2, end_date: e2,
        steps: [
          { id: 'sample-main-ads', kind: 'ads_campaign', settings: { ad_account_id: 'sample-account', daily_budget_cents: 5000, audience_ref: 'sample-audience', creative_refs: ['sample-creative-1', 'sample-creative-2'], placements: [], paused_ranges: [] } },
          { id: 'sample-main-social', kind: 'social_cadence', settings: { posts_per_week: 4, stories_per_week: 3, reels_per_month: 4 } },
          { id: 'sample-main-blog', kind: 'blog_article', settings: { topic: '示例主题：产品亮点', primary_keyword: null, due_date: addDays(today, 20) } },
          { id: 'sample-main-news', kind: 'newsletter_email', settings: { topic: '示例主题：限时活动', due_date: addDays(today, 28), requires_link: true } },
        ],
      },
      {
        id: 'sample-wrapup', name: '收尾', start_date: s3, end_date: e3,
        steps: [
          { id: 'sample-wrapup-ads', kind: 'ads_campaign', settings: { ad_account_id: 'sample-account', daily_budget_cents: 2000, audience_ref: 'sample-audience', creative_refs: [], placements: [], paused_ranges: [] } },
          { id: 'sample-wrapup-social', kind: 'social_cadence', settings: { posts_per_week: 2, stories_per_week: 1, reels_per_month: 0 } },
        ],
      },
    ],
  }
}
