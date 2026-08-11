import { requireDashboardClientAccess } from '@/lib/auth/client-access'
// Campaign file upload — PDF / Word / TXT → Supabase Storage
// mirrors /api/clients/[id]/brief/upload pattern

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const MAX_SIZE = 30 * 1024 * 1024 // 30 MB
const CAMPAIGN_BUCKET = 'campaign-uploads'

async function ensureBucket() {
  const { error } = await supabaseAdmin.storage.createBucket(CAMPAIGN_BUCKET, {
    public: false,
    fileSizeLimit: MAX_SIZE,
  })
  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw error
  }
}
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
])

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const clientId = params.id

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ success: false, error: 'File exceeds 30 MB limit' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { success: false, error: 'Only PDF, Word, and TXT files are allowed' },
        { status: 400 }
      )
    }

    const ext = file.name.split('.').pop() ?? 'bin'
    const storagePath = `${clientId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    await ensureBucket()

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(CAMPAIGN_BUCKET)
      .upload(storagePath, await file.arrayBuffer(), {
        contentType: file.type,
        upsert: false,
      })

    if (uploadErr) throw uploadErr

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(CAMPAIGN_BUCKET)
      .getPublicUrl(storagePath)

    return NextResponse.json({
      success: true,
      storage_path: storagePath,
      url: publicUrl,
      filename: file.name,
      size: file.size,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[campaign/upload]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
