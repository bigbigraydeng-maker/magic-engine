/**
 * 客户的 leads 模块配置 —— GET / PATCH。
 *
 * 四项：
 *   · 要不要把这个客户的邮件反应（谁打开了、谁点了链接）同步进 CRM
 *   · **客户自己的邮件域名** —— 同域来信是同事，不进客人名单
 *   · **同行 / 分销的域名** —— 是真业务，但跟进方式完全不同，单独分类
 *   · **网站表单来了新客资，发邮件通知谁** —— 客户自己的收件箱（而不是只进 ME 后台
 *     CRM，FDE 才看得到）。2026-08-19 补上：Park Homes 的合同白纸黑字写了「表单要
 *     把询盘发到 115parkhomes@gmail.com」，之前 /api/clients/[id]/leads 只落库，
 *     客户自己的邮箱收不到——落库了不等于客户知道。
 *
 * 后三项 2026-08-04 / 2026-08-19 补上界面（此前只能改数据库）。少了界面这条规则
 * 就是死的：以后新遇到一家同行，FDE 加不进去，只能来找开发 —— 而「要 FDE 填的
 * 字段必须连界面一起做完」是铁律，不是建议。
 *
 * Responses: 200 { config } / 400 / 401 / 403 / 404 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { parseAddressList, parseDomainList, readDomainRules } from '@/lib/crm/contact-kind'
import { parseEmailList } from '@/lib/leads/parse-email-list'
import { parsePhoneList, toPhoneCountry } from '@/lib/leads/parse-phone-list'
import { readOwnPhoneNumbers } from '@/lib/leads/own-phone-numbers'
import { readAudienceId, writeAudienceId } from '@/lib/mailchimp/audience-config'
import {
  applyCapiSettingsWrite,
  capiSettingsView,
  normalizeCapiSettingsWrite,
  type CapiSettingsView,
} from '@/lib/conversions/capi-client-config'

export interface LeadsConfig extends CapiSettingsView {
  /** 开了才会把邮件打开/点击同步进这个客户的 CRM。 */
  mailchimpEnabled: boolean
  /** 客户自己的邮件域名（可以有多个：主域名 + 关联公司）。 */
  ownEmailDomains: string[]
  /** 点名的员工地址（own_email_domains 里含 @ 的条目，只认这一个地址）。 */
  ownAddresses: string[]
  /** 同行 / 分销商的域名。 */
  tradeDomains: string[]
  /** 客户自己人（销售、老板）的手机号，E.164。用来在 WhatsApp 群里认出谁是自己人。 */
  ownPhoneNumbers: string[]
  /** 网站表单每来一条新客资，best-effort 邮件通知的收件人清单。 */
  notifyEmails: string[]
  /**
   * Meta 广告线索往哪个 Mailchimp 名单里送。空 = 不送（出口关闭）。
   *
   * 2026-09-06 补上界面。在此之前这个值只能改数据库 —— 而「Mailchimp 出口坏了」
   * 那条今日待办正是让 FDE「打开设置页确认 audience 配置」，点进去却什么都改不了，
   * 是条断头的管道。`undefined` = 这次没读（PATCH 的返回体不重读）。
   */
  mailchimpAudienceId?: string
}

function readConfig(raw: unknown): LeadsConfig {
  const o = (raw ?? {}) as Record<string, unknown>
  const rules = readDomainRules(o)
  const notifyEmails = Array.isArray(o.notify_emails)
    ? o.notify_emails.filter((x): x is string => typeof x === 'string')
    : []
  return {
    mailchimpEnabled: o.mailchimp_enabled === true,
    ownEmailDomains: rules.own,
    ownAddresses: rules.ownAddresses ?? [],
    tradeDomains: rules.trade,
    ownPhoneNumbers: readOwnPhoneNumbers(o),
    notifyEmails,
    ...capiSettingsView(o),
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '客户不存在' }, { status: 404 })

  // audience id 不直接从 leads_config 掏 —— 专列 apply 之后权威值在专列上，
  // 让 readAudienceId 去决定读哪边，界面才不会显示一个出口早就不看的旧值。
  const audience = await readAudienceId(clientId)
  if (!audience.ok) {
    return NextResponse.json({ error: `读 audience 配置失败: ${audience.message}` }, { status: 500 })
  }

  return NextResponse.json({
    config: { ...readConfig(data.leads_config), mailchimpAudienceId: audience.audienceId },
  })
}

