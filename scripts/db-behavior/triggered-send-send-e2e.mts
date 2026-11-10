// End-to-end trial of REAL SENDING of the welcome letter (P2-2c-2a) against a REAL local database: the real send code,
// real supabase-js, a real PostgREST and a real Postgres with every migration replayed, so the claim function, the
// ledger's guards, the timeline table, the lock rows and the stored receipts are the real ones. The provider is a FAKE
// in this process (nothing is sent anywhere); the e-mail evidence ports are fakes too (no Mailchimp, no Graph).
//
// Not in CI. Run by hand before and after changing real sending:
//   1. a throw-away local Postgres with all migrations replayed, and a PostgREST in front of it (recipe: memory
//      `reference-local-postgrest-e2e-trial-recipe`; never point this at production);
//   2. NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<port> NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon jwt> \
//      SUPABASE_SERVICE_ROLE_KEY=<local service jwt> npx tsx scripts/db-behavior/triggered-send-send-e2e.mts
// Exit code 0 = every check passed. Every scenario creates its own fake client (example.test), so it can be repeated.

const target = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(target)) {
  console.error('refusing to run: NEXT_PUBLIC_SUPABASE_URL must be a local http://127.0.0.1:<port> or http://localhost:<port>')
  process.exit(2)
}

const SRC = new URL('../../src/', import.meta.url)
const load = (path: string) => import(new URL(path, SRC).href)
const { supabaseAdmin } = await load('lib/supabase.ts')
const { createProdSendDeps } = await load('lib/messaging/triggered-send/send-deps-prod.ts')
const { prepareSend } = await load('lib/messaging/triggered-send/send-sweep.ts')
const { sendOne } = await load('lib/messaging/triggered-send/send-one.ts')
const { insertProposal, authorizeProposal, activateAuthorization, revokeAuthorization } = await load('lib/messaging/triggered-send/authorization-store.ts')
const { ruleSha256 } = await load('lib/messaging/triggered-send/rule.ts')
const { templateContentSha256 } = await load('lib/messaging/triggered-send/welcome-template.ts')
const { getCurrentTemplate } = await load('lib/crm/email-templates/template-store.ts')

