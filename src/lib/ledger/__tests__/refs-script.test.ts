import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * scripts/ledger-check-refs.sh in a throw-away git repo with a fake `gh` on PATH.
 *
 * Why: the check used to look up every pull request pointer of every card on every run (200+ calls),
 * which burns the CI token's hourly allowance and turns every PR red. It must now look only at the cards the
 * PR adds or changes, ask about the same PR number once, and still fail closed (a pointer that cannot be
 * confirmed is red, including when the API is rate limited).
 */

const SCRIPT = resolve(__dirname, '../../../../scripts/ledger-check-refs.sh')

let dir: string
let calls: string

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function card(name: string, extra: Record<string, string>): void {
  const lines = ['---', `id: ${name}`, `title: ${name}`, 'status: done', 'owner: agent', 'decided_on: 2026-10-14', 'done_on: 2026-10-14', 'verify_by: 2026-10-21', 'verify_how: x', ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`), '---', 'body']
  writeFileSync(join(dir, 'docs/ledger', `${name}.md`), `${lines.join('\n')}\n`)
}

/** fake gh: PRs 1..99 exist and are merged; 404 is not found; the file `ratelimit` makes every call fail. */
function installFakeGh(): void {
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const gh = join(bin, 'gh')
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
echo "$*" >> "${calls}"
if [ -f "${dir}/ratelimit" ]; then echo "HTTP 403: API rate limit exceeded" >&2; exit 1; fi
case "$2" in
  */pulls/404) echo "Not Found" >&2; exit 1 ;;
  */pulls/*) echo "2026-10-01T00:00:00Z"; exit 0 ;;
esac
exit 0
`,
  )
  chmodSync(gh, 0o755)
}

function run(env: Record<string, string> = {}): { code: number; out: string; calls: string[] } {
  const base = git('rev-parse', 'base')
  const head = git('rev-parse', 'HEAD')
  const res = spawnSync('bash', [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, GH_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', BASE_SHA: base, HEAD_SHA: head, PR_NUMBER: '500', ...env },
  })
  const log = existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []
  return { code: res.status ?? -1, out: `${res.stdout}${res.stderr}`, calls: log }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-refs-'))
  calls = join(dir, 'calls.log')
  mkdirSync(join(dir, 'docs/ledger'), { recursive: true })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t.t')
  git('config', 'user.name', 't')
  // old, already merged cards: one has a pointer that cannot be found
  card('2026-01-01-old-good', { done_ref: 'pr:10' })
  card('2026-01-02-old-bad', { done_ref: 'pr:404' })
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('tag', 'base')
  installFakeGh()
}, 60_000)

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function commitNew(): void {
  git('add', '-A', 'docs')
  git('commit', '-q', '-m', 'change')
}

describe('ledger-check-refs.sh (PR mode)', { timeout: 60_000 }, () => {
  it('does not look up cards the PR did not touch, so a broken old pointer cannot turn a new PR red', () => {
    card('2026-10-14-new-good', { done_ref: 'pr:500' })
    commitNew()
    const r = run()
    expect(r.code).toBe(0)
    expect(r.calls.some((c) => c.includes('pulls/404'))).toBe(false)
    expect(r.out).toContain('checked 1 of 3')
  })

  it('asks the API once per PR number even when several changed cards point at the same PR', () => {
    card('2026-10-14-a', { done_ref: 'pr:500', source: 'pr:77' })
    card('2026-10-14-b', { source: 'pr:77', done_ref: 'pr:500' })
    commitNew()
    const r = run()
    expect(r.code).toBe(0)
    expect(r.calls.filter((c) => c.includes('pulls/77')).length).toBe(1)
  })

  it('stays red when a changed card points at a PR that cannot be found', () => {
    card('2026-10-14-new-bad', { done_ref: 'pr:404', source: 'pr:500' })
    commitNew()
    const r = run()
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('2026-10-14-new-bad')
    expect(r.out).toContain('查不到')
  })

  it('stays red (never falsely green) when the API is rate limited and a changed card has a PR pointer', () => {
    writeFileSync(join(dir, 'ratelimit'), '1')
    card('2026-10-14-new-good', { done_ref: 'pr:500' })
    commitNew()
    const r = run()
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('查不到')
  })

  it('checks an edited old card (modified, not new)', () => {
    card('2026-01-02-old-bad', { done_ref: 'pr:404', verify_how: 'edited' })
    card('2026-10-14-new-good', { done_ref: 'pr:500' })
    commitNew()
    const r = run()
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('2026-01-02-old-bad')
  })

  it('turns red (never "0 cards checked, ok") when git cannot work out what the PR changed', () => {
    card('2026-10-14-new-good', { done_ref: 'pr:500' })
    commitNew()
    const r = run({ BASE_SHA: '0000000000000000000000000000000000000001' })
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('算不出本 PR 改了哪些台账卡')
  })

  it('checks a card whose file name is not ASCII (git must not escape the path)', () => {
    card('2026-10-14-中文卡', { done_ref: 'pr:404', source: 'pr:500' })
    commitNew()
    const r = run()
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('中文卡')
  })

  it('treats an empty API answer as "not found", not as a pass', () => {
    writeFileSync(join(dir, 'bin', 'gh'), `#!/usr/bin/env bash\necho "$*" >> "${calls}"\nexit 0\n`)
    card('2026-10-14-new-good', { done_ref: 'pr:77', source: 'pr:500' })
    commitNew()
    const r = run()
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('查不到')
  })

  it('still verifies doc: pointers of untouched old cards (local, costs no API calls)', () => {
    card('2026-01-03-old-doc', { done_ref: 'doc:docs/nope/missing.md' })
    git('add', '-A', 'docs')
    git('commit', '-q', '-m', 'old doc card')
    git('tag', '-f', 'base')
    card('2026-10-14-new-good', { done_ref: 'pr:500' })
    commitNew()
    const r = run()
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('2026-01-03-old-doc')
    expect(r.calls.some((c) => c.includes('pulls/404'))).toBe(false)
  })

  it('LEDGER_REFS_FULL=1 still checks every card (daily sweep / local use)', () => {
    card('2026-10-14-new-good', { done_ref: 'pr:500' })
    commitNew()
    const r = run({ LEDGER_REFS_FULL: '1' })
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('2026-01-02-old-bad')
  })

  it('without BASE_SHA/HEAD_SHA (local run) it checks every card', () => {
    const r = run({ BASE_SHA: '', HEAD_SHA: '', PR_NUMBER: '' })
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('2026-01-02-old-bad')
  })
})
