// End-to-end trial of the PM page's 「最近发送」 and of settling a letter whose outcome nobody could tell (P2-2c-2b)
// against a REAL local database: the real status query, the real resolve command and store, real supabase-js, a real
// PostgREST and a real Postgres with every migration replayed, so the ledger's guards (status only forward, the address
// index, write-once columns), the claim function and the timeline table are the real ones. Letters are made by the real
// send code with a FAKE provider in this process (nothing is sent anywhere).
//
// Not in CI. Run by hand before and after changing this:
//   1. a throw-away local Postgres with all migrations replayed, and a PostgREST in front of it (recipe: memory
//      `reference-local-postgrest-e2e-trial-recipe`; never point this at production);
//   2. NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<port> NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon jwt> \
//      SUPABASE_SERVICE_ROLE_KEY=<local service jwt> npx tsx scripts/db-behavior/triggered-send-resolve-e2e.mts
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
const { createAuthorizationStatusDeps } = await load('lib/messaging/triggered-send/authorization-deps-prod.ts')
const { statusQuery } = await load('lib/messaging/triggered-send/authorization-status.ts')
const { createResolveDeps } = await load('lib/messaging/triggered-send/resolve-store.ts')
const { resolveUnknownCommand } = await load('lib/messaging/triggered-send/resolve-unknown.ts')
const { WELCOME_NOT_SENT_TIMELINE_LINE } = await load('lib/messaging/triggered-send/send-touchpoint.ts')
const { ruleSha256 } = await load('lib/messaging/triggered-send/rule.ts')
const { templateContentSha256 } = await load('lib/messaging/triggered-send/welcome-template.ts')
const { getCurrentTemplate } = await load('lib/crm/email-templates/template-store.ts')
const { readEmailUnsubscribed } = await load('lib/crm/email-unsubscribe.ts')
const { readAddressHistory } = await load('lib/messaging/triggered-send/shadow-ports-prod.ts')

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
  TRIGGERED_SEND_TRIAL_DOMAINS: 'example.test',
}
const sent: Array<Record<string, any>> = []
let answers: Array<Record<string, unknown>> = []
const PM = { email: 'pm@example.test', userId: crypto.randomUUID() }

const RULE = (addresses: string[] | null) => ({
  gate_contract_version: 1,
  audience: { sources: ['meta_lead_form'], max_age_days: 3, min_age: 'previous_local_day' },
  schedule: { timezone: 'Pacific/Auckland' },
  frequency_cap: { max: 2, window_days: 7 },
  consent: { accepted_bases: ['form_disclosure_attested'] },
  legacy: { mailchimp_campaign_title_prefix: 'auto_e1_batch_', excluded_tags: [] },
  human_mail: { required_mailboxes: ['sales@example.test'] },
  recipient_allowlist: addresses,
  send: {
    identity: { from: 'Example Tours <news@news.example.test>', reply_to: 'info@example.test' },
    template: { key: 'auto-welcome' },
    send_window: { start: '00:00', end: '23:59' },
    health_breaker: { window_days: 30, bounce_min_sent: 50, bounce_min_count: 3, bounce_rate_pct: 4, complaint_max: 2, provider_reject_streak: 3 },
  },
})

/** A fresh client with an active template and an authorized, armed welcome authorization (a trial unless `null`). */
async function newClient(addresses: string[] | null): Promise<{ clientId: string; authId: string }> {
  const rule = RULE(addresses)
  const clientId = crypto.randomUUID()
  clients.push(clientId)
  ENV.TRIGGERED_SEND_CLIENTS = clients.join(',')
  const c = await supabaseAdmin.from('clients').insert({ id: clientId, name: 'E2E resolve client' })
  const t = await supabaseAdmin.from('crm_email_templates').insert({ client_id: clientId, template_key: 'auto-welcome', version: 1, name: 'Welcome', subject: 'Welcome, {{ first_name }}', body: 'Hi {{first_name}},\nThanks for your enquiry.', fact_source: 'none', pick_mode: 'none', pick_filter: {}, status: 'active', created_by: 'fde@example.test' })
  if (c.error || t.error) throw new Error(`seed client failed: ${c.error?.code ?? ''} ${t.error?.code ?? ''}`)
  const tmpl = await getCurrentTemplate(supabaseAdmin, clientId, 'auto-welcome')
  const p = await insertProposal(supabaseAdmin, { requestId: crypto.randomUUID(), clientId, triggerKey: 'welcome', channel: 'email', account: 'cts', rule, ruleSha256: ruleSha256(rule), templateVersion: 1, templateSha256: templateContentSha256(tmpl), dailyCap: 5, proposedByEmail: 'pm@example.test' })
  if (!p.ok) throw new Error(`proposal failed: ${p.code}`)
  const now = Date.now()
  const a = await authorizeProposal(supabaseAdmin, { id: p.id, byEmail: PM.email, byUserId: PM.userId, liveFrom: new Date(now - 30 * HOUR).toISOString(), expiresAt: new Date(now + 30 * 24 * HOUR).toISOString() })
  if (!a.ok) throw new Error(`authorize failed: ${a.code}`)
  const armed = await activateAuthorization(supabaseAdmin, p.id)
  if (!armed.ok) throw new Error(`arm failed: ${armed.code}`)
  return { clientId, authId: p.id }
}

