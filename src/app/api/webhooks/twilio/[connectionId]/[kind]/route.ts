/**
 * Twilio 回调接收口：/api/webhooks/twilio/<连接编号>/<voice|status|dial|recording>
 * 逻辑都在 `@/lib/telephony/twilio/ingest`，这里只做壳。来电（voice）与员工那一段结果（dial）回 TwiML。
 */

import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/lib/inngest/client'
import { readCappedBody } from '@/lib/telephony/voipline/ingest'
import { TELEPHONY_RAW_EVENT_RECEIVED } from '@/lib/telephony/voipline/events-contract'
import { supabaseTelephonyStore } from '@/lib/telephony/voipline/store'
import { handleTwilioWebhook } from '@/lib/telephony/twilio/ingest'

export const dynamic = 'force-dynamic'

/** Twilio 签名用的是它请求的那个公网地址；反向代理后要按转发头还原。 */
function publicBase(req: NextRequest): string {
  const fixed = process.env.TELEPHONY_PUBLIC_BASE_URL
  if (fixed) return fixed.replace(/\/$/, '')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ connectionId: string; kind: string }> }): Promise<NextResponse> {
  const { connectionId, kind } = await ctx.params
  const bodyText = await readCappedBody(req)
  if (bodyText === null) return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', { status: 413, headers: { 'Content-Type': 'text/xml' } })
  const baseUrl = publicBase(req)
  const result = await handleTwilioWebhook(supabaseTelephonyStore, {
    connectionId,
    kind,
    url: `${baseUrl}${req.nextUrl.pathname}${req.nextUrl.search}`,
    baseUrl,
    signature: req.headers.get('x-twilio-signature'),
    bodyText,
    env: (n) => process.env[n],
    emit: async (rawEventId, clientId, connId) => {
      await inngest.send({
        name: TELEPHONY_RAW_EVENT_RECEIVED,
        data: { raw_event_id: rawEventId, client_id: clientId, connection_id: connId },
      })
    },
  })
  return new NextResponse(result.twiml, { status: result.status, headers: { 'Content-Type': 'text/xml' } })
}
