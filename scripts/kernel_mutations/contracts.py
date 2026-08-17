"""K-WP01A 变异探针 · architecture / contracts —— 对外副作用授权、候选身份映射、导入扫描与注释挖空的各种绕过写法

🔴 **只放探针定义，不放 runner。** 判定与执行在 `scripts/kernel-mutation-check.py`。
   拆分是因为原文件到了 2501 行 > 仓库铁律的 800 —— 拆的是**文件位置，
   不是探针**：名字、目标文件、替换内容、目标测试、以及**顺序**全部原样保留。

🔴 新增探针请加到对应主题模块里，并同步 `scripts/kernel_mutations/__init__.py`
   的 `EXPECTED_MODULES` —— 漏加载一个模块会让那一批**静静地不跑**而全绿。
"""

MUTATIONS = [
    # ── K-WP02：逐动作的对外副作用授权（三道闸各自单独可咬） ──────────────
    dict(
        # 授权层那道。拆掉它之后 Gateway 仍然会拦，所以这条探针指的是
        # **授权阶段**的用例：capability 一次都不许被调、决策表要留 deny 码。
        name="K-WP02 授权层不再判对外许可",
        file="src/lib/kernel/authorize.ts",
        old="""  const outwardBlocked = outwardBlockReason(definition)
  if (outwardBlocked) {
    return bad('outward_side_effect_blocked', outwardBlocked, definition)
  }""",
        new="""  // mutated: 授权层不再判对外许可""",
        test="src/lib/kernel/__tests__/outward-authorization.test.ts",
        expect_fail_contains="没有声明",
    ),
    dict(
        name="K-WP02 对外动作允许 auto_approve 直接放行（不再要求人点头）",
        file="src/lib/kernel/authorize.ts",
        old="""  if (definition.sideEffect === 'outward' && policy.mode === 'auto_approve') {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/outward-authorization.test.ts",
        expect_fail_contains="auto_approve",
    ),
    dict(
        # Gateway 的结构闸。它被授权层遮着，所以探针必须指向那条
        # 「授权之后才把声明抽走」的用例 —— 只有 Gateway 拦得住。
        name="K-WP02 Gateway 不再独立判对外许可",
        file="src/lib/kernel/gateway.ts",
        old="""  const outwardBlocked = outwardBlockReason(definition)
  if (outwardBlocked) {
    throw new KernelError('OUTWARD_SIDE_EFFECT_BLOCKED', outwardBlocked)
  }""",
        new="""  // mutated: Gateway 不再独立判对外许可""",
        test="src/lib/kernel/__tests__/outward-authorization.test.ts",
        expect_fail_contains="声明在授权之后被抽走",
    ),
    dict(
        # Gateway 的人工复核闸。同样被遮着（既有的模式复核会先开火），
        # 所以那条用例特地把政策也摆成 auto_approve，让这一句成为唯一还站着的。
        name="K-WP02 Gateway 不再复核对外放行是不是人签的",
        file="src/lib/kernel/gateway.ts",
        old="""  if (definition.sideEffect === 'outward' && decision.decided_by !== 'human') {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/outward-authorization.test.ts",
        expect_fail_contains="放行是机器签的",
    ),
    dict(
        # 声明盖不住事实：拆掉 reversible 那一条，只靠填 rollback 就能放行。
        name="K-WP02 reversible:false 也放行（让声明盖过事实）",
        file="src/lib/kernel/outward-authorization.ts",
        old="""  if (definition.reversible !== true) {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/outward-authorization.test.ts",
        expect_fail_contains="reversible:false",
    ),
    dict(
        name="K-WP02 每步成本上界不再强制",
        file="src/lib/kernel/outward-authorization.ts",
        old="""    if (!isRealCeiling(definition.costModel.stepCeilingUsd?.[stepKey])) {""",
        new="""    if (false) {""",
        test="src/lib/kernel/__tests__/outward-authorization.test.ts",
        expect_fail_contains="有一步没写成本上界",
    ),
    # ── K-WP02：候选身份映射 ─────────────────────────────────────────────
    dict(
        # 退回「拼字符串当键」的写法 —— 分隔符碰撞会让两个不同候选撞成一个。
        name="K-WP02 映射退回字符串拼接（制造分隔符碰撞）",
        file="src/lib/action-bridge/index.ts",
        old="""      const entry = table.find(
        (candidate) => candidate.domain === identity.domain && candidate.intent === identity.intent,
      )""",
        new="""      const entry = table.find(
        (candidate) =>
          `${candidate.domain}:${candidate.intent}` === `${identity.domain}:${identity.intent}`,
      )""",
        test="src/lib/action-bridge/__tests__/candidate-mapping.test.ts",
        expect_fail_contains="不许命中",
    ),
    dict(
        name="K-WP02 词汇表遇到注册表漂移就静默跳过",
        file="src/lib/action-bridge/index.ts",
        old="""        if (!definition) {
          throw new GovernedVocabularyConfigurationError(""",
        new="""        if (false) {
          throw new GovernedVocabularyConfigurationError(""",
        test="src/lib/action-bridge/__tests__/candidate-mapping.test.ts",
        expect_fail_contains="注册表漂移必须当场炸",
    ),
    dict(
        # 退回「直接读属性」—— getter 会被执行，原型链上的字段也会被当成自己的。
        name="K-WP02 身份读取退回直接取属性（getter 会被执行 / 认继承字段）",
        file="src/lib/action-bridge/index.ts",
        old="""  const domain = ownDataProperty(input, 'domain')
  const intent = ownDataProperty(input, 'intent')""",
        new="""  const domain = (input as Record<string, unknown>).domain
  const intent = (input as Record<string, unknown>).intent""",
        test="src/lib/action-bridge/__tests__/candidate-mapping.test.ts",
        expect_fail_contains="getter 一次都不许被执行",
    ),
    dict(
        # 退回「只取要的两个、其余忽略」—— 夹带字段就能混进身份对象。
        name="K-WP02 身份对象不再要求恰好两个键（多带字段被忽略）",
        file="src/lib/action-bridge/index.ts",
        old="""  const keys = Reflect.ownKeys(input)
  if (keys.length !== 2) return null""",
        new="""  const keys = Reflect.ownKeys(input)
  if (false) return null""",
        test="src/lib/action-bridge/__tests__/candidate-mapping.test.ts",
        expect_fail_contains="多带一个字符串字段",
    ),
    dict(
        # 用 Object.keys 就看不见 symbol 键 —— 夹带一个 symbol 就能绕过去。
        name="K-WP02 键检查退回 Object.keys（看不见 symbol 键）",
        file="src/lib/action-bridge/index.ts",
        old="""  const keys = Reflect.ownKeys(input)""",
        new="""  const keys: (string | symbol)[] = Object.keys(input)""",
        test="src/lib/action-bridge/__tests__/candidate-mapping.test.ts",
        expect_fail_contains="symbol 键",
    ),
    dict(
        # 重复配对退回「静默取第一条」—— 让数组顺序决定映射到哪个动作。
        name="K-WP02 重复配对不再 fail closed（靠数组顺序挑一条）",
        file="src/lib/action-bridge/index.ts",
        old="""    if (seen.some(([d, i]) => d === entry.domain && i === entry.intent)) {""",
        new="""    if (false) {""",
        test="src/lib/action-bridge/__tests__/candidate-mapping.test.ts",
        expect_fail_contains="重复配对",
    ),
    dict(
        # 对外动作的 auto_approve 错配退回结构性拒绝码 —— 那个码不可恢复，
        # 于是「按提示改完规则」之后仍然做不了，等于永久锁死。
        name="K-WP02 auto_approve 错配退回不可恢复的结构性拒绝码",
        file="src/lib/kernel/authorize.ts",
        old="""      'outward_requires_human_policy',""",
        new="""      'outward_side_effect_blocked',""",
        test="src/lib/kernel/__tests__/outward-authorization.test.ts",
        expect_fail_contains="auto_approve",
    ),
    dict(
        # 对外授权依据不进审计快照 —— 决策记录说不清「凭什么允许它对外写」。
        name="K-WP02 对外授权依据不进审计快照",
        file="src/lib/kernel/authorize.ts",
        old="""          outward_authorization: definition.outwardAuthorization
            ? {
                declared_in: definition.outwardAuthorization.declaredIn,
                requires_human_approval: definition.outwardAuthorization.requiresHumanApproval,
                rollback: definition.outwardAuthorization.rollback,
              }
            : null,""",
        new="""          outward_authorization: null,""",
        test="src/lib/kernel/__tests__/outward-authorization.test.ts",
        expect_fail_contains="完整的 outward 治理快照",
    ),
    dict(
        # 纯空白的身份被当成合法 —— " " 会变成一个能参与匹配的域名。
        name="K-WP02 身份校验不再要求去空白后仍有内容",
        file="src/lib/action-bridge/index.ts",
        old="""  return typeof value === 'string' && value.trim().length > 0""",
        new="""  return typeof value === 'string'""",
        test="src/lib/action-bridge/__tests__/candidate-mapping.test.ts",
        expect_fail_contains="纯空白不算有内容",
    ),
    # ── PR #898 收尾：Codex P2（thread r3756852483，模板字面量动态导入）──────
    dict(
        # 无插值反引号（`import(\`@/lib/kernel/types\`)`）走的是 isStringLiteralLike
        # 这一支 —— 它同时认 StringLiteral 与 NoSubstitutionTemplateLiteral。
        # 收窄成 isStringLiteral 之后反引号说明符不再被解析成具体模块名
        # （会掉进 fail-closed 那一支），允许清单的精确断言当场对不上。
        name="K-WP02 架构扫描不再把无插值反引号当字符串字面量",
        file="src/lib/action-bridge/__tests__/architecture.test.ts",
        old="""    if (ts.isStringLiteralLike(expr)) {""",
        new="""    if (ts.isStringLiteral(expr)) {""",
        test="src/lib/action-bridge/__tests__/architecture.test.ts",
        expect_fail_contains="反引号也照常放行",
    ),
    # ── PR #898 收尾：Codex P2（thread r3757587391，插值前缀 fail closed）───
    # 🔴 判据由三句组成，其中「空前缀」那句**被「长得成」那句盖住**（实测拆掉全绿），
    #    所以这里只给真正独立生效的两句各写一条探针 —— 不给被遮蔽的那句编一条假证据。
    dict(
        # 退回「放过一切插值」：静态前缀已经写成 `@/lib/` 也不再算命中。
        name="K-WP02 插值动态导入：已是工程路径的前缀不再算命中",
        file="src/lib/action-bridge/__tests__/architecture.test.ts",
        old="""  if (PROJECT_PATH_PREFIXES.some((p) => prefix.startsWith(p))) return false
""",
        new="""""",
        test="src/lib/action-bridge/__tests__/architecture.test.ts",
        expect_fail_contains="fail closed 必须命中",
    ),
    dict(
        # 这一句是 Codex r3757587391 的正解：前缀为空、或短到还能长成 `src/`、`@/`、
        # `./`、`../`，都证明不了指向仓库外的包。拆掉它，`${prefix}/execution`
        # 与 `s${rest}` 两类写法就又从正门走出去了。
        name="K-WP02 插值动态导入：证明不了是外部包也放行（空前缀/半截前缀重新敞开）",
        file="src/lib/action-bridge/__tests__/architecture.test.ts",
        old="""  if (PROJECT_PATH_PREFIXES.some((p) => p.startsWith(prefix))) return false
""",
        new="""""",
        test="src/lib/action-bridge/__tests__/architecture.test.ts",
        expect_fail_contains="证明不了，必须 fail closed",
    ),
    # ── PR #898 收尾（第二轮）：Codex P2 thread r3758650486 —— 转义说明符 ──────
    dict(
        # 说明符退回「源码原文」而不是解析器求值后的 cooked 值。
        # `import('\\x40/lib/capabilities')` 的原文是 \\x40/lib/...，跟禁止清单
        # 的 @/lib/... 永远比不中 —— 这正是 Codex 报的那条绕过。
        name="K-WP02 说明符退回源码原文（转义写法重新绕过）",
        file="src/lib/action-bridge/__tests__/architecture.test.ts",
        old="""      specifiers.push(expr.text)""",
        new="""      specifiers.push(code.slice(expr.pos, expr.end).trim().replace(/^['"`]|['"`]$/g, ''))""",
        test="src/lib/action-bridge/__tests__/architecture.test.ts",
        expect_fail_contains="cooked 值确实被还原成了真实模块名",
    ),
    # ── PR #898 收尾（第二轮）：Codex P2 thread r3758650489 —— 注释挖空 ────────
    dict(
        # 在解析器给出的注释范围之外，再补一刀当年那条正则。
        # 它认不得字符串字面量，会把 `const start = '/*'` 到 `const end = '*/'`
        # 之间的**真实源码**（含违规 import）整段删掉 —— 正是 Codex 报的那条。
        name="K-WP02 注释挖空叠加旧正则（字符串之间的真实源码被吞）",
        file="src/lib/action-bridge/__tests__/architecture.test.ts",
        old="""  return chars.join('')
}""",
        new="""  return chars.join('').replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')
}""",
        test="src/lib/action-bridge/__tests__/architecture.test.ts",
        expect_fail_contains="之间夹着的违规 import 必须还在",
    ),
    # ── PR #898 收尾（第三轮）：Codex P2 thread r3759104922 —— ImportTypeNode ──
    dict(
        # `type T = import('@/lib/growth').X` 走的是独立的 ImportTypeNode 分支，
        # 不属于 ImportDeclaration/ExportDeclaration/CallExpression 任何一类。
        # 拆掉这一支，type-only 的模块引用就完全不会被 record，
        # 禁止层可以只用 type import 悄悄建立编译期依赖而不被架构测试发现。
        name="K-WP02 ImportTypeNode 分支被拆掉（type-only 模块引用不再被发现）",
        file="src/lib/action-bridge/__tests__/architecture.test.ts",
        old="""    } else if (ts.isImportTypeNode(node)) {""",
        new="""    } else if (false) {""",
        test="src/lib/action-bridge/__tests__/architecture.test.ts",
        expect_fail_contains="type T = import(...).X 必须被发现",
    ),
    # ── PR #898 收尾（第三轮）：Codex P2 thread r3759104932 —— trailing 注释 ──
    dict(
        # 同一行内、紧跟在前一个 token 后面的块注释是 trailing trivia，
        # 只收 leading 挖不掉它。拆掉这一收集，`foo /* ... */ + bar` 这类
        # 注释会原样留在 stripComments 输出里，可能被后面还在用正则的
        # 检查（比如「没有 any」）当成生产代码误判。
        name="K-WP02 trailing 注释不再被挖空（同一行内的块注释原样留下）",
        file="src/lib/action-bridge/__tests__/architecture.test.ts",
        old="""    collectTrailingAt(node.end)
""",
        new="""""",
        test="src/lib/action-bridge/__tests__/architecture.test.ts",
        expect_fail_contains="同一行内的块注释（trailing trivia）必须被挖空",
    ),
    # ── PR #898 收尾（第三轮）：Codex P2 thread r3761927225 —— allowJs ────────
    dict(
        # 扫描面退回只认 .ts/.tsx。仓库 tsconfig 是 allowJs:true，于是 kernel 或
        # bridge 里放一个 .js/.jsx 直接 import 被禁止的层，构建照打、测试全绿。
        name="K-WP02 扫描面退回只认 .ts/.tsx（allowJs 下的 .js/.jsx 重新隐身）",
        file="src/lib/action-bridge/__tests__/architecture.test.ts",
        old="""const isScannedSource = (p: string): boolean => SOURCE_EXTENSIONS.some(([ext]) => p.endsWith(ext))""",
        new="""const isScannedSource = (p: string): boolean => /\\.tsx?$/.test(p)""",
        test="src/lib/action-bridge/__tests__/architecture.test.ts",
        expect_fail_contains="扫描面覆盖构建真会编译的 8 种后缀",
    ),
    dict(
        # 所有文件一律当 ScriptKind.TS。JSX 会被当成类型断言，JSX 属性 / 子元素里
        # 嵌的 require() / import() 一条都扫不到（实测返回 []）。
        name="K-WP02 ScriptKind 一律当 TS（JSX 里嵌的模块引用重新扫不到）",
        file="src/lib/action-bridge/__tests__/architecture.test.ts",
        old="""  for (const [ext, kind] of SOURCE_EXTENSIONS) if (fileName.endsWith(ext)) return kind
  return ts.ScriptKind.TS""",
        new="""  void fileName
  return ts.ScriptKind.TS""",
        test="src/lib/action-bridge/__tests__/architecture.test.ts",
        expect_fail_contains="JSX 属性 / 子元素里的模块引用要能扫到",
    ),
    # ── PR #898 收尾（第四轮）：Codex P2 thread r3762497089 —— JSX 注释 ────────
    dict(
        # 注释范围收集退回 forEachChild（只给子**节点**）。JSX 表达式里的注释挂在
        # `}` 这个 token 的前导 trivia 上，JsxExpression 没有子节点 —— 于是整段注释
        # 原样留下，后面仍用正则的检查会把纯注释当成生产代码而误报。
        name="K-WP02 注释收集退回 forEachChild（JSX 表达式里的注释挖不掉）",
        file="src/lib/action-bridge/__tests__/architecture.test.ts",
        old="    for (const child of node.getChildren(sourceFile)) visit(child)",
        new="    node.forEachChild(visit)",
        test="src/lib/action-bridge/__tests__/architecture.test.ts",
        expect_fail_contains="必须被挖空",
    ),
    # ── PR #898 收尾（第四轮）：Codex P2 thread r3762497095 —— isTest 后缀 ─────
    dict(
        # isTest 退回只认 .test.ts(x)。walker 已扩到八类后缀，于是 .test.js/.jsx/
        # .mts/.cts/.mjs/.cjs 会被当成生产文件扫描，测试里故意写的禁止导入会把
        # 整套边界测试卡红。
        name="K-WP02 isTest 退回只认 .test.ts(x)（其余六类测试文件被当成生产代码）",
        file="src/lib/kernel/__tests__/architecture.test.ts",
        old="const isTest = (p: string) =>\n  SOURCE_EXTENSIONS.some(([ext]) => p.endsWith(`.test${ext}`)) || p.includes('/__tests__/')",
        new="const isTest = (p: string) => /\\.test\\.tsx?$/.test(p) || p.includes('/__tests__/')",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="八种 `.test.<ext>` 全部被认定为测试文件",
    ),
    # ── Issue #923：JSX 文本被当成注释挖掉，未闭合 /* 吞掉后续全部源码 ──────────
    dict(
        # 拆掉「起点落在 JSX 文本里就不挖」这道判据 = 完全退回旧行为。
        # 于是 <div>/* unterminated 之后的 AuthorizedExecutionContext / supabaseAdmin /
        # execution_items / any 全部被挖空，那几条还在用正则的检查一条都看不见。
        name="#923 注释挖空重新吃掉 JSX 文本（未闭合 /* 再次吞掉后续源码）",
        file="src/lib/kernel/__tests__/architecture.test.ts",
        old="    if (startsInsideJsxText(r.pos)) return\n",
        new="",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="不许吞掉后续源码",
    ),
    dict(
        # 同一个洞的另一半：不再登记 JsxText 区间 → 判据永远为假，效果同上。
        # 两处 stripComments 是有意各自独立的，所以 bridge 侧单独验一刀。
        name="#923 不再登记 JsxText 区间（bridge 侧同一个洞重新打开）",
        file="src/lib/action-bridge/__tests__/architecture.test.ts",
        old="    if (node.kind === ts.SyntaxKind.JsxText) jsxTextSpans.push({ pos: node.pos, end: node.end })\n",
        new="",
        test="src/lib/action-bridge/__tests__/architecture.test.ts",
        expect_fail_contains="不许吞掉后续源码",
    ),
    # ── Issue #929：另外五套 suite 的正则版 stripComments 会放行真实违规 ────────
    dict(
        # 把 growth 那份退回正则版。`const START = '/*'` … `const END = '*/'` 之间的
        # 真实违规会被整段删掉 —— 守卫还在、还是绿的，但守空了。
        name="#929 growth 的注释挖空退回正则版（字符串夹着的真实违规重新隐身）",
        file="src/lib/growth/__tests__/architecture.test.ts",
        old="""  const sourceFile = parseSource(src, fileName)""",
        new="""  void fileName
  return src
    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')
    .split('\\n')
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\\n')
  const sourceFile = parseSource(src, fileName)""",
        test="src/lib/growth/__tests__/architecture.test.ts",
        expect_fail_contains="夹着的真实违规必须还在",
    ),
    dict(
        # 一致性守卫的抠取逻辑坏掉 = 它会一个实现都扫不到，然后「全都一致」地变绿。
        # 空跑的判据长得跟「大家都合规」一模一样，所以这一刀专门验它红得出来。
        name="#929 七处一致守卫的抠取逻辑坏掉（验它不是空跑就绿）",
        file="src/lib/__tests__/strip-comments-consistency.test.ts",
        old="""const DECL = 'function stripComments('""",
        new="""const DECL = 'function __no_such_symbol__('""",
        test="src/lib/__tests__/strip-comments-consistency.test.ts",
        expect_fail_contains="防止判据因为抠取写错而空跑",
    ),
]
