/**
 * GEO Measurement 契约的架构守卫（Issue #876 / WP02）。
 *
 * 🔴 为什么不只靠 code review：这个模块的全部价值就是「它什么都不做」。
 *    一旦有人在这里 import 了执行内核、Kernel、DB 客户端或某个 provider，
 *    契约层就变成了又一条绕过治理的路 —— 而那种改动在 diff 里长得很无辜。
 *
 * 判据写在本文件内，仿 `src/lib/growth/__tests__/architecture.test.ts` 的写法，
 * 刻意不为测试单独建一份生产侧边界清单。
 */

import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'

const ROOT = process.cwd()
const GEO_MEASUREMENT_DIR = join(ROOT, 'src/lib/geo-measurement')

/**
 * 🔴 **扫描面必须盖住「构建真会编译的每一种扩展名」，不是只有 `.ts`。**（Issue #938）
 *
 * 仓库 tsconfig 是 `allowJs: true`。本套守卫原来的 walker 过滤条件是
 * `entry.endsWith('.ts')`，于是本目录下新加一个 `.tsx` / `.js` / `.mjs` 文件
 * **完全不被扫描** —— 它直接违反本套边界也照样全绿，而构建会把这段代码打进去。
 * **扫不到的文件等于没有边界。**
 *
 * 🔴 这份清单原本就已经声明在本文件里（供 `scriptKindFor` 选 ScriptKind 用），
 *    但**声明在 walker 之后、也没参与选文件** —— grep 一眼看过去像已经覆盖八种后缀，
 *    实际扫描面仍只有 `.ts`。这种「看起来修好了」比没修更难发现，所以把声明提到
 *    walker 之前，并让 walker 直接用 `isScannedSource`，两者同源、不可能再各自漂移。
 *
 * 清单依据：用仓库自带 TypeScript 对本仓 `compilerOptions` 求
 * `getSupportedExtensions()`，实测返回 `.ts .tsx .d.ts .js .jsx` / `.cts .d.cts .cjs`
 * / `.mts .d.mts .mjs`，即下面 8 种（`.d.ts` 等以 `.ts` 结尾，天然被包含）。
 * 与 `src/lib/kernel/__tests__/architecture.test.ts` 同一份清单，多一种不加、少一种不漏。
 */
const SOURCE_EXTENSIONS: ReadonlyArray<readonly [ext: string, kind: ts.ScriptKind]> = [
  // 长后缀在前，避免 `.mts` / `.cts` 之类被短后缀先匹配掉
  ['.tsx', ts.ScriptKind.TSX],
  ['.jsx', ts.ScriptKind.JSX],
  ['.mts', ts.ScriptKind.TS],
  ['.cts', ts.ScriptKind.TS],
  ['.mjs', ts.ScriptKind.JS],
  ['.cjs', ts.ScriptKind.JS],
  ['.ts', ts.ScriptKind.TS],
  ['.js', ts.ScriptKind.JS],
]

const isScannedSource = (p: string): boolean => SOURCE_EXTENSIONS.some(([ext]) => p.endsWith(ext))

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (isScannedSource(entry)) out.push(full)
  }
  return out
}

/**
 * 扫描前先把注释**挖空**（保留换行与列宽，行号列号都不动）。
 *
 * 🔴 不挖的话，**讲解这条规则的注释本身**会被当成罪证 —— 一条把自己的文档
 *    当违规的规则，第一件事就是教人删注释。
 *
 * 🔴 **但原来那版正则做法是错的，而且错得能放行真实违规。**（Issue #929）
 *    `/\/\*[\s\S]*?\*\//g` 分不清「注释」和「字符串里长得像注释的那几个字符」：
 *      const START = '/*'
 *      import { supabaseAdmin } from '@/lib/supabase'   ← 真实违规
 *      const END = '*\/'
 *    这是一段**完全合法**的源码，正则会把 `'/*'` 到 `'*\/'` 整段当块注释删掉，
 *    夹在中间的违规随之蒸发。实测：往本目录放一个这样的文件，本套守卫**全绿**；
 *    去掉那两行伪装、同一个文件立刻被抓 —— 守卫还在、还是绿的，但守空了。
 *    按行首 `*` 猜 JSDoc 续行同样是猜：真代码只要缩进后以 `*` 开头就被整行丢掉；
 *    而且那版是**删行**，行号会漂，诊断位置对不上。
 *
 *    注释范围一律改由**解析器**给出。它认得字符串 / 模板 / 正则字面量，
 *    这一类问题从此不是「再补一条正则」，而是根本不存在。
 *    仓库自带 TypeScript（devDependency，编译器 API 随包提供）—— **不引入任何新依赖**。
 *
 * 🔴 本实现与 `src/lib/kernel/__tests__/architecture.test.ts`、
 *    `src/lib/action-bridge/__tests__/architecture.test.ts` 里那两份**函数体逐字一致**，
 *    含 Issue #923 的 JsxText 修复（JSX 文本里形似注释的内容是要渲染出去的字面文本；
 *    未闭合的 `/*` 会一路吃到 EOF，吞掉该文件后续全部源码）。
 *    七处是否仍然一致由 `src/lib/__tests__/strip-comments-consistency.test.ts` 机器盯着，
 *    以后再动这个函数不会又出现「修一处、漏六处」。
 */

