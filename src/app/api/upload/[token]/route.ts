/**
 * POST /api/upload/[token] — 客户免登录素材上传。
 *
 * 存在理由:客户老板在工地、店员在仓库,拍完随手就传。要求登录 = 没人会用
 * (PM 硬要求「一定要简单:点链接 → 选文件 → 传完」)。
 *
 * 刻意复用既有素材管道,不另起平行系统:文件进 `visual-assets` bucket + `client_assets` 表,
 * 图片由已在跑的 vision-analyzer cron(每 2 分钟一轮)自动打分并给出推荐用法。
 *
 * 鉴权:URL 里的 HMAC 签名令牌(见 lib/uploads/client-upload-token.ts)。
 * 这条链接**只能往这一个客户的素材库写文件** —— 读不到、改不了任何东西。
 *
 * 视频的处理:client_assets.status 的 CHECK 只允许 pending/analyzing/analyzed/error,
 * 加新值要改数据库结构(需 PM 拍板)。所以视频直接落 'analyzed' 并在 vision_metadata
 * 里标明未分析 —— analyzer 只捞 'pending',自然跳过,不会拿视频去调图像接口白烧钱。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { uploadSecret, verifyUploadToken } from '@/lib/uploads/client-upload-token'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const MAX_SIZE_BYTES = 200 * 1024 * 1024 // 视频比图片大得多;手机随手拍一段轻松过 50MB
const MAX_FILES_PER_REQUEST = 20         // 防一次糊上来几百个文件把请求拖死
/** 整个请求体上限。必须在读 body 之前用 content-length 拦,否则 formData() 先把它全缓冲了 */
const MAX_REQUEST_BYTES = 400 * 1024 * 1024
const BUCKET = 'visual-assets'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const clientId = verifyUploadToken(token, uploadSecret())
  // 不区分「令牌错」和「客户不存在」,统一 404:别让人拿这个接口探测客户是否存在
  if (!clientId) return NextResponse.json({ error: '链接无效或已失效' }, { status: 404 })

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .maybeSingle()
  if (!client) return NextResponse.json({ error: '链接无效或已失效' }, { status: 404 })

  // ⚠️ 必须在 formData() 之前拦:formData() 会把整个请求体读进内存,
  // 20 个 200MB 文件 = 4GB 一次性缓冲,进程直接 OOM —— 之后的大小检查救不了它。
  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: '这一批太大了,请分几次传' },
      { status: 413 },
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: '上传数据有误,请重试' }, { status: 400 })
  }

  const allFiles = formData.getAll('files') as File[]
  if (allFiles.length === 0) return NextResponse.json({ error: '没有选择文件' }, { status: 400 })

  const files = allFiles.slice(0, MAX_FILES_PER_REQUEST)
  const uploaded: string[] = []
  const errors: string[] = []

  // 超量的必须如实回报。此前是静默 slice 掉 —— 店员一次选 50 张,只存 20 张,
  // 页面还显示「✅ 收到 50 个」,30 张人间蒸发且双方都不知道(三路审查独立命中)。
  if (allFiles.length > MAX_FILES_PER_REQUEST) {
    errors.push(`一次最多传 ${MAX_FILES_PER_REQUEST} 个,后面 ${allFiles.length - MAX_FILES_PER_REQUEST} 个没传,请再点一次继续传`)
  }

  for (const file of files) {
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type)
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type)
    if (!isImage && !isVideo) {
      errors.push(`${file.name}:不支持的文件类型`)
      continue
    }
    if (file.size > MAX_SIZE_BYTES) {
      errors.push(`${file.name}:文件超过 200MB`)
      continue
    }

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? (isVideo ? 'mp4' : 'jpg')
      const storagePath = `${clientId}/assets/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

      const { error: uploadErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, await file.arrayBuffer(), { contentType: file.type, upsert: false })
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath)

      const { error: dbErr } = await supabaseAdmin.from('client_assets').insert({
        client_id: clientId,
        storage_url: publicUrl,
        original_filename: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        // 图片交给 analyzer;视频标 analyzed 让它跳过(见头注)
        status: isVideo ? 'analyzed' : 'pending',
        vision_metadata: {
          // 溯源:记录「从哪条通道进来的」。**注意它的可信度上限就是通道本身** ——
          // 链接可无限转发,客户完全可能把网图或 AI 生成图从这里传进来。
          // 所以它是「客户主动提供」的证据,**不等于「真实拍摄」**,别拿它直接当
          // 「真价只配真画面」那条红线的判据(目前也确实还没有代码消费它)。
          source: 'client_upload_link',
          uploaded_at: new Date().toISOString(),
          ...(isVideo ? { kind: 'video', analyzed: false, note: '视频未做画面分析' } : { kind: 'image' }),
        },
      })
      if (dbErr) throw dbErr
      uploaded.push(file.name)
    } catch (err) {
      // 对外只说失败,不回显内部错误细节(这是公开接口)
      console.error(`[client-upload] ${clientId} ${file.name}:`, err instanceof Error ? err.message : err)
      errors.push(`${file.name}:上传失败,请重试`)
    }
  }

  return NextResponse.json(
    { ok: uploaded.length > 0, uploaded_count: uploaded.length, errors },
    { status: uploaded.length > 0 ? 201 : 400 },
  )
}
