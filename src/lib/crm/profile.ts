/**
 * 客人「档案」：名字 / 昵称 / 邮箱 / 电话 四个标准字段的读写。
 * 设计稿：docs/specs/2026-10-22-crm-contact-profile-design-v0.md（PM 2026-10-22：做好字段，以后有机会再完善）。
 *
 * 不加表、不加列：
 *   名字  = contacts.display_name（真名 / 销售确认的称呼；**不是**邮箱 / 电话 / 占位词，写入前过 cleanDisplayName）
 *   昵称  = 读自 conversations.participant_name（各渠道上客人自己的名字，只读）
 *   邮箱  = contact_identities(kind=email) + contacts.primary_email
 *   电话  = contact_identities(kind=phone) + contacts.primary_phone
 *
 * 所有读写按 client_id + contact_id 收口。数据库客户端由调用方注入，方便测试。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { cleanDisplayName } from '@/lib/crm/clean-display-name'
import { isSystemAccountName } from '@/lib/crm/contact-kind'
import { normaliseEmail, normalisePhone } from '@/lib/crm/identity'

export const MAX_NAME_LENGTH = 80
const MAX_NICKNAMES = 3
const UNIQUE_VIOLATION = '23505'

export interface ProfileView {
  contactId: string
  name: string | null
  nicknames: Array<{ channel: string; name: string }>
  emails: Array<{ value: string; primary: boolean }>
  phones: Array<{ value: string; primary: boolean }>
}

export type NameParse = { ok: true; value: string | null } | { ok: false; error: string }

// 控制字符 / 换行 / 零宽 / 双向控制符：不悄悄剥掉，直接拒绝（名字会进邮件、WhatsApp 回复、发给 Meta 的受众）。
const FORBIDDEN_CHARS = new RegExp(
  '[\\u0000-\\u001F\\u007F\\u00AD\\u034F\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFE00-\\uFE0F\\uFEFF\\uFFF9-\\uFFFB]',
)

/** 档案卡上改名字：空串 / null = 清空；其余必须是一个像样的名字。 */
export function parseProfileName(raw: unknown): NameParse {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: '名字必须是文字' }
  if (FORBIDDEN_CHARS.test(raw)) return { ok: false, error: '名字里不能有换行或看不见的控制字符' }
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (trimmed.length > MAX_NAME_LENGTH) return { ok: false, error: `名字最长 ${MAX_NAME_LENGTH} 个字` }
  if (isSystemAccountName(trimmed)) return { ok: false, error: '这是平台系统账号的名字，不能当客人的名字' }
  const cleaned = cleanDisplayName(trimmed)
  if (cleaned === null) return { ok: false, error: '名字不能是邮箱、电话或占位词（Unknown、N/A 之类），请填他的名字或昵称；不知道就留空' }
  return { ok: true, value: cleaned }
}

interface ContactRow {
  id: string
  display_name: string | null
  primary_email: string | null
  primary_phone: string | null
}

export async function loadProfile(db: SupabaseClient, clientId: string, contactId: string): Promise<ProfileView | null> {
  const { data: contact } = await db
    .from('contacts')
    .select('id, display_name, primary_email, primary_phone')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .maybeSingle()
  const c = contact as ContactRow | null
  if (!c) return null

  const [{ data: ids }, { data: convs }] = await Promise.all([
    db.from('contact_identities').select('kind, value').eq('contact_id', contactId).eq('client_id', clientId).in('kind', ['email', 'phone']),
    db.from('conversations').select('channel, participant_name').eq('contact_id', contactId).eq('client_id', clientId),
  ])
  const identities = (ids as Array<{ kind: string; value: string }> | null) ?? []
  const pick = (kind: 'email' | 'phone', primary: string | null): Array<{ value: string; primary: boolean }> => {
    const values = new Set<string>()
    if (primary) values.add(primary)
    for (const i of identities) if (i.kind === kind) values.add(i.value)
    return [...values].map((value) => ({ value, primary: value === primary }))
  }

  const name = cleanDisplayName(c.display_name)
  const seen = new Set<string>(name ? [name.toLowerCase()] : [])
  const nicknames: Array<{ channel: string; name: string }> = []
  for (const row of (convs as Array<{ channel: string; participant_name: string | null }> | null) ?? []) {
    const nick = cleanDisplayName(row.participant_name)
    if (!nick || seen.has(nick.toLowerCase())) continue
    seen.add(nick.toLowerCase())
    nicknames.push({ channel: row.channel, name: nick })
    if (nicknames.length >= MAX_NICKNAMES) break
  }

  return { contactId, name, nicknames, emails: pick('email', c.primary_email), phones: pick('phone', c.primary_phone) }
}

