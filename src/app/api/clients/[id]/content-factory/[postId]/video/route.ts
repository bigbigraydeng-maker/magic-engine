// 通用「传成片」入口 — 平铺看板里那些不走做片流水线的内容（边走边录口播等），
// 人自己录完，从这里把原始录像交上去。
//
// 为什么单独开一条路由：`source_video_url` 原先只有单讲工作台（lecture/route.ts）能写，
// 非讲课式的内容录完在后台无处可传，流程断在备料和出片之间（PM 2026-08-17 撞到）。
//
// 🔴 2026-08-19 改版：不再是「传了就直接当成片」。PM 反馈传完是纯素材(没剪没字幕)，
//    非常confuse——因为上一版就是设计成「零处理」的，边走边录路线当时讲的是「不修饰」。
//    现在改成：粘的链接先存进 raw_recording_url，排一条 reel-render.ts 的自动剪辑任务
//    (掐头去尾+听写字幕+数字关键词高亮，复用讲课式引擎同款技术)。卡片留在「备料」，
//    做片跑完才会真的挂上 source_video_url、卡片才进「出片」——跟讲课式、AI生成两条
//    管线的语义一致(source_video_url 只在成片真的做完时才有值)。
//
// 讲课式**不走这里** —— 它的成片是系统做出来的，手动挂片会盖掉做片结果。
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { looksLikeVideoResponse, normalizeRecordingLink } from '@/lib/factory/recording-link'
import { safeProbeRemoteFile } from '@/lib/factory/safe-remote-fetch'
import { enqueueRenderJob } from '@/lib/factory/render-queue'
import { saveReelCaptions } from '@/lib/factory/reel-post'

export const dynamic = 'force-dynamic'

const BUCKET = 'content-factory'
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/
/** 做片流水线还没结束的状态 —— 这些状态下不许手动挂片 */
const ACTIVE_JOB_STATUSES = ['queued', 'planning', 'rendering', 'assembling']

type Params = { params: { id: string; postId: string } }

/** 读一条内容，并挡掉讲课式。返回 null = 不存在或不属于该客户。 */
async function loadPost(clientId: string, postId: string) {
  const { data, error } = await supabaseAdmin
    .from('content_posts')
    .select('id, title, format, status, source_video_url')
    .eq('client_id', clientId) // 双重限定，防越权读到别客户的内容
    .eq('id', postId)
    .maybeSingle<{
      id: string
      title: string | null
      format: string | null
      status: string
      source_video_url: string | null
    }>()
  if (error || !data) return null
  return data
}

/**
 * 这条内容是不是正在被流水线做片。
 *
 * 🔴 非讲课式内容在「确认选题」时也会 enqueueRenderJob，做片期间同样停在「备料」。
 *    此时手动挂片，卡片会先进「出片」，等做片跑完 `render-assemble.ts` 又会
 *    无条件覆盖 `source_video_url` —— 人传的片被静默换掉，一句提示都没有。
 *    所以有活跃任务时一律拒绝挂片。
 */
async function hasActiveRenderJob(postId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('id')
    .eq('content_post_id', postId)
    .in('status', ACTIVE_JOB_STATUSES)
    .limit(1)
  return Boolean(data?.length)
}

/**
 * 收下一条原始录像：存进 raw_recording_url 暂存，排一条自动剪辑任务。
 * 不直接碰 source_video_url —— 那个字段只在 reel-render.ts 真的做完成片时才有值，
 * 跟讲课式/AI生成两条管线的语义一致(卡片靠 hasVideo=Boolean(source_video_url) 判断
 * 在不在「出片」列，半路挂个没剪的原始录像上去，看板会显示假的「已出片」)。
 *
 * 三重限定：client_id（防越权改别客户）+ id + **status='approved'**——跟原来 attachVideo
 * 同一条防线，理由不变：不是先读后判，是原子条件，防旧标签页把已排期/已发布的内容改坏。
 * 返回 false = 没命中，状态已经变了。
 */
async function stageRawRecording(
  clientId: string,
  postId: string,
  rawUrl: string,
): Promise<{ ok: boolean; jobId?: string | null }> {
  const { data: existing, error: readErr } = await supabaseAdmin
    .from('content_posts')
    .select('generation_context_snapshot')
    .eq('client_id', clientId)
    .eq('id', postId)
    .eq('status', 'approved')
    .maybeSingle<{ generation_context_snapshot: Record<string, unknown> | null }>()
  if (readErr) throw readErr
  if (!existing) return { ok: false }

  const nextSnap = { ...(existing.generation_context_snapshot ?? {}), raw_recording_url: rawUrl }
  const { data, error } = await supabaseAdmin
    .from('content_posts')
    .update({ generation_context_snapshot: nextSnap })
    .eq('client_id', clientId)
    .eq('id', postId)
    .eq('status', 'approved')
    .select('id')
  if (error) throw error
  if (!data?.length) return { ok: false }

  const { jobId } = await enqueueRenderJob({ clientId, contentPostId: postId })
  return { ok: true, jobId }
}

