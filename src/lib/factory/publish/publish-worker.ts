// P0.1 publish-worker 主体 — approved 成片 → 发到客户平台 + 三落库。
// 状态机:approved →(原子领取)→ publishing → published / publish_failed。
// 护栏(子牙 B8 + 魏征 B9):原子领取防双发 · 幂等对账防"发了没记上" · 防误发三断言 · 视频 URL 校验 ·
//   published_ref 硬事务(先落回执再三落库,三落库尽力而为可后补)。
// P0.1a 只实现 FacebookReelAdapter(Oztop);加 CTS = 多注册个 PublerAdapter,主体不改。

import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import type { PublishAdapter, PublishTarget, PublishedRef } from '../types'
import { scanRedlineHits } from '../worker-guard'
import { sanitizeFailReason } from './publish-display'
import { facebookReelAdapter } from './facebook-reel-adapter'
import { buildReelPublishedEvent } from './reel-published-event'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { REEL_AUTO_CHECK_KEYS, checklistPasses, humanKeysForStored, validateContentChecklist } from '@/lib/social/content-review'
import { buildReelFirstComment, buildReelPostCaption } from '@/lib/social/reel-publishing'

const MAX_PUBLISH_ATTEMPTS = 3
const RETRY_BACKOFF_MIN = 10 // 失败退避基数(分钟)· 指数

const ADAPTERS: Record<string, PublishAdapter> = {
  facebook: facebookReelAdapter,
  // publer: publerAdapter,  // P0.1b
}

interface PublishOptions {
  /** true=只发草稿(不公开)验格式;首次真发前默认 true,PM 显式 go 才 false */
  draft: boolean
  workerId: string
}

interface PublishOutcome {
  order_id: string
  result: 'published' | 'failed' | 'skipped_existing' | 'no_candidate'
  detail?: string
}

// ── 原子领取(防双发):status 守卫式条件 UPDATE,只有第一个能把 approved→publishing ──
async function claimOne(workerId: string): Promise<Record<string, unknown> | null> {
  const nowIso = new Date().toISOString()
  const { data: cand } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, status')
    .or(`status.eq.approved,and(status.eq.publish_failed,next_retry_at.lte.${nowIso})`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!cand) return null

  // 条件 UPDATE:WHERE status=<领取时看到的原状态> —— 并发下只有一个 UPDATE 命中(原子状态翻转)
  const { data: claimed } = await supabaseAdmin
    .from('content_work_orders')
    .update({
      status: 'publishing',
      publishing_started_at: nowIso,
      publish_claimed_by: workerId,
      updated_at: nowIso,
    })
    .eq('id', cand.id)
    .eq('status', cand.status) // 守卫:被别的实例抢走(status 已变)→ 0 行 → 本次落空
    .select('*')
    .maybeSingle()
  return claimed ?? null // null = 被抢/竞态,下轮再来
}

// ── 防误发三断言 + 视频 URL 校验 ──────────────────────────────────────────────
async function resolveTarget(clientId: string): Promise<PublishTarget | null> {
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('factory_config')
    .eq('id', clientId)
    .maybeSingle()
  const cfg = (client?.factory_config ?? {}) as Record<string, unknown>
  const raw = cfg['publish_target']
  if (!raw || typeof raw !== 'object') return null
  const t = raw as PublishTarget
  if (t.platform !== 'facebook' && t.platform !== 'publer') return null
  // 防误发(魏征 B9):带上客户真实品牌名,adapter 校验 FB 页名 ~ 此值。品牌名取权威源 master_briefs。
  if (!t.expect_brand) {
    const { data: mb } = await supabaseAdmin
      .from('master_briefs')
      .select('brand_name')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (mb?.brand_name) t.expect_brand = mb.brand_name as string
  }
  // adapter 靠 client_id 去取「连接 Meta」存下的页 token(配置里不存这个字段,这里补)
  t.client_id = clientId
  return t
}

