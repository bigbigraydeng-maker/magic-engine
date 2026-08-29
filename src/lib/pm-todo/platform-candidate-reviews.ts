/**
 * Review-due dates for docs/registry/platform-candidates.md rows.
 *
 * The markdown table is the single authoritative record of what a candidate
 * IS (owner, evidence, status, links) — this file is only the minimal mirror
 * needed to plug the monthly review into the existing pm-daily-todo cron
 * (already scheduled in render.yaml, runs NZ weekday mornings) instead of
 * leaving it as "当值 FDE 记得每月第一个周一" — a calendar SOP with nothing
 * in code that ever creates the task (CLAUDE.md 铁律 3: 遇卡点必自动化,
 * 管道不许断头).
 *
 * Whoever adds a row to the registry, or updates its 复查日 after a review,
 * MUST add/update the matching entry here in the SAME commit — otherwise the
 * reminder silently stops firing and the registry is back to relying on
 * memory. `me-platform-tier-gate` §默认降级·强制候选登记 references this file.
 */
export interface PlatformCandidateReview {
  /** Must match the 候选名 column in docs/registry/platform-candidates.md. */
  name: string
  /** YYYY-MM-DD, must match the 复查日 column. */
  reviewDate: string
}

export const PLATFORM_CANDIDATE_REGISTRY_URL =
  'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/registry/platform-candidates.md'

export const PLATFORM_CANDIDATE_REVIEWS: PlatformCandidateReview[] = [
  {
    // 必须与 docs/registry/platform-candidates.md 里的候选名完全一致
    name: '借助 Claude Design 生成品牌 VI 视觉资产（logo · 品牌手册 · 视觉规范）',
    reviewDate: '2026-09-27',
  },
  {
    name: 'Current-Sponsored Competitor Discovery（当前活跃广告主实时发现 + diff 竞品清单）',
    reviewDate: '2026-09-28',
  },
  {
    name: 'Paid Search Ads Discipline Playbook（6 子规则：Brand/Non-brand 分账 · Broad match 谨慎 · 主题化 ad group + Smart Bidding 学习期数学门槛 · Conv value 真实客单价 · Heritage 词并列本地经营年数 · Change History 是 audit 第一步）',
    reviewDate: '2026-10-29',
  },
]