/**
 * 撤掉：清成片 + 清暂存的原始录像/听写缓存/字幕，三重限定同 stageRawRecording。
 * 返回 false = 没命中，状态已经变了。
 *
 * 🔴 Codex 复审三条，逐条修：
 * ① 读快照那次查询失败时(网络抖一下)，原来直接拿 undefined 当空对象——会在清片
 *    的同时把 generation_context_snapshot 里其它字段全部抹掉。现在读失败就直接
 *    抛错，不猜。
 * ② 只删了 raw_recording_url，没删 reel_transcript/reel_captions——客户清片后
 *    换个内容重新粘同一个链接字符串(如 Dropbox 永久链接换了文件内容但 URL 不变)，
 *    reel-render.ts 会认成"同一条录像"直接复用旧听写，剪出来是上一条内容的字幕。
 * ③ 没让旧的 render_jobs 失效——enqueueRenderJob 对非 failed 任务是幂等的，旧的
 *    ready_for_review 任务会让"清了重传"之后的新任务被当成"已经排过"直接吞掉，
 *    实际根本没有新任务在跑。讲课式 start_render 的"打回重做"就是这么处理的
 *    (先把旧任务标 failed 再 enqueue)，这里照抄同一个模式。
 */
async function clearVideo(clientId: string, postId: string): Promise<boolean> {
  const { data: existing, error: readErr } = await supabaseAdmin
    .from('content_posts')
    .select('generation_context_snapshot')
    .eq('client_id', clientId)
    .eq('id', postId)
    .maybeSingle<{ generation_context_snapshot: Record<string, unknown> | null }>()
  if (readErr) throw readErr

  const nextSnap = { ...(existing?.generation_context_snapshot ?? {}) }
  delete nextSnap.raw_recording_url
  delete nextSnap.reel_transcript
  delete nextSnap.reel_captions

  // 旧任务失效放在 update 之前:即使下面这步没命中(状态已变)，也不该留着可能
  // 阻塞未来任务的旧记录；顺序反过来则有极小概率在两步之间被人抢先排了新任务，
  // 但那种任务本来就该被这次清片作废，不算真正的竞态危害。
  await supabaseAdmin
    .from('content_factory_render_jobs')
    .update({ status: 'failed', error: '被清片替代', updated_at: new Date().toISOString() })
    .eq('content_post_id', postId)
    .neq('status', 'failed')

  const { data, error } = await supabaseAdmin
    .from('content_posts')
    .update({ source_video_url: null, generation_context_snapshot: nextSnap })
    .eq('client_id', clientId)
    .eq('id', postId)
    .eq('status', 'approved')
    .select('id')
  if (error) throw error
  return Boolean(data?.length)
}

const staleResponse = () =>
  NextResponse.json(
    { error: '这条内容的状态已经变了（可能已排期或已发布）— 刷新页面再看一下' },
    { status: 409 },
  )

const busyResponse = () =>
  NextResponse.json(
    { error: '这条正在自动做片，等它做完；要用自己的片就先「打回重做」再挂' },
    { status: 409 },
  )

