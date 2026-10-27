/**
 * Content / factory related manual items (from manual-items.ts, Round 2).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { renderWorkerDownReason, type AlivePing } from '@/lib/factory/render-worker-report'
import { judgeWorkerPresence, judgeQueueByClient, latestAliveAt } from '@/lib/factory/worker-presence'
import { containsPriceClaim } from '@/lib/content/price-claim'
import { judgeOutgoingPost } from '@/lib/content/price-claim-gate'
import { SOURCE_LABELS } from '@/lib/assets/provenance'

/** 出片余额充值页 —— 用户自己的账户页,不是深链,登录后一定打得开。 */
const MUAPI_TOPUP_URL = 'https://muapi.ai/topup'

/**
 * AI 出片余额用完 —— 必须下发给人，因为只有人能充值。
 *
 * 2026-08-03 实测:Oztop 重跑到第二个镜头时 402 Insufficient credits,整单失败。
 * 这种失败以前只写进工单的 error 字段 —— 没人会去翻,于是「工厂又没出片」
 * 变成一个查不出原因的现象。余额这种事必须当天摆到眼前。
 *
 * 判据用「近 3 天有没有因余额失败的工单」,不是查余额接口 ——
 * 那个接口不对外(实测 404),而失败记录是我们自己的、一定拿得到。
 */
export async function pushVideoCreditsItem(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - 3 * 86_400_000).toISOString()
  // ⚠️ 不按 status 过滤:余额不足时 worker 把工单**退回 queued** 让下轮重领,
  //    status 并不会变成 failed。按状态筛会一条都查不到 —— 实测踩到。
  const { data } = await supabase
    .from('content_work_orders')
    .select('id, client_id, updated_at, reject_reason')
    .not('reject_reason', 'is', null)
    .gte('updated_at', since)
    .limit(50)

  // ⚠️ 字段叫 reject_reason，不是 failure_reason。首版按后者写，查询会直接报错、
  //    被 catch 吞掉 → 这条待办永远不出现。跟 quality_score 那次是同一个毛病：
  //    **写 select 前必须先查真实列名**。
  const hit = ((data ?? []) as Array<{ reject_reason?: string | null }>).find((r) =>
    /insufficient credit|INSUFFICIENT_CREDITS/i.test(r.reject_reason ?? ''),
  )
  if (!hit) return

  items.push({
    kind: 'video_credits_out',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what: 'AI 出片的余额用完了 —— 工厂现在做到一半就会断，做出来的半成品也白花了钱',
    how: '打开链接充值（这是我们生成视频画面用的账户）。充完回我一句，我把断掉的那几单重跑',
    href: MUAPI_TOPUP_URL,
  })
}

/**
 * Creatomate 渲染失败 / 超时 —— 旧 ffmpeg 路径的 reapStale() 随 2026-09-02 退役一起死了
 * （见 docs/specs/2026-09-09-creatomate-connector-spec-v1.md §4.4 B4），这条是它的替代：
 * 卡死的任务不会自己被谁看见，必须扫一遍 failed 行主动下发。
 *
 * 判据：`render_engine='creatomate' AND status='failed'`，近 3 天（避免翻出陈年旧账）。
 * `error` 文案区分"额度用完"（402，见 spec §6.2）和其他失败（超时/参数错误等），
 * 前者的 how 指向充值，后者指向去 Creatomate 后台查那条具体的 render。
 */
