/**
 * Magic Engine 2.0 · 把人工决策盖到被签过的机器候选上（Issue #960）
 *
 * 🔴 候选本身**不可变**：它们待在被 L1 签名保护的 `core` 里，人只能对它们说
 *    「接受 / 拒绝 / 暂缓」。这个文件负责把两边合起来算出「每条候选最终算什么」，
 *    并把所有说不通的地方**逐条**报出来。
 *
 * 🔴 同一份判定被**两处**调用：`review.ts`（盖章前，说不通就抛）与
 *    `activation.ts`（激活前，说不通就变 blocker）。共用是为了防两边判据漂移；
 *    但两层各自独立生效 —— 拆掉任意一层，另一层仍然拦得住。
 */

import type {
  CandidateDecision,
  GeneratedPlanCore,
  HostAcknowledgement,
  MachineCandidate,
  RejectionReasonCode,
  ReviewDecisionEntry,
  ReviewerDecision,
} from './types'

/**
 * 人工决策的运行时白名单。
 *
 * 🔴 决策是从文件 / 界面反序列化进来的，TypeScript 的联合类型在运行时不拦任何东西。
 *    写进去一个 `'accept'`（少个 ed）会变成一个谁都不认识的状态：它不属于
 *    accepted / rejected / deferred 任何一个集合，也不算 pending —— 从每一份账里**消失**，
 *    而只要还有另一条合法的 accepted，整次激活会写完其余页面然后报「完成」。
 */
export const ALLOWED_REVIEWER_DECISIONS: readonly ReviewerDecision[] = ['accepted', 'rejected', 'defer']

/**
 * 人工原因码的运行时白名单。跟 `RejectionReasonCode` 手动保持同步 ——
 * 联合类型只在编译期挡人，反序列化进来的拼写错误 / 旧枚举值靠这份清单在运行时挡。
 */
export const ALLOWED_REASON_CODES: readonly RejectionReasonCode[] = [
  'malformed_url',
  'unsupported_scheme',
  'insecure_scheme',
  'credentials_present',
  'non_default_port',
  'host_not_approved',
  'duplicate_canonical_target',
  'reviewer_rejected',
  'reviewer_deferred',
]

export interface ResolvedCandidate {
  readonly candidate: MachineCandidate
  readonly decision: CandidateDecision
  readonly reasonCodes: readonly RejectionReasonCode[]
}

export interface DecisionProblem {
  readonly code: string
  readonly message: string
}

export interface DecisionResolution {
  readonly resolved: readonly ResolvedCandidate[]
  readonly problems: readonly DecisionProblem[]
}

/**
 * 把 `decisions` 盖到 `core.candidates` 上。
 *
 * 🔴 规则自动拒掉的候选**不许被人改成任何东西**。畸形 URL / 未批准主机 / 撞车目标
 *    不是「见仁见智」，允许人工覆盖就等于允许绕过主机边界。
 * 🔴 还是 `pending` 却没人判的候选**不许被当成「不要」** —— 漏判和拒绝是两件事。
 */
export function resolveDecisions(
  core: GeneratedPlanCore,
  decisions: Readonly<Record<string, ReviewDecisionEntry>>,
): DecisionResolution {
  const problems: DecisionProblem[] = []
  const table = decisions ?? {}
  const known = new Set(core.candidates.map((c) => c.originalUrl))
  for (const url of Object.keys(table)) {
    if (!known.has(url)) {
      problems.push({ code: 'unknown_candidate', message: `复核决策指向了计划里不存在的候选：${url}` })
    }
  }

  const resolved = core.candidates.map((candidate) => {
    const entry = table[candidate.originalUrl]
    if (candidate.machineDecision === 'rejected') {
      if (entry !== undefined) problems.push(autoRejectedProblem(candidate))
      return { candidate, decision: 'rejected' as const, reasonCodes: candidate.reasonCodes }
    }
    if (entry === undefined) {
      problems.push({
        code: 'unreviewed_candidate',
        message: `候选 ${candidate.originalUrl} 还没人判（pending）。没判过的不许当成「不要」。`,
      })
      return { candidate, decision: 'pending' as const, reasonCodes: candidate.reasonCodes }
    }
    const entryProblem = checkDecisionEntry(candidate, entry)
    if (entryProblem !== null) {
      problems.push(entryProblem)
      return { candidate, decision: 'pending' as const, reasonCodes: candidate.reasonCodes }
    }
    return { candidate, decision: entry.decision, reasonCodes: resolveReasonCodes(entry) }
  })

  return { resolved, problems }
}

