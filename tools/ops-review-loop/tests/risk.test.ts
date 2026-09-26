/**
 * The deterministic A/B/C rating.
 *
 * These tests are written against the two ways the rating can fail badly, not
 * against the happy path:
 *
 *  1. **Under-rating** — a diff that touches something protected coming out as
 *     B or C. Every A rule gets a representative real path from this repository
 *     (not an invented one), so a rule that stops matching the tree it was
 *     written for fails here rather than silently downgrading PRs.
 *  2. **Self-rating** — the PR author declaring a level the diff does not
 *     support. The declaration is only ever a floor.
 *
 * Plus the fail-closed cases, which are the ones that look like a pass if you
 * only read the output: an unreadable file list and a rating of "nothing".
 */

import { describe, expect, it } from 'vitest'

import {
  A_RISK_RULES,
  C_SAFE_RULES,
  MAX_REASONS,
  classifyFile,
  classifyRisk,
  higherRisk,
  maxRoundsForRisk,
  parseDeclaredRisk,
} from '../src/risk.mjs'

const file = (filename: string) => ({ filename })

/**
 * Real paths from this repository, one per A rule. Verified to exist (or, for
 * `.env`, to be the shape the repo's ignore rules describe) at the time this
 * was written — the point is that these are the tree's actual names, so a
 * rename breaks the test instead of the gate.
 */
const A_PATHS: Array<[string, string]> = [
  ['supabase/migrations/20260101000000_something.sql', 'migration'],
  ['scripts/backfill.sql', 'loose SQL'],
  ['.github/workflows/ops-codex-request-review.yml', 'CI definition'],
  ['tools/ops-review-loop/src/plan.mjs', 'this control plane'],
  ['tools/ai-orchestrator/src/index.ts', 'orchestrator control plane'],
  ['render.yaml', 'production services and cron'],
  ['CLAUDE.md', 'repository rulebook'],
  ['AGENTS.md', 'agent entry rules'],
  ['.github/merge-authorization.md', 'merge rules document'],
  ['.claude/skills/me-platform-tier-gate/SKILL.md', 'agent skill and tier gate'],
  ['docs/ENGINEERING_QUALITY_GATES.md', 'quality gate rulebook'],
  ['docs/ledger/README.md', 'ledger rules'],
  ['scripts/ledger-check-refs.sh', 'ledger check script'],
  ['src/middleware.ts', 'request-level auth boundary'],
  ['src/lib/auth/client-access.ts', 'client access boundary'],
  ['src/app/api/auth/callback/route.ts', 'auth endpoint'],
  ['src/app/api/webhooks/stripe/route.ts', 'inbound webhook signature boundary'],
  ['src/lib/db/rls-policy.ts', 'RLS'],
  ['src/lib/clients/tenant-isolation.ts', 'tenant isolation'],
  ['src/lib/kernel/authorize.ts', 'kernel authorization'],
  ['src/app/api/kernel/submit/route.ts', 'kernel endpoint'],
  ['src/lib/execution/auto-run-policy.ts', 'auto-run policy'],
  ['src/lib/billing/usage-tracker.ts', 'billing'],
  ['src/app/api/stripe/checkout/route.ts', 'payment'],
  ['src/app/api/mtc/consume/route.ts', 'credit spend'],
  ['src/lib/cron/registry.ts', 'cron registry'],
  ['src/app/api/cron/daily/route.ts', 'cron route'],
  ['src/lib/cms/blog-publisher.ts', 'outward publish'],
  ['src/lib/social/facebook-publisher.ts', 'outward publish'],
  ['src/lib/email/sender.ts', 'outward email'],
  ['src/lib/meta/guardrails.ts', 'spend guardrail'],
  ['src/lib/cms/ssrf-guard.ts', 'SSRF boundary'],
  ['.env', 'credentials'],
  ['apps/worker/.env.production', 'credentials'],
  ['src/lib/google-ads/creds-loader.ts', 'credential loading'],
  ['package.json', 'dependency manifest'],
  ['package-lock.json', 'dependency lock'],
  // Config and secret files that rated B until 2026-09-27 — see the block below.
  ['.env.production', 'root credentials variant'],
  ['.gitignore', 'ignore list guarding secret files'],
  ['tsconfig.json', 'type-check config'],
  ['vitest.config.ts', 'test runner config'],
  ['playwright.config.ts', 'e2e config'],
  ['.eslintrc.json', 'lint config'],
  ['.husky/pre-commit', 'pre-commit hook'],
  ['next.config.js', 'Next.js build/runtime config'],
  ['instrumentation.ts', 'Next.js startup hook'],
  ['scripts/render-worker/Dockerfile', 'container image'],
  ['supabase/config.toml', 'Supabase project config'],
  ['.nvmrc', 'Node version pin'],
  ['middleware.ts', 'root middleware'],
  ['tools/local-executor-bridge/bridge.py', 'signed local executor'],
  ['.npmrc', 'npm install config'],
  ['vitest.workspace.ts', 'vitest workspace'],
  ['scripts/check-policy-to-clause.mjs', 'RLS red-line check'],
  ['scripts/db-replay-and-verify.sh', 'db red-line replay'],
  ['.node-version', 'Node version pin read first by Render'],
  ['.tool-versions', 'asdf / mise runtime pin'],
  ['.dockerignore', 'keeps .env out of images'],
  ['yarn.lock', 'other lockfiles'],
]

