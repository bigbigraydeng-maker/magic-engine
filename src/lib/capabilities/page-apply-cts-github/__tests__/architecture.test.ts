import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPageApplyCtsGithubCapability } from '..'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('CTS GitHub metadata governed action architecture', () => {
  it('matches the registry contract and exposes Draft PR steps plus rollback', () => {
    const capability = createPageApplyCtsGithubCapability({
      resolveConnection: async () => null,
      createClient: () => { throw new Error('not called') },
      verifyAuthorizationProof: () => false,
    })
    const definition = ACTION_REGISTRY.get('page.apply_cts_github_metadata_request')
    expect(definition).not.toBeNull()
    expect(capability.actionKey).toBe(definition?.actionKey)
    expect(capability.version).toBe(definition?.version)
    expect(Object.keys(capability.steps)).toEqual(definition?.steps)
    expect(capability.rollback).toBeTypeOf('function')
    expect(definition).toMatchObject({
      providerIdempotency: 'unsupported',
      retryPolicy: { maxAttempts: 1 },
      outwardAuthorization: { requiresHumanApproval: true },
    })
  })

  it('keeps source minting on authoritative tenant/provider reads and execution in capability only', () => {
    const source = read('src/lib/capabilities/page-apply-cts-github/source.ts')
    const gate = read('src/lib/cts-github-reference-loop-submission/index.ts')
    const capability = read('src/lib/capabilities/page-apply-cts-github/index.ts')
    expect(source).toContain("@/lib/db/site-pages")
    expect(source).toContain("@/lib/cms/connection-store")
    expect(source).toContain("@/lib/cms/github-client")
    expect(source).not.toMatch(/export function bind|runAction|createPullRequest\s*\(/)
    expect(gate).not.toMatch(/GithubClient|supabaseAdmin|createPullRequest\s*\(/)
    expect(capability).toContain('createPullRequest')
  })

  it('cannot reuse the legacy CTS cron executor or WordPress/static-HTML action', () => {
    const files = [
      'src/lib/capabilities/page-apply-cts-github/index.ts',
      'src/lib/capabilities/page-apply-cts-github/source.ts',
      'src/lib/cts-github-reference-loop/index.ts',
      'src/lib/cts-github-reference-loop-submission/index.ts',
    ]
    for (const path of files) {
      const source = read(path)
      expect(source).not.toContain('cts-meta-pr')
      expect(source).not.toContain('runCtsMetaPr')
      expect(source).not.toContain('page.apply_wordpress_optimization_request')
      expect(source).not.toContain('page.apply_optimization_request')
    }
  })

  it('keeps the CTS signer private, verification-only helper public, and rollout disabled by default', async () => {
    const gate = read('src/lib/cts-github-reference-loop-trigger/index.ts')
    const proof = read('src/lib/reference-loop-authorization-proof/index.ts')
    expect(gate).toContain('function sign(')
    expect(gate).not.toContain('export function sign')
    expect(gate).toContain("CTS_GITHUB_METADATA_ACTION_ENABLED !== 'true'")
    expect(proof).toContain('verifyConfiguredReferenceLoopAuthorizationProof')
    expect(proof).not.toMatch(/export function .*sign/i)
    expect(Object.keys(await import('@/lib/cts-github-reference-loop-submission')).sort()).toEqual([])
    expect(Object.keys(await import('@/lib/cts-github-reference-loop-trigger')).sort()).toEqual([
      'triggerCtsGithubMetadataReferenceLoop',
    ])
  })
})
