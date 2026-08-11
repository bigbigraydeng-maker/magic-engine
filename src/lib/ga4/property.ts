/**
 * Bind a specific GA4 property to a client (Settings picker write path).
 *
 * Mirrors gbp/location.ts's setGbpLocation, minus the cross-client
 * exclusivity check — a GA4 property visible to more than one ME client is
 * a normal business-structure fact (e.g. shared agency access), not a
 * data-integrity risk the way two clients posting to one GBP storefront
 * would be. See docs/specs/2026-08-11-onboarding-integrations-unify-v1.md §2.4.
 */

import { supabaseAdmin } from '@/lib/supabase'

export async function setGa4Property(
  clientId: string,
  property: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_connected' | 'invalid' }> {
  if (!/^properties\/[^/]+$/.test(property)) {
    return { ok: false, reason: 'invalid' }
  }

  const { data: conn } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id')
    .eq('client_id', clientId)
    .eq('provider', 'google_ga4')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!conn) return { ok: false, reason: 'not_connected' }

  const { error: updateErr } = await supabaseAdmin
    .from('platform_oauth_connections')
    .update({ account_id: property, updated_at: new Date().toISOString() })
    .eq('id', (conn as { id: string }).id)

  if (updateErr) {
    console.error('[ga4/property] failed to update platform_oauth_connections:', updateErr.message)
    return { ok: false, reason: 'not_connected' }
  }

  // 魏征 2026-08-11 复审：每日同步 cron 和 GA4 手动 sync 端点读的是
  // client_connectors.config.property_id，不是 platform_oauth_connections——
  // 只改前者不改后者，FDE 在 settings 页换了 Property、界面显示"已保存"，
  // 但后台一直悄悄同步着旧的那个，没有任何报错。跟合并授权回调里"先写
  // platform_oauth_connections 成功才写 client_connectors"用同一个顺序。
  const now = new Date().toISOString()
  await supabaseAdmin
    .from('client_connectors')
    .upsert(
      {
        client_id:    clientId,
        anchor:       'ga4',
        status:       'connected',
        config:       { property_id: property },
        connected_at: now,
        updated_at:   now,
      },
      { onConflict: 'client_id,anchor' },
    )

  return { ok: true }
}