describe('every protected path rates A', () => {
  it.each(A_PATHS)('%s (%s)', (path) => {
    expect(classifyFile(path).risk).toBe('A')
  })

  it('every A rule in the table is exercised by at least one path above', () => {
    const unmatched = A_RISK_RULES.filter(
      (rule: { why: string }) => !A_PATHS.some(([path]) => classifyFile(path).why === rule.why),
    )
    expect(unmatched.map((r: { why: string }) => r.why)).toEqual([])
  })

  // Found by deleting each A rule in turn and re-running this file: removing
  // the `supabase/migrations/` prefix changed nothing, because every probe path
  // for it also ended in `.sql` and the suffix rule caught it anyway. A rule no
  // test can distinguish from its neighbour is a rule that can be deleted by
  // accident, and this one is not redundant at all — anything in that directory
  // that is NOT `.sql` (a README, a shell helper) would otherwise rate C or B.
  it('rates a non-.sql file inside supabase/migrations A, not by its extension', () => {
    expect(classifyFile('supabase/migrations/README.md')).toEqual({
      risk: 'A',
      why: 'migration —— 数据库结构变更，不可逆',
      category: 'db-migration',
    })
  })
})

describe('governance files are A even though they are markdown', () => {
  it('rates CLAUDE.md A, not C', () => {
    expect(classifyFile('CLAUDE.md')).toEqual({
      risk: 'A',
      why: '仓库总规则 —— 合并规则、客户数据红线',
      category: 'governance',
    })
  })

  it('keeps .github/workflows/ on the narrower control-plane rule', () => {
    expect(classifyFile('.github/workflows/ledger-check.yml').category).toBe('control-plane')
  })

  it('rates the merge-authorization doc A', () => {
    const result = classifyFile('.github/merge-authorization.md')
    expect(result.risk).toBe('A')
    expect(result.category).toBe('governance')
  })

  it('leaves an ordinary ledger card C, so ledger-only auto-merge still works', () => {
    expect(classifyFile('docs/ledger/2026-09-25-some-card.md').risk).toBe('C')
  })

  it('leaves docs/agents/ C — deliberately not governance', () => {
    expect(classifyFile('docs/agents/ziya.md').risk).toBe('C')
  })

  it('leaves docs/specs/ C', () => {
    expect(classifyFile('docs/specs/anything.md').risk).toBe('C')
  })

  it('makes a CLAUDE.md-only PR A with the governance category', () => {
    const result = classifyRisk({ files: [{ filename: 'CLAUDE.md' }] })
    expect(result.risk).toBe('A')
    expect(result.categories).toContain('governance')
    expect(result.reasons[0]).toContain('CLAUDE.md')
  })
})

