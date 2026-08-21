import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const path = join(process.cwd(), 'src/lib/seo-meta/cts-meta-source.ts')
const source = readFileSync(path, 'utf8')

describe('CTS GitHub metadata source adapter architecture', () => {
  it('is pure and has no provider, database, model, env, clock or Git side effects', () => {
    for (const forbidden of [
      'supabase',
      'GithubClient',
      'fetch(',
      'process.env',
      'new Date',
      'Date.now',
      'Anthropic',
      'OpenAI',
      'commitFile',
      'createPullRequest',
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })

  it('does not import the legacy outward executor', () => {
    expect(source).not.toContain('cts-meta-pr')
  })
})
