import { supabaseAdmin } from '@/lib/supabase'

interface EnsureSelfServeClientOptions {
  email: string
  displayName?: string | null
  websiteUrl?: string | null
}

interface EnsureSelfServeClientResult {
  clientId: string
  created: boolean
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

function sanitizeDomain(websiteUrl?: string | null): string | null {
  const value = websiteUrl?.trim()
  if (!value) return null

  return value.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() || null
}

function workspaceName(email: string, displayName?: string | null): string {
  const cleanName = displayName?.trim()
  if (cleanName) return `${cleanName} Workspace`

  const localPart = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim()
  return `${localPart || 'Magic Engine'} Workspace`
}

async function bindLatestDiscoveryReport(email: string, clientId: string) {
  const { data: latestScan } = await supabaseAdmin
    .from('public_scan_jobs')
    .select('id, domain, result, client_id')
    .eq('email', email)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latestScan?.id || latestScan.client_id) return

  if (latestScan.result) {
    await supabaseAdmin
      .from('client_discovery')
      .insert({
        client_id: clientId,
        domain: latestScan.domain ?? clientId,
        payload: latestScan.result,
        cost_usd: 0,
        model: 'public-scan',
        tool_calls: 0,
      })
      .then(
        () => undefined,
        err => console.error('[self-serve-client] client_discovery insert failed:', err),
      )
  }

  await supabaseAdmin
    .from('public_scan_jobs')
    .update({ client_id: clientId })
    .eq('id', latestScan.id)
    .then(
      () => undefined,
      err => console.error('[self-serve-client] public_scan_jobs bind failed:', err),
    )
}

export async function ensureSelfServeClientForEmail(
  options: EnsureSelfServeClientOptions,
): Promise<EnsureSelfServeClientResult> {
  const email = normalizeEmail(options.email)

  const { data: existingAccessRows } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id, access_type')
    .eq('email', email)
    .limit(10)

  const existingSelfServe = existingAccessRows?.find(row => row.access_type === 'self_serve')
  if (existingSelfServe?.client_id) {
    return { clientId: existingSelfServe.client_id, created: false }
  }

  if (existingAccessRows?.length) {
    throw new Error('Email already has Magic Engine access')
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .insert({
      name: workspaceName(email, options.displayName),
      domain: sanitizeDomain(options.websiteUrl),
      source: 'self_serve',
    })
    .select('id')
    .single()

  if (clientError || !client?.id) {
    throw new Error(clientError?.message ?? 'Failed to create self-serve client')
  }

  const { error: portalError } = await supabaseAdmin.from('client_portal_users').insert({
    email,
    client_id: client.id,
    display_name: options.displayName?.trim() || workspaceName(email),
    access_type: 'self_serve',
  })

  if (portalError) {
    await supabaseAdmin.from('clients').delete().eq('id', client.id)
    throw new Error(portalError.message)
  }

  await bindLatestDiscoveryReport(email, client.id)

  return { clientId: client.id, created: true }
}
