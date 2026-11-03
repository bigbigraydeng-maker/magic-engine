import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticate } from '@/lib/launch-signoff/auth'
import { LaunchSignoffError } from '@/lib/launch-signoff/errors'
import { depsFromEnv, errorResponse } from '@/lib/launch-signoff/http'
import { signChecklist } from '@/lib/launch-signoff/service'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ feature: string }>
}

const Body = z.object({
  watermark: z.number().int().nonnegative(),
  checklistHash: z.string().length(64),
})

/** 签字：只收白名单里的真人登录会话；服务钥匙一律拒绝。写入的快照由服务端重读，不信页面。 */
export async function POST(req: Request, { params }: Params) {
  try {
    const actor = await authenticate(req)
    const { feature } = await params
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new LaunchSignoffError('bad_body', 400, '请求格式不对')
    const event = await signChecklist(depsFromEnv(), actor, {
      featureKey: feature,
      watermark: parsed.data.watermark,
      checklistHash: parsed.data.checklistHash,
    })
    return NextResponse.json(event)
  } catch (err) {
    return errorResponse(err)
  }
}
