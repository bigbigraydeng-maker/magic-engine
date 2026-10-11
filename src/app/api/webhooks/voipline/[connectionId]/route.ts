/**
 * VoIPLine PBX webhook 接收口。每个客户的 PBX 配置各用自己的 URL
 * （路径里的 connectionId 对应一条 telephony_connections），令牌在 X-Pbx-Token 头里。
 * 逻辑都在 `@/lib/telephony/voipline/ingest`，这里只做壳。
 */

import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/lib/inngest/client'
import { handleVoiplineWebhook, readCappedBody } from '@/lib/telephony/voipline/ingest'
import { TELEPHONY_RAW_EVENT_RECEIVED } from '@/lib/telephony/voipline/events-contract'
import { supabaseTelephonyStore } from '@/lib/telephony/voipline/store'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ connectionId: string }> }): Promise<NextResponse> {
  const { connectionId } = await ctx.params
  // 先限大小再读：没令牌的人也不能靠大请求体占内存。
  const bodyText = await readCappedBody(req)
  if (bodyText === null) return NextResponse.json({ status: 'rejected' }, { status: 413 })
  const result = await handleVoiplineWebhook(supabaseTelephonyStore, {
    connectionId,
    tokenHeader: req.headers.get('x-pbx-token'),
    bodyText,
    emit: async (rawEventId, clientId, connId) => {
      await inngest.send({
        name: TELEPHONY_RAW_EVENT_RECEIVED,
        data: { raw_event_id: rawEventId, client_id: clientId, connection_id: connId },
      })
    },
  })
  return NextResponse.json(result.body, { status: result.status })
}