let passed = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail: unknown = ''): void {
  if (ok) passed += 1
  else failures.push(`${name} ${JSON.stringify(detail)}`)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`)
}

const HOUR = 3_600_000
const clients: string[] = []
const ENV: Record<string, string> = {
  TRIGGERED_SEND_LIVE: 'true',
  TRIGGERED_SEND_CLIENTS: '',
  RESEND_API_KEY_CTS: `re_${'e2e'.repeat(10)}`,
  UNSUBSCRIBE_SIGNING_SECRET: 'e2e-unsubscribe-secret-0123456789abcdef',
  APP_URL: 'https://app.example.test',
}
const sent: Array<Record<string, any>> = []
let answers: Array<Record<string, unknown>> = []

const RULE = {
  gate_contract_version: 1,
  audience: { sources: ['meta_lead_form'], max_age_days: 3, min_age: 'previous_local_day' },
  schedule: { timezone: 'Pacific/Auckland' },
  frequency_cap: { max: 2, window_days: 7 },
  consent: { accepted_bases: ['form_disclosure_attested'] },
  legacy: { mailchimp_campaign_title_prefix: 'auto_e1_batch_', excluded_tags: [] },
  human_mail: { required_mailboxes: ['sales@example.test'] },
  recipient_allowlist: null,
  send: {
    identity: { from: 'Example Tours <news@news.example.test>', reply_to: 'info@example.test' },
    template: { key: 'auto-welcome' },
    // The whole day, so the trial runs at any hour.
    send_window: { start: '00:00', end: '23:59' },
    health_breaker: { window_days: 30, bounce_min_sent: 50, bounce_min_count: 3, bounce_rate_pct: 4, complaint_max: 2, provider_reject_streak: 3 },
  },
}

/** A fresh client with an active template and an authorized, armed welcome authorization. */
async function newClient(dailyCap = 5): Promise<{ clientId: string; authId: string }> {
  const clientId = crypto.randomUUID()
  clients.push(clientId)
  ENV.TRIGGERED_SEND_CLIENTS = clients.join(',')
  const c = await supabaseAdmin.from('clients').insert({ id: clientId, name: 'E2E send client' })
  const t = await supabaseAdmin.from('crm_email_templates').insert({ client_id: clientId, template_key: 'auto-welcome', version: 1, name: 'Welcome', subject: 'Welcome, {{ first_name }}', body: 'Hi {{first_name}},\nThanks for your enquiry.', fact_source: 'none', pick_mode: 'none', pick_filter: {}, status: 'active', created_by: 'fde@example.test' })
  if (c.error || t.error) throw new Error(`seed client failed: ${c.error?.code ?? ''} ${t.error?.code ?? ''}`)
  const tmpl = await getCurrentTemplate(supabaseAdmin, clientId, 'auto-welcome')
  const p = await insertProposal(supabaseAdmin, { requestId: crypto.randomUUID(), clientId, triggerKey: 'welcome', channel: 'email', account: 'cts', rule: RULE, ruleSha256: ruleSha256(RULE), templateVersion: 1, templateSha256: templateContentSha256(tmpl), dailyCap, proposedByEmail: 'pm@example.test' })
  if (!p.ok) throw new Error(`proposal failed: ${p.code}`)
  const now = Date.now()
  const a = await authorizeProposal(supabaseAdmin, { id: p.id, byEmail: 'pm@example.test', byUserId: crypto.randomUUID(), liveFrom: new Date(now - 30 * HOUR).toISOString(), expiresAt: new Date(now + 30 * 24 * HOUR).toISOString() })
  if (!a.ok) throw new Error(`authorize failed: ${a.code}`)
  const armed = await activateAuthorization(supabaseAdmin, p.id)
  if (!armed.ok) throw new Error(`arm failed: ${armed.code}`)
  return { clientId, authId: p.id }
}

/** A guest who filled the lead form yesterday (26 hours ago: always the previous local day, after the start). */
async function newGuest(clientId: string, email: string, name = 'Jane Lee', identity = true): Promise<string> {
  const id = crypto.randomUUID()
  const at = new Date(Date.now() - 26 * HOUR).toISOString()
  const c = await supabaseAdmin.from('contacts').insert({ id, client_id: clientId, primary_email: email, display_name: name, created_at: at })
  // An address can be registered on one contact only; a second contact may still carry it as its primary e-mail.
  const i = identity ? await supabaseAdmin.from('contact_identities').insert({ contact_id: id, client_id: clientId, kind: 'email', value: email }) : { error: null }
  const tp = await supabaseAdmin.from('contact_touchpoints').insert({ client_id: clientId, contact_id: id, channel: 'meta_lead_form', direction: 'inbound', occurred_at: at, source: 'meta_lead_form', source_ref: `e2e-lead-${id}`, metadata: { consent_basis: 'form_disclosure_attested' } })
  if (c.error || i.error || tp.error) throw new Error(`seed guest failed: ${c.error?.code ?? ''} ${i.error?.code ?? ''} ${tp.error?.code ?? ''}`)
  return id
}

function deps() {
  let n = 0
  return {
    ...createProdSendDeps(),
    env: (name: string) => ENV[name],
    resend: {
      send: async (request: Record<string, unknown>) => {
        sent.push(request)
        return answers.shift() ?? { kind: 'sent', messageId: `e2e-msg-${crypto.randomUUID()}` }
      },
    },
    checkMailboxes: async () => ({ ok: true }),
    // No Mailchimp, no Graph: the evidence is empty and every other read says "fine".
    createPorts: () => ({
      consent: async () => ({ ok: true, bases: ['form_disclosure_attested'], sourceRef: 'e2e' }),
      dnc: async () => ({ ok: true, blocked: false }),
      member: async () => ({ ok: true, state: 'not_applicable', tags: [] }),
      evidence: async () => ({ ok: true, items: [], legacy: { welcomed: false, batchSeen: true, campaignIds: [] } }),
      unsubscribed: async () => ({ ok: true, unsubscribed: false }),
      addressHistory: async () => ({ ok: true, complained: false, hardBounced: false }),
    }),
    revokeAsSystem: async (record: { id: string }, code: string) => {
      const r = await revokeAuthorization(supabaseAdmin, { id: record.id, by: `system:${code}`, reason: `e2e: ${code}` })
      return r.ok ? 'revoked' : 'failed'
    },
    newIdempotencyKey: () => `triggered-send:welcome:e2e-${++n}-${crypto.randomUUID()}`,
  }
}

async function liveRow(clientId: string, contactId: string) {
  const { data } = await supabaseAdmin.from('triggered_sends').select('*').eq('client_id', clientId).eq('contact_id', contactId).eq('dedupe_scope', 'lifetime').maybeSingle()
  return data as Record<string, any> | null
}

async function planFor(clientId: string) {
  const prepared = await prepareSend({ clientId, dryRun: false, deps: deps() })
  if (prepared.kind !== 'plan') throw new Error(`no plan: ${JSON.stringify(prepared.receipt)}`)
  return prepared.plan
}

// ── S1. one guest, one letter ──
{
  const { clientId } = await newClient()
  const guest = await newGuest(clientId, 'guest1@example.test')
  const plan = await planFor(clientId)
  check('S1a the plan holds the guest who came in yesterday', plan.contactIds.length === 1 && plan.contactIds[0] === guest, plan)
  const r = await sendOne({ plan, contactId: guest, deps: deps() })
  const row = await liveRow(clientId, guest)
  check('S1b sent: one claim, status sent, message id and account written, provider impact accepted', r.outcome === 'sent' && row?.status === 'sent' && typeof row?.provider_message_id === 'string' && row?.provider_account === 'cts' && row?.sent_at !== null && row?.provider_impact === 'PROVIDER_ACCEPTED', { r, row })
  const req = sent.at(-1) ?? {}
  check('S1c the request carries the signed link to ME’s entry, the one-click header and the ledger id tag', /^<https:\/\/app\.example\.test\/api\/u\/.+>$/.test(req.headers?.['List-Unsubscribe'] ?? '') && req.headers?.['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click' && req.tags?.[0]?.value === row?.id && req.attempt === 'first', req.headers)
  const tp = await supabaseAdmin.from('contact_touchpoints').select('source, direction, metadata').eq('client_id', clientId).eq('source', 'me_send').eq('source_ref', row?.id)
  check('S1d one timeline record (me_send, outbound, automated) for the letter', (tp.data ?? []).length === 1 && tp.data?.[0]?.direction === 'outbound' && tp.data?.[0]?.metadata?.automated === true, tp.data)
  const locks = await supabaseAdmin.from('conversations').select('id').eq('client_id', clientId).like('conversation_id', 'mail-lock:%')
  check('S1e both locks were released', (locks.data ?? []).length === 0, locks.data)
  const before = sent.length
  const again = await sendOne({ plan, contactId: guest, deps: deps() })
  check('S1f a second run never sends a second letter', again.outcome === 'already_done' && sent.length === before, again)
}

// ── S2. an unclear answer, then the next run takes the letter over and replays the very same request ──
{
  const { clientId } = await newClient()
  const guest = await newGuest(clientId, 'guest2@example.test')
  const plan = await planFor(clientId)
  answers = [{ kind: 'unknown', code: 'timeout', status: null }]
  const first = await sendOne({ plan, contactId: guest, deps: deps() })
  const firstReq = sent.at(-1) ?? {}
  check('S2a unclear answer: the letter stays pending (it may have gone out)', first.outcome === 'unknown_outcome' && (await liveRow(clientId, guest))?.status === 'pending', first)
  const lease = await supabaseAdmin.from('triggered_sends').update({ lease_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('client_id', clientId).eq('contact_id', guest).eq('dedupe_scope', 'lifetime')
  const second = await sendOne({ plan: await planFor(clientId), contactId: guest, deps: deps() })
  const replayReq = sent.at(-1) ?? {}
  check('S2b after the lease ran out the next run replays: same key, same link, attempt "replay", now sent', lease.error === null && second.outcome === 'sent' && replayReq.attempt === 'replay' && replayReq.idempotencyKey === firstReq.idempotencyKey && replayReq.headers?.['List-Unsubscribe'] === firstReq.headers?.['List-Unsubscribe'], { second, lease: lease.error })
}

// ── S3/S4. refused on the first attempt; our own account is wrong ──
{
  const { clientId } = await newClient()
  const guest = await newGuest(clientId, 'guest3@example.test')
  const plan = await planFor(clientId)
  answers = [{ kind: 'rejected', code: 'validation_error', status: 422 }]
  const r = await sendOne({ plan, contactId: guest, deps: deps() })
  const row = await liveRow(clientId, guest)
  const tp = await supabaseAdmin.from('contact_touchpoints').select('metadata').eq('client_id', clientId).eq('source', 'me_send').eq('source_ref', row?.id).maybeSingle()
  check('S3 refused: failed provider_rejected (the address is free again), the timeline record is cancelled', r.outcome === 'rejected' && row?.status === 'failed' && row?.reason_code === 'provider_rejected' && tp.data?.metadata?.send_state === 'cancelled', { r, row: row?.status, tp: tp.data })
}
{
  const { clientId } = await newClient()
  const guest = await newGuest(clientId, 'guest4@example.test')
  answers = [{ kind: 'account_error', code: 'invalid_api_key', status: 403 }]
  const r = await sendOne({ plan: await planFor(clientId), contactId: guest, deps: deps() })
  const row = await liveRow(clientId, guest)
  check('S4 account error: failed provider_account_error and the run stops', r.outcome === 'account_error' && r.stopRun === true && row?.reason_code === 'provider_account_error', { r, row: row?.status })
}

// ── S5. revoked between the plan and the letter ──
{
  const { clientId, authId } = await newClient()
  const guest = await newGuest(clientId, 'guest5@example.test')
  const plan = await planFor(clientId)
  await revokeAuthorization(supabaseAdmin, { id: authId, by: 'pm@example.test', reason: 'e2e brake' })
  const before = sent.length
  const r = await sendOne({ plan, contactId: guest, deps: deps() })
  check('S5 the brake stops the very next letter: nothing claimed, nothing sent', r.outcome === 'stopped' && r.stopRun && (await liveRow(clientId, guest)) === null && sent.length === before, r)
}

// ── S6/S7. one address on two contacts; the day's cap ──
{
  const { clientId } = await newClient()
  const a = await newGuest(clientId, 'same@example.test')
  const b = await newGuest(clientId, 'same@example.test', 'June Park', false)
  const plan = await planFor(clientId)
  const ra = await sendOne({ plan, contactId: a, deps: deps() })
  const rb = await sendOne({ plan, contactId: b, deps: deps() })
  check('S6 the same address is welcomed once: the second contact is skipped address_duplicate', ra.outcome === 'sent' && rb.outcome === 'skipped' && rb.reason === 'address_duplicate' && (await liveRow(clientId, b))?.status === 'skipped', { ra, rb })
}
{
  const { clientId } = await newClient(1)
  const a = await newGuest(clientId, 'cap1@example.test')
  const b = await newGuest(clientId, 'cap2@example.test', 'June Park')
  const plan = await planFor(clientId)
  const ra = await sendOne({ plan, contactId: a, deps: deps() })
  const rb = await sendOne({ plan, contactId: b, deps: deps() })
  check('S7 a daily cap of 1: the second guest waits (blocked cap_reached) and the run stops', ra.outcome === 'sent' && rb.outcome === 'blocked' && rb.reason === 'cap_reached' && rb.stopRun && (await liveRow(clientId, b))?.status === 'blocked', { ra, rb })
}

// ── S8. a receipt that came before the message id was written is applied right after it ──
{
  const { clientId } = await newClient()
  const guest = await newGuest(clientId, 'guest8@example.test')
  const messageId = `e2e-msg-early-${crypto.randomUUID()}`
  const stored = await supabaseAdmin.from('provider_webhook_events').insert({ provider: 'resend', account: 'system', provider_event_id: `e2e-${crypto.randomUUID()}`, event_type: 'email.delivered', provider_message_id: messageId, occurred_at: new Date().toISOString(), payload: { type: 'email.delivered', data: { email_id: messageId } } })
  answers = [{ kind: 'sent', messageId }]
  const r = await sendOne({ plan: await planFor(clientId), contactId: guest, deps: deps() })
  const row = await liveRow(clientId, guest)
  check('S8 the early "delivered" receipt is replayed once the message id is written', stored.error === null && r.outcome === 'sent' && row?.status === 'delivered', { r, row: row?.status, stored: stored.error?.code })
}

// ── S9. the template was edited after the authorization ──
{
  const { clientId, authId } = await newClient()
  const guest = await newGuest(clientId, 'guest9@example.test')
  const plan = await planFor(clientId)
  await supabaseAdmin.from('crm_email_templates').insert({ client_id: clientId, template_key: 'auto-welcome', version: 2, name: 'Welcome', subject: 'Hello, {{ first_name }}', body: 'Hi {{first_name}}, new words.', fact_source: 'none', pick_mode: 'none', pick_filter: {}, status: 'active', created_by: 'fde@example.test' })
  const r = await sendOne({ plan, contactId: guest, deps: deps() })
  const auth = await supabaseAdmin.from('triggered_send_authorizations').select('revoked_by').eq('id', authId).maybeSingle()
  check('S9 an edited template revokes the authorization (system:TEMPLATE_CHANGED) and nothing is sent', r.outcome === 'stopped' && auth.data?.revoked_by === 'system:TEMPLATE_CHANGED' && (await liveRow(clientId, guest)) === null, { r, by: auth.data?.revoked_by })
}

// ── S10. the switches ──
{
  const { clientId } = await newClient()
  await newGuest(clientId, 'guest10@example.test')
  ENV.TRIGGERED_SEND_LIVE = 'TRUE'
  const prepared = await prepareSend({ clientId, dryRun: false, deps: deps() })
  ENV.TRIGGERED_SEND_LIVE = 'true'
  const dry = await prepareSend({ clientId, dryRun: true, deps: deps() })
  check('S10 not exactly "true", or a dry run: nothing is planned', prepared.kind === 'stop' && prepared.receipt.status === 'not_armed' && dry.kind === 'stop' && dry.receipt.status === 'dry_run', { a: prepared.kind === 'stop' ? prepared.receipt.status : 'plan', b: dry.kind === 'stop' ? dry.receipt.status : 'plan' })
}

console.log(`\n${passed} passed, ${failures.length} failed (provider calls in this process: ${sent.length}, none left the machine)`)
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
