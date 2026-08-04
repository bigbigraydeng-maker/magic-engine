#!/usr/bin/env node
/**
 * run-vision-analyzer.mjs
 *
 * Manually drives the vision-analyzer cron to clear the backlog of
 * client_assets stuck at status='pending'. Calls the live endpoint in a loop
 * (one batch of 10 per call) until nothing is left to process.
 *
 * Why this exists: the Render `vision-analyzer` cron only works once its own
 * CRON_SECRET env var is set on the cron service (render.yaml marks it
 * sync:false). Until the PM confirms that, this script lets a human flush the
 * queue from a laptop.
 *
 * Usage:
 *   VISION_BASE_URL=https://<render-host> CRON_SECRET=<secret> \
 *     node scripts/run-vision-analyzer.mjs
 *
 * Resolution order for both values:
 *   1. explicit env vars passed on the command line (above)
 *   2. .env.local in the repo root
 *
 * VISION_BASE_URL falls back to .env.local NEXT_PUBLIC_APP_URL, but that is
 * localhost in dev — pass the real Render URL to hit production.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local')
  if (!existsSync(file)) return {}
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        // strip inline "# comment" tails and surrounding whitespace
        const value = l.slice(i + 1).split('#')[0].trim()
        return [l.slice(0, i).trim(), value]
      }),
  )
}

const env = loadEnvLocal()

const baseUrl = (
  process.env.VISION_BASE_URL ||
  env.VISION_BASE_URL ||
  env.NEXT_PUBLIC_APP_URL ||
  ''
).replace(/\/$/, '')

const cronSecret = process.env.CRON_SECRET || env.CRON_SECRET || ''

const MAX_ROUNDS = 20 // 20 batches x 10 = 200 assets max per run — plenty
const PAUSE_MS = 3000

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

if (!baseUrl) {
  fail('No base URL. Pass VISION_BASE_URL=https://<render-host> (NEXT_PUBLIC_APP_URL is localhost in dev).')
}
if (!cronSecret) {
  fail('No CRON_SECRET. Pass CRON_SECRET=<secret> or add it to .env.local.')
}
if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
  console.warn('⚠ Base URL is local — this will only work if a dev server is running on it.')
}

const endpoint = `${baseUrl}/api/cron/vision-analyzer`

async function runBatch() {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cronSecret}` },
  })

  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`)
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${body.error ?? text.slice(0, 200)}`)
  }
  return body
}

async function main() {
  console.log(`→ Driving vision-analyzer at ${endpoint}`)
  let totalSucceeded = 0
  let totalFailed = 0

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    let body
    try {
      body = await runBatch()
    } catch (err) {
      fail(`Round ${round} failed: ${err.message}`)
    }

    // No pending assets left — cron returns { processed: 0 }.
    if (body.processed === 0 || body.batch === 0) {
      console.log(`✓ Done — no pending assets remain. (after ${round - 1} batch(es))`)
      break
    }

    totalSucceeded += body.succeeded ?? 0
    totalFailed += body.failed ?? 0
    console.log(
      `  batch ${round}: ${body.batch} claimed → ${body.succeeded ?? 0} ok, ${body.failed ?? 0} failed`,
    )
    if (Array.isArray(body.errors) && body.errors.length) {
      body.errors.forEach((e) => console.log(`    ✗ ${e}`))
    }

    if (round === MAX_ROUNDS) {
      console.log(`⚠ Hit MAX_ROUNDS (${MAX_ROUNDS}). Re-run to continue if a backlog remains.`)
    }
    await delay(PAUSE_MS)
  }

  console.log(`\nTotal: ${totalSucceeded} analyzed, ${totalFailed} failed.`)
}

main().catch((err) => fail(err.message))
