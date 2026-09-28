/**
 * ME 产品动态自动发 LinkedIn 的人工待办（从 manual-items.ts 拆出，Round 1）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { LINKEDIN_PROGRESS_CLIENT_ID, LINKEDIN_PROGRESS_SOURCE } from '@/lib/linkedin-progress/constants'
import type { ManualItem } from './manual-item-types'

const LINKEDIN_CONTENT_BOARD_URL = `https://app.magicengine.com.au/dashboard/clients/${LINKEDIN_PROGRESS_CLIENT_ID}/content-factory`
const LINKEDIN_CONNECTORS_URL = `https://app.magicengine.com.au/dashboard/clients/${LINKEDIN_PROGRESS_CLIENT_ID}/connectors/publer`

/** A post stuck at 'approved' this long after creation means the publish call itself failed. */
const LINKEDIN_PUBLISH_FAILURE_STALE_HOURS = 2

/**
 * ME 产品动态自动发 LinkedIn（P24 新建）—— 三种"这条本该自动完成却没完成"的状态，
 * 全部要下发,不能只写进 cron_run_logs：
 *   1. 敏感内容命中硬过滤,转人审草稿(status='draft', reason='sensitive_content_flagged')
 *   2. LinkedIn 账号还没连(status='draft', reason='linkedin_account_not_configured')
 *   3. 账号已连但发布调用本身失败(status 卡在 'approved' 超过 2 小时)
 * 三种原因给不同的 how —— 同一句话应付三种原因,FDE/PM 会点错地方白跑一趟。
 *
 * "cron 该跑没跑"不在这里报 —— pushCronHealthItems 已经通过 CRON_REGISTRY
 * 通用覆盖了 linkedin-progress-post-mon/-thu 这两个 job，不用再单独登记。
 */
