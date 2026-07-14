/**
 * scripts/voice/create-demo-tenant.ts
 *
 * Seeds the demo tenants (Magic Engine Demo, CTS Tours, Oztop) + agents + routes +
 * knowledge docs into the configured store. With a live Supabase + applied migration
 * this writes real rows the dashboard can display; otherwise it runs against the
 * in-memory store and prints the result.
 *
 * Usage: npx tsx --env-file=.env.local scripts/voice/create-demo-tenant.ts
 */
import { getVoiceConfig, resetVoiceConfigCache } from '../../src/lib/voice/config'
import { getVoiceStore } from '../../src/lib/voice/store'
import { seedDemoData } from '../../src/lib/voice/seed'

async function main() {
  resetVoiceConfigCache()
  const cfg = getVoiceConfig()
  console.log(`store kind: ${cfg.storeKind}`)
  if (cfg.storeKind === 'supabase') {
    console.log('⚠️  writing to Supabase — requires migration 20260715000001_voice_agent_p0.sql applied.')
  }
  const store = await getVoiceStore()
  const result = await seedDemoData(store)
  console.log('\nseeded tenants:')
  for (const t of result.tenants) {
    console.log(`  ${t.slug}: tenant=${t.tenantId} agent=${t.agentId} route=${t.routeId}`)
  }
  console.log('\n✅ demo seed complete')
}

main().catch((e) => { console.error('❌', (e as Error).message); process.exit(1) })
