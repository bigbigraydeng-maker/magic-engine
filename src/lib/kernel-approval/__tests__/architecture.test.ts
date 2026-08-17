/**
 * K-WP01A —— 审批面的依赖边界。
 *
 * 🔴 **要证明的事只有一句：这条路上执行不了任何 capability。**
 *
 *    行为测试已经盯着「批准之后一步都没跑」，但那只覆盖走到的那几条路。
 *    这里从**依赖图**上再断一次：审批层与它的三个路由文件里，
 *    根本不许出现执行入口。少了这一道，将来有人在某个错误分支里
 *    补一句 `approveAndRun(...)`，行为测试不一定走得到那条分支。
 *
 * 🔴 扫描前先把注释挖空 —— 否则**讲解这条规则的注释本身**会被当成罪证
 *    （这个仓库为此踩过好几次，见 `kernel/__tests__/architecture.test.ts`）。
 *    这里的挖空跟那边同源：走 TypeScript 解析器，不猜。
 */

import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()

/** 审批面 = 应用层 + 三个路由目录。两边用同一套禁令。 */
export const APPROVAL_SURFACE_DIRS = [
  'src/lib/kernel-approval',
  'src/app/api/kernel/approvals',
] as const

/**
 * 🔴 **函数长度那道闸要多盖一个文件。**（Codex P1）
 *
 *    `APPROVAL_SURFACE_DIRS` 管的是「不许出现执行入口」，那是审批面自己的规矩，
 *    不该套到 Kernel 上。但函数长度是**全仓铁律**，而真正承载审批状态转换的
 *    `human-approval.ts` 不在审批面目录里 —— 于是守卫看起来盖住了审批链路，
 *    实际把最长的那两个函数（`approveRun` 126 行、`rejectRun` 62 行）漏在外面。
 *
 *    一个「看起来覆盖了、其实没有」的守卫比没有守卫更糟：它给的是假安心。
 *    所以两张清单分开，各自说清自己管什么。
 */
export const FUNCTION_LENGTH_SCAN_PATHS = [
  ...APPROVAL_SURFACE_DIRS,
  'src/lib/kernel/human-approval.ts',
] as const

/**
 * 审批面**不许**出现的东西。
 *
 * 每一条都对应一种「审批顺手把事情做了」的写法：
 *   · `@/lib/capabilities`      —— 干活的实现本身
 *   · `@/lib/kernel/gateway`    —— 真正的执行器
 *   · `@/lib/kernel/runner`     —— `approveAndRun` / `runAction` 住在这儿
 *   · `@/lib/kernel`（门面）    —— 它 re-export 了上面两样，而且会把 capability 层
 *                                  整个拉进模块图。审批面只准从 `kernel/*` 的
 *                                  **授权段**子模块取东西
 */
export const APPROVAL_FORBIDDEN_IMPORTS = [
  '@/lib/capabilities',
  '@/lib/kernel/gateway',
  '@/lib/kernel/runner',
] as const

/** 门面要精确匹配 —— `@/lib/kernel/authorize` 是允许的，`@/lib/kernel` 本身不是。 */
export const APPROVAL_FORBIDDEN_EXACT_IMPORTS = ['@/lib/kernel'] as const

/** 出现即违规的执行入口标识符。 */
export const APPROVAL_FORBIDDEN_SYMBOLS = [
  'approveAndRun',
  'rejectPendingRun',
  'executeAuthorizedRun',
  'runAction',
  'createCapabilities',
] as const

const SOURCE_EXT = ['.ts', '.tsx'] as const
const isTest = (p: string) =>
  SOURCE_EXT.some((ext) => p.endsWith(`.test${ext}`)) || p.includes('/__tests__/')

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (SOURCE_EXT.some((ext) => entry.endsWith(ext))) out.push(full)
  }
  return out
}

const surfaceFiles = (): string[] =>
  APPROVAL_SURFACE_DIRS.flatMap((d) => walk(join(ROOT, d)))
    .map((f) => relative(ROOT, f).split('\\').join('/'))
    .filter((f) => !isTest(f))