/** 按后缀选 ScriptKind；认不出的按 TS 处理（保守，不会让扫描面变小）。 */
const scriptKindFor = (fileName: string): ts.ScriptKind => {
  for (const [ext, kind] of SOURCE_EXTENSIONS) if (fileName.endsWith(ext)) return kind
  return ts.ScriptKind.TS
}

const parseSource = (code: string, fileName = 'scan.ts'): ts.SourceFile =>
  // setParentNodes = false：只按位置取注释、按节点类型取说明符，用不上父指针。
  // 全仓近 2000 个文件都要过这一遍，省下的回填是实打实的。
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

/** 生产文件 = geo-measurement 目录下除测试以外的 .ts。 */
const PRODUCTION_FILES = walk(GEO_MEASUREMENT_DIR)
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !f.includes('/__tests__/') && !f.endsWith('.test.ts'))

const sourceOf = (file: string): string =>
  stripComments(readFileSync(join(ROOT, file), 'utf8'), file)

describe('GEO Measurement 契约是纯的', () => {
  it('契约目录里确实有生产文件（防止判据因为路径写错而空跑）', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0)
  })

  it('不 import 执行内核 / Kernel / 数据库 / provider 通道 / growth 契约', () => {
    const forbidden = [
      '@/lib/kernel',
      '@/lib/zhuge',
      '@/lib/execution',
      '@/lib/capabilities',
      '@/lib/supabase',
      '@/lib/flywheel',
      // 🔴 v1 实施授权明令：不 import growth —— 两份契约平行冻结，不许互相扩展。
      '@/lib/growth',
      '@supabase/supabase-js',
      '@/lib/cms/',
      '@/lib/publer/',
      '@/lib/gbp/',
      '@/lib/gsc/',
      '@/lib/ai-tracker/',
      '@/lib/industry-ai-visibility/',
      '@/lib/ai/',
    ]
    const violations: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const spec of forbidden) {
        if (new RegExp(`from\\s+['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(src)) {
          violations.push(`${file} → ${spec}`)
        }
      }
    }
    expect(
      violations,
      'GEO Measurement 契约只描述形状、判据与只读投影。legacy 行由调用方取好传入，\n' +
        '本模块不查库、不调用 provider、不 import growth 或任何执行/授权通道。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('不提及授权账本、legacy 动作类型或看板写入的符号', () => {
    const forbidden = [
      'writeExecutionItems',
      'execution_items',
      'PriorityAction',
      'supabaseAdmin',
      'action_runs',
      "'superseded'",
    ]
    const violations: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const symbol of forbidden) {
        if (src.includes(symbol)) violations.push(`${file} → ${symbol}`)
      }
    }
    expect(
      violations,
      '这些符号各自代表一条契约明令不走的路。\n' + violations.join('\n'),
    ).toEqual([])
  })

  it('门面不导出任何修改器 —— 观测与证据都是不可变的', () => {
    const exported = Array.from(
      sourceOf('src/lib/geo-measurement/index.ts').matchAll(
        /\b(validate|create|update|mutate|merge|upsert|persist|save|write|delete)[A-Z]\w*/g,
      ),
    ).map((m) => m[0])

    const mutators = exported.filter((name) => !name.startsWith('validate'))
    expect(
      mutators,
      'WP02 只导出类型、纯校验器、纯可比性判定与纯 legacy 映射函数。任何写入 / 变更语义都不属于契约层。',
    ).toEqual([])
  })

  it('没有 any', () => {
    const violations = PRODUCTION_FILES.filter((f) => /:\s*any\b|<any>|as\s+any\b/.test(sourceOf(f)))
    expect(violations, 'CLAUDE.md 铁律 7：TypeScript strict，无 any。\n' + violations.join('\n')).toEqual([])
  })

  it('不出现网络 / 文件系统 / 定时任务相关调用', () => {
    const forbidden = ['fetch(', 'readFileSync', 'writeFileSync', 'setInterval', 'setTimeout', 'cron']
    const violations: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const symbol of forbidden) {
        if (src.includes(symbol)) violations.push(`${file} → ${symbol}`)
      }
    }
    expect(
      violations,
      'GEO Measurement 契约是纯 TypeScript 类型/校验/判定/映射，没有任何运行时副作用。\n' +
        violations.join('\n'),
    ).toEqual([])
  })
})

/**
 * 🔴 **注释挖空必须走解析器，不能靠正则。**（Issue #929，含 Issue #923 的 JsxText 修复）
 *
 * 这一组用例守的是 `stripComments()` 本身的口径 —— 上面所有「读源码再上正则」的判据
 * 都建在它之上：它抹掉什么，那些判据就看不见什么。
 * 正向（必须**保留**）与反向（必须**挖空**）两边都写，防止为了修一边把另一边弄坏。
 */
describe('注释挖空的口径（Issue #929 / #923）', () => {
  const TSX = 'src/lib/__scan-probe__.tsx'

  it('🔴 字符串里的 `/*` 与 `*/` 之间夹着的真实违规必须还在（#929 主线）', () => {
    // 完全合法的源码：两个普通字符串常量，中间夹着真实违规。
    // 正则版会把 '/*' 到 '*/' 整段当块注释删掉 → 违规蒸发，守卫全绿。
    const code = [
      `const START = '/*'`,
      `import { supabaseAdmin } from '@/lib/supabase'`,
      `export const rows: any = supabaseAdmin.from('execution_items')`,
      `const END = '*/'`,
    ].join('\n')
    const stripped = stripComments(code)
    expect(stripped).toContain('@/lib/supabase')
    expect(stripped).toContain('supabaseAdmin')
    expect(stripped).toContain('execution_items')
    expect(/:\s*any\b|<any>|as\s+any\b/.test(stripped)).toBe(true)
  })

  it('🔴 模板串 / 正则字面量里形似注释的内容同样不许吞掉后面的源码', () => {
    const template = ['const t = `/*`', `import '@/lib/supabase'`, 'const u = `*/`'].join('\n')
    expect(stripComments(template)).toContain('@/lib/supabase')

    const regex = [`const re = /\\/\\*keepme\\*\\//`, `import '@/lib/supabase'`, `const d = 1`].join('\n')
    const strippedRegex = stripComments(regex)
    expect(strippedRegex).toContain('keepme')
    expect(strippedRegex).toContain('@/lib/supabase')
  })

  it('🔴 行首是 `*` 的真代码不许被整行丢掉（正则版靠猜 JSDoc 续行，会误伤）', () => {
    const code = ['const total =', '  * multiplierFromExecutionItems'].join('\n')
    expect(stripComments(code)).toContain('multiplierFromExecutionItems')
  })

  it('🔴 JSX 文本里形似注释的内容不许被挖空，未闭合 `/*` 不许吞掉后续源码（#923）', () => {
    expect(stripComments(`export const P = () => <div>/* keep-me */</div>`, TSX)).toContain(
      '/* keep-me */',
    )
    expect(stripComments(`export const P = () => <div>// keep-me</div>`, TSX)).toContain('// keep-me')

    const unterminated = [
      `export const P = () => <div>/* unterminated`,
      `</div>`,
      `export const rows: any = supabaseAdmin.from('execution_items')`,
    ].join('\n')
    const stripped = stripComments(unterminated, TSX)
    expect(stripped).toContain('supabaseAdmin')
    expect(stripped).toContain('execution_items')
    expect(/:\s*any\b|<any>|as\s+any\b/.test(stripped)).toBe(true)
  })

  it('✅ 字符串 / 模板串 / 正则 / JSX 属性里形似注释的内容都不许被误删', () => {
    const code = [
      `const s = "/* keep-s */"`,
      'const t = `// keep-t`',
      `const re = /\\/\\*keep-re\\*\\//`,
      `export const P = () => <a href="/* keep-href */" data-x="// keep-attr">t</a>`,
    ].join('\n')
    const stripped = stripComments(code, TSX)
    expect(stripped).toContain('/* keep-s */')
    expect(stripped).toContain('// keep-t')
    expect(stripped).toContain('keep-re')
    expect(stripped).toContain('/* keep-href */')
    expect(stripped).toContain('// keep-attr')
  })

  it('✅ 反向对照：真的行注释 / 块注释 / 同行 trailing / EOF / 块尾 } 之前的注释仍被挖空', () => {
    const cases: Array<[label: string, code: string]> = [
      ['行注释', `const x = 1 // kill-me\nconst y = 2`],
      ['块注释', `/* kill-me */\nconst y = 2`],
      ['同一行 trailing 块注释', `const x = foo /* kill-me */ + bar`],
      ['EOF 注释', `const x = 1\n// kill-me`],
      ['块尾 } 之前的注释', `function f() {\n  const a = 1\n  // kill-me\n}`],
      ['模板插值里的注释', 'const s = `${/* kill-me */ x}`'],
    ]
    for (const [label, code] of cases) {
      expect(stripComments(code), label).not.toContain('kill-me')
    }
  })

  it('✅ 反向对照：JSX expression comment 仍被挖空（不是把 JSX 一刀切放过）', () => {
    const cases: Array<[label: string, code: string]> = [
      ['空表达式', `export const P = () => <div>{/* kill-me */}</div>`],
      ['属性内联', `export const P = () => <C v={/* kill-me */ e} />`],
      ['紧跟在 JSX 文本后面', `export const P = () => <div>/* keep-me */{/* kill-me */}</div>`],
    ]
    for (const [label, code] of cases) {
      expect(stripComments(code, TSX), label).not.toContain('kill-me')
    }
  })

  it('✅ 挖空保留换行与列宽（行号列号都不动，不许像正则版那样删行）', () => {
    const code = ['/* lead */', 'const a = 1 // trail', 'const b = 2', '// eof'].join('\n')
    const stripped = stripComments(code)
    expect(stripped).not.toContain('lead')
    expect(stripped).not.toContain('trail')
    expect(stripped).not.toContain('eof')
    expect(stripped.split('\n').length).toBe(code.split('\n').length)
    expect(stripped.length).toBe(code.length)
  })
})

