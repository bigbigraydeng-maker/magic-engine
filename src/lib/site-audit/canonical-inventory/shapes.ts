/**
 * Magic Engine 2.0 · 激活入参的结构闸（Issue #930 · #960）
 *
 * 🔴 这道闸必须跑在**任何解引用之前**。类型系统对一份 `JSON.parse` 的结果不提供任何保护：
 *    `candidates` 里塞一个 `null`，下一行 `.filter(c => c.machineDecision)` 就会直接抛，
 *    而这个模块对外承诺的是「一定返回一份审计」。抛出去 = 最需要账的时候交不出账。
 *
 * 只查「下面真的会去碰」的字段，不做全量 schema 校验 —— 查不到的字段出问题时
 * 后面的闸会以自己的方式响，多查一层只是给自己发明维护成本。
 */

import type { ActivationBlocker, MachineDecision } from './types'

/**
 * 机器决策的运行时白名单。
 *
 * 🔴 人工决策与原因码都有运行时清单（`decisions.ts`），机器决策原来没有 ——
 *    同一条道理缺了一半。手写一份带 `machineDecision: 'accepted'` 的 core 时，
 *    下游会把它当成「不是 pending 也不是 rejected」处理，虽然仍 fail-closed，
 *    但报出来的原因指向复核人漏判，而真正的毛病是这份 core 根本不是机器产的。
 */
const ALLOWED_MACHINE_DECISIONS: readonly MachineDecision[] = ['pending', 'rejected']

const SHAPE_CODE = 'plan_shape_invalid'

function bad(message: string): ActivationBlocker[] {
  return [{ code: SHAPE_CODE, message }]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 「按键索引的表」——数组不算。 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/** 一条机器候选必须长成对象，且后面真的会去解引用的字段类型都对。 */
export function isMachineCandidateShape(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.originalUrl === 'string' &&
    (typeof value.canonicalUrl === 'string' || value.canonicalUrl === null) &&
    ALLOWED_MACHINE_DECISIONS.includes(value.machineDecision as MachineDecision) &&
    Array.isArray(value.reasonCodes) &&
    Array.isArray(value.notes)
  )
}

function isDiscoveryShape(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.host === 'string' &&
    typeof value.count === 'number' &&
    typeof value.foreignCount === 'number' &&
    (typeof value.error === 'string' || value.error === null)
  )
}

/**
 * 激活入参的完整结构检查。
 *
 * 🔴 `mode` 也在这里查：**增量激活尚未设计**（防重放当前只靠首次激活的空库闸），
 *    所以 `mode !== 'first_activation'` 必须 fail closed，而不是走到某个默认分支。
 */
export function checkActivationShape(input: unknown): ActivationBlocker[] {
  if (!isRecord(input)) return bad('激活入参不是一个对象')
  if (input.mode !== 'first_activation') {
    return [
      {
        code: 'unsupported_activation_mode',
        message:
          `激活模式「${String(input.mode)}」不受支持，当前只有 first_activation。` +
          '增量激活要等「一次性消费持久化记录」落地后另行设计 —— 在那之前它必须 fail closed，' +
          '因为防重放现在完全靠首次激活的空库闸。',
      },
    ]
  }
  return [...checkEnvelopeShape(input.envelope), ...checkReviewShape(input.review)]
}

function checkEnvelopeShape(envelope: unknown): ActivationBlocker[] {
  if (!isRecord(envelope)) return bad('缺少生成信封（envelope），或者它不是对象')
  for (const key of ['envelopeVersion', 'keyId', 'planId', 'issuedAt', 'generationDigest', 'generationSignature']) {
    if (typeof envelope[key] !== 'string') return bad(`生成信封的 ${key} 不是字符串`)
  }
  return checkCoreShape(envelope.core)
}