export async function pushLinkedinProgressItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  /**
   * 🔴 **必须读全，不能截断**（Codex P2 ×2, PR #1375）。
   *
   * 待办文案会明确说「有 N 条」，而且是**按类归堆**后再下发。任何 `.limit()`
   * 都在归类**之前**砍行：
   *   ① 会把「N 条」说成截断后的数（PM 清完以为清空、更旧的还卡着）；
   *   ② 更糟——若被砍掉的那批恰好是某一整类（比如最新一批全是敏感草稿，
   *      把更旧的「已发布但回写失败」整类挤出窗口），那一类会**完全不下发**，
   *      连"千万别重发"的红线告警都消失。
   * 所以走平台既有的 `fetchAll` 分页读全（这条线单客户、每周 ~2 条，天然有界；
   * fetchAll 到 10 万行硬顶会抛错而非静默给半份，正是我们要的 fail-loud）。
   */
  const rows = await fetchAll<{
    id: string
    status: string
    updated_at: string
    generation_context_snapshot: { reason?: string; publish_error?: string } | null
  }>((from, to) =>
    supabase
      .from('content_posts')
      .select('id, status, updated_at, generation_context_snapshot')
      .eq('client_id', LINKEDIN_PROGRESS_CLIENT_ID)
      .eq('source', LINKEDIN_PROGRESS_SOURCE)
      .in('status', ['draft', 'approved'])
      // range 必须配**全序** order，否则分页之间顺序不稳、会重复或漏行。
      // updated_at 有并列值，单靠它不是全序 —— 相同 updated_at 的行跨 1000 行
      // 页边界时相对位置不固定（Codex P2 #1375）。补 id 作唯一 tie-breaker。
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )

  /**
   * 🔴 **同一类卡点只出一条、带上条数 —— 绝不许一条草稿一行。**
   *
   * 这个函数原来对每一行 `push` 一条，而同一类里每条的 what/how/href **逐字相同**：
   * 三条待审草稿 = 今日待办里连着冒三行一模一样的「需要你看一眼」
   * （PM 2026-09-03 实测，见 fix 闭环那两张截图）。这正是
   * `pushDiagnosticItems` / `pushPrescriptionItems` 早就立下的那条纪律
   * ——「别把待办刷屏」——唯独这条线漏掉了。
   *
   * 所以先按类归堆再下发：一类一条，多于一条时把条数说出来，让 PM 知道有几条
   * 要处理，而不是被同一句话重复轰炸。单条时的文案逐字保留（那几句是多轮 review
   * 磨出来的，尤其"已发布但回写失败"那条的红线话术不能回退）。
   */
  const many = (n: number) => n > 1
  const countLabel = (n: number) => `${n}`

  let sensitiveReview = 0
  let needsSetup = 0
  let unknownDraft = 0
  let dbSyncFailed = 0
  const publishErrors: string[] = []

  for (const row of rows) {
    const reason = row.generation_context_snapshot?.reason

    if (row.status === 'draft') {
      if (reason === 'sensitive_content_flagged') sensitiveReview += 1
      else if (reason === 'linkedin_account_not_configured') needsSetup += 1
      // 草稿但 reason 不认识(未来 run.ts 加了新原因、或者字段意外为空)——
      // 兜底也要归一堆,不能让它悄悄消失在待办之外。
      else unknownDraft += 1
      continue
    }

    // 查询已用 .in('status', ['draft','approved']) 限定，走到这里只可能是 approved；
    // 显式再挡一道，别让将来放宽查询时把别的状态误当成「没发出去」。
    if (row.status !== 'approved') continue

    // approved：只有卡过 stale 阈值才算「没发出去」。
    // 用 updated_at 不用 created_at —— 一条被拦下转人审的草稿，PM 点"批准"那一刻
    // 只会刷新 updated_at，created_at 还是它被生成那天。按 created_at 算的话，
    // PM 前脚刚批准，下一次巡检马上就会误报"没能发出去"，而系统根本还没试着发。
    const updatedAt = Date.parse(row.updated_at)
    if (Number.isNaN(updatedAt)) continue
    const hoursAgo = (now.getTime() - updatedAt) / 3_600_000
    if (hoursAgo < LINKEDIN_PUBLISH_FAILURE_STALE_HOURS) continue

    // 这条其实已经真发到 LinkedIn 上了——只是发布成功后回写数据库那一步
    // 失败了，本地状态没跟上。绝不能套用"没能发出去"那套话术：那会
    // 引导人去重试/重新批准，而 Publer 那边已经真有一条了，重试 = 发出
    // 重复的公开帖子。这里只能是"帮我手动改一下状态"，不是"帮我重试"。
    if (reason === 'published_but_db_sync_failed') dbSyncFailed += 1
    else publishErrors.push(row.generation_context_snapshot?.publish_error ?? '')
  }

  if (sensitiveReview > 0) {
    const n = sensitiveReview
    items.push({
      kind: 'linkedin_progress_needs_review',
      client_id: LINKEDIN_PROGRESS_CLIENT_ID,
      client_name: 'ME 产品动态（LinkedIn）',
      what: many(n)
        ? `有 ${countLabel(n)} 条 LinkedIn 进度贴草稿可能带了客户敏感信息，系统都没敢自动发，等你看一眼`
        : '这周的 LinkedIn 进度贴草稿里可能带了客户敏感信息，系统没敢自动发，等你看一眼',
      how: many(n)
        ? '打开内容工厂看板，找到标题带「(needs review)」的这几条草稿，逐条读一遍确认没问题就批准发布；不想发就直接拒绝，下周照常自动生成新的'
        : '打开内容工厂看板，找到标题带「(needs review)」的那条草稿，读一遍确认没问题就批准发布；不想发就直接拒绝，下周照常自动生成新的',
      href: LINKEDIN_CONTENT_BOARD_URL,
    })
  }

  if (needsSetup > 0) {
    // 账号只需连一次，连好之后卡着的这几条都能发 —— 所以永远只出一条，
    // 但把还卡着的条数说清楚。
    const n = needsSetup
    items.push({
      kind: 'linkedin_progress_needs_setup',
      client_id: LINKEDIN_PROGRESS_CLIENT_ID,
      client_name: 'ME 产品动态（LinkedIn）',
      what: many(n)
        ? `LinkedIn 自动发帖这条已经在跑了，但你的 LinkedIn 账号还没连到发布工具，已经有 ${countLabel(n)} 条卡着没发出去`
        : 'LinkedIn 自动发帖这条已经在跑了，但你的 LinkedIn 账号还没连到发布工具，该发的这条卡着没发出去',
      // 账号连好之后这些草稿不会自己重新尝试发布——没有额外的重试 cron，
      // 得靠 PM 回内容工厂看板对每条草稿再点一次"确认"（那个按钮现在会
      // 真的调发布，不是走视频那套），不写清楚这一步就是永久卡死。
      how: many(n)
        ? '先去 Publer 后台用你自己的 LinkedIn 账号做一次性授权连接，连完之后打开这个链接，把出现的 LinkedIn 账号填进「Publer」这一项；填完再回内容工厂看板，把卡住的这几条草稿逐条点一次"确认"，它们就会真的发出去，不用等下一次自动跑'
        : '先去 Publer 后台用你自己的 LinkedIn 账号做一次性授权连接，连完之后打开这个链接，把出现的 LinkedIn 账号填进「Publer」这一项；填完再回内容工厂看板找到这条卡住的草稿，点一次"确认"，这条就会真的发出去，不用等下一次自动跑',
      href: LINKEDIN_CONNECTORS_URL,
    })
  }

  if (unknownDraft > 0) {
    const n = unknownDraft
    items.push({
      kind: 'linkedin_progress_needs_review',
      client_id: LINKEDIN_PROGRESS_CLIENT_ID,
      client_name: 'ME 产品动态（LinkedIn）',
      what: many(n)
        ? `有 ${countLabel(n)} 条 LinkedIn 进度贴草稿卡在待处理，系统没能说清具体原因`
        : '有一条 LinkedIn 进度贴草稿卡在待处理，系统没能说清具体原因',
      how: many(n)
        ? '打开内容工厂看板看一眼这几条草稿，逐条读一遍决定发不发'
        : '打开内容工厂看板看一眼这条草稿，读一遍决定发不发',
      href: LINKEDIN_CONTENT_BOARD_URL,
    })
  }

  if (dbSyncFailed > 0) {
    const n = dbSyncFailed
    items.push({
      kind: 'linkedin_progress_needs_review',
      client_id: LINKEDIN_PROGRESS_CLIENT_ID,
      client_name: 'ME 产品动态（LinkedIn）',
      what: many(n)
        ? `有 ${countLabel(n)} 条 LinkedIn 进度贴其实已经真的发出去了，只是系统记录状态没跟上——千万别在内容工厂看板里重新点"批准发布"，会发出重复的公开帖子`
        : '这条 LinkedIn 进度贴其实已经真的发出去了，只是系统记录状态没跟上——千万别在内容工厂看板里重新点"批准发布"，会发出重复的公开帖子',
      how: many(n)
        ? '回我一句，我去手动把这几条记录的状态改成"已发布"，不用你操作'
        : '回我一句，我去手动把这条记录的状态改成"已发布"，不用你操作',
      href: LINKEDIN_CONTENT_BOARD_URL,
    })
  }

  if (publishErrors.length > 0) {
    const n = publishErrors.length
    // 不同条的报错可能不一样 —— 去重后一起带上，别只印一条的原因。
    const distinct = Array.from(new Set(publishErrors.map((e) => e.trim()).filter(Boolean)))
    const errText = distinct.length > 0 ? `(系统报的原因: ${distinct.join('；')})` : ''
    items.push({
      kind: 'linkedin_progress_failed',
      client_id: LINKEDIN_PROGRESS_CLIENT_ID,
      client_name: 'ME 产品动态（LinkedIn）',
      what: many(n)
        ? `这周有 ${countLabel(n)} 条 LinkedIn 进度贴生成好了但没能发出去${errText}`
        : `这周的 LinkedIn 进度贴生成好了但没能发出去${errText}`,
      how: '打开 Publer 连接器设置页，看看 LinkedIn 账号是不是掉线了；账号看起来没问题的话，回我一句，我来查具体原因',
      href: LINKEDIN_CONNECTORS_URL,
    })
  }
}
