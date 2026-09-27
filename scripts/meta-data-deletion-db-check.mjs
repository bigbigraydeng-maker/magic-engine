/** Disposable PostgreSQL check for the Meta data deletion function. Never accepts a database URL. No production access. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import pg from 'pg'

const bin = process.env.META_ADS_TEST_PG_BIN
if (!bin) throw new Error('Set META_ADS_TEST_PG_BIN to a local PostgreSQL bin directory; a fresh cluster will be created.')
const root = await mkdtemp(join(tmpdir(), 'meta-deletion-db-'))
const data = join(root, 'data')
const run = (name, args) => execFileSync(join(bin, name), args, { stdio: 'pipe' })
const clients = []
let started = false
let checks = 0
const ok = (cond, msg) => { assert.ok(cond, msg); checks++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++ }
async function connect(user) {
  const c = new pg.Client({ host: root, port: 5432, user: user ?? process.env.USER, database: 'postgres' })
  await c.connect(); clients.push(c); return c
}
async function denied(c, sql, params, code) {
  await assert.rejects(() => c.query(sql, params), (e) => { if (code) assert.equal(e.code, code, e.message); return true }); checks++
}
const hash = (id) => createHash('sha256').update(`meta-app-user:${id}`).digest('hex')
const code = (n) => `code_${String(n).padStart(24, 'x')}`

const A = '10000000-0000-0000-0000-00000000000a'
const B = '10000000-0000-0000-0000-00000000000b'
const connA1 = '20000000-0000-0000-0000-0000000000a1' // Facebook user 111 in client A
const connB1 = '20000000-0000-0000-0000-0000000000b1' // same Facebook user 111 in client B
const connA2 = '20000000-0000-0000-0000-0000000000a2' // another Facebook user 222 in client A

try {
  run('initdb', ['-D', data, '-A', 'trust', '--encoding=UTF8', '--locale=C'])
  run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${root} -c listen_addresses=''`, '-w', 'start']); started = true
  const db = await connect()
  await db.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE clients(id uuid PRIMARY KEY, meta_ad_account_id text);
    CREATE TABLE client_meta_ad_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES clients(id), ad_account_id text NOT NULL, UNIQUE(client_id, ad_account_id));`)
  for (const f of [
    '20260603000001_platform_oauth_connections.sql', '20260627000001_p34_mcp_api_keys.sql', '20260913120000_client_binding_audit.sql',
    '20260920064556_meta_ads_ai_read_grants.sql', '20260920235723_meta_ads_ai_schema_forward_fix.sql',
    '20260921060122_meta_ads_ai_hosted_analysis.sql', '20260923093000_meta_ads_ai_handover.sql',
    '20260927150000_meta_data_deletion_requests.sql',
  ]) await db.query(await readFile(`supabase/migrations/${f}`, 'utf8'))

  await db.query('INSERT INTO clients(id) VALUES($1),($2)', [A, B])
  await db.query(`INSERT INTO meta_ads_ai_pilot_entitlements(client_id,status,approved_by_email) VALUES($1,'active','ops@example.test'),($2,'active','ops@example.test')`, [A, B])
  const rev = async (c) => (await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1', [c])).rows[0].revision
  const conn = async (id, client, fbUser) => db.query(`INSERT INTO platform_oauth_connections(id,client_id,provider,access_token_enc,refresh_token_enc,token_expiry,account_id,display_name,scopes,purpose,authorizing_principal_id,entitlement_revision)
    VALUES($1,$2,'meta','cipher-token','cipher-refresh',now()+interval '30 day',$3,'test',ARRAY['ads_read'],'meta_ads_read',$2,$4)`, [id, client, `ads_user:${fbUser}`, await rev(client)])
  await conn(connA1, A, '111'); await conn(connB1, B, '111'); await conn(connA2, A, '222')
  const grant = async (client, connection, account) => (await db.query(`INSERT INTO meta_ads_read_grants(client_id,connection_id,ad_account_id,principal_id,entitlement_revision)
    VALUES($1,$2,$3,$1,$4) RETURNING id, revision, entitlement_revision`, [client, connection, account, await rev(client)])).rows[0]
  const gA1 = await grant(A, connA1, 'act_1111111111')
  const gB1 = await grant(B, connB1, 'act_2222222222')
  const gA2 = await grant(A, connA2, 'act_3333333333')
  const job = async (client, g, account, key) => (await db.query(`INSERT INTO meta_ads_ai_analysis_jobs(client_id,principal_id,grant_id,grant_revision,connection_version,entitlement_revision,ad_account_id,idempotency_key,period_key,window_since,window_until,status,reserved_usd,evidence,report_markdown)
    VALUES($1,$1,$2,$3,now(),$4,$5,$6,'2026-09','2026-09-01','2026-09-07','completed',0.12,'{"campaigns":[1]}'::jsonb,'一、总体结果') RETURNING id`,
    [client, g.id, g.revision, g.entitlement_revision, account, key.repeat(64)])).rows[0].id
  const jA1 = await job(A, gA1, 'act_1111111111', 'a')
  const jB1 = await job(B, gB1, 'act_2222222222', 'b')
  const jA2 = await job(A, gA2, 'act_3333333333', 'c')
  const key = async (client, g, h) => (await db.query(`INSERT INTO client_api_keys(client_id,key_hash,key_prefix,name,scopes,expires_at,metadata)
    VALUES($1::uuid,$2,'me_live_x','Meta Ads read-only',ARRAY['meta:ads:read'],now()+interval '1 day',
    jsonb_build_object('meta_ads_grant_id',$3::text,'meta_ads_grant_revision',$4::text,'meta_ads_principal_id',$1::uuid::text,'meta_ads_entitlement_revision',$5::text)) RETURNING id`,
    [client, h, g.id, g.revision, g.entitlement_revision])).rows[0].id
  const kA1 = await key(A, gA1, 'hash-a1')
  const kA2 = await key(A, gA2, 'hash-a2')

  const del = (id, issued, c) => db.query('SELECT * FROM meta_process_data_deletion($1,$2,$3,$4)', [id, hash(id), issued, c])

  // 1. Deleting Facebook user 111 reaches both clients, leaves user 222 alone.
  const issued1 = new Date(Date.now() + 1000).toISOString()
  const r1 = (await del('111', issued1, code(1))).rows[0]
  eq({ ...r1 }, { confirmation_code: code(1), status: 'completed', connections_revoked: 2, reports_cleared: 2, keys_revoked: 1 }, 'first deletion result')
  const conns = (await db.query('SELECT id,status,authorizing_principal_id,access_token_enc,refresh_token_enc FROM platform_oauth_connections ORDER BY id')).rows
  const byId = Object.fromEntries(conns.map((c) => [c.id, c]))
  for (const id of [connA1, connB1]) {
    eq([byId[id].status, byId[id].authorizing_principal_id, byId[id].access_token_enc, byId[id].refresh_token_enc], ['revoked', null, '', ''], `connection ${id} revoked and blanked`)
  }
  eq([byId[connA2].status, byId[connA2].access_token_enc], ['active', 'cipher-token'], 'other Facebook user untouched')
  const grants = Object.fromEntries((await db.query('SELECT id, revoked_at IS NOT NULL AS revoked FROM meta_ads_read_grants')).rows.map((g) => [g.id, g.revoked]))
  eq([grants[gA1.id], grants[gB1.id], grants[gA2.id]], [true, true, false], 'grants revoked only for user 111')
  const jobs = Object.fromEntries((await db.query('SELECT id, evidence, report_markdown, error_code FROM meta_ads_ai_analysis_jobs')).rows.map((j) => [j.id, j]))
  for (const id of [jA1, jB1]) eq([jobs[id].evidence, jobs[id].report_markdown, jobs[id].error_code], [null, null, 'deleted_by_user_request'], `report ${id} emptied`)
  eq([jobs[jA2].report_markdown], ['一、总体结果'], 'other user report kept')
  const keys = Object.fromEntries((await db.query('SELECT id, revoked_at IS NOT NULL AS revoked FROM client_api_keys')).rows.map((k) => [k.id, k.revoked]))
  eq([keys[kA1], keys[kA2]], [true, false], 'only the deleted user key revoked')
  const stored = (await db.query('SELECT * FROM meta_data_deletion_requests')).rows
  eq(stored.length, 1, 'one request row')
  ok(stored[0].app_user_hash === hash('111') && !JSON.stringify(stored[0]).includes('"111"'), 'only the hashed user id is stored')

  // 2. Replay of the same request returns the stored result and writes nothing new.
  const r2 = (await del('111', issued1, code(2))).rows[0]
  eq([r2.confirmation_code, r2.status, r2.connections_revoked], [code(1), 'completed', 2], 'replay returns the first confirmation')
  eq(Number((await db.query('SELECT count(*) FROM meta_data_deletion_requests')).rows[0].count), 1, 'replay adds no row')

  // 3. The person reconnects afterwards; an old request (issued before the reconnect) must not wipe the new connection.
  const reconnect = '20000000-0000-0000-0000-0000000000a3'
  await conn(reconnect, A, '999')
  const oldIssued = new Date(Date.now() - 3600_000).toISOString()
  const r3 = (await del('999', oldIssued, code(3))).rows[0]
  eq([r3.status, r3.connections_revoked], ['no_data', 0], 'old request skips a connection created later')
  eq((await db.query('SELECT status FROM platform_oauth_connections WHERE id=$1', [reconnect])).rows[0].status, 'active', 'reconnected connection stays active')

  // 4. Unknown person → no_data, still gets a confirmation code.
  const r4 = (await del('55555', new Date().toISOString(), code(4))).rows[0]
  eq([r4.confirmation_code, r4.status], [code(4), 'no_data'], 'unknown user answers no_data')

  // 5. Bad input is refused.
  await denied(db, 'SELECT * FROM meta_process_data_deletion($1,$2,$3,$4)', ['12a', hash('12a'), new Date().toISOString(), code(5)], '22023')
  await denied(db, 'SELECT * FROM meta_process_data_deletion($1,$2,$3,$4)', ['123', 'nothex', new Date().toISOString(), code(6)], '22023')
  await denied(db, 'SELECT * FROM meta_process_data_deletion($1,$2,$3,$4)', ['123', hash('123'), new Date(Date.now() + 3600_000).toISOString(), code(7)], '22023')
  await denied(db, 'SELECT * FROM meta_process_data_deletion($1,$2,$3,$4)', ['123', hash('123'), new Date().toISOString(), 'short'], '23514')

  // 6. Nobody but service_role may call the function or read the table.
  for (const role of ['anon', 'authenticated']) {
    const c = await connect()
    await c.query(`SET ROLE ${role}`)
    await denied(c, 'SELECT * FROM meta_process_data_deletion($1,$2,$3,$4)', ['111', hash('111'), new Date().toISOString(), code(8)], '42501')
    await denied(c, 'SELECT * FROM meta_data_deletion_requests', [], '42501')
  }

  console.log(`PASS ${checks} isolated PostgreSQL checks (Meta data deletion: cross-client revoke, token blanking, report emptying, key revoke, replay, reconnect, input, ACL).`)
} finally {
  for (const c of clients) await c.end().catch(() => {})
  if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'])
  await rm(root, { recursive: true, force: true })
}