/**
 * Verified on main 33672dbe (2026-09-27) with exactly this call shape: every
 * path below rated B, and B auto-merges with no human since 2026-09-25. One
 * test per path, so deleting any single rule turns at least one of these red —
 * the mutation run in the PR shows it rule by rule.
 */
describe('config and secret files rate A, not B', () => {
  const rate = (filename: string) => classifyRisk({ files: [{ filename, status: 'modified' }] })

  it.each([
    // credentials / secret exposure
    ['.env.production', 'credentials'],
    ['.env.local', 'credentials'],
    ['.env.staging', 'credentials'],
    ['.gitignore', 'credentials'],
    ['docs/clients/parkhomes/web/.gitignore', 'credentials'],
    // build / runtime execution
    ['next.config.js', 'build-runtime'],
    ['next.config.mjs', 'build-runtime'],
    ['middleware.ts', 'auth-isolation'],
    ['instrumentation.ts', 'build-runtime'],
    ['src/instrumentation.ts', 'build-runtime'],
    ['instrumentation-client.ts', 'build-runtime'],
    ['Dockerfile', 'build-runtime'],
    ['scripts/render-worker/Dockerfile', 'build-runtime'],
    ['supabase/config.toml', 'build-runtime'],
    ['.nvmrc', 'build-runtime'],
    ['tools/local-executor-bridge/bridge.py', 'kernel-execution'],
    ['tools/local-executor-bridge/policy.v1.json', 'kernel-execution'],
    // what the checks themselves do
    ['tsconfig.json', 'control-plane'],
    ['tsconfig.base.json', 'control-plane'],
    ['vitest.config.ts', 'control-plane'],
    ['vitest.setup.ts', 'control-plane'],
    ['playwright.config.ts', 'control-plane'],
    ['eslint.config.mjs', 'control-plane'],
    ['.eslintrc.json', 'control-plane'],
    ['.eslintrc.js', 'control-plane'],
    ['.husky/pre-commit', 'control-plane'],
    ['.npmrc', 'supply-chain'],
    // second review round on #2071 (子牙 / 魏征 / 狄仁杰)
    ['vitest.workspace.ts', 'control-plane'],
    ['vitest.projects.ts', 'control-plane'],
    ['scripts/check-policy-to-clause.mjs', 'control-plane'],
    ['scripts/db-replay-and-verify.sh', 'control-plane'],
    ['.dockerignore', 'credentials'],
    ['.ENV.production', 'credentials'],
    ['.node-version', 'build-runtime'],
    ['.tool-versions', 'build-runtime'],
    ['middleware.js', 'auth-isolation'],
    ['src/middleware.js', 'auth-isolation'],
    ['scripts/factory-worker/package.json', 'supply-chain'],
    ['docs/clients/parkhomes/web/package-lock.json', 'supply-chain'],
    ['yarn.lock', 'supply-chain'],
    ['pnpm-lock.yaml', 'supply-chain'],
    ['npm-shrinkwrap.json', 'supply-chain'],
  ])('%s is A (%s)', (path, category) => {
    const result = rate(path)
    expect(result.risk).toBe('A')
    expect(result.categories).toEqual([category])
    expect(result.reasons[0]).toContain(path)
  })

  it('keeps the root .env.example template B — the one exemption', () => {
    expect(rate('.env.example').risk).toBe('B')
  })

  it('keeps a nested .env.example A, as it already was — the exemption is root-only', () => {
    expect(rate('scripts/factory-worker/.env.example').risk).toBe('A')
  })

  it('does not exempt a variant that merely starts with the template name', () => {
    expect(rate('.env.example.local').risk).toBe('A')
  })

  it('keeps root .env and config/.env.production A, as they already were', () => {
    expect(rate('.env').risk).toBe('A')
    expect(rate('config/.env.production').risk).toBe('A')
  })

  it('keeps docs markdown C', () => {
    expect(rate('docs/STATE.md').risk).toBe('C')
  })

  it('keeps a plain string array A — an entry with no filename is unreadable', () => {
    const result = classifyRisk({ files: ['.env.example', 'docs/a.md'] })
    expect(result.risk).toBe('A')
    expect(result.readable).toBe(false)
  })

  it('does not treat a file that merely mentions env as a secret file', () => {
    expect(classifyFile('src/lib/config/env.ts').risk).toBe('B')
    expect(classifyFile('docs/ENV.md').risk).toBe('C')
  })
})

