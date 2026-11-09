/**
 * 客户身份信息的规范化 —— 写库时用，发送时的哈希（PR2 的 hasher）在这之上做。
 *
 * 为什么规范化必须在**写入**那一刻做、而不是发送时才做：
 *   `+64 21 555 1234` 和 `021 555 1234` 是同一个人。不在入口统一，
 *   opt-out 名单（存的是规范化后的哈希）就查不中 —— 客人说过"别拿我的信息",
 *   结果换个写法录进来又发出去了。
 *
 * 这里只做**跨平台通用**的规范化（Meta / Google Ads / TikTok 的要求一致：
 * 小写、去空白、电话用 E.164 纯数字）。任何 provider 特有的处理留在各自的 adapter 里。
 */

/** 邮箱：去首尾空白 + 全小写。空串视为「没有」。 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (v.length === 0) return null
  // 不做正则校验 —— 这里的职责是规范化，不是判定合法。
  // 真正的判定交给约束（至少要有一个匹配键）与人工审核那一闸。
  return v
}

/**
 * 电话：转成 E.164 的**纯数字**形式（不带 `+`，Meta/Google 都要这个形状）。
 *
 * `defaultCountry` 是客户所在国的拨号码（NZ='64'、AU='61'），来自 `clients.default_phone_country`。
 * 🔴 不许在代码里写死 '64' —— CTS 是 NZ，Oztop 有 AU 号码，写死等于把首个客户的
 *    国别硬编码成平台规则。拿不到国家码时，本地格式号一律返回 null（宁可少一个
 *    匹配键，也不要造一个错的 —— 错的哈希会匹配到别人）。
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry: string | null | undefined,
): string | null {
  if (!raw) return null

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  // 国际写法：+64… / 0064… → 直接取数字部分
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    return digits.length > 0 ? digits : null
  }

  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 0) return null

  if (digits.startsWith('00')) {
    const rest = digits.slice(2)
    return rest.length > 0 ? rest : null
  }

  const cc = (defaultCountry ?? '').replace(/\D/g, '')
  if (cc.length === 0) {
    // 不知道是哪个国家的号码，就不猜。
    return null
  }

  // 本地格式的前导 0 是国内长途前缀，转国际号时要去掉（021… → 6421…）
  const local = digits.startsWith('0') ? digits.slice(1) : digits

  // 已经带着本国国家码写的（6421…），不要再加一遍
  if (local.startsWith(cc)) return local

  return `${cc}${local}`
}

/** 姓名：去首尾空白 + 全小写。 */
export function normalizeName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  return v.length > 0 ? v : null
}
