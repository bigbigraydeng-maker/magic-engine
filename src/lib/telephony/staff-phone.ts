/**
 * 员工自己登记「接电话的手机」—— 点击外呼先响这个手机，接起后才接通客人。
 * 登记表（extension_map）是「号码 → 员工邮箱」。纯函数，不碰数据库。
 */

import { normalisePhone } from '@/lib/crm/identity'

/** 新西兰手机号（+642x…）。只放行手机：固话/付费号段/国外号都不收，防止被拿去外呼高价号码。 */
const NZ_MOBILE = /^\+642[0-9]{7,9}$/

export type StaffPhoneResult =
  | { ok: true; phone: string; map: Record<string, string> }
  | { ok: false; error: string }

/** 库里读出来的登记表可能被人工改坏（null / 数字 / 数组）：只保留「字符串 → 字符串」的条目。 */
export function cleanExtensionMap(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

export function registerStaffPhone(
  current: Record<string, string>,
  email: string | null | undefined,
  rawPhone: string,
): StaffPhoneResult {
  const mail = (email ?? '').trim().toLowerCase()
  if (!mail) return { ok: false, error: '读不到你的登录邮箱，请重新登录' }
  const phone = normalisePhone(rawPhone, 'NZ')
  if (!phone || !NZ_MOBILE.test(phone)) return { ok: false, error: '请填新西兰手机号，例如 021 234 5678' }
  const owner = current[phone]
  if (owner && owner.trim().toLowerCase() !== mail) return { ok: false, error: '这个号码已经登记给别的同事了' }
  // 一个邮箱只留一个号码：先去掉旧的，再写新的（换手机号时不会留下两条）。
  const next: Record<string, string> = {}
  for (const [p, m] of Object.entries(current)) {
    if (m.trim().toLowerCase() !== mail) next[p] = m
  }
  next[phone] = mail
  return { ok: true, phone, map: next }
}