describe('the word-boundary rules do not over-match', () => {
  // `rls` inside `urls` is the whole reason `basenameWord` exists rather than a
  // plain substring: a plain `includes('rls')` rates every URL helper in the
  // repository as A, and a gate that fires on everything gets switched off.
  it('urls.ts is not mistaken for an RLS policy', () => {
    expect(classifyFile('src/lib/utils/urls.ts').risk).toBe('B')
  })

  it('controls.ts is not mistaken for an RLS policy', () => {
    expect(classifyFile('src/components/controls.ts').risk).toBe('B')
  })

  it('a real rls file still matches', () => {
    expect(classifyFile('src/lib/db/rls.ts').risk).toBe('A')
  })
})

describe('C is a narrow allowlist, never a fallback', () => {
  it.each([
    'docs/STATE.md',
    'README.md',
    'src/app/globals.css',
    'public/logo.svg',
    'src/lib/foo/bar.test.ts',
    'src/lib/foo/__tests__/bar.ts',
  ])('%s is C-safe', (path) => {
    expect(classifyFile(path).risk).toBe('C')
  })

  it.each([
    'src/lib/reports/build-summary.ts',
    'src/app/(dashboard)/page.tsx',
    'scripts/one-off.mjs',
    'src/lib/geo/score.ts',
  ])('%s is B — unrecognised is not low-risk', (path) => {
    expect(classifyFile(path).risk).toBe('B')
  })

  // The first version of this generated one probe path per entry *from*
  // `C_SAFE_RULES`. Deleting a rule then deleted its own probe, and the suite
  // stayed green through 14 of the 19 deletions — a test that iterates the
  // table it is testing cannot notice the table shrinking. Both halves below
  // are written out by hand for that reason.
  it.each([
    ['docs/anything', 'docs/ prefix'],
    ['README.md', '.md'],
    ['docs/guide.mdx', '.mdx'],
    ['notes.txt', '.txt'],
    ['src/app/globals.css', '.css'],
    ['src/styles/theme.scss', '.scss'],
    ['public/logo.svg', '.svg'],
    ['public/hero.png', '.png'],
    ['public/hero.jpg', '.jpg'],
    ['public/hero.jpeg', '.jpeg'],
    ['public/spin.gif', '.gif'],
    ['public/hero.webp', '.webp'],
    ['public/hero.avif', '.avif'],
    ['src/app/favicon.ico', '.ico'],
    ['src/lib/x/y.test.ts', '.test.ts'],
    ['src/components/X.test.tsx', '.test.tsx'],
    ['src/lib/x/y.spec.ts', '.spec.ts'],
    ['src/components/X.spec.tsx', '.spec.tsx'],
    ['src/lib/x/__tests__/y.ts', '/__tests__/'],
  ])('%s is C via the %s rule', (path) => {
    expect(classifyFile(path).risk).toBe('C')
  })

  // Removing a C rule only makes the gate stricter, so it is a safe accident.
  // ADDING one is the dangerous direction — a broad new entry (say `.ts`) would
  // quietly route real business logic into the C lane, which is sampled rather
  // than reviewed. Freezing the table means any change to it, in either
  // direction, has to be a deliberate line in the diff.
  it('the C-safe table is exactly these patterns and no others', () => {
    const rules = C_SAFE_RULES as unknown as Array<Record<string, string>>
    const patterns = rules.map((rule) => Object.entries(rule).find(([k]) => k !== 'why')?.join('='))
    expect(patterns).toEqual([
      'prefix=docs/',
      'suffix=.md',
      'suffix=.mdx',
      'suffix=.txt',
      'suffix=.css',
      'suffix=.scss',
      'suffix=.svg',
      'suffix=.png',
      'suffix=.jpg',
      'suffix=.jpeg',
      'suffix=.gif',
      'suffix=.webp',
      'suffix=.avif',
      'suffix=.ico',
      'suffix=.test.ts',
      'suffix=.test.tsx',
      'suffix=.spec.ts',
      'suffix=.spec.tsx',
      'includes=/__tests__/',
    ])
  })
})

