import { readEmailComposeConfig, type EmailComposeConfig } from '@/lib/crm/email-compose/config'
import type { EmailSettings } from './types'

/**
 * What the send path actually enforces. `source: 'settings'` = the client has a (strictly parsed) settings row and
 * every new gate is active; `source: 'legacy'` = only the old leads_config.email_compose keys exist, and the send
 * behaves exactly as before the template feature (none of the new gates run).
 */
export interface EffectiveEmailConfig extends EmailComposeConfig {
  source: 'legacy' | 'settings'
  settingsVersion: number | null
  frequencyCap: EmailSettings['frequencyCap']
  recipientAllowlist: string[] | null
  sameTemplateCooldownHours: number
  callPromptHours: number
  guardrails: EmailSettings['guardrails']
  providers: EmailSettings['providers']
}

export function effectiveFromSettings(settings: EmailSettings, version: number): EffectiveEmailConfig {
  return {
    enabled: settings.enabled,
    sendMailbox: settings.sendMailbox,
    allowUnsolicited: settings.allowUnsolicited,
    footer: settings.footer,
    limits: { ...settings.limits },
    source: 'settings',
    settingsVersion: version,
    frequencyCap: settings.frequencyCap,
    recipientAllowlist: settings.recipientAllowlist,
    sameTemplateCooldownHours: settings.sameTemplateCooldownHours,
    callPromptHours: settings.callPromptHours,
    guardrails: settings.guardrails,
    providers: settings.providers,
  }
}

export function effectiveFromLegacy(leadsConfig: unknown): EffectiveEmailConfig {
  const legacy = readEmailComposeConfig(leadsConfig)
  return {
    ...legacy,
    source: 'legacy',
    settingsVersion: null,
    frequencyCap: null,
    recipientAllowlist: null,
    sameTemplateCooldownHours: 0,
    callPromptHours: 24,
    guardrails: { allowedLinkHosts: [], rules: [] },
    providers: {},
  }
}
