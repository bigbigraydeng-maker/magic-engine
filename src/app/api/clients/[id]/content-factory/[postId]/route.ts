import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  scheduleSocialPost,
  resolveBoundPublerAccount,
  type PublerAccount,
} from '@/lib/flywheel/social-post-publish'
import { LINKEDIN_PROGRESS_SOURCE, LINKEDIN_PROGRESS_PLATFORM } from '@/lib/linkedin-progress/constants'
import { enqueueRenderJob } from '@/lib/factory/render-queue'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { CREATOMATE_RENDER_REQUESTED_EVENT } from '@/lib/creatomate/events'
import { projectFactoryConfig } from '@/lib/factory/client-config'

export const dynamic = 'force-dynamic'

// PATCH /api/clients/[id]/content-factory/[postId]
// body: { action: 'confirm' | 'reject' }
// 选题段的确认/打回：confirm → approved(进备料段)，reject → rejected(留选题段)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } },
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string; offer_key?: string }
    const status =
      body.action === 'confirm' ? 'approved'    // 选题：确认做 → 建做片任务
      : body.action === 'reject' ? 'rejected'    // 打回
      : body.action === 'schedule' ? 'scheduled' // 出片：满意 → 去发布
      : null
    if (!status) {
      return NextResponse.json({ error: "action 必须是 'confirm' / 'reject' / 'schedule'" }, { status: 400 })
    }

    // 对 LinkedIn 的 confirm，账号解析必须在下面"原子认领"之前完成：如果
    // 解析放在认领之后，解析失败时这一行已经被改成了 approved，而认领用的
    // .eq('status','draft') 条件会让后续重试（账号连好后再点一次确认）永远
    // 抢不到这一行——草稿就卡死了。这里先只读查一次 source，不碰状态。
    let linkedinAccount: PublerAccount | null = null
    let isLinkedinConfirm = false
    if (body.action === 'confirm') {
      const { data: peek, error: peekErr } = await supabaseAdmin
        .from('content_posts')
        .select('source')
        .eq('client_id', params.id)
        .eq('id', params.postId)
        .maybeSingle()
      // fail closed：预读失败不能当成"不是 LinkedIn"往下走——那样会跳过严格
      // 账号解析，最后把仍为 null 的账号交给 scheduleSocialPost 的宽松兜底，
      // 可能发到错误账号。查询出错直接抛，让整个请求 500。
      if (peekErr) throw peekErr
      isLinkedinConfirm = peek?.source === LINKEDIN_PROGRESS_SOURCE
      if (isLinkedinConfirm) {
        linkedinAccount = await resolveBoundPublerAccount(params.id, LINKEDIN_PROGRESS_PLATFORM)
        if (!linkedinAccount) {
          return NextResponse.json(
            { error: 'LinkedIn 账号还没连到发布工具，先去连接器设置页完成一次性授权' },
            { status: 409 },
          )
        }
      }
    }

    // 只在确认做片时才需要读客户配置——一次读拿两件事用：①这条视频指定的
    // offer_key 是否真的存在于这个客户当前配的资料包里（不存在直接 400 拦下，
    // 不能让一个选了已删除/打错档位的视频混进渲染队列，等几十秒后才在 Inngest
    // 任务里默默失败——魏征复审 a9a67fc1 指出这是本该在确认这一刻就能发现的
    // 错误）；②下面判断 engine==='creatomate' 要不要排渲染任务，同一次查询，
    // 不用像之前那样为了 engine 判断再单独查一次。
    let factoryConfigForConfirm: unknown = null
    if (body.action === 'confirm') {
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('factory_config')
        .eq('id', params.id)
        .single()
      factoryConfigForConfirm = client?.factory_config ?? null
    }

    // 这条视频对应哪份「资料包」（factory_config.render.creatomate.offers 的 key，
    // 见 post-fields.ts::resolveOfferFacts）——只有确认做片时才有意义传，且只做
    // 有边界的合并：只动 generation_context_snapshot 的 offer_key 这个子 key，
    // 不碰同一列上别的功能写的 endcard/lesson_no/publish_error 等其它子 key
    // （同一原则见 factory-creatomate-render.ts::ensurePostFieldsWritten）。
    const patch: Record<string, unknown> = { status }
    if (body.action === 'confirm' && typeof body.offer_key === 'string' && body.offer_key.trim()) {
      const offerKey = body.offer_key.trim()
      const configuredOffers = projectFactoryConfig(factoryConfigForConfirm).render?.creatomate?.offers
      if (!configuredOffers || !(offerKey in configuredOffers)) {
        return NextResponse.json(
          { error: `这个团/档位「${offerKey}」在客户配置里找不到，可能刚被删掉或改名了——重新进设置页确认一下资料包列表` },
          { status: 400 },
        )
      }
      const { data: current, error: currentErr } = await supabaseAdmin
        .from('content_posts')
        .select('generation_context_snapshot')
        .eq('client_id', params.id)   // 双重限定，跟同文件其它查询同一原则，防越权读到别客户的行
        .eq('id', params.postId)
        .single()
      if (currentErr) throw currentErr
      const currentSnapshot = (current?.generation_context_snapshot ?? {}) as Record<string, unknown>
      patch.generation_context_snapshot = { ...currentSnapshot, offer_key: offerKey }
    }

    let updateQuery = supabaseAdmin
      .from('content_posts')
      .update(patch)
      .eq('client_id', params.id)   // 双重限定，防越权改到别客户
      .eq('id', params.postId)

    // 原子认领只对 LinkedIn 帖子加：confirm 只能从 'draft' 转 'approved'。
    // 没有这个条件，两个并发的 confirm（双击、两个管理员同时点）会各自无条
    // 件把状态重写成 approved，都读到一行，然后各自调一次 scheduleSocialPost
    // —— 发出两条重复的公开帖子。只有 LinkedIn 帖子会在 confirm 时真发布、
    // 才需要这道防重复认领；普通视频内容的 confirm 只是入队做片、不对外发，
    // 而且它的选题段合法地包含 rejected（打回后重新确认要能从 rejected →
    // approved），所以绝不能给它加 draft-only 限制，否则重新确认打回内容会
    // 直接 404（真实回归，Codex round 3 P2 挑出）。
    if (isLinkedinConfirm) {
      updateQuery = updateQuery.eq('status', 'draft')
    }

    const { data, error } = await updateQuery.select('id, status, format, source').maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json(
        { error: '未找到该内容，或者已经被处理过了（状态已变，可能刚被别人确认）' },
        { status: 404 },
      )
    }

    // 讲课式不在这里排做片——要先在单讲工作台选制作方式/传录像，直接排必失败(魏征 m2)
    if (body.action === 'confirm' && data.format === '讲课式') {
      return NextResponse.json({ post: data, render: { jobId: null, created: false, reason: '讲课式内容请进该讲的工作台开始做片' } })
    }

    // LinkedIn 进度贴是纯文本、没有做片环节——"确认"在这里就等于"批准发布"。
    // 不能走下面通用的 enqueueRenderJob：那是视频流水线的入口，对一条没有
    // 视频的文本贴只会 best-effort 失败或空转，PM 点了"确认"以为发出去了，
    // 实际上这条贴会永远卡在 approved，从没真正调用过 scheduleSocialPost。
    if (body.action === 'confirm' && data.source === LINKEDIN_PROGRESS_SOURCE) {
      // linkedinAccount 已经在认领这一行之前严格解析过了（见上面），这里
      // 保证非空——不能再让 scheduleSocialPost 自己那套更松的逻辑兜底到
      // "随便一个已连账号"，共享 Publer workspace 里有多个身份时会发错号。
      const result = await scheduleSocialPost({ postId: params.postId, clientId: params.id, account: linkedinAccount! })
      if (!result.ok) {
        return NextResponse.json({ error: `发布失败：${result.error}` }, { status: 500 })
      }
      return NextResponse.json({
        post: { ...data, status: 'scheduled' },
        publish: { publerJobId: result.publerJobId, scheduledAt: result.scheduledAt },
      })
    }

    // 🔴 2026-09-02：旧 Render 拼片管线(ffmpeg 拼接)已退役，没有 worker 再消费 ffmpeg
    // 那条路径。content_work_orders 服务的是广告成片工单，跟这条普通内容语义不通用，
    // 不是替代管线。2026-09-09 重新点亮这个入口——但只对配置了 Creatomate 模板的客户
    // 生效（`factory_config.render.engine === 'creatomate'`），见
    // docs/specs/2026-09-09-creatomate-connector-spec-v1.md §4.1/§4.4。
    // 没配置的客户维持原状：出片仍需人工处理，不强推全量客户。
    // 用 error(不是自造字段)是因为前端 page.tsx 只认 render.error 来判断要不要显示
    // "建做片任务失败"，用别的字段名会被前端忽略、误显示成"正在做片"的假成功提示。
    let render: { jobId: string | null; created: boolean; error?: string } | undefined
    if (body.action === 'confirm') {
      // 复用上面为校验 offer_key 已经读过的同一份配置，不用再打一次库。
      const engine = (factoryConfigForConfirm as { render?: { engine?: string } } | null)?.render?.engine

      if (engine === 'creatomate') {
        const enqueued = await enqueueRenderJob({ clientId: params.id, contentPostId: params.postId })
        if (enqueued.jobId) {
          await supabaseAdmin
            .from('content_factory_render_jobs')
            .update({ render_engine: 'creatomate' })
            .eq('id', enqueued.jobId)
          await sendInngestEvent({
            id: `creatomate-render-requested:${enqueued.jobId}`,
            name: CREATOMATE_RENDER_REQUESTED_EVENT,
            data: { job_id: enqueued.jobId, client_id: params.id, post_id: params.postId },
          })
        }
        render = { jobId: enqueued.jobId, created: enqueued.created }
      } else {
        render = { jobId: null, created: false, error: '出片暂无自动管线，需人工处理这条内容' }
      }
    }

    return NextResponse.json({ post: data, render })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