/**
 * POST — 签一个直传地址回去。
 * body: { fileName }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const body = (await req.json().catch(() => ({}))) as { fileName?: string }
    const post = await loadPost(params.id, params.postId)
    if (!post) return NextResponse.json({ error: '未找到该内容' }, { status: 404 })
    if (post.format === '讲课式') {
      return NextResponse.json(
        { error: '这条是讲课式内容 — 成片由系统做，请进该讲的工作台' },
        { status: 400 },
      )
    }

    if (post.status !== 'approved') return staleResponse()
    if (await hasActiveRenderJob(params.postId)) return busyResponse()

    const ext = (body.fileName ?? '').toLowerCase().match(VIDEO_EXT)?.[1]
    if (!ext) return NextResponse.json({ error: '只支持 mp4 / mov / m4v / webm 视频文件' }, { status: 400 })

    const path = `${params.id}/final/${params.postId}/final-${Date.now()}.${ext}`
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: true })
    if (error || !data) throw error ?? new Error('签名失败')

    return NextResponse.json({ path: data.path, signedUrl: data.signedUrl, token: data.token })
  } catch {
    return NextResponse.json(
      { error: '出错了，刷新页面再试一次；反复出错请直接联系我们' },
      { status: 500 },
    )
  }
}

/**
 * PATCH — action: 'uploaded' | 'link' | 'clear' | 'save_captions'
 *   uploaded:      { path }      直传完成后回调，交上去排队自动剪辑(不是直接挂成片)
 *   link:          { link }      粘一个外链（Dropbox 等），当场探活后交上去排队自动剪辑
 *   clear:         传错了撤掉(连同还没跑完的原始录像暂存一起清)
 *   save_captions: { captions: string[] }  校对字幕后重排一次自动剪辑，用改好的字幕出片
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string
      path?: string
      link?: string
      captions?: string[]
    }
    const post = await loadPost(params.id, params.postId)
    if (!post) return NextResponse.json({ error: '未找到该内容' }, { status: 404 })
    if (post.format === '讲课式') {
      return NextResponse.json(
        { error: '这条是讲课式内容 — 成片由系统做，请进该讲的工作台' },
        { status: 400 },
      )
    }

    // 做片流水线在跑的时候不许碰片（clear 也不行 —— 那只会制造更混乱的中间态）
    if (await hasActiveRenderJob(params.postId)) return busyResponse()

    switch (body.action) {
      case 'uploaded': {
        // 路径必须严格是本条内容目录下、由上面 POST 签出的文件名格式。
        // 不能用 startsWith：`..` 会穿透，而 getPublicUrl 是纯拼串，
        // 下载时 URL 归一化后能指到别的客户目录（lecture 路由踩过，魏征 M1）。
        const pathRe = new RegExp(
          `^${params.id}/final/${params.postId}/final-\\d+\\.(mp4|mov|m4v|webm)$`,
        )
        if (!body.path || !pathRe.test(body.path)) {
          return NextResponse.json(
            { error: '上传没成功，请重新点「传成片」再传一次' },
            { status: 400 },
          )
        }
        const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(body.path)
        const staged = await stageRawRecording(params.id, params.postId, pub.publicUrl)
        if (!staged.ok) return staleResponse()
        return NextResponse.json({ ok: true, queued: true })
      }

      case 'link': {
        const norm = normalizeRecordingLink(body.link ?? '')
        if (!norm.ok || !norm.url) {
          return NextResponse.json({ error: norm.error ?? '这个链接用不了' }, { status: 400 })
        }
        // 探活走逐跳校验的安全版：不许自动跟随跳转，每跳都重新查协议和解析出的 IP。
        // 直接 redirect:'follow' 只校验首个 URL，等于给人一个让服务器代访内网的口子。
        const probe = await safeProbeRemoteFile(norm.url)
        if (!probe.ok) {
          return NextResponse.json({ error: probe.error ?? '这个链接用不了' }, { status: 400 })
        }
        if (!looksLikeVideoResponse(probe.contentType ?? null, probe.finalUrl ?? norm.url)) {
          return NextResponse.json(
            { error: '这个链接指向的不是视频文件 — 对着那条视频本身「复制链接」再粘一次' },
            { status: 400 },
          )
        }
        // 存规范化后的原始链接（不存 finalUrl —— 跳转目标常带一次性签名，会过期）
        const staged = await stageRawRecording(params.id, params.postId, norm.url)
        if (!staged.ok) return staleResponse()
        return NextResponse.json({ ok: true, queued: true })
      }

      case 'clear': {
        if (!(await clearVideo(params.id, params.postId))) return staleResponse()
        return NextResponse.json({ ok: true, videoUrl: null })
      }

      case 'save_captions': {
        if (!Array.isArray(body.captions)) {
          return NextResponse.json({ error: '没收到字幕内容' }, { status: 400 })
        }
        let saved: number
        try {
          ;({ saved } = await saveReelCaptions({ clientId: params.id, postId: params.postId, texts: body.captions }))
        } catch (e) {
          return NextResponse.json(
            { error: e instanceof Error ? e.message : '字幕没保存成功，刷新页面再试一次' },
            { status: 400 },
          )
        }
        // 校对完直接重排一次自动剪辑 —— 别让人还要去别处找「重新做片」(讲课式同款教训:
        // PM 改完以为没生效)。reel-render.ts 会复用听写缓存、用这次校对过的文字出新片。
        const { jobId } = await enqueueRenderJob({ clientId: params.id, contentPostId: params.postId })
        return NextResponse.json({ ok: true, saved, queued: true, jobId })
      }

      default:
        return NextResponse.json(
          { error: "action 必须是 'uploaded' / 'link' / 'clear'" },
          { status: 400 },
        )
    }
  } catch {
    return NextResponse.json(
      { error: '出错了，刷新页面再试一次；反复出错请直接联系我们' },
      { status: 500 },
    )
  }
}
