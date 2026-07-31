/**
 * Meta 即时表单 lead → 统一联系人 + 一条带归因的触点。
 *
 * 跟 `src/lib/crm/web-form-lead.ts` 是同一类东西（渠道适配器），写法刻意保持一致：
 * 建人走 `resolveContact`，触点按 `(client_id, source, source_ref)` 幂等 upsert。
 *
 * 幂等键跟人手导入脚本**完全对齐**：两边的 `source_ref` 都是 Meta 的 lead id
 * （`scripts/import-cts-fb-leads.ts` 用 CSV 的 `id` 列，就是同一个值）。所以自动
 * 管道第一次回补时，7/26 已经手动导进去的 335 人不会被写成第二份。
 *
 * 合并策略用 'auto'（不是官网表单那个 'reject'），依据是 identity.ts 里已经写死的
 * 判断：「Meta 表单里的电话和邮箱天然来自同一次提交，是同一个人的两个身份，合并
 * 才对」。这条是渠道适配器的既定设计，人手导入脚本也是这么走的 —— 这里不另立规矩。
 *
 * 永不抛异常：一条脏 lead 不能弄停整批同步（防护 C）。失败如实计数并回报。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { buildIdentities, resolveContact } from '@/lib/crm/identity'
import { attributionColumns, attributionFromMetaLeadRow } from '@/lib/crm/attribution'
import type { MetaLead, MetaLeadAnswer } from '@/lib/meta/lead-forms'

/**
 * Meta 的标准字段名（表单里的「联系信息」那类问题）。除这些之外的都是客户自己
 * 加的自定义问题，原样存进 metadata.custom_answers。
 */
const STANDARD_FIELDS = new Set([
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone_number',
  'phone',
])

export interface ParsedLeadAnswers {
  name: string | null
  email: string | null
  phone: string | null
  /**
   * 「感兴趣的团」。**只认问题名里带 tour 的自定义问题** —— 不是「取第一个自定义
   * 答案」。CRM 横表那一列的表头写死是「感兴趣的团」（table-columns.ts），拿别的
   * 客户随便一个自定义问题去填，列名就成了假的。宁可空着。
   */
  tourInterest: string | null
  /** 全部自定义问答，原样保留，将来加列不用重跑历史。 */
  custom: Record<string, string>
}

/** 一次提交的问答 → 结构化字段。纯函数，不碰数据库。 */
export function parseLeadAnswers(answers: MetaLeadAnswer[]): ParsedLeadAnswers {
  const std = new Map<string, string>()
  const custom: Record<string, string> = {}

  for (const a of answers) {
    const key = a.name.trim().toLowerCase()
    const value = a.value.trim()
    if (!key || !value) continue
    if (STANDARD_FIELDS.has(key)) std.set(key, value)
    else custom[a.name.trim()] = value
  }

  const fullName = std.get('full_name')
  const composed = [std.get('first_name'), std.get('last_name')].filter(Boolean).join(' ').trim()

  let tourInterest: string | null = null
  for (const [question, value] of Object.entries(custom)) {
    if (/tour/i.test(question)) {
      tourInterest = value
      break
    }
  }

  return {
    name: fullName ?? (composed || null),
    email: std.get('email') ?? null,
    phone: std.get('phone_number') ?? std.get('phone') ?? null,
    tourInterest,
    custom,
  }
}

export interface IngestMetaLeadInput {
  clientId: string
  /** 本地号码补哪个国码。按客户市场传（NZ 021… / AU 04…）。 */
  defaultCountry: 'NZ' | 'AU'
  lead: MetaLead
}

export interface IngestMetaLeadResult {
  contactId: string | null
  /** true = 这条 lead 让系统里多了一个新人。 */
  createdContact: boolean
  /** 没接进来的原因；接进来了就是 null。 */
  skipped: 'no_identity' | 'error' | null
}

/**
 * 一条 Meta lead → contact + inbound 触点。
 *
 * 电话和邮箱都不成形就不建人 —— contacts 表被垃圾提交灌脏，比漏一条 lead 贵得多
 * （板桥的「护栏 · 一等公民」：只有真实触点才升级成客户）。
 */
export async function ingestMetaLead(input: IngestMetaLeadInput): Promise<IngestMetaLeadResult> {
  const { clientId, lead } = input

  try {
    const parsed = parseLeadAnswers(lead.answers)

    const identities = buildIdentities({
      phone: parsed.phone,
      email: parsed.email,
      defaultCountry: input.defaultCountry,
    })
    if (identities.length === 0) {
      return { contactId: null, createdContact: false, skipped: 'no_identity' }
    }

    // 这条记录来自 Meta lead 表单 → platform 一定是 'meta'（事实，不是猜的）。
    // ad / adset / campaign 有就写、没有就 null（自然贴文的表单本来就没有）。
    const attribution = attributionFromMetaLeadRow({
      ad_id: lead.adId,
      ad_name: lead.adName,
      adset_id: lead.adsetId,
      campaign_id: lead.campaignId,
      // creative id：Meta 的 lead 接口不给，只能由 ME 出片管道回填 → 一律 null。
      creative_ref: null,
    })

    const { contactId, created } = await resolveContact({
      clientId,
      identities,
      displayName: parsed.name,
      source: 'meta_lead_form',
      seenAt: lead.createdTime,
      attribution,
    })

    const { error } = await supabaseAdmin.from('contact_touchpoints').upsert(
      {
        client_id: clientId,
        contact_id: contactId,
        channel: 'meta_lead_form',
        // 客户自己填的表 —— 方向是进来的。
        direction: 'inbound',
        occurred_at: lead.createdTime,
        // 跟人手导入写出来的那 347 条保持同一句式，时间线上看不出两条管道。
        summary: `填了 Facebook 表单${parsed.tourInterest ? ` · ${parsed.tourInterest}` : ''}`,
        raw: null,
        metadata: {
          tour_interest_raw: parsed.tourInterest,
          ad_name: lead.adName,
          form_id: lead.formId,
          meta_platform: lead.platform,
          is_organic: lead.isOrganic,
          custom_answers: parsed.custom,
          ingested_by: 'meta-leads-sync',
        },
        // 触点也存一份归因：同一个人可能被两条不同的广告分别捞到过，只看 contacts
        // 上那份 first-touch 会让第二条广告的贡献永远看不见。
        ...attributionColumns(attribution),
        source: 'meta_lead_form',
        source_ref: lead.leadId,
      },
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )
    if (error) throw new Error(error.message)

    return { contactId, createdContact: created, skipped: null }
  } catch (err) {
    console.error(`[meta-lead] lead ${lead.leadId} 接入失败:`, err)
    return { contactId: null, createdContact: false, skipped: 'error' }
  }
}