/** 注释挖空 —— 保留换行与列宽，判据由解析器给，不用正则猜。 */
function stripComments(src: string, fileName: string): string {
  const sourceFile = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, false)
  const ranges = new Map<string, ts.CommentRange>()
  const collect = (pos: number, trailing: boolean): void => {
    const found = trailing
      ? ts.getTrailingCommentRanges(src, pos)
      : ts.getLeadingCommentRanges(src, pos)
    for (const r of found ?? []) ranges.set(`${r.pos}:${r.end}`, r)
  }
  const visit = (node: ts.Node): void => {
    collect(node.pos, false)
    collect(node.end, true)
    for (const child of node.getChildren(sourceFile)) visit(child)
  }
  visit(sourceFile)
  collect(sourceFile.endOfFileToken.pos, false)

  const chars = src.split('')
  ranges.forEach((r) => {
    for (let i = r.pos; i < r.end && i < chars.length; i++) {
      if (chars[i] !== '\n') chars[i] = ' '
    }
  })
  return chars.join('')
}

/** 一段源码里所有模块说明符（import / export…from / import() / require）。 */
export function moduleSpecifiersOf(code: string, fileName = 'scan.ts'): string[] {
  const specs: string[] = []
  const record = (expr: ts.Expression | undefined): void => {
    if (expr && ts.isStringLiteralLike(expr)) specs.push(expr.text)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) record(node.moduleSpecifier)
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) record(node.moduleSpecifier)
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) record(node.arguments[0])
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        record(node.arguments[0])
      }
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteralLike(arg.literal)) record(arg.literal)
    }
    node.forEachChild(visit)
  }
  visit(ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false))
  return specs
}

/** 这段源码里出现的、被禁的执行入口标识符。 */
export function forbiddenSymbolsIn(code: string, fileName = 'scan.ts'): string[] {
  const hits = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && (APPROVAL_FORBIDDEN_SYMBOLS as readonly string[]).includes(node.text)) {
      hits.add(node.text)
    }
    node.forEachChild(visit)
  }
  visit(ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false))
  // 🔴 `Array.from` 而不是 `[...hits]` —— 仓库 tsconfig 没设 target，
  //    直接展开 Set 的迭代器会撞 TS2802（要 downlevelIteration）。
  return Array.from(hits)
}

/** 一个文件的全部违规原因。 */
export function violationsFor(file: string, code: string): string[] {
  const out: string[] = []
  for (const spec of moduleSpecifiersOf(code, file)) {
    if (APPROVAL_FORBIDDEN_IMPORTS.some((m) => spec === m || spec.startsWith(`${m}/`))) {
      out.push(`${file} → import ${spec}`)
    }
    if ((APPROVAL_FORBIDDEN_EXACT_IMPORTS as readonly string[]).includes(spec)) {
      out.push(`${file} → import ${spec}（门面会把 capability 层整个拉进来，只准 import kernel/* 的授权段子模块）`)
    }
  }
  for (const sym of forbiddenSymbolsIn(code, file)) out.push(`${file} → 出现执行入口 ${sym}`)
  return out
}


/**
 * 🔴 **文件行数上限是仓库铁律，不是建议**（CLAUDE.md：函数 < 50 行，文件 < 800 行）。
 *
 * 这条盯的是审批链路上那几个**安全核心**文件。它们最容易一点点长胖 ——
 * 自动授权 + 授权复用 + 人工审批 + 错误翻译全挤在一个文件里之后，
 * 后续改动就很难被完整审查（实测：`authorize.ts` 曾涨到 894 行，Codex P1）。
 */
describe('🔴 安全核心文件不许越过 800 行', () => {
  const MAX_LINES = 800
  const GUARDED = [
    'src/lib/kernel/authorize.ts',
    'src/lib/kernel/human-approval.ts',
    'src/lib/kernel/store.ts',
    'src/lib/kernel/rpc-versioning.ts',
    'src/lib/kernel-approval/service.ts',
    'src/lib/kernel-approval/queries.ts',
    'src/lib/kernel-approval/http.ts',
    'src/lib/kernel-approval/errors.ts',
  ] as const

  /**
   * 🔴 **历史欠账，只准变短。**
   *
   *    `gateway.ts` 在本 PR 之前就是 1222 行 —— 不是这次改出来的，
   *    拆它也远超本 PR 的范围。但**不许静默放过**：记在这里，
   *    并且钉住当前行数，它再涨就红。要拆是另一件事、另一个 PR。
   */
  const GRANDFATHERED: Readonly<Record<string, number>> = {
    'src/lib/kernel/gateway.ts': 1222,
  }

  const lineCount = (file: string): number =>
    readFileSync(join(ROOT, file), 'utf8').split('\n').length

  it.each([...GUARDED])('%s < 800 行', (file) => {
    const lines = lineCount(file)
    expect(lines, `${file} 有 ${lines} 行，越过了 ${MAX_LINES} 行的上限 —— 该拆了`).
      toBeLessThanOrEqual(MAX_LINES)
  })

  it('🔴 判据本身有效：数出来的是真行数，不是一个常数', () => {
    // 🔴 没有这一条的话，把 `lineCount` 写成 `() => 1` 全套照样绿 ——
    //    「文件都没超」和「根本没在数」长得一模一样（实测变异探针 MISSED）。
    //    拿历史欠账那个文件当锚：它**确实**超过上限，数对了才可能看见。
    expect(
      lineCount('src/lib/kernel/gateway.ts'),
      '这个文件本来就 >800 行；数出来没超 = 计数坏了，整道闸在空跑',
    ).toBeGreaterThan(MAX_LINES)
    // 再钉一个下界，防止「返回一个够大的常数」也能糊过去
    expect(lineCount('src/lib/kernel-approval/types.ts')).toBeLessThan(200)
  })

  it('🔴 历史欠账只准变短，不许再涨', () => {
    for (const [file, cap] of Object.entries(GRANDFATHERED)) {
      const lines = lineCount(file)
      expect(
        lines,
        `${file} 从 ${cap} 涨到了 ${lines} 行。它本来就欠着账，不许再往上加 —— ` +
          '要么把新代码放到别处，要么先把它拆了。',
      ).toBeLessThanOrEqual(cap)
    }
  })
})