describe('a mixed diff takes the highest level present', () => {
  it('one migration among documentation makes the whole PR A', () => {
    const result = classifyRisk({
      files: [file('docs/a.md'), file('README.md'), file('supabase/migrations/20260101_x.sql')],
    })
    expect(result.risk).toBe('A')
    expect(result.reasons.join('\n')).toContain('supabase/migrations/20260101_x.sql')
  })

  it('one business file among documentation makes the whole PR B', () => {
    expect(classifyRisk({ files: [file('docs/a.md'), file('src/lib/geo/score.ts')] }).risk).toBe('B')
  })

  it('documentation only stays C', () => {
    const result = classifyRisk({ files: [file('docs/a.md'), file('docs/b.md')] })
    expect(result.risk).toBe('C')
    expect(result.readable).toBe(true)
  })

  it('reports only the files that raised the level, not the C-safe ones', () => {
    const result = classifyRisk({ files: [file('docs/a.md'), file('src/lib/kernel/runner.ts')] })
    expect(result.reasons).toHaveLength(1)
    expect(result.reasons[0]).toContain('src/lib/kernel/runner.ts')
  })
})

describe('a rename cannot carry a file out of the protected set (Codex P1, PR #1205)', () => {
  const renamed = (from: string, to: string) => ({
    filename: to,
    previous_filename: from,
    status: 'renamed',
  })

  it('rates a workflow moved into docs/ as A, on the path it came from', () => {
    const result = classifyRisk({ files: [renamed('.github/workflows/guard.yml', 'docs/guard.yml')] })
    expect(result.risk).toBe('A')
    expect(result.reasons.join('\n')).toContain('.github/workflows/guard.yml')
    expect(result.categories).toContain('control-plane')
  })

  it.each([
    ['supabase/migrations/20260101_x.sql', 'docs/old-migration.md'],
    ['src/lib/kernel/authorize.ts', 'docs/notes.md'],
    ['src/lib/auth/whitelist.ts', 'public/whitelist.txt'],
    ['tools/ops-review-loop/src/plan.mjs', 'docs/plan.md'],
  ])('%s renamed to %s is still A', (from, to) => {
    expect(classifyRisk({ files: [renamed(from, to)] }).risk).toBe('A')
  })

  it('rates a rename INTO a protected path as A too — the new path still counts', () => {
    const result = classifyRisk({ files: [renamed('docs/draft.yml', '.github/workflows/new.yml')] })
    expect(result.risk).toBe('A')
  })

  it('says which path was the pre-rename one, so the reason is not baffling', () => {
    const result = classifyRisk({ files: [renamed('src/lib/kernel/runner.ts', 'docs/runner.md')] })
    expect(result.reasons.join('\n')).toContain('rename 前的原路径')
  })

  it('rates both ends and keeps the higher when they differ', () => {
    // Old path B, new path A: the naive "only look at previous_filename" fix
    // would get this one backwards.
    const result = classifyRisk({ files: [renamed('src/lib/geo/score.ts', 'src/lib/kernel/score.ts')] })
    expect(result.risk).toBe('A')
  })

  it('fails closed when an entry claims to be a rename but names no origin', () => {
    const result = classifyRisk({ files: [{ filename: 'docs/x.md', status: 'renamed' }] })
    expect(result.risk).toBe('A')
    expect(result.readable).toBe(false)
    expect(result.categories).toContain('unreadable')
  })

  it('treats a copy the same way — the API sets previous_filename there too', () => {
    const result = classifyRisk({
      files: [{ filename: 'docs/copy.md', previous_filename: 'render.yaml', status: 'copied' }],
    })
    expect(result.risk).toBe('A')
  })

  // Isolating probe: with `previous_filename` present, the `copied` status never
  // gets consulted, so dropping 'copied' from the status set changed nothing and
  // the suite stayed green. Only an origin-less `copied` entry reaches that
  // branch — and it must fail closed exactly like an origin-less `renamed` one.
  it.each(['renamed', 'copied'])('fails closed on a %s entry with no origin', (status) => {
    const result = classifyRisk({ files: [{ filename: 'docs/x.md', status }] })
    expect(result.risk).toBe('A')
    expect(result.readable).toBe(false)
    expect(result.reasons.join('\n')).toContain(status)
  })

  it('leaves an ordinary non-rename entry alone', () => {
    const result = classifyRisk({ files: [{ filename: 'docs/a.md', status: 'modified' }] })
    expect(result.risk).toBe('C')
    expect(result.readable).toBe(true)
  })
})

