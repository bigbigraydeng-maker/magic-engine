#!/usr/bin/env node
/**
 * Apply ONE migration file to Supabase over a direct Postgres connection.
 *
 * Why this exists: the service-role REST API cannot run DDL (PostgREST has no
 * SQL-exec endpoint), and the pre-existing scripts/apply-migration.js hardcodes
 * one filename and relies on an `exec` RPC this project does not have. Every
 * `go apply` therefore needed a human in the Supabase SQL editor.
 *
 * Requires SUPABASE_DB_URL in .env.local — the project's Postgres connection
 * string (Supabase dashboard → Project Settings → Database → Connection string,
 * URI). Never commit it; .env.local is gitignored.
 *
 * Usage:
 *   node scripts/apply-migration-file.js supabase/migrations/2026...sql
 *   node scripts/apply-migration-file.js <file> --dry-run   # print, don't run
 *
 * Runs the whole file in ONE transaction: a migration that fails halfway leaves
 * nothing behind, which is the difference between "retry it" and "reconcile a
 * half-applied schema by hand".
 */

const fs = require('fs')
const path = require('path')

const { Client } = require('pg')

/**
 * Read one key out of .env.local without pulling in dotenv — this has to run
 * from a git worktree too, where node_modules is not always complete.
 */
function readEnvLocal(key) {
  if (process.env[key]) return process.env[key]

  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) return undefined

  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (match && match[1] === key) return match[2].trim().replace(/^["']|["']$/g, '')
  }
  return undefined
}

async function main() {
  const [file, ...flags] = process.argv.slice(2)
  const dryRun = flags.includes('--dry-run')

  if (!file) {
    console.error('Usage: node scripts/apply-migration-file.js <path-to.sql> [--dry-run]')
    process.exit(1)
  }

  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file)
  if (!fs.existsSync(abs)) {
    console.error(`❌ No such migration: ${abs}`)
    process.exit(1)
  }

  const sql = fs.readFileSync(abs, 'utf8')
  console.log(`📝 ${path.basename(abs)}\n`)
  console.log(sql)

  if (dryRun) {
    console.log('\n(dry run — nothing was applied)')
    return
  }

  const connectionString = readEnvLocal('SUPABASE_DB_URL')
  if (!connectionString) {
    console.error(
      '\n❌ SUPABASE_DB_URL is not set in .env.local.\n' +
      '   Supabase dashboard → Project Settings → Database → Connection string (URI).',
    )
    process.exit(1)
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()

  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    console.log('\n✅ Applied.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(`\n❌ Failed (rolled back): ${err.message}`)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