function checkCoreShape(core: unknown): ActivationBlocker[] {
  if (!isRecord(core)) return bad('生成信封里没有计划核心（core）')
  for (const key of ['contractVersion', 'normalizationRuleVersion', 'clientId']) {
    if (typeof core[key] !== 'string') return bad(`计划核心的 ${key} 不是字符串`)
  }
  const boundaryProblem = checkBoundaryShape(core.boundary)
  if (boundaryProblem.length > 0) return boundaryProblem

  if (!Array.isArray(core.candidates)) return bad('计划的候选清单不是数组')
  const badCandidate = core.candidates.findIndex((c) => !isMachineCandidateShape(c))
  if (badCandidate >= 0) return bad(`第 ${badCandidate + 1} 条候选的结构不对（不是对象，或关键字段类型不对）`)

  if (!Array.isArray(core.discovery)) return bad('计划的逐主机发现记录不是数组')
  if (!core.discovery.every((d) => isDiscoveryShape(d))) return bad('逐主机发现记录里有结构不对的项')

  if (!isRecord(core.counts)) return bad('计划核心缺少 counts')
  for (const key of ['discovered', 'pending', 'rejected']) {
    if (typeof core.counts[key] !== 'number') return bad(`counts.${key} 不是数字`)
  }
  return []
}

function checkBoundaryShape(boundary: unknown): ActivationBlocker[] {
  if (!isRecord(boundary)) return bad('计划核心缺少主机边界（boundary）')
  if (typeof boundary.requestedDomain !== 'string' || !Array.isArray(boundary.approvedHosts)) {
    return bad('主机边界的 requestedDomain / approvedHosts 结构不对')
  }
  if (!boundary.approvedHosts.every((h) => typeof h === 'string')) return bad('批准主机清单里有非字符串项')
  return []
}

function checkReviewShape(review: unknown): ActivationBlocker[] {
  if (!isRecord(review)) return bad('缺少复核凭证（review），或者它不是对象')
  for (const key of ['envelopeVersion', 'keyId', 'reviewDigest', 'reviewAttestation']) {
    if (typeof review[key] !== 'string') return bad(`复核凭证的 ${key} 不是字符串`)
  }
  return checkSubmissionShape(review.submission)
}

function checkSubmissionShape(submission: unknown): ActivationBlocker[] {
  if (!isRecord(submission)) return bad('复核凭证里没有复核提交（submission）')
  for (const key of ['planId', 'generationDigest', 'reviewedBy', 'reviewedAt', 'reviewerIdentitySource']) {
    if (!isNonEmptyString(submission[key])) return bad(`复核提交的 ${key} 缺失或不是非空字符串`)
  }
  // 🔴 数组也是 object。`decisions: []` 会被当成「一条决策都没有」一路走下去，
  //    最后以「还有 pending 没判」收场 —— 结论没错，但报错指向的是复核人漏判，
  //    而真正的毛病是这份提交件的形状根本不对。两种病因必须分开报。
  if (!isPlainRecord(submission.decisions)) return bad('复核提交的 decisions 不是对象（数组也不行）')
  if (!isPlainRecord(submission.acknowledgements)) return bad('复核提交的 acknowledgements 不是对象（数组也不行）')
  return [...checkDecisionValues(submission.decisions), ...checkAcknowledgementValues(submission.acknowledgements)]
}

/**
 * 逐个查 `decisions` 的**值**。
 *
 * 🔴 只查容器是对象不够：`{"<url>": null}` 会让 `entry.decision` 直接抛裸 `TypeError`
 *    （没有 code、不是 `InventoryPlanError`），激活侧则落到 `plan_shape_unexpected` ——
 *    而那个 code 的契约含义是「结构闸有洞」。把已知形状报成未知形状，
 *    等于把「该去补闸」这条信号也一起丢了。
 */
function checkDecisionValues(decisions: Record<string, unknown>): ActivationBlocker[] {
  for (const [url, entry] of Object.entries(decisions)) {
    if (!isPlainRecord(entry)) return bad(`候选 ${url} 的决策不是对象`)
    if (typeof entry.decision !== 'string') return bad(`候选 ${url} 的 decision 不是字符串`)
    if (entry.reasonCodes !== undefined && !Array.isArray(entry.reasonCodes)) {
      return bad(`候选 ${url} 的 reasonCodes 不是数组`)
    }
  }
  return []
}

function checkAcknowledgementValues(acks: Record<string, unknown>): ActivationBlocker[] {
  for (const [host, ack] of Object.entries(acks)) {
    if (!isPlainRecord(ack)) return bad(`主机 ${host} 的认账不是对象`)
    if (typeof ack.acknowledgedBy !== 'string' || typeof ack.reason !== 'string') {
      return bad(`主机 ${host} 的认账缺 acknowledgedBy / reason，或者它们不是字符串`)
    }
  }
  return []
}
