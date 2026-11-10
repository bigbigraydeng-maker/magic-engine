// End-to-end trial of the welcome letter's authorization commands (P2-2c-1) against a REAL local database: the real
// command code, real supabase-js, a real PostgREST and a real Postgres with every migration replayed, so the
// authorization table's own triggers and CHECKs are the ones that answer. Fake client, fake addresses (example.test).
// Nothing leaves the machine: no provider is called and events are captured in memory.
//
// Not in CI. Run by hand before and after changing the authorization commands or the authorization table:
//   1. a throw-away local Postgres with all migrations replayed, and a PostgREST in front of it (recipe: memory
//      `reference-local-postgrest-e2e-trial-recipe`; never point this at production);
//   2. NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<port> NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon jwt> \
//      SUPABASE_SERVICE_ROLE_KEY=<local service jwt> npx tsx scripts/db-behavior/triggered-send-authorization-e2e.mts
// Exit code 0 = every check passed. Each run creates its own fake client, so it can be repeated on the same database.

const target = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(target)) {
  console.error('refusing to run: NEXT_PUBLIC_SUPABASE_URL must be a local http://127.0.0.1:<port> or http://localhost:<port>')
  process.exit(2)
}

const SRC = new URL('../../src/', import.meta.url)
const load = (path: string) => import(new URL(path, SRC).href)
const { supabaseAdmin } = await load('lib/supabase.ts')
const { createAuthorizationDeps } = await load('lib/messaging/triggered-send/authorization-deps-prod.ts')
const { proposeCommand, revokeCommand } = await load('lib/messaging/triggered-send/authorization-commands.ts')
const { authorizeCommand } = await load('lib/messaging/triggered-send/authorization-authorize.ts')
const { statusQuery } = await load('lib/messaging/triggered-send/authorization-status.ts')
const { authorizeProposal, insertProposal } = await load('lib/messaging/triggered-send/authorization-store.ts')
const { ruleSha256 } = await load('lib/messaging/triggered-send/rule.ts')

const CLIENT = crypto.randomUUID()
const ACTOR = { email: 'pm@example.test', userId: crypto.randomUUID() }
{
  const c = await supabaseAdmin.from('clients').insert({ id: CLIENT, name: 'E2E authorization client' })
  const t = await supabaseAdmin.from('crm_email_templates').insert({ client_id: CLIENT, template_key: 'auto-welcome', version: 1, name: 'Welcome', subject: 'Welcome, {{ first_name }}', body: 'Hi {{first_name}},\nThanks for your enquiry.', fact_source: 'none', pick_mode: 'none', pick_filter: {}, status: 'active', created_by: 'fde@example.test' })
  if (c.error || t.error) throw new Error(`seed failed: ${c.error?.code ?? ''} ${t.error?.code ?? ''}`)
}

let passed = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail: unknown = ''): void {
  if (ok) passed += 1
  else failures.push(`${name} ${JSON.stringify(detail)}`)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`)
}

const events: Array<{ id: string; data: Record<string, unknown> }> = []
let emitFails = false
let mailboxes: { ok: true } | { ok: false; reason: 'missing' | 'unreadable'; detail: string } = { ok: true }
const ENV: Record<string, string> = { TRIGGERED_SEND_TRIAL_DOMAINS: 'example.test' }
function deps() {
  return {
    ...createAuthorizationDeps(supabaseAdmin),
    emit: async (event: { id: string; data: Record<string, unknown> }) => {
      if (emitFails) throw new Error('inngest down (simulated)')
      events.push(event)
    },
    canEmit: () => true,
    checkMailboxes: async () => mailboxes,
    env: (name: string) => ENV[name],
  }
}
const status = async () => (await statusQuery(deps(), CLIENT, { canAuthorize: true })).body as Record<string, any>

function baseRule(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gate_contract_version: 1,
    audience: { sources: ['meta_lead_form'], max_age_days: 3, min_age: 'previous_local_day' },
    schedule: { timezone: 'Pacific/Auckland' },
    frequency_cap: { max: 2, window_days: 7 },
    consent: { accepted_bases: ['form_disclosure_attested'] },
    legacy: { mailchimp_campaign_title_prefix: 'auto_e1_batch_', excluded_tags: [] },
    human_mail: { required_mailboxes: ['sales@example.test'] },
    recipient_allowlist: null,
    ...over,
  }
}
const SEND = {
  identity: { from: 'Example Tours <news@news.example.test>', reply_to: 'info@example.test' },
  template: { key: 'auto-welcome' },
  send_window: { start: '08:00', end: '20:00' },
  health_breaker: { window_days: 30, bounce_min_sent: 50, bounce_min_count: 3, bounce_rate_pct: 4, complaint_max: 2, provider_reject_streak: 3 },
}

async function row(id: string) {
  const { data, error } = await supabaseAdmin.from('triggered_send_authorizations').select('*').eq('id', id).single()
  if (error) throw new Error(`read ${id}: ${error.code}`)
  return data as Record<string, string | number | null>
}
async function openCount() {
  const { count } = await supabaseAdmin.from('triggered_send_authorizations').select('id', { count: 'exact', head: true }).eq('client_id', CLIENT).is('revoked_at', null)
  return count ?? -1
}
const nzToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date())
const dayBefore = (days: number) => new Date(Date.parse(`${nzToday}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)

