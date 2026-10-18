/**
 * Guard for .github/workflows/pr-application-validation.yml's docs-only early exit.
 *
 * The three required checks (CRM focused tests / Type-check / Application build) must keep
 * their names, must NOT be skipped at job level (a workflow-level `paths` filter or a job-level
 * `if` could leave a required check pending/skipped), and must still run to completion on a
 * docs-only PR with every heavy step skipped. The scope step's shell is executed here with a
 * stub `gh` so the decision logic is proven offline.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const YAML = createRequire(import.meta.url)('js-yaml') as { load(input: string): unknown }

interface Step {
  id?: string
  name?: string
  if?: string
  run?: string
  uses?: string
}
interface Job {
  name?: string
  if?: string
  steps: Step[]
}
interface Workflow {
  on: Record<string, unknown>
  jobs: Record<string, Job>
}

const FILE = join(process.cwd(), '.github/workflows/pr-application-validation.yml')
const wf = YAML.load(readFileSync(FILE, 'utf8')) as Workflow

const HEAVY_JOBS: Record<string, string> = {
  'crm-focused-tests': 'CRM focused tests',
  'type-check': 'Type-check',
  'application-build': 'Application build',
}
const GATE = "steps.scope.outputs.docs_only != 'true'"

describe('workflow structure', () => {
  it('has no paths filter on any trigger', () => {
    for (const trigger of Object.values(wf.on)) {
      const t = (trigger ?? {}) as Record<string, unknown>
      expect(t.paths).toBeUndefined()
      expect(t['paths-ignore']).toBeUndefined()
    }
  })

  it.each(Object.entries(HEAVY_JOBS))('%s keeps its required-check name and is never skipped at job level', (key, name) => {
    const job = wf.jobs[key]
    expect(job?.name).toBe(name)
    // the only job-level condition is the pre-existing fallback one, which does not look at changed files
    expect(job?.if ?? '').not.toContain('docs_only')
  })

  it.each(Object.keys(HEAVY_JOBS))('%s: scope step first, every other step gated except the final record step', (key) => {
    const steps = wf.jobs[key]?.steps ?? []
    expect(steps[0]?.id).toBe('scope')
    for (const step of steps.slice(1)) {
      if (step.name === 'Record exact tested head') {
        expect(step.if).toBe('always()')
      } else {
        expect(step.if, step.name ?? step.uses).toBe(GATE)
      }
    }
  })

  it('the workflow token can read pull requests, and the scope step reads the PR number for dispatch runs too', () => {
    const perms = (wf as unknown as { permissions: Record<string, string> }).permissions
    expect(perms['pull-requests']).toBe('read')
    const env = (wf.jobs['type-check']?.steps[0] as unknown as { env: Record<string, string> }).env
    expect(env.PR_NUMBER).toContain('inputs.pr_number')
  })

  it.each(['type-check', 'application-build'])('%s: the record step never claims a skipped run was tested', (key) => {
    const record = wf.jobs[key]?.steps.find((st) => st.name === 'Record exact tested head')
    expect(record?.run).toContain('steps.scope.outputs.docs_only')
    expect(record?.run).toContain('SKIPPED')
  })

  it('the three scope steps are identical', () => {
    const scripts = Object.keys(HEAVY_JOBS).map((k) => wf.jobs[k]?.steps[0]?.run)
    expect(new Set(scripts).size).toBe(1)
  })
})

interface Stub {
  files: string[] | null // null = gh fails
  changedFiles?: number
  head?: string
}

function runScope(stub: Stub): { output: string; args: string; stderr: string; dir: string } {
  const script = wf.jobs['type-check']?.steps[0]?.run
  if (script === undefined) throw new Error('scope step missing')
  const dir = mkdtempSync(join(tmpdir(), 'scope-'))
  const argsLog = join(dir, 'args.log')
  const ghStub = join(dir, 'gh')
  if (stub.files === null) {
    writeFileSync(ghStub, '#!/bin/sh\nexit 1\n')
  } else {
    const fNames = stub.files.filter((l) => l.startsWith('F:')).length
    const meta = `${stub.changedFiles ?? fNames}\t${stub.head ?? 'abc'}`
    writeFileSync(
      join(dir, 'listing'),
      stub.files.join('\n') + (stub.files.length > 0 ? '\n' : ''),
    )
    writeFileSync(join(dir, 'meta'), meta + '\n')
    writeFileSync(
      ghStub,
      `#!/bin/sh\necho "$@" >> '${argsLog}'\ncase "$*" in *"/files"*) cat '${join(dir, 'listing')}';; *) cat '${join(dir, 'meta')}';; esac\n`,
    )
  }
  chmodSync(ghStub, 0o755)
  const out = join(dir, 'output')
  const summary = join(dir, 'summary')
  writeFileSync(out, '')
  writeFileSync(summary, '')
  const res = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      GITHUB_REPOSITORY: 'o/r',
      PR_NUMBER: '1',
      PR_HEAD_SHA: 'abc',
      GITHUB_OUTPUT: out,
      GITHUB_STEP_SUMMARY: summary,
    },
  })
  return {
    output: readFileSync(out, 'utf8').trim(),
    args: existsSync(argsLog) ? readFileSync(argsLog, 'utf8') : '',
    stderr: res.stdout + res.stderr,
    dir,
  }
}

const F = (...names: string[]): string[] => names.map((n) => `F:${n}`)

describe('scope decision', () => {
  it.each([
    ['markdown, docs files, root md, skills md', F('docs/a.md', 'CLAUDE.md', 'docs/img/x.png', '.claude/skills/x/SKILL.md', 'docs/ledger/card.md'), 'docs_only=true'],
    ['a code file among docs', F('docs/a.md', 'src/app/x.ts'), 'docs_only=false'],
    ['a workflow file', F('.github/workflows/x.yml'), 'docs_only=false'],
    ['a script under docs', F('docs/clients/x/pricing.js'), 'docs_only=false'],
    ['a package.json under docs', F('docs/x/package.json'), 'docs_only=false'],
    ['a markdown file under src', F('src/lib/prompt.md'), 'docs_only=false'],
    ['a json outside docs', F('package.json'), 'docs_only=false'],
    ['an upper-case .MD is not trusted', F('README.MD'), 'docs_only=false'],
    ['a rename from code into docs counts the old path', [...F('docs/x.md'), 'P:src/x.ts'], 'docs_only=false'],
    ['an empty file list', [], 'docs_only=false'],
  ])('%s', (_label, files, expected) => {
    expect(runScope({ files }).output).toBe(expected)
  })

  it('asks for the paginated files list with previous_filename, for the right PR', () => {
    const { args } = runScope({ files: F('docs/a.md') })
    expect(args).toContain('--paginate')
    expect(args).toContain('pulls/1/files')
    expect(args).toContain('previous_filename')
    expect(args).toContain('changed_files')
  })

  it('a failing API call fails safe and says so', () => {
    const res = runScope({ files: null })
    expect(res.output).toBe('docs_only=false')
    expect(res.stderr).toContain('::warning::')
  })

  it('a truncated list (the files API stops at 3000) fails safe', () => {
    expect(runScope({ files: F('docs/a.md'), changedFiles: 3500 }).output).toBe('docs_only=false')
    expect(runScope({ files: F('docs/a.md', 'docs/b.md'), changedFiles: 3 }).output).toBe('docs_only=false')
  })

  it('a head that moved since the run started fails safe', () => {
    expect(runScope({ files: F('docs/a.md'), head: 'def' }).output).toBe('docs_only=false')
  })

  it('hostile file names are data, never executed', () => {
    const marker = join(tmpdir(), `scope-pwned-${process.pid}`)
    const res = runScope({ files: F(`docs/a$(touch ${marker}).md`, 'docs/b"; touch x; ".md') })
    expect(existsSync(marker)).toBe(false)
    expect(res.output).toBe('docs_only=true')
  })
})
