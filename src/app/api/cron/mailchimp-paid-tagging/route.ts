/**
 * GET/POST /api/cron/mailchimp-paid-tagging
 *
 * 每天读一遍客户邮箱，把「钱到账了」的人在 Mailchimp 上打成 `paid_customer`，
 * 并摘掉他身上的线索标签 —— 于是他自动从群发名单里消失。
 *
 * ## 为什么要它（PM 2026-09-02 拍板「立即解决」）
 *
 * 在这之前这件事**完全没有自动化**：CTS 那 19 个 `paid_customer` 标签是 8/30
 * 有人翻邮箱手工打上去的，之后再没人打过。代价当天就付了 —— 9/1 那次 192 人的
 * 群发混进 2 个已付款客户，其中 Nikki Smith 是 Baker 亲口回过
 * 「your payment has been received in full」的人。
 *
 * ## 只自动做「我们自己确认过」的那一档
 *
 * 判据全在 `lib/mailchimp/paid-signal`，那里有一条必须守住的红线：这个邮箱里
 * **催款信和收款信长得几乎一样**（`Payment of Invoice` vs
 * `payment has been received`）。判错的代价不是脏数据，是把一个正在谈的客人
 * 标成已付款、停掉他全部跟进 —— 这单就丢了。
 *
 * 客人自己说付了 / 甩了张回单，一律不自动打，攒进 `summary.needsReview`，
 * 由 `pm-todo/manual-items` 下发成「今天该你动手」（铁律 3 下半：做不了的
 * 必须下发成人工任务，不许烂在日志里）。
 *
 * ## 补历史
 *
 * `?days=N` 指定回溯天数（默认 3 天增量）。补历史就是手动 POST 一次大的 N，
 * 跟每天对账**用的是同一套代码** —— 不为「补历史」单独写一次性脚本，那种脚本
 * 判据会跟线上漂移，而且没人测。
 *
 * 重跑是安全的：`applyMemberTags` 查到标签已经对了就 noop，不重复写。
 *
 * Auth:
 *   GET : Authorization: Bearer ${CRON_SECRET}     （Render 定时触发）
 *   POST: x-cron-secret: ${CRON_SECRET}            （手动补跑 / 补历史）
 *
 * ⚠️ 新 cron 必须在 Render 上 link `me-shared-cron-secret` 环境变量组，
 *    否则每天 401 静默失败（上一个踩这个坑的 cron 哑了 51 天）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { getValidTokenForConnection } from '@/lib/platform-oauth/token-manager'
import { fetchMailSince, type MailFolder, type MailMessage } from '@/lib/microsoft/mail-graph'
import { MICROSOFT_MAIL_PROVIDER } from '@/lib/microsoft/mail-oauth'
import { ownDomainsOf } from '@/lib/microsoft/mail-ingest'
import { CONNECTION_STATUS } from '@/lib/platform-oauth/vocabulary'
import {
  runPaidTagging,
  readPaidTag,
  REVIEW_CHECK_BUDGET_MS,
  type CandidateMail,
  type PaidTaggingPolicy,
} from '@/lib/mailchimp/paid-tagging'

// 补历史时要读几百封信 + 逐个查 Mailchimp，给足时间。
export const maxDuration = 600

const DEFAULT_LOOKBACK_DAYS = 3
const MAX_LOOKBACK_DAYS = 400

/**
 * 标签名从客户配置读 —— `paid_customer` / `fb_lead` 这些名字是某个客户的
 * Mailchimp 里长出来的，不是平台规则（平台化红线 2）。
 *
 * `leadTagsToRemove` **没配就是空数组**，绝不给默认值：给了默认就等于替所有
 * 客户决定「哪些标签算线索」，而那是每家都不一样的事。空数组的后果只是
 * 「只加不摘」，安全；给错默认的后果是摘掉别人有用的标签。
 */
