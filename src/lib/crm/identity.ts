/**
 * 「这是不是同一个人」—— 四个渠道共用的合并逻辑。
 *
 * 每个渠道给的身份都不一样：
 *   Meta 即时表单  电话 "p:+6421363598" + 邮箱
 *   官网表单       电话（已是 E.164）+ 邮箱
 *   邮件           邮箱
 *   Messenger      Facebook PSID（客户自己打字留下的电话/邮箱才有）
 *   外呼           电话
 *
 * 只认电话和邮箱，不认姓名。真实依据（CTS info@ 信箱 2026-07-26 实测）：
 * 一位客户邮箱 hemitekoha@hotmail.com、显示名 Chris Brown、正文自称
 * Christine、订的是儿子 Isaac Brown 的团。四个名字，一个人。
 *
 * 只在 Messenger 上聊过、从没留电话邮箱的人，就是合并不到任何人 —— 如实
 * 返回一个只带 fb_psid 的 contact，不假装跟谁是同一个（假装合上比合不上危险）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  firstTouchColumns,
  isAttributed,
  type Attribution,
} from '@/lib/crm/attribution'

export type IdentityKind = 'phone' | 'email' | 'fb_psid'

export interface Identity {
  kind: IdentityKind
  value: string
}

/**
 * 电话统一成 E.164，否则四个渠道永远对不上。
 *
 * 处理的真实脏数据：
 *   "p:+6421363598"  Meta 导出前缀
 *   "021 363 598"    人手打的本地格式
 *   "0064213 63598"  国际前缀写成 00
 *   "+64 21 363-598" 带空格和横杠
 *
 * defaultCountry 决定本地号码怎么补国码；CTS/Oztop 都在 NZ/AU，
 * 所以调用方按 clients 的市场传进来，不在这里写死。
 * 认不出来就返回 null —— 存一个错的号码比不存更糟，将来会打给陌生人。
 */
export function normalisePhone(raw: string | null | undefined, defaultCountry: 'NZ' | 'AU' = 'NZ'): string | null {
  if (!raw) return null

  // 去掉 Meta 的 "p:" 前缀和一切非数字/加号字符
  let s = String(raw).trim().replace(/^p:/i, '')
  s = s.replace(/[^\d+]/g, '')
  if (!s) return null

  // 00 开头是国际前缀的另一种写法
  if (s.startsWith('00')) s = `+${s.slice(2)}`

  const cc = defaultCountry === 'NZ' ? '64' : '61'

  if (s.startsWith('+')) {
    const digits = s.slice(1)
    // 国际号码至少 8 位、最多 15 位（E.164 上限）
    if (digits.length < 8 || digits.length > 15) return null
    return `+${digits}`
  }

  // 本地格式：0 开头去掉 0 再补国码
  if (s.startsWith('0')) {
    const digits = s.slice(1)
    if (digits.length < 7 || digits.length > 12) return null
    return `+${cc}${digits}`
  }

  // 已经带国码但没写加号
  if (s.startsWith(cc) && s.length >= 10) return `+${s}`

  // 剩下的认不出来。宁可不存，也不要存一个会打给陌生人的号码。
  return null
}

/** 邮箱去空格转小写。认不出来返回 null，不做花式清洗。 */
export function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim().toLowerCase()
  // 够用的判断：有 @、两边都有东西、域名带点。
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null
  return s
}

/**
 * 把一行原始渠道数据变成一组可用于合并的身份。
 * 顺序有意义：电话和邮箱能跨渠道合并，fb_psid 只在 Messenger 内有效。
 */
export function buildIdentities(input: {
  phone?: string | null
  email?: string | null
  fbPsid?: string | null
  defaultCountry?: 'NZ' | 'AU'
}): Identity[] {
  const out: Identity[] = []
  const phone = normalisePhone(input.phone, input.defaultCountry ?? 'NZ')
  if (phone) out.push({ kind: 'phone', value: phone })
  const email = normaliseEmail(input.email)
  if (email) out.push({ kind: 'email', value: email })
  if (input.fbPsid) out.push({ kind: 'fb_psid', value: String(input.fbPsid).trim() })
  return out
}

