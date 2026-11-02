#!/usr/bin/env node
/**
 * Throwaway Postgres checks for the WP1 P2 verdict migration.
 * Never reads DATABASE_URL. Never contacts a hosted database. Deletes nothing
 * in the duplicate scenario: the migration must abort and leave both rows.
 *
 * Apply the file the same way scripts/db-replay-and-verify.sh does:
 * `psql -v ON_ERROR_STOP=1 -f` with autocommit, and no --single-transaction.
 * A LOCK outside an explicit BEGIN fails on that path.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PG = '/usr/lib/postgresql/16/bin'
const user = process.env.USER || 'postgres'
const migration = resolve(repo, 'supabase/migrations/20261102180000_social_verification_verdicts.sql')
const checks = resolve(repo, 'supabase/tests/social_verification_verdicts.test.sql')

const parents = `
create extension if not exists pgcrypto;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create table public.clients (id uuid primary key);
create table public.flywheel_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  action_type text not null,
  payload jsonb,
  constraint flywheel_actions_id_client_uniq unique (id, client_id)
);
insert into public.clients(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10');
`

function storyRow(id, key) {
  const payload = key === null
    ? 'null'
    : `'{"idempotency_key":"${key}"}'::jsonb`
  return `insert into public.flywheel_actions(id, client_id, action_type, payload) values
    ('${id}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10', 'social.publish_story', ${payload});`
}

function freePort() {
  return new Promise((accept, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => (error ? reject(error) : accept(port)))
    })
  })
}

async function main() {
  if (process.env.DATABASE_URL) {
    console.log('DATABASE_URL is set and was ignored')
  }
  const port = await freePort()
  const data = await mkdtemp(resolve(tmpdir(), 'svv-pg-'))
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C', PGOPTIONS: '' }
  let started = false
  const bin = (name) => resolve(PG, name)
  async function run(command, args) {
    return exec(bin(command), args, { env, maxBuffer: 8 * 1024 * 1024 })
  }
  async function psql(db, args) {
    return run('psql', [
      '-X', '-v', 'ON_ERROR_STOP=1',
      '-h', '127.0.0.1', '-p', String(port), '-U', user, '-d', db,
      ...args,
    ])
  }
  async function psqlFile(db, sql, extraArgs = []) {
    const file = resolve(data, `stmt-${Math.random().toString(16).slice(2)}.sql`)
    await writeFile(file, sql)
    return psql(db, [...extraArgs, '-f', file])
  }
  try {
    await run('initdb', ['-D', data, '--auth=trust', '--username=' + user, '--no-sync', '--encoding=UTF8', '--locale=C'])
    await run('pg_ctl', [
      '-D', data, '-l', resolve(data, 'server.log'), '-w', 'start',
      '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${data}`,
    ])
    started = true
    await psql('postgres', ['-c', 'create database verdicts_clean'])
    await psql('postgres', ['-c', 'create database verdicts_dupes'])
    await psqlFile('verdicts_clean', parents + storyRow('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01', 'story-lite:one') + storyRow('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02', 'story-lite:two'))
    await psqlFile('verdicts_dupes', parents + storyRow('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11', 'story-lite:same') + storyRow('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb12', 'story-lite:same'))

    const clean = await psql('verdicts_clean', ['-f', migration])
    console.log('clean migration exit 0')
    if (!clean.stdout.includes('CREATE INDEX') && !clean.stderr.includes('CREATE INDEX')) {
      console.log(clean.stdout)
    }
    const tested = await psql('verdicts_clean', ['-f', checks])
    const notice = tested.stderr.split('\n').filter((line) => line.includes('T14 passed') || line.toLowerCase().includes('notice'))
    console.log(notice.join('\n') || tested.stderr)
    const dupes = await psql('verdicts_dupes', ['-f', migration]).then(
      () => { throw new Error('duplicate precheck did not abort') },
      (error) => error,
    )
    const dupText = `${dupes.stderr || ''}\n${dupes.stdout || ''}\n${dupes.message || ''}`
    if (!dupText.includes('No rows were deleted or updated')) {
      throw new Error(`duplicate abort did not explain the strategy:\n${dupText}`)
    }
    const left = await psql('verdicts_dupes', ['-At', '-c', "select count(*)::text || ' ' || coalesce(to_regclass('public.social_verification_verdicts')::text, 'absent') from public.flywheel_actions where action_type = 'social.publish_story'"])
    const summary = left.stdout.trim()
    if (summary !== '2 absent') {
      throw new Error(`expected 2 story rows and no verdict table, got ${summary}`)
    }
    console.log('duplicate precheck aborted; rows=2; verdict table absent; no delete')
  } finally {
    if (started) {
      await run('pg_ctl', ['-D', data, '-w', '-m', 'immediate', 'stop']).catch(() => {})
    }
    await rm(data, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.stderr || error.message || error)
  process.exit(1)
})
