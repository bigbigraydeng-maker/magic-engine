/**
 * Regression guard for 客户数据红线 #1121: a customer name/UUID hard-coded
 * into shared runtime source is a data-protection incident, not a style
 * nit — anyone with repo access reads it, no database access required.
 *
 * This scans `src/lib/` and `src/app/api/` (excluding tests/fixtures, which
 * are explicitly allowed to use these values as placeholders) for the two
 * literals #1121 reported: the CTS client UUID and the CTS brand name. Any
 * future PR that reintroduces either — directly or via a new customer-named
 * module — fails this test instead of shipping silently.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SCANNED_DIRS = ['src/lib', 'src/app/api']

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']
const isSource = (p: string) => SOURCE_EXTENSIONS.some((ext) => p.endsWith(ext))
const isTest = (p: string) =>
  SOURCE_EXTENSIONS.some((ext) => p.endsWith(`.test${ext}`)) || p.includes('/__tests__/')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      walk(full, out)
    } else if (isSource(entry)) {
      out.push(full)
    }
  }
  return out
}

const ALL_FILES = SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d)))
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !isTest(f))

/** The two literals #1121 reported live in production source. */
const FORBIDDEN_LITERALS: ReadonlyArray<{ literal: string; label: string }> = [
  { literal: 'c0000000-0000-0000-0000-000000000000', label: 'CTS client UUID' },
  { literal: 'CTS Tours NZ', label: 'CTS brand name' },
]

/**
 * Pre-existing occurrences OUTSIDE the four points #1121 reported, found
 * while writing this guard. Deliberately NOT touched by this PR — the
 * authorised scope here is exactly the four reported points, and rewriting
 * unrelated files would be exactly the "grep guard triggers a bigger
 * cleanup" scope creep Build Control explicitly ruled out.
 *
 * 🔴 Only shrink this list (fix-and-remove), never grow it to cover a NEW
 *    hard-coded customer fact. `src/app/api/diagnostic/*` in particular
 *    looks like the same class of unauthenticated debug route as
 *    `/api/diagnose` (owned by #1233) — flagged to PM as a follow-up, not
 *    fixed here to avoid file-overlap with that PR.
 */
const PRE_EXISTING_OUT_OF_SCOPE = [
  'src/lib/diagnostic/collectors/reputation-collector.ts', // comment + docstring only, not a live constant
  'src/lib/strategy/industry-mapping.ts', // comments only, not a live constant
  'src/lib/todo-reconciliation/fixtures/audited-280.ts', // named/structured as a fixture, not runtime
  'src/app/api/cron/messenger-sync-hourly/route.ts', // comment only, not a live constant
  'src/app/api/diagnostic/verify-brands/route.ts', // unauthenticated debug route, follow-up candidate
  'src/app/api/diagnostic/response/route.ts',
  'src/app/api/diagnostic/results/route.ts',
  'src/app/api/diagnostic/parser-errors/route.ts',
  'src/app/api/diagnostic/details/route.ts',
  'src/app/api/diagnostic/questions/route.ts',
] as const

describe('客户数据红线 #1121 — 客户名/UUID 不许再出现在 src/lib 或 src/app/api 的生产代码里', () => {
  it('扫描器真的扫到了文件（正则/路径写歪不许静默变绿）', () => {
    expect(ALL_FILES.length).toBeGreaterThan(100)
  })

  it('豁免清单里的路径都还在（清单不许留幽灵条目）', () => {
    const missing = PRE_EXISTING_OUT_OF_SCOPE.filter((p) => !ALL_FILES.includes(p))
    expect(missing, `这些豁免路径已经不存在了，把它们从清单里删掉：${missing.join(', ')}`).toEqual([])
  })

  it('两条被点名的客户字面量在生产 source 里（豁免清单之外）一条都不该出现', () => {
    const exempt = new Set<string>(PRE_EXISTING_OUT_OF_SCOPE)
    const offenders: string[] = []
    for (const file of ALL_FILES) {
      if (exempt.has(file)) continue
      const src = readFileSync(join(ROOT, file), 'utf8')
      for (const { literal, label } of FORBIDDEN_LITERALS) {
        if (src.includes(literal)) offenders.push(`${file} → ${label} (${literal})`)
      }
    }
    expect(
      offenders,
      '这些文件把客户名/UUID 焊进了共享 runtime —— 改成读 clients.seo_config 或 ' +
        '环境变量（见 src/lib/seo-meta/repo-meta-executor.ts / src/lib/pm-todo/daily-todo.ts）:\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('客户命名的旧模块 / 路由已经不在了（改名不是留一个死壳）', () => {
    const deadPaths = [
      'src/lib/seo-meta/cts-meta-pr.ts',
      'src/app/api/cron/cts-seo-optimizer/route.ts',
    ]
    const stillThere = deadPaths.filter((p) => ALL_FILES.includes(p))
    expect(stillThere, `这些客户命名的旧文件应该已经改名/删除，却还在：${stillThere.join(', ')}`).toEqual([])
  })
})
