/**
 * WP「Reel 自动起草 PAUSED 广告」的架构红线。
 *
 * 本文件冻结的命题是：
 *   「本功能里 ME 代码把广告打开（切到 ACTIVE）的唯一途径是：没有。
 *     激活入口始终是 /api/ad-approval。」
 *
 * 🔴 保证的确切范围：
 *    - 受保护文件（本功能新增的文件）里没有任何开启广告的路径；
 *    - 全仓其它既有开启入口被冻结，只许缩小，不是被删除。
 *    本文件不声称、也无法证明仓库里不存在别的激活路径；它只保证本功能不新增。
 *
 * 🔴 判据一律走 TypeScript AST（在 RAW 源码上 parse）：一条把自己的文档当罪证的规则，
 *    第一件事就是教人删注释；而注释根本不会进 AST，所以注释里的违规天然不响。
 *
 * 🔴 所有路径都用 join(process.cwd(), …)：本文件会被移动到
 *    src/lib/ads-strategy/factory-reel-draft/__tests__/architecture.test.ts，
 *    但 vitest 的 cwd 始终是仓库根，所以绝不能用 __dirname。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import ts from 'typescript'

const ROOT = process.cwd()

/** 受保护文件 → 允许的 import 清单（`${specifier}::${name}` 形式，排序后比较）。 */
const GUARDED_IMPORTS: Record<string, string[]> = {
  'src/lib/ads-strategy/factory-reel-draft/config.ts': [
    '../ad-draft::MAX_AUTO_DAILY_BUDGET',
    '../ad-draft::MAX_DURATION_DAYS',
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/lib/ads-strategy/factory-reel-draft/gates.ts': [
    '@/lib/ads-strategy/draft-redlines::findRedlineHits',
    '@/lib/social/content-review::REEL_AUTO_CHECK_KEYS',
    '@/lib/social/content-review::REEL_HUMAN_CHECK_KEYS',
    '@/lib/social/content-review::checklistPasses',
    '@/lib/social/content-review::validateContentChecklist',
    '@/lib/social/reel-publishing::buildReelPostCaption',
  ],
  'src/lib/ads-strategy/factory-reel-draft/graph-io.ts': [
    './post-resolver::GraphGetResult',
    './post-resolver::PostResolverDeps',
    '@/lib/meta/graph-base::GRAPH_BASE',
  ],
  'src/lib/ads-strategy/factory-reel-draft/intent-ledger.ts': [
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/lib/ads-strategy/factory-reel-draft/on-failure.ts': [
    './intent-ledger::FACTORY_REEL_DRAFT_ACTION',
    './intent-ledger::IntentMode',
    './intent-ledger::IntentPayload',
    './intent-ledger::buildIntentKey',
    './intent-ledger::finishIntent',
    '@/lib/factory/publish/reel-published-event::FactoryReelPublishedEventSchema',
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/lib/ads-strategy/factory-reel-draft/post-resolver.ts': [],
  'src/lib/ads-strategy/factory-reel-draft/real-deps.ts': [
    '../draft-and-gate::createDraftForApproval',
    '../draft-redlines::loadDraftRedlines',
    './config::loadFactoryReelDraftConfig',
    './gates::ReelWorkOrderRow',
    './graph-io::FetchLike',
    './graph-io::createGraphGet',
    './graph-io::probeMetaToken',
    './run::ClientMetaFacts',
    './run::RunDeps',
    '@/lib/meta/token-manager::getStoredPageToken',
    '@/lib/meta/token-manager::resolveMetaTokenForClient',
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/lib/ads-strategy/factory-reel-draft/run.ts': [
    '../ad-draft::AdDraft',
    '../ad-draft::validateDraft',
    '../draft-and-gate::CreateDraftDeps',
    '../draft-and-gate::CreateDraftOutcome',
    './config::LoadedFactoryReelDraftConfig',
    './gates::ReelWorkOrderRow',
    './gates::evaluateReelDraftGates',
    './intent-ledger::IntentPatch',
    './intent-ledger::IntentStatus',
    './intent-ledger::claimIntent',
    './intent-ledger::finishIntent',
    './post-resolver::PostResolverDeps',
    './post-resolver::resolvePromotablePostId',
    '@/lib/factory/publish/reel-published-event::FactoryReelPublishedEventSchema',
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/lib/inngest/functions/factory-reel-ad-draft.ts': [
    '../client::CLOUD_FN_PREFIX',
    '../client::inngest',
    '@/lib/ads-strategy/factory-reel-draft/on-failure::recordUnhandledFailure',
    '@/lib/ads-strategy/factory-reel-draft/real-deps::buildRunDeps',
    '@/lib/ads-strategy/factory-reel-draft/run::RunOutcome',
    '@/lib/ads-strategy/factory-reel-draft/run::runFactoryReelAdDraft',
    '@/lib/factory/publish/reel-published-event::FACTORY_REEL_PUBLISHED_EVENT',
    '@/lib/supabase::supabaseAdmin',
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/lib/pm-todo/factory-reel-ad-draft-items.ts': [
    './manual-item-types::ManualItem',
    '@/lib/ads-strategy/ad-draft::MAX_AUTO_DAILY_BUDGET',
    '@/lib/factory/publish/publish-display::toPublishedView',
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/app/api/clients/[id]/factory-reel-ad-draft-config/route.ts': [
    '@/lib/ads-strategy/factory-reel-draft/config::FACTORY_REEL_DRAFT_MODES',
    '@/lib/ads-strategy/factory-reel-draft/config::isMissingColumnError',
    '@/lib/ads-strategy/factory-reel-draft/config::loadFactoryReelDraftConfig',
    '@/lib/ads-strategy/factory-reel-draft/config::parseFactoryReelDraftConfig',
    '@/lib/auth/client-access::requirePaidClientAccess',
    '@/lib/auth/require-admin::guardGlobalAdmin',
    '@/lib/auth/require-session::requireSession',
    '@/lib/supabase::supabaseAdmin',
    'next/server::NextRequest',
    'next/server::NextResponse',
  ],
}

/** 本功能里绝不许出现的符号名（无论从哪个模块 import）。 */
const FORBIDDEN_SYMBOLS = [
  'activatePublished',
  'approveDraft',
  'setCampaignStatus',
  'setAdSetStatus',
  'createAdFromPost',
]

/** 本功能里绝不许出现的模块（子串匹配）。 */
const FORBIDDEN_MODULE_SUBSTRINGS = ['ad-approval', 'spend-activation']

/**
 * 允许直接发网络请求 / 引用 GRAPH_BASE 的受保护文件。
 * 只有这两个文件是「网络边界」，其余受保护文件不许自己发请求。
 */
const NETWORK_ALLOWED = [
  'src/lib/ads-strategy/factory-reel-draft/graph-io.ts',
  'src/lib/ads-strategy/factory-reel-draft/real-deps.ts',
]

/** 仓库里既有的「提到激活符号 / 把状态置 ACTIVE」的文件 —— 只许缩小，不许新增。 */
const ACTIVATION_WRITERS_ALLOWED = [
  'src/app/api/ad-approval/[actionId]/route.ts',
  'src/app/api/clients/[id]/google-ads/execute/route.ts',
  'src/app/api/clients/[id]/meta-ads/execute/route.ts',
  'src/app/api/clients/[id]/tiktok-ads/execute/route.ts',
  'src/lib/ads-strategy/draft-and-gate.ts',
  'src/lib/ads-strategy/stop-loss.ts',
  'src/lib/capabilities/ads-auto-pause/deps.ts',
  'src/lib/capabilities/ads-auto-pause/index.ts',
  'src/lib/capabilities/ads/pause-campaign.ts',
  'src/lib/capabilities/ads/pause-unit.ts',
  'src/lib/google-ads/client.ts',
  'src/lib/meta/ad-publisher.ts',
  'src/lib/meta/ads-manager.ts',
  'src/lib/meta/adsets.ts',
  'src/lib/meta/campaign-management.ts',
  'src/lib/meta/campaign-writes.ts',
  'src/lib/meta/client.ts',
  'src/lib/tiktok-ads/client.ts',
  'src/lib/winner-reel-sync/engine.ts',
]

/** 仓库里既有的「引入广告写入模块」的文件 —— 只许缩小，不许新增。 */
const AD_WRITE_MODULE_IMPORTERS_ALLOWED = [
  'src/app/api/ad-approval/[actionId]/route.ts',
  'src/app/api/clients/[id]/ad-health/o1-scale/route.ts',
  'src/app/api/clients/[id]/ad-health/stop-loss/route.ts',
  'src/app/api/clients/[id]/meta-ads/draft-listing/route.ts',
  'src/app/api/clients/[id]/meta-ads/draft/route.ts',
  'src/app/api/clients/[id]/meta-ads/execute/route.ts',
  'src/app/dashboard/ad-approval/page.tsx',
  'src/lib/ads-strategy/draft-and-gate.ts',
  'src/lib/ads-strategy/factory-reel-draft/real-deps.ts',
  'src/lib/ads-strategy/factory-reel-draft/run.ts',
  'src/lib/ads-strategy/stop-loss.ts',
  'src/lib/capabilities/ads-auto-pause/deps.ts',
  'src/lib/capabilities/ads/cut-campaign-budget.ts',
  'src/lib/capabilities/ads/cut-unit-budget.ts',
  'src/lib/capabilities/ads/pause-campaign.ts',
  'src/lib/capabilities/ads/pause-unit.ts',
  'src/lib/capabilities/ads/scale-unit-budget.ts',
  'src/lib/meta/client.ts',
  'src/lib/winner-reel-sync/engine.ts',
]

/** 仓库里既有的 createDraftForApproval 调用点 —— 只许缩小，不许新增。 */
const CREATE_DRAFT_CALLERS_ALLOWED = [
  'src/app/api/clients/[id]/meta-ads/draft-listing/route.ts',
  'src/app/api/clients/[id]/meta-ads/draft/route.ts',
  'src/lib/ads-strategy/draft-and-gate.ts',
  'src/lib/ads-strategy/factory-reel-draft/real-deps.ts',
]

/** 仓库里既有的 publishDraftPaused 调用点 —— 只许缩小，不许新增。 */
const PUBLISH_PAUSED_CALLERS_ALLOWED = [
  'src/lib/ads-strategy/draft-and-gate.ts',
  'src/lib/meta/ad-publisher.ts',
]

/**
 * 仓库里既有的「引入激活符号 / 激活模块」的文件 —— 只许缩小，不许新增。
 * 命中判据见 importsActivation()。
 */
const ACTIVATION_IMPORTERS_ALLOWED = [
  'src/app/api/ad-approval/[actionId]/route.ts',
  'src/app/api/clients/[id]/google-ads/execute/route.ts',
  'src/app/api/clients/[id]/meta-ads/execute/route.ts',
  'src/app/api/clients/[id]/tiktok-ads/execute/route.ts',
  'src/lib/ads-strategy/draft-and-gate.ts',
  'src/lib/capabilities/ads-auto-pause/deps.ts',
  'src/lib/capabilities/ads/pause-campaign.ts',
  'src/lib/capabilities/ads/pause-unit.ts',
  'src/lib/meta/client.ts',
  'src/lib/winner-reel-sync/engine.ts',
]

/** 递归列出目录下的 `.ts` / `.tsx` 文件（跳过 node_modules / .next）。 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      walk(full, out)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/** 测试文件判据：`.test.<ext>` 或落在 `/__tests__/` 里。 */
const isTest = (p: string) => /\.test\.tsx?$/.test(p) || p.includes('/__tests__/')

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** 非测试的源码文件清单（仓库相对路径，`/` 分隔）。 */
function listSource(dir: string): string[] {
  return walk(join(ROOT, dir))
    .map((f) => relative(ROOT, f).split('\\').join('/'))
    .filter((f) => !isTest(f))
}

/**
 * 用 TypeScript 编译器 API 解析 import / re-export，返回排序去重后的
 * `${specifier}::${name}` 列表。
 *
 * 命名 import 用「导入名」（`propertyName ?? name`），所以
 * `import { setAdSetStatus as s }` 仍然记作 `setAdSetStatus`。
 *
 * 🔴 re-export 也算「引入」：`export { a as b } from 'x'` => `x::a`，
 *    `export * from 'x'` / `export * as ns from 'x'` => `x::*`。
 *    否则一条 `export { activatePublished } from '…'` 就能把激活符号
 *    从受保护文件里「转手」出去而躲过白名单。
 */
function extractImports(source: string): string[] {
  const sf = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true)
  const out: string[] = []

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
      const spec = stmt.moduleSpecifier.text
      const clause = stmt.importClause

      if (!clause) {
        out.push(`${spec}::<side-effect>`)
        continue
      }

      if (clause.name) {
        out.push(`${spec}::default`)
      }

      const bindings = clause.namedBindings
      if (bindings) {
        if (ts.isNamespaceImport(bindings)) {
          out.push(`${spec}::*`)
        } else if (ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            const name = el.propertyName ? el.propertyName.text : el.name.text
            out.push(`${spec}::${name}`)
          }
        }
      }
      continue
    }

    if (ts.isExportDeclaration(stmt)) {
      if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
      const spec = stmt.moduleSpecifier.text
      const clause = stmt.exportClause

      if (!clause) {
        // `export * from 'x'`
        out.push(`${spec}::*`)
      } else if (ts.isNamespaceExport(clause)) {
        // `export * as ns from 'x'`
        out.push(`${spec}::*`)
      } else if (ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          const name = el.propertyName ? el.propertyName.text : el.name.text
          out.push(`${spec}::${name}`)
        }
      }
    }
  }

  return Array.from(new Set(out)).sort()
}