describe('risk categories drive which evidence is owed', () => {
  it('reports the categories a diff actually hit, sorted and deduplicated', () => {
    const result = classifyRisk({
      files: [
        { filename: 'supabase/migrations/20260101_x.sql' },
        { filename: 'src/lib/kernel/runner.ts' },
        { filename: 'src/app/api/kernel/route.ts' },
        { filename: 'docs/a.md' },
      ],
    })
    expect(result.categories).toEqual(['db-migration', 'kernel-execution'])
  })

  it('reports no category for a diff with no A-level surface', () => {
    expect(classifyRisk({ files: [{ filename: 'src/lib/geo/score.ts' }] }).categories).toEqual([])
  })

  // A misspelt kind (`basenme: '.gitignore'`) matches nothing and the rule
  // silently dies (魏征 W71-4, #2071). So every rule must use exactly one kind
  // this module knows, and a `pattern` must be stateless: a `g` / `y` flag
  // makes `.test()` remember `lastIndex`, so the same path would rate A on one
  // call and B on the next.
  it('every A rule uses exactly one known kind, and no pattern is stateful', () => {
    const KINDS = ['exact', 'prefix', 'suffix', 'includes', 'basenameIncludes', 'basenameWord', 'basename', 'pattern']
    for (const rule of A_RISK_RULES as Array<Record<string, unknown>>) {
      const keys = Object.keys(rule).filter((k) => k !== 'why' && k !== 'category')
      expect(keys, `${String(rule.why)} has kinds ${keys.join(',')}`).toHaveLength(1)
      expect(KINDS, `${String(rule.why)} uses unknown kind ${keys[0]}`).toContain(keys[0])
      if (rule.pattern !== undefined) {
        expect(rule.pattern).toBeInstanceOf(RegExp)
        expect((rule.pattern as RegExp).flags).not.toMatch(/[gy]/)
      } else {
        expect(typeof rule[keys[0]], String(rule.why)).toBe('string')
      }
    }
  })

  it('gives every A rule a category', () => {
    for (const rule of A_RISK_RULES as Array<{ category?: string; why: string }>) {
      expect(rule.category, `${rule.why} has no category`).toBeTruthy()
    }
  })

  it('marks an unreadable diff as the unreadable category, not as nothing', () => {
    expect(classifyRisk({ files: [] }).categories).toEqual(['unreadable'])
    expect(classifyRisk({}).categories).toEqual(['unreadable'])
  })
})

