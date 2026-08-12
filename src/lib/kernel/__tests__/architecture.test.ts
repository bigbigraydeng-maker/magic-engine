/**
 * 架构测试 —— L1 边界的执行者。
 *
 * 🔴 为什么不只靠 ESLint：`// eslint-disable-next-line` 一行就能关掉它。
 *    架构测试关不掉 —— 它跑在 `npm test` 里，白名单写在版本控制的代码里，
 *    加一条就是一次要过 review 的 diff。
 *
 * 扫描基于文件系统 + **仓库自带的 TypeScript 解析器**（devDependency，编译器 API
 * 随包提供）—— 不引入任何新依赖。早先这里写的是「不需要 AST 解析器」，实践证明
 * 那个判断是错的：正则分不清注释与字面量、也读不到转义求值后的字符串，
 * 靠加正则补丁堵不完（详见下面 `stripComments` 与 `scanModuleReferences`）。
 */

import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative, posix } from 'path'
import {
  PROVIDER_WRITE_MODULES,
  PROVIDER_WRITE_ALLOWED_DIRS,
  PROVIDER_WRITE_GRANDFATHERED,
  EXECUTION_ITEMS_WRITERS_GRANDFATHERED,
  AUTHORIZED_CONTEXT_MINTERS,
  KERNEL_NO_SUPABASE_ADMIN_DIRS,
  KERNEL_FORBIDDEN_MODULE_IMPORTS,
  ACTION_BRIDGE_FORBIDDEN_IMPORTS,
  MIGRATION_VERSION_COLLISIONS_GRANDFATHERED,
} from '../boundaries'
import { outwardBlockReason } from '../outward-authorization'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/**
 * 🔴 **扫描面必须盖住「构建真会编译的每一种扩展名」，不是只有 `.ts` / `.tsx`。**
 *
 * 仓库 tsconfig 是 `allowJs: true`。原来的 walker 过滤条件是 `/\.tsx?$/`，于是
 * `src/lib/kernel/` 下新加一个 `.js` 文件就完全不被扫描 —— 它直接
 * `import '@/lib/growth'` 也照样全绿，而构建会把这段代码打进去。
 * （Codex thread r3761927225）扫不到的文件等于没有边界。
 *
 * 🔴 **这份清单是有依据的，不是随手扩的。** 用仓库自带 TypeScript 对本仓
 *    `compilerOptions` 求 `getSupportedExtensions()`，实测返回三组：
 *      [".ts",".tsx",".d.ts",".js",".jsx"] · [".cts",".d.cts",".cjs"] · [".mts",".d.mts",".mjs"]
 *    即下面这 8 种后缀（`.d.ts` / `.d.cts` / `.d.mts` 分别以 `.ts` / `.cts` /
 *    `.mts` 结尾，天然被包含）。多一种不加、少一种不漏。
 *
 * 🔴 **每种后缀要用对应的 `ScriptKind`，不能一律当 TS。** 实测：把
 *      `export const C = () => <Foo bar={require('@/lib/growth')} />`
 *    当成 `ScriptKind.TS` 解析，JSX 被当作类型断言，里面的 `require()`
 *    **一条都扫不到**（返回 `[]`）；用 JSX/TSX kind 才能扫到。
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

/** 按后缀选 ScriptKind；认不出的按 TS 处理（保守，不会让扫描面变小）。 */
const scriptKindFor = (fileName: string): ts.ScriptKind => {
  for (const [ext, kind] of SOURCE_EXTENSIONS) if (fileName.endsWith(ext)) return kind
  return ts.ScriptKind.TS
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      walk(full, out)
    } else if (isScannedSource(entry)) {
      out.push(full)
    }
  }
  return out
}

const ALL_FILES = walk(SRC).map((f) => relative(ROOT, f).split('\\').join('/'))

/**
 * 🔴 **测试文件判据必须跟 walker 的后缀清单同源。**（Codex thread r3762497095）
 *
 * walker 扩到八类后缀之后，这里还写着 `/\.test\.tsx?$/` —— 于是
 * `src/foo.test.js` / `.jsx` / `.mts` / `.cts` / `.mjs` / `.cjs` 会被
 * 当成**生产文件**扫描，测试里那些**故意写来验证边界**的禁止导入、
 * 伪造授权上下文、直接写库，会被判成生产违规而把整套测试卡红。
 *
 * 所以直接复用 `SOURCE_EXTENSIONS`，两边同源，不会再各自漂移。
 * 🔴 仓库现有测试命名只有 `.test.<ext>` 与 `/__tests__/` 两种（实测 `.spec.*` 为 0），
 *    这里只扩后缀、**不新增** `.spec.*` 之类仓库里不存在的约定。
 */
const isTest = (p: string) =>
  SOURCE_EXTENSIONS.some(([ext]) => p.endsWith(`.test${ext}`)) || p.includes('/__tests__/')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const parseSource = (code: string, fileName = 'scan.ts'): ts.SourceFile =>
  // setParentNodes = false：只按位置取注释、按节点类型取说明符，用不上父指针。
  // 全仓近 2000 个文件都要过这一遍，省下的回填是实打实的。
  ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false, scriptKindFor(fileName))

/**
 * 扫描前先把注释挖空（保留换行与列宽，行号列号都不动）。
 *
 * 🔴 首版没做这一步，于是**讲解这条规则的注释本身**被当成了违规
 *    （`boundaries.ts` 和 `types.ts` 里都写着「唯一的绕过是 `as unknown as …`」）。
 *    一条把自己的文档当罪证的规则，第一件事就是教人删注释。
 *
 * 🔴 **但正则版的做法是错的，而且错得能放行真实违规。**
 *    `/\/\*[\s\S]*?\*\//g` 分不清「注释」和「字符串里长得像注释的那几个字符」：
 *      const start = '/*'
 *      import '@/lib/growth'        // ← 真实的违规导入
 *      const end = '*\/'
 *    这是一段完全合法的源码，正则会把 `'/*'` 到 `'*\/'` 整段当块注释删掉，
 *    夹在中间的违规 import 随之蒸发，边界测试一片绿。
 *    按行首 `*` 猜 JSDoc 续行同样是猜 —— 一条真代码只要缩进后以 `*` 开头就被吞掉。
 *
 *    注释范围一律改由**解析器**给出。它认得字符串 / 模板 / 正则字面量，
 *    这一类问题从此不是「再补一条正则」，而是根本不存在。
 *
 * 🔴 **只收 leading 不够 —— 同一行、紧跟在前一个 token 后面的注释是 trailing，
 *    不是下一个 token 的 leading。**（Codex thread r3759104932）
 *      const x = foo /* as unknown as AuthorizedExecutionContext *\/ + bar
 *    TS 的 trivia 归属规则：本行内、换行符之前出现的注释算**前一个 token 的
 *    trailing trivia**，只有跨过一次换行之后的注释才会被记成下一个 token 的
 *    leading trivia。原来只在每个节点的 `pos`（= leading）取一次，会漏掉
 *    这类挂在表达式中间、同一行内的注释 —— 挖不掉，就原样留在 `readCode()`
 *    的输出里，让后面那些还在用正则的检查（比如 `AUTHORIZED_CONTEXT_MINTERS`
 *    那条）把纯注释文本当成生产代码，对着注释报出一个假违规。
 *    补法：每个节点的 `pos`（leading）与 `end`（trailing）都收一遍。
 *
 * 🔴 **JSX 文本不是 trivia —— 落在它里面的「注释」是要渲染到页面上的字面文本。**（Issue #923）
 *
 *      export const P = () => <div>/* just text *\/</div>
 *
 *    `<div>` 的 `>` 结束的位置正好压在这段文本的开头，于是 `getTrailingCommentRanges()`
 *    从那儿往后扫，把 `/* … *\/` 认成 `>` 的尾随注释，整段字面文本被挖空。
 *    **实测贡献这条假注释的是 `JsxOpeningElement` / `GreaterThanToken` 的 `end`，
 *    不是 `JsxText` 自己的 `pos`** —— 所以「遍历时跳过 JsxText 节点」那种改法一条都修不掉
 *    （25 条对抗用例里它仍然错 10 条，跟没改完全一样）。
 *
 *    真正危险的是**未闭合**的 `/*`：扫描器一路吃到 EOF，把该文件后面**全部源码**挖空 ——
 *      export const P = () => <div>/* unterminated
 *      </div>
 *      export const evil = {} as unknown as AuthorizedExecutionContext
 *      export const sb = supabaseAdmin.from('execution_items')
 *    这几条真实违规对「先 stripComments 再上正则」的检查完全隐形，是一条 architecture-test bypass。
 *
 *    修法：把 `JsxText` 的区间记下来，最后**丢掉起点落在 JSX 文本里的 range**。
 *    判据是紧的：JSX 文本里按语法根本不可能出现注释 —— 要在 JSX 子节点位置写注释只能写成
 *    `{/* … *\/}`，那段注释的起点在 `{` 之后、不在任何 JsxText 区间里，照样挖得掉。
 *
 *    ⚠️ `.ts` / `.mts` / `.cts` 按 `ScriptKind.TS` 解析，`<div>` 是类型断言、根本没有
 *    JsxText 节点，那里的 `/*` 在语言层面**就是**注释；而这种源码 `transpileModule()`
 *    直接报语法错（实测 TS1109 / TS1010），编译不过、上不了线，因此不是绕过口子。
 */
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
  // 用 forEach 而不是 `for…of ranges.values()`：仓库 tsconfig 没设 target，
  // 直接迭代 Map 的迭代器会撞 TS2802（要 downlevelIteration）。
  ranges.forEach((r) => {
    if (startsInsideJsxText(r.pos)) return
    for (let i = r.pos; i < r.end && i < chars.length; i++) {
      if (chars[i] !== '\n') chars[i] = ' '
    }
  })
  return chars.join('')
}

/**
 * 🔴 扫全仓的那几条要显式给超时。
 *
 * 默认 5s 是按「单元测试」定的，而这几条是**真的把 src 下近 2000 个文件读一遍**。
 * 仓库一长就会撞线 —— 这次合 main 之后从 ~2.2s 涨到 ~5.1s，当场变红，
 * 而它红的原因是「跑不完」，不是「发现了违规」。两者混在一起最危险：
 * 一条本该拦违规的闸会因为超时而以「红了」的样子出现，让人以为它在干活；
 * 而反过来，为了让它绿去放宽判据才是真正的灾难。所以这里不动判据，只给足时间。
 */
const SCAN_TIMEOUT_MS = 60_000

/**
 * 全仓近 2000 个文件，而这个文件里有四条规则都要扫一遍。
 * 不缓存的话每条规则各读一次全仓，在并行跑测试时会直接撞超时
 * （实测：单跑 1.4s，十个测试文件并行时 >5s）。
 */
const codeCache = new Map<string, string>()
const readCode = (p: string): string => {
  const hit = codeCache.get(p)
  if (hit !== undefined) return hit
  const code = stripComments(read(p), p)
  codeCache.set(p, code)
  return code
}

interface EslintConfig {
  rules: Record<string, [string, { patterns: Array<{ group: string[] }> }]>
  overrides: Array<{ files: string[]; rules: Record<string, string> }>
}
const eslintConfig = (): EslintConfig => JSON.parse(read('.eslintrc.json')) as EslintConfig