// ── A. today's rehearsal-only proposal (no send block, no template) with five consistent days up to yesterday ──
const r0 = baseRule()
const p0 = await insertProposal(supabaseAdmin, { requestId: crypto.randomUUID(), clientId: CLIENT, triggerKey: 'welcome', channel: 'email', account: 'cts', rule: r0, ruleSha256: ruleSha256(r0), templateVersion: null, templateSha256: null, dailyCap: 20, proposedByEmail: 'pm@example.test' })
check('A1 rehearsal-only proposal written (lifecycle columns empty)', p0.ok, p0)
if (!p0.ok) process.exit(1)
const dup = await insertProposal(supabaseAdmin, { requestId: crypto.randomUUID(), clientId: CLIENT, triggerKey: 'welcome', channel: 'email', account: 'cts', rule: r0, ruleSha256: ruleSha256(r0), templateVersion: null, templateSha256: null, dailyCap: 20, proposedByEmail: 'pm@example.test' })
check('A2 a second open proposal is refused by the database (one per client)', !dup.ok && dup.code === 'proposal_conflict', dup)
const shadowRows = []
for (let d = 1; d <= 5; d += 1) {
  for (let i = 0; i < 3; i += 1) {
    shadowRows.push({ client_id: CLIENT, trigger_key: 'welcome', channel: 'email', contact_id: crypto.randomUUID(), dedupe_scope: 'shadow', status: 'shadow', authorization_id: p0.id, annotations: { gate_contract_version: 1, lead_local_day: dayBefore(d), would_send: true, legacy_welcomed: true, legacy_batch_seen: true } })
  }
}
shadowRows.push({ client_id: CLIENT, trigger_key: 'welcome', channel: 'email', contact_id: crypto.randomUUID(), dedupe_scope: 'shadow', status: 'shadow', authorization_id: p0.id, annotations: { gate_contract_version: 2, lead_local_day: dayBefore(1), would_send: false, legacy_welcomed: true, legacy_batch_seen: true } })
const ins = await supabaseAdmin.from('triggered_sends').insert(shadowRows)
check('A3 sixteen shadow rows seeded under the rehearsal proposal (five days up to yesterday)', ins.error === null, ins.error?.code)
let st = await status()
check('A4 status: rehearsal-only proposal cannot be authorized (no send block)', st.proposal?.problem === 'RULE_HAS_NO_SEND_BLOCK', st.proposal?.problem)
check('A5 status: five consistent calendar days ending yesterday, the other-gate row left out', st.proposal?.rehearsal?.consecutiveDays === 5 && st.proposal?.rehearsal?.rowsCounted === 15 && st.proposal?.rehearsal?.runTo === dayBefore(1), st.proposal?.rehearsal)

// ── B. propose the sendable rule (same decisions + send block) ──
const r1 = baseRule({ send: SEND })
mailboxes = { ok: false, reason: 'missing', detail: '1 of 1' }
const noMailbox = await proposeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, account: 'cts', daily_cap: 20, rule: r1, confirm: true })
check('B0 a disconnected salesperson mailbox stops the proposal (§5.2 F)', noMailbox.status === 422 && noMailbox.body.error === 'REQUIRED_MAILBOXES_NOT_CONNECTED', noMailbox.body)
mailboxes = { ok: true }
const before = await openCount()
const preview = await proposeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, account: 'cts', daily_cap: 20, rule: r1, confirm: false })
check('B1 propose preview writes nothing', preview.status === 200 && preview.body.mode === 'PREVIEW' && (await openCount()) === before, preview.body)
const proposed = await proposeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, account: 'cts', daily_cap: 20, rule: r1, confirm: true })
check('B2 propose confirm writes the proposal', proposed.status === 200 && proposed.body.mode === 'PROPOSED', proposed.body)
const p1 = String(proposed.body.authorization_id)
const old = await row(p0.id)
check('B3 the old proposal is revoked as SUPERSEDED, time stamped by the database', old.revoked_by === 'system:SUPERSEDED' && old.revoked_at !== null, { by: old.revoked_by })
const p1row = await row(p1)
check('B4 the new proposal is bound to the current template (v1) and its fingerprint', p1row.template_version === 1 && /^[0-9a-f]{64}$/.test(String(p1row.template_sha256)), { v: p1row.template_version })
check('B5 events: revoked (old) then proposed (new), no addresses', events.map((e) => e.data.change).join(',') === 'revoked,proposed' && !JSON.stringify(events).includes('@'), events.map((e) => e.data.change))
st = await status()
check('B6 status: the new proposal keeps the five days (same decisions; today\'s switch does not touch them) and can be authorized', st.proposal?.problem === null && st.proposal?.rehearsal?.consecutiveDays === 5, { problem: st.proposal?.problem, days: st.proposal?.rehearsal?.consecutiveDays })
check('B7 status: the letter text is shown', st.proposal?.template?.subject === 'Welcome, {{ first_name }}' && st.proposal?.template?.check === 'ok', st.proposal?.template)

