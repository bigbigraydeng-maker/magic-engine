/**
 * Client work digest — PREVIEW ONLY (Issue #1113 GO BUILD v0).
 *
 * Reads `fde_work_logs` for one client_id over a time window and renders a
 * local HTML preview + a JSON source receipt. Never writes to any table,
 * never calls Resend or any other mail provider. See the Build Control
 * contract on #1113 for the frozen scope.
 *
 * Usage:
 *   npx tsx scripts/client-digest-preview.ts <client_id> [--hours=24] [--out=.tmp/client-digest-preview.html]
 *
 * Default output goes to `.tmp/` (gitignored) so real client work-log content
 * never lands in the repo root where a routine `git add .` would stage it.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { meMailFrom } from '@/lib/email/sender'
import {
  buildDigestEvents,
  computeWindow,
  fetchWorkLogsForPreview,
  renderPreview,
} from '@/lib/client-digest/preview'

// ── Minimal .env.local parsing (matches scripts/diagnose-roman-geo.ts) ──────

function loadEnvLocal(): Record<string, string> {
  const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

function makeClient(): SupabaseClient {
  const env = loadEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('缺 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

interface Args {
  clientId: string
  hours: number
  out: string
}

function parseArgs(argv: string[]): Args {
  const [clientId, ...rest] = argv
  if (!clientId) {
    throw new Error('用法: npx tsx scripts/client-digest-preview.ts <client_id> [--hours=24] [--out=.tmp/client-digest-preview.html]')
  }
  let hours = 24
  let out = '.tmp/client-digest-preview.html'
  for (const a of rest) {
    if (a.startsWith('--hours=')) hours = Number(a.slice('--hours='.length))
    if (a.startsWith('--out=')) out = a.slice('--out='.length)
  }
  if (!Number.isFinite(hours) || hours <= 0) throw new Error(`--hours 必须是正数，收到：${hours}`)
  return { clientId, hours, out }
}

async function main(): Promise<void> {
  const { clientId, hours, out } = parseArgs(process.argv.slice(2))
  const sb = makeClient()
  const window = computeWindow(new Date(), hours)

  const { rows, error, truncated } = await fetchWorkLogsForPreview(sb, clientId, window)
  if (error) throw new Error(`读取 fde_work_logs 失败：${error}`)

  const events = buildDigestEvents(rows)
  const senderDisplay = meMailFrom('Magic Engine 客户摘要（预览）')
  const { html, receipt } = renderPreview(clientId, window, events, senderDisplay, truncated ?? false)

  const outPath = join(process.cwd(), out)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, html, 'utf8')
  process.stdout.write(`✅ 预览已写入 ${out}（本次运行没有发送任何邮件、没有写入任何表）\n`)
  if (receipt.truncated) {
    process.stdout.write(`⚠️  窗口内工作日志超出单次读取上限，内容可能不完整，请缩小 --hours 后重试\n`)
  }
  process.stdout.write(`来源回执：\n${JSON.stringify(receipt, null, 2)}\n`)
}

main().catch((err) => {
  process.stdout.write(`🔴 中止：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
