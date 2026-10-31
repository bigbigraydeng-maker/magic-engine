/**
 * 通话后选模板的「预览」：渲染 + 文字检查 + 频次（只读）+ 通话依据。
 * 渲染、文字检查、频次、通话依据用的是**和真发送同一批函数**（renderTemplate / evaluateContentGates /
 * evaluateFrequency / decideCallBasis），所以面板上看到的和点发送那一刻判断的不会各说各话。
 * 预览不写任何东西、不碰 Graph 之外的外部服务。
 */

import { getProvider } from './facts/registry'
import type { FactProvider, PickInput, PickOption, RenderFacts } from './facts/types'
import type { EffectiveEmailConfig } from './effective-config'
import { evaluateContentGates } from './gates/content-gates'
import { evaluateFrequency } from './gates/frequency'
import type { GateViolation } from './gates/types'
import { renderTemplate } from './render'
import {
  DEFAULT_TIME_ZONE,
  computeCallWhen,
  decideCallBasis,
  resolveTimeZone,
  todayInZone,
  type SendGateData,
} from './send-gates'
import { checkTemplateSendable } from './template-store'
import type { CallBasis, FactSource, PickMode } from './types'

export interface PreviewRequest {
  key: string
  picks: PickInput[]
  inputs: Record<string, string>
  callBasis: CallBasis
  /** The staff member's edited text. When present the checks run on it instead of the fresh render. */
  subject?: string
  body?: string
}

export interface PreviewArgs {
  clientId: string
  contactId: string
  sentByEmail: string
  config: EffectiveEmailConfig
  request: PreviewRequest
  now: Date
}

export interface PreviewFrequency {
  state: 'off' | 'ok' | 'capped' | 'unverifiable'
  count: number | null
  max: number | null
  windowDays: number | null
  nextAllowedAt: string | null
  items: Array<{ source: string; at: string; subject: string | null }>
  error: string | null
}

export type PreviewResult =
  | { ok: false; status: 404 | 409 | 503; reason: string; error: string }
  | {
      ok: true
      template: { key: string; version: number; name: string; pickMode: PickMode; factSource: FactSource }
      catalogVersion: number | null
      options: PickOption[]
      pickProblem: string | null
      rendered: { subject: string; body: string; missing: string[]; problems: string[] }
      /** The block the server appends after the staff member's text on every send; shown so the preview is the whole mail. */
      footer: string | null
      blocks: GateViolation[]
      warnings: GateViolation[]
      callBasis: CallBasis
      callEvidenceAt: string | null
      frequency: PreviewFrequency
    }

const FREQUENCY_CACHE_MS = 60_000
const frequencyCache = new Map<string, { at: number; value: PreviewFrequency }>()

export function clearPreviewCache(): void {
  frequencyCache.clear()
}

const refuse = (status: 404 | 409 | 503, reason: string, error: string): PreviewResult => ({ ok: false, status, reason, error })

async function frequencyFor(args: PreviewArgs, addresses: string[], data: SendGateData): Promise<PreviewFrequency> {
  const cap = args.config.frequencyCap
  if (cap === null) return { state: 'off', count: null, max: null, windowDays: null, nextAllowedAt: null, items: [], error: null }
  const key = `${args.clientId}:${args.contactId}`
  const cached = frequencyCache.get(key)
  if (cached !== undefined && args.now.getTime() - cached.at < FREQUENCY_CACHE_MS) return cached.value
  const verdict = await evaluateFrequency({ cap, now: args.now, addresses, contactId: args.contactId, sources: data.frequencySources })
  let value: PreviewFrequency
  if (verdict.ok) {
    value = { state: 'ok', count: verdict.count, max: cap.max, windowDays: cap.windowDays, nextAllowedAt: null, items: [], error: null }
    value.items = verdict.items.map((i) => ({ source: i.source, at: i.at, subject: i.subject }))
  } else if (verdict.reason === 'frequency_cap') {
    value = {
      state: 'capped',
      count: verdict.count,
      max: cap.max,
      windowDays: cap.windowDays,
      nextAllowedAt: verdict.nextAllowedAt,
      items: verdict.items.map((i) => ({ source: i.source, at: i.at, subject: i.subject })),
      error: null,
    }
  } else {
    value = { state: 'unverifiable', count: null, max: cap.max, windowDays: cap.windowDays, nextAllowedAt: null, items: [], error: verdict.error }
  }
  frequencyCache.set(key, { at: args.now.getTime(), value })
  return value
}

interface PickState {
  options: PickOption[]
  pickProblem: string | null
  facts: RenderFacts | null
  catalogVersion: number | null
  provider: FactProvider | null
}

