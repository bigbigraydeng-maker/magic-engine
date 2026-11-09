/**
 * 台账层的架构守卫（Issue #930）。
 *
 * 🔴 授权边界不能只靠 code review：一旦有人在这一层抓住 `supabaseAdmin`、
 *    把 crawler 那套「剥 www + 前缀比较」借回来、或者塞一个 route / cron 入口，
 *    「精确主机边界」「注入而不是抓取」「本 PR 不开生产入口」三条就同时破了 ——
 *    而这种改动在 diff 里长得很无辜。
 *
 * 仿 `src/lib/geo-baseline/__tests__/architecture.test.ts` 的写法。
 */

import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const DIR = join(ROOT, 'src/lib/site-audit/canonical-inventory')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/** 按文件后缀选 ScriptKind —— .tsx/.jsx 必须按 JSX 解析，否则 JsxText 保护无从谈起（Issue #923）。 */
const scriptKindFor = (fileName: string): ts.ScriptKind =>
  fileName.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : fileName.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : /\.(js|mjs|cjs)$/.test(fileName)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS

const parseSource = (code: string, fileName = 'scan.ts'): ts.SourceFile =>
  // setParentNodes = false：只按位置取注释、按节点类型取说明符，用不上父指针。
  ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false, scriptKindFor(fileName))

function stripComments(src: string, fileName = 'scan.ts'): string {
  const sourceFile = parseSource(src, fileName)
  const ranges = new Map<string, ts.CommentRange>()
  // JSX 文本区间：起点落在这里面的「注释」是假的，见上面 Issue #923 那段
  const jsxTextSpans: Array<{ pos: number; end: number }> = []

  // `node.pos` 就是含前导 trivia 的起点（= getFullStart()），不需要父指针
  const collectLeadingAt = (pos: number): void => {
    for (const r of ts.getLeadingCommentRanges(src, pos) ?? []) {
      ranges.set(`${r.pos}:${r.end}`, r)
    }
  }
  // `node.end` 是节点的结束位置 —— 同一行内紧跟在它后面的注释算它的 trailing trivia
  const collectTrailingAt = (pos: number): void => {
    for (const r of ts.getTrailingCommentRanges(src, pos) ?? []) {
      ranges.set(`${r.pos}:${r.end}`, r)
    }
  }
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JsxText) jsxTextSpans.push({ pos: node.pos, end: node.end })
    collectLeadingAt(node.pos)
    collectTrailingAt(node.end)
    // 🔴 必须走 getChildren()（token 级），不是 forEachChild（只给子**节点**）。
    //    JSX 表达式里的注释 `<div>{/* … */}</div>` 挂在 `}` 这个 **token** 的
    //    前导 trivia 上 —— JsxExpression 没有子节点，forEachChild 一个都不给，
    //    于是整段注释原样留下，后面仍用正则的检查会把它当成生产代码。
    //    同理还有块尾 `}` 之前那种独占一行的注释。
    for (const child of node.getChildren(sourceFile)) visit(child)
  }
  visit(sourceFile)
  // 文件末尾那条注释是 EOF token 的前导 trivia，不挂在任何其它节点上
  collectLeadingAt(sourceFile.endOfFileToken.pos)

  // 起点落在 JSX 文本里 = 这段「注释」其实是页面上的字面文本，不许挖（Issue #923）
  const startsInsideJsxText = (pos: number): boolean =>
    jsxTextSpans.some((span) => pos >= span.pos && pos < span.end)

  const chars = src.split('')
  // 用 forEach 而不是 `for…of ranges.values()`：直接迭代 Map 的迭代器需要
  // tsconfig 的 target 够高（否则撞 TS2802），forEach 不挑 target，更稳。
  ranges.forEach((r) => {
    if (startsInsideJsxText(r.pos)) return
    for (let i = r.pos; i < r.end && i < chars.length; i++) {
      if (chars[i] !== '\n') chars[i] = ' '
    }
  })
  return chars.join('')
}

const PRODUCTION_FILES = walk(DIR)
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !f.includes('/__tests__/') && !f.endsWith('.test.ts'))

const sourceOf = (file: string): string => stripComments(readFileSync(join(ROOT, file), 'utf8'))

/**
 * 客户专属字样。
 *
 * 🔴 只查**生产文件**。测试里故意留了 #930 授权点名的那个主机对（裸域 vs www），
 *    因为授权要求的证明就是那一条；但生产代码里出现任何客户字面量，
 *    就等于把这层做成了「某个客户的能力」，那是授权明确禁止的。
 */
const CLIENT_SPECIFIC = /romanhu|roman-hu|ray\s*white|mission\s*bay/i

