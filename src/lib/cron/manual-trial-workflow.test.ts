import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const wf = readFileSync(join(ROOT, '.github/workflows/manual-cron-trial.yml'), 'utf8')

function listed(re: RegExp): string[] {
  const m = wf.match(re)
  return m ? m[1].split('\n').map(l => l.trim()).filter(Boolean) : []
}

describe('manual-cron-trial workflow guards', () => {
  const options = listed(/options:\n((?:\s+- .+\n)+)/).map(l => l.replace(/^- /, ''))
  const cases = Array.from(wf.matchAll(/^\s+([a-z0-9-]+)\) route="[^"]+" ;;$/gm)).map(m => m[1])

  it('the dropdown allowlist and the shell case allowlist are the same set (no half-added route)', () => {
    expect(options.length).toBeGreaterThan(0)
    expect([...options].sort()).toEqual([...cases].sort())
  })

  it('every allowlisted job maps to an existing route file that reads dry_run (cron or internal namespace)', () => {
    for (const job of options) {
      const m = wf.match(new RegExp(`${job}\\) route="([^"]+)"`))
      expect(m, `${job} has a route mapping`).not.toBeNull()
      const src = readFileSync(join(ROOT, `src/app/${(m as RegExpMatchArray)[1]}/route.ts`), 'utf8')
      expect(src, job).toContain('dry_run')
    }
  })

  it('every allowlisted job has its own summary filter, and an unknown job fails instead of dumping the raw body', () => {
    const filterBlock = wf.slice(wf.indexOf('case "$JOB" in', wf.indexOf('Whitelisted fields only')))
    for (const job of options) expect(filterBlock, job).toMatch(new RegExp(`\\n\\s+${job}\\)\\n`))
    expect(filterBlock).toContain('no summary filter for this job')
  })

  it('never interpolates workflow inputs into the shell script — only through env', () => {
    const runBlock = wf.slice(wf.indexOf('run: |'))
    expect(runBlock).not.toMatch(/\$\{\{\s*inputs\./)
  })

  it('real runs need BOTH dry_run=false and the confirm word; the request always carries an explicit dry_run flag; runs are serialised', () => {
    expect(wf).toContain('WRITE-LIVE')
    expect(wf).toMatch(/query="dry_run=1"/)
    expect(wf).toMatch(/concurrency:\s+group: manual-cron-trial/)
  })

  it('checks the server-reported dry_run against the request, and writes the summary even when curl fails', () => {
    expect(wf).toContain('server dry_run flag does not match the request')
    expect(wf).toContain('|| status=000')
  })

  it('does not print the secret or turn on shell tracing', () => {
    expect(wf).not.toMatch(/set -[a-z]*x/)
    expect(wf).not.toMatch(/echo[^\n]*\$\{?CRON_SECRET/)
  })
})
