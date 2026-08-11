/**
 * The workflows' own supply-chain and permission rules, as assertions.
 *
 * Writing "pin your actions" in a checklist does not stop anyone from adding
 * `uses: some/action@v1` in six months. Reading the file and failing the build
 * does. Same for the trigger lists and the permission blocks: these were prose
 * promises in the spec, and prose does not survive a hurried edit.
 *
 * Two workflows are governed here, and they have deliberately different shapes:
 *
 *   ai-orchestrator-manual.yml   the orchestrator. workflow_dispatch only,
 *                               disabled by default, refuses to be switched on.
 *   ai-orchestrator-ci.yml       ordinary read-only CI. pull_request only,
 *                               UNfiltered (see below), no secrets, no writes.
 *
 * The rules they share (pinned actions, no dangerous write scopes, no schedule,
 * no issue_comment) are asserted against both.
 *
 * The CI workflow additionally must carry NO event filter at all. It is intended
 * to be a required status check, and GitHub does not run a workflow on a PR its
 * filter excludes — so the required check never reports, stays Pending, and
 * blocks a PR that never touched this module. A `paths:` filter that looks like
 * a tidy optimisation is a repository-wide merge deadlock. That is what
 * `REQUIRED_CHECK_WORKFLOWS` below exists to prevent recurring.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `js-yaml` is present transitively (via eslint) rather than as a direct
 * dependency, and this suite deliberately does not add one. It is loaded through
 * `createRequire` with an explicit type instead of a bare import so there is no
 * implicit type hole, and if it ever disappears these tests fail loudly rather
 * than quietly skipping the supply-chain checks. The `uses:` assertions below
 * also run against the raw text, so the most important property survives even
 * that.
 */
const requireFromHere = createRequire(import.meta.url)
const YAML = requireFromHere('js-yaml') as { load(input: string): unknown }

const MANUAL_PATH = join(process.cwd(), '.github/workflows/ai-orchestrator-manual.yml')
const CI_PATH = join(process.cwd(), '.github/workflows/ai-orchestrator-ci.yml')

interface WorkflowStep {
  uses?: string
  name?: string
  run?: string
  if?: string
}

interface WorkflowJob {
  name?: string
  steps?: WorkflowStep[]
  permissions?: Record<string, string>
}

interface Workflow {
  on?: Record<string, unknown>
  true?: Record<string, unknown>
  permissions?: Record<string, string>
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean }
  jobs?: Record<string, WorkflowJob>
}

interface LoadedWorkflow {
  label: string
  path: string
  source: string
  /** Comment lines removed: a comment cannot leak a secret or call an API. */
  executable: string
  doc: Workflow
  triggers: Record<string, unknown>
  steps: WorkflowStep[]
}

function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
}

function load(label: string, path: string): LoadedWorkflow {
  const source = readFileSync(path, 'utf8')
  const doc = YAML.load(source) as Workflow
  return {
    label,
    path,
    source,
    executable: stripCommentLines(source),
    doc,
    // `on:` is YAML 1.1's boolean true, which js-yaml faithfully reproduces.
    triggers: (doc.on ?? doc.true ?? {}) as Record<string, unknown>,
    steps: Object.values(doc.jobs ?? {}).flatMap((job) => job.steps ?? []),
  }
}

const manual = load('manual', MANUAL_PATH)
const ci = load('ci', CI_PATH)
const both = [manual, ci]

const FULL_SHA = /^[0-9a-f]{40}$/

/**
 * Workflows intended to be required status checks. These may not filter their
 * events — a skipped required check is a stuck PR, not a saved minute.
 */
const REQUIRED_CHECK_WORKFLOWS = [ci]

/** Filters that cause GitHub to skip a workflow, leaving a required check unreported. */
const SKIPPING_FILTERS = ['paths', 'paths-ignore', 'branches', 'branches-ignore', 'tags', 'tags-ignore']
const FORBIDDEN_WRITE_SCOPES = [
  'workflows',
  'actions',
  'administration',
  'deployments',
  'packages',
  'security-events',
]

// ─────────────────────────────────────────────────────────────────────────────
// Rules that apply to both workflows
// ─────────────────────────────────────────────────────────────────────────────