interface PatchBody {
  mailchimpEnabled?: unknown
  mailchimpAudienceId?: unknown
  ownEmailDomains?: unknown
  ownAddresses?: unknown
  tradeDomains?: unknown
  ownPhoneNumbers?: unknown
  notifyEmails?: unknown
  capiAllowedEvents?: unknown
  capiDealMilestone?: unknown
  capiQualifiedLeadStageKey?: unknown
  capiDealStageKey?: unknown
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // 广告回传这几项先校验。填错就整次不写，避免名单存进去一半。
  const capiWrite = normalizeCapiSettingsWrite(body)
  if (capiWrite.touched && capiWrite.error) {
    return NextResponse.json({ error: capiWrite.error }, { status: 400 })
  }

  // 每一项都可以单独改 —— 三个面板各自保存，互不覆盖。
  const patch: Record<string, unknown> = {}
  /** 认不出来的原样带回去说清楚，绝不默默丢掉（丢掉 = 填的人以为标好了）。 */
  const rejected: string[] = []

  if (body.mailchimpEnabled !== undefined) {
    if (typeof body.mailchimpEnabled !== 'boolean') {
      return NextResponse.json({ error: 'mailchimpEnabled 必须是 true / false' }, { status: 400 })
    }
    patch.mailchimp_enabled = body.mailchimpEnabled
  }

  // own_email_domains 一个 jsonb 数组里住着两种条目：域名 和 点名的员工地址（含 @）。
  // 两个输入框各改各的，存的时候在下面合起来 —— 改域名绝不能把已存的员工地址丢掉。
  let ownDomainsPatch: string[] | undefined
  let ownAddressesPatch: string[] | undefined
  if (body.ownEmailDomains !== undefined) {
    const v = body.ownEmailDomains
    if (typeof v !== 'string' && !Array.isArray(v)) {
      return NextResponse.json({ error: 'ownEmailDomains 要么是一段文字，要么是一个清单' }, { status: 400 })
    }
    // 含 @ 的条目是精确地址，不许走 normaliseDomain 退化成整个域名。
    const pieces = (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : v.split(/[\n\r,;、，；]+/))
      .map((x) => x.trim())
      .filter(Boolean)
    const parsed = parseDomainList(pieces.filter((x) => !x.includes('@')))
    ownDomainsPatch = parsed.domains
    rejected.push(...parsed.rejected)
    const typedAddresses = parseAddressList(pieces.filter((x) => x.includes('@')))
    if (typedAddresses.addresses.length > 0) ownAddressesPatch = typedAddresses.addresses
    rejected.push(...typedAddresses.rejected)
  }
  if (body.ownAddresses !== undefined) {
    if (typeof body.ownAddresses !== 'string' && !Array.isArray(body.ownAddresses)) {
      return NextResponse.json({ error: 'ownAddresses 要么是一段文字，要么是一个清单' }, { status: 400 })
    }
    const parsed = parseAddressList(body.ownAddresses)
    ownAddressesPatch = parsed.addresses
    rejected.push(...parsed.rejected)
  }
  const hasOwnPatch = ownDomainsPatch !== undefined || ownAddressesPatch !== undefined
  const explicitAddresses = body.ownAddresses !== undefined

  for (const [field, column] of [
    ['tradeDomains', 'trade_domains'],
  ] as const) {
    const value = body[field]
    if (value === undefined) continue
    if (typeof value !== 'string' && !Array.isArray(value)) {
      return NextResponse.json({ error: `${field} 要么是一段文字，要么是一个清单` }, { status: 400 })
    }
    const parsed = parseDomainList(value)
    patch[column] = parsed.domains
    rejected.push(...parsed.rejected)
  }

  if (body.notifyEmails !== undefined) {
    if (typeof body.notifyEmails !== 'string' && !Array.isArray(body.notifyEmails)) {
      return NextResponse.json({ error: 'notifyEmails 要么是一段文字，要么是一个清单' }, { status: 400 })
    }
    const parsed = parseEmailList(body.notifyEmails)
    patch.notify_emails = parsed.emails
    rejected.push(...parsed.rejected)
  }

