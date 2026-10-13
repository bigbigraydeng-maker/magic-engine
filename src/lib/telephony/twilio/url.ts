/** 还原 Twilio 签名用的公网根地址：优先用配置的固定地址；否则取转发头的第一个值（可能是逗号分隔的多值）。 */
export function resolvePublicBase(headers: { get(k: string): string | null }, fixed: string | undefined, fallbackHost: string): string {
  if (fixed && fixed.trim()) return fixed.trim().replace(/\/$/, '')
  const first = (v: string | null) => (v ? v.split(',')[0].trim() : '')
  const host = first(headers.get('x-forwarded-host')) || first(headers.get('host')) || fallbackHost
  const proto = first(headers.get('x-forwarded-proto')) || 'https'
  return `${proto}://${host}`
}