/**
 * 折叠字符串拼接：把 `'ACT' + 'IVE'` 这类 BinaryExpression（PlusToken）
 * 求值成字符串；操作数可以是字符串字面量、括号表达式、或嵌套的同类表达式。
 * 求不出来就返回 null。
 */
function foldStringConcat(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  if (ts.isParenthesizedExpression(node)) {
    return foldStringConcat(node.expression)
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = foldStringConcat(node.left)
    const right = foldStringConcat(node.right)
    if (left === null || right === null) return null
    return left + right
  }
  return null
}

/**
 * 对源码做红线检查，返回原因字符串列表。
 *
 * 🔴 字面量 / 调用一律走 AST（在 RAW 源码上 parse），不再用正则：
 *    注释根本不会进 AST，所以注释里的违规天然不响；
 *    而字符串里的 `//` 或 `/*` 也无法再「吃掉」后面的真实代码。
 */
function findViolations(source: string, opts?: { allowNetwork?: boolean }): string[] {
  const reasons: string[] = []

  const imports = extractImports(source)
  for (const entry of imports) {
    const sep = entry.indexOf('::')
    const spec = entry.slice(0, sep)
    const name = entry.slice(sep + 2)

    if (FORBIDDEN_SYMBOLS.includes(name)) {
      reasons.push(`forbidden_symbol:${name}`)
    }
    if (FORBIDDEN_MODULE_SUBSTRINGS.some((s) => spec.includes(s))) {
      reasons.push(`forbidden_module:${spec}`)
    }
    if (name === '*' || name === 'default') {
      reasons.push('namespace_or_default_import')
    }
  }

  const sf = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true)

  const visit = (node: ts.Node): void => {
    // active_literal：字符串字面量 / 模板片段 / 折叠后的拼接
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (node.text.includes('ACTIVE')) reasons.push('active_literal')
    } else if (
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      if ((node as ts.TemplateLiteralLikeNode).text.includes('ACTIVE')) {
        reasons.push('active_literal')
      }
    } else if (ts.isBinaryExpression(node)) {
      const folded = foldStringConcat(node)
      if (folded !== null && folded.includes('ACTIVE')) reasons.push('active_literal')
    }

    // 调用：dynamic import / require / fetch
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        reasons.push('dynamic_import')
      } else if (ts.isIdentifier(callee) && callee.text === 'require') {
        reasons.push('require_call')
      } else if (
        (ts.isIdentifier(callee) && callee.text === 'fetch') ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'fetch')
      ) {
        if (!opts?.allowNetwork) reasons.push('fetch_call')
      }
    }

    // fetch 引用：任意名为 fetch 的 Identifier（裸引用 / 解构 / fetch.call）
    // 或 `globalThis['fetch']` 这类字符串字面量元素访问。
    if (!opts?.allowNetwork) {
      if (ts.isIdentifier(node) && node.text === 'fetch') {
        reasons.push('fetch_reference')
      }
      if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteral(node.argumentExpression) &&
        node.argumentExpression.text === 'fetch'
      ) {
        reasons.push('fetch_reference')
      }
    }

    // 混淆字符串：fromCharCode / [].join('') / 'x'.toUpperCase() / 'x'.toLowerCase()
    if (ts.isIdentifier(node) && node.text === 'fromCharCode') {
      reasons.push('obfuscated_string')
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text
        if (
          method === 'join' &&
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0]) &&
          node.arguments[0].text === ''
        ) {
          reasons.push('obfuscated_string')
        }
        if (
          (method === 'toUpperCase' || method === 'toLowerCase') &&
          (ts.isStringLiteral(callee.expression) ||
            ts.isNoSubstitutionTemplateLiteral(callee.expression))
        ) {
          reasons.push('obfuscated_string')
        }
      }
    }

    // GRAPH_BASE 引用
    if (ts.isIdentifier(node) && node.text === 'GRAPH_BASE') {
      if (!opts?.allowNetwork) reasons.push('graph_base_reference')
    }

    ts.forEachChild(node, visit)
  }

  visit(sf)

  return Array.from(new Set(reasons)).sort()
}