  if (body.ownPhoneNumbers !== undefined) {
    if (typeof body.ownPhoneNumbers !== 'string' && !Array.isArray(body.ownPhoneNumbers)) {
      return NextResponse.json({ error: 'ownPhoneNumbers 要么是一段文字，要么是一个清单' }, { status: 400 })
    }
    // 本地号码（021…）按这个客户的默认国家补国码；读不到就当 NZ。
    const { data: row, error: countryErr } = await supabaseAdmin
      .from('clients')
      .select('default_phone_country')
      .eq('id', clientId)
      .maybeSingle()
    if (countryErr) {
      return NextResponse.json({ error: `读客户默认国家失败: ${countryErr.message}` }, { status: 500 })
    }
    const parsed = parsePhoneList(body.ownPhoneNumbers, toPhoneCountry(row?.default_phone_country))
    // 手机号填错要当场退回、整项不存：这里不存在「存对的那几个」的折中，
    // 漏掉一个自己人 = 他在群里会被当成客人。
    if (parsed.rejected.length > 0) {
      return NextResponse.json(
        {
          error: `这几条看不出是手机号，整项没有保存：${parsed.rejected.join('、')}。请带国家码写完整（例如 +64 21 000 0000）`,
          rejected: parsed.rejected,
        },
        { status: 400 },
      )
    }
    patch.ownPhoneNumbers = parsed.phones
  }

  // audience id 单独走 —— 它不一定住在 leads_config 里（专列 apply 之后就在专列
  // 上），所以不能混进下面那次 jsonb 读-改-写，得让 writeAudienceId 决定写哪边。
  let audienceWritten: string | undefined
  if (body.mailchimpAudienceId !== undefined) {
    if (typeof body.mailchimpAudienceId !== 'string') {
      return NextResponse.json({ error: 'mailchimpAudienceId 必须是一段文字' }, { status: 400 })
    }
    const value = body.mailchimpAudienceId.trim()
    // Mailchimp 的 audience id 是 10 位十六进制。挡一下明显填错的（整段 URL、
    // 带空格的名字），省得出口每小时静默 404 而没人知道填错了。空串合法 = 关出口。
    if (value && !/^[0-9a-f]{6,20}$/i.test(value)) {
      return NextResponse.json(
        { error: 'audience id 看着不对：应该是一串字母数字（例如 dda97b7e61），不是名单名字或网址' },
        { status: 400 },
      )
    }
    const w = await writeAudienceId(clientId, value)
    if (!w.ok) {
      return NextResponse.json({ error: `保存 audience 失败: ${w.message}` }, { status: 500 })
    }
    audienceWritten = value
  }

  if (Object.keys(patch).length === 0 && !hasOwnPatch && !capiWrite.touched) {
    if (audienceWritten !== undefined) {
      // 只改了 audience —— 其余几项要**照实回读**再回给界面。
      // 拿 readConfig(null) 顶替会把「这次没读」变成「全都是关的」，界面照单
      // 全收就等于凭空把开关显示成关闭。这正是这条链路刚修完的那类坑。
      const { data: row, error: readErr } = await supabaseAdmin
        .from('clients')
        .select('leads_config')
        .eq('id', clientId)
        .maybeSingle()
      if (readErr) {
        return NextResponse.json({ error: `保存成功但回读失败: ${readErr.message}` }, { status: 500 })
      }
      return NextResponse.json({
        config: { ...readConfig(row?.leads_config), mailchimpAudienceId: audienceWritten },
        rejected: [],
      })
    }
    return NextResponse.json({ error: '没有要改的项' }, { status: 400 })
  }

  // 读-改-写：leads_config 里还有别的项，整块覆盖会把它们抹掉。
  const { data: cur } = await supabaseAdmin
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()

  const curConfig = (cur?.leads_config as Record<string, unknown> | null) ?? {}
  const merged: Record<string, unknown> = { ...curConfig, ...patch }
  if (hasOwnPatch) {
    const curRules = readDomainRules(curConfig)
    const domains = ownDomainsPatch ?? curRules.own
    const curAddresses = curRules.ownAddresses ?? []
    // 明确改地址框 → 以提交的为准；只改域名框 → 已存地址原样保留，域名框里顺手打的地址并进去。
    const addresses = explicitAddresses
      ? (ownAddressesPatch ?? [])
      : Array.from(new Set([...curAddresses, ...(ownAddressesPatch ?? [])]))
    merged.own_email_domains = [...domains, ...addresses]
  }
  const next = capiWrite.touched && !capiWrite.error ? applyCapiSettingsWrite(merged, capiWrite) : merged

  const { error: updErr } = await supabaseAdmin
    .from('clients')
    .update({ leads_config: next })
    .eq('id', clientId)

  if (updErr) {
    return NextResponse.json({ error: `保存失败: ${updErr.message}` }, { status: 500 })
  }

  return NextResponse.json({
    config: { ...readConfig(next), ...(audienceWritten !== undefined && { mailchimpAudienceId: audienceWritten }) },
    // 能存的都存了，认不出来的单独说 —— 不因为几条填错就整次拒绝，
    // 那会让人把已经填对的十条一起丢掉。
    rejected: Array.from(new Set(rejected)),
  })
}