export interface ResolveInput {
  clientId: string
  identities: Identity[]
  displayName?: string | null
  /** 记录第一次是从哪个渠道看到这个人的。 */
  source?: string
  /** 这次接触的时间；用于维护 last_seen_at。 */
  seenAt?: string
  /**
   * 这批身份同时命中两个已存在的人时怎么办。
   *
   *   'auto'（默认）  合并成一个 —— 渠道适配器用这个。Meta 表单里的电话和
   *                  邮箱天然来自同一次提交，是同一个人的两个身份，合并才对。
   *   'reject'       不合并，抛 AmbiguousIdentityError 交给人判断 —— 手工
   *                  录入用这个。销售打字时电话打错一位、正好撞到另一个老客户，
   *                  自动合并会把两个真人的全部历史搅在一起，且不可逆。
   */
  mergeStrategy?: 'auto' | 'reject'
  /**
   * 命中已有联系人时，要不要用这次的 displayName 覆盖原名。
   *
   * 默认 true：渠道适配器拿到的名字来自客户自己填的表单，越新越准。
   * 手工录入传 false —— 打错电话撞到老客户时，不该把人家的名字改掉。
   */
  overwriteDisplayName?: boolean
  /**
   * 「他是哪条广告 / 哪条视频带来的」。
   *
   * first-touch 语义：新建的人直接写上；命中已有的人**只在原来是空的时候**回填，
   * 绝不覆盖（见下方写入处的注释）。渠道拿不到 ad 级归因就别传，留 NULL 是事实。
   */
  attribution?: Attribution
  /**
   * 这个人是哪套房带来的（listings.id）。
   *
   * 跟 attribution 同样是 first-touch：只在新建或原值为空时写。非地产客户不传。
   */
  listingId?: string | null
}

/** 一批身份指向了两个不同的既有联系人，且调用方要求人工判断。 */
export class AmbiguousIdentityError extends Error {
  constructor(public readonly contactIds: string[]) {
    super('这些联系方式分别属于两个已存在的客人')
    this.name = 'AmbiguousIdentityError'
  }
}

export interface ResolveResult {
  contactId: string
  /** true = 这次新建了一个人；false = 命中了已有的人。 */
  created: boolean
  /** 命中的身份数（0 表示全是新身份）。 */
  matchedIdentities: number
}

/**
 * 找到这个人，找不到就新建，并把这次带来的新身份挂上去。
 *
 * 幂等：同一批数据重跑不会产生重复的人，因为 contact_identities 上有
 * (client_id, kind, value) 唯一约束，命中即复用。
 *
 * 注意「合并冲突」：如果这次带来的两个身份分别指向两个已存在的人（例如
 * 之前电话建过一个、邮箱建过另一个，现在客户同时留了两样），我们选最早
 * 创建的那个作为主体，把另一批身份迁过去。不做自动删除 —— 合并是不可逆的，
 * 剩下那个空壳留着，由人来看。
 */