function readPolicy(leadsConfig: unknown, ownDomains: readonly string[]): PaidTaggingPolicy {
  const cfg = (leadsConfig ?? {}) as {
    paid_tagging?: { lead_tags_to_remove?: unknown }
  }
  const raw = cfg.paid_tagging ?? {}
  // 🔴 标签名走 paid-tagging.ts 那一份，别在这里再解析一遍 —— 写入侧和今日待办
  //    的已处理过滤必须认同一个标签名，两份规则一漂移，过滤就永远不命中。
  const paidTag = readPaidTag(leadsConfig)
  const leadTagsToRemove = Array.isArray(raw.lead_tags_to_remove)
    ? raw.lead_tags_to_remove.filter((t): t is string => typeof t === 'string' && !!t.trim())
    : []
  return { paidTag, leadTagsToRemove, ownDomains }
}

function toCandidate(m: MailMessage): CandidateMail {
  return {
    id: m.id,
    subject: m.subject,
    preview: m.preview,
    receivedAt: m.receivedAt,
    direction: m.direction,
    counterparty: m.counterparty,
    hasAttachment: m.hasAttachment,
  }
}

interface ClientRow {
  id: string
  name: string | null
  /** ownDomainsOf 要用 —— 官网域名可能跟收信域名不同。 */
  domain: string | null
  leads_config: unknown
}

/**
 * 这个客户的 Mailchimp audience id。
 *
 * ⚠️ **不要直接 `select('mailchimp_audience_id')`** —— 那一列由
 * `20260826010000_mailchimp_audience_id.sql` 定义，但那条 migration 至今
 * **没有应用到生产**（文件头写明 Issue #1188 要求 migration_applied = false）。
 * 直接选它整条查询会 500：`column clients.mailchimp_audience_id does not exist`，
 * 于是这条 cron 每天失败而没有任何人知道为什么。
 *
 * 这不是假设 —— 2026-09-02 本地对生产库跑预演就是这么炸的。同一个坑现在还埋在
 * `crm/meta-lead.ts` 的 `syncMailchimp` 里：它选了这一列，所以在生产上每次都走
 * `client_config_read_failed` 分支，静默 skip。那正是 Mailchimp 里从来没出现过
 * `facebook_leadgen` 标签的原因之一。
 *
 * 所以这里从 `leads_config`（jsonb，一定存在）读，并在专列真的 apply 之后
 * 自动优先用它 —— 探测失败就当没有，不让一列的缺席拖垮整条管道。
 */
/** PostgREST 的 undefined_column。只有这一种错才该被当成「专列还没 apply」。 */
function isUndefinedColumn(err: { code?: string; message?: string }): boolean {
  return err.code === '42703' || /does not exist/i.test(err.message ?? '')
}

async function audienceIdsByClient(clientIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()

  // 专列：apply 过就用。**只吞「这一列不存在」这一种错**（PostgREST 42703）——
  // 早先写成 `if (!error)` 会把权限被回收、网络抖动、schema cache 没刷新全部
  // 静默降级，那正是这个仓库反复吃过的「空有三种来路」。
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, mailchimp_audience_id')
    .in('id', clientIds)
  if (error && !isUndefinedColumn(error)) throw new Error(`audience id 查询失败: ${error.message}`)
  if (!error) {
    for (const r of (data ?? []) as Array<{ id: string; mailchimp_audience_id: string | null }>) {
      const v = (r.mailchimp_audience_id ?? '').trim()
      out.set(r.id, v)
    }
  }
  return out
}

/** 设置页上填的「客户自己的邮件域名」（关联公司）—— 同 mailbox-sync 的读法。 */
function readOwnEmailDomains(leadsConfig: unknown): string[] {
  const cfg = (leadsConfig ?? {}) as { own_email_domains?: unknown }
  return Array.isArray(cfg.own_email_domains)
    ? cfg.own_email_domains.filter((d): d is string => typeof d === 'string' && !!d.trim())
    : []
}

