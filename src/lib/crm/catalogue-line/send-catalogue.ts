/**
 * One click, one catalogue mail: the server side of the "send the catalogue" button.
 * Design: docs/specs/2026-11-09-crm-catalogue-send-b0-b3-design-v0.md §3.5.
 *
 * Order (any step that fails stops, with the reason in plain Chinese):
 *   settings (versioned, catalogue configured, not expired) → the catalogue line's own eligibility → this guest has
 *   not been sent the catalogue already (another request, sent or outcome unknown, in the last CATALOGUE_ONCE_DAYS:
 *   a second click from another tab, another staff member or the guest's own card is refused here, whichever button
 *   it came from) → the catalogue template (active, no picks, no content source, no staff-typed boxes) → a server-side render with no gaps or blocks
 *   → sendTemplateEmail, where every send gate runs again (cap, cooldown, do-not-contact, allow-list, link checks,
 *   the catalogue gate).
 *
 * Only orchestration lives here: no mail channel, no client names. The text of the mail is the client's template.
 */

import type { EffectiveEmailConfig } from '@/lib/crm/email-templates/effective-config'
import { effectiveFromSettings } from '@/lib/crm/email-templates/effective-config'
import { isCatalogueExpired } from '@/lib/crm/email-templates/render'
import type { LoadSettingsResult } from '@/lib/crm/email-templates/settings-store'
import type { SendCrash, SendTemplateEmailArgs } from '@/lib/crm/email-templates/send-template-email'
import { todayInZone } from '@/lib/crm/email-templates/send-gates'
import type { PreviewArgs, PreviewResult } from '@/lib/crm/email-templates/template-preview'
import type { SendMailNewReason, SendMailNewResult } from '@/lib/microsoft/mail-send-new'
import { checkCatalogueEligibility, type EligibilityData, type EligibilityRefusal } from './eligibility'

export interface SendCatalogueArgs {
  clientId: string
  contactId: string
  /** The signed-in staff member, from the access check only. Never from the request body. */
  actorEmail: string
  /** One UUID per click of the button: a double click or a retry with the same id sends once. */
  requestId: string
  /** The address the button showed; a different one at send time is refused. */
  expectedRecipient: string
}

export type CatalogueRefusal =
  | EligibilityRefusal
  | 'settings_unavailable'
  | 'catalogue_not_configured'
  | 'catalogue_expired'
  | 'catalogue_template_invalid'
  | 'catalogue_render_failed'
  | 'catalogue_already_sent'
  | 'catalogue_history_unreadable'

export type SendCatalogueResult =
  | {
      ok: true
      messageId: string
      conversationId: string
      duplicate: boolean
      templateKey: string
      templateVersion: number
      versionLabel: string
      settingsVersion: number
    }
  | { ok: false; status: number; reason: CatalogueRefusal | SendMailNewReason; message: string; mayHaveSent: boolean }

export interface CatalogueDeps {
  loadSettings(clientId: string): Promise<LoadSettingsResult>
  loadTimeZone(clientId: string): Promise<string>
  eligibility: EligibilityData
  /**
   * When this guest was last sent this catalogue template by ANOTHER request (sent, or outcome not yet known) since
   * `sinceIso`; null = never. Throws when it cannot be read (the send is then refused).
   */
  catalogueSentAt(q: { clientId: string; contactId: string; templateKey: string; exceptRequestId: string; sinceIso: string }): Promise<string | null>
  preview(args: PreviewArgs): Promise<PreviewResult>
  send(args: SendTemplateEmailArgs): Promise<SendMailNewResult | SendCrash>
  now(): Date
}

/** One catalogue per guest per catalogue season: a second one inside this window is refused. */
export const CATALOGUE_ONCE_DAYS = 180

const MESSAGES: Record<Exclude<CatalogueRefusal, EligibilityRefusal>, string> = {
  settings_unavailable: '这个客户的发信设置还没开通或无效，目录没有发出。',
  catalogue_not_configured: '这个客户还没配目录，目录没有发出。',
  catalogue_expired: '手册已过期，目录没有发出。请等新版手册换上后再发。',
  catalogue_template_invalid: '目录信模板不能用（已停用、要选团、或要手填内容），目录没有发出，请找 Magic Lab 团队。',
  catalogue_render_failed: '目录信生成不完整（缺内容或没过文字检查），目录没有发出。',
  catalogue_already_sent: '这位客人已经发过目录了（或上一封的结果还没确认），没有再发。',
  catalogue_history_unreadable: '暂时查不到这位客人有没有收过目录，目录没有发出，请稍后再试。',
}

type Refusal = Extract<SendCatalogueResult, { ok: false }>

function refuse(status: number, reason: Exclude<CatalogueRefusal, EligibilityRefusal>, extra?: string): Refusal {
  const base = MESSAGES[reason]
  return { ok: false, status, reason, message: extra ? `${base}（${extra}）` : base, mayHaveSent: false }
}

interface Ready {
  config: EffectiveEmailConfig
  settingsVersion: number
  catalogue: NonNullable<EffectiveEmailConfig['providers']['catalogue']>
}

