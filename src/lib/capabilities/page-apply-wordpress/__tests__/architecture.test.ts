import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { createPageApplyWordpressCapability } from '..'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const indexSource = read('src/lib/capabilities/page-apply-wordpress/index.ts')
const depsSource = read('src/lib/capabilities/page-apply-wordpress/deps.ts')
const submissionSource = read('src/lib/reference-loop-submission/index.ts')
const mappingSource = read('src/lib/action-bridge/mapping-table.ts')

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir))) {
    const relative = join(dir, entry)
    const absolute = join(root, relative)
    if (statSync(absolute).isDirectory()) walk(relative, files)
    else if (/\.(?:ts|tsx)$/.test(relative) && !relative.includes('__tests__')) files.push(relative)
  }
  return files
}

describe('WordPress Page Apply v2 architecture', () => {
  it('capability contract matches the governed registry definition', () => {
    const capability = createPageApplyWordpressCapability({
      resolveConnection: async () => null,
      readPost: async () => { throw new Error('not called') },
      updatePost: async () => { throw new Error('not called') },
      supportsAtomicApply: async () => false,
      verifyAuthorizationProof: () => false,
    })
    const definition = ACTION_REGISTRY.get('page.apply_wordpress_optimization_request')
    expect(definition).not.toBeNull()
    expect(capability.actionKey).toBe(definition?.actionKey)
    expect(capability.version).toBe(definition?.version)
    expect(Object.keys(capability.steps)).toEqual(definition?.steps)
    expect(capability.rollback).toBeTypeOf('function')
  })

  it('provider and credential resolution live only in injected default deps', () => {
    expect(indexSource).not.toMatch(/supabaseAdmin|process\.env|console\.|\bfetch\s*\(/)
    expect(indexSource).not.toContain("@/lib/cms/connection-store")
    expect(indexSource).not.toContain("@/lib/supabase")
    expect(depsSource).toContain("@/lib/cms/connection-store")
    expect(depsSource).not.toMatch(/console\.|process\.env/)
  })

  it('SEO identity is declared only by the governed mapping and its validation gate', () => {
    const identity = 'apply_wordpress_page_metadata'
    expect(mappingSource).toContain(identity)
    expect(submissionSource).toContain(identity)

    const forbiddenCallers = [
      'src/lib/action-submission/index.ts',
      'src/lib/reference-loop/prepare.ts',
      'src/lib/capabilities/page-apply-wordpress/index.ts',
    ]
    for (const path of forbiddenCallers) expect(read(path)).not.toContain(identity)
  })

  it('source mint loads fixed authoritative sources; submission gate cannot mint or write', () => {
    const source = read('src/lib/capabilities/page-apply-wordpress/source.ts')
    expect(source).toContain("@/lib/db/site-pages")
    expect(source).toContain("@/lib/cms/connection-store")
    expect(source).toContain("@/lib/cms/wordpress-client")
    expect(source).not.toMatch(/export function bind|updateExistingWordpressPost|\bfetch\s*\(/)

    expect(submissionSource).not.toMatch(
      /supabaseAdmin|\.from\s*\(\s*['"]|updateExistingWordpressPost|\bfetch\s*\(/,
    )
  })

  it('keeps env-backed HMAC signers in the two specialized submission boundaries', async () => {
    const proofSource = read('src/lib/reference-loop-authorization-proof/index.ts')
    expect(proofSource).toContain('REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY')
    expect(proofSource).toContain('createHmac')
    expect(submissionSource).toContain('function signAuthorizationContext')
    expect(indexSource).toContain('verifyAuthorizationProof')
    expect(read('src/lib/action-submission/index.ts')).not.toContain('authorizationProof')
    expect(Object.keys(await import('@/lib/reference-loop-submission')).sort()).toEqual([
      'submitValidatedWordpressReferenceLoop',
    ])
    expect(Object.keys(await import('@/lib/cts-github-reference-loop-submission')).sort()).toEqual([])

    const envReaders = walk('src').filter((path) =>
      read(path).includes('REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY'))
    expect(envReaders.sort()).toEqual([
      'src/lib/cts-github-reference-loop-trigger/index.ts',
      'src/lib/reference-loop-authorization-proof/index.ts',
      'src/lib/reference-loop-submission/index.ts',
    ])
  })
})
