/**
 * Team Working Memory — 硬证据闸门
 *
 * PM 2026-08-02 拍板：教训和套路都**全自动入库**，不用他点。
 * 所以这里是全系统唯一的把关点，设计原则只有一条：
 *
 *     「Claude 说搞定了」永远不算证据。
 *
 * 只认机器能验证的四种信号（见 EvidenceKind）。一条候选教训凑不出任何一种，
 * 就地丢弃 —— 宁可漏，不可脏。因为脏教训会被之后每个窗口当真理读。
 */

import type { EvidenceKind } from './types'

export interface EvidenceInput {
  /** PM 当场纠正我的次数 */
  userCorrections: number
  /** 这次会话跑过测试且通过（tests_passed && !tests_failed） */
  testsPassed: boolean
  /** 本次会话产生的 commit，且已确认进了 main */
  mergedShas: string[]
  /** 同一现象在几个*独立*会话里出现过（含本次） */
  observedInSessions: number
}

export interface EvidenceVerdict {
  /** 通过闸门的证据类型，按可信度从高到低 */
  kinds: EvidenceKind[]
  /** 最强的那一种，落库用 */
  primary: EvidenceKind | null
  confidence: number
  /** 没过闸门时说明原因，写进日志方便回头看漏了什么 */
  rejectedReason?: string
}

/**
 * 各证据类型的基准可信度。
 * user_correction 最高 —— PM 亲口纠正过的事，没有比这更硬的。
 */
const BASE_CONFIDENCE: Record<EvidenceKind, number> = {
  user_correction: 0.95,
  merged: 0.85,
  tests_passed: 0.7,
  multi_session: 0.6,
}

/** multi_session 要几次才算数。1 次是巧合，2 次才是模式。 */
const MULTI_SESSION_THRESHOLD = 2

export function assessEvidence(input: EvidenceInput): EvidenceVerdict {
  const kinds: EvidenceKind[] = []

  if (input.userCorrections > 0) kinds.push('user_correction')
  if (input.mergedShas.length > 0) kinds.push('merged')
  if (input.testsPassed) kinds.push('tests_passed')
  if (input.observedInSessions >= MULTI_SESSION_THRESHOLD) kinds.push('multi_session')

  if (kinds.length === 0) {
    return {
      kinds: [],
      primary: null,
      confidence: 0,
      rejectedReason:
        '无硬证据：没有 PM 纠正、没有已合入的改动、没跑通测试、也没在多个会话里重现',
    }
  }

  const primary = kinds[0]
  // 多种证据叠加时小幅加成，但封顶 0.98 —— 不留 1.0，永远给推翻留余地
  const bonus = Math.min((kinds.length - 1) * 0.03, 0.09)
  const confidence = Math.min(BASE_CONFIDENCE[primary] + bonus, 0.98)

  return { kinds, primary, confidence }
}

/**
 * 允许**新建**教训的证据类型。
 *
 * multi_session 故意不在列：它的判据是「同一批文件在多个会话里被碰过」，
 * 那只是"在同一片区域干过活"，不是"同一个结论被印证过"。同一个文件改两次
 * 就凑够 2 次，门槛太低 —— 全自动入库下会漏进大量似是而非的东西。
 * 所以 multi_session 只用来给**已有**教训 +1 次确认，不能凭它开新条目。
 */
const KINDS_THAT_CAN_CREATE: EvidenceKind[] = ['user_correction', 'merged', 'tests_passed']

export function canCreateLesson(verdict: EvidenceVerdict): boolean {
  return verdict.kinds.some((k) => KINDS_THAT_CAN_CREATE.includes(k))
}

/** 被推翻几次就自动撤下。PM 不用点，机器自己收。 */
export const CONTRADICTION_RETIRE_THRESHOLD = 2

/** 套路连续砸锅几次自动下架 */
export const SKILL_FAIL_RETIRE_THRESHOLD = 2

/**
 * 套路里出现这些动作 = 花钱 / 对外可见 / 难撤回，
 * 自动置 requires_approval，执行时仍要 PM 显式 go。
 * 这条跟"套路自动上线"不矛盾：上线的是说明书，不是执行权。
 */
const APPROVAL_TRIGGER_PATTERNS: RegExp[] = [
  /gh\s+pr\s+merge/i,
  /git\s+push\s+.*(--force|-f\b)/i,
  /apply_migration|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+/i,
  /publish|发布|上线|投放|排期/i,
  /budget|spend|预算|充值|付费|扣费/i,
  /send.*(email|message|mail)|发邮件|群发|外呼/i,
  /delete|truncate|删除|清空/i,
]

/** 扫描套路步骤，判断是否需要 PM 执行时把关 */
export function requiresApproval(steps: { action: string }[]): boolean {
  return steps.some((s) => APPROVAL_TRIGGER_PATTERNS.some((re) => re.test(s.action)))
}