async function newGuest(clientId: string, email: string, identity = true): Promise<string> {
  const id = crypto.randomUUID()
  const at = new Date(Date.now() - 26 * HOUR).toISOString()
  const c = await supabaseAdmin.from('contacts').insert({ id, client_id: clientId, primary_email: email, display_name: 'Jane Lee', created_at: at })
  const i = identity ? await supabaseAdmin.from('contact_identities').insert({ contact_id: id, client_id: clientId, kind: 'email', value: email }) : { error: null }
  const tp = await supabaseAdmin.from('contact_touchpoints').insert({ client_id: clientId, contact_id: id, channel: 'meta_lead_form', direction: 'inbound', occurred_at: at, source: 'meta_lead_form', source_ref: `e2e-lead-${id}`, metadata: { consent_basis: 'form_disclosure_attested' } })
  if (c.error || i.error || tp.error) throw new Error(`seed guest failed: ${c.error?.code ?? ''} ${i.error?.code ?? ''} ${tp.error?.code ?? ''}`)
  return id
}

function ports(clientId: string) {
  return {
    consent: async () => ({ ok: true, bases: ['form_disclosure_attested'], sourceRef: 'e2e' }),
    dnc: async () => ({ ok: true, blocked: false }),
    member: async () => ({ ok: true, state: 'not_applicable', tags: [] }),
    evidence: async () => ({ ok: true, items: [], legacy: { welcomed: false, batchSeen: true, campaignIds: [] } }),
    unsubscribed: (c: { contactId: string; addresses: string[] }) => readEmailUnsubscribed(supabaseAdmin, clientId, { contactId: c.contactId, addresses: c.addresses }),
    addressHistory: (c: Record<string, unknown>) => readAddressHistory(supabaseAdmin, clientId, c),
  }
}

function sendDeps() {
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
    createPorts: ({ clientId }: { clientId: string }) => ports(clientId),
    revokeAsSystem: async (record: { id: string }, code: string) => {
      const r = await revokeAuthorization(supabaseAdmin, { id: record.id, by: `system:${code}`, reason: `e2e: ${code}` })
      return r.ok ? 'revoked' : 'failed'
    },
    newIdempotencyKey: () => `triggered-send:welcome:e2e-${++n}-${crypto.randomUUID()}`,
  }
}

const statusDeps = () => ({ ...createAuthorizationStatusDeps(supabaseAdmin), env: (name: string) => ENV[name], canEmit: () => true })
const resolveDeps = () => createResolveDeps(supabaseAdmin)
const resolve = (clientId: string, body: Record<string, unknown>) =>
  resolveUnknownCommand(resolveDeps(), clientId, PM, { client_id: clientId, confirm: false, ...body })

async function liveRow(clientId: string, contactId: string) {
  const { data } = await supabaseAdmin.from('triggered_sends').select('*').eq('client_id', clientId).eq('contact_id', contactId).eq('dedupe_scope', 'lifetime').maybeSingle()
  return data as Record<string, any> | null
}

async function planFor(clientId: string) {
  const prepared = await prepareSend({ clientId, dryRun: false, deps: sendDeps() })
  if (prepared.kind !== 'plan') throw new Error(`no plan: ${JSON.stringify(prepared.receipt)}`)
  return prepared.plan
}

/**
 * A letter whose provider answer was unclear, left past the time to replay it: the row the PM is asked about. The step
 * pending → unknown_outcome is what the claim function does after 20 hours (and the daily reconciliation will do); the
 * ledger's guard allows exactly this forward step, done here directly instead of waiting 20 hours.
 */
async function unknownLetter(clientId: string, email: string): Promise<{ guest: string; row: Record<string, any> }> {
  const guest = await newGuest(clientId, email)
  answers = [{ kind: 'unknown', code: 'timeout', status: null }]
  const first = await sendOne({ plan: await planFor(clientId), contactId: guest, deps: sendDeps() })
  if (first.outcome !== 'unknown_outcome') throw new Error(`expected an unclear answer: ${JSON.stringify(first)}`)
  const moved = await supabaseAdmin.from('triggered_sends').update({ status: 'unknown_outcome', reason_code: 'expired_20h' }).eq('client_id', clientId).eq('contact_id', guest).eq('dedupe_scope', 'lifetime').eq('status', 'pending')
  if (moved.error) throw new Error(`move to unknown failed: ${moved.error.code}`)
  const row = await liveRow(clientId, guest)
  if (row === null) throw new Error('no row')
  return { guest, row }
}

