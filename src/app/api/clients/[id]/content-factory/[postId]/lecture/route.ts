// 单讲工作台 API — 讲课式内容的脚本审改 / 制作方式 / 录像直传 / 重做 / 开始做片。
// GET   详情(结构化脚本 + 制作方式 + 做片任务状态 + 客户 VI 色)
// PATCH { action: save_script | set_method | recording_uploaded | redo_section | regen_script | start_render }
// POST  { fileName } → 录像签名直传 URL(大文件不走 API body，直传存储)

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActiveBrief } from '@/lib/content/brief-injector'
import {
  planLectureScript,
  redoLectureSection,
  xhsCtaViolations,
  type LectureScript,
} from '@/lib/factory/lecture-script'
import {
  loadLecturePost,
  saveLectureScript,
  setLectureProduction,
  type LectureMethod,
} from '@/lib/factory/lecture-post'
import { enqueueRenderJob } from '@/lib/factory/render-queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // redo_section / regen_script 要等 Claude

const BUCKET = 'content-factory'
const ACTIVE_JOB_STATUSES = ['queued', 'planning', 'rendering', 'assembling']

type Params = { params: { id: string; postId: string } }

async function latestJob(postId: string) {
  const { data } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('id, status, error, output_url, updated_at')
    .eq('content_post_id', postId)
    .order('created_at', { ascending: false })
    .limit(1)
  return data?.[0] ?? null
}

export async function GET(_req: NextRequest, { params }: Params) {
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
        renderJob: await latestJob(params.postId),
        viColors,
      },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'CDN-Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

function validateLecturePayload(lecture: LectureScript): string | null {
  if (!lecture?.hookSpoken?.trim()) return '开场钩子不能为空'
  if (!Array.isArray(lecture.sections) || lecture.sections.length === 0) return '至少要有一个教学要点'
  for (const s of lecture.sections) {
    if (!s.spoken?.trim() || !s.slideTitle?.trim()) return '每个要点的口播词和课件标题都不能为空'
    if (!Array.isArray(s.slidePoints)) return '课件要点格式不对'
  }
  const violations = [
    ...xhsCtaViolations(lecture.ctaVariants?.xiaohongshu ?? ''),
    ...xhsCtaViolations(lecture.ctaSpoken ?? ''),
  ]
  if (violations.length > 0) {
    return `小红书版 CTA 和口播 CTA 里不能出现「${violations.join('、')}」——小红书导流会被限流`
  }
  return null
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string
      lecture?: LectureScript
      method?: LectureMethod
      path?: string
      index?: number
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
          return NextResponse.json({ error: "method 必须是 'self_record' / 'digital_human'" }, { status: 400 })
        }
        await setLectureProduction({ clientId: params.id, postId: params.postId, method: body.method })
        return NextResponse.json({ ok: true })
      }

      case 'recording_uploaded': {
        // path 必须落在本讲自己的目录下，防拿别人的文件当自己的录像
        const prefix = `${params.id}/lecture/${params.postId}/`
        if (!body.path || !body.path.startsWith(prefix)) {
          return NextResponse.json({ error: '上传路径不合法' }, { status: 400 })
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

      case 'redo_section': {
        const index = body.index
        if (typeof index !== 'number' || !loaded.lecture.sections[index]) {
          return NextResponse.json({ error: '要重做的段落不存在' }, { status: 400 })
        }
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
      }

      case 'regen_script': {
        const topic = [loaded.post.title, body.instruction].filter(Boolean).join('\n重写要求：')
        const lecture = await planLectureScript({ clientId: params.id, topic })
        await saveLectureScript({ clientId: params.id, postId: params.postId, lecture, backupPrev: true })
        return NextResponse.json({ ok: true, lecture })
      }

      case 'start_render': {
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
        return NextResponse.json({ ok: true, render })
      }

      default:
        return NextResponse.json({ error: '不认识的 action' }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

/** 录像直传：签一个只能写进本讲目录的上传 URL，浏览器直接 PUT 大文件，不过 API。 */
export async function POST(req: NextRequest, { params }: Params) {
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
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
