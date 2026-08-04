/**
 * 官网表单 lead → 统一联系人 + 一条带来源的触点。
 *
 * WHY
 * ---
 * `leads` 表存的是**原始提交**（含 utm_source / utm_medium / utm_campaign），
 * 但它跟 contacts 之间原来没有任何桥 —— 一个从广告点进落地页、填了表的买家，
 * 在 CRM 里根本不存在，冷热分级看不到他，「哪条广告带来了成交」也断在这里。
 * 地产 listing 的落地页表单正是这条路（LP 建在客户自己域名，webhook 打回 ME）。
 *
 * 安全姿势（这是**公开无鉴权**端点的下游，按不可信输入对待）
 * -----------------------------------------------------------
 *   mergeStrategy='reject'      公开端点绝不允许触发「两个既有联系人合并成一个」。
 *                               合并不可逆：只要有人猜到某个老客户的邮箱、配上另一个
 *                               老客户的电话提交一次，两个真人的全部历史就永久搅在
 *                               一起。撞上就跳过，交给人看。
 *   overwriteDisplayName=false  不让匿名提交改掉已有客户的姓名。
 *   失败不抛                     lead 已经落库了，镜像失败绝不能让客户看到报错 ——
 *                               客户填完表单看到「提交失败」会直接走掉，代价远大于
 *                               晚一点补一条 contact。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { buildIdentities, resolveContact, AmbiguousIdentityError } from '@/lib/crm/identity'
import { attributionColumns, attributionFromUtm } from '@/lib/crm/attribution'

export interface WebFormLeadInput {
  clientId: string
  /** leads.id —— 当触点的幂等键，同一条 lead 重放不会写出第二条触点。 */
  leadId: string
  name: string | null
  phone: string | null
  email: string | null
  /** 客户在表单里写的话；进触点的 raw，销售能看原文。 */
  message?: string | null
  sourceUrl?: string | null
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  /** ISO；不传用当下。 */
  submittedAt?: string | null
  /** 这套房的 listings.id（listing 落地页才有）。 */
  listingId?: string | null
}

export interface WebFormLeadResult {
  contactId: string | null
  /** 没接上的原因，便于日志排查；接上了就是 null。 */
  skipped: 'no_identity' | 'ambiguous' | 'error' | null
}

/**
 * 把一条官网表单 lead 镜像成 contact + 触点。**永不抛异常** —— 调用方
 * （公开 lead 端点）已经把 lead 存好了，这里失败只记日志。
 */
export async function mirrorWebFormLead(input: WebFormLeadInput): Promise<WebFormLeadResult> {
  try {
    // 市场决定本地号码怎么补国码（NZ 客户 021… / AU 客户 04…）。
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('country, semrush_db')
      .eq('id', input.clientId)
      .maybeSingle()
    const defaultCountry: 'NZ' | 'AU' =
      client?.country === 'NZ' || client?.semrush_db === 'nz' ? 'NZ' : 'AU'

    const identities = buildIdentities({
      phone: input.phone,
      email: input.email,
      defaultCountry,
    })
    // 电话和邮箱都不成形 = 认不出是谁。不建人（否则 contacts 会被垃圾提交灌满）。
    if (identities.length === 0) return { contactId: null, skipped: 'no_identity' }

    const occurredAt = input.submittedAt ?? new Date().toISOString()
    const attribution = attributionFromUtm({
      utm_source: input.utmSource,
      utm_medium: input.utmMedium,
      utm_campaign: input.utmCampaign,
    })

    const { contactId } = await resolveContact({
      clientId: input.clientId,
      identities,
      displayName: input.name,
      source: 'web_form',
      seenAt: occurredAt,
      mergeStrategy: 'reject',
      overwriteDisplayName: false,
      attribution,
      listingId: input.listingId ?? null,
    })

    await supabaseAdmin.from('contact_touchpoints').upsert(
      {
        client_id: input.clientId,
        contact_id: contactId,
        channel: 'web_form',
        // 客户主动填的表 —— 方向是进来的。
        direction: 'inbound',
        occurred_at: occurredAt,
        summary: `官网表单${input.sourceUrl ? ` · ${input.sourceUrl}` : ''}`,
        raw: input.message ?? null,
        metadata: { lead_id: input.leadId, source_url: input.sourceUrl ?? null },
        ...attributionColumns(attribution),
        source: 'web_form',
        source_ref: input.leadId,
      },
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )

    return { contactId, skipped: null }
  } catch (err) {
    if (err instanceof AmbiguousIdentityError) {
      // 电话和邮箱分别属于两个已有客人。公开端点不许自动合并 —— 跳过，人来判断。
      console.error('[web-form-lead] 归属歧义，未接入 CRM:', input.leadId, err.contactIds)
      return { contactId: null, skipped: 'ambiguous' }
    }
    console.error('[web-form-lead] 镜像失败（lead 已存，主流程不受影响）:', input.leadId, err)
    return { contactId: null, skipped: 'error' }
  }
}