/**
 * 🔴 **函数行数上限同样是铁律**（CLAUDE.md：函数 < 50 行）。
 *
 * 一个 70 行、同时干五件事的解析函数，改审批输入契约时没人能完整审查
 * （实测：`parseDecisionInput` 曾 72 行，Codex P1）。
 */
describe('🔴 审批面的函数不许越过 50 行', () => {
  const MAX_FN_LINES = 50

  /** 从 `export function name(` 数到同缩进的 `}`。够用，不引解析器。 */
  function functionLengths(file: string): Array<[name: string, lines: number]> {
    const src = readFileSync(join(ROOT, file), 'utf8').split('\n')
    const out: Array<[string, number]> = []
    for (let i = 0; i < src.length; i++) {
      const m = /^(export )?(async )?function (\w+)/.exec(src[i])
      if (!m) continue
      for (let j = i + 1; j < src.length; j++) {
        if (src[j] === '}') {
          out.push([m[3], j - i + 1])
          break
        }
      }
    }
    return out
  }

  it.each(
    FUNCTION_LENGTH_SCAN_PATHS.flatMap((p) => {
      const full = join(ROOT, p)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })
      .map((f) => relative(ROOT, f).split('\\').join('/'))
      .filter((f) => !isTest(f)),
  )('%s 里每个函数 < 50 行', (file) => {
    const tooLong = functionLengths(file).filter(([, n]) => n > MAX_FN_LINES)
    expect(
      tooLong.map(([n, l]) => `${n}(${l} 行)`),
      `${file} 里这些函数越过了 ${MAX_FN_LINES} 行 —— 拆成小函数`,
    ).toEqual([])
  })

  /**
   * 🔴 **扫描清单写死一份，不从被测常量派生。**
   *
   *    `it.each` 是从清单**生成**用例的：把某个路径从清单里拿掉，
   *    只是少跑一条用例 —— 一条都不会红。守卫被掏空而测试全绿，
   *    跟 `APPROVAL_FORBIDDEN_SYMBOLS` 那次是同一个自证陷阱
   *    （变异探针第一轮就是这么漏过去的）。
   */
  const MUST_BE_SCANNED = [
    'src/lib/kernel-approval',
    'src/app/api/kernel/approvals',
    'src/lib/kernel/human-approval.ts',
  ] as const

  it('🔴 扫描清单不许被悄悄改短（尤其别漏掉真正做审批状态转换的那个文件）', () => {
    expect(
      [...FUNCTION_LENGTH_SCAN_PATHS].sort(),
      '这份清单只准变长。漏掉一个路径 = 守卫看起来盖住了、实际没有 —— 那是假安心。',
    ).toEqual([...MUST_BE_SCANNED].sort())
  })

  it('🔴 判据本身有效：真的数得出函数长度（不是永远空数组）', () => {
    const found = functionLengths('src/lib/kernel-approval/service.ts')
    expect(found.length, '一个函数都没数到 = 判据在空跑').toBeGreaterThan(3)
  })
})

