// P0.1 publish-worker 主体 — approved 成片 → 发到客户平台 + 三落库。
// 状态机:approved →(原子领取)→ publishing → published / publish_failed。
// 护栏(子牙 B8 + 魏征 B9):原子领取防双发 · 幂等对账防"发了没记上" · 防误发三断言 · 视频 URL 校验 ·
//   published_ref 硬事务(先落回执再三落库,三落库尽力而为可后补)。
// P0.1a 只实现 FacebookReelAdapter(Oztop);加 CTS = 多注册个 PublerAdapter,主体不改。

import { supabaseAdmin } from '@/lib/supabase'
import type { PublishAdapter, PublishTarget, PublishedRef } from '../types'
import { facebookReelAdapter } from './facebook-reel-adapter'

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
  return t
}

async function validateVideoUrl(url: string): Promise<string | null> {
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

const PUBLIC_BASE = () =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/storage/v1/object/public/content-factory`

// ── 失败落库(退避重试 / terminal)───────────────────────────────────────────
async function markFailed(id: string, attempts: number, reason: string): Promise<void> {
  const terminal = attempts + 1 >= MAX_PUBLISH_ATTEMPTS
  const backoffMin = RETRY_BACKOFF_MIN * Math.pow(2, attempts)
  await supabaseAdmin
    .from('content_work_orders')
    .update({
      status: 'publish_failed',
      publish_attempts: attempts + 1,
      // terminal:next_retry_at 置空 = 不再自动重试,等 PM 决策;否则退避后重试
      next_retry_at: terminal ? null : new Date(Date.now() + backoffMin * 60_000).toISOString(),
      publishing_started_at: null, // 魏征 B9:清租约锚,重领时刷新,防 sweeper 误判"刚重领"为超时
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  console.error(`[publish-worker] ${id} failed (attempt ${attempts + 1}${terminal ? ',terminal' : ''}): ${reason}`)
}

// ── 处理一条 ──────────────────────────────────────────────────────────────────
async function processOne(wo: Record<string, unknown>, opts: PublishOptions): Promise<PublishOutcome> {
  const id = String(wo['id'])
  const clientId = String(wo['client_id'])
  const attempts = Number(wo['publish_attempts'] ?? 0)
  const brief = (wo['brief'] ?? {}) as Record<string, unknown>
  const output = (wo['output'] ?? {}) as Record<string, unknown>

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
  if (priorRef && priorRef['provisional'] === true && priorRef['video_id']) {
    const recovered = await adapter.findExisting({ target, idempotencyTag: id }).catch(() => null)
    if (recovered) {
      await recordPublished(id, recovered, clientId, brief)
      return { order_id: id, result: 'skipped_existing', detail: 'recovered_after_interrupt' }
    }
    await supabaseAdmin
      .from('content_work_orders')
      .update({ status: 'publish_failed', next_retry_at: null, publishing_started_at: null, updated_at: new Date().toISOString() })
      .eq('id', id)
    console.error(`[publish-worker] ${id} 上次 start(video_id=${priorRef['video_id']})后中断且平台侧未确认→不重发,待人工核对`)
    return { order_id: id, result: 'failed', detail: 'interrupted_verify_manual' }
  }

  // 幂等对账(防"发了没记上"重发):平台侧已存在本 wo → 补记回执,不重发
  try {
    const existing = await adapter.findExisting({ target, idempotencyTag: id })
    if (existing) {
      await recordPublished(id, existing, clientId, brief)
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

  // caption:品牌接地文案(endcard.url 已锁客户域名);正文红线再扫留待 review 补(TODO B10)
  const copy = (brief['copy'] ?? {}) as Record<string, unknown>
  const endcard = (copy['endcard'] ?? {}) as Record<string, unknown>
  const caption = buildCaption(copy, endcard)

  // 发布(draft 由 opts 控制:首测=草稿不公开)
  let ref: PublishedRef
  try {
    ref = await adapter.publish({
      videoUrl,
      caption,
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
  await recordPublished(id, ref, clientId, brief)
  return { order_id: id, result: 'published', detail: ref.permalink ?? ref.post_id }
}

function buildCaption(copy: Record<string, unknown>, endcard: Record<string, unknown>): string {
  const cta = typeof endcard['cta'] === 'string' ? (endcard['cta'] as string) : ''
  const url = typeof endcard['url'] === 'string' ? (endcard['url'] as string) : ''
  const offer = Array.isArray(endcard['offer']) ? (endcard['offer'] as string[]).join(' · ') : ''
  return [cta, offer, url].filter(Boolean).join('\n')
}

// published_ref 硬事务 + 三落库尽力而为(魏征 B9:三落库失败不回滚 published,片已发出回滚会致重发)
async function recordPublished(
  id: string,
  ref: PublishedRef,
  clientId: string,
  brief: Record<string, unknown>,
): Promise<void> {
  await supabaseAdmin
    .from('content_work_orders')
    .update({ status: 'published', published_ref: ref, next_retry_at: null, updated_at: new Date().toISOString() })
    .eq('id', id)
  // 三落库(fde_work_logs + execution_items + flywheel_actions)best-effort,不阻塞、失败可后补
  await writeThreeBooks(id, ref, clientId, brief).catch((e) =>
    console.error(`[publish-worker] 三落库失败(片已发出,不回滚) ${id}: ${e instanceof Error ? e.message : e}`),
  )
}

// 三落库:CLAUDE.md 强约束——外部执行动作必落 fde_work_logs + execution_items + flywheel_actions + 归因链
async function writeThreeBooks(
  id: string,
  ref: PublishedRef,
  clientId: string,
  brief: Record<string, unknown>,
): Promise<void> {
  const angle = typeof brief['angle'] === 'string' ? (brief['angle'] as string) : 'factory reel'
  const today = new Date().toISOString().slice(0, 10)
  const execMode = ref.platform === 'facebook' ? 'in_house' : 'third_party'
  const vendor = ref.platform === 'facebook' ? 'oztop_facebook' : 'cts_publer'

  const nowIso = new Date().toISOString()
  // 三张表各自独立写:一张挂不拖累另两张(魏征 P1-3),尤其 fde_work_logs(PM 主看板)必须落。
  let execId: string | null = null
  {
    // source 用 'proactive_signal'(系统主动信号→自动发布);'factory_auto' 撞 CHECK(魏征 P1-3)
    const { data, error } = await supabaseAdmin
      .from('execution_items')
      .insert({
        client_id: clientId,
        title: `【社媒 ${today}】工厂自动发布 Reel — ${angle}`.slice(0, 200),
        description: `工厂自动发布 Reel「${angle}」→ ${vendor}(${ref.permalink ?? ref.post_id})`,
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
      action_type: 'factory_reel_publish',
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
    const { error } = await supabaseAdmin.from('fde_work_logs').insert({
      client_id: clientId,
      log_date: today,
      summary: `【社媒｜工厂自动发布】Reel「${angle}」已发到 ${vendor}。${ref.permalink ?? ref.post_id}`,
      author_email: 'factory@magicengine.com.au',
    })
    if (error) console.error(`[publish-worker] fde_work_logs 落库失败 ${id}: ${error.message}`)
  }
}

/** cron 入口:一轮领 + 发一条(FB 视频上传慢,一次 1 条防超时)。返回本轮结果。 */
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
