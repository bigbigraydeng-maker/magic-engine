import { execFileSync } from 'node:child_process'
import { ENGINE_CATALOG_ID, REQUIRED_ENGINE_CAPABILITIES } from '../../src/lib/factory/engine-catalog.mjs'

/** Git revision of the code this process is running. Null when git cannot answer. */
export function readGitRev(cwd = process.cwd(), runner = defaultRunner) {
  try {
    const sha = runner(cwd).trim().toLowerCase()
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null
  } catch {
    return null
  }
}

function defaultRunner(cwd) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })
}

/** What the machine sends on claim, ping, and delivery. */
export function currentEngineReport(rev = readGitRev()) {
  return {
    engine_rev: rev,
    catalog_id: ENGINE_CATALOG_ID,
    capabilities: [...REQUIRED_ENGINE_CAPABILITIES],
  }
}
