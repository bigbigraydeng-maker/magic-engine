/**
 * 把邮件反应搬进 CRM：谁收到了、谁打开了、谁点了链接。
 *
 * 目的只有一个 —— **让销售知道今天该打给谁**。一批邮件发出去，三分之一会打开、
 * 一成多会点链接（CTS 真实数据）。点了行程链接的人，比一个「打过没人接」的
 * 人热十倍，但在这之前系统完全看不见这件事。
 *
 * 写入约定（跟 CRM 页面线定好的契约）：
 *   · 邮件「事件」（收到 / 打开 / 点击）→ contact_touchpoints，一次事件一条
 *   · 邮件「正文往来」→ conversations + conversation_messages（不在本文件）
 *   不写「N 封邮件」这种摘要占位触点 —— 那正是私信踩过、刚拆掉的坑。
 *
 * 只认得出的人才写：靠邮箱找 contact，找不到就跳过并计数。
 * 绝不为一个只在 Mailchimp 里存在的邮箱凭空建联系人 —— 那会把 CRM 弄脏，
 * 而且这些人从没通过任何渠道联系过我们。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { normaliseEmail } from '@/lib/crm/identity'
import { fetchAll } from '@/lib/supabase-paginate'
import {
  listSentCampaigns,
  getCampaignActivity,
  type MailchimpCampaign,
  type MemberActivity,
} from './client'

export interface SyncResult {
  campaigns: number
  /** 真正写进去的触点数（同一封邮件的同一个人只会有一条）。 */
  recorded: number
  /** 已经同步过、这次跳过的。 */
  skipped: number
  /** 邮箱在 Mailchimp 里但 CRM 里没这个人 —— 不建人，如实报数。 */
  unmatched: number
  details: Array<{ campaign: string; recorded: number; unmatched: number }>
}

/** 一封邮件 + 一个人 = 一条触点。source_ref 用它，天然幂等、可重跑。 */
function sourceRef(campaignId: string, contactId: string): string {
  return `${campaignId}:${contactId}`
}

/**
 * 内部命名的垃圾值 —— 这些出现在时间线上等于没说。
 *
 * 真实案例（2026-08-02 PM 反馈）：CTS 有人在 Mailchimp 里复制了一封邮件没改名，
 * campaign 的 title 字面就是 " (copy 01)"，于是 160 条记录写成「打开了《 (copy 01)》」。
 * 它非空，所以旧的 `title || subject` 判断认为它有效。
 */
const JUNK_TITLE_RE = /^\s*(\(未命名\)|\(?\s*copy(\s*\d+)?\s*\)?|copy\s*of\b.*)\s*$/i

/** Mailchimp 的合并标记（*|FNAME|*）原样铺给销售看是噪音，去掉。 */
function stripMergeTags(raw: string): string {
  return raw.replace(/\*\|[^|]*\|\*/g, '').replace(/\s{2,}/g, ' ').trim()
}

/**
 * 这封邮件在时间线上叫什么。
 *
 * **主题优先于内部名**：主题是客户真正看到的那行字（「no visa needed for China」），
 * 内部名是运营自己的标签（「auto_e3_batch_20260716」）。销售读时间线时，前者一眼
 * 懂、后者什么都不是。两个都不可用才退回「一封邮件」—— 宁可不说，也不要把
 * 「(copy 01)」这种内部垃圾当成邮件名铺给人看。
 */
export function campaignLabel(campaign: { title?: string; subject?: string }): string {
  const candidates = [campaign.subject, campaign.title]
  for (const raw of candidates) {
    const cleaned = stripMergeTags(raw ?? '')
    if (cleaned && !JUNK_TITLE_RE.test(cleaned)) return cleaned
  }
  return '一封邮件'
}

/**
 * 一条人话摘要，销售在时间线上直接读。
 * 「点了链接」是最强信号，要排在最前面说。
 */
function summarise(campaign: MailchimpCampaign, act: MemberActivity): string {
  const name = campaignLabel(campaign)
  if (act.clicked) return `点了《${name}》里的链接`
  if (act.opened) return `打开了《${name}》`
  return `收到《${name}》`
}