/**
 * 发布正文红线闸(补 B10)。
 *
 * 为什么非补不可:交付时 complete-work-order 扫的是 `output.caption` + 分镜文字,
 * 而真正发到 Facebook 的正文是 buildCaption() 从 brief.copy.endcard 另拼的**另一串字**。
 * 这两串从来不是同一个东西 —— 审片界面显示「干净」,发出去的却是没被任何红线扫过的文案。
 * 红线写进库、审片界面标红都到位之后,这里是最后一处仍然裸奔的地方。
 *
 * fail-closed:查不到红线 ≠ 没有红线,查询出错一律当拦截处理(与 complete-work-order 同规矩)。
 * 返回 null = 放行;返回字符串 = 拦截原因。
 */
export async function scanPublishCaption(
  clientId: string,
  masterBriefId: unknown,
  caption: string,
): Promise<string | null> {
  const { data: client, error: cErr } = await supabaseAdmin
    .from('clients')
    .select('brand_redline_phrases')
    .eq('id', clientId)
    .maybeSingle()
  if (cErr || !client) return '红线查询失败,保守不发'

  let excluded: string[] = []
  if (typeof masterBriefId === 'string' && masterBriefId) {
    const { data: brief, error: bErr } = await supabaseAdmin
      .from('master_briefs')
      .select('excluded_topics')
      .eq('id', masterBriefId)
      .maybeSingle()
    if (bErr) return 'brief 查询失败,保守不发'
    excluded = (brief?.excluded_topics as string[] | null) ?? []
  }

  const hits = scanRedlineHits(
    [caption],
    (client.brand_redline_phrases as string[] | null) ?? [],
    excluded,
  )
  return hits.length > 0 ? `发布正文命中品牌红线: ${hits.join(' / ')}` : null
}

export async function validateVideoUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok) return `视频 URL 不可达 (${res.status})`
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.startsWith('video/')) return `视频 URL 非视频 (content-type=${ct})`
    const len = Number(res.headers.get('content-length') ?? '0')
    if (!(len > 0)) return '视频 URL content-length 为 0'
    return null
  } catch (e) {
    return `视频 URL HEAD 失败: ${e instanceof Error ? e.message : e}`
  }
}

