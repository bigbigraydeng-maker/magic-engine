/**
 * WP06 架构守卫（Issue #878）——单独这一份，同时扫两个批准目录：
 *   · `src/lib/page-optimization/`（provider-neutral，non-write）
 *   · `src/lib/capabilities/page-optimization/`（snapshot 的 provider 侧只读）
 *
 * 按 2026-08-11 Build Control Room 实施指令：「The single architecture test
 * may scan both approved directories; do not add a second architecture-test
 * file.」——所以不建第二份，两套判据都写在这一个文件里。
 *
 * 判据写在本文件内，不为测试单独建生产侧边界清单（镜像
 * `src/lib/growth/__tests__/architecture.test.ts` 的做法）。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const CORE_DIR = join(ROOT, 'src/lib/page-optimization')
const CAP_DIR = join(ROOT, 'src/lib/capabilities/page-optimization')

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * 扫描前去掉注释——不去的话，解释规则本身的注释会被当成违规
 * （kernel 的架构测试踩过这个坑，growth 的也提前避开了）。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')
}

const relOf = (f: string): string => relative(ROOT, f).split('\\').join('/')
const isTest = (f: string): boolean => f.endsWith('.test.ts') || f.includes('/__tests__/')

const CORE_FILES = walk(CORE_DIR).map(relOf).filter((f) => !isTest(f))
const CAP_FILES = walk(CAP_DIR).map(relOf).filter((f) => !isTest(f))

const sourceOf = (file: string): string => stripComments(readFileSync(join(ROOT, file), 'utf8'))

function findModuleImportViolations(files: readonly string[], forbiddenModules: readonly string[]): string[] {
  const violations: string[] = []
  for (const file of files) {
    const src = sourceOf(file)
    for (const mod of forbiddenModules) {
      const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`from\\s+['"]${escaped}(['"/])`).test(src)) {
        violations.push(`${file} → ${mod}`)
      }
    }
  }
  return violations
}

function findApplyPublishExports(files: readonly string[]): string[] {
  const pattern = /export\s+(async\s+)?function\s+\w*(apply|publish)\w*/i
  return files.filter((f) => pattern.test(sourceOf(f)))
}

// ── src/lib/page-optimization/ ────────────────────────────────────────────

describe('WP06 · page-optimization 是 provider-neutral 的 non-write 核心', () => {
  it('目录里确实有生产文件（防止判据因为路径写错而空跑）', () => {
    expect(CORE_FILES.length).toBeGreaterThan(0)
  })

  it('不 import Kernel / execution / 数据库直连 / 任何 provider 客户端', () => {
    const forbidden = [
      '@/lib/kernel',
      '@/lib/execution',
      '@/lib/capabilities',
      '@/lib/supabase',
      '@supabase/supabase-js',
      '@/lib/publer/client',
      '@/lib/cms/wordpress-client',
      '@/lib/cms/shopify-client',
      '@/lib/cms/github-client',
      '@/lib/cms/blog-publisher',
      '@/lib/cms/github-page-upgrade-publisher',
      '@/lib/cms/meta-patcher',
      '@/lib/gbp/publisher',
      '@/lib/gsc/indexing-client',
      '@/lib/gsc/sitemap-ping',
    ]
    const violations = findModuleImportViolations(CORE_FILES, forbidden)
    expect(
      violations,
      'page-optimization/ 必须是 provider-neutral 的——它的一切改动都要能路由到' +
        '不同 provider。一旦这里出现 provider 客户端 import，抽象层就漏了。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('不导出任何 apply / publish 命名的函数', () => {
    const violations = findApplyPublishExports(CORE_FILES)
    expect(
      violations,
      'WP06 是 non-write 的准备阶段。apply/rollback 只能经 Kernel/Gateway 在' +
        '授权之后执行（WP07 的边界）——这里不该有同名导出。\n' +
        violations.join('\n'),
    ).toEqual([])
  })
})

// ── src/lib/capabilities/page-optimization/ ───────────────────────────────

describe('WP06 · capabilities/page-optimization 的 provider 侧读取只做只读操作', () => {
  it('目录里确实有生产文件', () => {
    expect(CAP_FILES.length).toBeGreaterThan(0)
  })

  it('不 import Kernel / execution / 数据库直连 / 任何只写模块', () => {
    // 允许 import github-client / wordpress-client（用它们的读方法）——
    // 这正是 snapshot 存在的理由。其余 provider-write 模块与 Kernel/execution/
    // 数据库直连一律禁止。
    const forbidden = [
      '@/lib/kernel',
      '@/lib/execution',
      '@/lib/supabase',
      '@supabase/supabase-js',
      '@/lib/publer/client',
      '@/lib/cms/shopify-client',
      '@/lib/cms/blog-publisher',
      '@/lib/cms/github-page-upgrade-publisher',
      '@/lib/cms/meta-patcher',
      '@/lib/gbp/publisher',
      '@/lib/gsc/indexing-client',
      '@/lib/gsc/sitemap-ping',
    ]
    const violations = findModuleImportViolations(CAP_FILES, forbidden)
    expect(
      violations,
      'snapshot 只允许读——不许拉入任何只写模块，也不许直连数据库或 Kernel。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('不调用 GithubClient / WordPress 客户端的任何写方法', () => {
    const forbiddenCalls = [
      /\.createBranch\s*\(/,
      /\.commitFile\s*\(/,
      /\.createPullRequest\s*\(/,
      /\.closePullRequest\s*\(/,
      /\.deleteBranch\s*\(/,
      /\bpublishWordpressPost\s*\(/,
      /\bpublishWordpressPage\s*\(/,
      /\bcreateWordpressPostDraft\s*\(/,
      /\bcreateWordpressPageDraft\s*\(/,
      /\bupdateExistingWordpressPost\s*\(/,
      /\bdeleteWordpressPost\s*\(/,
      /\bdeleteWordpressPage\s*\(/,
    ]
    const violations: string[] = []
    for (const file of CAP_FILES) {
      const src = sourceOf(file)
      for (const pattern of forbiddenCalls) {
        if (pattern.test(src)) violations.push(`${file} → ${pattern}`)
      }
    }
    expect(
      violations,
      '2026-08-11 实施指令第 5 条：read-only GitHub/WordPress snapshot calls ' +
        'and pure drafting are the only operations. 出现写方法调用就是越界。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('不导出任何 apply / publish 命名的函数', () => {
    const violations = findApplyPublishExports(CAP_FILES)
    expect(violations).toEqual([])
  })
})
