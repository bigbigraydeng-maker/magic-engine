/**
 * Business "brain" loader — the knowledge that comes for free from ME's existing
 * client data (CLAUDE.md 护城河: 复用 master_briefs 当脑子).
 *
 * 魏征 #1: reads are keyed ONLY by tenant.client_id (resolved server-side), never
 * by anything the model can influence — prevents cross-client brain leakage.
 *
 * Real path: reads public.master_briefs (active) + public.clients via supabaseAdmin.
 * Mock/test path: tenant.settings.brain (seeded from CTS/Oztop real data).
 */
import type { TenantRow } from './store/types'

export interface BusinessBrain {
  brandName: string
  coreProposition: string | null
  primaryAudience: string | null
  painPoints: string[]
  products: unknown
  tone: string | null
  avoidWords: string[]
  contentPillars: unknown
  redlinePhrases: string[]
  country: string | null
  city: string | null
  /** provenance so we never silently invent business facts (CLAUDE.md 强约束) */
  source: 'master_brief' | 'tenant_settings' | 'minimal'
}

function fromSettings(tenant: TenantRow): BusinessBrain | null {
  const b = (tenant.settings as { brain?: Partial<BusinessBrain> })?.brain
  if (!b) return null
  return {
    brandName: b.brandName ?? tenant.name,
    coreProposition: b.coreProposition ?? null,
    primaryAudience: b.primaryAudience ?? null,
    painPoints: b.painPoints ?? [],
    products: b.products ?? null,
    tone: b.tone ?? null,
    avoidWords: b.avoidWords ?? [],
    contentPillars: b.contentPillars ?? null,
    redlinePhrases: b.redlinePhrases ?? [],
    country: b.country ?? null,
    city: b.city ?? null,
    source: 'tenant_settings',
  }
}

/**
 * Load the business brain for a tenant. Never throws — falls back to a minimal
 * brain built from the tenant name so a call can still proceed.
 */
export async function loadBusinessBrain(tenant: TenantRow): Promise<BusinessBrain> {
  const seeded = fromSettings(tenant)
  if (seeded) return seeded

  if (tenant.client_id) {
    try {
      const { supabaseAdmin } = await import('@/lib/supabase')
      const [{ data: brief }, { data: client }] = await Promise.all([
        supabaseAdmin
          .from('master_briefs')
          .select('brand_name, core_proposition, primary_audience, pain_points, products, tone, avoid_words, content_pillars')
          .eq('client_id', tenant.client_id)
          .eq('is_active', true)
          .maybeSingle(),
        supabaseAdmin
          .from('clients')
          .select('name, country, city, brand_redline_phrases')
          .eq('id', tenant.client_id)
          .maybeSingle(),
      ])
      if (brief || client) {
        return {
          brandName: brief?.brand_name ?? client?.name ?? tenant.name,
          coreProposition: brief?.core_proposition ?? null,
          primaryAudience: brief?.primary_audience ?? null,
          painPoints: brief?.pain_points ?? [],
          products: brief?.products ?? null,
          tone: brief?.tone ?? null,
          avoidWords: brief?.avoid_words ?? [],
          contentPillars: brief?.content_pillars ?? null,
          redlinePhrases: client?.brand_redline_phrases ?? [],
          country: client?.country ?? null,
          city: client?.city ?? null,
          source: 'master_brief',
        }
      }
    } catch {
      // supabase unavailable in this env — fall through to minimal
    }
  }

  return {
    brandName: tenant.name,
    coreProposition: null,
    primaryAudience: null,
    painPoints: [],
    products: null,
    tone: null,
    avoidWords: [],
    contentPillars: null,
    redlinePhrases: [],
    country: null,
    city: null,
    source: 'minimal',
  }
}