export const PUBLIC_BASE = () =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/storage/v1/object/public/content-factory`

// ── 失败落库(退避重试 / terminal)───────────────────────────────────────────
async function markFailed(
  id: string,
  attempts: number,
  reason: string,
  /** true = 直接终态,不排重试。用于「重试也不会变好」的失败(如红线命中):
   *  退避重试只会每 10 分钟重扫一次同一串文案、每次都命中,白耗且刷屏。 */
  forceTerminal = false,
): Promise<void> {
  const terminal = forceTerminal || attempts + 1 >= MAX_PUBLISH_ATTEMPTS
  const backoffMin = RETRY_BACKOFF_MIN * Math.pow(2, attempts)
  await supabaseAdmin
    .from('content_work_orders')
    .update({
      status: 'publish_failed',
      reject_reason: sanitizeFailReason(reason), // PM sees why on the dashboard; token-free
      publish_attempts: attempts + 1,
      // terminal:next_retry_at 置空 = 不再自动重试,等 PM 决策;否则退避后重试
      next_retry_at: terminal ? null : new Date(Date.now() + backoffMin * 60_000).toISOString(),
      publishing_started_at: null, // 魏征 B9:清租约锚,重领时刷新,防 sweeper 误判"刚重领"为超时
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  console.error(`[publish-worker] ${id} failed (attempt ${attempts + 1}${terminal ? ',terminal' : ''}): ${sanitizeFailReason(reason)}`)
}

// ── 处理一条 ──────────────────────────────────────────────────────────────────
async function processOne(wo: Record<string, unknown>, opts: PublishOptions): Promise<PublishOutcome> {
  const id = String(wo['id'])
  const clientId = String(wo['client_id'])
  const attempts = Number(wo['publish_attempts'] ?? 0)
  const brief = (wo['brief'] ?? {}) as Record<string, unknown>
  const output = (wo['output'] ?? {}) as Record<string, unknown>

  // Re-check the approval receipt at the last server boundary before any
  // provider lookup/upload. This also quarantines legacy `approved` rows that
  // predate structured review checklists.
  const reviewRef = (wo['review_ref'] ?? {}) as Record<string, unknown>
  const humanChecklist = validateContentChecklist(reviewRef['checklist_human'], humanKeysForStored(reviewRef['checklist_human']), 'HUMAN')
  const autoChecklist = validateContentChecklist(output['quality_checklist_auto'], REEL_AUTO_CHECK_KEYS, 'AUTO')
  if (!humanChecklist.ok || !autoChecklist.ok || !checklistPasses(humanChecklist.items) || !checklistPasses(autoChecklist.items)) {
    await markFailed(id, attempts, 'approval checklist missing, incomplete, failed, or not measured', true)
    return { order_id: id, result: 'failed', detail: 'approval_checklist_incomplete' }
  }

  const target = await resolveTarget(clientId)
  if (!target) {
    await markFailed(id, attempts, '未配置 publish_target(缺配置绝不猜/误发)')
    return { order_id: id, result: 'failed', detail: 'no_publish_target' }
  }
  const adapter = ADAPTERS[target.platform]
  if (!adapter) {
    await markFailed(id, attempts, `平台 ${target.platform} 适配器未实现(P0.1a 只 facebook)`)
    return { order_id: id, result: 'failed', detail: 'no_adapter' }
  }

  // 本地幂等锚(魏征 B9 防双发):本工单之前已 start 过(published_ref.provisional + video_id)→ 说明上次
  // 发到一半崩了。**绝不盲目重发**:先对账,确认已发→补记;确认不了→ terminal 标失败推人工核对,宁可不发不双发。
  const priorRef = (wo['published_ref'] ?? null) as Record<string, unknown> | null
  const angleOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const label = angleOf(brief['angle']) || angleOf(wo['angle']) || target.expect_brand || 'Reel'
  const copy = (brief['copy'] ?? {}) as Record<string, unknown>
  const endcard = (copy['endcard'] ?? {}) as Record<string, unknown>
  const firstComment = buildReelFirstComment(endcard, id)
  if (!firstComment) {
    await markFailed(id, attempts, '首评 CTA 或 HTTPS 追踪链接无效', true)
    return { order_id: id, result: 'failed', detail: 'invalid_first_comment' }
  }
  const caption = buildReelPostCaption(copy)
  // Check both strings before an idempotency recovery can add the first comment
  // to a Reel that was already started in a previous attempt.
  const redlineErr = await scanPublishCaption(clientId, wo['master_brief_id'], `${caption}\n${firstComment.text}`)
  if (redlineErr) {
    await markFailed(id, attempts, redlineErr, true)
    return { order_id: id, result: 'failed', detail: 'redline_hit' }
  }

  if (priorRef && priorRef['provisional'] === true && priorRef['video_id']) {
    const recovered = await adapter.findExisting({ target, idempotencyTag: id }).catch(() => null)
    if (recovered) {
      if (!opts.draft && adapter.ensureFirstComment && !recovered.first_comment_id) {
        recovered.first_comment_id = await adapter.ensureFirstComment({
          target, videoId: String(recovered.video_id ?? priorRef['video_id']), idempotencyTag: id, message: firstComment.text,
        })
      }
      await recordPublished(id, recovered, clientId, label)
      return { order_id: id, result: 'skipped_existing', detail: 'recovered_after_interrupt' }
    }
    await supabaseAdmin
      .from('content_work_orders')
      .update({ status: 'publish_failed', reject_reason: '上次发布中途中断,平台侧未确认是否已发出,请人工核对 Facebook 主页', next_retry_at: null, publishing_started_at: null, updated_at: new Date().toISOString() })
      .eq('id', id)
    console.error(`[publish-worker] ${id} 上次 start(video_id=${priorRef['video_id']})后中断且平台侧未确认→不重发,待人工核对`)
    return { order_id: id, result: 'failed', detail: 'interrupted_verify_manual' }
  }

  // 幂等对账(防"发了没记上"重发):平台侧已存在本 wo → 补记回执,不重发
  try {
    const existing = await adapter.findExisting({ target, idempotencyTag: id })
    if (existing) {
      if (!opts.draft && adapter.ensureFirstComment && !existing.first_comment_id) {
        existing.first_comment_id = await adapter.ensureFirstComment({
          target, videoId: String(existing.video_id ?? existing.post_id), idempotencyTag: id, message: firstComment.text,
        })
      }
      await recordPublished(id, existing, clientId, label)
      return { order_id: id, result: 'skipped_existing', detail: existing.post_id }
    }
  } catch (e) {
    // 对账失败不发(宁可不发也不冒双发风险)
    await markFailed(id, attempts, `幂等对账失败,保守不发: ${e instanceof Error ? e.message : e}`)
    return { order_id: id, result: 'failed', detail: 'reconcile_error' }
  }

  // 视频 URL:公开地址 + 校验
  const videoPath = typeof output['video_path'] === 'string' ? (output['video_path'] as string) : ''
  if (!videoPath) {
    await markFailed(id, attempts, '工单无 output.video_path')
    return { order_id: id, result: 'failed', detail: 'no_video' }
  }
  const videoUrl = `${PUBLIC_BASE()}/${videoPath}`
  const urlErr = await validateVideoUrl(videoUrl)
  if (urlErr) {
    await markFailed(id, attempts, urlErr)
    return { order_id: id, result: 'failed', detail: 'bad_video_url' }
  }

  // 发布(draft 由 opts 控制:首测=草稿不公开)
  let ref: PublishedRef
  try {
    ref = await adapter.publish({
      videoUrl,
      caption,
      firstComment: firstComment.text,
      target,
      idempotencyTag: id,
      draft: opts.draft,
      // 上传前把 video_id 落本地当幂等锚(魏征 B9):中途崩后重来靠它判断,不盲目重发
      onStarted: async (videoId) => {
        await supabaseAdmin
          .from('content_work_orders')
          .update({
            published_ref: { provisional: true, platform: target.platform, page_id: target.page_id, video_id: videoId },
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
      },
    })
  } catch (e) {
    await markFailed(id, attempts, `发布失败: ${e instanceof Error ? e.message : e}`)
    return { order_id: id, result: 'failed', detail: 'publish_error' }
  }

  // 硬事务:先落 published_ref + status(幂等锚,最优先)→ 再三落库(尽力,可后补)
  await recordPublished(id, ref, clientId, label)
  // 发布信号(me/factory.reel.published):发完喊一声给下游自动建广告。
  // 只在真·PUBLISHED 的 facebook Reel 上喊(草稿不可 promote 成广告,绝不喊)。best-effort,不阻塞返回。
  await emitReelPublishedEvent(id, ref, clientId)
  return { order_id: id, result: 'published', detail: ref.permalink ?? ref.post_id }
}

// published_ref 硬事务 + 三落库尽力而为(魏征 B9:三落库失败不回滚 published,片已发出回滚会致重发)
async function recordPublished(
  id: string,
  ref: PublishedRef,
  clientId: string,
  label: string,
): Promise<void> {
  await supabaseAdmin
    .from('content_work_orders')
    .update({ status: 'published', published_ref: ref, reject_reason: null, next_retry_at: null, updated_at: new Date().toISOString() })
    .eq('id', id)
  // 三落库(fde_work_logs + execution_items + flywheel_actions)best-effort,不阻塞、失败可后补
  await writeThreeBooks(id, ref, clientId, label).catch((e) =>
    console.error(`[publish-worker] 三落库失败(片已发出,不回滚) ${id}: ${e instanceof Error ? e.message : e}`),
  )
}

// 三落库:CLAUDE.md 强约束——外部执行动作必落 fde_work_logs + execution_items + flywheel_actions + 归因链
export async function writeThreeBooks(
  id: string,
  ref: PublishedRef,
  clientId: string,
  angle: string,
  /**
   * 默认 = Facebook 路径(行为不变)。Instagram 交叉发布传独立的 actionType 和人话渠道名:
   * 测量那边(factory-reel-measurement-adapter)按 (action_type, work_order_id) 唯一回读 Facebook 那一行,
   * 同一工单再写一行同 action_type 会让它 maybeSingle 报「多行」。
   */
  opts: { actionType?: string; channelLabel?: string } = {},
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  // A Facebook draft is uploaded but not public, so it must not be booked as sent.
  const isDraft = ref.video_state === 'DRAFT'
  const execMode = ref.platform === 'facebook' ? 'in_house' : 'third_party'
  const vendor = ref.platform === 'facebook' ? 'meta_graph' : 'publer' // channel (same label as reel-measurement adapter), not customer: client_id is already on every row

  const actionType = opts.actionType ?? 'factory_reel_publish'
  const channel = opts.channelLabel ?? vendor // 给人看的渠道名(待办/日志里显示);vendor 仍是机器标签

  const nowIso = new Date().toISOString()
  // 三张表各自独立写:一张挂不拖累另两张(魏征 P1-3),尤其 fde_work_logs(PM 主看板)必须落。
  let execId: string | null = null
  // draft is not a completed action; flywheel row below stays so the promote-to-public step can find it.
  if (!isDraft) {
    // source 用 'proactive_signal'(系统主动信号→自动发布);'factory_auto' 撞 CHECK(魏征 P1-3)
    const { data, error } = await supabaseAdmin
      .from('execution_items')
      .insert({
        client_id: clientId,
        title: `【社媒 ${today}】工厂自动发布 Reel — ${angle}`.slice(0, 200),
        description: `工厂自动发布 Reel「${angle}」→ ${channel}(${ref.permalink ?? ref.post_id})`,
        dimension: 'social',
        status: 'completed',
        fix_type: 'me_auto',
        source: 'proactive_signal',
        completed_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('id')
      .maybeSingle()
    if (error) console.error(`[publish-worker] execution_items 落库失败 ${id}: ${error.message}`)
    else execId = data?.id ?? null
  }
  {
    const { error } = await supabaseAdmin.from('flywheel_actions').insert({
      client_id: clientId,
      flywheel: 'social',
      action_type: actionType,
      execution_mode: execMode,
      vendor,
      payload: { work_order_id: id, ...ref },
      expected_metric: 'reel_plays',
      expected_delta: null,
      execution_item_id: execId,
    })
    if (error) console.error(`[publish-worker] flywheel_actions 落库失败 ${id}: ${error.message}`)
  }
  {
    const summary = isDraft
      ? `【社媒｜工厂自动发布】Reel「${angle}」草稿已上传到 ${channel}，未公开。${ref.permalink ?? ref.post_id}`
      : `【社媒｜工厂自动发布】Reel「${angle}」已发到 ${channel}。${ref.permalink ?? ref.post_id}`
    const { error } = await supabaseAdmin.from('fde_work_logs').insert({
      client_id: clientId,
      log_date: today,
      summary,
      author_email: 'factory@magicengine.com.au',
    })
    if (error) console.error(`[publish-worker] fde_work_logs 落库失败 ${id}: ${error.message}`)
  }
}

// ── 发布信号(me/factory.reel.published):发完喊一声给下游自动建广告 ──────────────
//
// 落点约束(魏征 B 复审):
//  - 只在真·PUBLISHED 的 facebook Reel 上 emit —— 草稿不可 promote 成广告,绝不通知下游。
//    靠 published_ref.video_state 戳区分(adapter 发布时盖),而不是 status='published'
//    (草稿也会走到 status='published')。
//  - best-effort:片已发出,事件失败绝不回滚(回滚会致重发)。失败留待 reconcile 补发。
//  - 幂等 id 固定(work_order+video):正常路径与补发路径撞车,Inngest 只算一次。
//  - 恢复/补记路径(findExisting)video_state=undefined → 不喊(来路不明,宁可不喊)。
async function emitReelPublishedEvent(
  workOrderId: string,
  ref: PublishedRef,
  clientId: string,
): Promise<void> {
  if (ref.platform !== 'facebook' || ref.video_state !== 'PUBLISHED') return
  if (!ref.video_id || !ref.page_id) return
  if (ref.event_ids && ref.event_ids.length > 0) return // 已喊过,幂等短路

  try {
    const nowIso = new Date().toISOString()
    const event = buildReelPublishedEvent({
      workOrderId,
      clientId,
      pageId: ref.page_id,
      videoId: ref.video_id,
      permalink: ref.permalink,
      publishedAt: ref.published_at,
      requestId: randomUUID(),
      createdAt: nowIso,
    })
    const sent = await sendInngestEvent<Record<string, unknown>>(event)
    // 回执落回 published_ref.event_ids —— 补发对账靠它判断"喊过没"
    const nextRef: PublishedRef = { ...ref, event_ids: sent.event_ids }
    await supabaseAdmin
      .from('content_work_orders')
      .update({ published_ref: nextRef, updated_at: nowIso })
      .eq('id', workOrderId)
  } catch (e) {
    console.error(
      `[publish-worker] 发布信号 emit 失败(片已发出,待补发对账重发) ${workOrderId}: ${e instanceof Error ? e.message : e}`,
    )
  }
}

// ── 补发对账(堵 fail-silent,子牙+魏征双列必做):已 PUBLISHED 但信号没喊成的 Reel 重发 ──
//
// 为什么非补不可:emit 是 best-effort,一旦 Inngest 那一下失败,下游永远收不到"发了"→
// 永远不建广告,且是静默的。这里每轮开工前扫最近几条已发但 event_ids 空的,补喊。
// 只补真·PUBLISHED(video_state 戳),草稿绝不补喊。幂等 id 固定,补喊不会双发。
export async function reconcileMissingReelEvents(limit = 25): Promise<void> {
  // DB 层先收窄到"真·PUBLISHED 的 facebook Reel"(->> 文本过滤,PostgREST 稳),
  // 再放宽窗口到 25 —— 一条持续 emit 失败的行 updated_at 不刷新,会被新片挤下去;
  // 收窄+放宽后,要挤出窗口得同一轮内冒出 25 条更新的 facebook PUBLISHED reel(worker 一轮
  // 只发 1 条,不可能)。理想是直接 `event_ids IS NULL` 过滤,但那要 jsonb null 过滤,
  // 语法脆且 build 抓不到,先用这个稳的口径 + 内存兜底(见下 event_ids 判空)。backlog 记账。
  const { data: rows } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, client_id, published_ref')
    .eq('status', 'published')
    .eq('published_ref->>platform', 'facebook')
    .eq('published_ref->>video_state', 'PUBLISHED')
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    const ref = (row.published_ref ?? null) as PublishedRef | null
    if (!ref || ref.platform !== 'facebook' || ref.video_state !== 'PUBLISHED') continue
    if (ref.event_ids && ref.event_ids.length > 0) continue
    await emitReelPublishedEvent(String(row.id), ref, String(row.client_id))
  }
}

/** cron 入口:一轮领 + 发一条(FB 视频上传慢,一次 1 条防超时)。返回本轮结果。
 *  补发对账(reconcileMissingReelEvents)由 cron 路由单独调,不塞这里 —— 领单查询与
 *  对账查询共用一张表,混在同一函数里会互相干扰(且脆的集成测试也难分辨)。 */
export async function runPublishWorker(opts: PublishOptions): Promise<PublishOutcome> {
  const wo = await claimOne(opts.workerId)
  if (!wo) return { order_id: '', result: 'no_candidate' }
  try {
    return await processOne(wo, opts)
  } catch (e) {
    // 兜底:processOne 内部已按分支 markFailed;这里防漏网异常把工单卡死在 publishing
    const id = String(wo['id'])
    await markFailed(id, Number(wo['publish_attempts'] ?? 0), `未捕获异常: ${e instanceof Error ? e.message : e}`)
    return { order_id: id, result: 'failed', detail: 'uncaught' }
  }
}
