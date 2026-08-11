import { requireDashboardClientAccess } from '@/lib/auth/client-access'
// 单讲工作台 API — 讲课式内容的脚本审改 / 制作方式 / 录像直传 / 重做 / 开始做片。
// GET   详情(结构化脚本 + 制作方式 + 做片任务状态 + 客户 VI 色)
// PATCH { action: save_script | save_captions | publish_facebook | set_method | recording_uploaded | recording_link | section_clip | redo_section | regen_script | start_render }
// POST  { fileName } → 录像签名直传 URL(大文件不走 API body，直传存储)

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActiveBrief } from '@/lib/content/brief-injector'
import {
  planLectureScript,
  redoLectureSection,
  regionMismatch,
  spokenDiversionViolations,
  xhsCtaViolations,
  type LectureScript,
} from '@/lib/factory/lecture-script'
import { looksLikeVideoResponse, normalizeRecordingLink } from '@/lib/factory/recording-link'
import {
  loadLecturePost,
  saveCaptions,
  saveLectureScript,
  setLectureProduction,
  setPublishRequest,
  setSectionClip,
  type LectureMethod,
} from '@/lib/factory/lecture-post'
import { enqueueRenderJob } from '@/lib/factory/render-queue'
import { loadLecturePrefs, recordRedoReason, saveLecturePrefs } from '@/lib/factory/lecture-learning'

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // redo_section / regen_script 要等 Claude

const BUCKET = 'content-factory'
const ACTIVE_JOB_STATUSES = ['queued', 'planning', 'rendering', 'assembling']

type Params = { params: { id: string; postId: string } }

/**
 * 做片失败原因翻成人话再给前端(板桥审:原始 error 含供应商名/黑话，绝不能直出客户屏幕)。
 * 原始 error 留在任务表里给我们排查用。
 */
function humanJobError(raw: string | null): string | null {
  if (!raw) return null
  if (raw.includes('被重做替代')) return raw // 前端据此隐藏，不展示
  if (/API_KEY|未配置|not set|configuration/i.test(raw)) return '系统配置还没弄好，请直接联系我们，我们来处理'
  if (/听写|whisper|语音/i.test(raw)) return '没听清录像里的声音 — 换个安静点的环境重录一条，再点「重新做片」'
  if (/下载失败|录像/.test(raw)) return '录像文件读取失败 — 重新上传一次录像，再点「重新做片」'
  return '做片出错了 — 点「重新做片」再试一次；连续两次失败请直接联系我们'
}

async function latestJob(postId: string) {
  const { data } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('id, status, error, output_url, updated_at')
    .eq('content_post_id', postId)
    .order('created_at', { ascending: false })
    .limit(1)
  const job = data?.[0]
  return job ? { ...job, error: humanJobError(job.error as string | null) } : null
}