export async function pushCreatomateRenderItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  clientNames: Map<string, { name: string }>,
): Promise<void> {
  const since = new Date(now.getTime() - 3 * 86_400_000).toISOString()
  const { data } = await supabase
    .from('content_factory_render_jobs')
    .select('id, client_id, error, creatomate_render_id')
    .eq('render_engine', 'creatomate')
    .eq('status', 'failed')
    .gte('updated_at', since)
    .limit(50)

  const rows = (data ?? []) as Array<{ id: string; client_id: string; error: string | null; creatomate_render_id: string | null }>
  for (const row of rows) {
    const clientName = clientNames.get(row.client_id)?.name ?? '未知客户'
    const creditsOut = /402|insufficient|credit/i.test(row.error ?? '')
    items.push({
      // 额度用完只有人能充值；别的做片失败是我们要查的（今日待办按 kind 分车道）
      kind: creditsOut ? 'creatomate_render_failed' : 'creatomate_render_error',
      client_id: row.client_id,
      client_name: clientName,
      what: creditsOut
        ? `${clientName} 有一条视频没做完 —— Creatomate 出片额度可能用完了，只有人能充值`
        : `${clientName} 有一条视频做片失败：${row.error ?? '原因未知'}`,
      how: creditsOut
        ? '登录 Creatomate 后台确认额度并充值，充完回我一句，我把这条重新提交'
        : `登录 Creatomate 后台查这条 render（id: ${row.creatomate_render_id ?? '未知，看工单详情'}）到底卡在哪，或者直接找我重跑`,
      href: `https://app.magicengine.com.au/dashboard/clients/${row.client_id}/content-factory`,
    })
  }
}

/**
 * 审批过了但发不出去的帖子 —— 文案报了价，配图来源却背不了真价。
 *
 * 为什么必须下发：Airtable 审批过的帖子会自动往外发，人不在场。
 * 那道闸拦下来**没有任何人会看到** —— 帖子就永远停在
 * approved，看起来像「排着排着就没了」。发现死在日志里 = 管道断头。
 *
 * 不落新状态、不加新表：判定条件跟闸本身同源，改好文案或确认好素材，这条自己就消失。
 */
export async function pushPriceGateItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  const { data: posts } = await supabase
    .from('content_posts')
    .select('id, client_id, title, caption')
    .eq('status', 'approved')
  const rows = (posts ?? []) as Array<{
    id: string
    client_id: string
    title: string | null
    caption: string | null
  }>

  // 绝大多数帖子不报价 —— 先在内存里筛掉，别为了没价格的帖子去查素材。
  const withPrice = rows.filter((p) => containsPriceClaim(p.caption))
  if (withPrice.length === 0) return

  for (const post of withPrice) {
    // 跟 create-post 取图口径一致：外部改过的终版优先，其次选中的，再次最新的。
    const { data: assets } = await supabase
      .from('visual_assets')
      .select('storage_url')
      .eq('post_id', post.id)
      .eq('generation_status', 'ready')
      .order('is_final', { ascending: false })
      .order('is_selected', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
    const storageUrl = (assets ?? [])[0]?.storage_url as string | undefined
    if (!storageUrl) continue // 没配图 = 发不出去是别的原因，不归这条管

    const verdict = await judgeOutgoingPost(supabase, {
      clientId: post.client_id,
      caption:  post.caption ?? '',
      imageUrl: storageUrl,
    })
    if (!verdict.blocked) continue

    // href 要指到「这张图真的能改」的地方——素材库页面只操作 client_assets，
    // 不是这条闸真正查的表。图必须在素材库里才有「改来源」这个动作可点；
    // 不在库里（比如纯 AI 生成、从没进过素材库）就没有素材库能改，那条选项对
    // PM 来说是死链接，只剩「把价格去掉」这一条路是真能做的。
    const { data: libraryRow } = await supabase
      .from('client_assets')
      .select('id')
      .eq('client_id', post.client_id)
      .eq('storage_url', storageUrl)
      .limit(1)
      .maybeSingle()
    const libraryAssetId = (libraryRow as { id: string } | null)?.id

    items.push({
      kind: 'price_claim_unbacked',
      client_id: post.client_id,
      client_name: nameOf(post.client_id),
      what:
        `帖子「${post.title ?? post.id}」已审批但发不出去 —— 文案里写了价格，` +
        `配图来源是「${SOURCE_LABELS[verdict.source]}」。真实价格只能配真实画面，` +
        '客人按图下单拿到的东西对不上，投诉算客户的。',
      how: libraryAssetId
        ? '两条路选一条：① 最快 —— 把价格从文案里去掉；' +
          '② 如果那张图确实是客户实拍，点这个链接会直接跳到那张图，把来源改成「客户实拍（已确认）」，再回来重发。'
        : '这张图不在素材库里（不是客户实拍上传的，多半是系统自动生成的），没法回去"确认成客户实拍"——' +
          '唯一能做的是把价格从文案里去掉，再重发。',
      href: libraryAssetId
        ? `https://app.magicengine.com.au/dashboard/clients/${post.client_id}/assets?highlight=${libraryAssetId}`
        : `https://app.magicengine.com.au/dashboard/clients/${post.client_id}/execution`,
    })
  }
}

