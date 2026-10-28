/**
 * Live reads for plan-to-draft. Lead forms and video covers are read-only.
 * Nothing here creates a campaign, ad set, or ad.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { formatBriefForPrompt, getActiveBrief } from '@/lib/content/brief-injector'
import { createKernel } from '@/lib/kernel'
import { fetchPageLeadForms } from '@/lib/meta/lead-forms'
import { GRAPH_BASE } from '@/lib/meta/graph-base'
import { getPageAccessToken } from '@/lib/meta/page-posts'
import { getStoredPageToken, resolveMetaTokenForClient } from '@/lib/meta/token-manager'
import { getTrackingClientConfig } from '@/lib/ads-tracking-preflight/client-config'
import { supabaseAdmin } from '@/lib/supabase'
import type { MasterBrief } from '@/types/magic-engine'
import type { PrescriptionContent } from '@/types/diagnostic'
import { loadAdStrategyConfigWithSource, type CreativePoolEntry } from './config'
import { loadPausedDraftContext } from './paused-draft-context'
import { issuePausedDraftCard } from './paused-draft-submit'
import { collectAdPlays } from './plan-seed/attach'
import { writeDraftCopy } from './plan-to-draft-copy'
import type { AccountFacts, AssemblyDeps, AssemblyPlan, AssemblyState } from './plan-to-draft'

export function productionDeps(): AssemblyDeps {
  return {
    now: () => new Date(),
    loadPlans,
    loadPlays,
    accounts: readAccounts,
    pool: readPool,
    forms: readForms,
    cover: readCover,
    linkUrl: readLink,
    brandText: readBrand,
    copy: writeDraftCopy,
    reviewContext: readReview,
    issue: issueCard,
    save: saveState,
  }
}

export function readAssemblyState(meta: unknown): AssemblyState {
  const state = blankState()
  const raw = record(meta)?.plan_to_draft
  const box = record(raw)
  if (!box) return state
  const copies = record(box.copies)
  if (!copies) return state
  for (const [key, value] of Object.entries(copies)) {
    const pair = record(value)
    const primaryText = pair?.primaryText
    const headline = pair?.headline
    if (typeof primaryText === 'string' && typeof headline === 'string' && primaryText.trim() && headline.trim()) {
      state.copies[key] = { primaryText, headline }
    }
  }
  return state
}

async function loadPlans(clientId: string): Promise<AssemblyPlan[]> {
  const { data, error } = await supabaseAdmin
    .from('marketing_plans')
    .select('id, client_id, title, plan_data, generation_meta')
    .eq('client_id', clientId)
    .eq('status', 'approved')
  if (error) throw new Error('approved plans unreadable')
  const out: AssemblyPlan[] = []
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const plan = planFrom(row)
    if (plan) out.push(plan)
  }
  return out
}

function planFrom(row: Record<string, unknown>): AssemblyPlan | null {
  const data = record(row.plan_data)
  if (!data || !('promo' in data) || typeof row.id !== 'string' || typeof row.client_id !== 'string') return null
  return {
    id: row.id,
    clientId: row.client_id,
    title: typeof row.title === 'string' ? row.title : '',
    promo: data.promo,
    prescriptionId: prescriptionIdOf(row.generation_meta),
    state: readAssemblyState(row.generation_meta),
  }
}

async function loadPlays(clientId: string, prescriptionId: string) {
  const { data, error } = await supabaseAdmin
    .from('prescriptions')
    .select('content')
    .eq('id', prescriptionId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !data) return null
  const content = (data as { content?: unknown }).content
  if (!content || typeof content !== 'object') return []
  return collectAdPlays(content as PrescriptionContent)
}

async function readAccounts(clientId: string): Promise<AccountFacts> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id, facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) return { clientAccountId: null, spendAccountId: null, pageId: null, unreadable: true }
  const row = (data ?? {}) as { meta_ad_account_id?: string | null; facebook_page_id?: string | null }
  const spend = getTrackingClientConfig(clientId)?.spend_ad_account_id
  return {
    clientAccountId: row.meta_ad_account_id ?? null,
    spendAccountId: typeof spend === 'string' && spend.trim() ? spend : null,
    pageId: row.facebook_page_id ?? null,
    unreadable: false,
  }
}

async function readPool(clientId: string): Promise<CreativePoolEntry[] | null> {
  const loaded = await loadAdStrategyConfigWithSource(clientId)
  if (loaded.source === 'fallback') return null
  return loaded.config.creative_pool
}

async function readForms(clientId: string, pageId: string) {
  const token = await pageToken(clientId, pageId)
  if (!token) return { ok: false as const, reason: '表单名单没读到' }
  const res = await fetchPageLeadForms(pageId, token)
  if (res.error !== null) return { ok: false as const, reason: '表单名单没读到' }
  return {
    ok: true as const,
    forms: res.rows.map((row) => ({
      id: row.formId,
      name: row.name,
      active: (row.status ?? '').toUpperCase() === 'ACTIVE',
    })),
  }
}

async function pageToken(clientId: string, pageId: string): Promise<string | null> {
  const stored = await getStoredPageToken(clientId, pageId)
  if (stored) return stored
  const resolved = await resolveMetaTokenForClient(clientId)
  if (!resolved) return null
  return getPageAccessToken(resolved.token, pageId)
}

async function readCover(clientId: string, videoId: string): Promise<string | null> {
  const resolved = await resolveMetaTokenForClient(clientId)
  if (!resolved) return null
  const url = `${GRAPH_BASE}/${encodeURIComponent(videoId)}?fields=picture&access_token=${encodeURIComponent(resolved.token)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const json = await res.json() as { picture?: unknown }
    return typeof json.picture === 'string' && json.picture.startsWith('https://') ? json.picture : null
  } catch {
    return null
  }
}

async function readLink(clientId: string): Promise<string | null> {
  const brief = await getActiveBrief(clientId)
  const site = brief?.website?.trim() ?? ''
  return site.startsWith('https://') ? site : null
}

async function readBrand(clientId: string): Promise<string | null> {
  const brief = await getActiveBrief(clientId)
  if (!brief) return null
  const text = formatBriefForPrompt(briefWithoutPersona(brief)).trim()
  return text === '' ? null : text
}

function briefWithoutPersona(brief: MasterBrief): MasterBrief {
  const voice = brief.brand_voice
  if (!voice || typeof voice !== 'object' || !('persona' in voice)) return brief
  const next = { ...voice }
  delete (next as { persona?: unknown }).persona
  return { ...brief, brand_voice: next }
}

async function readReview(clientId: string, adAccountId: string) {
  return loadPausedDraftContext(supabaseAdmin as SupabaseClient, clientId, adAccountId)
}

async function issueCard(args: Parameters<AssemblyDeps['issue']>[0]) {
  const card = await issuePausedDraftCard({
    kernel: createKernel(supabaseAdmin),
    clientId: args.clientId,
    clicker: { kind: 'agent', email: null },
    draft: { ...args.draft, clientId: args.clientId },
    accountLabel: args.accountLabel,
    review: args.review,
  })
  return { runId: card.runId }
}

async function saveState(plan: AssemblyPlan, state: AssemblyState) {
  const { data, error } = await supabaseAdmin
    .from('marketing_plans')
    .select('generation_meta')
    .eq('id', plan.id)
    .eq('client_id', plan.clientId)
    .maybeSingle()
  if (error) throw new Error('assembly state unreadable')
  const current = record((data as { generation_meta?: unknown } | null)?.generation_meta) ?? {}
  const { error: writeError } = await supabaseAdmin
    .from('marketing_plans')
    .update({ generation_meta: { ...current, plan_to_draft: state } })
    .eq('id', plan.id)
    .eq('client_id', plan.clientId)
  if (writeError) throw new Error('assembly state not saved')
}

function blankState(): AssemblyState {
  return { copies: {}, steps: {} }
}

function prescriptionIdOf(meta: unknown): string | null {
  const box = record(meta)
  const from = record(box?.from_prescription)?.prescription_id
  if (typeof from === 'string' && from) return from
  const agent = record(box?.agent_draft)?.prescription_id
  return typeof agent === 'string' && agent ? agent : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
