import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const YAML = require('yaml')
const modules = ['ai-orchestrator', 'ops-review-loop']

for (const module of modules) {
  const workflow = YAML.parse(readFileSync(`.github/workflows/${module}-ci.yml`, 'utf8'))
  test(`${module}: required check always reports without new permissions`, () => {
    assert.deepEqual(workflow.on, { pull_request: null })
    assert.deepEqual(workflow.permissions, { contents: 'read' })
    assert.equal(workflow.jobs.tests.name, `${module}-tests`)
    assert.equal(workflow.jobs.tests.if, undefined)
    assert.equal(workflow.concurrency['cancel-in-progress'], true)
  })
  test(`${module}: only proven unrelated changes skip heavy steps`, () => {
    const steps = workflow.jobs.tests.steps
    assert.equal(steps[0].with['fetch-depth'], 2)
    const scope = steps.find(step => step.id === 'scope')
    assert.ok(scope.run.includes(`module-ci-scope.py ${module}`))
    assert.ok(scope.run.includes('github.event.pull_request.base.sha'))
    assert.ok(scope.run.includes('github.event.pull_request.head.sha'))
    const heavy = steps.filter(step => step.uses?.startsWith('actions/setup-node@') ||
      /npm ci|npx tsc|npx vitest/.test(step.run ?? ''))
    assert.equal(heavy.length, module === 'ai-orchestrator' ? 4 : 3)
    for (const step of heavy) {
      assert.equal(step.if, "steps.scope.outputs.run_heavy != 'false'")
    }
    const receipt = steps.find(step => step.name === 'Explain skipped module work')
    assert.equal(receipt.if, "steps.scope.outputs.run_heavy == 'false'")
    assert.ok(receipt.run.includes('GITHUB_STEP_SUMMARY'))
    assert.equal(steps.at(-1).if, undefined)
    assert.ok(steps.at(-1).run.includes('git status --porcelain'))
  })
}
