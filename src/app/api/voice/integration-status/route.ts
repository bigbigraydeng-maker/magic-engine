/** GET /api/voice/integration-status (spec §16.5) — admin only, never leaks secrets. */
import { NextResponse } from 'next/server'
import { getVoiceConfig } from '@/lib/voice/config'
import { requireVoiceAdmin } from '@/lib/voice/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const auth = await requireVoiceAdmin()
  if (auth instanceof NextResponse) return auth

  const cfg = getVoiceConfig()
  const env = cfg.env
  return NextResponse.json({
    store: cfg.storeKind,
    providers: cfg.providers,
    openai: { api_key: Boolean(env.OPENAI_API_KEY) ? 'configured' : 'missing', webhook_secret: Boolean(env.OPENAI_WEBHOOK_SECRET) ? 'configured' : 'missing', realtime_model: env.OPENAI_REALTIME_MODEL },
    telephony: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) ? 'configured' : 'missing',
    whatsapp: Boolean(env.WHATSAPP_ACCESS_TOKEN && env.META_APP_SECRET) ? 'configured' : 'missing',
    sip_route: 'manual setup required',
    outbound_enabled: cfg.outboundEnabled,
    sandbox_test_numbers: cfg.testNumbers.length,
  })
}