export async function resolveContact(input: ResolveInput): Promise<ResolveResult> {
  const { clientId, identities } = input
  if (identities.length === 0) {
    throw new Error('resolveContact 需要至少一个身份（电话 / 邮箱 / fb_psid）')
  }

  const seenAt = input.seenAt ?? new Date().toISOString()

  const { data: hits } = await supabaseAdmin
    .from('contact_identities')
    .select('contact_id, kind, value')
    .eq('client_id', clientId)
    .in('value', identities.map((i) => i.value))

  // 只认 kind 和 value 都对上的，避免电话号码恰好等于某个 fb_psid 的巧合。
  const matched = (hits ?? []).filter((h) =>
    identities.some((i) => i.kind === h.kind && i.value === h.value),
  )
  const contactIds = [...new Set(matched.map((m) => m.contact_id as string))]

  let contactId: string
  let created = false

  if (contactIds.length === 0) {
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert({
        client_id: clientId,
        display_name: input.displayName ?? null,
        primary_phone: identities.find((i) => i.kind === 'phone')?.value ?? null,
        primary_email: identities.find((i) => i.kind === 'email')?.value ?? null,
        first_seen_at: seenAt,
        last_seen_at: seenAt,
        // 新建的人：这次带来的归因就是 first-touch，直接写。
        ...(input.attribution ? firstTouchColumns(input.attribution, seenAt) : {}),
        ...(input.listingId ? { listing_id: input.listingId } : {}),
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`建 contact 失败: ${error?.message}`)
    contactId = data.id as string
    created = true
  } else {
    // 多个命中 = 之前被拆成了两个人，现在有证据说明是同一个。选最早的做主体。
    // 但「有证据」只对渠道适配器成立（同一次表单提交里的电话+邮箱）。手工录入
    // 传 mergeStrategy='reject'：打错一位数就撞上另一个人是常态，合并不可逆，
    // 必须交给人看一眼。
    if (contactIds.length > 1 && input.mergeStrategy === 'reject') {
      throw new AmbiguousIdentityError(contactIds)
    }
    if (contactIds.length > 1) {
      const { data: rows } = await supabaseAdmin
        .from('contacts')
        .select('id, created_at')
        .in('id', contactIds)
        .order('created_at', { ascending: true })
      contactId = ((rows ?? [])[0]?.id as string) ?? contactIds[0]
      const others = contactIds.filter((id) => id !== contactId)
      if (others.length > 0) {
        await supabaseAdmin
          .from('contact_identities')
          .update({ contact_id: contactId })
          .in('contact_id', others)
        await supabaseAdmin
          .from('contact_touchpoints')
          .update({ contact_id: contactId })
          .in('contact_id', others)
      }
    } else {
      contactId = contactIds[0]
    }

    // overwriteDisplayName=false 时不动原名 —— 手工录入撞到老客户，
    // 不该把人家的名字改成新客人的。
    const renameOk = input.overwriteDisplayName !== false
    await supabaseAdmin
      .from('contacts')
      .update({
        last_seen_at: seenAt,
        ...(input.displayName && renameOk ? { display_name: input.displayName } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId)

    // first-touch 回填：**只在原来是空的时候**写。
    //
    // 为什么加 .is('first_attributed_at', null) 而不是直接 update：
    // 一个人会被反复碰到（今天填了 A 房子的表单，下周又填 B 房子的）。不加这个
    // 条件就变成 last-touch，功劳会被最后那次覆盖 —— 真正带来他的那条广告永远
    // 拿不到分，学出来的结论是反的。这一条件放在 SQL 里而不是先读后判，是为了
    // 两个并发写入不会互相盖（Postgres 层面只会有一个赢）。
    if (input.attribution && isAttributed(input.attribution)) {
      await supabaseAdmin
        .from('contacts')
        .update(firstTouchColumns(input.attribution, seenAt))
        .eq('id', contactId)
        .is('first_attributed_at', null)
    }

    // 房子同理：只补空。已经归到某套房的人，不被后来的另一套房抢走。
    if (input.listingId) {
      await supabaseAdmin
        .from('contacts')
        .update({ listing_id: input.listingId })
        .eq('id', contactId)
        .is('listing_id', null)
    }
  }

  // 把这次带来的身份补齐。已存在的靠唯一约束忽略。
  const fresh = identities.filter(
    (i) => !matched.some((m) => m.kind === i.kind && m.value === i.value),
  )
  if (fresh.length > 0) {
    await supabaseAdmin.from('contact_identities').upsert(
      fresh.map((i) => ({
        contact_id: contactId,
        client_id: clientId,
        kind: i.kind,
        value: i.value,
        first_source: input.source ?? null,
      })),
      { onConflict: 'client_id,kind,value', ignoreDuplicates: true },
    )
  }

  return { contactId, created, matchedIdentities: matched.length }
}
