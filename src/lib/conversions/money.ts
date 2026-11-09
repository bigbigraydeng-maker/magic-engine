/**
 * 币种小数位 —— **全仓唯一一份**（Issue #1397）。
 *
 * 为什么单独拎出来：2026-09-05 实测这张表被抄了 3 份（录入 / 发送 / 预览），
 * 而且行为**不一致** —— 录入层拒收不认识的币种，另外两处静默按 2 位算。
 * 后果：绕过录入的路径（补数据脚本、手工改库）里一笔日元会按 2 位处理，
 * 金额差 100 倍发给广告平台，而那撤不回。
 *
 * 规矩：**只列真实在用的币种，不认识的一律拒收，任何地方都不许给默认值。**
 * 要支持新币种，改这一个文件。
 */

const MINOR_UNITS: Record<string, number> = {
  NZD: 2,
  AUD: 2,
  USD: 2,
}

export const SUPPORTED_CURRENCIES = Object.keys(MINOR_UNITS)

/** 小数位。不认识的币种返回 null —— 调用方必须处理，不许当 2。 */
export function minorUnitsFor(currency: string): number | null {
  return MINOR_UNITS[currency.toUpperCase()] ?? null
}

/**
 * 主单位金额 → 最小单位整数。不认识的币种或非法金额返回 null。
 *
 * 实现走十进制字符串拼接，不是 `Math.round(amount * 10 ** exp)`。
 *
 * ⚠️ 说清楚一件事，免得后人被误导：**在本函数允许的输入范围内，两种写法结果一样**
 *    （2026-09-05 实测：两位小数、三百万以内逐个比对无差异，大额抽样也无差异）。
 *    浮点的经典反例 `1.005` 在这里根本走不到 —— 上面那道「小数位超出币种精度就拒收」
 *    的闸已经把它挡掉了。所以这里选字符串路线**不是**因为浮点会算错，
 *    而是因为它按构造就精确，不需要依赖"金额量级一直合理"这个前提。
 *
 *    代价是：没有任何测试能区分这两种实现。谁要是把它改成 `Math.round`，
 *    测试不会红 —— 那样改不算错，只是把"精确性"换成了"对量级的假设"。
 */
export function toMinorUnits(amount: number | string, currency: string): number | null {
  const exp = minorUnitsFor(currency)
  if (exp == null) return null

  const raw = typeof amount === 'number' ? amount.toString() : amount.trim()
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null

  const negative = raw.startsWith('-')
  const unsigned = negative ? raw.slice(1) : raw
  const [intPart, fracPart = ''] = unsigned.split('.')

  // 超出该币种精度的尾数拒收，不静默四舍五入 —— 静默改金额比报错难查得多。
  if (fracPart.length > exp && /[^0]/.test(fracPart.slice(exp))) return null

  const padded = (fracPart + '0'.repeat(exp)).slice(0, exp)
  const combined = `${intPart}${padded}`.replace(/^0+(?=\d)/, '')
  const value = Number(combined)

  if (!Number.isSafeInteger(value)) return null
  return negative ? -value : value
}

/**
 * 最小单位整数 → 主单位数字（发给广告平台用）。
 * 不认识的币种返回 null —— 宁可停下来，也不发一个可能差 100 倍的金额。
 */
export function toMajorUnits(amountMinor: number, currency: string): number | null {
  const exp = minorUnitsFor(currency)
  if (exp == null) return null
  return amountMinor / 10 ** exp
}

/** 给人看的金额，如 `NZD 23,500.00`。不认识的币种返回 null。 */
export function formatMoney(amountMinor: number | null, currency: string | null): string | null {
  if (amountMinor == null || !currency) return null
  const exp = minorUnitsFor(currency)
  if (exp == null) return null
  const major = amountMinor / 10 ** exp
  return `${currency.toUpperCase()} ${major.toLocaleString('en-NZ', {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  })}`
}