describe('the author-declared level is a floor, never a ceiling', () => {
  it('a PR declaring C that touches the kernel is still A', () => {
    const result = classifyRisk({ files: [file('src/lib/kernel/runner.ts')], declaredRisk: 'C' })
    expect(result.risk).toBe('A')
    expect(result.computedRisk).toBe('A')
    expect(result.declaredRisk).toBe('C')
  })

  it('a PR declaring A that only touches docs is treated as A', () => {
    const result = classifyRisk({ files: [file('docs/a.md')], declaredRisk: 'A' })
    expect(result.risk).toBe('A')
    expect(result.computedRisk).toBe('C')
    expect(result.reasons[0]).toContain('取更高的一档')
  })

  it('a nonsense declaration is ignored rather than obeyed', () => {
    const result = classifyRisk({ files: [file('docs/a.md')], declaredRisk: 'Z' })
    expect(result.risk).toBe('C')
    expect(result.declaredRisk).toBeNull()
  })
})

describe('parseDeclaredRisk', () => {
  it('reads the quality-gate template line', () => {
    expect(parseDeclaredRisk('风险级别：B\n判定理由：普通读路径')).toBe('B')
  })

  it('reads the alternate wording and the English form', () => {
    expect(parseDeclaredRisk('风险等级: C')).toBe('C')
    expect(parseDeclaredRisk('Risk Level: a')).toBe('A')
  })

  it('returns null when the PR says nothing', () => {
    expect(parseDeclaredRisk('just a description')).toBeNull()
    expect(parseDeclaredRisk(undefined)).toBeNull()
  })

  it('resolves a body declaring two different levels to A rather than picking one', () => {
    expect(parseDeclaredRisk('风险级别：C\n...\n风险级别：A')).toBe('A')
  })
})

describe('fail closed — "we could not look" must not read like "nothing to see"', () => {
  it('rates A when the file list is missing', () => {
    const result = classifyRisk({})
    expect(result.risk).toBe('A')
    expect(result.readable).toBe(false)
  })

  it('rates A when the file list is not a list', () => {
    const result = classifyRisk({ files: 'oops' })
    expect(result.risk).toBe('A')
    expect(result.readable).toBe(false)
  })

  it('rates A on an empty list — "no files" and "read no files" look identical', () => {
    const result = classifyRisk({ files: [] })
    expect(result.risk).toBe('A')
    expect(result.readable).toBe(false)
  })

  it('rates A when any entry has no filename, even if every other file is docs', () => {
    const result = classifyRisk({ files: [file('docs/a.md'), { additions: 1 }] })
    expect(result.risk).toBe('A')
    expect(result.readable).toBe(false)
  })

  it('never lets the reason cap hide the fact that part of the diff was unreadable', () => {
    // 30 protected files plus one unreadable entry at the very end. Reasons are
    // capped, so a naive append order would push the "we could not read this"
    // line past the cut and publish a confident A rating with no hint that a
    // slice of the diff was never examined at all.
    const many = Array.from({ length: 30 }, (_, i) => file(`src/lib/kernel/f${i}.ts`))
    const result = classifyRisk({ files: [...many, { additions: 1 }] })
    expect(result.readable).toBe(false)
    expect(result.reasons.length).toBeLessThanOrEqual(MAX_REASONS)
    expect(result.reasons[0]).toContain('没有文件名')
  })
})

describe('higherRisk', () => {
  it('picks the more severe of two levels', () => {
    expect(higherRisk('C', 'B')).toBe('B')
    expect(higherRisk('B', 'A')).toBe('A')
    expect(higherRisk('C', 'C')).toBe('C')
  })

  it('treats an unrecognised level as A rather than ignoring it', () => {
    expect(higherRisk('C', 'oops')).toBe('A')
  })
})

describe('automated fix-round budget by level', () => {
  it('is A=2, B=1, C=1 — replacing the flat 3', () => {
    expect(maxRoundsForRisk('A')).toBe(2)
    expect(maxRoundsForRisk('B')).toBe(1)
    expect(maxRoundsForRisk('C')).toBe(1)
  })

  it('gives an unrecognised level the smallest budget, not the largest', () => {
    expect(maxRoundsForRisk('nonsense')).toBe(1)
  })
})
