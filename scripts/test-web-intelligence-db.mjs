#!/usr/bin/env node
/** Real PostgreSQL boundary checks; never reads DATABASE_URL or production credentials. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pgBin = '/opt/homebrew/opt/postgresql@17/bin'
const instance = await mkdtemp(resolve(repo, '../web-intelligence-pg-'))
const data = resolve(instance, 'data')
const evidence = { localOnly: true, postgres: null, checks: [], failures: [], startedAt: new Date().toISOString() }
let started = false

async function freePort() {
  const server = createServer()
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', accept)
  })
  const port = server.address().port
  await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()))
  return port
}

let port
async function pg(command, args) {
  return exec(resolve(pgBin, command), args, { env: { PATH: process.env.PATH, LC_ALL: 'C', LANG: 'C' }, maxBuffer: 8 * 1024 * 1024 })
}
async function sql(statement) {
  const result = await pg('psql', ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q', '-c', statement])
  return result.stdout.trim()
}

function literal(value) { return "'" + value.replaceAll("'", "''") + "'" }
async function check(name, run) {
  try {
    await run()
    evidence.checks.push(name)
  } catch (error) {
    evidence.failures.push(`${name}: ${error.message}`)
  }
}
async function denied(statement, pattern) {
  await assert.rejects(() => sql(statement), pattern)
}
async function fixture() {
  const client = randomUUID()
  await sql(`INSERT INTO clients VALUES ('${client}');
    INSERT INTO web_intelligence_settings(client_id,enabled,entitled,usd_to_nzd,fx_as_of,actor_build)
      VALUES ('${client}',true,true,2,current_date,'1.0.0');
    INSERT INTO competitor_monitoring_metadata(client_id,domain,tier) VALUES ('${client}','example.com','core');`)
  return client
}
function reserve(client, id = randomUUID(), domain = 'example.com', path = '/') {
  return { id, statement: `SELECT web_intelligence_reserve('${id}','${client}','${domain}','https://${domain}${path}')` }
}
async function capture(client, content, hash) {
  const request = reserve(client)
  await sql(request.statement)
  await sql(`UPDATE web_intelligence_runs SET provider_run_id='local-fixture',provider_status='SUCCEEDED' WHERE id='${request.id}'`)
  const result = JSON.parse(await sql(`SELECT web_intelligence_record_snapshot('${request.id}','${client}','https://example.com/','Fixture',${literal(content)},'${hash}')`))
  await sql(`UPDATE web_intelligence_runs SET capture_cost_usd=0.01,interpretation_cost_usd=0 WHERE id='${request.id}'; SELECT web_intelligence_settle('${request.id}','${client}')`)
  return { ...result, runId: request.id }
}
async function businessCapture(client, raw, projection, version = 'business-content-v1+actor-1.0.0', path = '/', finalUrl = `https://example.com${path}`) {
  const request = reserve(client, randomUUID(), 'example.com', path)
  await sql(request.statement)
  await sql(`UPDATE web_intelligence_runs SET provider_run_id='local-fixture',provider_status='SUCCEEDED' WHERE id='${request.id}'`)
  const result = JSON.parse(await sql(`SELECT web_intelligence_record_business_snapshot(
    '${request.id}','${client}',${literal(finalUrl)},'Fixture',${literal(raw)},
    '${createHash('sha256').update(raw).digest('hex')}',${literal(projection)},
    '${createHash('sha256').update(projection).digest('hex')}','${version}','product_listing')`))
  await sql(`UPDATE web_intelligence_runs SET capture_cost_usd=0.01,interpretation_cost_usd=0 WHERE id='${request.id}'; SELECT web_intelligence_settle('${request.id}','${client}')`)
  return { ...result, runId: request.id }
}
async function verifyDatabase(migration) {
  await sql(`CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
    GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
    CREATE TABLE clients(id uuid PRIMARY KEY);
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`)
  await sql(migration)
  for (const [name, run] of databaseChecks) await check(name, run)
}

const databaseChecks = [
  ['Migration applies to real PostgreSQL with production-like pre-existing grants', async () => {
    assert.equal(await sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"), '7')
  }],
  ['Concurrent independent connections atomically enforce NZ$50 hard stop', async () => {
    const client = await fixture()
    const seed = reserve(client)
    await sql(seed.statement)
    await sql(`UPDATE web_intelligence_runs SET accounted_nzd=49,status='complete' WHERE id='${seed.id}'`)
    const first = reserve(client, randomUUID(), 'example.com', '/one'), second = reserve(client, randomUUID(), 'example.com', '/two')
    const results = await Promise.allSettled([
      sql(`BEGIN; ${first.statement}; SELECT pg_sleep(0.2); COMMIT;`),
      sql(`BEGIN; ${second.statement}; SELECT pg_sleep(0.2); COMMIT;`),
    ])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    assert.match(results.find(r => r.status === 'rejected').reason.message, /hard_stop/)
    assert.equal(Number(await sql(`SELECT sum(coalesce(accounted_nzd,reserved_nzd)) FROM web_intelligence_runs WHERE client_id='${client}'`)),49.72)
  }],
  ['Concurrent same-target requests share exactly one active reservation', async () => {
    const client = await fixture(), one = reserve(client), two = reserve(client)
    const results = await Promise.all([sql(one.statement), sql(two.statement)])
    assert.equal(JSON.parse(results[0]).id, JSON.parse(results[1]).id)
    assert.equal(await sql(`SELECT count(*) FROM web_intelligence_runs WHERE client_id='${client}'`),'1')
    assert.equal(await sql(`SELECT sum(reserved_nzd) FROM web_intelligence_runs WHERE client_id='${client}'`),'0.72')
  }],
  ['Disabling queued work blocks both paid stages without claiming; enabled stage claims are once only', async () => {
    const client = await fixture(), request = reserve(client)
    await sql(request.statement)
    for (const setting of ['enabled','entitled']) {
      await sql(`UPDATE web_intelligence_settings SET ${setting}=false WHERE client_id='${client}'`)
      for (const stage of ['capture','interpretation']) {
        await denied(`SELECT web_intelligence_claim('${request.id}','${client}','${stage}')`,/execution_disabled/)
      }
      assert.equal(await sql(`SELECT capture_claimed OR interpretation_claimed FROM web_intelligence_runs WHERE id='${request.id}'`),'f')
      await sql(`UPDATE web_intelligence_settings SET ${setting}=true WHERE client_id='${client}'`)
    }
    for (const stage of ['capture','interpretation']) {
      assert.equal(await sql(`SELECT web_intelligence_claim('${request.id}','${client}','${stage}')`),'t')
      assert.equal(await sql(`SELECT web_intelligence_claim('${request.id}','${client}','${stage}')`),'f')
    }
  }],
  ['Disabling previously claimed unknown attempts never reclassifies their cost as zero', async () => {
    for (const stage of ['capture','interpretation']) {
      const client = await fixture(), request = reserve(client)
      await sql(request.statement)
      assert.equal(await sql(`SELECT web_intelligence_claim('${request.id}','${client}','${stage}')`),'t')
      await sql(`UPDATE web_intelligence_settings SET enabled=false WHERE client_id='${client}'`)
      assert.equal(await sql(`SELECT web_intelligence_claim('${request.id}','${client}','${stage}')`),'f')
      const row = JSON.parse(await sql(`SELECT row_to_json(r) FROM web_intelligence_runs r WHERE id='${request.id}'`))
      assert.equal(row.provider_run_id,null)
      assert.equal(row.capture_cost_usd,null)
      assert.equal(row.interpretation_cost_usd,null)
      assert.equal(row.accounted_nzd,null)
      assert.equal(row.reserved_nzd,0.72)
      const settled = JSON.parse(await sql(`SELECT web_intelligence_settle('${request.id}','${client}')`))
      assert.equal(settled.status,'reconciliation')
      assert.equal(settled.accounted_nzd,null)
      assert.equal(settled.reserved_nzd,0.72)
    }
  }],
  ['Request replay does not reserve twice and rejects changed identity', async () => {
    const client = await fixture(), request = reserve(client)
    await sql(request.statement)
    await sql(request.statement)
    assert.equal(await sql(`SELECT count(*) FROM web_intelligence_runs WHERE client_id='${client}'`), '1')
    await denied(`SELECT web_intelligence_reserve('${request.id}','${client}','other.com','https://other.com/')`, /request_identity_mismatch/)
    for (const args of [`'${request.id}',NULL,'example.com','https://example.com/'`, `'${request.id}','${client}',NULL,'https://example.com/'`, `'${request.id}','${client}','example.com',NULL`]) {
      await denied(`SELECT web_intelligence_reserve(${args})`, /request_identity_mismatch|invalid_request|invalid_identity/)
    }
  }],
  ['Unknown provider costs retain reservation and block even across months', async () => {
    const client = await fixture(), request = reserve(client)
    await sql(request.statement)
    const settled = JSON.parse(await sql(`SELECT web_intelligence_settle('${request.id}','${client}')`))
    assert.equal(settled.status, 'reconciliation')
    assert.equal(settled.accounted_nzd, null)
    assert.equal(settled.reserved_nzd, 0.72)
    await sql(`UPDATE web_intelligence_runs SET period_key='2000-01' WHERE id='${request.id}'`)
    await denied(reserve(client).statement, /unresolved_cost/)
  }],
  ['Unsettled previous-month in-flight work blocks new-month spending', async () => {
    const client = await fixture(), request = reserve(client)
    await sql(request.statement)
    await sql(`UPDATE web_intelligence_runs SET period_key='2000-01',status='capturing',capture_claimed=true,provider_run_id='unfinished-provider' WHERE id='${request.id}'`)
    await denied(reserve(client).statement, /unresolved_cost/)
  }],
  ['Actual spend above reservation is recorded in full and blocks further spend', async () => {
    const client = await fixture(), request = reserve(client)
    await sql(request.statement)
    await sql(`UPDATE web_intelligence_runs SET capture_cost_usd=3,interpretation_cost_usd=2 WHERE id='${request.id}'`)
    const settled = JSON.parse(await sql(`SELECT web_intelligence_settle('${request.id}','${client}')`))
    assert.equal(settled.accounted_nzd, 10.02)
    assert.equal(settled.status, 'reconciliation')
    await denied(reserve(client).statement, /unresolved_cost/)
    const replay = JSON.parse(await sql(`SELECT web_intelligence_settle('${request.id}','${client}')`))
    assert.equal(replay.accounted_nzd,10.02)
  }],
  ['NZ$30 pauses non-core targets while core remains eligible', async () => {
    const client = await fixture(), seed = reserve(client)
    await sql(seed.statement)
    await sql(`UPDATE web_intelligence_runs SET accounted_nzd=29.5,status='complete' WHERE id='${seed.id}'`)
    await denied(reserve(client, randomUUID(), 'secondary.com').statement, /target_pause_non_core/)
    await sql(reserve(client).statement)
  }],
  ['Disabled, unentitled, stale-FX, archived and absent settings fail closed', async () => {
    const client = await fixture()
    for (const [update, pattern] of [
      ['enabled=false', /not_enabled_or_entitled/],
      ['enabled=true,entitled=false', /not_enabled_or_entitled/],
      ["entitled=true,fx_as_of=current_date-32", /fx_stale/],
    ]) {
      await sql(`UPDATE web_intelligence_settings SET ${update} WHERE client_id='${client}'`)
      await denied(reserve(client).statement, pattern)
    }
    await sql(`UPDATE web_intelligence_settings SET fx_as_of=current_date WHERE client_id='${client}'; UPDATE competitor_monitoring_metadata SET status='archive' WHERE client_id='${client}'`)
    await denied(reserve(client).statement,/archived/)
    await denied(reserve(randomUUID()).statement,/not_enabled_or_entitled/)
  }],
  ['Snapshots distinguish baseline, unchanged and genuine transitions; retries do not duplicate', async () => {
    const client = await fixture()
    const first = await capture(client, 'A'.repeat(100), 'a')
    const same = await capture(client, 'A'.repeat(100), 'a')
    const changed = await capture(client, 'B'.repeat(100), 'b')
    assert.equal(first.state,'baseline'); assert.equal(first.signal_id,null)
    assert.equal(same.state,'unchanged'); assert.equal(same.signal_id,null)
    assert.equal(changed.state,'changed'); assert.ok(changed.signal_id)
    const replay = JSON.parse(await sql(`SELECT web_intelligence_record_snapshot('${changed.runId}','${client}','https://example.com/','Fixture','${'B'.repeat(100)}','b')`))
    assert.equal(replay.signal_id,changed.signal_id)
    assert.equal(await sql(`SELECT count(*) FROM market_signals WHERE client_id='${client}'`),'1')
  }],
  ['Business projection suppresses framework noise and version upgrades start a baseline', async () => {
    const client = await fixture()
    const first = await businessCapture(client, 'Navigation v1\nTour Alpha\nFrom NZ$5,000'.repeat(5), 'Tour Alpha\nFrom NZ$5,000'.repeat(5))
    const noise = await businessCapture(client, 'Navigation v2\nTour Alpha\nFrom NZ$5,000'.repeat(5), 'Tour Alpha\nFrom NZ$5,000'.repeat(5), 'business-content-v1+actor-1.0.0', '/', 'https://www.example.com/?utm_source=redirect')
    const changed = await businessCapture(client, 'Navigation v3\nTour Alpha\nFrom NZ$5,500'.repeat(5), 'Tour Alpha\nFrom NZ$5,500'.repeat(5))
    const upgraded = await businessCapture(client, 'Navigation v3\nTour Alpha\nFrom NZ$5,500'.repeat(5), 'Tour Alpha\nFrom NZ$5,500'.repeat(5), 'business-content-v1+actor-2.0.0')
    assert.equal(first.state,'baseline'); assert.equal(noise.state,'technical_noise')
    assert.equal(changed.state,'changed'); assert.ok(changed.signal_id)
    assert.equal(upgraded.state,'baseline'); assert.equal(upgraded.signal_id,null)
  }],
  ['Business snapshot rejects null page identity fields', async () => {
    const client = await fixture(), request = reserve(client)
    await sql(request.statement)
    await sql(`UPDATE web_intelligence_runs SET provider_run_id='local-fixture',provider_status='SUCCEEDED' WHERE id='${request.id}'`)
    await denied(`SELECT web_intelligence_record_business_snapshot('${request.id}','${client}','https://example.com/','Fixture','${'R'.repeat(100)}','raw','${'P'.repeat(100)}','projection','v1',NULL)`, /invalid_business_snapshot/)
  }],
  ['Long-page evidence retains the actual changed tail for interpretation', async () => {
    const client = await fixture(), prefix = 'Unchanged introduction. '.repeat(1000)
    const first = await capture(client, prefix + 'Price NZ$5000', 'tail-before')
    const second = await capture(client, prefix + 'Price NZ$4500', 'tail-after')
    const texts = await sql(`SELECT excerpt FROM market_evidence WHERE snapshot_id IN ('${first.snapshot_id}','${second.snapshot_id}') ORDER BY observed_at`)
    assert.ok(texts.includes('Price NZ$5000'))
    assert.ok(texts.includes('Price NZ$4500'))
    assert.equal(second.state,'changed')
  }],
  ['Null provider status never qualifies as a verified successful capture', async () => {
    const client = await fixture(), request = reserve(client)
    await sql(request.statement)
    await sql(`UPDATE web_intelligence_runs SET provider_run_id='unknown-status' WHERE id='${request.id}'`)
    await denied(`SELECT web_intelligence_record_snapshot('${request.id}','${client}','https://example.com/','Fixture','${'A'.repeat(100)}','a')`,/capture_not_verified/)
  }],
  ['NaN and Infinity are rejected in every ledger money field', async () => {
    const client = await fixture(), request = reserve(client)
    await sql(request.statement)
    for (const field of ['capture_cost_usd','interpretation_cost_usd','reserved_nzd','accounted_nzd','fx_rate','capture_limit_usd','overhead_nzd']) {
      for (const value of ['NaN','Infinity','-Infinity']) {
        try {
          await denied(`UPDATE web_intelligence_runs SET ${field}='${value}'::numeric WHERE id='${request.id}'`,/check constraint/)
        } catch (error) { throw new Error(`${field}=${value}: ${error.message}`) }
      }
    }
  }],
  ['Composite foreign keys reject cross-client snapshot, evidence and signal references', async () => {
    const a = await fixture(), b = await fixture()
    const first = await capture(a,'A'.repeat(100),'a')
    const second = await capture(a,'B'.repeat(100),'b')
    const br = reserve(b); await sql(br.statement)
    await denied(`UPDATE market_snapshots SET client_id='${b}' WHERE id='${first.snapshot_id}'`, /foreign key constraint/)
    await denied(`UPDATE market_evidence SET client_id='${b}' WHERE snapshot_id='${first.snapshot_id}'`, /foreign key constraint/)
    await denied(`INSERT INTO market_signals(client_id,run_id,domain,before_evidence_id,after_evidence_id) SELECT '${b}','${br.id}',domain,before_evidence_id,after_evidence_id FROM market_signals WHERE id='${second.signal_id}'`, /foreign key constraint/)
  }],
  ['Anon and authenticated cannot access tables or invoke budget and evidence RPCs', async () => {
    const tables = ['web_intelligence_settings','competitor_monitoring_metadata','web_intelligence_runs','market_snapshots','market_evidence','market_signals']
    for (const role of ['anon','authenticated']) {
      for (const table of tables) await denied(`SET ROLE ${role}; SELECT * FROM ${table}`,/permission denied/)
      const id=randomUUID(),client=randomUUID()
      for (const statement of [
        reserve(client,id).statement,
        `SELECT web_intelligence_claim('${id}','${client}','capture')`,
        `SELECT web_intelligence_budget('${client}')`,
        `SELECT web_intelligence_settle('${id}','${client}')`,
        `SELECT web_intelligence_record_snapshot('${id}','${client}','x','x','x','x')`,
        `SELECT web_intelligence_record_business_snapshot('${id}','${client}','x','x','x','x','x','x','x','other')`,
      ]) {
        await denied(`SET ROLE ${role}; ${statement}`,/permission denied/)
      }
    }
    const client = await fixture()
    await sql(`SET ROLE service_role; ${reserve(client).statement}`)
    // Even accidental future table grants must not bypass RLS.
    for (const table of tables) {
      await sql(`GRANT SELECT ON ${table} TO anon,authenticated`)
      for (const role of ['anon','authenticated']) assert.equal(await sql(`SET ROLE ${role}; SELECT count(*) FROM ${table}`),'0')
    }
  }],
]

try {
  port = await freePort()
  await pg('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  await appendFile(resolve(data, 'postgresql.conf'), "\nunix_socket_directories = ''\n")
  await pg('pg_ctl', ['-D', data, '-l', resolve(instance, 'postgres.log'), '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start'])
  started = true
  evidence.postgres = await sql('SELECT version()')
  assert.match(evidence.postgres, /PostgreSQL 17\./)
  assert.equal(await sql('SHOW listen_addresses'), '127.0.0.1')
  evidence.checks.push('PostgreSQL 17 isolated cluster bound only to 127.0.0.1')
  if (!process.argv.includes('--smoke')) {
    const base = await readFile(resolve(repo, 'supabase/migrations/20260908153810_web_intelligence_v01.sql'), 'utf8')
    const upgrade = await readFile(resolve(repo, 'supabase/migrations/20260909160000_web_intelligence_business_projection.sql'), 'utf8')
    const migration = `${base}\n${upgrade}`
    assert.ok(migration.trim(), 'Web Intelligence migration must be ready before database acceptance')
    evidence.migrationSha256 = createHash('sha256').update(migration).digest('hex')
    await verifyDatabase(migration)
    assert.equal(evidence.failures.length, 0, evidence.failures.join('\n'))
  }
  evidence.status = process.argv.includes('--smoke') ? 'smoke_passed' : 'passed'
} catch (error) {
  evidence.status = 'failed'
  evidence.error = error.message
  process.exitCode = 1
} finally {
  if (started) await pg('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  evidence.finishedAt = new Date().toISOString()
  await writeFile(resolve(instance, 'receipt.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ ...evidence, receipt: resolve(instance, 'receipt.json') }, null, 2))
}
