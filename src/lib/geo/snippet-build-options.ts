/**
 * Load profile + AI-tracking inputs for GEO snippet assembly.
 *
 * Reuses existing loaders (client kind, active brief, YouTube channel target).
 * All reads fail soft — missing columns or query errors yield standard-client output.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { loadClientKind } from '@/lib/huatuo/client-kind'
import { getClientChannelId } from '@/lib/youtube-publish/store'
import type { GeoDirective } from '@/types/magic-engine'
import type { BuildSnippetsOptions } from './snippet-builder'

type ClientSocialRow = {
  contact_name: string | null
  facebook_page_url: string | null
  tiktok_handle: string | null
}

type PersonaShape = { name?: string; role?: string }

export async function loadGeoSnippetBuildOptions(
  supabase: SupabaseClient,
  clientId: string,
  directive: GeoDirective,
): Promise<BuildSnippetsOptions> {
  const clientKind = await loadClientKind(supabase, clientId)
  if (clientKind !== 'personal_ip') {
    return {}
  }

  const [brief, clientRow, youtubeChannelId, aiTrackingQuestions] = await Promise.all([
    getActiveBrief(clientId).catch(() => null),
    loadClientSocialRow(supabase, clientId),
    getClientChannelId(clientId).catch(() => null),
    loadAiTrackingQuestionTexts(supabase, clientId, directive),
  ])

  const persona = (brief?.brand_voice as { persona?: PersonaShape } | null | undefined)?.persona

  return {
    profile: {
      client_kind: clientKind,
      contact_name: clientRow.contact_name,
      persona_name: persona?.name ?? null,
      persona_role: persona?.role ?? null,
      facebook_page_url: clientRow.facebook_page_url,
      tiktok_handle: clientRow.tiktok_handle,
      youtube_channel_id: youtubeChannelId,
    },
    aiTrackingQuestions,
  }
}

async function loadClientSocialRow(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientSocialRow> {
  const empty: ClientSocialRow = {
    contact_name: null,
    facebook_page_url: null,
    tiktok_handle: null,
  }
  const { data, error } = await supabase
    .from('clients')
    .select('contact_name, facebook_page_url, tiktok_handle')
    .eq('id', clientId)
    .maybeSingle<ClientSocialRow>()
  if (error || !data) return empty
  return {
    contact_name: data.contact_name ?? null,
    facebook_page_url: data.facebook_page_url ?? null,
    tiktok_handle: data.tiktok_handle ?? null,
  }
}

async function loadAiTrackingQuestionTexts(
  supabase: SupabaseClient,
  clientId: string,
  directive: GeoDirective,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('ai_visibility_queries')
    .select('question')
    .eq('client_id', clientId)
    .eq('enabled', true)
    .order('created_at', { ascending: true })
    .limit(20)

  if (!error && data?.length) {
    return data
      .map((row) => (typeof row.question === 'string' ? row.question.trim() : ''))
      .filter((q) => q.length > 0)
  }

  return directive.scenarios
    .map((s) => s.trigger.trim())
    .filter((t) => t.length > 0)
}
