/**
 * 发信设置的写入：谁能改、请求怎么解析。
 * 设置（总开关、灰度名单、频次上限、禁用词、链接白名单）是「放宽对客外发刹车」的全局决定，
 * 只有全局管理员能改——判据照 auto-publish/revoke 的先例：exact ADMIN_EMAILS 且不是受限管理员。
 */

import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { parseEmailSettingsStrict } from './settings'
import type { EmailSettings } from './types'

export function canEditSettings(email: string | null | undefined, allowedClientId: string | null): boolean {
  return isGlobalAdminEmail(email ?? '') && allowedClientId === null
}

export type ParsedSettingsWrite =
  | { ok: true; settings: EmailSettings; baseVersion: number | null; changeNote: string | null; confirmUnrestricted: boolean }
  | { ok: false; error: string; errors: string[] }

const KEYS = new Set(['settings', 'baseVersion', 'changeNote', 'confirmUnrestricted'])
const MAX_NOTE = 300

const bad = (error: string, errors: string[] = []): ParsedSettingsWrite => ({ ok: false, error, errors })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** body = { settings: <存储格式>, baseVersion: 改的是哪一版（第一次设置传 null）, changeNote?, confirmUnrestricted? } */
export function parseSettingsWrite(raw: unknown): ParsedSettingsWrite {
  if (!isRecord(raw)) return bad('请求格式不对。')
  for (const key of Object.keys(raw)) {
    if (!KEYS.has(key)) return bad(`请求里有不认识的字段：${key.slice(0, 30)}。`)
  }
  const { baseVersion, changeNote, confirmUnrestricted } = raw
  if (baseVersion !== null && (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 1)) {
    return bad('要写明改的是哪一版（第一次设置写 null）。')
  }
  if (changeNote !== undefined && changeNote !== null && (typeof changeNote !== 'string' || changeNote.length > MAX_NOTE)) {
    return bad('变更说明不对（最多 300 字）。')
  }
  if (confirmUnrestricted !== undefined && typeof confirmUnrestricted !== 'boolean') return bad('确认字段不对。')
  const parsed = parseEmailSettingsStrict(raw.settings)
  if (!parsed.ok) return bad(`设置不合格：${parsed.errors.slice(0, 3).join('；')}`, parsed.errors)
  return {
    ok: true,
    settings: parsed.settings,
    baseVersion: baseVersion === undefined ? null : baseVersion,
    changeNote: typeof changeNote === 'string' ? changeNote : null,
    confirmUnrestricted: confirmUnrestricted === true,
  }
}

/** 开着功能又清空灰度名单 = 对所有客人放开。这一步必须是明确确认过的，不能是顺手保存。 */
export function unrestrictedNeedsConfirmation(settings: EmailSettings, confirmed: boolean): boolean {
  return settings.enabled && settings.recipientAllowlist === null && !confirmed
}
