/**
 * docs/ENV.md 的「配在哪」这一格，对 **worker 服务**必须说得准。
 *
 * 🔴 从 registry.test.ts 拆出来（Codex thread：registry.test.ts L894）。
 *    那个文件被这套 worker 审计撑到 894 行，越过 CLAUDE.md 的「文件 < 800 行」硬线。
 *    拆分点是自然的：那边管「cron 清单跟 render.yaml 对不对得上」，
 *    这边管「ENV.md 说的配置位置跟真实 worker 对不对得上」——两件事，两组判据。
 *
 * 这里的判据一条都不许靠人工清单：服务名从 ENV.md 那一格里取，入口从 render.yaml 的
 * dockerfilePath → Dockerfile 的 CMD 取，读取方沿入口文件的依赖闭包递归走。
 */
import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync, existsSync, statSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../..')

/** ENV.md 那张表里每个变量的「配在哪」。跟 registry.test.ts 里那份同源，刻意各自独立。 */
function allEnvDocLocations(): Map<string, string> {

  const lines = readFileSync(path.join(ROOT, 'docs/ENV.md'), 'utf8').split('\n')
  const cellsOf = (l: string) => l.split('|').slice(1, -1).map((c) => c.trim())
  const out = new Map<string, string>()
  let col = -1
  for (const line of lines) {
    if (!line.trimStart().startsWith('|')) { col = -1; continue }
    const cells = cellsOf(line)
    const h = cells.findIndex((c) => c.includes('配在哪'))
    if (h >= 0) { col = h; continue }
    if (col < 0 || col >= cells.length) continue
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
    Array.from(cells[0].matchAll(/`([A-Z][A-Z0-9_]*)`/g)).forEach((m) => out.set(m[1], cells[col]))
  }
  return out
}

/**
 * 标着「配在某个 worker 服务上」的变量，那条链必须是真的。
 *
 * 「Render-web + worker `content-factory-render-worker`」这种写法点了名，就得有人核对：
 * 服务还在不在、还叫不叫这个名、有没有声明这个变量、那个容器跑的入口文件是不是还
 * 真的（经 import 链）读它。缺了这层，worker 被删 / 改名 / 撤掉密钥 / 断掉 import，
 * 文档照样绿着骗人。
 *
 * 全部从文件推：服务名从 ENV.md 那一格里取，入口从 render.yaml 的 dockerfilePath →
 * Dockerfile 的 CMD 取，读取方沿入口文件的 `@/lib/*` import 走一跳。
 */
