/**
 * GET /api/clients/[id]/upload-link — 取该客户的免登录素材上传链接。
 *
 * 签名密钥只在服务端,所以链接必须服务端生成。前端只负责显示和复制。
 * 令牌是确定性的(同客户同密钥恒等),所以每次打开设置页拿到的是同一条链接 ——
 * 发给客户之后不会因为我们刷新页面而变。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { createUploadToken, uploadSecret } from '@/lib/uploads/client-upload-token'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const token = createUploadToken(clientId, uploadSecret())
  if (!token) {
    // fail-closed:没有密钥就不发链接,而不是发一条人人可伪造的
    return NextResponse.json(
      { error: '服务器还没配置上传链接的密钥(UPLOAD_LINK_SECRET),暂时发不了链接' },
      { status: 503 },
    )
  }

  // 用请求自身的 origin 拼,本地/预览/生产各自正确,不硬编域名
  const origin = req.nextUrl.origin
  return NextResponse.json({ url: `${origin}/upload/${token}` })
}
