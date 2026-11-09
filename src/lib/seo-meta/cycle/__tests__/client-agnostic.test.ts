import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { fromGscPages, mergeCandidates } from '../candidates'
import type { MetaCycleCandidate } from '../types'

/**
 * 魏征 finding #12: before shipping the "no changes needed for a second
 * client" conclusion in spec §8, run a second client (Oztop) through the
 * chain in read-only/dry-run mode as evidence.
 *
 * What this file actually proves: the SHARED discovery logic (candidate
 * merge/dedup) produces identical, correctly-parameterised behaviour for a
 * CTS-shaped input and an Oztop-shaped input, using the exact same code
 * path with no client branching. PM 2026-09-20（incident follow-up）moved
 * the decision-making (topic match, difficulty, SERP ownership) into
 * gate.ts, which needs live GSC/DataForSEO calls per candidate and so isn't
 * exercised here at the unit level — its client-agnosticism is structural
 * (it takes `config: MetaCycleClientConfig` + `siteUrl`, resolved fresh
 * per client, never a literal client id) rather than something a pure unit
 * test can demonstrate without mocking every external call.
 *
 * What this file does NOT prove: it is not a live trial against real Oztop
 * production data (no DataForSEO/GSC/DB credentials are available from this
 * environment). seo-meta-cycle.ts's `buildAdapterForClient` already means
 * Oztop is structurally excluded from real runs today — `getConnection`
 * only returns a result for clients with a GitHub repo connection
 * configured, and Oztop's flow is WordPress, not a repo. A genuine live
 * read-only trial (real GSC/DataForSEO reads, zero writes, via the
 * dry_run:true manual trigger) is a required follow-up before Oztop's
 * `meta_cycle_enabled` flag is ever turned on — not run from this session.
 */

const CTS_SHAPED_DOMAIN = 'www.ctstours.co.nz'
const OZTOP_SHAPED_DOMAIN = 'oztopbuildingsupplies.com.au'

function candidatesFor(domain: string): MetaCycleCandidate[] {
  return fromGscPages([
    { page: `https://${domain}/blog/some-page`, impressions: 200, position: 8 },
    { page: `https://${domain}/blog/other-page`, impressions: 150, position: 12 },
  ])
}

describe('SEO Meta-Cycle discovery is client-agnostic (魏征 finding #12 evidence)', () => {
  it('mergeCandidates dedupes identically for a .co.nz (CTS-shaped) and a .com.au (Oztop-shaped) domain', () => {
    const ctsMerged = mergeCandidates(candidatesFor(CTS_SHAPED_DOMAIN), new Set(), 10)
    const oztopMerged = mergeCandidates(candidatesFor(OZTOP_SHAPED_DOMAIN), new Set(), 10)

    expect(ctsMerged).toHaveLength(2)
    expect(oztopMerged).toHaveLength(2)
    // Same shape, same ordering rule (impressions desc) — no domain-conditional branch.
    expect(ctsMerged.map((c) => c.slug)).toEqual(oztopMerged.map((c) => c.slug))
  })

  it('the cycle library does not hardcode CTS_CLIENT_ID or a literal "CTS" client check anywhere in runtime code (comments/spec references excluded by scanning for the UUID + a code-shaped check only)', () => {
    const CYCLE_DIR = join(__dirname, '..')
    const CTS_CLIENT_ID_UUID = 'c0000000-0000-0000-0000-000000000000'
    const files = readdirSync(CYCLE_DIR).filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))

    for (const file of files) {
      const source = readFileSync(join(CYCLE_DIR, file), 'utf8')
      expect(source, `${file} must not hardcode the CTS client UUID`).not.toContain(CTS_CLIENT_ID_UUID)
      expect(source, `${file} must not branch on a literal client_id === 'CTS'-style check`).not.toMatch(/client_?id\s*===?\s*['"]cts/i)
    }
  })
})
