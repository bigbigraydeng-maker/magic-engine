/**
 * scripts/voice/verify-integrations.ts
 *
 * Reports the resolved provider modes + store kind + outbound posture WITHOUT
 * leaking any secret values (spec §16.5). Exits non-zero if production is
 * misconfigured (a required provider silently fell back to mock).
 *
 * Usage: npx tsx --env-file=.env.local scripts/voice/verify-integrations.ts
 */
import { getVoiceConfig, resetVoiceConfigCache } from '../../src/lib/voice/config'

function state(present: boolean): string {
  return present ? 'configured' : 'missing'
}

async function main() {
  resetVoiceConfigCache()
  let cfg
  try {
    cfg = getVoiceConfig()
  } catch (e) {
    console.error(`❌ config invalid: ${(e as Error).message}`)
    process.exit(1)
  }
  const env = cfg.env

  console.log('=== Magic Engine Voice Agent — integration status ===')
  console.log(`NODE_ENV:            ${env.NODE_ENV}`)
  console.log(`store:               ${cfg.storeKind}`)
  console.log(`provider modes:      openai=${cfg.providers.openai} telephony=${cfg.providers.telephony} whatsapp=${cfg.providers.whatsapp}`)
  console.log('')
  console.log(`OpenAI API key:      ${state(Boolean(env.OPENAI_API_KEY))}`)
  console.log(`OpenAI webhook secret:${state(Boolean(env.OPENAI_WEBHOOK_SECRET))}`)
  console.log(`OpenAI realtime model:${env.OPENAI_REALTIME_MODEL}`)
  console.log(`Twilio:              ${state(Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN))}`)
  console.log(`WhatsApp:            ${state(Boolean(env.WHATSAPP_ACCESS_TOKEN && env.META_APP_SECRET))}`)
  console.log('')
  console.log(`OUTBOUND_CALLING_ENABLED: ${cfg.outboundEnabled}`)
  console.log(`sandbox test numbers:     ${cfg.testNumbers.length} configured`)
  console.log('')
  console.log('SIP route:           manual setup required (see docs/voice-agent/SIP_SETUP.md)')

  if (cfg.isProd) {
    const fellBack = Object.entries(cfg.providers).filter(([, m]) => m === 'mock').map(([k]) => k)
    if (fellBack.length) {
      console.error(`\n❌ production has providers in mock mode: ${fellBack.join(', ')}`)
      process.exit(1)
    }
  }
  console.log('\n✅ config OK')
}

main().catch((e) => { console.error(e); process.exit(1) })