export async function GET(_req: NextRequest, { params }: Params) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  try {
    const loaded = await loadLecturePost(params.id, params.postId)
    if (!loaded) return NextResponse.json({ error: '未找到该讲(或不是讲课式内容)' }, { status: 404 })

    const brief = await getActiveBrief(params.id).catch(() => null)
    const viColors = (brief?.vi_colors as Record<string, string> | null) ?? null

    return NextResponse.json(
      {
        post: {
          id: loaded.post.id,
          title: loaded.post.title,
          status: loaded.post.status,
          platforms: loaded.post.platforms ?? [],
          videoUrl: loaded.post.source_video_url,
          lessonNo: loaded.lessonNo,
          source: loaded.post.source,
        },
        lecture: loaded.lecture,
        production: loaded.production,
        captions: loaded.captions ?? [],
        published: loaded.published ?? [],
        publishRequest: loaded.publishRequest ?? null,
        renderJob: await latestJob(params.postId),
        viColors,
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'CDN-Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return NextResponse.json({ error: '出错了，刷新页面再试一次；反复出错请直接联系我们' }, { status: 500 })
  }
}

function validateLecturePayload(lecture: LectureScript): string | null {
  if (!lecture?.hookSpoken?.trim()) return '开场钩子不能为空'
  if (!Array.isArray(lecture.sections) || lecture.sections.length === 0) return '至少要有一个教学要点'
  for (const s of lecture.sections) {
    if (!s.spoken?.trim() || !s.slideTitle?.trim()) return '每个要点的口播词和课件标题都不能为空'
    if (!Array.isArray(s.slidePoints)) return '课件要点格式不对'
  }
  // 魏征 m3:口播也要扫——同一条片的音轨要发小红书。纯 CTA 字段走严格名单，
  // 口播只拦冲观众喊的导流句式(不误杀「用工具自动私信」这类教学内容)。
  // 只有 FB/TikTok 文案版允许「私信」。
  const spokenAll = [lecture.hookSpoken, ...lecture.sections.map((s) => s.spoken)]
  const violations = [
    ...xhsCtaViolations(lecture.ctaVariants?.xiaohongshu ?? ''),
    ...xhsCtaViolations(lecture.ctaSpoken ?? ''),
    ...spokenAll.flatMap((t) => spokenDiversionViolations(t ?? '')),
  ]
  if (violations.length > 0) {
    return `口播和小红书文案里不能出现「${Array.from(new Set(violations)).join('、')}」——这条片要发小红书，带导流词会被限流`
  }
  // 标题写一个地方、内容讲另一个地方 = 课件一放就穿帮(真实事故:标题「澳洲华人」、内容全是奥克兰)
  const region = regionMismatch({
    title: lecture.title ?? '',
    body: [lecture.hookSpoken, ...lecture.sections.map((s) => `${s.spoken} ${s.slidePoints.join(' ')}`)].join(' '),
  })
  if (region) return region
  return null
}

export async function PATCH(req: NextRequest, { params }: Params) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string
      lecture?: LectureScript
      method?: LectureMethod
      path?: string
      link?: string
      index?: number
      clear?: boolean
      captions?: string[]
      redoReason?: string
      instruction?: string
    }
    const loaded = await loadLecturePost(params.id, params.postId)
    if (!loaded) return NextResponse.json({ error: '未找到该讲(或不是讲课式内容)' }, { status: 404 })

    switch (body.action) {
      case 'save_script': {
        if (!body.lecture) return NextResponse.json({ error: '缺少脚本内容' }, { status: 400 })
        const invalid = validateLecturePayload(body.lecture)
        if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })
        await saveLectureScript({ clientId: params.id, postId: params.postId, lecture: body.lecture })
        return NextResponse.json({ ok: true })
      }

      case 'set_method': {
        if (body.method !== 'self_record' && body.method !== 'digital_human') {
          return NextResponse.json({ error: '操作没成功，刷新页面再试一次' }, { status: 400 })
        }
        await setLectureProduction({ clientId: params.id, postId: params.postId, method: body.method })
        return NextResponse.json({ ok: true })
      }

      case 'recording_uploaded': {
        // path 必须严格是本讲目录下 POST 签出的文件名格式(魏征 M1:startsWith 会被 `..` 穿透，
        // getPublicUrl 纯拼串、下载时 URL 归一化后能指到别的客户目录)
        const pathRe = new RegExp(`^${params.id}/lecture/${params.postId}/recording-\\d+\\.(mp4|mov|m4v|webm)$`)
        if (!body.path || !pathRe.test(body.path)) {
          return NextResponse.json({ error: '上传没成功，请重新点「上传你录的视频」再传一次' }, { status: 400 })
        }
        const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(body.path)
        await setLectureProduction({
          clientId: params.id,
          postId: params.postId,
          method: 'self_record',
          recordingUrl: pub.publicUrl,
        })
        return NextResponse.json({ ok: true, recordingUrl: pub.publicUrl })
      }

      case 'recording_link': {
        // 手机录完直接同步 Dropbox → 粘共享链接，比再导出上传快(PM 2026-08-01)
        const norm = normalizeRecordingLink(body.link ?? '')
        if (!norm.ok || !norm.url) {
          return NextResponse.json({ error: norm.error ?? '这个链接用不了' }, { status: 400 })
        }
        // 当场探一下能不能真下到视频——别拖到做片时才失败(dl=0 的分享页会返回网页)
        let head: Response
        try {
          head = await fetch(norm.url, {
            headers: { Range: 'bytes=0-1023' },
            redirect: 'follow',
            signal: AbortSignal.timeout(20000),
          })
        } catch {
          return NextResponse.json({ error: '打不开这个链接 — 确认链接没过期、并且设成「知道链接的人都能看」' }, { status: 400 })
        }
        if (!head.ok && head.status !== 206) {
          return NextResponse.json({ error: '打不开这个链接 — 确认链接没过期、并且设成「知道链接的人都能看」' }, { status: 400 })
        }
        if (!looksLikeVideoResponse(head.headers.get('content-type'), norm.url)) {
          return NextResponse.json({ error: '这个链接指向的不是视频文件 — 在 Dropbox 里对着那条视频本身「复制链接」再粘一次' }, { status: 400 })
        }
        await setLectureProduction({
          clientId: params.id,
          postId: params.postId,
          method: 'self_record',
          recordingUrl: norm.url,
        })
        return NextResponse.json({ ok: true, recordingUrl: norm.url })
      }

      case 'publish_facebook': {
        // 只登记请求,真发交给后台 cron —— 发布要等 Facebook 拉几十 MB 视频,
        // 塞在网页请求里会被网关掐断(真实事故:PM 点了拿到 HTTP 502)。
        if (!loaded.post.source_video_url) {
          return NextResponse.json({ error: '还没有成片 — 先做完片再发' }, { status: 400 })
        }
        if (loaded.publishRequest?.status === 'pending' || loaded.publishRequest?.status === 'sending') {
          return NextResponse.json({ error: '已经在发了，等几分钟看结果' }, { status: 409 })
        }
        // live=true 才真的公开;不填一律只发草稿。这个决定跟着这一条片走,
        // 不再靠一个「一开全客户都真发」的全局开关。
        const live = body.live === true
        // 发到哪个平台。不填按 Facebook 走(老调用方一行不用改)。
        const platform = body.platform === 'tiktok' ? 'tiktok' as const : 'facebook' as const
        if (live && !loaded.captions?.length) {
          return NextResponse.json(
            { error: '还没校准过字幕 — 公开发之前先看一遍第⑥步' },
            { status: 400 },
          )
        }
        await setPublishRequest({
          clientId: params.id,
          postId: params.postId,
          request: { platform, status: 'pending', live, requestedAt: new Date().toISOString() },
        })
        return NextResponse.json({ ok: true, queued: true, live, platform })
      }

      case 'save_captions': {
        // 客户校准字幕:只收文字，时间沿用(改时间容易和口型对不上)
        if (!Array.isArray(body.captions)) {
          return NextResponse.json({ error: '没收到字幕内容' }, { status: 400 })
        }
        try {
          const { saved } = await saveCaptions({
            clientId: params.id,
            postId: params.postId,
            texts: body.captions,
          })
          return NextResponse.json({ ok: true, saved })
        } catch (e) {
          return NextResponse.json(
            { error: e instanceof Error ? e.message : '字幕没保存成功，刷新页面再试一次' },
            { status: 400 },
          )
        }
      }

      case 'section_clip': {
        // 给某个教学要点配录屏(讲到那段时上半屏换成录屏画面)。clear=true 则取消。
        const index = body.index
        if (typeof index !== 'number' || !loaded.lecture.sections[index]) {
          return NextResponse.json({ error: '这个要点不存在，刷新页面再试一次' }, { status: 400 })
        }
        if (body.clear) {
          await setSectionClip({ clientId: params.id, postId: params.postId, index, url: null })
          return NextResponse.json({ ok: true })
        }
        const norm = normalizeRecordingLink(body.link ?? '')
        if (!norm.ok || !norm.url) {
          return NextResponse.json({ error: norm.error ?? '这个链接用不了' }, { status: 400 })
        }
        let probe: Response
        try {
          probe = await fetch(norm.url, {
            headers: { Range: 'bytes=0-1023' },
            redirect: 'follow',
            signal: AbortSignal.timeout(20000),
          })
        } catch {
          return NextResponse.json({ error: '打不开这个链接 — 确认链接没过期、并且设成「知道链接的人都能看」' }, { status: 400 })
        }
        if ((!probe.ok && probe.status !== 206) || !looksLikeVideoResponse(probe.headers.get('content-type'), norm.url)) {
          return NextResponse.json({ error: '这个链接指向的不是视频 — 在 Dropbox 里对着那条录屏「复制链接」再粘一次' }, { status: 400 })
        }
        await setSectionClip({ clientId: params.id, postId: params.postId, index, url: norm.url })
        return NextResponse.json({ ok: true })
      }

      case 'redo_section': {
        const index = body.index
        if (typeof index !== 'number' || !loaded.lecture.sections[index]) {
          return NextResponse.json({ error: '要重做的段落不存在，刷新页面再试一次' }, { status: 400 })
        }
        try {
          const section = await redoLectureSection({
            clientId: params.id,
            lecture: loaded.lecture,
            sectionIndex: index,
            instruction: body.instruction,
          })
          const lecture: LectureScript = {
            ...loaded.lecture,
            sections: loaded.lecture.sections.map((s, i) => (i === index ? section : s)),
          }
          await saveLectureScript({ clientId: params.id, postId: params.postId, lecture, backupPrev: true })
          return NextResponse.json({ ok: true, lecture })
        } catch {
          // AI 生成失败的原始报错含供应商名/英文黑话，不给客户看
          return NextResponse.json({ error: '这段没重写成功 — 等半分钟再点一次；反复失败请直接联系我们' }, { status: 502 })
        }
      }

      case 'regen_script': {
        try {
          const topic = [loaded.post.title, body.instruction].filter(Boolean).join('\n重写要求：')
          const lecture = await planLectureScript({ clientId: params.id, topic })
          await saveLectureScript({ clientId: params.id, postId: params.postId, lecture, backupPrev: true })
          return NextResponse.json({ ok: true, lecture })
        } catch {
          return NextResponse.json({ error: '重写没成功 — 等半分钟再点一次；反复失败请直接联系我们' }, { status: 502 })
        }
      }

      case 'start_render': {
        // 魏征 M4:已排发/已发布的内容不许再悄悄换片——发出去的必须和审过的是同一条
        if (loaded.post.status === 'scheduled' || loaded.post.status === 'published') {
          return NextResponse.json({ error: '这条已经进发布了，不能再重做。真要换，先联系我们把它撤下来' }, { status: 409 })
        }
        const production = loaded.production
        if (!production?.method) {
          return NextResponse.json({ error: '先选制作方式(自己录 / 数字人)' }, { status: 400 })
        }
        if (production.method === 'self_record' && !production.recording_url) {
          return NextResponse.json({ error: '还没有上传你录的视频' }, { status: 400 })
        }
        const job = await latestJob(params.postId)
        if (job && ACTIVE_JOB_STATUSES.includes(job.status)) {
          return NextResponse.json({ error: '正在做片中，等这一条做完(或失败)再重来' }, { status: 409 })
        }
        // 打回重做：把旧的完成/失败任务标掉，再排新任务(enqueue 对非 failed 任务幂等)
        await supabaseAdmin
          .from('content_factory_render_jobs')
          .update({ status: 'failed', error: '被重做替代', updated_at: new Date().toISOString() })
          .eq('content_post_id', params.postId)
          .neq('status', 'failed')
        await supabaseAdmin
          .from('content_posts')
          .update({ status: 'approved' })
          .eq('client_id', params.id)
          .eq('id', params.postId)
        const render = await enqueueRenderJob({ clientId: params.id, contentPostId: params.postId })

        // 记一次打回原因(客户可不填)。同一个原因反复出现 = 系统该改的地方，不是客户该忍的
        let suggestRule = false
        if (body.redoReason?.trim()) {
          try {
            const prefs = await loadLecturePrefs(params.id)
            const res = recordRedoReason(prefs.redoReasons, body.redoReason, new Date().toISOString())
            await saveLecturePrefs(params.id, { redoReasons: res.reasons })
            suggestRule = res.suggestRule
          } catch { /* 记不上不影响重做 */ }
        }
        return NextResponse.json({ ok: true, render, suggestRule })
      }

      default:
        return NextResponse.json({ error: '操作没成功，刷新页面再试一次' }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({ error: '出错了，刷新页面再试一次；反复出错请直接联系我们' }, { status: 500 })
  }
}

/** 录像直传：签一个只能写进本讲目录的上传 URL，浏览器直接 PUT 大文件，不过 API。 */
export async function POST(req: NextRequest, { params }: Params) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { fileName?: string }
    const loaded = await loadLecturePost(params.id, params.postId)
    if (!loaded) return NextResponse.json({ error: '未找到该讲(或不是讲课式内容)' }, { status: 404 })

    const ext = (body.fileName ?? '').toLowerCase().match(/\.(mp4|mov|m4v|webm)$/)?.[1]
    if (!ext) return NextResponse.json({ error: '只支持 mp4 / mov / m4v / webm 视频文件' }, { status: 400 })

    const path = `${params.id}/lecture/${params.postId}/recording-${Date.now()}.${ext}`
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
    if (error || !data) throw error ?? new Error('签名失败')

    return NextResponse.json({ path: data.path, signedUrl: data.signedUrl, token: data.token })
  } catch (err) {
    return NextResponse.json({ error: '出错了，刷新页面再试一次；反复出错请直接联系我们' }, { status: 500 })
  }
}