export async function setProfileName(db: SupabaseClient, clientId: string, contactId: string, name: string | null): Promise<'ok' | 'not_found' | 'error'> {
  // 双保险：调用方应该已经过 parseProfileName；这里再确认一次，写进去的永远是清洗过的名字。
  if (name !== null && cleanDisplayName(name) !== name) return 'error'
  const { data, error } = await db
    .from('contacts')
    .update({ display_name: name, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('client_id', clientId)
    .select('id')
  if (error) return 'error'
  return (data ?? []).length > 0 ? 'ok' : 'not_found'
}

export type AddIdentityResult =
  | { ok: true; added: boolean }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string; ownerContactId?: string }

/**
 * 给这个人加一个邮箱或电话。已经是他的 → 成功（幂等）；已经是**别的客人**的 → 409，不动
 * （说明库里有两个重复的人，合并另有设计，这里绝不自动合并）。
 */
export async function addProfileIdentity(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
  kind: 'email' | 'phone',
  raw: unknown,
  defaultCountry: 'NZ' | 'AU' = 'NZ',
): Promise<AddIdentityResult> {
  if (typeof raw !== 'string') return { ok: false, status: 400, error: kind === 'email' ? '邮箱必须是文字' : '电话必须是文字' }
  const value = kind === 'email' ? normaliseEmail(raw) : normalisePhone(raw, defaultCountry)
  if (!value) {
    return { ok: false, status: 400, error: kind === 'email' ? '这不是一个有效的邮箱地址' : '这个电话号码认不出来（本地号码请带区号，国际号码请以 + 开头）' }
  }

  const { data: contact } = await db.from('contacts').select('id, primary_email, primary_phone').eq('id', contactId).eq('client_id', clientId).maybeSingle()
  const c = contact as { id: string; primary_email: string | null; primary_phone: string | null } | null
  if (!c) return { ok: false, status: 404, error: '找不到这个客人' }

  const { data: owner } = await db.from('contact_identities').select('contact_id').eq('client_id', clientId).eq('kind', kind).eq('value', value).maybeSingle()
  const ownerId = (owner as { contact_id: string } | null)?.contact_id
  if (ownerId && ownerId !== contactId) {
    const { data: other } = await db.from('contacts').select('display_name').eq('id', ownerId).eq('client_id', clientId).maybeSingle()
    const who = cleanDisplayName((other as { display_name: string | null } | null)?.display_name) ?? '另一位客人'
    return { ok: false, status: 409, ownerContactId: ownerId, error: `这个${kind === 'email' ? '邮箱' : '电话'}已经属于「${who}」，说明库里有重复的客人。这里不能加（合并功能还没有做，需要联系开发处理）` }
  }

  // 🔴 身份表和主列可能不一致（主列有值、身份表没有那一行的脏数据，魏征 B1）：再查一遍 contacts 的主邮箱 / 主电话，
  // 已经是别的客人的主联系方式也不许加，否则同一个号码会挂到两个人名下，之后来电 / 来信归谁就不确定了。
  const primaryCol = kind === 'email' ? 'primary_email' : 'primary_phone'
  if (!ownerId) {
    const { data: holder } = await db.from('contacts').select('id, display_name').eq('client_id', clientId).eq(primaryCol, value).neq('id', contactId).limit(1)
    const other = (holder as Array<{ id: string; display_name: string | null }> | null)?.[0]
    if (other) {
      const who = cleanDisplayName(other.display_name) ?? '另一位客人'
      return { ok: false, status: 409, ownerContactId: other.id, error: `这个${kind === 'email' ? '邮箱' : '电话'}已经是「${who}」的主联系方式，说明库里有重复的客人。这里不能加（合并功能还没有做，需要联系开发处理）` }
    }
  }

  let added = false
  if (!ownerId) {
    const { error } = await db.from('contact_identities').insert({ contact_id: contactId, client_id: clientId, kind, value, first_source: 'profile_card' })
    if (error) {
      return error.code === UNIQUE_VIOLATION
        ? { ok: false, status: 409, error: '这个联系方式刚被别的客人占用了，请刷新后再看' }
        : { ok: false, status: 500, error: '保存失败，请稍后再试' }
    }
    added = true
  }

  // 他还没有主邮箱 / 主电话时，这一个就是主的（只补空，不改已有的主联系方式）。
  const current = kind === 'email' ? c.primary_email : c.primary_phone
  if (!current) {
    await db.from('contacts').update({ [primaryCol]: value }).eq('id', contactId).eq('client_id', clientId).is(primaryCol, null)
  }
  return { ok: true, added }
}
