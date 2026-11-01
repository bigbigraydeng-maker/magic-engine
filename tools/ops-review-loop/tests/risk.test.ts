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
  readDeclaredRisk,
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
  ['src/lib/ledger/parse.ts', 'ledger parser/validator'],
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
  ['src/lib/messaging/provider-events/resend-signature.ts', 'triggered send / provider callback core'],
  // Planned for P2-2b (does not exist yet): the rule must already rate it A when it lands.
  ['src/app/api/u/[token]/route.ts', 'contact unsubscribe entry'],
  ['src/app/api/clients/[id]/triggered-send/authorize/route.ts', 'triggered-send authorize entry'],
  ['src/lib/crm/email-templates/gates/frequency.ts', 'staff-send frequency gate'],
  ['src/lib/crm/email-templates/frequency-sources-prod.ts', 'staff-send frequency sources'],
  ['src/lib/crm/email-templates/send-gates-prod.ts', 'staff-send gate assembly'],
  ['src/lib/crm/manual-send-dnc-gate.ts', 'do-not-contact gate'],
  ['src/lib/meta/guardrails.ts', 'spend guardrail'],
  ['scripts/factory-worker/engines/remotion/catalog/music-vocals.json', 'music vocal registry'],
  ['scripts/factory-worker/music-vocal-gate.mjs', 'music vocal gate'],
  ['scripts/factory-worker/music-vocal-gate.test.mjs', 'music vocal gate test'],
  ['scripts/factory-worker/tools/backfill-music-vocals.mjs', 'music vocal backfill tool'],
  ['scripts/factory-worker/remotion-branch.mjs', 'music vocal gate wiring'],
  ['scripts/factory-worker/worker.mjs', 'music vocal gate wiring'],
  ['scripts/factory-worker/creative-recipe.mjs', 'recipe BGM resolution'],
  ['scripts/factory-worker/remotion-branch.test.mjs', 'music vocal gate wiring test'],
  ['scripts/factory-worker/worker.recipe-sequence.test.mjs', 'recipe gate wiring test'],
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
  ['jest.config.ts', 'jest config'],
  ['postcss.config.js', 'build-time style config'],
  ['.babelrc', 'compiler config'],
  ['docs/playbooks/seo/general.md', 'playbook body'],
]

