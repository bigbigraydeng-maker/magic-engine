/**
 * 把邮件反应搬进 CRM：谁收到了、谁打开了、谁点了链接。
 *
 * 目的只有一个 —— **让销售知道今天该打给谁**。一批邮件发出去，三分之一会打开、
 * 一成多会点链接（CTS 真实数据）。点了链接的人，比一个「打过没人接」的
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
  getCampaignRecipients,
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
  /** 「发出」记录：写进去几条 / 认不出的收件人 / 失败的邮件数 / 因时间预算没做的邮件数。没开这个功能时恒为 0。 */
  sentRecorded: number
  sentUnmatched: number
  sentErrors: number
  sentSkippedBudget: number
}

/**
 * 「我们发出了这封邮件」的记录配置（`clients.leads_config.mailchimp_sent_record`）。
 *
 * 只记**标题以这些前缀开头**的邮件（欢迎信 / 自动信这类每人一封的），不是所有群发：
 * 一封几百人的新闻信一次写几百条，会把「全部客人」按最近一条往来的排序整体顶乱。
 * 缺省 = 不记。前缀是客户自己的命名习惯，写在客户配置里，不写进共享代码。
 */
export interface SentRecordConfig {
  titlePrefixes: string[]
}

export function readSentRecordConfig(leadsConfig: unknown): SentRecordConfig | null {
  const raw = ((leadsConfig ?? {}) as Record<string, unknown>).mailchimp_sent_record as
    | { title_prefixes?: unknown }
    | undefined
  const list = Array.isArray(raw?.title_prefixes)
    ? (raw!.title_prefixes as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []
  return list.length > 0 ? { titlePrefixes: list } : null
}

/** 「发出」记录读收件人的总时间预算：到点就停，剩下的邮件下一轮再做（整个同步上限 600 秒）。 */
const SENT_BUDGET_MS = 240_000
const SENT_BATCH = 500

/** 退信不能写成「已送达」。 */
function summariseSent(campaign: MailchimpCampaign, status: string): string {
  const name = campaignLabel(campaign)
  if (status === 'hard') return `《${name}》退回（地址无效）`
  if (status === 'soft') return `《${name}》暂时没送达`
  return `发出《${name}》`
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
  /** 要不要记「我们发出了这封邮件」。缺省 / null = 不记（保持原来只记打开、点击）。 */
  sentRecord?: SentRecordConfig | null
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
    sentRecorded: 0,
    sentUnmatched: 0,
    sentErrors: 0,
    sentSkippedBudget: 0,
  }
  /** 「发出」记录自己累计用掉的时间（不含打开 / 点击那部分）。 */
  let sentSpentMs = 0
  const batchId = new Date().toISOString()

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

    // 「发出」记录：**单独兜住错误**，它失败不能拖垮上面原有的打开 / 点击记录（原有逻辑已写完）。
    if (opts.sentRecord && opts.sentRecord.titlePrefixes.some((p) => campaign.title.startsWith(p))) {
      if (sentSpentMs > SENT_BUDGET_MS) {
        result.sentSkippedBudget++
      } else {
        const t0 = Date.now()
        const tally = { recorded: 0, unmatched: 0 }
        try {
          await recordSent(opts.clientId, opts.apiKey, campaign, byEmail, batchId, tally)
        } catch (err) {
          result.sentErrors++
          console.warn(`[mailchimp/sent-record] ${campaign.id} 失败：`, err instanceof Error ? err.message : err)
        } finally {
          result.sentRecorded += tally.recorded
          result.sentUnmatched += tally.unmatched
          sentSpentMs += Date.now() - t0
        }
      }
    }
  }

  return result
}

/** 一封邮件的收件人 → 每个已认出的客人一条「发出」出站触点。 */
async function recordSent(
  clientId: string,
  apiKey: string,
  campaign: MailchimpCampaign,
  byEmail: Map<string, string>,
  batchId: string,
  /** 已经写进去的条数、认不出的收件人数：中途某一批出错时，前面已写的也要如实计入回执。 */
  tally: { recorded: number; unmatched: number },
): Promise<void> {
  const recipients = await getCampaignRecipients(apiKey, campaign.id)
  const rows: Array<Record<string, unknown>> = []
  for (const r of recipients) {
    const contactId = byEmail.get(normaliseEmail(r.email) ?? r.email)
    if (!contactId) {
      tally.unmatched++
      continue
    }
    rows.push({
      client_id: clientId,
      contact_id: contactId,
      channel: 'email',
      // 我们发出去的，方向是出站；机器发的（`source='mailchimp'` 整类 + `automated`），不算「有人跟过他」。
      direction: 'outbound',
      // 没有每个人各自的发送时间，用整封邮件的发出时间。
      occurred_at: campaign.sentAt ?? new Date().toISOString(),
      summary: summariseSent(campaign, r.status),
      metadata: {
        kind: 'sent',
        automated: true,
        email_campaign_id: campaign.id,
        // 「近 7 天收过自动信」那类统计按这个内部名数（marketing-plan/generate）。
        email_campaign_title: campaign.title,
        email_campaign_subject: campaign.subject,
        email_send_status: r.status,
        // 以后要一键删掉某一次写入，靠它。
        ingest_batch: batchId,
      },
      source: 'mailchimp',
      // 与打开 / 点击那条（`<campaignId>:<contactId>`）互不冲突。
      source_ref: `${sourceRef(campaign.id, contactId)}:sent`,
    })
  }

  for (let i = 0; i < rows.length; i += SENT_BATCH) {
    const { data, error } = await supabaseAdmin
      .from('contact_touchpoints')
      .upsert(rows.slice(i, i + SENT_BATCH), { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error(`写发出记录失败: ${error.message}`)
    tally.recorded += data?.length ?? 0
  }
}