/**
 * 出片工单在排队但没人干活 → 下发。
 *
 * 装配环节跑在一台 Mac 上，没人开机时工单就静静躺在队列里 ——
 * 队列里有活、看板上没动静，而「这周怎么没出片」要等人想起来问才发现。
 * 只在**真的有活在等**时才报（没活时工人没开机完全正常，报了就是噪音）。
 */
export async function pushFactoryWorkerItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  /** 客户名查表 —— 待办要说清是哪个客户的活卡了，显示 uuid 等于没显示。 */
  clientNames: Map<string, { name: string }>,
): Promise<void> {
  // 真实列名（已核实）：status / created_at / heartbeat_at / reject_reason
  // 🔴 `reject_reason` 必须一起读：余额不足时 worker 把工单退回 queued 而不是
  //    标 failed，只数「队列里有几个」会把「失败后卡住的僵尸工单」误当成「等人干的新活」。
  const { data: queuedRows } = await supabase
    .from('content_work_orders')
    .select('id, client_id, created_at, reject_reason')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
  const queued = (queuedRows ?? []) as Array<{
    id: string
    client_id: string
    created_at: string
    reject_reason: string | null
  }>
  if (queued.length === 0) return

  // 心跳按客户查 —— 判定层解释了为什么不能用全局最新的（judgeQueueByClient 头注）。
  const clientIds = Array.from(new Set(queued.map((q) => q.client_id)))
  // 空闲时的存活信号（worker 空闲时每 ~4 分钟、干活时跟着工单心跳 ping 一次，复用 cron_run_logs，一台 worker 一行）。
  const { data: aliveData, error: aliveError } = await supabase
    .from('cron_run_logs')
    .select('started_at, summary')
    .eq('job_name', 'factory-worker-alive')
  if (aliveError) throw new Error(`factory alive-ping query failed: ${aliveError.message}`)
  const pings = (aliveData ?? []) as Array<AlivePing & { started_at: string }>

  const latestHbByClient = new Map<string, string>()
  for (const clientId of clientIds) {
    // A busy client's history must not crowd another client's latest heartbeat out of a global limit.
    const { data: hbRows, error: hbError } = await supabase
      .from('content_work_orders')
      .select('heartbeat_at')
      .eq('client_id', clientId)
      .not('heartbeat_at', 'is', null)
      .order('heartbeat_at', { ascending: false })
      .limit(1)
    if (hbError) throw new Error(`factory heartbeat query failed: ${hbError.message}`)
    const latest = (hbRows ?? [])[0] as { heartbeat_at: string } | undefined
    const alive = latestAliveAt(latest?.heartbeat_at, pings, clientId)
    if (alive) latestHbByClient.set(clientId, alive)
  }

  // 一个客户一条：不同客户的 worker 在线状态是独立的，合成一条会把两种
  // 完全不同的处置（这家去开机 / 那家去查报错）搅在一起。
  for (const { clientId, verdict } of judgeQueueByClient(queued, latestHbByClient, now)) {
    pushOneFactoryWorkerItem(items, verdict, clientNames.get(clientId)?.name ?? '未知客户')
  }
  for (const clientId of clientIds) {
    const reason = renderWorkerDownReason(pings, clientId)
    if (!reason) continue
    const clientName = clientNames.get(clientId)?.name ?? '未知客户'
    items.push({
      kind: 'factory_render_worker_down',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `【${clientName}】有片子在排队，但这台机器报渲染工人没就绪：${reason}。领单的程序还在，不等于片子能做出来。`,
      how: '按上面那句原因修这台机器上的渲染环境。不要找做片的人，也不要找审核的人。修好之后这条会自己消失。',
      href: 'https://app.magicengine.com.au/dashboard/factory',
    })
  }
}

