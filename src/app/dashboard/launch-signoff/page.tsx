import { redirect } from 'next/navigation'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { signerEmails } from '@/lib/launch-signoff/auth'
import { depsFromEnv } from '@/lib/launch-signoff/http'
import { readState } from '@/lib/launch-signoff/service'
import { ADS_AGENT_CHECKLIST } from '@/lib/launch-signoff/checklists/ads-agent'
import type { DerivedState } from '@/lib/launch-signoff/types'
import SignoffPanel, { type SwitchRow } from './SignoffPanel'

export const dynamic = 'force-dynamic'

interface ConfigRow {
  client_id: string | null
  autopilot_enabled: boolean | null
  autopilot_dry_run: boolean | null
}

interface ClientRow {
  id: string
  name: string | null
}

async function loadSwitchRows(): Promise<{ rows: SwitchRow[]; error: boolean }> {
  try {
    const [configsRes, clientsRes] = await Promise.all([
      supabaseAdmin
        .from('ad_strategy_configs')
        .select('client_id, autopilot_enabled, autopilot_dry_run'),
      supabaseAdmin.from('clients').select('id, name'),
    ])
    if (configsRes.error || clientsRes.error) return { rows: [], error: true }

    const configs = (configsRes.data ?? []) as ConfigRow[]
    const clients = (clientsRes.data ?? []) as ClientRow[]
    const nameById = new Map<string, string>()
    for (const c of clients) nameById.set(c.id, c.name ?? c.id)

    const rows: SwitchRow[] = []
    for (const cfg of configs) {
      const autopilotEnabled = cfg.autopilot_enabled === true
      const dryRun = cfg.autopilot_dry_run !== false
      if (!autopilotEnabled && dryRun) continue
      const id = cfg.client_id ?? ''
      rows.push({
        name: nameById.get(id) ?? (id || '未知客户'),
        autopilotEnabled,
        dryRun,
      })
    }
    return { rows, error: false }
  } catch {
    return { rows: [], error: true }
  }
}

export default async function LaunchSignoffPage() {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) redirect('/dashboard')

  const checklist = ADS_AGENT_CHECKLIST

  let state: DerivedState | null = null
  let loadError = false
  try {
    state = await readState(depsFromEnv(), checklist.featureKey)
  } catch {
    loadError = true
  }

  const canSign = signerEmails().includes((admin.user.email ?? '').toLowerCase())

  const { rows: switchRows, error: switchLoadError } = await loadSwitchRows()

  return (
    <SignoffPanel
      checklist={{
        featureKey: checklist.featureKey,
        title: checklist.title,
        scopeNote: checklist.scopeNote,
        riskLevel: checklist.riskLevel,
        items: checklist.items.map((i) => ({
          key: i.key,
          title: i.title,
          goal: i.goal,
          passCriteria: i.passCriteria,
          owner: i.owner,
          machineVerifiable: i.machineVerifiable,
        })),
      }}
      state={state}
      loadError={loadError}
      canSign={canSign}
      switchRows={switchRows}
      switchLoadError={switchLoadError}
    />
  )
}