describe('台账层的边界', () => {
  it('目录里确实有生产文件（防止判据因路径写错而空跑）', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0)
    expect(PRODUCTION_FILES).toContain('src/lib/site-audit/canonical-inventory/activation.ts')
  })

  it('绝不自己抓 service-role 客户端 —— 落库口一律注入', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /from\s+['"]@\/lib\/supabase['"]/.test(sourceOf(f)))
    expect(offenders, `这些文件自己抓了 supabaseAdmin：\n${offenders.join('\n')}`).toEqual([])
  })

  it('🔴 不直接碰 client_site_pages —— 写入只能经过注入的 store', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /client_site_pages/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('不 import 执行内核 / 能力层 / 飞轮 / 执行队列（依赖方向）', () => {
    const forbidden = ['@/lib/kernel', '@/lib/execution', '@/lib/capabilities', '@/lib/flywheel', '@/lib/zhuge']
    const violations: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const spec of forbidden) {
        if (new RegExp(`from\\s+['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(src)) {
          violations.push(`${file} → ${spec}`)
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('🔴 不复用 seo-patrol 的 canonicalUrl —— 那个故意合并 bare/www，目标相反', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /seo-patrol/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('🔴 不把 crawler 的「剥 www」宽松同源判定借进来', () => {
    const offenders: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      // 生产代码里不该出现 www 字面量（批准清单由调用方给），也不该有剥 www 的正则。
      if (/www\\?\./.test(src)) offenders.push(`${file} → 出现了 www 字面量`)
      if (/replace\([^)]*www/.test(src)) offenders.push(`${file} → 剥 www 的 replace`)
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('🔴 主机判定不许用 startsWith / includes —— 只能是精确相等', () => {
    const rules = sourceOf('src/lib/site-audit/canonical-inventory/url-rules.ts')
    expect(rules).not.toMatch(/hostname[^\n]*\.startsWith\(/)
    expect(rules).toMatch(/approved === host/)
  })

  it('不暴露生产入口（没有 route.ts / cron 文件）', () => {
    const files = walk(DIR).map((f) => relative(ROOT, f))
    const entrypoints = files.filter((f) => /route\.ts$|cron/i.test(f))
    expect(entrypoints, `本 PR 不开生产入口：\n${entrypoints.join('\n')}`).toEqual([])
  })

  it('🔴 本 PR 不提供落库实现 —— 代码里没有任何路径能写到生产台账', () => {
    // store 只有接口与假件；出现一个真实实现（import supabase 类型并实现该接口）就要停下来重新授权。
    const offenders = PRODUCTION_FILES.filter((f) => /implements\s+CanonicalInventoryStore/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('生产文件里没有任何客户专属字样（不是「某个客户的能力」）', () => {
    const offenders = PRODUCTION_FILES.filter((f) => CLIENT_SPECIFIC.test(readFileSync(join(ROOT, f), 'utf8')))
    expect(offenders, `这些文件里有客户专属字样：\n${offenders.join('\n')}`).toEqual([])
  })

  it('生产文件里没有 UUID 字面量（租户只能从调用方进来）', () => {
    const offenders = PRODUCTION_FILES.filter((f) =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sourceOf(f)),
    )
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('每个函数都 < 50 行（CLAUDE.md 的硬规则，别等复审来提）', () => {
    const offenders: string[] = []
    // 🔴 本 PR 新增/改动的文件全都要盯，不只是本目录 ——
    //    上一版这条守卫只扫了 canonical-inventory/，于是同一批改动里的
    //    page-enrichment.ts 超长又是复审发现的。判据的覆盖面本身也是判据的一部分。
    for (const file of [...PRODUCTION_FILES, 'src/lib/site-audit/page-enrichment.ts']) {
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
      let start = -1
      for (let i = 0; i < lines.length; i++) {
        if (start < 0 && /^(export )?(async )?function /.test(lines[i])) start = i
        else if (start >= 0 && lines[i] === '}') {
          const length = i - start + 1
          if (length >= 50) offenders.push(`${file}:${start + 1} → ${length} 行`)
          start = -1
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('没有 any', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /:\s*any\b|<any>|as\s+any\b/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('本 PR 没有新增 migration（台账用现有表，不加列不加表）', () => {
    const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    const offenders = migrations.filter((f) => /canonical.?inventory/i.test(f))
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

describe('复用而不是重造', () => {
  const adapters = sourceOf('src/lib/site-audit/canonical-inventory/adapters.ts')

  it('发现 / 抓取用现有 crawler，不另起一套', () => {
    expect(adapters).toMatch(/from '\.\.\/crawler'/)
    expect(adapters).toMatch(/discoverSitemapUrls/)
    expect(adapters).toMatch(/crawlPages/)
  })

  it('分类 / GEO 检测走抽出来的 page-enrichment（背后仍是现有 classifier + geo-detector）', () => {
    expect(adapters).toMatch(/from '\.\.\/page-enrichment'/)
    const enrichment = sourceOf('src/lib/site-audit/page-enrichment.ts')
    expect(enrichment).toMatch(/from '\.\/classifier'/)
    expect(enrichment).toMatch(/from '\.\/geo-detector'/)
  })

  it('台账层自己不实现抓取 —— 没有 fetch / jina 调用', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /\bfetch\(|jina/i.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
