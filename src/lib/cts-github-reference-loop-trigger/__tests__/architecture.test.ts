import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('CTS controlled trigger architecture', () => {
  it('uses only fixed trusted producers before the specialized submission gate', () => {
    const source = read('src/lib/cts-github-reference-loop-trigger/index.ts')
    expect(source).toContain('fetchGscPageQueryReport')
    expect(source).toContain('createGscPageQueryEvidenceReceipt')
    expect(source).toContain('loadTrustedClientRedlines')
    expect(source).toContain('loadTenantBoundCtsGithubSource')
    expect(source).toContain('prepareCtsGithubReferenceLoop')
    expect(source).toContain('submitPreparedCtsAction')
    expect(source).not.toMatch(
      /resolveAccessToken|supabaseAdmin|GithubClient|Anthropic|runCtsMetaPr|createPullRequest/,
    )
  })

  it('does not let the caller choose tenant identity, Finding text or redline provenance', () => {
    const types = read('src/lib/cts-github-reference-loop-trigger/types.ts')
    expect(types).not.toMatch(/readonly clientId|findingStatement|readonly redline:|redlineSource/)
    expect(types).not.toMatch(/readonly siteUrl|readonly country/)
  })

  it('exports only the controlled trigger at runtime', async () => {
    expect(Object.keys(await import('..')).sort()).toEqual([
      'triggerCtsGithubMetadataReferenceLoop',
    ])
  })
})
