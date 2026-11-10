/**
 * The production dependencies of real sending. Built inside each step (SDK clients are created at call time, CLAUDE.md
 * §7), one lock store per step so a release only ever drops this step's own lock rows.
 */

import { randomUUID } from 'node:crypto'
import { getCurrentTemplate } from '@/lib/crm/email-templates/template-store'
import { createResendEmailPort } from '@/lib/messaging/adapters/resend-email'
import { createMailNewStore, graphGetPage } from '@/lib/microsoft/mail-send-new-prod'
import { supabaseAdmin } from '@/lib/supabase'
import type { TemplateRead } from './authorization-core'
import { revokeAsSystem } from './authorization-core'
import { createAuthorizationDeps } from './authorization-deps-prod'
import { loadOpenAuthorizations } from './authorization-store'
import { cancelSendTouchpoint, writeSendTouchpoint } from './send-touchpoint'
import { createSendLedger, createSendLocks, loadSendContact, replayStoredReceipts } from './send-store'
import type { SendDeps } from './send-types'
import { createShadowGatePorts } from './shadow-ports-prod'
import { checkRequiredMailboxes, loadLeadContacts } from './shadow-reads-prod'

const CANCELLED_SUMMARY = 'ME 自动发信没有发出：欢迎信'

async function readTemplate(clientId: string, key: string): Promise<TemplateRead> {
  try {
    return { ok: true, template: await getCurrentTemplate(supabaseAdmin, clientId, key) }
  } catch {
    return { ok: false }
  }
}

export function createProdSendDeps(): SendDeps {
  const db = supabaseAdmin
  const env = (name: string): string | undefined => process.env[name]
  const store = createMailNewStore()
  return {
    now: () => new Date(),
    env,
    async loadAuthorization(clientId) {
      const read = await loadOpenAuthorizations(db, { clientId, triggerKey: 'welcome', channel: 'email' })
      return read.ok ? { ok: true, record: read.open.authorized } : { ok: false, error: `authorization read: ${read.code}` }
    },
    loadTemplate: readTemplate,
    async revokeAsSystem(record, code) {
      try {
        return await revokeAsSystem(createAuthorizationDeps(db), record, code, `the sender found ${code} before a letter`)
      } catch {
        return 'failed'
      }
    },
    loadContacts: (args) => loadLeadContacts(db, args),
    loadContact: (args) => loadSendContact(db, args),
    checkMailboxes: (clientId, required) => checkRequiredMailboxes(store.listActiveMailboxes, clientId, required),
    createPorts: ({ clientId, rule, now }) =>
      createShadowGatePorts({
        db,
        clientId,
        rule,
        now,
        listActiveMailboxes: store.listActiveMailboxes,
        // Read-only: a failed token refresh must not flip the sales mailbox connection to "error".
        graphGetPage: (connectionId, pathOrUrl) => graphGetPage(connectionId, pathOrUrl, { markErrorOnFailure: false }),
      }).ports,
    createLocks: () => createSendLocks(createMailNewStore()),
    ledger: createSendLedger(db),
    resend: createResendEmailPort(),
    writeTouchpoint: (input) => writeSendTouchpoint(db, input),
    cancelTouchpoint: (clientId, sendId) => cancelSendTouchpoint(db, { clientId, triggeredSendId: sendId, triggerKey: 'welcome', summary: CANCELLED_SUMMARY }),
    replayReceipts: (messageId) => replayStoredReceipts(db, messageId, env, () => new Date()),
    newIdempotencyKey: () => `triggered-send:welcome:${randomUUID()}`,
  }
}
