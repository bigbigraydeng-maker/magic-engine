import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticate } from '@/lib/launch-signoff/auth'
import { LaunchSignoffError } from '@/lib/launch-signoff/errors'
import { depsFromEnv, errorResponse } from '@/lib/launch-signoff/http'
import { haltChecklist, submitItemResult, submitReview, unlockChecklist } from '@/lib/launch-signoff/service'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ feature: string }>
}

const Body = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('item_result'),
    itemKey: z.string().min(1).max(40),
    status: z.enum(['pass', 'fail']),
    evidenceRef: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= 8000, '证据太大'),
    note: z.string().max(2000).optional(),
  }),
  z.object({
    type: z.literal('review'),
    itemKey: z.string().min(1).max(40),
    refEventId: z.number().int().positive(),
    status: z.enum(['pass', 'fail']),
    note: z.string().max(2000).optional(),
  }),
  z.object({ type: z.literal('halt'), note: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('unlock'), note: z.string().min(1).max(2000) }),
])

/**
 * 写测试回执 / 复核 / 锁定 / 解锁。角色由钥匙或会话决定，请求体里**没有**角色字段。
 * 签字与撤销走各自的接口（只收白名单真人会话）。
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const actor = await authenticate(req)
    const { feature } = await params
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new LaunchSignoffError('bad_body', 400, '请求格式不对')
    const body = parsed.data
    const deps = depsFromEnv()
    switch (body.type) {
      case 'item_result':
        return NextResponse.json(
          await submitItemResult(deps, actor, {
            featureKey: feature,
            itemKey: body.itemKey,
            status: body.status,
            evidenceRef: body.evidenceRef,
            ...(body.note !== undefined ? { note: body.note } : {}),
          }),
        )
      case 'review':
        return NextResponse.json(
          await submitReview(deps, actor, {
            featureKey: feature,
            itemKey: body.itemKey,
            refEventId: body.refEventId,
            status: body.status,
            ...(body.note !== undefined ? { note: body.note } : {}),
          }),
        )
      case 'halt':
        return NextResponse.json(await haltChecklist(deps, actor, feature, body.note))
      case 'unlock':
        return NextResponse.json(await unlockChecklist(deps, actor, feature, body.note))
    }
  } catch (err) {
    return errorResponse(err)
  }
}
