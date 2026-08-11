import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { uploadBriefFile } from '@/lib/brief/storage'

/**
 * POST /api/clients/[id]/brief/upload
 * multipart/form-data with field: file
 * Returns the storage_path for use in the generate request.
 */
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

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await uploadBriefFile({
      clientId: params.id,
      file: buffer,
      filename: file.name,
      contentType: file.type,
    })

    return NextResponse.json({ success: true, file: result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    const status = message.includes('Unsupported') || message.includes('too large') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