async function readyConfig(args: SendCatalogueArgs, deps: CatalogueDeps, now: Date): Promise<Ready | Refusal> {
  let settings: LoadSettingsResult
  let zone: string
  try {
    settings = await deps.loadSettings(args.clientId)
    zone = await deps.loadTimeZone(args.clientId)
  } catch {
    return refuse(503, 'settings_unavailable')
  }
  if (settings.kind !== 'ok' || !settings.settings.enabled) return refuse(409, 'settings_unavailable')
  const config = effectiveFromSettings(settings.settings, settings.version)
  const catalogue = config.providers.catalogue
  if (catalogue === undefined) return refuse(409, 'catalogue_not_configured')
  if (isCatalogueExpired(catalogue.validUntil, todayInZone(now, zone))) {
    return refuse(409, 'catalogue_expired', `有效期到 ${catalogue.validUntil}`)
  }
  return { config, settingsVersion: settings.version, catalogue }
}

type Rendered = { subject: string; body: string; templateVersion: number }

/** The catalogue template, rendered on the server exactly as the preview would show it. */
async function renderCatalogue(args: SendCatalogueArgs, ready: Ready, deps: CatalogueDeps, now: Date): Promise<Rendered | Refusal> {
  const preview = await deps.preview({
    clientId: args.clientId,
    contactId: args.contactId,
    sentByEmail: args.actorEmail,
    config: ready.config,
    request: { key: ready.catalogue.templateKey, picks: [], inputs: {}, callBasis: 'none' },
    now,
  })
  if (!preview.ok) return refuse(409, 'catalogue_template_invalid', preview.reason)
  if (preview.template.factSource !== 'none' || preview.template.pickMode !== 'none') return refuse(409, 'catalogue_template_invalid')
  const { missing, problems } = preview.rendered
  // A staff-typed box shows up as missing (no inputs are given): it can never be filled from here.
  if (missing.some((name) => name.startsWith('input.'))) return refuse(409, 'catalogue_template_invalid')
  if (missing.length > 0) return refuse(409, 'catalogue_render_failed', `缺：${missing.join('、')}`)
  if (problems.length > 0 || preview.blocks.length > 0) return refuse(409, 'catalogue_render_failed')
  return { subject: preview.rendered.subject, body: preview.rendered.body, templateVersion: preview.template.version }
}

/** Null when this guest has not had this catalogue from another request inside the window; otherwise the refusal. */
async function refuseSecondCatalogue(args: SendCatalogueArgs, ready: Ready, deps: CatalogueDeps, now: Date): Promise<Refusal | null> {
  let sentBefore: string | null
  try {
    sentBefore = await deps.catalogueSentAt({
      clientId: args.clientId, contactId: args.contactId, templateKey: ready.catalogue.templateKey, exceptRequestId: args.requestId,
      sinceIso: new Date(now.getTime() - CATALOGUE_ONCE_DAYS * 86_400_000).toISOString(),
    })
  } catch {
    return refuse(503, 'catalogue_history_unreadable')
  }
  if (sentBefore === null) return null
  const zone = await deps.loadTimeZone(args.clientId).catch(() => 'UTC')
  return refuse(409, 'catalogue_already_sent', `上一封 ${todayInZone(new Date(sentBefore), zone)}`)
}

export async function sendCatalogueEmail(args: SendCatalogueArgs, deps: CatalogueDeps): Promise<SendCatalogueResult> {
  const now = deps.now()
  const ready = await readyConfig(args, deps, now)
  if ('ok' in ready) return ready

  const eligible = await checkCatalogueEligibility({ clientId: args.clientId, contactId: args.contactId, now }, deps.eligibility)
  if (!eligible.ok) return { ok: false, status: 409, reason: eligible.reason, message: eligible.message, mayHaveSent: false }

  const once = await refuseSecondCatalogue(args, ready, deps, now)
  if (once !== null) return once

  const rendered = await renderCatalogue(args, ready, deps, now)
  if ('ok' in rendered) return rendered

  const sent = await deps.send({
    clientId: args.clientId,
    contactId: args.contactId,
    actorEmail: args.actorEmail,
    requestId: args.requestId,
    subject: rendered.subject,
    body: rendered.body,
    expectedRecipient: args.expectedRecipient,
    template: { key: ready.catalogue.templateKey, version: rendered.templateVersion, catalogVersion: null, picks: [], inputs: {}, callBasis: 'none' },
  })
  if ('crashed' in sent) return { ok: false, status: 503, reason: 'internal_error', message: sent.message, mayHaveSent: sent.mayHaveSent }
  if (!sent.ok) return { ok: false, status: sent.status, reason: sent.reason, message: sent.error, mayHaveSent: sent.reason === 'send_unknown' }
  return {
    ok: true,
    messageId: sent.messageId,
    conversationId: sent.conversationId,
    duplicate: sent.duplicate === true,
    templateKey: ready.catalogue.templateKey,
    templateVersion: rendered.templateVersion,
    versionLabel: ready.catalogue.versionLabel,
    settingsVersion: ready.settingsVersion,
  }
}