function autoRejectedProblem(candidate: MachineCandidate): DecisionProblem {
  return {
    code: 'auto_rejected_not_overridable',
    message:
      `候选 ${candidate.originalUrl} 已被规则判为 rejected（${candidate.reasonCodes.join(',')}），` +
      '不接受人工覆盖 —— 主机边界与 URL 规则不是可商量的项',
  }
}

function checkDecisionEntry(candidate: MachineCandidate, entry: ReviewDecisionEntry): DecisionProblem | null {
  if (!ALLOWED_REVIEWER_DECISIONS.includes(entry.decision)) {
    return {
      code: 'invalid_decision',
      message:
        `候选 ${candidate.originalUrl} 的决策是「${String(entry.decision)}」，` +
        `只接受 ${ALLOWED_REVIEWER_DECISIONS.join(' / ')} —— 认不出来的值必须当场拒`,
    }
  }
  for (const code of entry.reasonCodes ?? []) {
    if (!ALLOWED_REASON_CODES.includes(code)) {
      return {
        code: 'invalid_reason_code',
        message:
          `原因码「${String(code)}」不认识，只接受 ${ALLOWED_REASON_CODES.join(' / ')} —— ` +
          '认不出来的值必须当场拒，不能带着凭证往下走',
      }
    }
  }
  return null
}

function resolveReasonCodes(entry: ReviewDecisionEntry): readonly RejectionReasonCode[] {
  if (entry.reasonCodes !== undefined) return entry.reasonCodes
  if (entry.decision === 'rejected') return ['reviewer_rejected']
  if (entry.decision === 'defer') return ['reviewer_deferred']
  return []
}

/**
 * 认账校验。
 *
 * 某个主机 0 条 / 出错时，**必须**有一条署名 + 写了理由的认账 ——
 * 0 条可能是站是空的，也可能是被 WAF 挡了，两者长得一模一样，只能由人来分。
 * 没人认过的不完整发现，凭证根本盖不出来（更谈不上激活）。
 */
export function resolveAcknowledgements(
  core: GeneratedPlanCore,
  acknowledgements: Readonly<Record<string, HostAcknowledgement>>,
): readonly DecisionProblem[] {
  const problems: DecisionProblem[] = []
  const table = acknowledgements ?? {}
  const hosts = new Set(core.discovery.map((d) => d.host.trim().toLowerCase()))
  for (const host of Object.keys(table)) {
    if (!hosts.has(host.trim().toLowerCase())) {
      problems.push({ code: 'unknown_acknowledged_host', message: `认账指向了计划里不存在的主机：${host}` })
    }
  }
  for (const row of core.discovery) {
    if (row.error === null && row.count > 0) continue
    const ack = table[row.host]
    const problem = checkAcknowledgement(row.host, row.error, row.count, ack)
    if (problem !== null) problems.push(problem)
  }
  return problems
}

function checkAcknowledgement(
  host: string,
  error: string | null,
  count: number,
  ack: HostAcknowledgement | undefined,
): DecisionProblem | null {
  const what = error !== null ? `出错（${error}）` : '结果为 0 条'
  if (ack === undefined) {
    return {
      code: 'incomplete_discovery_not_acknowledged',
      message:
        `主机 ${host} 发现${what}（count=${count}）。这可能是站是空的，也可能是被挡住了 —— ` +
        '必须有人署名认过才能继续，否则会产出一份缺了整个站的台账，而缺页没有人会发现。',
    }
  }
  if (typeof ack.acknowledgedBy !== 'string' || ack.acknowledgedBy.trim().length === 0) {
    return {
      code: 'acknowledgement_unsigned',
      message: `主机 ${host} 的认账没有署名 —— 没署名的「我知道了」等于没人认过`,
    }
  }
  if (typeof ack.reason !== 'string' || ack.reason.trim().length === 0) {
    return {
      code: 'acknowledgement_without_reason',
      message: `主机 ${host} 的认账没写理由 —— 审计要能看出人当时凭什么认为这个 0 条是正常的`,
    }
  }
  return null
}