/** 把一条工人待办写出来。两种病因两套话术，别混。 */
function pushOneFactoryWorkerItem(
  items: ManualItem[],
  verdict: Exclude<ReturnType<typeof judgeWorkerPresence>, { idle: true }>,
  clientName: string,
): void {
  const who = `【${clientName}】`

  // 两种病因，两套话术。判定层已经保证：`stuck_on_failure` 只在工人**在线**时
  // 产生（离线一律先报 worker_offline，因为开机是那种情况下无条件正确的第一步）。
  if (verdict.kind === 'stuck_on_failure') {
    items.push({
      kind: 'factory_worker_idle',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what:
        `${who}${verdict.humanReason}` +
        (verdict.sampleReason ? `。系统报的原因：「${verdict.sampleReason}」` : ''),
      // 🔴 这里**不能**写成「先观察下一次重试」（Codex P2 复审）。
      //    `factory/worker/[id]/fail` 把可重试失败直接退回 `queued`，**没有任何
      //    退避字段**（`next_retry_at` 只存在于 publish-worker，那是另一条线），
      //    所以失败工单立刻就能被重新领走。工人在线还卡了 6 小时以上，重试早
      //    该发生了 —— 「在等重试」不是这里的合理解释，确实需要人看一眼。
      //    话术必须给真动作，否则这条进了「需要你动手」栏却让人干等，等于
      //    制造一条假待办。
      how:
        '工人在线、活却过不去，重试早该发生了（失败退回队列是立刻可重领的，没有等待期）—— ' +
        '先看上面那句报错：写着余额不足（credit / balance）就去充值，充完它会自己被重新领走；' +
        '写的是别的原因，回我一句「出片工单卡住了」，我去查',
      href: 'https://app.magicengine.com.au/dashboard/factory',
    })
    return
  }

  // worker_offline：开机是第一步。这些活如果失败过，把原因一并带上 ——
  // 开机后还是过不去时，那就是下一步该看的东西（但绝不因此劝阻开机：
  // 带 reject_reason 的 queued 工单通常还有重试机会，重试恰恰要靠工人上线）。
  items.push({
    kind: 'factory_worker_idle',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what:
      `${who}${verdict.humanReason} —— 出片这一步跑在你那台 Mac 上，它不开机就没人做` +
      (verdict.sampleReason
        ? `。另外这些工单上次失败过，系统报的原因是：「${verdict.sampleReason}」`
        : ''),
    how:
      '在那台 Mac 的终端里，已装开机自启的话跑 `launchctl kickstart -k gui/$(id -u)/com.magicengine.factory-worker`（把它重启）；' +
      '没装的话跑 `node scripts/factory-worker/worker.mjs --loop`。起来之后它会自己把排队的活领走，这条待办也会自己消失。如果那台 Mac 只是合盖睡着了，唤醒它就行。' +
      (verdict.sampleReason
        ? '开机之后如果这些工单还是过不去，就是上面那条原因（写着余额不足就去充值），回我一句我来查。'
        : '') +
      '如果你希望这事不再依赖某一台机器，回我一句，我们单独排',
    href: 'https://app.magicengine.com.au/dashboard/factory',
  })
}