/**
 * A template with no content source still has its links checked against the published catalog (same as the real send),
 * but offers nothing to pick and has no catalog version of its own.
 */
async function linkOnlyState(args: PreviewArgs, data: SendGateData, tz: string): Promise<PickState | PreviewResult> {
  const none: PickState = { options: [], pickProblem: null, facts: null, catalogVersion: null, provider: null }
  const settings = args.config.providers.publishedTours
  const provider = getProvider('published_tours')
  if (settings === undefined || provider === null) return none
  const loaded = await data.loadFacts(args.clientId, todayInZone(args.now, tz))
  if (!loaded.ok) return refuse(503, 'catalog_unreadable', '团目录暂时读不到，先别发。')
  return { ...none, provider, facts: { tours: loaded.tours, picks: [], settings, linkHosts: args.config.guardrails.allowedLinkHosts } }
}

async function pickState(
  args: PreviewArgs,
  tpl: { factSource: FactSource; pickMode: PickMode; pickFilter: Parameters<FactProvider['listPickOptions']>[1] },
  data: SendGateData,
  tz: string,
): Promise<PickState | PreviewResult> {
  if (tpl.factSource === 'none') return linkOnlyState(args, data, tz)
  const provider = getProvider(tpl.factSource)
  if (provider === null) return refuse(503, 'internal_error', '这个模板用的事实来源现在不可用。')
  const loaded = await data.loadFacts(args.clientId, todayInZone(args.now, tz))
  if (!loaded.ok) return refuse(503, 'catalog_unreadable', '团目录暂时读不到，先别发。')
  let picks: RenderFacts['picks'] = []
  let pickProblem: string | null = null
  if (args.request.picks.length > 0) {
    const resolved = provider.resolvePicks(loaded.tours, args.request.picks, tpl.pickFilter, tpl.pickMode)
    if (resolved.ok) {
      const sellable = provider.sellable(resolved.picks)
      if (sellable.ok) picks = resolved.picks
      else pickProblem = sellable.detail
    } else {
      pickProblem = resolved.detail
    }
  }
  return {
    options: provider.listPickOptions(loaded.tours, tpl.pickFilter),
    pickProblem,
    facts: { tours: loaded.tours, picks, settings: args.config.providers.publishedTours ?? null, linkHosts: args.config.guardrails.allowedLinkHosts },
    catalogVersion: loaded.version,
    provider,
  }
}

export async function previewTemplate(
  args: PreviewArgs,
  data: SendGateData,
  opts: { timeZone?: string } = {},
): Promise<PreviewResult> {
  const tz = await resolveTimeZone(data, args.clientId, opts.timeZone ?? DEFAULT_TIME_ZONE)
  const tpl = await data.loadTemplate(args.clientId, args.request.key)
  const sendable = checkTemplateSendable(tpl, tpl === null ? 0 : tpl.version)
  if (!sendable.ok || tpl === null) return refuse(409, 'template_unavailable', '这个模板现在不能用了（已停用或不存在）。')

  const view = await data.loadContactView(args.clientId, args.contactId, args.config.callPromptHours, args.now)
  if (view === null) return refuse(404, 'not_found', '找不到这个客人。')

  const state = await pickState(args, tpl, data, tz)
  if ('ok' in state) return state

  const callBasis = decideCallBasis(args.request.callBasis, view.callEvidenceAt)
  const senderName = await data.loadSenderName(args.clientId, args.sentByEmail).catch(() => null)
  const rendered = renderTemplate(tpl, {
    contactName: view.displayName,
    senderDisplayName: senderName,
    callWhen: computeCallWhen(callBasis, view.callEvidenceAt, args.now, tz),
    inputs: args.request.inputs,
    facts: state.facts,
    provider: state.provider,
  })
  const checked = evaluateContentGates({
    subject: args.request.subject ?? rendered.subject,
    body: args.request.body ?? rendered.body,
    footer: args.config.footer,
    settings: { guardrails: args.config.guardrails },
    provider: state.provider,
    facts: state.facts,
  })
  const frequency = await frequencyFor(args, view.addresses, data)

  return {
    ok: true,
    template: { key: tpl.templateKey, version: tpl.version, name: tpl.name, pickMode: tpl.pickMode, factSource: tpl.factSource },
    catalogVersion: state.catalogVersion,
    options: state.options,
    pickProblem: state.pickProblem,
    rendered: { subject: rendered.subject, body: rendered.body, missing: rendered.missing, problems: rendered.problems },
    footer: args.config.footer,
    blocks: checked.blocks,
    warnings: checked.warnings,
    callBasis,
    callEvidenceAt: view.callEvidenceAt,
    frequency,
  }
}
