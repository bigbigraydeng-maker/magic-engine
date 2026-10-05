/** Disposable PostgreSQL check for Magic Bridge self-serve activation and quotas. Never accepts a database URL. No production access. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import pg from 'pg'

const bin = process.env.META_ADS_TEST_PG_BIN
if (!bin) throw new Error('Set META_ADS_TEST_PG_BIN to a local PostgreSQL bin directory; a fresh cluster will be created.')
const root = await mkdtemp(join(tmpdir(), 'meta-selfserve-db-'))
const data = join(root, 'data')
const run = (name, args) => execFileSync(join(bin, name), args, { stdio: 'pipe' })
const clients = []
let started = false
let checks = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++ }
const ok = (c, msg) => { assert.ok(c, msg); checks++ }
async function connect() {
  const c = new pg.Client({ host: root, port: 5432, user: process.env.USER, database: 'postgres' })
  await c.connect(); clients.push(c); return c
}
async function denied(c, sql, params, code) {
  await assert.rejects(() => c.query(sql, params), (e) => { if (code) assert.equal(e.code, code, e.message); return true }); checks++
}
const id = (n) => `30000000-0000-0000-0000-${String(n).padStart(12, '0')}`

try {
  run('initdb', ['-D', data, '-A', 'trust', '--encoding=UTF8', '--locale=C'])
  run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${root} -c listen_addresses=''`, '-w', 'start']); started = true
  const db = await connect()
  await db.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE clients(id uuid PRIMARY KEY, meta_ad_account_id text, source text);
    CREATE TABLE client_portal_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid REFERENCES clients(id), email text NOT NULL, access_type text NOT NULL);
    CREATE TABLE client_meta_ad_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES clients(id), ad_account_id text NOT NULL, UNIQUE(client_id, ad_account_id));`)
  for (const f of [
    '20260603000001_platform_oauth_connections.sql', '20260627000001_p34_mcp_api_keys.sql', '20260913120000_client_binding_audit.sql',
    '20260920064556_meta_ads_ai_read_grants.sql', '20260920235723_meta_ads_ai_schema_forward_fix.sql',
    '20260921060122_meta_ads_ai_hosted_analysis.sql', '20260923093000_meta_ads_ai_handover.sql',
    '20260927160000_meta_ads_ai_self_serve.sql',
  ]) await db.query(await readFile(`supabase/migrations/${f}`, 'utf8'))

  // Clients: S1..S4 self-serve, M managed (ops), N self-serve row but member is not self_serve
  const S1 = id(1), S2 = id(2), S3 = id(3), S4 = id(4), M = id(5), N = id(6)
  await db.query(`INSERT INTO clients(id, source) VALUES($1,'self_serve'),($2,'self_serve'),($3,'self_serve'),($4,'self_serve'),($5,'fde'),($6,'self_serve')`, [S1, S2, S3, S4, M, N])
  await db.query(`INSERT INTO client_portal_users(client_id,email,access_type) VALUES
    ($1,'one@x.test','self_serve'),($2,'two@x.test','self_serve'),($3,'three@x.test','self_serve'),($4,'four@x.test','self_serve'),
    ($5,'m@x.test','self_serve'),($6,'n@x.test','client')`, [S1, S2, S3, S4, M, N])
  const activate = async (c, email) => (await db.query('SELECT meta_ads_self_serve_activate($1,$2) AS r', [c, email])).rows[0].r

  // 1. Who may activate.
  eq(await activate(M, 'm@x.test'), { ok: false, reason: 'not_allowed' }, 'managed (non self-serve) client refused')
  eq(await activate(N, 'n@x.test'), { ok: false, reason: 'not_allowed' }, 'member without self_serve access refused')
  eq(await activate(S1, 'stranger@x.test'), { ok: false, reason: 'not_allowed' }, 'non-member refused')
  eq(await activate(S1, ''), { ok: false, reason: 'not_allowed' }, 'empty email refused')
  eq(await activate(S1, 'ONE@x.test'), { ok: true, result: 'activated' }, 'self-serve member activates (email case-insensitive)')
  const e1 = (await db.query(`SELECT source, status, sponsored_analysis_enabled, approved_by_email, expires_at > now() + interval '89 days' AS ninety FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1`, [S1])).rows[0]
  eq(e1, { source: 'self_serve', status: 'active', sponsored_analysis_enabled: true, approved_by_email: 'self_serve:one@x.test', ninety: true }, 'entitlement shape')
  eq(await activate(S1, 'one@x.test'), { ok: true, result: 'already_active' }, 'second click is idempotent')
  const revBefore = (await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1', [S1])).rows[0].revision
  await db.query(`UPDATE meta_ads_ai_pilot_entitlements SET starts_at = now() - interval '100 days', expires_at = now() - interval '1 day' WHERE client_id=$1`, [S1])
  eq(await activate(S1, 'one@x.test'), { ok: true, result: 'renewed' }, 'expired self-serve renews')
  ok((await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1', [S1])).rows[0].revision !== revBefore, 'renewal rotates the revision (old OAuth cannot return)')
  // renewal must not re-enable a client ops switched off
  await db.query(`UPDATE meta_ads_ai_pilot_entitlements SET sponsored_analysis_enabled=false, starts_at = now() - interval '100 days', expires_at = now() - interval '1 day' WHERE client_id=$1`, [S1])
  eq(await activate(S1, 'one@x.test'), { ok: true, result: 'renewed' }, 'renews again')
  eq((await db.query('SELECT sponsored_analysis_enabled AS e FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1', [S1])).rows[0].e, false, 'renewal keeps sponsored analysis switched off')
  await db.query('UPDATE meta_ads_ai_pilot_entitlements SET sponsored_analysis_enabled=true WHERE client_id=$1', [S1])
  eq(await activate(S2, 'two@x.test'), { ok: true, result: 'activated' }, 'S2 activates')
  await db.query(`UPDATE meta_ads_ai_pilot_entitlements SET status='paused' WHERE client_id=$1`, [S2])
  eq(await activate(S2, 'two@x.test'), { ok: false, reason: 'not_allowed' }, 'paused cannot be reopened by the customer')
  await db.query(`UPDATE meta_ads_ai_pilot_entitlements SET status='active' WHERE client_id=$1`, [S2])
  await db.query(`INSERT INTO meta_ads_ai_pilot_entitlements(client_id,status,approved_by_email,sponsored_analysis_enabled) VALUES($1,'active','ops@x.test',true)`, [M])
  eq((await db.query('SELECT source FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1', [M])).rows[0].source, 'ops', 'existing / ops rows default to source ops')
  eq(await activate(S3, 'three@x.test'), { ok: true, result: 'activated' }, 'S3 activates')
  eq(await activate(S4, 'four@x.test'), { ok: true, result: 'activated' }, 'S4 activates')

  // Connections + grants
  const rev = async (c) => (await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1', [c])).rows[0].revision
  let n = 100
  const connect_ = async (client, fbUser) => {
    const cid = id(++n)
    await db.query(`INSERT INTO platform_oauth_connections(id,client_id,provider,access_token_enc,refresh_token_enc,token_expiry,account_id,display_name,scopes,purpose,authorizing_principal_id,entitlement_revision)
      VALUES($1,$2,'meta','cipher','',now()+interval '30 day',$3,'t',ARRAY['ads_read'],'meta_ads_read',$2,$4)`, [cid, client, `ads_user:${fbUser}`, await rev(client)])
    return cid
  }
  const grant = async (client, conn, account) => (await db.query(`INSERT INTO meta_ads_read_grants(client_id,connection_id,ad_account_id,principal_id,entitlement_revision)
    VALUES($1,$2,$3,$1,$4) RETURNING id`, [client, conn, account, await rev(client)])).rows[0].id
  const reserve = async (client, g, key) => (await db.query(`SELECT meta_ads_reserve_sponsored_analysis($1,$1,$2,$3,'2026-09-01','2026-09-07') AS r`, [client, g, key.repeat(64).slice(0, 64)])).rows[0].r
  const finish = async (client, job, cost) => (await db.query(`SELECT meta_ads_finish_sponsored_analysis($1,$1,$2,'completed',$3) AS r`, [client, job, cost])).rows[0].r

  // 2. Same Facebook user across two self-serve clients shares one monthly allowance.
  await db.query(`UPDATE meta_ads_ai_quota_config SET cap_usd = 0.2 WHERE scope = 'facebook_user'`)
  const gS1 = await grant(S1, await connect_(S1, '111'), 'act_1000000001')
  const r1 = await reserve(S1, gS1, 'a')
  eq([r1.reserved, r1.idempotent], [true, false], 'first reservation for Facebook user 111')
  const fbKey = (await db.query(`SELECT meta_ads_facebook_user_key('ads_user:111') AS k`)).rows[0].k
  eq(fbKey, createHash('sha256').update('meta-ads-user:ads_user:111').digest('hex'), 'database key equals the Node blocklist key')
  const led = (await db.query('SELECT facebook_user_key, ad_account_id, amount_usd::text AS a FROM meta_ads_ai_quota_usage WHERE job_id=$1', [r1.job_id])).rows[0]
  eq([led.facebook_user_key, led.ad_account_id, led.a], [fbKey, 'act_1000000001', '0.120000'], 'ledger row written at reserve')
  ok(!fbKey.includes('111') && /^[0-9a-f]{64}$/.test(fbKey), 'key is a hash, not the id')
  const gS2 = await grant(S2, await connect_(S2, '111'), 'act_1000000002')
  eq((await reserve(S2, gS2, 'b')).reason, 'facebook_user_quota_reached', 'same person under a new sign-up is capped')
  eq(await finish(S1, r1.job_id, 0.01), true, 'finish still works')
  eq((await reserve(S2, gS2, 'c')).reason, 'facebook_user_quota_reached', 'usage counts the reservation, not the smaller actual cost')
  // Deleting the first client or flipping its source must not give the allowance back.
  await db.query(`UPDATE meta_ads_ai_pilot_entitlements SET source='ops' WHERE client_id=$1`, [S1])
  eq((await reserve(S2, gS2, 'c2')).reason, 'facebook_user_quota_reached', 'changing the source does not reset usage')
  await db.query(`UPDATE meta_ads_ai_pilot_entitlements SET source='self_serve' WHERE client_id=$1`, [S1])
  await db.query('DELETE FROM meta_ads_ai_analysis_jobs WHERE id=$1', [r1.job_id])
  eq((await reserve(S2, gS2, 'c3')).reason, 'facebook_user_quota_reached', 'deleting the job/client rows does not reset usage (ledger has no FK)')
  await db.query(`UPDATE meta_ads_ai_quota_config SET cap_usd = 1.0 WHERE scope = 'facebook_user'`)

  // Two sessions racing for the last slot: exactly one wins.
  await db.query(`UPDATE meta_ads_ai_quota_config SET cap_usd = 0.36 WHERE scope = 'facebook_user'`)
  const c1 = await connect(), c2 = await connect()
  const gRaceA = await grant(S1, await connect_(S1, '999'), 'act_1000000009')
  const gRaceB = await grant(S3, await connect_(S3, '999'), 'act_1000000008')
  await reserve(S1, gRaceA, 'q'); await reserve(S3, gRaceB, 'r')
  await c1.query('BEGIN'); await c2.query('BEGIN')
  const ra = (await c1.query(`SELECT meta_ads_reserve_sponsored_analysis($1,$1,$2,$3,'2026-09-01','2026-09-07') AS r`, [S1, gRaceA, 's'.repeat(64)])).rows[0].r
  const pb = c2.query(`SELECT meta_ads_reserve_sponsored_analysis($1,$1,$2,$3,'2026-09-01','2026-09-07') AS r`, [S3, gRaceB, 't'.repeat(64)])
  await new Promise((resolve) => setTimeout(resolve, 300))
  await c1.query('COMMIT')
  const rb = (await pb).rows[0].r
  await c2.query('COMMIT')
  eq([ra.reserved, rb.reason], [true, 'facebook_user_quota_reached'], 'concurrent reservations: the second waits for the lock and sees the first')
  await db.query(`UPDATE meta_ads_ai_quota_config SET cap_usd = 1.0 WHERE scope = 'facebook_user'`)

  // Snapshot isolation is refused (the locks would not serialise).
  const c3 = await connect()
  await c3.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
  await denied(c3, `SELECT meta_ads_quota_check('2026-09','act_1000000001',$1,0.12)`, [fbKey], '25001')
  await c3.query('ROLLBACK')

  // 3. Same ad account, moved to another self-serve client, shares its monthly allowance.
  await db.query(`UPDATE meta_ads_ai_quota_config SET cap_usd = 0.2 WHERE scope = 'ad_account'`)
  const gS3 = await grant(S3, await connect_(S3, '333'), 'act_1000000003')
  eq((await reserve(S3, gS3, 'd')).reserved, true, 'account 3 first reservation')
  await db.query('UPDATE meta_ads_read_grants SET revoked_at = now() WHERE id=$1', [gS3])
  const gS4 = await grant(S4, await connect_(S4, '444'), 'act_1000000003')
  eq((await reserve(S4, gS4, 'e')).reason, 'ad_account_quota_reached', 'same ad account under another client is capped')
  await db.query(`UPDATE meta_ads_ai_quota_config SET cap_usd = 1.0 WHERE scope = 'ad_account'`)

  // 4. Platform cap across all self-serve clients; ops clients are not counted nor capped.
  const used = Number((await db.query(`SELECT meta_ads_quota_used(to_char(now() AT TIME ZONE 'UTC','YYYY-MM'),'platform','') AS u`)).rows[0].u)
  ok(used > 0, 'platform usage is counted from the ledger')
  await db.query(`UPDATE meta_ads_ai_quota_config SET cap_usd = $1 WHERE scope = 'platform'`, [used + 0.05])
  eq((await reserve(S4, gS4, 'f')).reason, 'platform_quota_reached', 'platform cap reached (reported as its own reason)')
  const gM = await grant(M, await connect_(M, '555'), 'act_1000000005')
  eq((await reserve(M, gM, 'g')).reserved, true, 'ops client is not limited by the self-serve caps')
  eq(Number((await db.query(`SELECT meta_ads_quota_used(to_char(now() AT TIME ZONE 'UTC','YYYY-MM'),'platform','') AS u`)).rows[0].u), used, 'ops jobs do not count toward the platform cap')
  await db.query(`UPDATE meta_ads_ai_quota_config SET cap_usd = 30 WHERE scope = 'platform'`)

  // 5. Blocklist.
  const blockKey = (await db.query(`SELECT meta_ads_facebook_user_key('ads_user:444') AS k`)).rows[0].k
  await db.query(`INSERT INTO meta_ads_ai_blocklist(kind,key,reason) VALUES('facebook_user',$1,'abuse test')`, [blockKey])
  eq((await reserve(S4, gS4, 'h')).reason, 'blocked', 'blocked Facebook user cannot reserve')
  eq((await db.query(`SELECT meta_ads_is_blocked('facebook_user',$1) AS b`, [blockKey])).rows[0].b, true, 'is_blocked sees it')
  await db.query(`DELETE FROM meta_ads_ai_blocklist`)
  await db.query(`INSERT INTO meta_ads_ai_blocklist(kind,key,reason) VALUES('ad_account','act_1000000003','abuse test')`)
  eq((await reserve(S4, gS4, 'i')).reason, 'blocked', 'blocked ad account cannot reserve')
  await denied(db, `INSERT INTO meta_ads_ai_blocklist(kind,key,reason) VALUES('facebook_user','not-a-hash','x')`, [], '23514')

  // 6. Only service_role may call the new functions or read the new tables.
  for (const role of ['anon', 'authenticated']) {
    const c = await connect()
    await c.query(`SET ROLE ${role}`)
    await denied(c, 'SELECT meta_ads_self_serve_activate($1,$2)', [S1, 'one@x.test'], '42501')
    await denied(c, `SELECT meta_ads_quota_check('2026-09','act_1000000001',$1,0.12)`, [fbKey], '42501')
    await denied(c, 'SELECT * FROM meta_ads_ai_quota_config', [], '42501')
    await denied(c, 'SELECT * FROM meta_ads_ai_blocklist', [], '42501')
  }

  console.log(`PASS ${checks} isolated PostgreSQL checks (self-serve activation, renewal, per-Facebook-user / per-ad-account / platform caps, ops exemption, blocklist, ACL).`)
} finally {
  for (const c of clients) await c.end().catch(() => {})
  if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'])
  await rm(root, { recursive: true, force: true })
}
