/**
 * ME2 Product Map v1 —— M0–M5 成熟度推导（Issue #974「成熟度 M0–M5」一节）。
 *
 * 🔴 纯函数，唯一入口是 `deriveMaturity`。成熟度**只能算出来**，
 *    不接受任何「直接指定」的路径。
 *
 * 🔴 三态语义是这个文件的全部要点：
 *    - 某道信号 `no`  → 天花板确认停在前一级（`limitedBy: 'confirmed_absent'`）；
 *    - 某道信号 `unknown` → **`level` 只是下限，不是天花板**（`limitedBy: 'unknown'`）。
 *    把 `unknown` 当成 `no` 会把「还没查」画成「确定没有」，这正是 WP00 §2
 *    附加规则 1 禁止的那件事。
 *
 * 证据阶梯是累进的：任何一级证据不成立，就不看更高级信号是否为 `yes`。
 */

import type { Maturity, MaturityAssessment, MaturitySignals } from './types'

interface Rung {
  readonly level: Maturity
  /** 该级依赖的信号；`null` 表示无条件成立（M0）。 */
  readonly signals: readonly (keyof MaturitySignals)[]
}

/**
 * 六道阶梯，顺序即 Issue #974 的证据上限顺序：
 *   契约冻结 → 最高 M1；merge 到 main 且目标测试通过 → 最高 M2；
 *   没有真实集成证据 → 不得 M3；没有生产运行证据 → 不得 M4；
 *   没有「重复且可归因的 outcome」→ 不得 M5。
 */
const LADDER: readonly Rung[] = [
  { level: 'M0', signals: [] },
  { level: 'M1', signals: ['contractFrozen'] },
  { level: 'M2', signals: ['mergedToMain', 'targetedTestsPassing'] },
  { level: 'M3', signals: ['realIntegration'] },
  { level: 'M4', signals: ['productionRun'] },
  { level: 'M5', signals: ['repeatedAttributableOutcome'] },
]

export const MATURITY_ORDER: readonly Maturity[] = LADDER.map((rung) => rung.level)

/** 一道台阶的判定：全 `yes` 才算过；有 `no` 就是确认不过；否则是没查清。 */
function evaluateRung(
  rung: Rung,
  signals: MaturitySignals,
): { readonly verdict: 'pass' | 'absent' | 'unknown'; readonly blocking: keyof MaturitySignals | null } {
  let firstUnknown: keyof MaturitySignals | null = null
  for (const key of rung.signals) {
    const status = signals[key]
    // `no` 优先于 `unknown`：确认不存在是更强的结论，直接给出真天花板。
    if (status === 'no') return { verdict: 'absent', blocking: key }
    if (status === 'unknown' && firstUnknown === null) firstUnknown = key
  }
  if (firstUnknown !== null) return { verdict: 'unknown', blocking: firstUnknown }
  return { verdict: 'pass', blocking: null }
}

/**
 * 证据能撑住的成熟度。
 *
 * 返回的不是一个裸的 `Maturity` —— 调用方必须能区分「到顶了」和「没查清」，
 * 所以 `limitedBy` 是结果的一部分，不是可选的说明文字。
 */
export function deriveMaturity(signals: MaturitySignals): MaturityAssessment {
  let level: Maturity = 'M0'
  for (const rung of LADDER) {
    if (rung.signals.length === 0) {
      level = rung.level
      continue
    }
    const { verdict, blocking } = evaluateRung(rung, signals)
    if (verdict === 'pass') {
      level = rung.level
      continue
    }
    return {
      level,
      limitedBy: verdict === 'absent' ? 'confirmed_absent' : 'unknown',
      blockingSignal: blocking,
    }
  }
  return { level, limitedBy: null, blockingSignal: null }
}

/** `a` 是否严格高于 `b`（按阶梯顺序，不是字符串比较）。 */
export function isMaturityAbove(a: Maturity, b: Maturity): boolean {
  return MATURITY_ORDER.indexOf(a) > MATURITY_ORDER.indexOf(b)
}

/** 六道信号全 `unknown` —— 没有接上任何证据源时的诚实起点。 */
export const ALL_UNKNOWN_SIGNALS: MaturitySignals = Object.freeze({
  contractFrozen: 'unknown',
  mergedToMain: 'unknown',
  targetedTestsPassing: 'unknown',
  realIntegration: 'unknown',
  productionRun: 'unknown',
  repeatedAttributableOutcome: 'unknown',
})
