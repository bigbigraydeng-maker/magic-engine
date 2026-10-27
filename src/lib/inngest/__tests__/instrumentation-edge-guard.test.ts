import { readFileSync } from 'fs'
import path from 'path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Next also builds src/instrumentation.ts for the Edge runtime. If the boot sync can be reached there, the bundler follows
 * it to crypto / net / dns, the Edge build fails and nothing deploys.
 *
 * This only runs when someone runs the whole test suite. It is NOT one of the checks a pull request must pass (those are
 * listed in .github/workflows/pr-light-checks.yml, and a full build only runs when started by hand), so the first
 * automatic sign of this mistake is still a failed deploy on Render. It is a cheap marker for the next person who runs the
 * tests, not a gate.
 */
function isNodeRuntimeCheck(node: ts.Expression): boolean {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return false
  const isRuntime = (e: ts.Expression) => ts.isPropertyAccessExpression(e) && e.name.text === 'NEXT_RUNTIME' && e.expression.getText() === 'process.env'
  const isNode = (e: ts.Expression) => ts.isStringLiteralLike(e) && e.text === 'nodejs'
  return (isRuntime(node.left) && isNode(node.right)) || (isRuntime(node.right) && isNode(node.left))
}

/** Is `node` inside the "then" branch of an `if (process.env.NEXT_RUNTIME === 'nodejs')`? */
function insideNodeOnlyBranch(node: ts.Node): boolean {
  for (let child: ts.Node = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent) && parent.thenStatement === child && isNodeRuntimeCheck(parent.expression)) return true
  }
  return false
}

/** What is wrong with this version of instrumentation.ts, in plain words. Empty = nothing. */
function problemsIn(text: string): string[] {
  const file = ts.createSourceFile('instrumentation.ts', text, ts.ScriptTarget.Latest, true)
  const problems: string[] = []
  const imports: ts.CallExpression[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) imports.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) problems.push('a static import is followed in every runtime')
  }
  if (imports.length === 0) problems.push('the boot sync is not loaded at all')
  for (const call of imports) {
    if (!insideNodeOnlyBranch(call)) problems.push(`import(${call.arguments[0]?.getText() ?? ''}) is reachable outside an "is nodejs" branch`)
  }
  return problems
}

const REAL_FILE = path.resolve(__dirname, '../../../instrumentation.ts')

describe('src/instrumentation.ts keeps Node-only code out of the Edge build', () => {
  it('the real file loads the boot sync only inside an "is nodejs" branch', () => {
    expect(problemsIn(readFileSync(REAL_FILE, 'utf8'))).toEqual([])
  })

  it('flags the old early-return form, which still lets the bundler follow the import', () => {
    const early = `export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { run } = await import('@/lib/inngest/sync-on-boot')
  run()
}`
    expect(problemsIn(early)).toHaveLength(1)
  })

  it('flags an import that was moved out of the check, even when an "is nodejs" check is still there', () => {
    const moved = `export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('boot')
  }
  const { run } = await import('@/lib/inngest/sync-on-boot')
  run()
}`
    expect(problemsIn(moved)).toHaveLength(1)
  })

  it('flags a second import outside the check, and a static import', () => {
    const extra = `import { createHash } from 'crypto'
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@/lib/inngest/sync-on-boot')
  }
  await import('@/lib/inngest/other')
}`
    expect(problemsIn(extra)).toHaveLength(2)
  })

  it('accepts harmless rewrites: quotes, order of the comparison, type-only imports, extra code in the branch', () => {
    const fine = `import type { Foo } from './types'
export async function register(): Promise<void> {
  if ("nodejs" === process.env.NEXT_RUNTIME) {
    try {
      const { run } = await import("@/lib/inngest/sync-on-boot")
      run()
    } catch (err) {
      console.error(err)
    }
  }
}`
    expect(problemsIn(fine)).toEqual([])
  })
})
