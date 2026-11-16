/**
 * The production dependencies of a named letter (design 2026-11-17 §4.3): the trigger's send deps, the ledger of one
 * letter, the guest's letter rows, and link tracking on 127's own token store (`crm_email_link_tokens`). Built inside
 * each call (SDK clients at call time, CLAUDE.md §7). Tracking never throws and never stops a letter.
 */

import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { tagBody } from '@/lib/crm/email-templates/link-tracking/tag-links'
import { newToken, saveTokensTo, tagLinks } from '@/lib/crm/email-templates/link-tracking/tag-links-prod'
import type { EmailSettings } from '@/lib/crm/email-templates/types'
import { supabaseAdmin } from '@/lib/supabase'
import { createProdSendDeps } from './send-deps-prod'
import { createLetterLedger, readLetterRows } from './send-store'
import type { LinkTrackingPort, NamedLetterDeps } from './send-types'
import { AI_FOLLOWUP_TRIGGER, type TriggerKey } from './trigger-scope'

type Providers = EmailSettings['providers']

/** The client's link-tracking settings (127's): null when they cannot be read (the letter then goes untracked). */
async function readProviders(clientId: string): Promise<Providers | null> {
  try {
    const settings = await loadEmailSettings(supabaseAdmin, clientId)
    return settings.kind === 'ok' ? settings.settings.providers : null
  } catch {
    return null
  }
}

export function createLinkTracking(): LinkTrackingPort {
  return {
    async tag(args) {
      const providers = await readProviders(args.clientId)
      if (providers === null) return { body: args.body, tagged: 0, tokens: [], warning: 'link_tracking_failed' }
      const tokens: string[] = []
      const makeToken = (): string => {
        const token = newToken()
        tokens.push(token)
        return token
      }
      const out = await tagLinks(saveTokensTo(supabaseAdmin), { ...args, config: { providers }, facts: null }, makeToken)
      return { body: out.body, tagged: out.tagged, tokens: out.tagged > 0 ? tokens : [], warning: out.warning }
    },
    async retag(args) {
      try {
        const providers = await readProviders(args.clientId)
        const hosts = providers?.linkTracking?.hosts
        if (hosts === undefined) return { ok: false }
        let i = 0
        const out = tagBody(args.body, hosts, () => args.tokens[i++] ?? '')
        return out.ok && out.links.length === args.tokens.length && i === args.tokens.length ? { ok: true, body: out.body } : { ok: false }
      } catch {
        return { ok: false }
      }
    },
  }
}

export function createProdNamedLetterDeps(trigger: TriggerKey = AI_FOLLOWUP_TRIGGER): NamedLetterDeps {
  const db = supabaseAdmin
  return {
    ...createProdSendDeps(trigger),
    letters: (letterKey) => createLetterLedger(db, trigger, letterKey),
    letterRows: (clientId, contactId) => readLetterRows(db, { clientId, triggerKey: trigger, contactId }),
    linkTracking: createLinkTracking(),
  }
}