/**
 * 该文件是否「引入激活符号 / 激活模块」。
 * 命中：import 的模块名含 'ad-approval' / 'spend-activation'，
 * 或 import 的符号名在 FORBIDDEN_SYMBOLS 里。
 */
function importsActivation(source: string): boolean {
  return extractImports(source).some((entry) => {
    const sep = entry.indexOf('::')
    const spec = entry.slice(0, sep)
    const name = entry.slice(sep + 2)
    return (
      FORBIDDEN_MODULE_SUBSTRINGS.some((s) => spec.includes(s)) ||
      FORBIDDEN_SYMBOLS.includes(name)
    )
  })
}

/** 比较两份 import 清单，返回新增 / 删除。 */
function diffImports(
  actual: string[],
  expected: string[],
): { added: string[]; removed: string[] } {
  const a = new Set(actual)
  const e = new Set(expected)
  const added = actual.filter((x) => !e.has(x)).sort()
  const removed = expected.filter((x) => !a.has(x)).sort()
  return { added, removed }
}

/**
 * 递归遍历 AST 的每个节点。
 *
 * 🔴 全仓扫描一律走 AST（在 RAW 源码上 parse），不再用正则 + stripComments：
 *    正则会被 `import * as pub`、动态 import、字符串里的 `//` / `/*` 绕过。
 */