describe('docs/ENV.md 里带 worker 服务名的标注，必须跟真实 worker 对得上', () => {
  type WorkerSvc = { name: string; dockerfilePath: string; keys: string[] }

  function workerServices(): WorkerSvc[] {
    const txt = readFileSync(path.join(ROOT, 'render.yaml'), 'utf8')
    return Array.from(
      txt.matchAll(/-\s+type:\s+worker\s*\n\s+name:\s*(\S+)([\s\S]*?)(?=\n\s*-\s+type:|$)/g),
    ).map((m) => ({
      name: m[1],
      dockerfilePath: /dockerfilePath:\s*(\S+)/.exec(m[2])?.[1] ?? '',
      keys: Array.from(m[2].matchAll(/-\s+key:\s*(\S+)/g)).map((k) => k[1]),
    }))
  }

  /** 「配在哪」那一格里点名的 worker 服务名：worker `xxx`。 */
  const workerNameIn = (where: string) => /worker\s+`([^`]+)`/.exec(where)?.[1] ?? null

  /** Dockerfile 的 CMD 里跑的那个仓内文件。 */
  function entrypointOf(dockerfilePath: string): string | null {
    const f = path.join(ROOT, dockerfilePath.replace(/^\.\//, ''))
    if (!existsSync(f)) return null
    const cmd = /^\s*(?:CMD|ENTRYPOINT)\s+(.+)$/im.exec(readFileSync(f, 'utf8'))?.[1] ?? ''
    const rel = Array.from(cmd.matchAll(/"([^"]+)"/g))
      .map((m) => m[1])
      .find((a) => /\.(ts|tsx|mjs|cjs|js)$/.test(a))
    return rel && existsSync(path.join(ROOT, rel)) ? rel : null
  }

  /**
   * 这个文件里有没有**真的**读 `process.env.<envName>`。
   *
   * 🔴 **判据必须走解析器，不能拿正则扫源码文本。**（Codex thread：registry.test.ts L588）
   *    原来是一条带标识符边界的正则。标识符边界只解决了 `X_V2` 不算读了 `X`，
   *    解决不了**这段文本压根不是代码**的情况：worker 里真正的读取被删掉之后，
   *    只要文件里还留着
   *        // process.env.FOO was removed
   *        const hint = 'set process.env.FOO before running'
   *    正则照样命中 → ENV.md 继续声称 worker 需要这个变量，而读取链校验一路绿。
   *    「文档说要配」和「其实没人读」在这条测试里长得一模一样，正是它要防的那种病。
   *
   *    改成解析 AST，只接受**真实的属性访问表达式**：`process.env.FOO` 与
   *    `process.env['FOO']`（含反引号）。注释是 trivia、字符串内容不会被解析成表达式，
   *    所以这两类伪读取从根上就进不了判定，不是再补一条正则。
   *    仓库自带 TypeScript（devDependency），不引入任何新依赖。
   */
  function readsEnvVar(source: string, fileName: string, envName: string): boolean {
    const kind = fileName.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : fileName.endsWith('.jsx')
        ? ts.ScriptKind.JSX
        : /\.(js|mjs|cjs)$/.test(fileName)
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, kind)

    /** 这个表达式是不是 `process.env` 本身。 */
    const isProcessEnv = (node: ts.Expression): boolean =>
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      node.name.text === 'env'

    let found = false
    const visit = (node: ts.Node): void => {
      if (found) return
      // process.env.FOO
      if (
        ts.isPropertyAccessExpression(node) &&
        isProcessEnv(node.expression) &&
        node.name.text === envName
      ) {
        found = true
        return
      }
      // process.env['FOO'] / process.env[`FOO`]
      if (
        ts.isElementAccessExpression(node) &&
        isProcessEnv(node.expression) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === envName
      ) {
        found = true
        return
      }
      // 🔴 解构读取：const { FOO } = process.env / const { FOO: bar } = process.env（Issue #948）
      //    原来只认属性访问与下标访问，解构写法命中数为 0 —— 依赖链上有人这么写就整个绕过去了。
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        isProcessEnv(node.initializer) &&
        ts.isObjectBindingPattern(node.name)
      ) {
        for (const el of node.name.elements) {
          // `{ FOO: bar }` 读的是 FOO（propertyName），不是 bar
          const key = el.propertyName ?? el.name
          if (ts.isIdentifier(key) && key.text === envName) {
            found = true
            return
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return found
  }

  /**
   * 这个文件里所有指向**仓库内**的模块说明符。外部包（`react` / `@supabase/...`）返回不了路径，
   * 自然被排除。走 AST 而不是正则：`from '…'` / `export … from '…'` / 动态 `import('…')` /
   * `require('…')` 四种入口一次收全，注释和字符串里长得像 import 的东西不会混进来。
   */
  function importSpecifiers(source: string, fileName: string): string[] {
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      false,
      fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const out: string[] = []
    const visit = (node: ts.Node): void => {
      // 🔴 **跳过 type-only 的边 —— 它们编译期就被抹掉，运行时根本不加载。**
      //    实测误报：worker → lecture-render → brief-injector
      //      --(import type { MasterBrief })--> src/types/magic-engine.ts
      //      --(export type { ContentAuditResult })--> blog/content-auditor.ts → brief/jina.ts
      //    于是 JINA_API_KEY 被判成「worker 没兜底地读它」，要求去 render.yaml 补一个
      //    这个 worker 永远用不到的密钥。跟着类型边走，闭包会顺着 types 桶蔓延到全仓，
      //    判据从「起不来」退化成「什么都要配」，然后被人当噪音关掉。
      //    只跳显式的 `import type` / `export type`；`import 'x'`（副作用导入）和
      //    混着值的具名导入都照跟 —— 那些运行时真的会加载。
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return
      if (ts.isExportDeclaration(node) && node.isTypeOnly) return
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        out.push(node.moduleSpecifier.text)
      }
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        out.push((node.arguments[0] as ts.StringLiteralLike).text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return out
  }

  /** 把一个模块说明符解析成仓库内的文件路径；外部包 / 解析不到都返回 null。 */
  function resolveModule(spec: string, fromFile: string): string | null {
    let base: string
    if (spec.startsWith('@/')) base = path.join('src', spec.slice(2))
    else if (spec.startsWith('./') || spec.startsWith('../')) base = path.join(path.dirname(fromFile), spec)
    else return null

    for (const cand of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mts`,
      `${base}.cts`,
      `${base}.js`,
      `${base}.mjs`,
      `${base}.cjs`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
    ]) {
      const full = path.join(ROOT, cand)
      if (existsSync(full) && statSync(full).isFile()) return cand.split('\\').join('/')
    }
    return null
  }

  /**
   * 入口文件**传递闭包**：入口 + 它经由仓库内 import 能到达的一切文件。
   *
   * 🔴 **必须递归，只看直接 import 会漏掉真实依赖。**（Codex thread：registry.test.ts L664）
   *    实测两条两跳以上的链，原来一条都看不见：
   *      worker.ts → render-pipeline.ts → scene-plan.ts  → anthropic/client.ts  要 ANTHROPIC_API_KEY
   *      worker.ts → render-pipeline.ts → broll-clip.ts  → muapi/client.ts      要 MUAPI_API_KEY
   *    而且中间那一跳 `./scene-plan` 是**相对路径**，原实现只认 `from '@/lib/…'`，
   *    连第一跳都接不上 —— 于是 worker 缺这两把 key 会启动即崩，而反向核对一路绿。
   *
   *    深度不设限（靠 visited 去重收敛），但设一个总数上限：真炸开了要报错，
   *    不能让判据变成一个慢到没人跑的东西。
   */
  const MAX_CLOSURE_FILES = 800
  const closureCache = new Map<string, string[]>()
  function moduleClosure(entry: string): string[] {
    const cached = closureCache.get(entry)
    if (cached) return cached

    const seen = new Set<string>()
    const queue = [entry]
    while (queue.length > 0) {
      const file = queue.shift() as string
      if (seen.has(file)) continue
      seen.add(file)
      if (seen.size > MAX_CLOSURE_FILES) {
        throw new Error(`${entry} 的依赖闭包超过 ${MAX_CLOSURE_FILES} 个文件，判据需要重新设计`)
      }
      const source = readFileSync(path.join(ROOT, file), 'utf8')
      for (const spec of importSpecifiers(source, file)) {
        const resolved = resolveModule(spec, file)
        if (resolved && !seen.has(resolved)) queue.push(resolved)
      }
    }

    const files = Array.from(seen)
    closureCache.set(entry, files)
    return files
  }

  /** 入口文件的整条依赖链上，谁读了这个变量。 */
  function readsVia(entry: string, envName: string): string[] {
    return moduleClosure(entry).filter((f) =>
      readsEnvVar(readFileSync(path.join(ROOT, f), 'utf8'), f, envName),
    )
  }

  /**
   * 这个文件里所有 `process.env.X` 读取，以及**这一处读取有没有兜底**。
   *
   * 🔴 有没有兜底决定了「漏配」的后果完全不同：
   *      const k = process.env.MUAPI_API_KEY          ← 没兜底，缺了就崩 / 就发不出请求
   *      const f = process.env.FACTORY_CJK_FONT || '…' ← 有兜底，缺了走默认值
   *    只有**没兜底**的读取才构成「照文档配会起不来」。把有兜底的也算上，
   *    这条判据会被一堆可选开关刷屏，然后被人当噪音关掉 —— 那比没有还糟。
   *
   * 判「有兜底」只认三种确定的语法形态，不猜：
   *    `process.env.X || d` · `process.env.X ?? d` · `process.env.X ? a : b`
   * 认不出的一律按**没兜底**处理（fail closed，宁可多问一句）。
   */
  function envReadsIn(source: string, fileName: string): Map<string, boolean> {
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      false,
      fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    /** name → 是否**存在**没兜底的读取 */
    const reads = new Map<string, boolean>()

    const isProcessEnv = (node: ts.Expression): boolean =>
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      node.name.text === 'env'

    const hasFallback = (node: ts.Node): boolean => {
      const parent = (node as ts.Node & { parent?: ts.Node }).parent
      if (!parent) return false
      if (ts.isBinaryExpression(parent) && parent.left === node) {
        const op = parent.operatorToken.kind
        return op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken
      }
      if (ts.isConditionalExpression(parent) && parent.condition === node) return true
      return false
    }

    const record = (name: string, node: ts.Node) => {
      const unguarded = !hasFallback(node)
      reads.set(name, (reads.get(name) ?? false) || unguarded)
    }

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
        record(node.name.text, node)
      } else if (
        ts.isElementAccessExpression(node) &&
        isProcessEnv(node.expression) &&
        ts.isStringLiteralLike(node.argumentExpression)
      ) {
        record(node.argumentExpression.text, node)
      } else if (
        // 🔴 解构读取（Issue #948）：`const { FOO } = process.env`
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        isProcessEnv(node.initializer) &&
        ts.isObjectBindingPattern(node.name)
      ) {
        for (const el of node.name.elements) {
          if (el.dotDotDotToken) {
            // `...rest` 静态上无法确定读了哪些变量 —— 判失败，别假装看得懂。
            throw new Error(
              `${fileName}: \`const { ...rest } = process.env\` 无法静态判定读了哪些变量，判据需要人来看一眼`,
            )
          }
          const key = el.propertyName ?? el.name
          if (!ts.isIdentifier(key)) continue
          // `{ FOO = 'd' }` 自带默认值 —— 跟 `|| d` / `?? d` 同一档，算有兜底
          const unguarded = el.initializer === undefined
          reads.set(key.text, (reads.get(key.text) ?? false) || unguarded)
        }
      }
      ts.forEachChild(node, visit)
    }
    // setParentNodes = true：hasFallback 要看父节点
    const withParents = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    void sourceFile
    visit(withParents)
    return reads
  }

  /** 整条依赖闭包上，这个 worker **没兜底**地读了哪些变量。 */
  function unguardedEnvReads(entry: string): Map<string, string> {
    const found = new Map<string, string>()
    for (const file of moduleClosure(entry)) {
      const reads = envReadsIn(readFileSync(path.join(ROOT, file), 'utf8'), file)
      reads.forEach((unguarded, name) => {
        if (unguarded && !found.has(name)) found.set(name, file)
      })
    }
    return found
  }

  const workers = workerServices()
  const labelled = Array.from(allEnvDocLocations().entries()).filter(([, w]) => workerNameIn(w))

  it('前提成立：读取方判定走 AST —— 注释 / 字符串里的伪读取不算，X_V2 也不算读了 X', () => {
    const N = 'NEXT_PUBLIC_SUPABASE_URL'
    const probe = (src: string, name = N) => readsEnvVar(src, 'probe.ts', name)

    // ✅ 真读取的两种写法（含反引号下标）
    expect(probe(`const a = process.env.${N}`)).toBe(true)
    expect(probe(`const a = process.env['${N}']`)).toBe(true)
    expect(probe(`const a = process.env[\`${N}\`]`)).toBe(true)
    expect(probe(`const { ${N}: v } = process.env\nconst a = process.env.${N} ?? ''`)).toBe(true)

    // 🔴 改名成 _V2 之后，旧名字就没人读了
    expect(probe(`const a = process.env.${N}_V2`)).toBe(false)

    // 🔴 注释里的伪读取不算 —— 正则版在这里会命中，于是「删掉了读取」也一路绿
    expect(probe(`// process.env.${N} was removed`)).toBe(false)
    expect(probe(`/* 迁移前这里读过 process.env.${N} */`)).toBe(false)
    expect(probe(`/**\n * @deprecated 原来读 process.env.${N}\n */\nexport const x = 1`)).toBe(false)

    // 🔴 字符串 / 模板串里的伪读取同样不算
    expect(probe(`const hint = 'set process.env.${N} before running'`)).toBe(false)
    expect(probe(`const hint = \`set process.env.${N} first\``)).toBe(false)

    // 🔴 JSX 文本里写出来的也只是页面上的字，不是读取
    expect(readsEnvVar(`export const P = () => <div>process.env.${N}</div>`, 'probe.tsx', N)).toBe(false)

    // 🔴 名字对不上的属性访问不算
    expect(probe(`const a = process.envx.${N}`)).toBe(false)
    expect(probe(`const a = notprocess.env.${N}`)).toBe(false)
  })

  /** Issue #948 缺口二：解构写法原来命中数为 0，等于给判据开了一扇后门。 */
  it('🔴 process.env 的解构读取必须算「读了」（原来完全看不见）', () => {
    const N = 'MUAPI_API_KEY'
    const probe = (src: string) => readsEnvVar(src, 'probe.ts', N)

    expect(probe(`const { ${N} } = process.env`)).toBe(true)
    // `{ FOO: bar }` 读的是 FOO，不是 bar
    expect(probe(`const { ${N}: key } = process.env`)).toBe(true)
    expect(readsEnvVar(`const { ${N}: key } = process.env`, 'probe.ts', 'key')).toBe(false)
    expect(probe(`const { ${N} = 'd' } = process.env`)).toBe(true)
    // 混在一堆里也要认出来
    expect(probe(`const { NODE_ENV, ${N}, TZ } = process.env`)).toBe(true)

    // 不许误判：解构的不是 process.env
    expect(probe(`const { ${N} } = someOtherObject`)).toBe(false)
    expect(probe(`const { ${N} } = config.env`)).toBe(false)
    // 名字对不上
    expect(readsEnvVar('const { OTHER_KEY } = process.env', 'probe.ts', N)).toBe(false)
  })

  it('🔴 解构里的默认值算「有兜底」，没默认值算「必需」', () => {
    const reads = (src: string) => envReadsIn(src, 'probe.ts')

    // 没默认值 = 必需
    expect(reads('const { FOO } = process.env').get('FOO')).toBe(true)
    // 有默认值 = 有兜底，跟 `|| d` / `?? d` 同一档
    expect(reads("const { FOO = 'd' } = process.env").get('FOO')).toBe(false)
    // 重命名不影响判定，记的仍是环境变量名
    expect(reads('const { FOO: bar } = process.env').get('FOO')).toBe(true)
    expect(reads('const { FOO: bar } = process.env').has('bar')).toBe(false)
  })

  it('🔴 `...rest` 解构判失败 —— 静态看不懂就别假装看得懂', () => {
    // 它可能读了任何变量。悄悄跳过等于给判据留一个「写成 rest 就免检」的后门。
    expect(() => envReadsIn('const { A, ...rest } = process.env', 'probe.ts')).toThrow(/无法静态判定/)
  })

  it('前提成立：依赖闭包是递归的，相对路径和别名都跟得到（Codex thread L664）', () => {
    const entry = entrypointOf(workers[0].dockerfilePath)
    expect(entry, '拿不到 worker 入口，下面几条等于没跑').not.toBeNull()
    const closure = moduleClosure(entry!)

    // 空转保护：只有入口一个文件 = 解析链断了，不是「它真的什么都不 import」
    expect(closure.length, '闭包只有入口自己 —— import 解析坏了').toBeGreaterThan(5)
    expect(closure).toContain(entry)

    // 🔴 第一跳走的是**相对路径**（render-pipeline 里 `import './scene-plan'`），
    //    原实现只认 `from '@/lib/…'`，连它都接不上。
    expect(closure, '相对路径 import 没跟到').toContain('src/lib/factory/scene-plan.ts')
    // 🔴 第二跳才是别名，且这两个文件正是 ANTHROPIC_API_KEY / MUAPI_API_KEY 的读取方
    expect(closure, '两跳之后的别名 import 没跟到').toContain('src/lib/anthropic/client.ts')
    expect(closure).toContain('src/lib/muapi/client.ts')

    // 这两条链上的变量必须真的被判成「worker 读得到」
    expect(readsVia(entry!, 'ANTHROPIC_API_KEY')).toContain('src/lib/anthropic/client.ts')
    expect(readsVia(entry!, 'MUAPI_API_KEY')).toContain('src/lib/muapi/client.ts')
    // 反向对照：不在这条链上的变量不许被误判成读得到
    expect(readsVia(entry!, 'THIS_ENV_DOES_NOT_EXIST_ANYWHERE')).toEqual([])
  })

  it('前提成立：render.yaml 解析到了 worker，ENV.md 里也确实有点名 worker 的标注', () => {
    expect(workers.length).toBeGreaterThan(0)
    expect(labelled.length, 'ENV.md 里没有「worker `名字`」这种标注，下面几条等于没跑').toBeGreaterThan(0)
    expect(workerNameIn('Render-web + worker `content-factory-render-worker`')).toBe(
      'content-factory-render-worker',
    )
    expect(workerNameIn('Render-web')).toBeNull()
  })

  /**
   * 🔴 **反向核对：从 worker 真实依赖出发，倒查文档有没有标。**（Codex thread：registry.test.ts L668）
   *
   * 上面那条是**正向**的 —— 只从「ENV.md 里已经写了 worker」的行出发去验证。
   * 正向查不出**漏标**：一个变量 worker 明明要读、render.yaml 也确实注进去了，
   * 但 ENV.md 只写 `Render-web`，正向那条压根不会看它，测试一路绿。
   *
   * 后果不是文档不好看，是**照 ENV.md 配新 worker 会起不来**：
   * `src/lib/supabase.ts` 缺 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 时直接 `throw`，容器启动即崩。
   *
   * 判据：worker 在 render.yaml 里声明的 key，**且**入口链上真有人读 → ENV.md 必须点名这个 worker。
   * 只声明没读的不算（那是多配的，不影响启动）；读了但没声明的由上面的正向那条管。
   */
  /**
   * 🔴 **真·反向：起点是「代码里实际读了什么」，不是「render.yaml 声明了什么」。**
   *    （Codex thread：registry.test.ts L853）
   *
   * 下面那条以 `svc.keys` 为候选全集，所以只能发现「声明了但文档没标」。
   * 真正会咬人的形态它看不见：worker 新增一处必需的 `process.env.NEW_KEY`，
   * 而 render.yaml **和** ENV.md 两边都忘了登记 —— 声明集合里没有它，
   * 已标注集合里也没有它，于是两条检查都不会看它一眼，部署后 worker 因缺变量失败，
   * 整套守卫却全绿。
   *
   * 这条从依赖闭包里**实际的、没兜底的**读取出发，倒着要求两件事都成立：
   *   ① render.yaml 里这个 worker 声明了它（否则 Render 上根本注不进去）；
   *   ② ENV.md 点名了这个 worker（否则照文档配的人会漏）。
   * 有兜底的读取不算 —— 判据见 `envReadsIn` 的注释。
   */
  it('🔴 真·反向：worker 没兜底读到的变量，render.yaml 与 ENV.md 都必须有它', () => {
    const docLocations = allEnvDocLocations()
    const problems: string[] = []
    let checked = 0

    for (const svc of workers) {
      const entry = entrypointOf(svc.dockerfilePath)
      if (!entry) continue
      const declared = new Set(svc.keys)
      // Array.from 而不是直接迭代 Map：仓库 tsconfig 没设 target，
      // 直接迭代迭代器会撞 TS2802（要 downlevelIteration）。同文件别处已踩过。
      for (const [name, file] of Array.from(unguardedEnvReads(entry))) {
        checked++
        if (!declared.has(name)) {
          problems.push(`${name} —— ${file} 没兜底地读它，但 render.yaml 里 worker \`${svc.name}\` 没声明`)
          continue
        }
        const where = docLocations.get(name)
        if (where === undefined) {
          problems.push(`${name} —— ${file} 读它、render.yaml 也声明了，但 ENV.md 整张表里没有`)
        } else if (!where.includes(svc.name)) {
          problems.push(`${name} —— ENV.md 写的是「${where}」，没点名 worker \`${svc.name}\``)
        }
      }
    }

    // 空转保护：一个没兜底的读取都找不到 = 闭包或 AST 判定坏了
    expect(checked, '闭包里一个没兜底的 process.env 读取都没找到 —— 判定链坏了').toBeGreaterThan(0)
    expect(
      problems,
      'worker 因为缺环境变量起不来时，错误信息只说「缺变量」，不会说「谁忘了登记」。\n' +
        problems.join('\n'),
    ).toEqual([])
  })

  it('🔴 反向：worker 真读到的变量，ENV.md 必须点名这个 worker（漏标 = 照文档配会起不来）', () => {
    const docLocations = allEnvDocLocations()
    const missing: string[] = []
    let checked = 0

    for (const svc of workers) {
      const entry = entrypointOf(svc.dockerfilePath)
      if (!entry) continue
      for (const key of svc.keys) {
        if (readsVia(entry, key).length === 0) continue // 声明了但没人读 —— 不影响启动
        checked++
        const where = docLocations.get(key)
        if (where === undefined) {
          missing.push(`${key} → ENV.md 整张表里根本没有这个变量（worker ${svc.name} 要读）`)
        } else if (!where.includes(svc.name)) {
          missing.push(`${key} → ENV.md 写的是「${where}」，没点名 worker \`${svc.name}\``)
        }
      }
    }

    // 空转不许静默变绿：一个都没查到 = 上面几个解析器坏了，不是「全都合规」
    expect(checked, 'worker 一个真实读取都没查到 —— 解析链坏了，不是大家都合规').toBeGreaterThan(0)
    expect(
      missing,
      'worker 起不来的时候，错误信息只会说「缺环境变量」，不会说「文档漏标了」。\n' +
        missing.join('\n'),
    ).toEqual([])
  })

  it.each(labelled.map(([env, where]) => ({ env, where })))(
    '$env 点名的 worker 服务存在、声明了它、入口文件确实读得到它',
    ({ env, where }) => {
      const name = workerNameIn(where)!
      const svc = workers.find((w) => w.name === name)
      expect(svc, `render.yaml 里没有名为 ${name} 的 worker 服务了（删了或改名了）`).toBeDefined()
      expect(
        svc!.keys,
        `worker ${name} 的 envVars 里没有声明 ${env}，文档不该让人往这儿配`,
      ).toContain(env)

      const entry = entrypointOf(svc!.dockerfilePath)
      expect(entry, `${svc!.dockerfilePath} 的 CMD 里找不到仓内入口文件`).not.toBeNull()

      const readers = readsVia(entry!, env)
      expect(
        readers.length,
        `${entry} 及其直接 import 的 @/lib 模块里，没有一个读 process.env.${env} —— import 链断了，标注要重判`,
      ).toBeGreaterThan(0)
    },
  )
})