describe('🔴 审批面执行不了 capability（真实文件）', () => {
  it('审批面确实有文件被扫到（判据不许空跑就绿）', () => {
    const files = surfaceFiles()
    expect(files.length, '一个文件都没扫到 = 这道闸整个失效了').toBeGreaterThanOrEqual(6)
    expect(files).toContain('src/lib/kernel-approval/service.ts')
    expect(files).toContain('src/app/api/kernel/approvals/route.ts')
    expect(files).toContain('src/app/api/kernel/approvals/[runId]/decision/route.ts')
  })

  it('🔴 审批层与三个路由里没有任何执行入口', () => {
    const violations = surfaceFiles().flatMap((file) =>
      violationsFor(file, stripComments(readFileSync(join(ROOT, file), 'utf8'), file)),
    )
    expect(
      violations,
      '审批只负责签授权，run 停在 authorized 就结束了。\n' +
        '把 authorized 真正跑掉是 WP07 的事 —— 在这条路上接执行入口，\n' +
        '等于人一点头东西就发出去了，而这个 PR 从没验证过那条路。\n' +
        violations.join('\n'),
    ).toEqual([])
  })
})

/**
 * 🔴 **盯着这道闸本身。**
 *
 * 上面那条扫的是真实文件，而真实文件现在是干净的 —— 它**永远绿**，
 * 绿得跟「判据整个失效了」一模一样。所以这一组用合成源码逐项证明：
 * 每一种把执行入口拉进来的写法都真的会被发现。
 */
describe('🔴 判据盖得住各种写法（合成源码）', () => {
  const FILE = 'src/lib/kernel-approval/service.ts'

  it.each([
    ['具名导入 runner', `import { approveAndRun } from '@/lib/kernel/runner'`],
    ['具名导入门面', `import { approveAndRun } from '@/lib/kernel'`],
    ['导入 capability 层', `import { createCapabilities } from '@/lib/capabilities'`],
    ['导入 gateway', `import { executeAuthorizedRun } from '@/lib/kernel/gateway'`],
    ['副作用导入', `import '@/lib/capabilities'`],
    ['动态导入', `const m = await import('@/lib/kernel/runner')`],
    ['require', `const m = require('@/lib/kernel/runner')`],
    ['再导出', `export { approveAndRun } from '@/lib/kernel/runner'`],
    ['子路径', `import { x } from '@/lib/capabilities/seo/build-publish-package'`],
    ['类型层引用', `type T = import('@/lib/kernel/runner').ActionRunOutcome`],
  ])('%s → 必须被发现', (_label, code) => {
    expect(violationsFor(FILE, code)).not.toEqual([])
  })

  /**
   * 🔴 **用例名单在这里写死，不从 `APPROVAL_FORBIDDEN_SYMBOLS` 派生。**
   *
   *    派生版是**自证**的：把清单里的 `approveAndRun` 换成一个永远不出现的名字，
   *    `it.each` 就跟着改成测那个假名字，照样全绿 —— 清单被掏空了而没有一条测试变红。
   *    （这不是假设：变异探针第一轮就是这么漏过去的。）
   *    写死之后，谁把某一条从清单里拿掉，这里立刻红。
   */
  const MUST_BE_FORBIDDEN = [
    'approveAndRun',
    'rejectPendingRun',
    'executeAuthorizedRun',
    'runAction',
    'createCapabilities',
  ] as const

  it('🔴 禁令清单不许被悄悄改短（两边必须一字不差）', () => {
    expect(
      [...APPROVAL_FORBIDDEN_SYMBOLS].sort(),
      '这份清单只准变长。要拿掉某一条，得先说清楚为什么审批面可以碰它。',
    ).toEqual([...MUST_BE_FORBIDDEN].sort())
  })

  it.each([...MUST_BE_FORBIDDEN])(
    '🔴 光是出现标识符 %s 就算违规（哪怕换个路子拿到它）',
    (symbol) => {
      expect(violationsFor(FILE, `const f = deps.${symbol}\n${symbol}(deps, runId, actor)`)).not.toEqual([])
    },
  )

  it('✅ 授权段的子模块是允许的（这才是审批面该用的东西）', () => {
    const clean = [
      `import { approveRun, rejectRun } from '@/lib/kernel/authorize'`,
      `import { ACTION_REGISTRY } from '@/lib/kernel/registry'`,
      `import { createKernelDeps } from '@/lib/kernel/deps'`,
      `import { TABLE_RUNS } from '@/lib/kernel/store'`,
      `import type { ActionRun } from '@/lib/kernel/types'`,
      `import { KernelError } from '@/lib/kernel/errors'`,
    ].join('\n')
    expect(violationsFor(FILE, clean)).toEqual([])
  })

  it('🔴 只写在注释里的示例不算违规（判据不许把自己的文档当罪证）', () => {
    const commented = [
      `// import { approveAndRun } from '@/lib/kernel/runner'`,
      `/* const c = require('@/lib/capabilities') */`,
      `/**`,
      ` * 绝不 import '@/lib/capabilities'，也不调 executeAuthorizedRun`,
      ` */`,
      `const real = 1`,
    ].join('\n')
    expect(violationsFor(FILE, stripComments(commented, FILE))).toEqual([])
  })
})