async function timeline(clientId: string, sendId: string) {
  const { data } = await supabaseAdmin.from('contact_touchpoints').select('summary, metadata').eq('client_id', clientId).eq('source', 'me_send').eq('source_ref', sendId)
  return (data ?? []) as Array<Record<string, any>>
}

// ── R1. 「最近发送」 shows the unclear letter; the PM settles it as 「没发出」 ──
{
  const { clientId } = await newClient(['r1@example.test'])
  const { guest, row } = await unknownLetter(clientId, 'r1@example.test')
  const status = (await statusQuery(statusDeps(), clientId, { canAuthorize: true })).body as Record<string, any>
  const shown = (status.recent_sends ?? []).find((s: Record<string, any>) => s.id === row.id)
  check('R1a the page lists the unclear letter in 「最近发送」 (status, why, the provider may have it), with no address', shown?.status === 'unknown_outcome' && shown?.reason_code === 'expired_20h' && shown?.provider_impact === 'PROVIDER_UNKNOWN' && shown?.contact_id === guest && !JSON.stringify(status.recent_sends).includes('r1@example.test'), shown)
  check('R1b the page also says the site address the unsubscribe link needs is set', status.prerequisites?.app_url === true, status.prerequisites)
  const preview = await resolve(clientId, { send_id: row.id, outcome: 'not_sent', seen_updated_at: shown?.updated_at })
  const still = await liveRow(clientId, guest)
  check('R1c a preview writes nothing', preview.status === 200 && preview.body.mode === 'PREVIEW' && still?.status === 'unknown_outcome' && still?.updated_at === row.updated_at, preview.body)
  const done = await resolve(clientId, { send_id: row.id, outcome: 'not_sent', seen_updated_at: shown?.updated_at, confirm: true })
  const after = await liveRow(clientId, guest)
  check('R1d confirmed: failed + not_sent_confirmed, who / when / request id kept on the row', done.body.mode === 'RESOLVED' && after?.status === 'failed' && after?.reason_code === 'not_sent_confirmed' && after?.annotations?.resolution?.outcome === 'not_sent' && after?.annotations?.resolution?.by === PM.email && typeof after?.annotations?.resolution?.request_id === 'string', { done: done.body, after })
  const line = await timeline(clientId, row.id)
  check('R1e the letter’s timeline line now says it did not go (one line, cancelled)', done.body.timeline === 'cancelled' && line.length === 1 && line[0].summary === WELCOME_NOT_SENT_TIMELINE_LINE && line[0].metadata?.send_state === 'cancelled', { line, timeline: done.body.timeline })
  const before = sent.length
  const again = await sendOne({ plan: await planFor(clientId), contactId: guest, deps: sendDeps() })
  check('R1f 🔴 this guest is never welcomed automatically again (no provider call)', again.outcome !== 'sent' && sent.length === before && (await liveRow(clientId, guest))?.status === 'failed', again)
  const twin = await newGuest(clientId, 'r1@example.test', false)
  const twinRun = await sendOne({ plan: await planFor(clientId), contactId: twin, deps: sendDeps() })
  const twinRow = await liveRow(clientId, twin)
  check('R1g 🔴 the address stays taken: another contact with the same address is not sent to either', sent.length === before && twinRow?.status === 'skipped' && twinRow?.reason_code === 'address_duplicate', { twinRun, twinRow })
  const twice = await resolve(clientId, { send_id: row.id, outcome: 'not_sent', seen_updated_at: shown?.updated_at, confirm: true })
  const flip = await resolve(clientId, { send_id: row.id, outcome: 'sent', seen_updated_at: shown?.updated_at, confirm: true })
  check('R1h the same answer again is harmless; the other answer is refused (no flipping)', twice.body.mode === 'ALREADY_RESOLVED' && flip.status === 409 && flip.body.error === 'ALREADY_RESOLVED' && (await liveRow(clientId, guest))?.status === 'failed', { twice: twice.body, flip: flip.body })
  const late = await supabaseAdmin.from('triggered_sends').update({ status: 'delivered', last_event_type: 'email.delivered', last_event_at: new Date().toISOString() }).eq('id', row.id)
  check('R1i a late real receipt may still overwrite 「没发出」 (the table allows that one way back)', late.error === null && (await liveRow(clientId, guest))?.status === 'delivered', late.error)
}

