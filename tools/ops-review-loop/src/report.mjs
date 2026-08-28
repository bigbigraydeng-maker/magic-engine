/**
 * PM-readable comment text for the two things this tool now decides on its
 * own: the risk rating and the delivery-readiness verdict. Each builder pairs
 * plain-language text with the matching hidden `me-dev-gate` marker
 * (`gate-marker.mjs`), so the same comment carries both what a human reads
 * and what the next run parses back out — never two separate comments that
 * could drift out of sync.
 *
 * Pure module: given the same input it renders the same text. No I/O.
 * `tests/report.test.ts` exercises it offline.
 */
import { buildGateMarker } from './gate-marker.mjs'

/**
 * The PR's automatic risk rating.
 *
 * @param {{risk: string, computedRisk: string, declaredRisk: string|null, readable: boolean, reasons: string[], base: string, head: string, secret?: string|null}} input
 * @returns {string}
 */
export function buildRatingComment({ risk, computedRisk, declaredRisk, readable, reasons, base, head, secret }) {
  const marker = buildGateMarker({ base, head, risk, reasons, secret })
  const lines = [
    `### 🚦 PR 风险自动定级：${risk}`,
    '',
    !readable ? '⚠️ 改动清单读不到或不完整 —— 按 A 处理，不许把「读不到」当成「没问题」。' : null,
    declaredRisk && declaredRisk !== computedRisk
      ? `PR 自报 ${declaredRisk} 级，diff 算出 ${computedRisk} 级 —— 取更高的一档：${risk}。`
      : `diff 算出 ${computedRisk} 级。`,
    '',
    '判定理由：',
    ...(reasons.length ? reasons.map((r) => `- ${r}`) : ['- （无）']),
    '',
    '此评级由 `tools/ops-review-loop/src/risk.mjs` 按改动文件确定性计算，不是任何 agent 的自我判断。head 一动，这条评级立即作废，下一次推送会重新计算。',
    '',
    marker,
  ].filter((line) => line !== null)
  return lines.join('\n')
}

const DECISION_TITLE = {
  READY_FOR_PRODUCT_OWNER: '### ✅ READY FOR PRODUCT OWNER',
  BLOCKED: '### ❌ BLOCKED',
  NEEDS_PRODUCT_DECISION: '### 🟡 NEEDS PRODUCT DECISION',
}

/**
 * The delivery-readiness verdict (`quality.mjs`'s `decideReadiness`).
 *
 * @param {{
 *   decision: 'READY_FOR_PRODUCT_OWNER'|'BLOCKED'|'NEEDS_PRODUCT_DECISION',
 *   risk: string,
 *   score: number,
 *   threshold: number,
 *   blockers: string[],
 *   base: string,
 *   head: string,
 *   gateReasons?: string[],
 *   secret?: string|null,
 * }} input
 * @returns {string}
 */
export function buildReadinessComment({
  decision,
  risk,
  score,
  threshold,
  blockers,
  base,
  head,
  gateReasons = [],
  secret,
}) {
  const marker = buildGateMarker({ base, head, risk, reasons: gateReasons, score, decision, secret })
  const title = DECISION_TITLE[decision] ?? `### ${decision}`
  const lines = [
    title,
    '',
    `风险级别 ${risk} · 质量分 ${score} / 门槛 ${threshold}`,
    '',
    blockers.length ? '未通过的硬门禁 / 缺项：' : '无阻塞项。',
    ...blockers.map((b) => `- ${b}`),
    '',
    '此自动化从不 merge、不部署、不调用生产或 provider —— 结论仅供人接手判断。',
    '',
    marker,
  ]
  return lines.join('\n')
}
