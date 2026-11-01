// Resend 回调接收口 /api/webhooks/resend/<账号>
// 具体逻辑都在 @/lib/messaging/provider-events/resend-ingest，这里只做壳。
import { NextRequest, NextResponse } from 'next/server'
import { readCappedBody } from '@/lib/telephony/voipline/ingest'
import { handleResendWebhook } from '@/lib/messaging/provider-events/resend-ingest'
import { supabaseProviderEventStore } from '@/lib/messaging/provider-events/store'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ account: string }> }): Promise<NextResponse> {
  const { account } = await ctx.params
  const bodyText = await readCappedBody(req)
  if (bodyText === null) return NextResponse.json({ ok: false, error: 'too_large' }, { status: 413 })
  const result = await handleResendWebhook(supabaseProviderEventStore, {
    account,
    bodyText,
    svixId: req.headers.get('svix-id'),
    svixTimestamp: req.headers.get('svix-timestamp'),
    svixSignature: req.headers.get('svix-signature'),
    env: (n) => process.env[n],
  })
  return NextResponse.json(result.body, { status: result.status })
}