export async function syncMailchimpActivity(opts: {
  clientId: string
  apiKey: string
  /** 只看这个时间之后发的邮件。不传默认近 90 天。 */
  sinceSentAt?: string
  /** 最多处理几封，防一次拉爆。 */
  maxCampaigns?: number
}): Promise<SyncResult> {
  const since =
    opts.sinceSentAt ?? new Date(Date.now() - 90 * 86_400_000).toISOString()

  const campaigns = (await listSentCampaigns(opts.apiKey, { sinceSentAt: since })).slice(
    0,
    opts.maxCampaigns ?? 50,
  )

  // 这个客户的全部邮箱 → contactId。分页拉全（1000 行硬顶那个坑）。
  const contacts = await fetchAll<{ id: string; primary_email: string | null }>((from, to) =>
    supabaseAdmin
      .from('contacts')
      .select('id, primary_email')
      .eq('client_id', opts.clientId)
      .order('id', { ascending: true })
      .range(from, to),
  )
  const byEmail = new Map<string, string>()
  for (const c of contacts) {
    const e = normaliseEmail(c.primary_email)
    if (e) byEmail.set(e, c.id)
  }

  // contact_identities 里还有一批邮箱（同一个人的第二个邮箱）。也认。
  const identities = await fetchAll<{ contact_id: string; value: string }>((from, to) =>
    supabaseAdmin
      .from('contact_identities')
      .select('contact_id, value')
      .eq('client_id', opts.clientId)
      .eq('kind', 'email')
      .order('id', { ascending: true })
      .range(from, to),
  )
  for (const i of identities) {
    const e = normaliseEmail(i.value)
    if (e && !byEmail.has(e)) byEmail.set(e, i.contact_id)
  }

  const result: SyncResult = {
    campaigns: campaigns.length,
    recorded: 0,
    skipped: 0,
    unmatched: 0,
    details: [],
  }

  for (const campaign of campaigns) {
    const activity = await getCampaignActivity(opts.apiKey, campaign.id)

    const rows: Array<Record<string, unknown>> = []
    let unmatched = 0

    for (const act of activity) {
      const contactId = byEmail.get(act.email)
      if (!contactId) {
        unmatched++
        continue
      }
      rows.push({
        client_id: opts.clientId,
        contact_id: contactId,
        channel: 'email',
        // 打开 / 点击是**客户的动作**，方向是进来的。
        direction: 'inbound',
        occurred_at: act.lastActionAt ?? campaign.sentAt ?? new Date().toISOString(),
        summary: summarise(campaign, act),
        metadata: {
          email_campaign_id: campaign.id,
          email_campaign_title: campaign.title,
          // 主题是客户真正看到的那行字 —— 存下来，将来要改显示口径不用重拉 Mailchimp。
          email_campaign_subject: campaign.subject,
          email_opened: act.opened,
          email_clicked: act.clicked,
        },
        source: 'mailchimp',
        source_ref: sourceRef(campaign.id, contactId),
      })
    }

    let recorded = 0
    if (rows.length > 0) {
      // 幂等：靠既有 UNIQUE(client_id, source, source_ref)。重跑不会重复写，
      // 也不会覆盖已有的那条（打开之后又点了，下面单独补一次）。
      const { data, error } = await supabaseAdmin
        .from('contact_touchpoints')
        .upsert(rows, { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true })
        .select('id')
      if (error) throw new Error(`写邮件触点失败: ${error.message}`)
      recorded = data?.length ?? 0

      // 已经写过、这次由「打开」升级成「点击」的人，要把摘要和标记更新掉 ——
      // 「点了链接」是最强的购买信号，停在「打开了」会让他排不到前面。
      const upgraded = rows.filter((r) => (r.metadata as { email_clicked?: boolean }).email_clicked)
      for (const r of upgraded) {
        await supabaseAdmin
          .from('contact_touchpoints')
          .update({ summary: r.summary, metadata: r.metadata, occurred_at: r.occurred_at })
          .eq('client_id', opts.clientId)
          .eq('source', 'mailchimp')
          .eq('source_ref', r.source_ref as string)
          .neq('metadata->>email_clicked', 'true')
      }
    }

    result.recorded += recorded
    result.skipped += rows.length - recorded
    result.unmatched += unmatched
    result.details.push({ campaign: campaign.title, recorded, unmatched })
  }

  return result
}
