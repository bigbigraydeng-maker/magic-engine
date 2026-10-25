import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticate } from '@/lib/launch-signoff/auth'
import { LaunchSignoffError } from '@/lib/launch-signoff/errors'
import { depsFromEnv, errorResponse } from '@/lib/launch-signoff/http'
import { revokeSignature } from '@/lib/launch-signoff/service'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ feature: string }>
}

const Body = z.object({ note: z.string().min(1).max(2000) })

/** 撤销当前有效签字：同样只收白名单真人会话，必须写原因；历史不删，只新增一条撤销事件。 */
export async function POST(req: Request, { params }: Params) {
  try {
    const actor = await authenticate(req)
    const { feature } = await params
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new LaunchSignoffError('bad_body', 400, '请求格式不对')
    return NextResponse.json(await revokeSignature(depsFromEnv(), actor, feature, parsed.data.note))
  } catch (err) {
    return errorResponse(err)
  }
}
