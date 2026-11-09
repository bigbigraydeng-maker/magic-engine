import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/launch-signoff/auth'
import { depsFromEnv, errorResponse } from '@/lib/launch-signoff/http'
import { readState } from '@/lib/launch-signoff/service'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ feature: string }>
}

/** 读当前状态。读失败返回 500（页面显示“读取失败”并禁用签字），绝不当成“没测”。 */
export async function GET(req: Request, { params }: Params) {
  try {
    await authenticate(req)
    const { feature } = await params
    return NextResponse.json(await readState(depsFromEnv(), feature))
  } catch (err) {
    return errorResponse(err)
  }
}
