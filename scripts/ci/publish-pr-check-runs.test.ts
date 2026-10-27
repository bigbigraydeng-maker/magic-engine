import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CHECKS, planChecks } from './publish-pr-check-runs.mjs'

const WORKFLOW = readFileSync(join(process.cwd(), '.github/workflows/pr-light-checks.yml'), 'utf8')

function envFor(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = { OUTCOME_INSTALL: 'success', TREE_DIRTY: '0' }
  for (const spec of CHECKS) base[spec.outcomeEnv] = 'success'
  return { ...base, ...overrides }
}

describe('planChecks', () => {
  it('passes when every step passed and the tree is clean', () => {
    const planned = planChecks(envFor())
    expect(planned.failed).toBe(false)
    expect(planned.checks.every((item) => item.conclusion === 'success')).toBe(true)
    expect(planned.checks.map((item) => item.name)).toContain('Kernel architecture test')
    expect(planned.checks.map((item) => item.name)).not.toContain('Application build')
  })

  it('fails closed when the install did not succeed', () => {
    const planned = planChecks(envFor({ OUTCOME_INSTALL: 'failure', OUTCOME_KERNEL: 'skipped' }))
    const kernel = planned.checks.find((item) => item.name === 'Kernel architecture test')
    expect(kernel?.conclusion).toBe('failure')
    expect(planned.failed).toBe(true)
  })

  it('treats an allowed skip as success and omits the verify-branch check', () => {
    const planned = planChecks(envFor({
      OUTCOME_LEDGER_CODE: 'skipped',
      OUTCOME_LEDGER_VERIFY: 'skipped',
    }))
    const code = planned.checks.find((item) => item.name === 'Code change has ledger entry')
    expect(code?.conclusion).toBe('success')
    expect(planned.checks.some((item) => item.name === 'Ledger verify branch shape')).toBe(false)
    expect(planned.failed).toBe(false)
  })

  it('publishes a verify-branch failure and does not let a dirty tree pass', () => {
    const verify = planChecks(envFor({ OUTCOME_LEDGER_VERIFY: 'failure' }))
    expect(verify.checks.find((item) => item.name === 'Ledger verify branch shape')?.conclusion).toBe('failure')
    expect(verify.failed).toBe(true)

    const dirty = planChecks(envFor({ TREE_DIRTY: '1' }))
    expect(dirty.failed).toBe(true)
    expect(dirty.checks.every((item) => item.conclusion === 'failure')).toBe(true)
  })

  it('fails when a required step outcome is missing', () => {
    const planned = planChecks(envFor({ OUTCOME_TOUR: '' }))
    expect(planned.checks.find((item) => item.name === 'Tour catalog boundary test')?.conclusion).toBe('failure')
    expect(planned.failed).toBe(true)
  })

  it('voids every check when the publisher tests or the clean step failed', () => {
    const publisher = planChecks(envFor({ OUTCOME_PUBLISHER: 'failure' }))
    expect(publisher.failed).toBe(true)
    expect(publisher.checks.every((item) => item.conclusion === 'failure')).toBe(true)

    const clean = planChecks(envFor({ OUTCOME_CLEAN: 'failure', TREE_DIRTY: '0' }))
    expect(clean.failed).toBe(true)
    expect(clean.checks.every((item) => item.conclusion === 'failure')).toBe(true)
  })
})

describe('the light workflow still emits the legacy check names', () => {
  it('mentions every published name and wires every outcome env', () => {
    for (const spec of CHECKS) {
      expect(WORKFLOW, spec.name).toContain(spec.name)
      expect(WORKFLOW, spec.outcomeEnv).toContain(spec.outcomeEnv)
    }
  })

  it('runs the huatuo suite and records its outcome', () => {
    expect(WORKFLOW).toContain('npx vitest run src/lib/huatuo')
    expect(WORKFLOW).toContain('name: huatuo-tests')
  })

  it('does not run the whole-repo type check or the production build', () => {
    expect(WORKFLOW).not.toContain('npm run type-check')
    expect(WORKFLOW).not.toContain('npm run build')
    expect(WORKFLOW).not.toContain('Application build')
  })
})
