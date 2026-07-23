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

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: '上传数据有误,请重试' }, { status: 400 })
  }

  const files = (formData.getAll('files') as File[]).slice(0, MAX_FILES_PER_REQUEST)
  if (files.length === 0) return NextResponse.json({ error: '没有选择文件' }, { status: 400 })

  const uploaded: string[] = []
  const errors: string[] = []

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
          // 🔴 溯源:这是客户自己传的真实素材,不是 AI 生成、也不是图库。
          // 「真价只配真画面」那条红线要靠这个字段判断,必须在入库这一刻就记准。
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