// ── C. authorize ──
const cmd = { client_id: CLIENT, authorization_id: p1, rule_sha256: String(p1row.rule_sha256), template_sha256: String(p1row.template_sha256), backfill_hours: 0, expires_in_days: 90 }
const ap = await authorizeCommand(deps(), CLIENT, ACTOR, { ...cmd, confirm: false })
check('C1 authorize preview writes nothing', ap.body.mode === 'PREVIEW' && (await row(p1)).authorized_at === null, ap.body)
const wrong = await authorizeCommand(deps(), CLIENT, ACTOR, { ...cmd, rule_sha256: 'b'.repeat(64), confirm: true })
check('C2 another rule fingerprint than the stored one is refused', wrong.status === 409 && wrong.body.error === 'RULE_CHANGED', wrong.body)
const t0 = Date.now()
const ok = await authorizeCommand(deps(), CLIENT, ACTOR, { ...cmd, confirm: true })
check('C3 authorize confirm: authorized and armed', ok.status === 200 && ok.body.mode === 'AUTHORIZED', ok.body)
const a = await row(p1)
const authorizedAt = Date.parse(String(a.authorized_at))
check('C4 the approval time is now (the trigger stamps it; the store sends a placeholder)', Math.abs(authorizedAt - t0) < 60_000, { authorizedAt: a.authorized_at })
check('C5 live_from just before the approval, expiry inside 90 days', Date.parse(String(a.live_from)) < authorizedAt && Date.parse(String(a.expires_at)) <= authorizedAt + 90 * 86_400_000, { live_from: a.live_from, expires_at: a.expires_at })
check('C6 armed in a later statement, by the logged-in person', a.activated_at !== null && Date.parse(String(a.activated_at)) >= authorizedAt && a.authorized_by_email === ACTOR.email && a.authorized_by_user_id === ACTOR.userId, { activated_at: a.activated_at })
check('C7 event "authorized" went out before arming', events.at(-1)?.data.change === 'authorized', events.at(-1)?.data)
const again = await authorizeCommand(deps(), CLIENT, ACTOR, { ...cmd, confirm: true })
check('C8 a second click on the same proposal is refused', again.status === 409 && again.body.error === 'ALREADY_AUTHORIZED', again.body)
st = await status()
check('C9 status: the authorization is active', st.authorization?.state === 'active', st.authorization)

// ── D. the database's own guards, bypassing the store's filters ──
const sneak = await supabaseAdmin.from('triggered_send_authorizations').update({ authorized_by_email: 'x@example.test', authorized_by_user_id: ACTOR.userId, authorized_at: new Date().toISOString(), live_from: new Date(Date.now() - 60_000).toISOString(), expires_at: new Date(Date.now() + 86_400_000).toISOString() }).eq('id', p0.id).select('id')
check('D1 a revoked proposal cannot be authorized even by a direct write', sneak.error?.code === '23001', sneak.error?.code)
const rebind = await supabaseAdmin.from('triggered_send_authorizations').update({ daily_cap: 50 }).eq('id', p1).select('id')
check('D2 the approved content cannot be changed (bound columns immutable)', rebind.error?.code === '23001', rebind.error?.code)
const del = await supabaseAdmin.from('triggered_send_authorizations').delete().eq('id', p1).select('id')
check('D3 rows cannot be deleted', del.error?.code === '23001', del.error?.code)

