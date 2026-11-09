/**
 * 广告级规则 · 统计工具（纯函数，无 I/O）。
 *
 * 只做两件事：对数 Gamma（避免大数溢出）与单侧 Fisher 精确检验下尾。
 * 用途：判断「近期成功率是否显著低于自身基线」，而不是靠固定阈值拍脑袋。
 */

/** Lanczos 近似系数（g=7, n=9），精度约 1e-12。 */
const LANCZOS_G = 7
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
] as const

/** Natural log of Gamma(x), x > 0. Lanczos approximation (g=7, n=9 coefficients), accurate to ~1e-12. */
export function lnGamma(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return Number.NaN
  // 反射公式处理 x < 0.5，保证主分支始终在收敛区间内。
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
  }
  const z = x - 1
  let series = LANCZOS_COEFFICIENTS[0]
  for (let i = 1; i < LANCZOS_COEFFICIENTS.length; i++) {
    series += LANCZOS_COEFFICIENTS[i] / (z + i)
  }
  const t = z + LANCZOS_G + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(series)
}

/** ln C(n, k). Returns -Infinity when k < 0 or k > n. n, k are non-negative integers. */
export function lnChoose(n: number, k: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(k)) return Number.NEGATIVE_INFINITY
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY
  if (k === 0 || k === n) return 0
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1)
}

/** 把输入收敛成合法整数计数，避免上游脏数据把组合数算炸。 */
function toCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  const rounded = Math.round(value)
  if (rounded < 0) return 0
  return rounded > max ? max : rounded
}

/**
 * One-sided Fisher exact test, lower tail: is the "recent" success rate LOWER than the "baseline" rate?
 * 2x2 table: recent = a successes out of n1 trials; baseline = b successes out of n2 trials.
 * Under H0 with margins fixed, X = recent successes ~ Hypergeometric(N = n1 + n2, K = a + b, draws = n1).
 * Returns P(X <= a) = sum over x from max(0, n1 - (N - K)) to a of C(K, x) * C(N - K, n1 - x) / C(N, n1).
 * Compute each term with lnChoose and exp; sum; clamp result to [0, 1].
 * Input hygiene: round all four inputs to integers; clamp a into [0, n1] and b into [0, n2].
 * Degenerate cases return 1: n1 === 0, n2 === 0, or K === 0.
 */
export function fisherLowerTailP(a: number, n1: number, b: number, n2: number): number {
  const trials1 = toCount(n1, Number.MAX_SAFE_INTEGER)
  const trials2 = toCount(n2, Number.MAX_SAFE_INTEGER)
  const successes1 = toCount(a, trials1)
  const successes2 = toCount(b, trials2)
  if (trials1 === 0 || trials2 === 0) return 1
  const total = trials1 + trials2
  const totalSuccesses = successes1 + successes2
  if (totalSuccesses === 0) return 1
  const denominator = lnChoose(total, trials1)
  if (!Number.isFinite(denominator)) return 1
  // 下尾从「近期成功数最少」开始，最多 successes1 + 1 次迭代（successes1 是点击/留资量级，很小）。
  const lowerBound = Math.max(0, trials1 - (total - totalSuccesses))
  let sum = 0
  for (let x = lowerBound; x <= successes1; x++) {
    const term = lnChoose(totalSuccesses, x) + lnChoose(total - totalSuccesses, trials1 - x) - denominator
    if (Number.isFinite(term)) sum += Math.exp(term)
  }
  if (!Number.isFinite(sum)) return 1
  return Math.min(1, Math.max(0, sum))
}