// ── R2. the PM settles an unclear letter as 「已发出」 ──
{
  const { clientId } = await newClient(['r2@example.test'])
  const { guest, row } = await unknownLetter(clientId, 'r2@example.test')
  const done = await resolve(clientId, { send_id: row.id, outcome: 'sent', seen_updated_at: row.updated_at, confirm: true })
  const after = await liveRow(clientId, guest)
  check('R2a confirmed: sent, provider accepted, sent at the first attempt (the right week for the cap)', done.body.mode === 'RESOLVED' && after?.status === 'sent' && after?.reason_code === 'sent_confirmed' && after?.provider_impact === 'PROVIDER_ACCEPTED' && Date.parse(after?.sent_at) === Date.parse(row.first_attempt_at), { done: done.body, after })
  const line = await timeline(clientId, row.id)
  check('R2b the timeline line is left as it was (the letter went)', done.body.timeline === 'unchanged' && line.length === 1 && line[0].metadata?.send_state === 'claimed', line)
  const before = sent.length
  const again = await sendOne({ plan: await planFor(clientId), contactId: guest, deps: sendDeps() })
  check('R2c no second letter', again.outcome === 'already_done' && sent.length === before, again)
}

// ── R3. refusals, against the real ledger ──
{
  const { clientId } = await newClient(['r3@example.test', 'r3b@example.test'])
  const pendingGuest = await newGuest(clientId, 'r3@example.test')
  answers = [{ kind: 'unknown', code: 'timeout', status: null }]
  await sendOne({ plan: await planFor(clientId), contactId: pendingGuest, deps: sendDeps() })
  const pending = await liveRow(clientId, pendingGuest)
  const notYet = await resolve(clientId, { send_id: pending?.id, outcome: 'not_sent', seen_updated_at: pending?.updated_at, confirm: true })
  check('R3a 🔴 a letter still within its replay time (pending) cannot be settled', notYet.status === 409 && notYet.body.error === 'NOT_UNKNOWN' && (await liveRow(clientId, pendingGuest))?.status === 'pending', notYet.body)

  const { guest, row } = await unknownLetter(clientId, 'r3b@example.test')
  const stale = await resolve(clientId, { send_id: row.id, outcome: 'not_sent', seen_updated_at: '2026-01-01T00:00:00+00:00', confirm: true })
  check('R3b 🔴 an answer given on an older view of the letter is refused', stale.status === 409 && stale.body.error === 'SEND_CHANGED' && (await liveRow(clientId, guest))?.status === 'unknown_outcome', stale.body)

  const store = resolveDeps()
  const read = await store.load(clientId, row.id)
  const bump = await supabaseAdmin.from('triggered_sends').update({ last_event_type: 'email.delivery_delayed', last_event_at: new Date().toISOString() }).eq('id', row.id)
  const raced = read.ok && read.row !== null ? await store.write(read.row, { status: 'failed', reason_code: 'not_sent_confirmed' }) : null
  check('R3c 🔴 a receipt that moved the row on between the read and the write wins (compare-and-set misses)', bump.error === null && raced?.ok === true && raced.result === 'changed' && (await liveRow(clientId, guest))?.status === 'unknown_outcome', { raced, bump: bump.error })

  const { clientId: other } = await newClient(['r3c@example.test'])
  const foreign = await resolve(other, { send_id: row.id, outcome: 'not_sent', seen_updated_at: row.updated_at, confirm: true })
  check('R3d another client’s letter is "not found"', foreign.status === 404 && foreign.body.error === 'SEND_NOT_FOUND', foreign.body)

  const shadowId = crypto.randomUUID()
  const shadow = await supabaseAdmin.from('triggered_sends').insert({ id: shadowId, client_id: clientId, trigger_key: 'welcome', channel: 'email', contact_id: guest, dedupe_scope: 'shadow', status: 'shadow', reason_code: null, annotations: { would_send: true } })
  const onShadow = await resolve(clientId, { send_id: shadowId, outcome: 'sent', seen_updated_at: row.updated_at, confirm: true })
  check('R3e a rehearsal (shadow) row is "not found": only real letters can be settled', shadow.error === null && onShadow.status === 404, { shadow: shadow.error, onShadow: onShadow.body })
  const status = (await statusQuery(statusDeps(), clientId, { canAuthorize: true })).body as Record<string, any>
  const ids = (status.recent_sends ?? []).map((s: Record<string, any>) => s.id)
  check('R3f 「最近发送」 never shows rehearsal rows; newest activity first', !ids.includes(shadowId) && ids.length === 2 && ids[0] === row.id, ids)
}

// ── R4. a client whose authorization in force is for the real list: the page says it sends nothing ──
{
  const { clientId } = await newClient(null)
  const status = (await statusQuery(statusDeps(), clientId, { canAuthorize: true })).body as Record<string, any>
  check('R4 🔴 an authorization for the real list shows "sends nothing in this version"', status.authorization?.state === 'formal_sending_not_enabled' && status.authorization?.trial === false, status.authorization?.state)
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL ${f}`)
  process.exit(1)
}