function visitAll(node: ts.Node, cb: (n: ts.Node) => void): void {
  cb(node)
  ts.forEachChild(node, (child) => visitAll(child, cb))
}

/** 取属性名 / 元素访问名的文本（identifier 或字符串字面量）。 */
function nameText(name: ts.Node | undefined): string | null {
  if (!name) return null
  if (ts.isIdentifier(name)) return name.text
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text
  }
  return null
}

/** 该节点是否是恰好为 'ACTIVE' 的字符串字面量 / 无插值模板。 */
function isActiveLiteral(node: ts.Node | undefined): boolean {
  if (!node) return false
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text === 'ACTIVE'
  }
  return false
}

/**
 * 是否「提到激活」：命中任一即真。
 *   (a) 任意 Identifier 文本在 FORBIDDEN_SYMBOLS 里
 *       —— 这同时覆盖 `pub.activatePublished` 的属性访问与解构出的名字；
 *   (b) 名为 `status` 的 PropertyAssignment（identifier 或字符串字面量名），
 *       其 initializer 恰为 'ACTIVE'；
 *   (c) 被调用者名（identifier 或属性访问名）匹配 /^(set|update)\w*Status$/，
 *       且有一个实参恰为 'ACTIVE'。
 */
function mentionsActivation(source: string): boolean {
  const sf = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true)
  let hit = false

  visitAll(sf, (node) => {
    if (hit) return

    if (ts.isIdentifier(node) && FORBIDDEN_SYMBOLS.includes(node.text)) {
      hit = true
      return
    }

    if (ts.isPropertyAssignment(node)) {
      const key = nameText(node.name)
      if (key === 'status' && isActiveLiteral(node.initializer)) {
        hit = true
        return
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const calleeName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null
      if (calleeName && /^(set|update)\w*Status$/.test(calleeName)) {
        if (node.arguments.some((a) => isActiveLiteral(a))) {
          hit = true
        }
      }
    }
  })

  return hit
}