/** leads_config.mailchimp_audience_id —— 专列没 apply 时的落脚点。 */
function audienceFromLeadsConfig(leadsConfig: unknown): string {
  const cfg = (leadsConfig ?? {}) as { mailchimp_audience_id?: unknown }
  return typeof cfg.mailchimp_audience_id === 'string' ? cfg.mailchimp_audience_id.trim() : ''
}

/**
 * 读一个邮箱的两个文件夹。一个读失败就整个邮箱失败 —— 只拿到一半会漏判。
 *
 * `truncated` 也按失败处理：`fetchMailSince` 按时间升序翻满 20 页就会截断，
 * 剩下的还是同一批最旧的信。如果这里把 `truncated: true` 当成功报告，重跑会
 * 一直卡在同一个 `since` 读同一批信，后面真正的收款确认永远轮不到 ——
 * 那就是「静默什么都没做」，还看起来一切正常。
 */
async function readMailbox(
  connectionId: string,
  since: Date,
): Promise<{ ok: true; mails: CandidateMail[]; truncated: boolean } | { ok: false; error: string }> {
  let token: string
  try {
    token = await getValidTokenForConnection(connectionId)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const folders: MailFolder[] = ['inbox', 'sentitems']
  const mails: CandidateMail[] = []
  let truncated = false
  for (const folder of folders) {
    const res = await fetchMailSince(token, folder, since)
    const folderName = folder === 'inbox' ? '收件箱' : '已发送'
    if (!res.ok) {
      return { ok: false, error: `读${folderName}失败: ${res.error}` }
    }
    if (res.truncated) {
      return {
        ok: false,
        error: `读${folderName}还没读完（信太多，翻到分页上限还有剩）—— 缩小 ?days 窗口分批补，避免漏判`,
      }
    }
    mails.push(...res.messages.map(toCandidate))
    // 🔴 必须接住：fetchMailSince 每个文件夹硬上限 1000 封，而且
    // `$orderby=receivedDateTime asc` —— 被丢掉的正是**最新**那些，也就是补历史
    // 最想抓的近期付款。丢掉这个标志，结果会报成 `ok, scanned: 1000` 而没有任何人
    // 能分辨「读全了」和「读了最旧的一部分」。
    truncated = truncated || res.truncated
  }
  return { ok: true, mails, truncated }
}

async function run(lookbackDays: number, dryRun: boolean): Promise<NextResponse> {
  const cronRun = await startCronRun('mailchimp-paid-tagging')

  const apiKey = process.env.MAILCHIMP_API_KEY
  if (!apiKey) {
    await cronRun.finish({ error: 'MAILCHIMP_API_KEY 没配' })
    return NextResponse.json({ error: 'MAILCHIMP_API_KEY 没配 —— 去 Render 环境变量加上' }, { status: 500 })
  }

  const { data: conns, error: connErr } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id, client_id, account_id')
    .eq('provider', MICROSOFT_MAIL_PROVIDER)
    .eq('status', CONNECTION_STATUS.ACTIVE)

  if (connErr) {
    await cronRun.finish({ error: connErr.message })
    return NextResponse.json({ error: connErr.message }, { status: 500 })
  }

  const connections = (conns ?? []) as Array<{ id: string; client_id: string; account_id: string }>
  if (connections.length === 0) {
    await cronRun.finish({ processed: 0, completed: 0, failed: 0, summary: { note: '还没有客户连邮箱' } })
    return NextResponse.json({ ok: true, mailboxes: 0, results: [] })
  }

  const { data: clients, error: cErr } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain, leads_config')
    .in('id', Array.from(new Set(connections.map((c) => c.client_id))))

  if (cErr) {
    await cronRun.finish({ error: cErr.message })
    return NextResponse.json({ error: cErr.message }, { status: 500 })
  }

  const byClient = new Map(((clients ?? []) as ClientRow[]).map((c) => [c.id, c]))
  const audienceIds = await audienceIdsByClient(Array.from(byClient.keys()))
  const since = new Date(Date.now() - lookbackDays * 86_400_000)

  const results: Array<Record<string, unknown>> = []
  const needsReview: Array<Record<string, unknown>> = []

  // 🔴 needs_review 反查 Mailchimp 的预算必须是整次运行共享一份，不能每个连接
  // 各领一份：下面按连接串行调用 `runPaidTagging`，连接一多，各自的 15 秒预算
  // 会累加到超过下面的 `maxDuration 600` / `render.yaml` 的 `curl --max-time
  // 620`（Codex P2 复审 PR #1484 round 3）。所以在循环外算一次共享截止时间，
  // 每次调用都传同一个值。
  const reviewCheckDeadline = Date.now() + REVIEW_CHECK_BUDGET_MS

  for (const conn of connections) {
    const client = byClient.get(conn.client_id)
    // 连接指向一个查不到的客户（删过客户但连接还在）—— 跳过，不为它报错。
    if (!client) continue

    const audienceId = audienceIds.get(client.id) ?? audienceFromLeadsConfig(client.leads_config)
    if (!audienceId) {
      // 空转也要留痕：「这个客户没配 Mailchimp」≠「跑了但没结果」。
      results.push({ client: client.name, mailbox: conn.account_id, skipped: 'no_audience_id' })
      continue
    }

    const read = await readMailbox(conn.id, since)
    if (!read.ok) {
      results.push({ client: client.name, mailbox: conn.account_id, error: read.error })
      continue
    }

    // 自有域名从客户配置算 —— 复用 mail-ingest 已有的那份（含设置页填的关联公司）
    const own = ownDomainsOf(
      conn.account_id,
      client.domain,
      readOwnEmailDomains(client.leads_config),
    )
    const policy = readPolicy(client.leads_config, own)
    const r = await runPaidTagging(read.mails, { apiKey, audienceId }, policy, {
      dryRun,
      reviewCheckDeadline,
    })

    for (const item of r.needsReview) {
      needsReview.push({ ...item, clientId: client.id, clientName: client.name, mailbox: conn.account_id })
    }

    results.push({
      client: client.name,
      mailbox: conn.account_id,
      scanned: r.scanned,
      // 读截断了 = 这次结果不完整，最新的信可能没读到。必须显式报出来。
      truncated: read.truncated,
      tagged: r.tagged.length,
      taggedDetail: r.tagged,
      needsReview: r.needsReview.length,
      notInAudience: r.notInAudience.length,
      chasing: r.chasing.length,
      errors: r.errors,
    })
  }

  // 🔴 每个客户条目里放的是 `errors`（复数，逐人错误），不是 `error`。首版只数
  // `error`，于是 300 次 Mailchimp 调用全挂、failed 依然是 0、status=completed
  // —— 监控一片绿而实际什么都没写成。读截断同理：结果不完整就不算成功。
  const failed = results.filter(
    (x) =>
      'error' in x ||
      (Array.isArray(x.errors) && x.errors.length > 0) ||
      x.truncated === true,
  ).length
  await cronRun.finish({
    processed: results.length,
    completed: results.length - failed,
    failed,
    // needsReview 放进 summary —— manual-items 从这里读，下发成「今天该你动手」。
    summary: { lookbackDays, dryRun, results, needsReview },
  })

  return NextResponse.json({ ok: true, lookbackDays, dryRun, results, needsReview })
}

/** `?days=N` —— 补历史用。夹在 1..400，防手滑打成 40000 把 Graph 拖死。 */
function lookbackFrom(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get('days'))
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LOOKBACK_DAYS
  return Math.min(Math.floor(raw), MAX_LOOKBACK_DAYS)
}

/**
 * `?dry=1` —— 只判定不写。补历史前先跑一次看会打谁。
 *
 * 默认 false：定时跑就是要真打标签，把预演设成默认会让这条 cron 天天空转，
 * 而且日志看起来完全正常 —— 正是这个仓库反复踩的那种「静默什么都没做」。
 */
function isDryRun(req: NextRequest): boolean {
  const raw = (req.nextUrl.searchParams.get('dry') ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run(lookbackFrom(req), isDryRun(req))
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run(lookbackFrom(req), isDryRun(req))
}