describe('every protected path rates A', () => {
  it.each(A_PATHS)('%s (%s)', (path) => {
    expect(classifyFile(path).risk).toBe('A')
  })

  it('does not rate unrelated files A: same-folder README, and docs that merely mention the gate', () => {
    expect(classifyFile('scripts/factory-worker/engines/remotion/README.md').risk).toBe('C')
    expect(classifyFile('docs/specs/2026-10-16-music-vocal-gate-design.md').risk).toBe('C')
    expect(classifyFile('docs/ledger/2026-10-16-music-vocal-gate-code-pr.md').risk).toBe('C')
  })

  it('catches filename spelling variants of the vocal gate files inside factory-worker', () => {
    for (const p of ['scripts/factory-worker/music_vocal_gate.mjs', 'scripts/factory-worker/tools/music-vocals.json']) {
      expect(classifyFile(p).risk).toBe('A')
    }
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

describe('A rules match case-insensitively — macOS core.ignorecase bypass (狄仁杰 PR #2153 attack)', () => {
  /**
   * Swap the case of the first alphabetic character in each path segment.
   * Produces the kind of path an attacker would use on a case-insensitive FS:
   *   CLAUDE.md → cLAUDE.md
   *   .github/workflows/x.yml → .Github/Workflows/X.yml
   */
  function mixCase(path: string): string {
    return path
      .split('/')
      .map((seg) => {
        for (let i = 0; i < seg.length; i++) {
          const c = seg[i]
          if (/[a-zA-Z]/.test(c)) {
            const swapped = c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()
            return seg.slice(0, i) + swapped + seg.slice(i + 1)
          }
        }
        return seg
      })
      .join('/')
  }

  it('mixCase actually changes every A_PATHS entry (the test is not vacuous)', () => {
    const unchanged = A_PATHS.filter(([path]) => mixCase(path) === path)
    expect(unchanged.map(([p]) => p)).toEqual([])
  })

  it.each(A_PATHS.map(([path, label]) => [mixCase(path), path, label] as const))(
    '%s (from %s, %s) still rates A',
    (mixed) => {
      expect(classifyFile(mixed).risk).toBe('A')
    },
  )

  it('the specific attack paths from 狄仁杰 all rate A', () => {
    const attacks = [
      'claude.md',
      '.Claude/skills/x/SKILL.md',
      '.GitHub/merge-authorization.md',
      'docs/ENGINEERING_quality_gates.md',
      'docs/Agents/13-kongzi.md', // .claude/ prefix won't match, but docs/ + .md → C, not A; this tests the next block
    ]
    // The first four are governance files that must rate A
    for (const p of attacks.slice(0, 4)) {
      expect(classifyFile(p).risk).toBe('A')
    }
  })

  it('a case-variant rename of a protected path still rates A', () => {
    const result = classifyRisk({
      files: [
        {
          filename: 'docs/old.md',
          previous_filename: '.Github/Workflows/guard.yml',
          status: 'renamed',
        },
      ],
    })
    expect(result.risk).toBe('A')
    expect(result.categories).toContain('control-plane')
  })

  it('a full-PR classifyRisk with attack paths rates A', () => {
    const result = classifyRisk({
      files: [
        { filename: 'claude.md' },
        { filename: '.Claude/skills/x/SKILL.md' },
        { filename: '.GitHub/merge-authorization.md' },
        { filename: 'docs/ENGINEERING_quality_gates.md' },
      ],
    })
    expect(result.risk).toBe('A')
    expect(result.categories).toContain('governance')
  })
})

describe('case-insensitive A matching does not change B/C classifications', () => {
  it.each([
    'docs/STATE.md',
    'README.md',
    'src/app/globals.css',
    'public/logo.svg',
    'src/lib/foo/bar.test.ts',
    'src/lib/foo/__tests__/bar.ts',
    'docs/anything',
    'notes.txt',
    'src/styles/theme.scss',
    'public/hero.png',
    'public/hero.jpg',
    'src/app/favicon.ico',
    'docs/agents/ziya.md',
    'docs/specs/anything.md',
    'docs/ledger/2026-09-25-some-card.md',
  ])('%s stays C', (path) => {
    expect(classifyFile(path).risk).toBe('C')
  })

  it.each([
    'src/lib/reports/build-summary.ts',
    'src/app/(dashboard)/page.tsx',
    'scripts/one-off.mjs',
    'src/lib/geo/score.ts',
    'src/lib/config/env.ts',
    'src/lib/utils/urls.ts',
    'src/components/controls.ts',
    '.env.example',
  ])('%s stays B', (path) => {
    expect(classifyFile(path).risk).toBe('B')
  })

  it('README.MD (uppercase extension) stays B, not C — C rules are case-sensitive', () => {
    expect(classifyFile('README.MD').risk).toBe('B')
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

describe('playbook governance rules', () => {
  it('rates playbook body files A', () => {
    expect(classifyFile('docs/playbooks/seo/general.md').risk).toBe('A')
    expect(classifyFile('docs/playbooks/ads/industry-travel.md').risk).toBe('A')
    expect(classifyFile('docs/playbooks/geo/industry-realestate.md').risk).toBe('A')
    expect(classifyFile('docs/playbooks/reputation/general.md').risk).toBe('A')
    expect(classifyFile('docs/playbooks/social/general.md').risk).toBe('A')
  })

  it('rates the bare docs/playbooks path A (symlink defence)', () => {
    expect(classifyFile('docs/playbooks').risk).toBe('A')
  })

  it('is case-insensitive (macOS defence)', () => {
    expect(classifyFile('docs/Playbooks/seo/general.md').risk).toBe('A')
  })

  it('excludes one-level-deep inbox.md from A (falls to C via docs/ prefix)', () => {
    expect(classifyFile('docs/playbooks/seo/inbox.md').risk).toBe('C')
    expect(classifyFile('docs/playbooks/ads/inbox.md').risk).toBe('C')
  })

  it('catches deeper inbox.md as A (only pillar/inbox.md is excluded)', () => {
    expect(classifyFile('docs/playbooks/seo/sub/inbox.md').risk).toBe('A')
  })

  it('rates a rename from general.md to inbox.md as A (original path is protected)', () => {
    const result = classifyRisk({
      files: [{ filename: 'docs/playbooks/seo/inbox.md', status: 'renamed', previous_filename: 'docs/playbooks/seo/general.md' }],
    })
    expect(result.risk).toBe('A')
  })

  it('rates an inbox-only PR as C (auto-merge)', () => {
    const result = classifyRisk({
      files: [{ filename: 'docs/playbooks/seo/inbox.md', status: 'modified' }],
    })
    expect(result.risk).toBe('C')
  })

  it('does not affect docs/specs/ or docs/agents/ (still C)', () => {
    expect(classifyFile('docs/specs/2026-09-28-design.md').risk).toBe('C')
    expect(classifyFile('docs/agents/13-kongzi.md').risk).toBe('C')
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
    // 构建控制 2026-09-27, folded into the declared-risk PR
    ['postcss.config.js', 'build-runtime'],
    ['tailwind.config.ts', 'build-runtime'],
    ['.babelrc', 'build-runtime'],
    ['babel.config.js', 'build-runtime'],
    ['.swcrc', 'build-runtime'],
    ['.postcssrc', 'build-runtime'],
    ['.postcssrc.json', 'build-runtime'],
    ['jest.config.ts', 'control-plane'],
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

/**
 * Incident 2026-09-26: #2061 and #2075 declared A in their bodies, the old
 * parser could not read either spelling, both rated B from their files and
 * auto-merged unreviewed. Every spelling below is copied from a real PR body
 * (小秘书 swept 60 open PRs; 子牙 checked; 构建控制 swept 39 merged ones).
 */
describe('readDeclaredRisk — the spellings real PR bodies use', () => {
  it.each([
    ['风险级：A', '#2061 — 少了「别」'],
    ['## 风险级\n\n**A 级**（车道本身）', '#2075 — heading, blank line, bold level'],
    ['## 风险级\nA（自动开发车道）', 'heading, level on the next line'],
    ['**风险级：A**', '#1703 / #1932 — whole line bold'],
    ['风险级：**A**', '#1934 — bold after the colon'],
    ['Risk: A (auth)', '#2027 — no "level"'],
    ['风险级别：A（控制面）', 'bracketed note'],
    ['## 风险级别：A（自报，Risk gate 以机器为准）', 'as a heading'],
    ['**风险级：A（Risk gate 判定）**', 'bold with a note that mentions Risk'],
    ['## 风险级：A（…）', 'short label as a heading'],
    ['| 风险级别 | A |', 'table row'],
    ['- 风险等级：A 级', 'list item with 级'],
    // #2121 review round 1 — W121-1: no colon, natural joining words
    ['风险级别为 A', 'W121-1 为'],
    ['风险级别是 A 级', 'W121-1 是'],
    ['风险级别 = A', 'W121-1 ='],
    ['风险级别 → A', 'W121-1 →'],
    ['Risk level is A', 'W121-1 English is'],
    ['## 风险级别（自报）\nA（控制面）', 'W121-1 heading with a tail, level on the next line'],
    ['## 风险级说明\n\n**A 级**', 'W121-1 heading 风险级说明'],
    // DR121-1: weak labels with a standalone capital level
    ['风险分级：A 级', 'DR121-1 #1730 / #1734'],
    ['风险 **A 级**', 'DR121-1 #1979 / #1843'],
    // DR121-2: brackets and punctuation around the declaration (old parser read these)
    ['（风险级别：A）', 'DR121-2 full-width brackets'],
    ['「风险级别：A」', 'DR121-2 corner quotes'],
    ['风险级别：A、控制面', 'DR121-2 enumeration comma'],
  ])('%j reads as A (%s)', (body) => {
    expect(readDeclaredRisk(body)).toEqual({ risk: 'A', unreadable: null })
  })

  it.each([
    ['**风险级别：A**', 'A'],
    ['风险级别：A', 'A'],
    ['风险级别：B\n判定理由：普通读路径', 'B'],
    ['风险等级: C', 'C'],
    ['Risk Level: a', 'A'],
  ])('%j — already readable before the fix, still %s', (body, level) => {
    expect(parseDeclaredRisk(body)).toBe(level)
  })

  it.each([
    '本 PR 非 A 级改动',
    '这不是 A 级',
    'A/B/C 分级说明见 docs/ENGINEERING_QUALITY_GATES.md',
    '风险分级：见下表',
    '风险级别只作下限，不作上限',
    'Risk: low, docs only',
    'high-risk area touched? no',
    'asterisk: A marks the footnotes',
    // DR121-5: bare risk / 风险 needs a standalone CAPITAL level
    'Risk: a stale cache',
    'this reduces the risk a lot',
    '风险评估：A 方案更稳',
    '风险：A/B 两种都有',
    '<!-- 风险级别：C -->',
  ])('%j is not a declaration', (body) => {
    expect(readDeclaredRisk(body)).toEqual({ risk: null, unreadable: null })
  })

  // Fail closed on the NEXT unforeseen spelling instead of repeating the incident.
  it.each([
    ['风险级别：见下表', '风险级别：见下表'],
    ['风险级：B/C 之间', '风险级：B/C 之间'],
    ['## 风险级\n本 PR 属于 B 级', '风险级'],
    ['## 风险级别', '风险级别'],
    ['风险等级：高', '风险等级：高'],
  ])('%j is a declaration that cannot be read → A, and says which line', (body, quoted) => {
    expect(readDeclaredRisk(body)).toEqual({ risk: 'A', unreadable: quoted })
  })

  it('still resolves two different levels to A', () => {
    expect(parseDeclaredRisk('风险级：C\n…\n**风险级别：A**')).toBe('A')
    expect(parseDeclaredRisk('Risk: B\n## 风险级\nC')).toBe('A')
  })

  // #2121 round 2 (子牙): the ads windows' heading carries a tail and the next
  // line declares with its own label. Verbatim from #2043 / #2033 / #2032 —
  // all declared B and must not be pushed to A.
  it.each([
    ['#2043', '## 风险级 / 优先级\n- 风险 **B**（改扣费记账逻辑，不改表结构、不改额度上限与预留金额）\n- 按 §11：频率 中'],
    ['#2033', '## 风险级别 / 优先级\n- 风险：**B**（只读规则、不碰钱、不写 Meta；不进 D3 自动暂停）\n- 按 §11：频率 高'],
    ['#2032', '## 风险级别 / 优先级\n\n- 风险：**B**（只读规则、不碰钱、不写 Meta）'],
  ])('%s: a tailed heading whose next line declares B reads as B', (_pr, body) => {
    expect(readDeclaredRisk(body)).toEqual({ risk: 'B', unreadable: null })
  })

  it('a tailed heading followed by prose with no level is still unreadable → A', () => {
    expect(readDeclaredRisk('## 风险级别 / 优先级\n- 按 §11：频率 高 → P0')).toEqual({
      risk: 'A',
      unreadable: '风险级别 / 优先级',
    })
  })

  it('a strong label with a lower-case letter still rates A — as unreadable', () => {
    expect(readDeclaredRisk('Risk Level: a')).toEqual({ risk: 'A', unreadable: 'Risk Level: a' })
  })

  it('treats non-strings as no declaration', () => {
    expect(readDeclaredRisk(undefined)).toEqual({ risk: null, unreadable: null })
    expect(readDeclaredRisk(null)).toEqual({ risk: null, unreadable: null })
  })
})

describe('an unreadable declaration is reported as such, not as "自报 A"', () => {
  it('names the unreadable line and the fix', () => {
    const declared = readDeclaredRisk('风险级别：见下表')
    const result = classifyRisk({
      files: [file('src/lib/geo/score.ts')],
      declaredRisk: declared.risk,
      declaredUnreadable: declared.unreadable,
    })
    expect(result.risk).toBe('A')
    expect(result.computedRisk).toBe('B')
    expect(result.reasons[0]).toBe(
      'PR 正文写了风险级但读不懂（`风险级别：见下表`）—— 按 A 处理；本意是 B/C 就写 `风险级别：B`（或 C），改完会自动重判',
    )
  })

  it('keeps the plain wording for a readable declaration', () => {
    const result = classifyRisk({ files: [file('src/lib/geo/score.ts')], declaredRisk: 'A' })
    expect(result.reasons[0]).toContain('PR 自报 A 级')
  })

  it('the #2075 body now rates its scripts/auto-dev diff A', () => {
    const declared = readDeclaredRisk('## 目标\n自动开发车道\n\n## 风险级\n\n**A 级**（车道本身是控制面）\n')
    expect(classifyRisk({ files: [file('scripts/auto-dev/pick.mjs')], declaredRisk: declared.risk }).risk).toBe('A')
  })
})

describe('the unreadable-line quote is safe to post (W121-2)', () => {
  it('wraps the line in a code span, so @mentions and <!-- stay inert', () => {
    const declared = readDeclaredRisk('风险级别：@ziya 看一下 <!-- 然后')
    const result = classifyRisk({
      files: [file('src/lib/geo/score.ts')],
      declaredRisk: declared.risk,
      declaredUnreadable: declared.unreadable,
    })
    expect(result.reasons[0]).toContain('（`风险级别：@ziya 看一下`）')
  })

  it('drops backticks from the quoted line so the code span cannot be closed early', () => {
    const result = classifyRisk({ files: [file('src/lib/geo/score.ts')], declaredRisk: 'A', declaredUnreadable: 'a`b' })
    expect(result.reasons[0]).toContain('（`ab`）')
  })
})

/**
 * DR121-3: `\s*[:：|]?\s*` after a label backtracked quadratically — a 64 KB
 * body took 4–8 s inside a required check. The letters that come back do not
 * change when that happens, so the cases below only check the parsed level.
 * The next block checks the speed.
 */
describe('readDeclaredRisk finishes hostile 64 KB bodies (DR121-3)', () => {
  const KB64 = 64 * 1024
  it.each([
    ['label then blanks', `风险级别${' '.repeat(KB64)}x`, null, null],
    ['label then colons and blanks', `风险级别${' ：'.repeat(KB64 / 2)}x`, 'A', '风险级别'],
    ['many label lines', '风险级别\n'.repeat(KB64 / 5), 'A', '风险级别'],
    ['many headings', '## 风险级\n\n'.repeat(KB64 / 8), 'A', '风险级'],
    ['blanks inside a line', `a${' '.repeat(KB64)}b`, null, null],
    ['pipes and blanks', `| ${' |'.repeat(KB64 / 2)} x`, null, null],
    ['unclosed comments', '<!--'.repeat(KB64 / 4), null, null],
    ['bold marks', '*'.repeat(KB64), null, null],
    ['weak labels', '风险 '.repeat(KB64 / 3), null, null],
    ['is is is', `Risk level${' is'.repeat(KB64 / 3)} x`, 'A', 'Risk level'],
  ])('%s', (_label, body, risk, unreadablePrefix) => {
    const result = readDeclaredRisk(body)
    expect(result.risk).toBe(risk)
    if (unreadablePrefix === null) {
      expect(result.unreadable).toBeNull()
    } else {
      expect(result.unreadable?.startsWith(unreadablePrefix)).toBe(true)
      expect(result.unreadable?.length).toBeLessThanOrEqual(60)
    }
  })
})

/**
 * Same bug as above. Four times the blanks is about four times the time when
 * the scan is linear, and about sixteen times when `\s*[:：|]?\s*` is back.
 * Eight times still passes a noisy 1-core runner (a 300 ms ceiling failed
 * there at 323–531 ms). 3000 ms catches a 4–8 s sample whose smaller run is
 * slow as well.
 */
describe('readDeclaredRisk stays near-linear on a long blank run (DR121-3)', () => {
  function blanks(bytes: number): string {
    return `风险级别${' '.repeat(bytes)}x`
  }

  function once(body: string): number {
    const start = performance.now()
    readDeclaredRisk(body)
    return performance.now() - start
  }

  function median(body: string, runs: number): number {
    const samples = Array.from({ length: runs }, () => once(body)).sort((a, b) => a - b)
    return samples[Math.floor(runs / 2)]
  }

  it('64 KB of blanks stays near 4× the 16 KB time, not the old 16×', () => {
    const small = median(blanks(16 * 1024), 3)
    const large = once(blanks(64 * 1024))
    expect(large).toBeLessThan(small * 8 + 50)
    expect(large).toBeLessThan(3000)
  }, 20_000)
})

describe('auth edits outside the auth directories rate A (#3123)', () => {
  const visual = 'src/app/api/visual/video/route.ts'

  it('rates a route that adds a client-access check as A', () => {
    const patch = [
      '@@ -1,6 +1,7 @@',
      " import { submitVideoGeneration } from '@/lib/visual/seedance'",
      "+import { requireDashboardClientAccess } from '@/lib/auth/client-access'",
      '@@ -13,6 +14,10 @@',
      '+    const access = await requireDashboardClientAccess(client_id)',
      '+    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })',
    ].join('\n')
    const result = classifyRisk({ files: [{ filename: visual, status: 'modified', patch }] })
    expect(result.risk).toBe('A')
    expect(result.categories).toContain('auth-isolation')
    expect(result.reasons.some((reason) => reason.includes('鉴权或客户访问校验'))).toBe(true)
  })

  it('rates an added requireSession call as A, including when the check is removed', () => {
    const added = classifyRisk({
      files: [{
        filename: 'src/app/api/visual/queue/route.ts',
        patch: '+  const session = await requireSession()\n+  if (!session.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })\n',
      }],
    })
    expect(added.risk).toBe('A')
    const removed = classifyRisk({
      files: [{
        filename: 'src/app/api/visual/queue/route.ts',
        patch: '-  const session = await requireSession()\n',
      }],
    })
    expect(removed.risk).toBe('A')
  })

  it('rates a swap of which access check is called as A', () => {
    const patch = [
      "-import { requirePaidClientAccess } from '@/lib/auth/client-access'",
      "+import { requirePlanApproverAccess } from '@/lib/auth/client-access'",
      '-  const access = await requirePaidClientAccess(params.id)',
      '+  const access = await requirePlanApproverAccess(params.id)',
    ].join('\n')
    const result = classifyRisk({
      files: [{ filename: 'src/app/api/clients/[id]/ad-health/execute-prescription/route.ts', patch }],
    })
    expect(result.risk).toBe('A')
  })

  it('leaves a business edit on the same route at B when the diff does not touch the check', () => {
    const patch = '@@ -1 +1 @@\n-    return NextResponse.json({ error: msg }, { status: 500 })\n+    return NextResponse.json({ error: "fail" }, { status: 500 })\n'
    const result = classifyRisk({ files: [{ filename: visual, patch }] })
    expect(result.risk).toBe('B')
    expect(result.categories).not.toContain('auth-isolation')
  })

  it('does not treat a comment that merely names the helper as an auth change', () => {
    const patch = '+const label = "production" // see requireSession\n'
    expect(classifyRisk({ files: [{ filename: visual, patch }] }).risk).toBe('B')
  })

  it('does not rate a docs mention of the helper as A', () => {
    const result = classifyRisk({
      files: [{ filename: 'docs/notes.md', patch: '+call requireSession() before writing\n' }],
    })
    expect(result.risk).toBe('C')
  })

  it('keeps a path that is already A on its path reason', () => {
    const result = classifyRisk({
      files: [{
        filename: 'src/lib/auth/client-access.ts',
        patch: '+  const access = await requireDashboardClientAccess(clientId)\n',
      }],
    })
    expect(result.risk).toBe('A')
    expect(result.reasons.some((reason) => reason.includes('鉴权与客户访问边界'))).toBe(true)
    expect(result.reasons.some((reason) => reason.includes('改动行碰到鉴权'))).toBe(false)
  })

  it('rates A when GitHub omitted the patch of a source file that actually changed', () => {
    const result = classifyRisk({
      files: [{
        filename: 'src/app/api/visual/video/route.ts',
        status: 'modified',
        additions: 2000,
        deletions: 2000,
        changes: 4000,
      }],
    })
    expect(result.risk).toBe('A')
    expect(result.categories).toContain('auth-isolation')
    expect(result.reasons.some((reason) => reason.includes('diff 读不到，没法判断是否改了鉴权'))).toBe(true)
  })

  it('does not treat a pure rename, or an entry with no line count, as an unreadable auth diff', () => {
    const renamed = classifyRisk({
      files: [{
        filename: 'src/lib/geo/score.ts',
        previous_filename: 'src/lib/geo/old-score.ts',
        status: 'renamed',
        changes: 0,
        additions: 0,
        deletions: 0,
      }],
    })
    expect(renamed.risk).toBe('B')
    expect(renamed.reasons.some((reason) => reason.includes('diff 读不到'))).toBe(false)

    const pathOnly = classifyRisk({ files: [{ filename: 'src/lib/geo/score.ts', status: 'modified' }] })
    expect(pathOnly.risk).toBe('B')
  })
})