/**
 * 🔴 **守卫自己的扫描面要有测试盯着。**（Issue #938）
 *
 * 这套守卫的全部效力都建立在「walker 真的把该扫的文件收进来了」之上。
 * 扫描面缩小是一种**静默失效**：守卫还在、还是绿的，但什么都不拦了。
 * 所以这里不断言「测试还是绿的」，而是直接对 walker 的行为下断言 ——
 * 把 `isScannedSource` 缩回 `.ts`，下面第一条就红。
 */
describe('扫描面覆盖构建真会编译的每一种后缀（Issue #938）', () => {
  it('🔴 8 种后缀全部算源码；非源码后缀一律不算', () => {
    for (const [ext] of SOURCE_EXTENSIONS) {
      expect(isScannedSource(`anything${ext}`), ext).toBe(true)
    }
    // `.d.ts` / `.d.cts` / `.d.mts` 以 `.ts` / `.cts` / `.mts` 结尾，天然被包含
    expect(isScannedSource('types.d.ts')).toBe(true)
    for (const other of ['.json', '.md', '.css', '.sql', '.snap', '.py', '.txt', '.yml']) {
      expect(isScannedSource(`anything${other}`), other).toBe(false)
    }
  })

  it('🔴 walker 与后缀清单同源 —— 清单里的每一种都必须真被收进来（真磁盘 fixture）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'arch-scan-surface-'))
    try {
      const expected: string[] = []
      for (const [ext] of SOURCE_EXTENSIONS) {
        // 后缀里的点去掉，避免 `a.ts` 与 `a.mts` 互相被 endsWith 误判成同一个文件名
        const name = `f${ext.replace('.', '_')}${ext}`
        writeFileSync(join(tmp, name), 'export const x = 1\n')
        expected.push(name)
      }
      // 非源码不许被收
      writeFileSync(join(tmp, 'notes.md'), 'not source')
      writeFileSync(join(tmp, 'data.json'), '{}')

      const collected = walk(tmp).map((f) => f.split(/[\\/]/).pop() as string)
      expect(collected.sort()).toEqual(expected.sort())
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