/** 广告写入模块的模块名判据。 */
const AD_WRITE_MODULE_RE =
  /(^|\/)(ad-publisher|adsets|campaign-writes|campaign-management|draft-and-gate|ad-approval|spend-activation)$/

/**
 * 是否「引入广告写入模块」：命中任一即真。
 *   - ImportDeclaration / ExportDeclaration 的字符串字面量 moduleSpecifier；
 *   - `import('…')` / `require('…')` 且首个实参是字符串字面量。
 */
function importsAdWriteModule(source: string): boolean {
  const sf = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true)
  let hit = false

  visitAll(sf, (node) => {
    if (hit) return

    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (AD_WRITE_MODULE_RE.test(node.moduleSpecifier.text)) hit = true
      return
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require'
      if (isDynamicImport || isRequire) {
        const first = node.arguments[0]
        if (first && ts.isStringLiteral(first) && AD_WRITE_MODULE_RE.test(first.text)) {
          hit = true
        }
      }
    }
  })

  return hit
}

/** 是否提到 createDraftForApproval（任意 Identifier）。 */
function mentionsCreateDraft(source: string): boolean {
  const sf = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true)
  let hit = false
  visitAll(sf, (node) => {
    if (!hit && ts.isIdentifier(node) && node.text === 'createDraftForApproval') {
      hit = true
    }
  })
  return hit
}

/** 是否提到 publishDraftPaused（任意 Identifier）。 */
function mentionsPublishPaused(source: string): boolean {
  const sf = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true)
  let hit = false
  visitAll(sf, (node) => {
    if (!hit && ts.isIdentifier(node) && node.text === 'publishDraftPaused') {
      hit = true
    }
  })
  return hit
}

/** 仓库里所有非测试源码文件（仓库相对路径，`/` 分隔）。 */
function allSourceFiles(): string[] {
  return listSource('src')
}

/**
 * 对全仓非测试源码跑一个判据，返回命中的文件清单（排序）。
 *
 * 🔴 传 RAW 源码（不 stripComments）：判据本身走 AST，注释天然不进 AST。
 */