// ── E. trials: only internal recipients; an authorization whose event fails is rolled back and says the old one stopped ──
const outsider = await proposeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, account: 'cts', daily_cap: 1, rule: baseRule({ send: SEND, recipient_allowlist: ['guest@gmail.com'] }), confirm: true })
check('E0 a trial to a non-internal address is refused', outsider.status === 422 && outsider.body.error === 'TRIAL_RECIPIENT_NOT_INTERNAL', outsider.body)
const pt = await proposeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, account: 'cts', daily_cap: 1, rule: baseRule({ send: SEND, recipient_allowlist: ['hello@example.test'] }), confirm: true })
const p2 = String(pt.body.authorization_id)
const p2row = await row(p2)
emitFails = true
const failed = await authorizeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, authorization_id: p2, rule_sha256: String(p2row.rule_sha256), template_sha256: String(p2row.template_sha256), backfill_hours: 0, expires_in_days: 7, confirm: true })
emitFails = false
check('E1 event not sent → 500, rollback OK, and the answer says the old authorization was stopped', failed.status === 500 && failed.body.error === 'AUTHORIZATION_EVENT_NOT_SENT' && failed.body.rollback === 'OK' && failed.body.replaced_authorization_revoked === true, failed.body)
const e2 = await row(p2)
check('E2 the trial authorization was revoked again and never armed', e2.revoked_by === 'system:AUTHORIZE_FAILED' && e2.activated_at === null, { by: e2.revoked_by, act: e2.activated_at })
const e3 = await row(p1)
check('E3 the authorization in force before was superseded first, naming the proposal that replaced it', e3.revoked_by === 'system:SUPERSEDED' && String(e3.revoked_reason).includes(p2), { by: e3.revoked_by, why: e3.revoked_reason })
check('E4 nothing of this client is in force now', (await openCount()) === 0, await openCount())

// ── F. window CHECKs and a changed template ──
const pf = await proposeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, account: 'cts', daily_cap: 5, rule: baseRule({ send: SEND }), confirm: true })
const p3 = String(pf.body.authorization_id)
const future = await authorizeProposal(supabaseAdmin, { id: p3, byEmail: ACTOR.email, byUserId: ACTOR.userId, liveFrom: new Date(Date.now() + 600_000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
check('F1 a live_from in the future is refused by the CHECK', !future.ok && future.code === '23514', future)
const tooLong = await authorizeProposal(supabaseAdmin, { id: p3, byEmail: ACTOR.email, byUserId: ACTOR.userId, liveFrom: new Date(Date.now() - 600_000).toISOString(), expiresAt: new Date(Date.now() + 91 * 86_400_000).toISOString() })
check('F2 an expiry beyond 90 days is refused by the CHECK', !tooLong.ok && tooLong.code === '23514', tooLong)
check('F3 after both refusals the proposal is still a clean proposal', (await row(p3)).authorized_at === null)
await supabaseAdmin.from('crm_email_templates').insert({ client_id: CLIENT, template_key: 'auto-welcome', version: 2, name: 'Welcome', subject: 'Welcome aboard, {{ first_name }}', body: 'Hi {{first_name}}, changed text.', fact_source: 'none', pick_mode: 'none', pick_filter: {}, status: 'active', created_by: 'fde@example.test' })
const p3row = await row(p3)
const changed = await authorizeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, authorization_id: p3, rule_sha256: String(p3row.rule_sha256), template_sha256: String(p3row.template_sha256), backfill_hours: 0, expires_in_days: 90, confirm: true })
check('F4 a template edited after the proposal is refused: propose again', changed.status === 409 && changed.body.error === 'TEMPLATE_CHANGED', changed.body)

// ── G. other decisions start the rehearsal count again; the brake, also from a stale page ──
const pg = await proposeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, account: 'cts', daily_cap: 5, rule: baseRule({ send: SEND, frequency_cap: { max: 1, window_days: 7 } }), confirm: true })
const p4 = String(pg.body.authorization_id)
const p4row = await row(p4)
st = await status()
check('G1 a rule that decides differently has no rehearsal days yet', st.proposal?.problem === 'REHEARSAL_NOT_READY', st.proposal?.problem)
const notReady = await authorizeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, authorization_id: p4, rule_sha256: String(p4row.rule_sha256), template_sha256: String(p4row.template_sha256), backfill_hours: 0, expires_in_days: 90, confirm: true })
check('G2 authorize refused until five days', notReady.status === 422 && notReady.body.error === 'REHEARSAL_NOT_READY', notReady.body)
const brake = await revokeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, authorization_id: p4, reason: 'pm pressed stop' })
check('G3 revoke works and records who', brake.status === 200 && (await row(p4)).revoked_by === ACTOR.email, brake.body)
const twice = await revokeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, authorization_id: p4, reason: 'again' })
check('G4 a second revoke changes nothing', twice.status === 409 && (await row(p4)).revoked_reason === 'pm pressed stop', twice.body)
const stale = await revokeCommand(deps(), CLIENT, ACTOR, { client_id: CLIENT, authorization_id: p1, reason: 'from an old page' })
check('G5 a brake on a stale page answers what is open now (here: nothing in force)', stale.status === 409 && stale.body.error === 'ALREADY_REVOKED' && stale.body.current_authorization === null, stale.body)

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