describe('L1 边界：对外写能力只能由 capability 层调用', () => {
  it('没有 capability 层之外的新 importer（历史清单只准变短）', () => {
    const allowed = new Set<string>(PROVIDER_WRITE_GRANDFATHERED)
    const violations: string[] = []

    for (const file of ALL_FILES) {
      if (isTest(file)) continue
      if (PROVIDER_WRITE_ALLOWED_DIRS.some((d) => file.startsWith(d))) continue
      // 模块自己和它同目录的内部实现不算 importer
      if (PROVIDER_WRITE_MODULES.some((m) => file === `${m.replace('@/', 'src/')}.ts`)) continue

      const src = readCode(file)
      const hit = PROVIDER_WRITE_MODULES.find((m) =>
        new RegExp(`from\\s+['"]${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(src),
      )
      if (hit && !allowed.has(file)) violations.push(`${file} → ${hit}`)
    }

    expect(
      violations,
      `这些文件绕过了执行内核直接 import 对外写能力。\n` +
        `正确做法是提交一个 action_run，让 Kernel 去执行；\n` +
        `确实要豁免就把路径加进 boundaries.ts 的 PROVIDER_WRITE_GRANDFATHERED（那是一次要过 review 的 diff）。\n` +
        violations.join('\n'),
    ).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it('历史清单里的路径都还在（清单不许留幽灵条目）', () => {
    const missing = PROVIDER_WRITE_GRANDFATHERED.filter((p) => !ALL_FILES.includes(p))
    expect(
      missing,
      '这些豁免路径对应的文件已经不存在了，把它们从 boundaries.ts 里删掉 —— ' +
        '留着会让清单看起来比实际更长，也会掩盖真实的收口进度。',
    ).toEqual([])
  })

  it('ESLint 的受限模块清单跟 boundaries.ts 一字不差', () => {
    const rule = eslintConfig().rules['no-restricted-imports']
    expect(rule, '.eslintrc.json 里应该有 no-restricted-imports 规则').toBeTruthy()
    const groups = rule[1].patterns.flatMap((p) => p.group).sort()
    const expected = PROVIDER_WRITE_MODULES.map((m) => `**${m.replace('@', '')}`).sort()
    expect(
      groups,
      '两处各写一份清单必然分家 —— .eslintrc.json 必须跟 boundaries.ts 保持一致',
    ).toEqual(expected)
  })

  it('🔴 ESLint 的豁免路径真的匹配得上那些文件（`[id]` 必须转义）', () => {
    // 首版直接把 `src/app/api/clients/[id]/...` 写进 files，结果 16 个本该
    // 降级为 warning 的历史文件全部报 error —— 因为 minimatch 把 `[id]`
    // 当成了字符类（匹配单个 i 或 d）。一条「看起来配好了」的豁免规则，
    // 实际一条都没生效。
    const warnOverride = eslintConfig().overrides.find(
      (o) => o.rules['no-restricted-imports'] === 'warn',
    )
    expect(warnOverride, '应该有一段把历史 importer 降级为 warning 的 overrides').toBeTruthy()

    const unescaped = warnOverride!.files.map((p) => p.replace(/\\/g, ''))
    expect(
      unescaped.sort(),
      'ESLint 的豁免路径必须跟 boundaries.ts 的历史清单完全一致',
    ).toEqual([...PROVIDER_WRITE_GRANDFATHERED].sort())

    // 逐条检查转义：Next.js 的动态路由目录名带方括号，
    // 而 ESLint 的 files 走 minimatch —— 不转义就会被当成字符类。
    const unescapedBrackets = warnOverride!.files.filter((g) => /(^|[^\\])[[\]]/.test(g))
    expect(
      unescapedBrackets,
      '这些豁免路径里的方括号没转义，minimatch 会把它当字符类 —— 规则实际不会生效。写成 \\\\[ \\\\]',
    ).toEqual([])
  })
})

describe('L1 边界：Kernel 不许自己抓 service-role 客户端', () => {
  it('kernel / capabilities 目录里没有一处 import supabaseAdmin', () => {
    const violations = ALL_FILES.filter((f) => KERNEL_NO_SUPABASE_ADMIN_DIRS.some((d) => f.startsWith(d)))
      .filter((f) => !isTest(f))
      .filter((f) => /from\s+['"]@\/lib\/supabase['"]/.test(readCode(f)))

    expect(
      violations,
      'Kernel 的数据访问一律走注入进来的客户端（见 kernel/deps.ts）。\n' +
        '自己 import supabaseAdmin 等于把「谁在什么授权下写了什么」退化成「进程里哪都能写」。\n' +
        violations.join('\n'),
    ).toEqual([])
  }, SCAN_TIMEOUT_MS)
})

describe('依赖方向：Kernel 不许挂在被它治理的那些层上', () => {
  /**
   * 从一段源码里把**所有**模块引用抠出来 —— 走 AST，六种入口一个不漏：
   *
   *      import { x } from '…' / import type … / import '…'（副作用）   ImportDeclaration
   *      export { x } from '…' / export * from '…'                      ExportDeclaration
   *      import x = require('…')                                        ImportEqualsDeclaration
   *      import('…') / await import('…')                                CallExpression(ImportKeyword)
   *      require('…') / require.resolve('…')                            CallExpression(require)
   *      type T = import('…').X                                         ImportTypeNode
   *
   * 🔴 **说明符取 `.text`，也就是解析器求值后的 cooked 值，不是源码原文。**
   *    正则版比的是源码文本，于是合法的 JS 转义直接绕过：
   *      await import(`\x73rc/lib/${d}`)     // 源码 \x73rc/lib/，运行时 src/lib/
   *      import('\x40/lib/growth')           // 运行时 @/lib/growth
   *    补正则救不了这一类 —— 要比就得比运行时到底是哪个字符串。
   *
   * 🔴 **`type T = import('…').X` 是单独一种语法节点（`ImportTypeNode`），
   *    不是 `CallExpression`。**（Codex thread r3759104922）只覆盖调用表达式那五种，
   *    这种纯类型层的引用会被漏掉 —— 但它在编译期照样把 bridge/kernel 焊死在
   *    被禁止的那一层上，`import type { X } from '…'` 挡得住的东西，
   *    `type T = import('…').X` 原样绕过去。
   *
   * 🔴 **不是字面量的一律 fail closed**：模板带插值、字符串拼接、说明符是变量……
   *    静态都证明不了它去哪。证明不了就不许放行。
   */
  type ModuleReferenceScan = {
    readonly specifiers: readonly string[]
    readonly unresolvable: readonly string[]
  }

  function scanModuleReferences(code: string, fileName = 'scan.ts'): ModuleReferenceScan {
    const specifiers: string[] = []
    const unresolvable: string[] = []

    const record = (expr: ts.Expression | undefined, kind: string): void => {
      if (!expr) return

      // 字符串字面量 与 无插值模板字面量：`.text` 是 cooked 值，转义已被还原
      if (ts.isStringLiteralLike(expr)) {
        specifiers.push(expr.text)
        return
      }

      // 带插值的模板：只有 head 是静态的，同样取 cooked 值
      if (ts.isTemplateExpression(expr)) {
        const cookedHead = expr.head.text
        if (!provablyExternalPackagePrefix(cookedHead)) {
          unresolvable.push(
            cookedHead === ''
              ? `${kind} 模板 \`\${…}\`（表达式打头，静态前缀为空，无法证明去向是外部包，fail closed）`
              : `${kind} 模板 \`${cookedHead}\${…}\`（静态前缀证明不了它指向仓库外的包，fail closed）`,
          )
        }
        return
      }

      unresolvable.push(
        `${kind} 说明符不是字面量（${ts.SyntaxKind[expr.kind]}），静态证明不了去向，fail closed`,
      )
    }

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        record(node.moduleSpecifier, 'import')
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        record(node.moduleSpecifier, 'export…from')
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        record(node.moduleReference.expression, 'import=require')
      } else if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          record(node.arguments[0], 'import()')
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          record(node.arguments[0], 'require()')
        } else if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'require' &&
          node.expression.name.text === 'resolve'
        ) {
          record(node.arguments[0], 'require.resolve()')
        }
      } else if (ts.isImportTypeNode(node)) {
        // `type T = import('…').X` —— 类型层的模块引用，argument 只可能是
        // 字符串字面量类型（TS 语法本身不允许在这里写变量/拼接），
        // 但仍按同一套「不是字面量就 fail closed」处理，不假设它一定合法。
        const arg = node.argument
        if (ts.isLiteralTypeNode(arg) && ts.isStringLiteralLike(arg.literal)) {
          record(arg.literal, 'import 类型()')
        } else {
          unresolvable.push(
            `import 类型() 说明符不是字符串字面量（${ts.SyntaxKind[arg.kind]}），静态证明不了去向，fail closed`,
          )
        }
      }
      node.forEachChild(visit)
    }

    visit(parseSource(code, fileName))
    return { specifiers, unresolvable }
  }

  /**
   * 把说明符规范成**跟禁止清单同一套写法**（无点段的 `@/...`）。
   *
   * 🔴 只处理 `./` `../` 是不够的。仓库的 tsconfig 是
   *    `baseUrl: "."` + `paths: { "@/*": ["./src/*"] }`，所以下面这些
   *    **合法的 TypeScript 导入**都会解析到仓库内真实模块，却一条都不命中：
   *      import 'src/lib/capabilities'                  // baseUrl 项目路径
   *      require('src/lib/supabase')
   *      import '@/lib/kernel/../growth/types'          // alias 里带点段
   *      await import('@/lib/action-bridge/../execution')
   *    所以四类说明符都要折算到同一口径，点段一律消除。
   *
   * 🔴 `@/` 是本仓 alias，`@supabase/supabase-js` 这类 scoped npm 包**不是** ——
   *    判据必须是 `@/` 而不是 `@`，否则会把 npm 包名改写掉。
   */
  function toAliasPath(repoRelative: string): string {
    return repoRelative.startsWith('src/') ? `@/${repoRelative.slice('src/'.length)}` : repoRelative
  }

  function canonicalSpecifier(sourcePath: string, spec: string): string {
    const slashed = spec.split('\\').join('/')

    // ① 相对说明符：按**当前被扫描的那个源文件**的目录解析
    if (slashed.startsWith('.')) {
      const dir = posix.dirname(sourcePath.split('\\').join('/'))
      return toAliasPath(posix.normalize(posix.join(dir, slashed)))
    }

    // ② 本仓 alias（只有 `@/`），点段在这里被消除
    if (slashed.startsWith('@/')) {
      return toAliasPath(posix.normalize(`src/${slashed.slice('@/'.length)}`))
    }

    // ③ baseUrl 项目路径（`src/...`）
    if (slashed === 'src' || slashed.startsWith('src/')) {
      return toAliasPath(posix.normalize(slashed))
    }

    // ④ npm 包名（含 scoped）原样保留
    return spec
  }

  const importedModules = (sourcePath: string, code: string): string[] =>
    scanModuleReferences(code, sourcePath).specifiers.map((spec) => canonicalSpecifier(sourcePath, spec))

  /**
   * 插值模板字面量的动态 import()/require() —— 静态扫描算不出插值展开后的真实路径。
   *
   * 🔴 直接放过等于开了个口子：`import(\`${prefix}/growth\`)` 只要 `prefix`
   *    运行时算出来是 `'@/lib'`，效果跟写死 `import('@/lib/growth')` 一模一样，
   *    但静态扫描永远看不出来。
   *
   * 🔴 **判据的方向是「证明它安全」，不是「看它像不像工程路径」。**
   *    早先写成「静态前缀落在 `@/` `src/` `./` `../` 上才算命中」—— 那是反的，
   *    「没法证明是外部包」≠「可以放行」。于是**两类**写法从正门走了出去：
   *
   *      const prefix = '@/lib'; await import(`${prefix}/growth`)   // ① 静态前缀是空串
   *      await import(`s${rest}`)                                     // ② 前缀还能长成 `src/`
   *
   *    ① 表达式打头：反引号后面立刻就是 `${`，抠出来的静态前缀是空字符串。
   *      空前缀什么都没证明 —— `prefix` 运行时可能算出 `'@/lib'`，也可能算出一个
   *      npm 包名，静态扫描没有任何字面文本能用来判断；却因为 `''.startsWith('@/')`
   *      为假被判成干净，**恰恰是最没法证明安全的情形反而被放行**。
   *    ② 半截前缀：`'s'` 再补三个字符就是 `'src/'`，`'@'` 补一个就是 `'@/'`。
   *
   *    所以现在反过来：**证明不了指向仓库外的包，就算命中。**
   *    证明成立只有一种情形：静态前缀非空，**且**它既没落在四类工程路径写法上，
   *    也不可能再长成其中任何一条。
   *
   * 🔴 不猜插值算出来是什么，也不许把这段前缀塞进 `canonicalSpecifier()` 去规范化
   *    —— 那是个截断的半截路径，规范化出来的东西看着像一个合法模块，实则是编出来的。
   *
   * npm 包的插值（`` `some-package-${variant}` `` / `` `@supabase/${sub}` ``）静态前缀
   * 已经把首段定死在仓库外，证明成立，原样放行 —— 不能把外部包名误判成工程路径。
   */
  const PROJECT_PATH_PREFIXES = ['@/', 'src/', './', '../'] as const

  /**
   * 这段静态前缀能不能**证明**插值展开后指向的是仓库外的 npm 包。
   * 证明不了一律返回 false（→ fail closed）。
   */
  function provablyExternalPackagePrefix(prefix: string): boolean {
    // 空前缀什么都证明不了：`${anything}` 可以是任意路径。
    // 🔴 这一句**被下面「长得成」那句盖住**（`'@/'.startsWith('')` 为真，空前缀在那里
    //    照样会被拒）—— 实测拆掉它测试全绿。留着是因为它写的是本轮 Codex 点名的
    //    那一种情形，读代码的人一眼就能看见；但**别给它单写变异探针**说它独立生效，
    //    也别因为「空的情况这儿管了」就去简化下面那句 —— 真正拦住空前缀的是它。
    if (prefix === '') return false
    // 已经落在工程路径写法上
    if (PROJECT_PATH_PREFIXES.some((p) => prefix.startsWith(p))) return false
    // 还没写完，但再补几个字符就能长成工程路径写法（也含空前缀这一种）
    if (PROJECT_PATH_PREFIXES.some((p) => p.startsWith(prefix))) return false
    return true
  }

  /** 静态证明不了去向的模块引用（插值模板 / 变量 / 拼接），一律算命中。 */
  function interpolatedProjectPathHits(code: string, fileName = 'scan.ts'): readonly string[] {
    return scanModuleReferences(code, fileName).unresolvable
  }

  /**
   * 命中判据 = **前缀匹配**，跟原来的正则语义一致（模块本身与它的子路径都命中，
   * `@/lib/cms/` 这类带斜杠的前缀规则照常生效）。
   * 🔴 改成字符串比较之后**不再需要转义** —— 模块名里的 `/`、`@`、`.`
   *    都只是普通字符，没有任何机会被当成正则元字符。
   *
   * 🔴 插值动态导入的 fail-closed 命中不看 `mods` —— 静态扫描算不出真实目标，
   *    没法证明它没指向被禁止的那些层，所以对**每一道**在跑的边界检查都算命中。
   */
  const importsAnyOf = (sourcePath: string, code: string, mods: readonly string[]): boolean => {
    const specs = importedModules(sourcePath, code)
    if (mods.some((mod) => specs.some((spec) => spec.startsWith(mod)))) return true
    return interpolatedProjectPathHits(code, sourcePath).length > 0
  }

  /** 跟 `importsAnyOf` 同一套判据，但把命中原因（含源文件路径）摊开，用于违规清单的诊断信息。 */
  const violationReasons = (sourcePath: string, code: string, mods: readonly string[]): string[] => {
    const specs = importedModules(sourcePath, code)
    const direct = mods
      .filter((mod) => specs.some((spec) => spec.startsWith(mod)))
      .map((mod) => `${sourcePath} → ${mod}`)
    const interpolated = interpolatedProjectPathHits(code, sourcePath).map((reason) => `${sourcePath} → ${reason}`)
    return [...direct, ...interpolated]
  }

  it('🔴 kernel 目录里没有一处 import 域模块或 action-bridge', () => {
    const violations = ALL_FILES.filter((f) => f.startsWith('src/lib/kernel/'))
      .filter((f) => !isTest(f))
      .flatMap((f) => violationReasons(f, readCode(f), KERNEL_FORBIDDEN_MODULE_IMPORTS))

    expect(
      violations,
      '依赖方向只有一条：bridge → kernel。\n' +
        '把候选身份映射放进 Kernel，等于每接一个新域就让 Kernel 多 import 一个域模块。\n' +
        violations.join('\n'),
    ).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it('🔴 action-bridge 只依赖 Kernel —— 不碰库 / provider / 执行 / legacy 生成端', () => {
    const violations = ALL_FILES.filter((f) => f.startsWith('src/lib/action-bridge/'))
      .filter((f) => !isTest(f))
      .flatMap((f) => violationReasons(f, readCode(f), ACTION_BRIDGE_FORBIDDEN_IMPORTS))

    expect(
      violations,
      'bridge 是一层纯映射。它一旦能 import 到 capabilities / supabase / provider，\n' +
        '就从「翻译」变成了第二条执行路径 —— ME2 只留一个入口：提交 action_run。\n' +
        violations.join('\n'),
    ).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it('域模块（Growth）不 import Kernel 或 action-bridge', () => {
    const violations = ALL_FILES.filter((f) => f.startsWith('src/lib/growth/'))
      .filter((f) => !isTest(f))
      .flatMap((f) => violationReasons(f, readCode(f), ['@/lib/kernel', '@/lib/action-bridge']))

    expect(
      violations,
      'Growth 契约只描述形状。要让系统做事，提交一个 action_run 交给执行内核。\n' +
        violations.join('\n'),
    ).toEqual([])
  }, SCAN_TIMEOUT_MS)

  /**
   * 🔴 **盯着这道闸本身。**
   *
   * 上面三条扫的是真实文件，而真实文件现在是干净的 —— 它们**永远绿**，
   * 绿得跟「判据整个失效了」一模一样。所以这一组用合成源码逐项证明：
   * 每一种把模块拉进来的写法都真的会被发现。这正是本轮 P2 的成因 ——
   * 原来的判据只认 `from '...'`，另外三种全是敞开的。
   */
  describe('🔴 导入扫描盖得住所有写法（合成源码）', () => {
    const FORBIDDEN_FORMS: Array<[label: string, code: string]> = [
      ['具名导入', `import { x } from '@/lib/growth'`],
      ['再导出', `export { x } from '@/lib/growth'`],
      ['再导出全部', `export * from '@/lib/action-bridge'`],
      ['静态副作用导入', `import '@/lib/action-bridge'`],
      ['动态导入', `const m = await import('@/lib/growth')`],
      ['CommonJS require', `const g = require('@/lib/growth')`],
      ['子路径也算', `import type { T } from '@/lib/growth/types'`],
      ['动态导入（模板字面量，无插值）', 'const m = await import(`@/lib/growth`)'],
      ['CommonJS require（模板字面量，无插值）', 'const g = require(`@/lib/growth`)'],
    ]

    /** 合成用例的虚拟源文件 —— 相对说明符要按它们的位置解析。 */
    const KERNEL_FILE = 'src/lib/kernel/example.ts'
    const BRIDGE_FILE = 'src/lib/action-bridge/index.ts'
    const GROWTH_FILE = 'src/lib/growth/types.ts'

    it.each(FORBIDDEN_FORMS)('kernel 侧：%s → 必须被发现', (_label, code) => {
      expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
    })

    it('bridge 侧：动态导入 / require / 副作用导入都算数', () => {
      expect(
        importsAnyOf(BRIDGE_FILE, `import '@/lib/capabilities'`, ACTION_BRIDGE_FORBIDDEN_IMPORTS),
      ).toBe(true)
      expect(
        importsAnyOf(BRIDGE_FILE, `await import('@/lib/execution')`, ACTION_BRIDGE_FORBIDDEN_IMPORTS),
      ).toBe(true)
      expect(
        importsAnyOf(BRIDGE_FILE, `require('@/lib/supabase')`, ACTION_BRIDGE_FORBIDDEN_IMPORTS),
      ).toBe(true)
      // 带斜杠的前缀规则
      expect(
        importsAnyOf(
          BRIDGE_FILE,
          `import { w } from '@/lib/cms/wordpress-client'`,
          ACTION_BRIDGE_FORBIDDEN_IMPORTS,
        ),
      ).toBe(true)
      // 动态导入 / require 用模板字面量（无插值）一样算数
      expect(
        importsAnyOf(
          BRIDGE_FILE,
          'await import(`@/lib/execution`)',
          ACTION_BRIDGE_FORBIDDEN_IMPORTS,
        ),
      ).toBe(true)
      expect(
        importsAnyOf(BRIDGE_FILE, 'require(`@/lib/supabase`)', ACTION_BRIDGE_FORBIDDEN_IMPORTS),
      ).toBe(true)
    })

    it('🔴 只写在注释里的示例不算违规（判据不许把自己的文档当罪证）', () => {
      // 🔴 JSDoc 续行（` * …`）必须**真的包在块注释里**。早先这里少写了 `/**` 与 `*/`，
      //    那段其实是「悬空的代码」，只因为旧的正则版按行首 `*` 猜注释才没报 ——
      //    解析器不猜，所以 fixture 得写成真实文件里的样子。
      const commented = [
        `// import { x } from '@/lib/growth'`,
        `/* const g = require('@/lib/action-bridge') */`,
        `/**`,
        ` * import '@/lib/growth'`,
        ` */`,
        `const real = 1`,
      ].join('\n')
      // 原文直接扫（AST 天然不把注释当代码）与先挖空注释再扫，两条路都必须干净
      expect(importsAnyOf(KERNEL_FILE, commented, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
      expect(
        importsAnyOf(KERNEL_FILE, stripComments(commented), KERNEL_FORBIDDEN_MODULE_IMPORTS),
      ).toBe(false)
    })

    /**
     * 🔴 **相对路径同样要按源文件位置解析。**
     *
     * 上一轮把四种 import 写法都盖住了，但只拿**原始说明符**去比 `@/lib/...` ——
     * 于是 `import '../growth'` 指向同一个模块却一条都不命中。
     */
    it('规范化本身：相对说明符折算成 alias', () => {
      expect(canonicalSpecifier(KERNEL_FILE, '../growth')).toBe('@/lib/growth')
      expect(canonicalSpecifier(KERNEL_FILE, '../action-bridge')).toBe('@/lib/action-bridge')
      expect(canonicalSpecifier(KERNEL_FILE, './registry')).toBe('@/lib/kernel/registry')
      expect(canonicalSpecifier(GROWTH_FILE, '../kernel')).toBe('@/lib/kernel')
      // alias 与 npm 包名原样保留
      expect(canonicalSpecifier(KERNEL_FILE, '@/lib/growth')).toBe('@/lib/growth')
      expect(canonicalSpecifier(KERNEL_FILE, 'vitest')).toBe('vitest')
    })

    const KERNEL_RELATIVE: Array<[label: string, code: string]> = [
      ['../growth（副作用导入）', `import '../growth'`],
      ['../growth（具名导入）', `import { x } from '../growth'`],
      ['../action-bridge（动态导入）', `const m = await import('../action-bridge')`],
      ['../action-bridge（require）', `const b = require('../action-bridge')`],
      ['../growth/types（子路径）', `import type { T } from '../growth/types'`],
    ]

    it.each(KERNEL_RELATIVE)('kernel 里的 %s → 必须被拒', (_label, code) => {
      expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
    })

    it('🔴 bridge 里的 ../capabilities / ../execution / ../supabase 都被拒', () => {
      for (const code of [
        `import '../capabilities'`,
        `const m = await import('../execution')`,
        `const sb = require('../supabase')`,
      ]) {
        expect(importsAnyOf(BRIDGE_FILE, code, ACTION_BRIDGE_FORBIDDEN_IMPORTS), code).toBe(true)
      }
    })

    it('🔴 Growth 里相对导入 ../kernel 或 ../action-bridge 都被拒', () => {
      for (const code of [
        `import { runAction } from '../kernel'`,
        `import '../action-bridge'`,
        `const k = require('../kernel/runner')`,
      ]) {
        expect(
          importsAnyOf(GROWTH_FILE, code, ['@/lib/kernel', '@/lib/action-bridge']),
          code,
        ).toBe(true)
      }
    })

    it('Kernel 自己内部的相对 import 不误报', () => {
      const clean = [
        `import { validateAgainstSchema } from './registry'`,
        `import type { ActionRun } from './types'`,
        `import { KernelError } from '@/lib/kernel/errors'`,
      ].join('\n')
      expect(importsAnyOf(KERNEL_FILE, clean, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
    })

    it('Growth 自己内部的相对 import 不误报', () => {
      const clean = [
        `import type { X } from './types'`,
        `import { validate } from './validators'`,
      ].join('\n')
      expect(importsAnyOf(GROWTH_FILE, clean, ['@/lib/kernel', '@/lib/action-bridge'])).toBe(false)
    })
  })

  /**
   * 🔴 仓库 tsconfig 是 `baseUrl: "."` + `paths: { "@/*": ["./src/*"] }`，
   *    所以「不以 `.` 开头」并不等于「不是本仓模块」：`src/lib/x` 靠 baseUrl
   *    解析得到，`@/lib/a/../b` 里的点段会被 TypeScript 自己消掉。
   *    两类都是合法写法，扫描不折算就能静默绕过冻结边界。
   */
  describe('🔴 baseUrl 项目路径与 alias 点段也要折算（合成源码）', () => {
    const KERNEL_FILE = 'src/lib/kernel/example.ts'
    const BRIDGE_FILE = 'src/lib/action-bridge/index.ts'
    const GROWTH_FILE = 'src/lib/growth/types.ts'

    it('折算表：四类说明符各归各位', () => {
      // alias 点段
      expect(canonicalSpecifier(KERNEL_FILE, '@/lib/kernel/../growth/types')).toBe(
        '@/lib/growth/types',
      )
      expect(canonicalSpecifier(BRIDGE_FILE, '@/lib/action-bridge/../execution')).toBe(
        '@/lib/execution',
      )
      // baseUrl 项目路径
      expect(canonicalSpecifier(BRIDGE_FILE, 'src/lib/capabilities')).toBe('@/lib/capabilities')
      expect(canonicalSpecifier(KERNEL_FILE, 'src/lib/growth')).toBe('@/lib/growth')
      // 原有两类不回归
      expect(canonicalSpecifier(KERNEL_FILE, '../growth')).toBe('@/lib/growth')
      expect(canonicalSpecifier(KERNEL_FILE, '@/lib/x')).toBe('@/lib/x')
      // 🔴 scoped npm 包不是本仓 alias，一个字都不许改
      expect(canonicalSpecifier(KERNEL_FILE, '@supabase/supabase-js')).toBe('@supabase/supabase-js')
      expect(canonicalSpecifier(KERNEL_FILE, 'vitest')).toBe('vitest')
    })

    it('🔴 Kernel：baseUrl 与点段两种写法都被拒', () => {
      for (const code of [
        `import 'src/lib/growth'`,
        `require('src/lib/action-bridge')`,
        `import type { X } from '@/lib/kernel/../growth/types'`,
        `await import('@/lib/kernel/../action-bridge')`,
      ]) {
        expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS), code).toBe(true)
      }
    })

    it('🔴 Bridge：baseUrl 与点段两种写法都被拒', () => {
      for (const code of [
        `import 'src/lib/capabilities'`,
        `require('src/lib/supabase')`,
        `await import('src/lib/execution/auto-run')`,
        `import '@/lib/action-bridge/../execution'`,
      ]) {
        expect(importsAnyOf(BRIDGE_FILE, code, ACTION_BRIDGE_FORBIDDEN_IMPORTS), code).toBe(true)
      }
    })

    it('🔴 Growth：baseUrl 与点段两种写法都被拒', () => {
      for (const code of [
        `import 'src/lib/action-bridge'`,
        `require('src/lib/kernel/gateway')`,
        `import '@/lib/growth/../kernel'`,
      ]) {
        expect(
          importsAnyOf(GROWTH_FILE, code, ['@/lib/kernel', '@/lib/action-bridge']),
          code,
        ).toBe(true)
      }
    })

    it('折算之后合法导入仍不误报', () => {
      const clean = [
        `import { ACTION_REGISTRY } from 'src/lib/kernel/registry'`,
        `import type { ActionKey } from '@/lib/action-bridge/../kernel/types'`,
        `import { createClient } from '@supabase/supabase-js'`,
      ].join('\n')
      // Kernel 侧：registry / types 都不在 Kernel 的禁止清单里
      expect(importsAnyOf(KERNEL_FILE, clean, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
    })
  })

  /**
   * 🔴 **插值模板字面量的动态导入同样要 fail closed。**
   *
   * `import(\`${prefix}/growth\`)`：只要 `prefix` 运行时算出来是 `'@/lib'`，
   * 效果跟写死 `import('@/lib/growth')` 一模一样，但静态扫描算不出插值展开后
   * 去了哪。所以判据是**证明它安全才放行**：静态前缀（`${` 之前那一截）必须非空，
   * 且既没落在四类工程路径写法上（`@/`、`src/`、`./`、`../`）、也不可能再长成其中
   * 任何一条 —— 证明不了一律命中，不猜、也不算出真实目标。
   * npm 包的插值（`some-package-${variant}` / `@supabase/${sub}`）首段已定死在仓库外，放行。
   */
  describe('🔴 插值模板字面量的动态导入 fail closed（合成源码）', () => {
    const KERNEL_FILE = 'src/lib/kernel/example.ts'
    const BRIDGE_FILE = 'src/lib/action-bridge/index.ts'
    const GROWTH_FILE = 'src/lib/growth/types.ts'

    const PROJECT_PREFIX_FORMS: Array<[label: string, code: string]> = [
      ['@/ alias 前缀', 'const m = await import(`@/lib/${domain}`)'],
      ['src/ baseUrl 前缀', 'const m = await import(`src/lib/${domain}`)'],
      ['./ 相对前缀', 'const m = require(`./${domain}`)'],
      ['../ 相对前缀', 'const m = require(`../${domain}`)'],
    ]

    it.each(PROJECT_PREFIX_FORMS)(
      'kernel 侧：%s 的插值动态导入 → fail closed 必须命中',
      (_label, code) => {
        expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
      },
    )

    it.each(PROJECT_PREFIX_FORMS)(
      'bridge 侧：%s 的插值动态导入 → fail closed 必须命中',
      (_label, code) => {
        expect(importsAnyOf(BRIDGE_FILE, code, ACTION_BRIDGE_FORBIDDEN_IMPORTS)).toBe(true)
      },
    )

    it.each(PROJECT_PREFIX_FORMS)(
      'growth 侧：%s 的插值动态导入 → fail closed 必须命中',
      (_label, code) => {
        expect(importsAnyOf(GROWTH_FILE, code, ['@/lib/kernel', '@/lib/action-bridge'])).toBe(true)
      },
    )

    /**
     * 🔴 **表达式打头，静态前缀为空** —— `${` 紧跟在反引号后面，抠出来的前缀是
     *    空字符串，不落在四类工程路径写法的任何一类，之前的判据会误判成「外部
     *    包插值」直接放行。空前缀什么都没证明，必须跟四类工程路径写法一样 fail
     *    closed，而不是因为「不匹配」就当成安全。
     */
    const EXPRESSION_FIRST_FORMS: Array<[label: string, code: string]> = [
      ['import，无任何静态前缀', 'const m = await import(`${domain}/growth`)'],
      ['require，无任何静态前缀', 'const m = require(`${domain}/growth`)'],
      ['整段模板只有一个插值', 'const m = await import(`${modulePath}`)'],
    ]

    it.each(EXPRESSION_FIRST_FORMS)(
      'kernel 侧：%s → fail closed 必须命中（不能因为前缀是空字符串就放行）',
      (_label, code) => {
        expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
      },
    )

    it.each(EXPRESSION_FIRST_FORMS)('bridge 侧：%s → fail closed 必须命中', (_label, code) => {
      expect(importsAnyOf(BRIDGE_FILE, code, ACTION_BRIDGE_FORBIDDEN_IMPORTS)).toBe(true)
    })

    it.each(EXPRESSION_FIRST_FORMS)('growth 侧：%s → fail closed 必须命中', (_label, code) => {
      expect(importsAnyOf(GROWTH_FILE, code, ['@/lib/kernel', '@/lib/action-bridge'])).toBe(true)
    })

    it('🔴 命中诊断带着源文件路径（违规清单不能只说「哪个文件出事了」丢了「因为什么」）', () => {
      const reasons = violationReasons(
        KERNEL_FILE,
        'await import(`@/lib/${domain}`)',
        KERNEL_FORBIDDEN_MODULE_IMPORTS,
      )
      expect(reasons.length).toBeGreaterThan(0)
      expect(reasons[0]).toContain(KERNEL_FILE)
      expect(reasons[0]).toContain('fail closed')
    })

    it('✅ 外部 npm 包名的插值不是工程路径，不误报（静态前缀非空且明确不落在四类写法上，才算证明了外部）', () => {
      const code = 'const m = await import(`some-package-${variant}`)'
      expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
      expect(importsAnyOf(BRIDGE_FILE, code, ACTION_BRIDGE_FORBIDDEN_IMPORTS)).toBe(false)
      expect(importsAnyOf(GROWTH_FILE, code, ['@/lib/kernel', '@/lib/action-bridge'])).toBe(false)
    })

    it('Kernel 允许的本地相对导入即使用反引号（无插值）也不误报', () => {
      const clean = 'import(`./registry`)\nrequire(`./types`)'
      expect(importsAnyOf(KERNEL_FILE, clean, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
    })

    it('🔴 只写在注释里的插值示例不算违规（判据不许把自己的文档当罪证）', () => {
      // JSDoc 续行同样要真的包在块注释里 —— 解析器不按行首 `*` 猜注释
      const commented = [
        '// const m = await import(`@/lib/${domain}`)',
        '/* const g = require(`../${domain}`) */',
        '/**',
        ' * await import(`src/lib/${x}`)',
        ' */',
        '// const h = await import(`${domain}/growth`)',
        'const real = 1',
      ].join('\n')
      expect(importsAnyOf(KERNEL_FILE, commented, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
      expect(
        importsAnyOf(KERNEL_FILE, stripComments(commented), KERNEL_FORBIDDEN_MODULE_IMPORTS),
      ).toBe(false)
    })

    /**
     * 🔴 **判据反了的那两类，各自单独盯一条。**
     *
     * 上面那组 `PROJECT_PREFIX_FORMS` 全都是「静态前缀已经写成了工程路径」，
     * 旧判据（`prefix.startsWith('@/')` 之类）照样让它们全绿 —— 那一组
     * **证明不了**这次的修复。真正从正门走出去的是下面两类：前缀为空、
     * 以及前缀短到还能长成工程路径标记。
     */
    describe('🔴 证明不了指向外部包就算命中（这才是本轮的判据）', () => {
      it('🔴 静态前缀为空 —— Codex 点名的那一种，整段路径都在插值里', () => {
        // const prefix = '@/lib'; await import(`${prefix}/growth`)
        // 运行时等价于 import('@/lib/growth')，静态前缀却是空串。
        const code = "const prefix = '@/lib'\nconst m = await import(`${prefix}/growth`)"
        expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
        expect(importsAnyOf(BRIDGE_FILE, code, ACTION_BRIDGE_FORBIDDEN_IMPORTS)).toBe(true)
        expect(importsAnyOf(GROWTH_FILE, code, ['@/lib/kernel', '@/lib/action-bridge'])).toBe(true)
      })

      const GROWABLE_PREFIXES: Array<[label: string, code: string]> = [
        ['`s` 还能长成 `src/`', 'const m = await import(`s${rest}`)'],
        ['`sr` 还能长成 `src/`', 'const m = await import(`sr${rest}`)'],
        ['`src` 还能长成 `src/`', 'const m = await import(`src${rest}`)'],
        ['`@` 还能长成 `@/`', 'const m = await import(`@${rest}`)'],
        ['`.` 还能长成 `./`', 'const m = require(`.${rest}`)'],
        ['`..` 还能长成 `../`', 'const m = require(`..${rest}`)'],
      ]

      it.each(GROWABLE_PREFIXES)('🔴 %s → 证明不了，必须 fail closed', (_label, code) => {
        expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
        expect(importsAnyOf(BRIDGE_FILE, code, ACTION_BRIDGE_FORBIDDEN_IMPORTS)).toBe(true)
      })

      it('✅ 首段已经定死在仓库外的 npm 插值仍然放行（判据没有一刀切成全拒）', () => {
        for (const code of [
          'const m = await import(`some-package-${variant}`)',
          'const m = await import(`@supabase/${sub}`)',
          'const m = require(`lodash.${fn}`)',
        ]) {
          expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS), code).toBe(false)
          expect(importsAnyOf(BRIDGE_FILE, code, ACTION_BRIDGE_FORBIDDEN_IMPORTS), code).toBe(false)
        }
      })
    })

    /**
     * 🔴 **换成解析器之后才关得掉的两类绕过。**
     *
     * 这两条正则版**结构上**做不到，不是补一条 pattern 的事：
     *   ① 转义：比对源码原文，`\x73rc` 永远不等于 `src`；要比就得比 cooked 值。
     *   ② 注释：正则分不清「注释」与「字符串里长得像注释的那几个字符」。
     */
    describe('🔴 解析器口径：转义与注释（合成源码）', () => {
      /** ① Codex thread r3758650486 */
      describe('转义说明符按 cooked 值判，不按源码原文', () => {
        const ESCAPED_FORMS: Array<[label: string, code: string]> = [
          ['模板 head 里的 \\x73rc（Codex 原案）', 'const m = await import(`\\x73rc/lib/${d}`)'],
          ['普通字符串里的 \\x40（= @）', "import '\\x40/lib/growth'"],
          ['无插值模板里的 \\x73rc', 'const g = require(`\\x73rc/lib/growth`)'],
          ['unicode 转义 \\u0073rc', "await import('\\u0073rc/lib/action-bridge')"],
        ]

        it.each(ESCAPED_FORMS)('🔴 kernel 侧：%s → 必须被发现', (_label, code) => {
          expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
        })

        it('🔴 cooked 值确实被还原成真实模块名（不是靠 fail-closed 兜住的）', () => {
          const reasons = violationReasons(
            KERNEL_FILE,
            "import '\\x40/lib/growth'",
            KERNEL_FORBIDDEN_MODULE_IMPORTS,
          )
          expect(reasons).toEqual([`${KERNEL_FILE} → @/lib/growth`])
        })

        it('✅ 转义出来的外部包名不误报', () => {
          // '\x76itest' → 'vitest'
          expect(importsAnyOf(KERNEL_FILE, "import '\\x76itest'", KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(
            false,
          )
        })
      })

      /** ② Codex thread r3758650489 */
      describe('注释挖空不许吞掉字符串之间的真实源码', () => {
        it('🔴 字符串里的 `/*` 与 `*/` 之间夹着的违规 import 必须还在', () => {
          // 完全合法的源码：两个字符串常量，中间一条真实的违规 import。
          // 正则版把 '/*' 到 '*/' 整段当块注释删掉 → 违规蒸发，测试全绿。
          const code = [
            `const start = '/*'`,
            `import '@/lib/growth'`,
            `const end = '*/'`,
          ].join('\n')
          expect(stripComments(code)).toContain('@/lib/growth')
          expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
          expect(
            importsAnyOf(KERNEL_FILE, stripComments(code), KERNEL_FORBIDDEN_MODULE_IMPORTS),
          ).toBe(true)
        })

        it('🔴 正则字面量里的 `/*` 同样不许把后面的源码吞掉', () => {
          const code = [`const re = /\\/\\*/`, `import '@/lib/action-bridge'`, `const d = 1`].join(
            '\n',
          )
          expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
        })

        it('🔴 模板字面量里的 `/*` 也一样', () => {
          const code = ['const t = `/*`', `require('@/lib/growth')`, 'const u = `*/`'].join('\n')
          expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
        })

        it('✅ 真的写在块注释里的示例仍然不算违规（判据没有被放松成「注释也算」）', () => {
          const code = [`/* import '@/lib/growth' */`, `const real = 1`].join('\n')
          expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
          expect(stripComments(code)).not.toContain('@/lib/growth')
        })

        it('✅ 挖空注释不改变行号（诊断信息里的位置仍然对得上）', () => {
          const code = ['/* a */', '// b', 'const real = 1'].join('\n')
          expect(stripComments(code).split('\n').length).toBe(3)
        })

        /** ④ Codex thread r3759104932：trailing 注释（同一行、紧跟在前一个 token 后面）也要挖空 */
        it('🔴 表达式中间、同一行内的块注释（trailing trivia）必须被挖空', () => {
          // `/* … */` 紧跟在 foo 后面、同一行、没有换行分隔 —— 这是 foo 的
          // trailing trivia，不是 `+ bar` 的 leading trivia。只收 leading 会漏掉它。
          const code = `const x = foo /* as unknown as AuthorizedExecutionContext */ + bar`
          expect(stripComments(code)).not.toContain('as unknown as AuthorizedExecutionContext')
        })

        it('🔴 挖掉 trailing 注释之后，还在用正则的检查不会把注释文本当成生产代码', () => {
          // 复刻 L2 边界「授权上下文不许在别处被造出来」那条检查的判据：
          // 注释里出现这行字不代表生产代码里真的伪造了授权上下文，之前会误判成违规。
          const pattern = /as\s+(unknown\s+as\s+)?AuthorizedExecutionContext/
          const code = `const x = foo /* as unknown as AuthorizedExecutionContext */ + bar`
          expect(pattern.test(stripComments(code))).toBe(false)
        })

        it('🔴 语句末尾、同一行的 `//` 注释同样要被挖空（不只是独占一行的注释）', () => {
          // 🔴 断言必须直接对 stripComments() 的输出下手 —— importsAnyOf 走 AST
          // 直接扫原始 code，注释本来就不会被解析成 import 声明，跟 stripComments
          // 挖没挖干净无关；真正受这个修复影响的是后面那些还在用正则的检查。
          const code = [`const x = 1 // as unknown as AuthorizedExecutionContext`, `const y = 2`].join(
            '\n',
          )
          expect(stripComments(code)).not.toContain('as unknown as AuthorizedExecutionContext')
        })

        it('✅ 挖 trailing 注释不许连带误伤字符串 / 正则里长得像注释的内容', () => {
          const code = [
            `const start = '/*'`,
            `const mid = 1 /* real trailing comment */ + 2`,
            `const end = '*/'`,
          ].join('\n')
          const stripped = stripComments(code)
          expect(stripped).toContain(`const start = '/*'`)
          expect(stripped).toContain(`const end = '*/'`)
          expect(stripped).not.toContain('real trailing comment')
        })
      })

      /**
       * 🔴 **测试文件判据必须跟 walker 的后缀清单同源。**（Codex thread r3762497095）
       *
       * walker 扩到八类后缀后，`isTest` 若还只认 `.test.ts(x)`，那么
       * `src/foo.test.js` 之类会被当成生产文件扫描 —— 测试里**故意写来验证边界**的
       * 禁止导入会被判成生产违规，把整套测试卡红。
       */
      describe('🔴 isTest 与 walker 后缀同源（Codex r3762497095）', () => {
        it('🔴 八种 `.test.<ext>` 全部被认定为测试文件', () => {
          for (const [ext] of SOURCE_EXTENSIONS) {
            expect(isTest(`src/lib/kernel/foo.test${ext}`), ext).toBe(true)
          }
        })

        it('🔴 八种同后缀的**普通生产文件**仍然被当成生产代码（不许被排除掉）', () => {
          for (const [ext] of SOURCE_EXTENSIONS) {
            expect(isTest(`src/lib/kernel/foo${ext}`), ext).toBe(false)
            expect(isScannedSource(`src/lib/kernel/foo${ext}`), ext).toBe(true)
          }
        })

        it('✅ `/__tests__/` 既有语义保持不变；不引入 `.spec.*` 之类仓库里没有的约定', () => {
          expect(isTest('src/lib/kernel/__tests__/a.ts')).toBe(true)
          expect(isTest('src/lib/kernel/__tests__/a.js')).toBe(true)
          // 仓库实测 `.spec.*` 为 0，不新增该约定
          expect(isTest('src/lib/kernel/foo.spec.ts')).toBe(false)
        })

        it('🔴 真实磁盘 fixture：测试文件不进生产违规扫描，同内容的生产文件必须被拦', () => {
          const tmp = mkdtempSync(join(tmpdir(), 'k-wp02-istest-'))
          try {
            const forbidden = `import '@/lib/growth'`
            // 同样一段禁止导入，一份放测试文件、一份放生产文件
            writeFileSync(join(tmp, 'boundary.test.jsx'), forbidden)
            writeFileSync(join(tmp, 'widget.jsx'), forbidden)
            writeFileSync(join(tmp, 'notes.md'), forbidden)

            const collected = walk(tmp).map((f) => f.split(/[\\/]/).pop() as string)
            // walker 收源码、不收非源码
            expect(collected.sort()).toEqual(['boundary.test.jsx', 'widget.jsx'])

            const production = collected.filter((f) => !isTest(f))
            expect(production).toEqual(['widget.jsx'])

            // 生产那份必须命中；测试那份不进扫描，因此不会把边界测试卡红
            expect(importsAnyOf('widget.jsx', forbidden, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
            expect(isTest('boundary.test.jsx')).toBe(true)
          } finally {
            rmSync(tmp, { recursive: true, force: true })
          }
        })
      })

      /**
       * 🔴 **JSX 表达式里的注释挂在 token 上，不挂在任何子节点上。**（Codex thread r3762497089）
       *
       *     <div>{/* as unknown as AuthorizedExecutionContext *\/}</div>
       *     <Comp value={/* any *\/ expr} />
       *
       * `JsxExpression` 只有 `{` `}` 两个 token；空表达式时 `forEachChild` 一个子节点都不给，
       * 所以注释既不是它的 leading、也不是谁的 trailing —— 原样留在挖空结果里，
       * 后面仍用正则的全仓检查（授权上下文、没有 any）会把纯注释当成生产代码而误报。
       * 修法：遍历改走 `getChildren()`（token 级），注释是 `}` 的前导 trivia。
       */
      describe('🔴 JSX 表达式里的注释同样要被挖空（Codex r3762497089）', () => {
        const KERNEL_TSX = 'src/lib/kernel/panel.tsx'
        const KERNEL_JSX2 = 'src/lib/kernel/panel.jsx'

        it('🔴 .tsx 里 `{/* as unknown as AuthorizedExecutionContext */}` 必须被挖空', () => {
          const code = `export const P = () => <div>{/* as unknown as AuthorizedExecutionContext */}</div>`
          expect(stripComments(code, KERNEL_TSX)).not.toContain(
            'as unknown as AuthorizedExecutionContext',
          )
        })

        it('🔴 .jsx 里 `{/* any */}` 不得触发「没有 any」那条正则', () => {
          const code = `export const P = () => <div>{/* const x: any = 1 */}</div>`
          expect(/:\s*any\b|<any>|as\s+any\b/.test(stripComments(code, KERNEL_JSX2))).toBe(false)
        })

        it('🔴 JSX 属性里的内联注释 `value={/* … */ expr}` 也要挖空', () => {
          const code = `export const P = () => <Comp value={/* as unknown as any */ expr} />`
          expect(stripComments(code, KERNEL_TSX)).not.toContain('as unknown as any')
        })

        it('🔴 JSX 注释里写的禁止 import / require 路径不算违规', () => {
          const code = [
            `import React from 'react'`,
            `export const P = () => <div>{/* import '@/lib/growth' */}</div>`,
            `export const Q = () => <div>{/* require('@/lib/action-bridge') */}</div>`,
          ].join('\n')
          expect(importsAnyOf(KERNEL_JSX2, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
          expect(stripComments(code, KERNEL_JSX2)).not.toContain('@/lib/growth')
        })

        it('🔴 JSX 表达式**外**真实的禁止 import / require 仍必须命中', () => {
          const code = [
            `import '@/lib/growth'`,
            `export const P = () => <div>{/* 这里只是注释 */}{require('@/lib/action-bridge')}</div>`,
          ].join('\n')
          expect(
            violationReasons(KERNEL_JSX2, code, KERNEL_FORBIDDEN_MODULE_IMPORTS).sort(),
          ).toEqual([`${KERNEL_JSX2} → @/lib/action-bridge`, `${KERNEL_JSX2} → @/lib/growth`])
        })

        it('✅ 字符串 / 模板串 / 正则 / JSX 属性里形似注释的内容不得被误删', () => {
          const code = [
            `const s = "/* not a comment */"`,
            'const t = `// not a comment either`',
            `const re = /\\/\\*keepme\\*\\//`,
            `export const P = () => <a href="/* keep-href */" data-x="// keep-attr">t</a>`,
          ].join('\n')
          const stripped = stripComments(code, KERNEL_TSX)
          expect(stripped).toContain('/* not a comment */')
          expect(stripped).toContain('// not a comment either')
          expect(stripped).toContain('keepme')
          expect(stripped).toContain('/* keep-href */')
          expect(stripped).toContain('// keep-attr')
        })

        it('🔴 八类后缀下 JSX / 普通注释都挖得掉（挖空不改行号）', () => {
          for (const f of ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mts', 'a.cts', 'a.mjs', 'a.cjs']) {
            const code = ['/* lead */', 'const a = 1 // trail', '// eof'].join('\n')
            const stripped = stripComments(code, f)
            expect(stripped, f).not.toContain('lead')
            expect(stripped, f).not.toContain('trail')
            expect(stripped, f).not.toContain('eof')
            expect(stripped.split('\n').length, f).toBe(3)
          }
        })
      })

      /**
       * 🔴 **JSX 文本不是注释 —— 未闭合的 `/*` 会吞掉该文件后续全部源码。**（Issue #923）
       *
       * 这是一条真的 architecture-test bypass：把违规藏在一段未闭合 `/*` 的 JSX 文本后面，
       * 下面这些「先 stripComments 再上正则」的检查就全瞎了 ——
       * 伪造授权上下文 / kernel 直接抓 supabaseAdmin / 写 execution_items / 没有 any。
       *
       * 反向对照同样写在这里：修 JSX 文本的同时**不许**停止挖真注释。
       */
      describe('🔴 JSX 文本里形似注释的内容不许被当成注释（Issue #923）', () => {
        const KERNEL_TSX2 = 'src/lib/kernel/text-panel.tsx'
        /** 会被 JSX 解析（有 JsxText 节点）的五类后缀 —— 修复在这些后缀上必须生效 */
        const JSX_CAPABLE = ['a.tsx', 'a.jsx', 'a.js', 'a.mjs', 'a.cjs'] as const
        /** 按 ScriptKind.TS 解析的三类 —— `<div>` 是类型断言，没有 JsxText */
        const TS_KIND = ['a.ts', 'a.mts', 'a.cts'] as const
        /** 未闭合 `/*` 之后藏着四条真实违规 */
        const HIDDEN_VIOLATIONS = [
          `export const P = () => <div>/* unterminated`,
          `</div>`,
          `export const evil = {} as unknown as AuthorizedExecutionContext`,
          `export const sb = supabaseAdmin.from('execution_items')`,
          `export const bad: any = 1`,
        ].join('\n')

        it('✅ 普通 JSX 文本原样保留', () => {
          const code = `export const P = () => <div>keep-me plain text</div>`
          expect(stripComments(code, KERNEL_TSX2)).toContain('keep-me plain text')
        })

        it('🔴 JSX 文本里**闭合**的 `/* … */` 是字面文本，不许被挖空', () => {
          const code = `export const P = () => <div>/* keep-me */</div>`
          expect(stripComments(code, KERNEL_TSX2)).toContain('/* keep-me */')
        })

        it('🔴 JSX 文本里的 `//` 同样是字面文本，不许被挖空', () => {
          const code = `export const P = () => <div>// keep-me</div>`
          expect(stripComments(code, KERNEL_TSX2)).toContain('// keep-me')
        })

        it('🔴 多行 JSX 文本 / Fragment / 元素之间的文本都不许被挖空', () => {
          const cases = [
            `export const P = () => (\n  <div>\n    /* keep-me */ and // keep-me-too\n  </div>\n)`,
            `export const Q = () => <>/* keep-me */</>`,
            `export const R = () => <div><b>x</b>/* keep-me */<i>y</i></div>`,
          ]
          for (const code of cases) {
            expect(stripComments(code, KERNEL_TSX2), code).toContain('/* keep-me */')
          }
        })

        it('🔴 **未闭合**的 `/*` 不许吞掉后续源码 —— 四条真实违规必须都还看得见', () => {
          const stripped = stripComments(HIDDEN_VIOLATIONS, KERNEL_TSX2)
          expect(stripped).toContain('as unknown as AuthorizedExecutionContext')
          expect(stripped).toContain('supabaseAdmin')
          expect(stripped).toContain('execution_items')
          expect(/:\s*any\b|<any>|as\s+any\b/.test(stripped)).toBe(true)
        })

        it('🔴 未闭合 `/*` 之后的禁止 import 仍然命中（正则那路与 AST 那路都要看得见）', () => {
          const code = [
            `export const P = () => <div>/* unterminated`,
            `</div>`,
            `import '@/lib/growth'`,
          ].join('\n')
          expect(stripComments(code, KERNEL_TSX2)).toContain('@/lib/growth')
          expect(importsAnyOf(KERNEL_TSX2, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
          expect(
            importsAnyOf(KERNEL_TSX2, stripComments(code, KERNEL_TSX2), KERNEL_FORBIDDEN_MODULE_IMPORTS),
          ).toBe(true)
        })

        it('🔴 五类会解析 JSX 的后缀上，未闭合 `/*` 全都不再吞代码', () => {
          for (const f of JSX_CAPABLE) {
            const stripped = stripComments(HIDDEN_VIOLATIONS, f)
            expect(stripped, f).toContain('as unknown as AuthorizedExecutionContext')
            expect(stripped, f).toContain('supabaseAdmin')
            expect(stripped, f).toContain('execution_items')
          }
        })

        it('✅ `.ts/.mts/.cts` 里同样一段源码本来就编译不过（不是留下来的绕过口子）', () => {
          // 这三类按 ScriptKind.TS 解析：`<div>` 是类型断言、没有 JsxText 节点，
          // 那里的 `/*` 在语言层面**就是**一条未闭合注释。要确认这不是个口子，
          // 就得证明这种源码根本不是合法代码 —— 用公开 API transpileModule 报诊断。
          for (const f of TS_KIND) {
            const out = ts.transpileModule(HIDDEN_VIOLATIONS, {
              fileName: f,
              reportDiagnostics: true,
              compilerOptions: { allowJs: true },
            })
            expect((out.diagnostics ?? []).length, f).toBeGreaterThan(0)
          }
        })

        it('✅ JSX 属性字符串里形似注释的内容不许被挖空', () => {
          const code = `export const P = () => <a href="/* keep-href */" data-x="// keep-attr">t</a>`
          const stripped = stripComments(code, KERNEL_TSX2)
          expect(stripped).toContain('/* keep-href */')
          expect(stripped).toContain('// keep-attr')
        })

        it('✅ 字符串 / 模板串 / 正则里形似注释的内容不许被挖空', () => {
          const code = [
            `const s = "/* keep-s */"`,
            'const t = `// keep-t`',
            `const re = /\\/\\*keep-re\\*\\//`,
          ].join('\n')
          const stripped = stripComments(code)
          expect(stripped).toContain('/* keep-s */')
          expect(stripped).toContain('// keep-t')
          expect(stripped).toContain('keep-re')
        })

        /** ⬇⬇ 反向对照：修 JSX 文本的同时，**真注释一条都不许留下** ⬇⬇ */
        it('🔴 反向对照：真正的 JSX expression comment 仍然被挖空', () => {
          const cases: Array<[label: string, code: string]> = [
            ['空表达式', `export const P = () => <div>{/* kill-me */}</div>`],
            ['属性内联', `export const P = () => <C v={/* kill-me */ e} />`],
            ['紧跟在 JSX 文本后面', `export const P = () => <div>/* keep-me */{/* kill-me */}</div>`],
            ['换行缩进的常见写法', `export const P = () => (\n  <div>\n    {/* kill-me */}\n  </div>\n)`],
          ]
          for (const [label, code] of cases) {
            expect(stripComments(code, KERNEL_TSX2), label).not.toContain('kill-me')
          }
        })

        it('🔴 反向对照：JS/TS 的真行注释、块注释、trailing、EOF 注释仍然被挖空', () => {
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

        it('🔴 反向对照：八类后缀下真注释仍然挖得掉，且挖空不改行号', () => {
          for (const [ext] of SOURCE_EXTENSIONS) {
            const code = ['/* kill-lead */', 'const a = 1 // kill-trail', '// kill-eof'].join('\n')
            const stripped = stripComments(code, `a${ext}`)
            expect(stripped, ext).not.toContain('kill-lead')
            expect(stripped, ext).not.toContain('kill-trail')
            expect(stripped, ext).not.toContain('kill-eof')
            expect(stripped.split('\n').length, ext).toBe(3)
          }
        })

        it('✅ 保留 JSX 文本之后行号列宽都不变（诊断位置仍然对得上）', () => {
          const stripped = stripComments(HIDDEN_VIOLATIONS, KERNEL_TSX2)
          expect(stripped.split('\n').length).toBe(HIDDEN_VIOLATIONS.split('\n').length)
          expect(stripped.length).toBe(HIDDEN_VIOLATIONS.length)
        })
      })

      /**
       * ③ 顺带关掉的两条 —— 上一轮在 PR 评论 §6 里如实列为「残余风险、未修」。
       *    换解析器之后它们是同一条代码路径的自然结果，不是额外加的判据。
       */
      describe('说明符不是字面量一律 fail closed（上一轮列为残余风险的两条）', () => {
        const NON_LITERAL: Array<[label: string, code: string]> = [
          ['字符串拼接', `const m = import('@/lib/' + 'growth')`],
          ['说明符是变量', `const p = '@/lib/growth'\nconst m = import(p)`],
          ['三元表达式', `const m = import(flag ? '@/lib/growth' : 'vitest')`],
          ['require.resolve', `const p = require.resolve('@/lib/action-bridge')`],
        ]

        it.each(NON_LITERAL)('🔴 %s → 必须被发现', (_label, code) => {
          expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
        })
      })
    })
  })

  /**
   * 🔴 **type-only 的模块引用走的是另一种语法节点（`ImportTypeNode`），
   *    不是上面六种里的 `CallExpression`/`Declaration`。**（Codex thread r3759104922）
   *
   * `type T = import('@/lib/growth').GrowthActionCandidateIdentity` 在编译期
   * 建立的依赖跟 `import type { X } from '@/lib/growth'` 完全一样，但语法节点是
   * `ImportTypeNode`，原来的 `visit()` 只认 `ImportDeclaration` / `ExportDeclaration` /
   * `ImportEqualsDeclaration` / `CallExpression` 四类，这一种直接漏过去。
   */
  describe('🔴 type-only 的 import() 类型引用同样要被治理（ImportTypeNode）', () => {
    const KERNEL_FILE = 'src/lib/kernel/example.ts'
    const BRIDGE_FILE = 'src/lib/action-bridge/index.ts'
    const GROWTH_FILE = 'src/lib/growth/types.ts'

    it('🔴 kernel 侧：type T = import(...).X 必须被发现', () => {
      expect(
        importsAnyOf(
          KERNEL_FILE,
          `type T = import('@/lib/growth').GrowthActionCandidateIdentity`,
          KERNEL_FORBIDDEN_MODULE_IMPORTS,
        ),
      ).toBe(true)
    })

    it('🔴 bridge 侧：type T = import(...).X 必须被发现', () => {
      expect(
        importsAnyOf(
          BRIDGE_FILE,
          `type T = import('@/lib/capabilities').X`,
          ACTION_BRIDGE_FORBIDDEN_IMPORTS,
        ),
      ).toBe(true)
    })

    it('🔴 growth 侧：type T = import(...).X 必须被发现', () => {
      expect(
        importsAnyOf(GROWTH_FILE, `type T = import('@/lib/kernel').X`, [
          '@/lib/kernel',
          '@/lib/action-bridge',
        ]),
      ).toBe(true)
    })

    it('✅ 允许的模块用 import 类型写法也照常放行（没有被 fail-closed 误伤）', () => {
      const code = `type T = import('./registry').X`
      expect(importsAnyOf(KERNEL_FILE, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
    })

    it('🔴 相对路径 / baseUrl 在 import 类型里同样要折算再判', () => {
      expect(
        importsAnyOf(KERNEL_FILE, `type T = import('../growth').X`, KERNEL_FORBIDDEN_MODULE_IMPORTS),
      ).toBe(true)
      expect(
        importsAnyOf(
          BRIDGE_FILE,
          `type T = import('src/lib/capabilities').X`,
          ACTION_BRIDGE_FORBIDDEN_IMPORTS,
        ),
      ).toBe(true)
    })

    it('🔴 转义写法在 import 类型里同样按 cooked 值判', () => {
      expect(
        importsAnyOf(
          KERNEL_FILE,
          `type T = import('\\x40/lib/growth').X`,
          KERNEL_FORBIDDEN_MODULE_IMPORTS,
        ),
      ).toBe(true)
    })

    it('🔴 只写在注释里的 import 类型示例不算违规', () => {
      const commented = [
        `// type T = import('@/lib/growth').X`,
        `/* type U = import('@/lib/action-bridge').Y */`,
        `const real = 1`,
      ].join('\n')
      expect(importsAnyOf(KERNEL_FILE, commented, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
    })
  })

  /**
   * 🔴 **allowJs：`.js` / `.jsx` 也会被编译进构建，扫描面必须盖住它们。**
   *
   * （Codex thread r3761927225）原来的 walker 只认 `/\.tsx?$/`，而仓库
   * `tsconfig.json` 是 `allowJs: true` —— `src/lib/kernel/` 下放一个 `.js`
   * 直接 `import '@/lib/growth'`，构建照打，架构测试却全绿。
   */
  describe('🔴 allowJs：JS/JSX 文件同样要被扫描与治理（合成源码）', () => {
    const KERNEL_JS = 'src/lib/kernel/helper.js'
    const KERNEL_JSX = 'src/lib/kernel/panel.jsx'
    const BRIDGE_JS = 'src/lib/action-bridge/helper.js'
    const BRIDGE_JSX = 'src/lib/action-bridge/widget.jsx'
    const GROWTH_JS = 'src/lib/growth/helper.js'

    it('🔴 扫描面覆盖构建真会编译的 8 种后缀（依据：本仓 compilerOptions 下的 getSupportedExtensions）', () => {
      for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']) {
        expect(isScannedSource(`anything${ext}`), ext).toBe(true)
      }
      expect(isScannedSource('types.d.ts')).toBe(true)
      for (const other of ['.json', '.md', '.css', '.sql', '.snap', '.py']) {
        expect(isScannedSource(`anything${other}`), other).toBe(false)
      }
    })

    it('🔴 walk() 真的会把这些后缀收进来，且不误收非代码文件（真实磁盘探针）', () => {
      // 🔴 上面那条只验判据函数；这条验**真实的目录遍历**——判据对了但 walker
      //    没用上它，照样是空的。
      const tmp = mkdtempSync(join(tmpdir(), 'k-wp02-kernel-walker-'))
      try {
        const source = ['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.mts', 'f.cts', 'g.mjs', 'h.cjs']
        const noise = ['i.json', 'j.md', 'k.css', 'l.snap']
        for (const f of [...source, ...noise]) writeFileSync(join(tmp, f), '')
        const found = walk(tmp).map((f) => f.split(/[\\/]/).pop() as string)
        expect(found.sort()).toEqual([...source].sort())
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })

    it('🔴 .jsx 里插值动态导入同样 fail closed（不因为扩展名不是 .ts 就放松）', () => {
      expect(
        importsAnyOf(KERNEL_JSX, 'const m = await import(`@/lib/${d}`)', KERNEL_FORBIDDEN_MODULE_IMPORTS),
      ).toBe(true)
      expect(
        importsAnyOf(KERNEL_JS, 'const m = require(`../${d}`)', KERNEL_FORBIDDEN_MODULE_IMPORTS),
      ).toBe(true)
    })

    it('✅ .jsx 里真正的 JSX 内容不误报（属性值长得像路径也不算 import）', () => {
      const jsx = [
        `import React from 'react'`,
        `export const P = () => <a href="@/lib/growth" data-src="../action-bridge">x</a>`,
      ].join('\n')
      expect(importsAnyOf(KERNEL_JSX, jsx, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
    })

    it('🔴 每种后缀选对 ScriptKind（不是一律当 TS）', () => {
      expect(scriptKindFor('a.ts')).toBe(ts.ScriptKind.TS)
      expect(scriptKindFor('a.tsx')).toBe(ts.ScriptKind.TSX)
      expect(scriptKindFor('a.js')).toBe(ts.ScriptKind.JS)
      expect(scriptKindFor('a.jsx')).toBe(ts.ScriptKind.JSX)
      expect(scriptKindFor('a.mts')).toBe(ts.ScriptKind.TS)
      expect(scriptKindFor('a.cts')).toBe(ts.ScriptKind.TS)
      expect(scriptKindFor('a.mjs')).toBe(ts.ScriptKind.JS)
      expect(scriptKindFor('a.cjs')).toBe(ts.ScriptKind.JS)
      // 🔴 长后缀必须排在前面，`.mts` 不许被 `.ts` 那条先匹配掉
      expect(scriptKindFor('a.mts')).not.toBe(ts.ScriptKind.JS)
    })

    it.each([
      ['.js 静态导入', KERNEL_JS, `import { g } from '@/lib/growth'`],
      ['.js 副作用导入', KERNEL_JS, `import '@/lib/growth'`],
      ['.js require', KERNEL_JS, `const g = require('@/lib/growth')`],
      ['.js 相对路径 ../growth', KERNEL_JS, `import '../growth'`],
      ['.js 引 action-bridge', KERNEL_JS, `const b = require('@/lib/action-bridge')`],
      ['.jsx 动态导入', KERNEL_JSX, `const m = await import('@/lib/growth')`],
      ['.mjs 静态导入', 'src/lib/kernel/helper.mjs', `import '@/lib/growth'`],
      ['.cjs require', 'src/lib/kernel/helper.cjs', `const g = require('@/lib/growth')`],
    ])('🔴 kernel 侧 %s → 必须被发现', (_label, file, code) => {
      expect(importsAnyOf(file, code, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(true)
    })

    it('🔴 bridge 侧 .js / .jsx 引 capabilities / execution 同样被拦', () => {
      for (const [file, code] of [
        [BRIDGE_JS, `import { c } from '@/lib/capabilities'`],
        [BRIDGE_JS, `const e = require('@/lib/execution')`],
        [BRIDGE_JSX, `import '@/lib/execution'`],
        [BRIDGE_JSX, `import '../capabilities'`],
      ] as Array<[string, string]>) {
        expect(importsAnyOf(file, code, ACTION_BRIDGE_FORBIDDEN_IMPORTS), `${file}: ${code}`).toBe(
          true,
        )
      }
    })

    it('🔴 Growth 侧 .js 引 kernel / action-bridge 同样被拦', () => {
      for (const code of [`import '@/lib/kernel'`, `const b = require('../action-bridge')`]) {
        expect(importsAnyOf(GROWTH_JS, code, ['@/lib/kernel', '@/lib/action-bridge']), code).toBe(
          true,
        )
      }
    })

    /**
     * 🔴 这条专门盯 ScriptKind 选对没有：JSX 里嵌的 `require()` / `import()`
     *    强制当 `ScriptKind.TS` 时 JSX 被当成类型断言，**一条都扫不到**。
     */
    it('🔴 JSX 属性 / 子元素里的模块引用要能扫到（强制当 TS 就会漏）', () => {
      expect(
        violationReasons(
          KERNEL_JSX,
          `export const C = () => <Foo bar={require('@/lib/growth')} />`,
          KERNEL_FORBIDDEN_MODULE_IMPORTS,
        ),
      ).toEqual([`${KERNEL_JSX} → @/lib/growth`])
      expect(
        importsAnyOf(
          KERNEL_JSX,
          `export const D = () => <div>{import('@/lib/action-bridge')}</div>`,
          KERNEL_FORBIDDEN_MODULE_IMPORTS,
        ),
      ).toBe(true)
    })

    it('✅ 合法的 JS / JSX 文件不误报', () => {
      const js = [
        `import { validateAgainstSchema } from './registry'`,
        `const path = require('path')`,
      ].join('\n')
      expect(importsAnyOf(KERNEL_JS, js, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)

      const jsx = [
        `import React from 'react'`,
        `import type { ActionRun } from './types'`,
        `export const P = () => <div className="ok">kernel</div>`,
      ].join('\n')
      expect(importsAnyOf(KERNEL_JSX, jsx, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
    })

    it('✅ JSX 文件里的注释示例不算违规（挖注释也走对了 ScriptKind）', () => {
      const jsx = [
        `import React from 'react'`,
        `// import '@/lib/growth'`,
        `export const P = () => <div>{/* import '@/lib/action-bridge' */}</div>`,
      ].join('\n')
      expect(importsAnyOf(KERNEL_JSX, jsx, KERNEL_FORBIDDEN_MODULE_IMPORTS)).toBe(false)
      expect(stripComments(jsx, KERNEL_JSX)).not.toContain('@/lib/growth')
    })
  })
})

describe('L2 边界：授权上下文不许在别处被造出来', () => {
  it('只有 kernel/authorize.ts 会把普通对象抬成 AuthorizedExecutionContext', () => {
    const minters = new Set<string>(AUTHORIZED_CONTEXT_MINTERS)
    const pattern = /as\s+(unknown\s+as\s+)?AuthorizedExecutionContext/

    const violations = ALL_FILES.filter((f) => !isTest(f))
      .filter((f) => !minters.has(f))
      .filter((f) => pattern.test(readCode(f)))

    expect(
      violations,
      '伪造授权上下文是一行显式写下的绕过代码。\n' +
        '（就算伪造了也过不了 Gateway 的重读比对，但它不该出现在生产代码里。）\n' +
        violations.join('\n'),
    ).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it('Gateway 确实会从库里重读授权，而不是只信传进来的对象', () => {
    const gateway = read('src/lib/kernel/gateway.ts')
    // 这三件事缺任何一件，「伪造 ctx 也没用」这句话就不成立
    expect(gateway).toContain('getDecision(')
    expect(gateway).toContain('assertDecisionMatches')
    expect(gateway).toContain('beginAuthorizedRun(')
  })
})

describe('L1 边界：execution_items 是看板，不是执行引擎', () => {
  it('没有新的直接写入方（15 个历史生产者只准变少）', () => {
    const allowed = new Set<string>(EXECUTION_ITEMS_WRITERS_GRANDFATHERED)
    const violations: string[] = []

    for (const file of ALL_FILES) {
      if (isTest(file)) continue
      const src = readCode(file)
      let writes = false
      const re = /from\('execution_items'\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        if (/\.(insert|update|delete)\(/.test(src.slice(m.index, m.index + 300))) {
          writes = true
          break
        }
      }
      if (writes && !allowed.has(file)) violations.push(file)
    }

    expect(
      violations,
      '新代码不该直接往执行看板里写 —— 提交一个 action_run，让 Kernel 去跑。\n' +
        violations.join('\n'),
    ).toEqual([])
  }, SCAN_TIMEOUT_MS)
})

describe('migration 版本不许撞车（P1-4）', () => {
  it('supabase/migrations 里没有两个文件用同一个版本号', () => {
    // 🔴 实测踩过：本 PR 原来用 20260808000001，而并行的另一个窗口（PR #862）
    //    已经占了 000001 / 000002。两边都合进 main 之后，Supabase 的
    //    migration history 会出现重复 version —— 而这件事在**各自的分支上
    //    都看不出来**，只有合并之后才炸。
    //    所以判据必须是「扫全目录」，不是「我记得我用的是哪个号」。
    const dir = join(ROOT, 'supabase/migrations')
    const versions = new Map<string, string[]>()
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.sql')) continue
      const version = f.slice(0, 14)
      expect(
        /^\d{14}$/.test(version),
        `migration 文件名前 14 位必须是时间戳版本号：${f}`,
      ).toBe(true)
      versions.set(version, [...(versions.get(version) ?? []), f])
    }

    const known = new Set<string>(MIGRATION_VERSION_COLLISIONS_GRANDFATHERED)
    const collisions = Array.from(versions.entries())
      .filter(([v, files]) => files.length > 1 && !known.has(v))
      .map(([v, files]) => `${v} → ${files.join(' / ')}`)

    expect(
      collisions,
      '这些 migration 用了同一个版本号。并行开发时各自分支都看不出来，' +
        '合并后 Supabase 的 migration 账本会出现重复 version。\n' +
        '把后来的那个改成一个更晚且唯一的版本号（不要往豁免清单里加）。\n' +
        collisions.join('\n'),
    ).toEqual([])
  })

  it('历史重复清单里的版本号现在确实还在重复（清单不许留幽灵条目）', () => {
    const dir = join(ROOT, 'supabase/migrations')
    const count = new Map<string, number>()
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.sql')) continue
      const v = f.slice(0, 14)
      count.set(v, (count.get(v) ?? 0) + 1)
    }
    const resolved = MIGRATION_VERSION_COLLISIONS_GRANDFATHERED.filter(
      (v) => (count.get(v) ?? 0) <= 1,
    )
    expect(
      resolved,
      '这些历史撞车已经被解决了，把它们从 boundaries.ts 的清单里删掉 —— ' +
        '留着会让欠账看起来比实际更多。',
    ).toEqual([])
  })
})

describe('lineage 视图的权限（C1）', () => {
  const MIGRATION = 'supabase/migrations/20260808000003_me2_execution_kernel_v1.sql'

  it('🔴 视图必须声明 security_invoker —— 否则按 owner 权限读底表，anon 可能借道越过 RLS', () => {
    const sql = read(MIGRATION)
    const viewStmt = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW public.kernel_action_lineage'))
    const header = viewStmt.slice(0, viewStmt.indexOf(' AS'))
    expect(
      /WITH\s*\(\s*security_invoker\s*=\s*true\s*\)/i.test(header),
      'kernel_action_lineage 的 CREATE VIEW 头部必须带 WITH (security_invoker = true)。\n' +
        '没有它，视图以 owner 权限读 goals / authorization_decisions / step output —— \n' +
        'anon/authenticated 经 Data API 查视图就能把跨客户数据一锅端走。',
    ).toBe(true)
  })

  it('🔴 anon / authenticated 必须被显式 REVOKE，service_role 显式 GRANT —— 不赌底表 RLS 恰好都配对', () => {
    const sql = read(MIGRATION)
    expect(
      /REVOKE\s+ALL\s+ON\s+public\.kernel_action_lineage\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i.test(sql),
      '迁移里必须有 REVOKE ALL ON public.kernel_action_lineage FROM PUBLIC, anon, authenticated',
    ).toBe(true)
    expect(
      /GRANT\s+SELECT\s+ON\s+public\.kernel_action_lineage\s+TO\s+service_role/i.test(sql),
      '迁移里必须有 GRANT SELECT ON public.kernel_action_lineage TO service_role',
    ).toBe(true)
  })

  it('每一个 RPC 的 EXECUTE 也都收了口（同一类漏洞，一起盯）', () => {
    const sql = read(MIGRATION)
    for (const fn of [
      'kernel_claim_run_step',
      'kernel_begin_authorized_run',
      'kernel_resolve_pending_approval',
      'kernel_claim_run_recovery',
      'kernel_claim_or_takeover_run',
    ]) {
      expect(
        new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}[^;]*FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated`,
          'i',
        ).test(sql),
        `${fn} 的 EXECUTE 必须显式 REVOKE（anon key 在浏览器 bundle 里）`,
      ).toBe(true)
    }
  })

  it('RPC 的政策时间窗跟应用层同一个口径（C5：不许退回 IS NULL-only）', () => {
    const sql = read(MIGRATION)
    // 政策查询必须是「from<=now 且 (to IS NULL 或 to>now)」——
    // 用 effective_to IS NULL 当过滤条件会把带结束时间但没到期的政策当成不存在
    const windows = sql.match(
      /effective_from\s*<=\s*now\(\)\s+AND\s+\(p\.effective_to\s+IS\s+NULL\s+OR\s+p\.effective_to\s*>\s*now\(\)\)/gi,
    )
    expect(
      (windows ?? []).length >= 2,
      '两个会查政策的 RPC（begin / resolve_pending_approval）的时间窗必须都在，且跟 store.isPolicyActive 完全一致',
    ).toBe(true)
  })
})

describe('两处清单不许分家（S1 / S2）', () => {
  const MIGRATION_SQL = 'supabase/migrations/20260808000003_me2_execution_kernel_v1.sql'
  // 🔴 已合并进 main 的历史迁移不可变（Codex P2，PR #898）：白名单的最新真相在
  //    这条前向迁移里的 CREATE OR REPLACE FUNCTION —— 不管目标环境有没有 apply
  //    过历史迁移，这条语句都会把函数换成最新版本。跟 runner.ts 比对必须用这份
  //    "最终生效" 的 SQL，历史文件本身不再改。
  const RECOVERY_WHITELIST_MIGRATION_SQL =
    'supabase/migrations/20260811040000_kernel_recovery_outward_requires_human_policy.sql'

  it('🔴 可恢复拒绝码：SQL 里的白名单跟 runner.ts 的 RECOVERABLE_DENY_CODES 一字不差', async () => {
    // 真正的强制在 RPC 里（应用层那份只是为了把话说人话）。
    // 两处各写一份清单必然分家 —— 分家的那天，应用层说「不能恢复」而数据库放行，
    // 或者反过来。这条测试是唯一能让它们保持同步的东西。
    const { RECOVERABLE_DENY_CODES } = await import('../runner')
    const sql = read(RECOVERY_WHITELIST_MIGRATION_SQL)
    const m = sql.match(/v_recoverable\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/)
    expect(m, 'kernel_claim_run_recovery 里应该有 v_recoverable 白名单').toBeTruthy()
    const fromSql = Array.from(m![1].matchAll(/'([^']+)'/g)).map((x) => x[1]).sort()
    expect(fromSql).toEqual(Array.from(RECOVERABLE_DENY_CODES).sort())
  })

  it('🔴 历史迁移不可变：已合并的 20260808000003 不再声明新拒绝码，只有前向迁移能加', () => {
    // Codex P2（PR #898）：直接改写已合并迁移，在已经 apply 过它的环境里不生效。
    // 这条测试锁住「历史文件的 v_recoverable 停在最初 4 个码」，
    // 新码只允许从后续的前向迁移里加进来。
    const sql = read(MIGRATION_SQL)
    const m = sql.match(/v_recoverable\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/)
    expect(m, 'kernel_claim_run_recovery 里应该有 v_recoverable 白名单').toBeTruthy()
    const fromSql = Array.from(m![1].matchAll(/'([^']+)'/g)).map((x) => x[1]).sort()
    expect(fromSql).toEqual(
      ['no_policy', 'over_cost_cap', 'policy_changed_since_request', 'policy_expired'],
    )
  })

  it('🔴 前向迁移用 CREATE OR REPLACE FUNCTION —— 已 apply 过历史迁移的环境也能拿到新白名单', () => {
    const sql = read(RECOVERY_WHITELIST_MIGRATION_SQL)
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.kernel_claim_run_recovery/,
    )
    // 新增的码必须在这份前向迁移里，且不在历史迁移里（否则又是原地改写）。
    expect(sql).toContain("'outward_requires_human_policy'")
    const historical = read(MIGRATION_SQL)
    expect(historical).not.toContain('outward_requires_human_policy')
  })

  it('🔴 恢复 RPC 里有状态 CAS 和指针 CAS 两道，且步骤重置在同一个函数里', () => {
    const sql = read(MIGRATION_SQL)
    const fn = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.kernel_claim_run_recovery'),
      sql.indexOf('REVOKE EXECUTE ON FUNCTION public.kernel_claim_run_recovery'),
    )
    expect(fn).toContain('FOR UPDATE')
    // 状态 CAS
    expect(fn).toMatch(/v_run\.status\s*<>\s*p_recovery_kind/)
    // 指针 CAS
    expect(fn).toMatch(/v_run\.authorization_decision_id\s+IS\s+DISTINCT\s+FROM\s+p_expected_decision_id/i)
    // 🔴 步骤重置必须在同一个函数（= 同一个事务）里，不能先 reset 再 update run
    expect(fn).toMatch(/UPDATE\s+public\.action_run_steps/i)
    expect(fn).toMatch(/status\s*<>\s*'succeeded'/)
    // 🔴 而且绝不能碰 cost_actual_usd —— 历史已花的钱不许因为重跑变小
    //
    // 切法：从这条语句自己开头切到**它自己的分号**。
    // 早先是切到「下一条 UPDATE public.action_runs」为止 —— 那依赖两条语句的
    // 书写先后：谁被挪到前面，这里就切出一个空串，而 `expect('').not.toContain(…)`
    // 恒真，这道断言等于静默失效（fail-open）。下面那句 SET 哨兵就是防这个的。
    const startIdx = fn.indexOf('UPDATE public.action_run_steps')
    expect(startIdx, '恢复 RPC 里应该有一条重置步骤的 UPDATE').toBeGreaterThan(-1)
    const endIdx = fn.indexOf(';', startIdx)
    expect(endIdx, '那条 UPDATE 应该以分号收尾').toBeGreaterThan(startIdx)
    const resetStmt = fn.slice(startIdx, endIdx)
    expect(resetStmt, '切出来的必须真是那条语句，不能是空串').toContain('SET status')
    expect(resetStmt).not.toContain('cost_actual_usd')
  })

  it('🔴 接管 RPC：锁 + 状态白名单 + 租约到期判据，缺一不可（T1）', () => {
    const sql = read(MIGRATION_SQL)
    const fn = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.kernel_claim_or_takeover_run'),
      sql.indexOf('REVOKE EXECUTE ON FUNCTION public.kernel_claim_or_takeover_run'),
    )
    expect(fn, '接管 RPC 应该切得出来').toContain('SECURITY DEFINER')
    // 锁：没有它，两个人能同时把 owner 写成自己
    expect(fn).toContain('FOR UPDATE')
    // 状态白名单：终态和 running 一律不许接管
    // 🔴 running **在**白名单里（只有租约过期才轮得到）——
    //    一律排除 running 会让「崩在执行中」的 run 永远没人能接手。
    expect(fn).toMatch(/NOT IN \('queued','authorizing','authorized','running'\)/)
    // 代际（fencing token）：接管必须换代，否则旧执行者醒过来照样能写
    expect(fn).toContain('claim_generation')
    // 租约到期才是接管的依据 —— 判据是时间，不是「看起来没人在动」
    expect(fn).toMatch(/lease_expires_at\s*>\s*now\(\)/)
    // 领到时必须回报**领到那一刻**的状态和决策指针，调用方靠它决定复不复用授权
    expect(fn).toMatch(/v_run\.authorization_decision_id/)
    // 接管审计
    expect(fn).toContain('previous_claimed_by')
    expect(fn).toContain('reclaim_count')
  })

  it('🔴 交接（批准 / 拒绝 / 恢复）都必须清空租约，否则会留下僵尸 owner（T1）', () => {
    const sql = read(MIGRATION_SQL)
    // 三处状态转换都得把租约清干净：留着的话，真正要来推进的人会被
    // 一份 owner 早就走了的租约挡成「已经有人在做了」。
    const resets = sql.match(/lease_expires_at\s*=\s*NULL/gi) ?? []
    expect(
      resets.length,
      '至少三处交接（approve / reject / recovery）要清租约',
    ).toBeGreaterThanOrEqual(3)
  })

  it('🔴 业务副作用要有数据库级唯一兜底 + 续租 / 转人工两个 RPC 都收了口（R10）', () => {
    const sql = read(MIGRATION_SQL)
    // 🔴 续租把「被接管」的窗口压小，压不到零。所以 capability 的业务写入
    //    自己也要有数据库级唯一身份 —— 不能只靠「先 SELECT 再 INSERT」。
    //    **部分**索引：只约束执行内核造的行，人工 / 其它管道不受影响。
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_production_packages_kernel_run[\s\S]{0,200}?WHERE source_payload->>'kernel_run_id' IS NOT NULL/,
    )
    // 两个新 RPC 的 EXECUTE 同样要收口（anon key 在浏览器 bundle 里）
    for (const fn of ['kernel_park_for_human', 'kernel_renew_lease']) {
      expect(
        new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}[^;]*FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated`,
          'i',
        ).test(sql),
        `${fn} 的 EXECUTE 必须显式 REVOKE`,
      ).toBe(true)
    }
    // 🔴 park 的 SQL 语义也要断言 —— 只断 REVOKE 的话，
    //    「真 SQL 验不验代际 / 清不清租约」全靠假件在保证，两边分家没人知道。
    const park = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.kernel_park_for_human'),
      sql.indexOf('REVOKE EXECUTE ON FUNCTION public.kernel_park_for_human'),
    )
    expect(park, 'park RPC 应该切得出来').toContain('SECURITY DEFINER')
    expect(park).toContain('FOR UPDATE')
    expect(park).toMatch(/claim_generation\s+IS DISTINCT FROM\s+p_expected_generation/)
    expect(park).toMatch(/status\s*=\s*'dead_letter'/)
    expect(park).toMatch(/needs_human\s*=\s*true/)
    // 租约三件套必须清空，否则会留下一个还能被自动推进的 owner
    for (const col of ['claimed_by', 'claimed_at', 'lease_expires_at']) {
      expect(park, `park 必须清空 ${col}`).toMatch(new RegExp(`${col}\\s*=\\s*NULL`))
    }

    // 续租的四项 CAS 必须都在 SQL 里
    const renew = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.kernel_renew_lease'),
      sql.indexOf('REVOKE EXECUTE ON FUNCTION public.kernel_renew_lease'),
    )
    expect(renew).toContain('FOR UPDATE')
    expect(renew).toMatch(/claimed_by\s+IS DISTINCT FROM\s+p_owner_id/)
    expect(renew).toMatch(/claim_generation\s+IS DISTINCT FROM\s+p_expected_generation/)
    expect(renew).toMatch(/status\s*<>\s*'running'/)
  })

  it('🔴 单次 / 周期花费上限的 CHECK 也要挡住 NaN 和 Infinity（T2c）', () => {
    const sql = read(MIGRATION_SQL)
    const i = sql.indexOf('CONSTRAINT spend_caps_are_real_amounts')
    expect(i, '政策表上应该有 spend_caps_are_real_amounts 约束').toBeGreaterThan(-1)
    const stmt = sql.slice(i, i + 700)
    // 上限本身是 NaN 的话，`x > NaN` 恒假 —— 授权估算闸、开跑前硬上限、
    // 事后兜底断言会**同时**失效，整条花钱链路一句话都拦不住。
    for (const col of ['spend_cap_per_run_usd', 'spend_cap_per_period_usd']) {
      expect(stmt).toContain(`${col} >= 0`)
      expect(stmt).toContain(`${col} <> 'NaN'::numeric`)
      expect(stmt).toContain(`${col} <  'Infinity'::numeric`)
    }
  })

  it('🔴 cost_actual_usd 的 CHECK 必须显式挡住 NaN 和 Infinity（T3）', () => {
    const sql = read(MIGRATION_SQL)
    const stmt = sql.slice(
      sql.indexOf('CONSTRAINT cost_actual_usd_is_a_real_amount'),
      sql.indexOf('CONSTRAINT cost_actual_usd_is_a_real_amount') + 400,
    )
    expect(stmt, 'CHECK 约束应该切得出来').toContain('CHECK')
    // 🔴 `>= 0` 一条拦不住 NaN —— numeric 里 `'NaN' >= 0` 是 **true**（生产 PG 17.6 实测）。
    expect(stmt).toContain('>= 0')
    expect(stmt).toMatch(/<>\s*'NaN'::numeric/)
    expect(stmt).toMatch(/<\s*'Infinity'::numeric/)
  })

  it('🔴 execution_item 的复合外键和前置唯一索引都在（S2 的库层那道）', () => {
    const sql = read(MIGRATION_SQL)
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_items_client_id_id')
    expect(
      /FOREIGN KEY \(client_id, execution_item_id\)[\s\S]{0,80}?REFERENCES public\.execution_items \(client_id, id\)/.test(
        sql,
      ),
      'action_runs 必须有 (client_id, execution_item_id) → execution_items(client_id, id) 的复合外键',
    ).toBe(true)
  })

  it('🔴 两条复合外键的删除语义各自钉死，且各只有一条外键', () => {
    const sql = read(MIGRATION_SQL)
    const runs = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS public.action_runs'),
      sql.indexOf('CREATE TABLE IF NOT EXISTS public.action_run_steps'),
    )
    expect(runs, 'action_runs 建表语句应该切得出来').toContain('goal_matches_purpose')

    // 卡片：删得掉，台账留下 → SET NULL，且**必须带列清单**
    // （不带列清单会去置空 NOT NULL 的 client_id，整条 DELETE 当场炸）
    expect(runs).toMatch(
      /FOREIGN KEY \(client_id, execution_item_id\)[\s\S]{0,120}?ON DELETE SET NULL \(execution_item_id\)/,
    )
    // 目标：有台账就删不掉 → 刻意不写 ON DELETE（= NO ACTION）
    const goalFk = runs.slice(
      runs.indexOf('CONSTRAINT fk_action_runs_goal_same_client'),
      runs.indexOf('CONSTRAINT fk_action_runs_execution_item_same_client'),
    )
    expect(goalFk, 'goal 的复合外键应该切得出来').toContain('REFERENCES public.goals')
    expect(goalFk).not.toContain('ON DELETE')

    // 🔴 每列**只能有一条**外键。两条并存时，删除走哪条要看约束 OID
    // （= 建表里的书写顺序），等于把「删得掉删不掉」押在书写次序上。
    expect(runs.match(/REFERENCES public\.goals/g) ?? []).toHaveLength(1)
    expect(runs.match(/REFERENCES public\.execution_items/g) ?? []).toHaveLength(1)
  })
})

describe('注册表的封闭性', () => {
  it('capability 的实现集合跟注册表的动作集合完全对齐', async () => {
    const { ACTION_KEYS } = await import('../registry')
    const { createCapabilities } = await import('@/lib/capabilities')
    const impls = Object.keys(createCapabilities({} as never))
    expect(
      impls.sort(),
      '注册表里有、实现里没有 = 提交了会死信；实现里有、注册表里没有 = 一条永远调不到的路。',
    ).toEqual([...ACTION_KEYS].sort())
  })

  it('每个动作定义都把幂等 / 重试 / 副作用 / 风险说清楚了', async () => {
    const { ACTION_REGISTRY, ACTION_KEYS } = await import('../registry')
    for (const key of ACTION_KEYS) {
      const def = ACTION_REGISTRY.get(key)!
      expect(def.idempotency.keyFields.length, `${key} 必须声明幂等键字段`).toBeGreaterThan(0)
      expect(def.retryPolicy.maxAttempts, `${key} 必须声明重试上限`).toBeGreaterThan(0)
      expect(def.steps.length, `${key} 必须至少有一个步骤`).toBeGreaterThan(0)
      // 🔴 对外副作用：从「一律不许出现」换成「逐动作说清楚才许出现」。
      //    判据是同一个 predicate，授权层与 Gateway 用的也是它 ——
      //    所以注册表里能待着的对外动作，一定是那两道闸也会放行的那种。
      //    当前注册表里零个对外动作，这条对它们**恒真**（非 outward 直接返回 null）；
      //    将来加第一个对外动作时，它不用改这条断言，只需要把声明写完整。
      expect(
        outwardBlockReason(def),
        `${key}：对外动作必须带完整的 outwardAuthorization 声明才能进注册表`,
      ).toBeNull()
      // 幂等键字段必须真的在输入契约里，否则提交时算不出来
      for (const f of def.idempotency.keyFields) {
        expect(
          Object.keys(def.inputSchema.properties),
          `${key} 的幂等键字段「${f}」必须出现在 input_schema 里`,
        ).toContain(f)
      }
    }
  })
})