function scanRepo(predicate: (source: string) => boolean): string[] {
  return allSourceFiles()
    .filter((f) => predicate(read(f)))
    .sort()
}

describe('A. 受保护文件的 import 白名单', () => {
  it('guarded files import exactly the allowed symbols', () => {
    for (const [file, expected] of Object.entries(GUARDED_IMPORTS)) {
      const actual = extractImports(read(file))
      const diff = diffImports(actual, expected)
      expect(
        diff,
        `${file} 的 import 与白名单不一致。\n` +
          `新增（要过 review 才能加）：${diff.added.join(', ') || '（无）'}\n` +
          `缺失（白名单里的幽灵条目）：${diff.removed.join(', ') || '（无）'}`,
      ).toEqual({ added: [], removed: [] })
    }
  })
})

describe('B. factory-reel-draft 目录里的每个非测试 .ts 都在白名单里', () => {
  it('every non-test .ts file in the factory-reel-draft directory is in the map', () => {
    const dir = join(ROOT, 'src/lib/ads-strategy/factory-reel-draft')
    const found = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => !/\.test\.ts$/.test(f))
      .map((f) => `src/lib/ads-strategy/factory-reel-draft/${f}`)
      .sort()

    const expected = Object.keys(GUARDED_IMPORTS)
      .filter((f) => f.startsWith('src/lib/ads-strategy/factory-reel-draft/'))
      .sort()

    expect(
      found,
      'factory-reel-draft 目录里出现了没有白名单条目的新文件 —— 新文件必须显式登记。',
    ).toEqual(expected)
  })
})

describe('C. 受保护文件里没有红线违规', () => {
  it('guarded files have no violations', () => {
    for (const file of Object.keys(GUARDED_IMPORTS)) {
      const allowNetwork = NETWORK_ALLOWED.includes(file)
      const violations = findViolations(read(file), { allowNetwork })
      expect(
        violations,
        `${file} 命中红线：${violations.join(', ')}\n` +
          '本功能不许出现激活符号 / 激活模块 / 动态 import / require / \'ACTIVE\' 字面量；' +
          '除网络边界文件外也不许直接 fetch / 引用 GRAPH_BASE。',
      ).toEqual([])
    }
  })
})

describe('D. 白名单自身的自洽性', () => {
  it('the allowlist itself contains no forbidden symbol or module', () => {
    for (const [file, entries] of Object.entries(GUARDED_IMPORTS)) {
      for (const entry of entries) {
        const sep = entry.indexOf('::')
        const spec = entry.slice(0, sep)
        const name = entry.slice(sep + 2)

        expect(
          FORBIDDEN_SYMBOLS.includes(name),
          `${file} 的白名单里出现了禁用符号 ${name}`,
        ).toBe(false)

        expect(
          FORBIDDEN_MODULE_SUBSTRINGS.some((s) => spec.includes(s)),
          `${file} 的白名单里出现了禁用模块 ${spec}`,
        ).toBe(false)
      }
    }
  })
})