/**
 * 🔴 **文件行数也是全仓铁律（CLAUDE.md：文件 < 800 行），测试文件不例外。**
 *
 * 这条不是洁癖：`codex-p2.test.ts` 长到 974 行时，它同时装着归属身份、
 * 分页、写路径竞态、SQL 守卫四类完全不同的回归 —— 改任何一类都没人能
 * 完整审查这份套件。而上一版的行数守卫只扫**生产**文件，CI 一声不吭。
 *
 * 🔴 清单**写死**，并且有一条独立的固定断言盯着它（见下）。
 *    不能只靠 `it.each` —— 那是从清单**生成**用例的：把一个路径从清单里拿掉
 *    只会少跑一条，一条都不会红。这个自证陷阱在本 PR 里已经踩过两次
 *    （`APPROVAL_FORBIDDEN_SYMBOLS` 一次、`FUNCTION_LENGTH_SCAN_PATHS` 一次）。
 */
describe('🔴 审批面的文件不许越过 800 行', () => {
  const MAX_FILE_LINES = 800

  /** 本 PR 新增 / 改动的审批相关文件，**逐个写死**。只准变长。 */
  const FILES_UNDER_LINE_LIMIT = [
    'src/lib/kernel-approval/errors.ts',
    'src/lib/kernel-approval/http.ts',
    'src/lib/kernel-approval/queries.ts',
    'src/lib/kernel-approval/service.ts',
    'src/lib/kernel-approval/types.ts',
    'src/lib/kernel/human-approval.ts',
    'src/lib/kernel-approval/__tests__/_fixtures.ts',
    'src/lib/kernel-approval/__tests__/anchor-identity.test.ts',
    'src/lib/kernel-approval/__tests__/architecture.test.ts',
    'src/lib/kernel-approval/__tests__/decision-input.test.ts',
    'src/lib/kernel-approval/__tests__/decision.test.ts',
    'src/lib/kernel-approval/__tests__/not-provisioned.test.ts',
    'src/lib/kernel-approval/__tests__/pagination.test.ts',
    'src/lib/kernel-approval/__tests__/rollout-compat.test.ts',
    'src/lib/kernel-approval/__tests__/sql-contract.test.ts',
    'src/lib/kernel-approval/__tests__/tier-gate.test.ts',
    'src/lib/kernel-approval/__tests__/write-path-cas.test.ts',
    'src/app/api/kernel/approvals/route.ts',
    'src/app/api/kernel/approvals/[runId]/route.ts',
    'src/app/api/kernel/approvals/[runId]/decision/route.ts',
    'src/app/api/kernel/approvals/__tests__/route.test.ts',
  ] as const

  it.each([...FILES_UNDER_LINE_LIMIT])('%s < 800 行', (file) => {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n').length
    expect(lines, `${file} 有 ${lines} 行 —— 按主题拆开，别靠合并断言压行数`).toBeLessThan(
      MAX_FILE_LINES,
    )
  })

  /**
   * 🔴 **独立的固定断言：清单必须盖住审批面**上真实存在的每一个文件。
   *
   *    没有这一条，把某个文件从 `FILES_UNDER_LINE_LIMIT` 里删掉就等于给它免检，
   *    而 `it.each` 只会少跑一条、一条都不会红 —— 守卫被掏空且全绿。
   *    这里反过来从**文件系统**列一遍，两边对不上就红。
   */
  it('🔴 清单盖住审批面上每一个真实文件（漏一个就等于给它免检）', () => {
    const onDisk = [
      ...APPROVAL_SURFACE_DIRS.flatMap((d) => walk(join(ROOT, d))),
      join(ROOT, 'src/lib/kernel/human-approval.ts'),
    ]
      .map((f) => relative(ROOT, f).split('\\').join('/'))
      .sort()

    expect(
      [...FILES_UNDER_LINE_LIMIT].sort(),
      '审批面上有文件没进行数清单 —— 加文件时必须同时加进来，否则它永远不受这条铁律管',
    ).toEqual(onDisk)
  })
})