describe.each(both.map((workflow) => [workflow.label, workflow] as const))(
  '%s workflow',
  (_label, workflow) => {
    it.each(['schedule', 'issue_comment', 'repository_dispatch', 'workflow_run'])(
      'has no %s trigger',
      (name) => {
        expect(workflow.triggers).not.toHaveProperty(name)
      }
    )

    it.each(FORBIDDEN_WRITE_SCOPES)('never grants %s: write', (scope) => {
      const blocks = [
        workflow.doc.permissions,
        ...Object.values(workflow.doc.jobs ?? {}).map((job) => job.permissions),
      ]
      for (const block of blocks) {
        if (!block) continue
        expect(block[scope]).not.toBe('write')
      }
    })

    it('declares a permissions block rather than inheriting the repository default', () => {
      expect(workflow.doc.permissions).toBeDefined()
    })

    it('pins every action to a full commit SHA', () => {
      const uses = workflow.steps
        .map((step) => step.uses)
        .filter((value): value is string => typeof value === 'string')
      expect(uses.length).toBeGreaterThan(0)
      for (const reference of uses) {
        const [, version] = reference.split('@')
        expect(version, `${reference} must be pinned to a 40-character commit SHA`).toMatch(FULL_SHA)
      }
    })

    it('has no unpinned uses: line anywhere in the raw file', () => {
      // Text-level cross-check, independent of the YAML parser.
      const lines = workflow.source
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- uses:') || line.startsWith('uses:'))
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) {
        expect(line, `${line} must be pinned to a commit SHA`).toMatch(/@[0-9a-f]{40}\b/)
      }
    })

    it('leaves a human-readable version comment beside each pin', () => {
      const uses = workflow.steps
        .map((step) => step.uses)
        .filter((value): value is string => typeof value === 'string')
      for (const reference of uses) {
        const line = workflow.source.split('\n').find((candidate) => candidate.includes(reference))
        expect(line, `${reference} should carry a "# vX.Y.Z" comment`).toMatch(/#\s*v\d/)
      }
    })

    it('asserts the working tree is unchanged at the end', () => {
      const guard = workflow.steps.find((step) => step.name?.includes('changed nothing'))
      expect(guard?.run).toContain('git status --porcelain')
      expect(guard?.run).toContain('exit 1')
    })
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// The orchestrator: manual only, and refuses to be switched on
// ─────────────────────────────────────────────────────────────────────────────

describe('the orchestrator workflow', () => {
  it('is manual only', () => {
    expect(Object.keys(manual.triggers)).toEqual(['workflow_dispatch'])
  })

  it('grants only contents: read', () => {
    expect(manual.doc.permissions).toEqual({ contents: 'read' })
  })

  it('defaults its master switch to off', () => {
    const dispatch = manual.triggers.workflow_dispatch as {
      inputs?: Record<string, { default?: unknown }>
    }
    expect(dispatch.inputs?.enabled?.default).toBe(false)
  })

  it('fails the job when enabled is true', () => {
    const guard = manual.steps.find((step) => step.if === '${{ inputs.enabled }}')
    expect(guard).toBeDefined()
    expect(guard?.run).toContain('exit 1')
  })

  it('fails the job when model credentials are present', () => {
    const guard = manual.steps.find((step) => step.name?.includes('no model credentials'))
    expect(guard?.run).toContain('exit 1')
  })

  it('serialises per Issue and never cancels a run mid-turn', () => {
    expect(manual.doc.concurrency?.group).toContain('inputs.issue_number')
    expect(manual.doc.concurrency?.['cancel-in-progress']).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Required status checks must never be skippable
// ─────────────────────────────────────────────────────────────────────────────

describe.each(REQUIRED_CHECK_WORKFLOWS.map((workflow) => [workflow.label, workflow] as const))(
  '%s workflow is safe to require',
  (_label, workflow) => {
    it.each(SKIPPING_FILTERS)('declares no %s filter on any trigger', (filter) => {
      for (const [event, config] of Object.entries(workflow.triggers)) {
        if (config === null || config === undefined) continue
        expect(
          config as Record<string, unknown>,
          `${event} must not use ${filter}: a skipped required check blocks every unrelated PR`
        ).not.toHaveProperty(filter)
      }
    })

    it('has at least one trigger, so the check actually reports', () => {
      expect(Object.keys(workflow.triggers).length).toBeGreaterThan(0)
    })
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// The CI workflow: read-only, unfiltered, secret-free
// ─────────────────────────────────────────────────────────────────────────────

describe('the CI workflow', () => {
  it('runs on pull requests only', () => {
    expect(Object.keys(ci.triggers)).toEqual(['pull_request'])
  })

  it('grants only contents: read', () => {
    expect(ci.doc.permissions).toEqual({ contents: 'read' })
  })

  it('reports on every pull request, so a required check can never hang', () => {
    // `pull_request:` with no body at all — the only shape that guarantees the
    // check reports on every PR.
    expect(ci.triggers.pull_request ?? null).toBeNull()
  })

  it('references no secret at all', () => {
    // Not "passes no model key" — names none. A secret it never references is a
    // secret it cannot leak into a log or a subprocess. Checked against the
    // executable content: the header comment explains the rule and is allowed to
    // say the word.
    expect(ci.executable).not.toMatch(/\bsecrets\./)
    expect(ci.executable).not.toMatch(/\benv:/)
  })

  it('invokes no model provider endpoint or SDK', () => {
    for (const term of ['openai', 'anthropic', 'api.openai.com', 'claude-code-action']) {
      expect(ci.executable.toLowerCase()).not.toContain(term)
    }
  })

  it('uses the stable check name the ruleset can require', () => {
    // Renaming this silently detaches any required status check that names it.
    expect(ci.doc.jobs?.tests?.name).toBe('ai-orchestrator-tests')
  })

  it('runs the module test suite', () => {
    const step = ci.steps.find((candidate) => candidate.run?.includes('vitest'))
    expect(step?.run).toContain('npx vitest run tools/ai-orchestrator')
  })

  it('runs the module-scoped type check, not the red whole-repo one', () => {
    const step = ci.steps.find((candidate) => candidate.run?.includes('tsc'))
    expect(step?.run).toContain('tsc -p tools/ai-orchestrator/tsconfig.json')
  })

  it('runs the module suite even on a PR that touches nothing in this module', () => {
    // Restating the property from the other direction: there is no mechanism in
    // the file by which GitHub could decide to skip this workflow.
    const source = ci.executable
    for (const filter of SKIPPING_FILTERS) {
      expect(source, `CI must not use ${filter}`).not.toMatch(new RegExp(`^\\s*${filter}:`, 'm'))
    }
  })

  it('may cancel superseded runs, unlike the orchestrator', () => {
    // Safe here: cancelling a test run loses nothing. Cancelling a turn mid-call
    // would strand a lease, which is why the orchestrator sets this to false.
    expect(ci.doc.concurrency?.['cancel-in-progress']).toBe(true)
  })
})