describe('E. 全仓冻结清单（只许缩小）', () => {
  it('activation mentions are a subset of the frozen allowlist', () => {
    const found = scanRepo(mentionsActivation)
    const allowed = new Set(ACTIVATION_WRITERS_ALLOWED)
    const offenders = found.filter((f) => !allowed.has(f))
    expect(
      offenders,
      '出现了新的「提到激活符号 / 把状态置 ACTIVE」的文件。\n' +
        '本功能不许新增激活路径 —— 请把新调用点拿去过 review，' +
        '确认它确实走 /api/ad-approval，再决定是否扩白名单。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('ad-write module importers are a subset of the frozen allowlist', () => {
    const found = scanRepo(importsAdWriteModule)
    const allowed = new Set(AD_WRITE_MODULE_IMPORTERS_ALLOWED)
    const offenders = found.filter((f) => !allowed.has(f))
    expect(
      offenders,
      '出现了新的「引入广告写入模块」的文件。\n' +
        '请把新文件拿去过 review，确认它确实走 /api/ad-approval，再决定是否扩白名单。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('createDraftForApproval callers are a subset of the frozen allowlist', () => {
    const found = scanRepo(mentionsCreateDraft)
    const allowed = new Set(CREATE_DRAFT_CALLERS_ALLOWED)
    const offenders = found.filter((f) => !allowed.has(f))
    expect(
      offenders,
      '出现了新的 createDraftForApproval 调用点。\n' +
        '请把新调用点拿去过 review，确认它只起草 PAUSED 广告，再决定是否扩白名单。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('publishDraftPaused callers are a subset of the frozen allowlist', () => {
    const found = scanRepo(mentionsPublishPaused)
    const allowed = new Set(PUBLISH_PAUSED_CALLERS_ALLOWED)
    const offenders = found.filter((f) => !allowed.has(f))
    expect(
      offenders,
      '出现了新的 publishDraftPaused 调用点。\n' +
        '请把新调用点拿去过 review，确认它不会把广告打开，再决定是否扩白名单。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('activation importers are a subset of the frozen allowlist', () => {
    const found = scanRepo(importsActivation)
    const allowed = new Set(ACTIVATION_IMPORTERS_ALLOWED)
    const offenders = found.filter((f) => !allowed.has(f))
    expect(
      offenders,
      '出现了新的「引入激活符号 / 激活模块」的文件。\n' +
        '请把新文件拿去过 review，确认它确实走 /api/ad-approval，再决定是否扩白名单。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })
})

describe('F. 探针：判据必须真的会响', () => {
  it('findViolations 命中禁用符号（含别名）', () => {
    expect(
      findViolations(`import { activatePublished } from '@/lib/meta/ad-publisher'`),
    ).toContain('forbidden_symbol:activatePublished')

    expect(
      findViolations(`import { approveDraft } from '@/lib/meta/ad-publisher'`),
    ).toContain('forbidden_symbol:approveDraft')

    // 别名：用导入名（propertyName），所以 `setAdSetStatus as s` 仍然要响
    expect(
      findViolations(`import { setAdSetStatus as s } from '@/lib/meta/adsets'`),
    ).toContain('forbidden_symbol:setAdSetStatus')
  })

  it('findViolations 命中禁用模块', () => {
    const v = findViolations(`import { a } from '@/lib/ads/spend-activation'`)
    expect(v.some((r) => r.startsWith('forbidden_module:'))).toBe(true)
  })

  it('extractImports 处理 re-export', () => {
    const re = extractImports(
      `export { activatePublished } from '@/lib/meta/ad-publisher'`,
    )
    expect(re).toContain('@/lib/meta/ad-publisher::activatePublished')
    expect(
      findViolations(`export { activatePublished } from '@/lib/meta/ad-publisher'`),
    ).toContain('forbidden_symbol:activatePublished')

    const star = extractImports(`export * from './x'`)
    expect(star).toContain('./x::*')
    expect(findViolations(`export * from './x'`)).toContain(
      'namespace_or_default_import',
    )

    const ns = extractImports(`export * as ns from './x'`)
    expect(ns).toContain('./x::*')
  })

  it('importsActivation 会响 / 不响（含别名）', () => {
    expect(
      importsActivation(
        `import { activatePublished as go } from '@/lib/meta/ad-publisher'\ngo()`,
      ),
    ).toBe(true)
    expect(importsActivation(`import { a } from './a'\nexport const b = a`)).toBe(false)
  })

  it('findViolations 命中 namespace / default import', () => {
    expect(findViolations(`import * as m from './x'`)).toContain(
      'namespace_or_default_import',
    )
    expect(findViolations(`import d from './x'`)).toContain(
      'namespace_or_default_import',
    )
  })

  it('findViolations 命中 dynamic import / require', () => {
    expect(findViolations(`const m = await import('./x')`)).toContain('dynamic_import')
    expect(findViolations(`const m = require('./x')`)).toContain('require_call')
  })

  it("findViolations 命中 'ACTIVE' 字面量（各种引号）", () => {
    expect(findViolations(`const s = 'ACTIVE'`)).toContain('active_literal')
    expect(findViolations(`const o = { status: "ACTIVE" }`)).toContain('active_literal')
    expect(findViolations('const s = `ACTIVE`')).toContain('active_literal')
  })

  it('findViolations 命中字符串花招', () => {
    // 字符串里的 `//` 不能吃掉后面的真实代码
    expect(findViolations(`const t = "a //"; const s = 'ACTIVE'`)).toContain(
      'active_literal',
    )
    // 子串匹配
    expect(findViolations(`const s = 'status=ACTIVE'`)).toContain('active_literal')
    // 拼接折叠
    expect(findViolations(`const s = 'ACT' + 'IVE'`)).toContain('active_literal')
    // 模板片段
    expect(findViolations('const s = `x${1}ACTIVE`')).toContain('active_literal')
    // 字符串里的 `/*` 不能吃掉后面的真实代码
    expect(
      findViolations(`const a = "/*"; const s = 'ACTIVE'; const b = "*/"`),
    ).toContain('active_literal')
  })

  it('findViolations 对注释里的违规不响', () => {
    expect(
      findViolations("// 'ACTIVE' activatePublished( import("),
    ).toEqual([])
    expect(findViolations("/* 'ACTIVE' activatePublished( import( */")).toEqual([])
  })

  it('findViolations 命中 fetch / GRAPH_BASE（受网络限制时）', () => {
    expect(findViolations(`await fetch('https://x')`)).toContain('fetch_call')
    expect(findViolations(`await fetch('https://x')`, { allowNetwork: true })).not.toContain(
      'fetch_call',
    )
    expect(findViolations(`globalThis.fetch('https://x')`)).toContain('fetch_call')
    expect(findViolations(`const u = GRAPH_BASE`)).toContain('graph_base_reference')
    expect(findViolations(`const u = GRAPH_BASE`, { allowNetwork: true })).not.toContain(
      'graph_base_reference',
    )
  })

  it('findViolations 对干净源码不响', () => {
    expect(findViolations(`import { a } from './a'\nexport const b = a`)).toEqual([])
  })

  it('findViolations 先挖空注释，注释里的违规不算', () => {
    expect(
      findViolations(`// activatePublished('ACTIVE') import('x')\nexport const ok = 1`),
    ).toEqual([])
  })

  it('diffImports 能看出新增与删除', () => {
    const base = ['a::x', 'b::y']
    expect(diffImports([...base, 'c::z'], base)).toEqual({ added: ['c::z'], removed: [] })
    expect(diffImports(['a::x'], base)).toEqual({ added: [], removed: ['b::y'] })
  })

  it('mentionsActivation 会响 / 不响', () => {
    expect(mentionsActivation(`await activatePublished(x)`)).toBe(true)
    expect(mentionsActivation(`setAdSetStatus(id, token, 'ACTIVE')`)).toBe(true)
    expect(mentionsActivation(`const o = { status: 'ACTIVE' }`)).toBe(true)

    // 类型位置（联合类型）不算写入
    expect(mentionsActivation(`type S = { status: 'ACTIVE' | 'PAUSED' }`)).toBe(false)
    expect(mentionsActivation(`const o = { status: 'PAUSED' }`)).toBe(false)
  })

  it('mentionsCreateDraft / mentionsPublishPaused 会响 / 不响', () => {
    expect(mentionsCreateDraft(`await createDraftForApproval(deps, input)`)).toBe(true)
    expect(mentionsCreateDraft(`const x = 1`)).toBe(false)

    expect(mentionsPublishPaused(`await publishDraftPaused(deps, id)`)).toBe(true)
    expect(mentionsPublishPaused(`const x = 1`)).toBe(false)
  })

  it('mentionsActivation / importsAdWriteModule 命中 namespace 别名', () => {
    const src = `import * as pub from '@/lib/meta/ad-publisher'\nconst go = pub.activatePublished`
    expect(mentionsActivation(src)).toBe(true)
    expect(importsAdWriteModule(src)).toBe(true)
  })

  it('mentionsActivation / importsAdWriteModule 命中动态 import + 解构', () => {
    const src = `const { activatePublished: go } = await import('@/lib/meta/ad-publisher')`
    expect(importsAdWriteModule(src)).toBe(true)
    expect(mentionsActivation(src)).toBe(true)
  })

  it('字符串里的 `//` 不能藏住后面的真实代码', () => {
    const src =
      `const u = 'a//b'\n` +
      `import { activatePublished as go } from '@/lib/meta/ad-publisher'`
    expect(mentionsActivation(src)).toBe(true)
    expect(importsAdWriteModule(src)).toBe(true)
  })

  it('findViolations 命中 fetch 引用（裸引用 / 元素访问）', () => {
    expect(findViolations(`const f = fetch`)).toContain('fetch_reference')
    expect(findViolations(`globalThis['fetch']('x')`)).toContain('fetch_reference')
  })

  it('findViolations 命中混淆字符串', () => {
    expect(findViolations(`String.fromCharCode(65,67)`)).toContain('obfuscated_string')
    expect(findViolations(`['ACT','IVE'].join('')`)).toContain('obfuscated_string')
    expect(findViolations(`'active'.toUpperCase()`)).toContain('obfuscated_string')
  })

  it('只在注释里提到时，四个判据都不响', () => {
    const src = `// activatePublished createDraftForApproval publishDraftPaused`
    expect(mentionsActivation(src)).toBe(false)
    expect(importsAdWriteModule(src)).toBe(false)
    expect(mentionsCreateDraft(src)).toBe(false)
    expect(mentionsPublishPaused(src)).toBe(false)
  })

  it('干净源码四个判据都不响', () => {
    const src = `import { a } from './a'\nexport const b = a`
    expect(mentionsActivation(src)).toBe(false)
    expect(importsAdWriteModule(src)).toBe(false)
    expect(mentionsCreateDraft(src)).toBe(false)
    expect(mentionsPublishPaused(src)).toBe(false)
  })
})
