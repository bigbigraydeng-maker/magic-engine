/**
 * Structural invariants of the module, as assertions.
 *
 * These are the properties that decay silently: an import that quietly couples
 * the control plane to Magic Engine's runtime, a file that drifts past the size
 * limit, an `any` that slips in under a deadline. None of them break a test —
 * which is exactly why they need one.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const MODULE_ROOT = join(process.cwd(), 'tools/ai-orchestrator')
const SRC_ROOT = join(MODULE_ROOT, 'src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const sourceFiles = walk(SRC_ROOT).filter((path) => path.endsWith('.ts'))
const allFiles = walk(MODULE_ROOT).filter((path) => path.endsWith('.ts'))

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

/** Strips comments so prose like "import the provider" is not read as an import. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function importsOf(source: string): string[] {
  const code = stripComments(source)
  const specifiers: string[] = []

  for (const pattern of [
    // `import … from 'x'` / `export … from 'x'`
    /^\s*(?:import|export)\b[^'"\n]*?\bfrom\s+['"]([^'"]+)['"]/gm,
    // bare side-effect import: `import 'x'`
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    // `require('x')`, used for the typed js-yaml load
    /\brequire(?:FromHere)?\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(code)) !== null) specifiers.push(match[1])
  }

  return specifiers
}

describe('the module is self-contained', () => {
  it('has source files to check, so this suite is not vacuous', () => {
    expect(sourceFiles.length).toBeGreaterThan(15)
  })

  it.each(sourceFiles.map((path) => relative(MODULE_ROOT, path)))(
    '%s imports nothing from the Magic Engine application',
    (relativePath) => {
      const specifiers = importsOf(read(join(MODULE_ROOT, relativePath)))
      const forbidden = specifiers.filter(
        (specifier) =>
          specifier.startsWith('@/') ||
          specifier.startsWith('src/') ||
          specifier.includes('../../src/') ||
          specifier.includes('../../../src/')
      )
      expect(forbidden, `${relativePath} must not reach into src/`).toEqual([])
    }
  )

  it('never imports the database, the web framework, or a payment client', () => {
    const banned = ['@supabase/supabase-js', '@supabase/ssr', 'next', 'stripe', 'resend']
    for (const path of allFiles) {
      const specifiers = importsOf(read(path))
      for (const specifier of specifiers) {
        expect(
          banned,
          `${relative(MODULE_ROOT, path)} imports ${specifier}`
        ).not.toContain(specifier)
      }
    }
  })

  it('adds no runtime dependency beyond what the repository already has', () => {
    const rootPackage = JSON.parse(read(join(process.cwd(), 'package.json'))) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const available = new Set([
      ...Object.keys(rootPackage.dependencies),
      ...Object.keys(rootPackage.devDependencies),
      // Transitive, and loaded through createRequire with an explicit type.
      // See the note in workflow-supply-chain.test.ts.
      'js-yaml',
    ])

    for (const path of allFiles) {
      for (const specifier of importsOf(read(path))) {
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
        const packageName = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0]
        expect(
          available.has(packageName),
          `${relative(MODULE_ROOT, path)} imports ${packageName}, which is not in package.json`
        ).toBe(true)
      }
    }
  })

  it('has no package.json of its own, so there is one dependency tree', () => {
    const nested = walk(MODULE_ROOT).filter((path) => path.endsWith('package.json'))
    expect(nested).toEqual([])
  })

  it('carries no build artefacts that could be committed by accident', () => {
    // The root .gitignore lists `/node_modules` — rooted, so a *nested* one is
    // not ignored and `git add -A` would commit it. Running vitest with a cwd
    // inside this directory creates exactly that (`node_modules/.vite`), which is
    // how this nearly happened.
    const artefacts = readdirSync(MODULE_ROOT).filter((entry) =>
      ['node_modules', 'dist', '.next', 'coverage', '.turbo'].includes(entry)
    )
    expect(artefacts, `remove ${artefacts.join(', ')} from ${MODULE_ROOT}`).toEqual([])
  })
})

describe('house rules from CLAUDE.md', () => {
  it.each(allFiles.map((path) => relative(MODULE_ROOT, path)))(
    '%s stays under 800 lines',
    (relativePath) => {
      const lines = read(join(MODULE_ROOT, relativePath)).split('\n').length
      expect(lines, `${relativePath} is ${lines} lines`).toBeLessThanOrEqual(800)
    }
  )

  it('uses no bare `any`', () => {
    // Assembled from fragments so this file does not match its own detector — an
    // exclusion list would be a hole that could later hide a real offender.
    const ANY = 'any'
    const detector = new RegExp(`:\\s*${ANY}\\b|<${ANY}>|\\bas ${ANY}\\b`)

    const offenders: string[] = []
    for (const path of allFiles) {
      if (detector.test(read(path))) offenders.push(relative(MODULE_ROOT, path))
    }
    expect(offenders).toEqual([])
  })

  it('initialises no SDK client at module scope', () => {
    // The repository's rule: SDK clients are constructed inside handlers, never at
    // import time. Here the equivalent is that no adapter builds a client eagerly.
    const offenders: string[] = []
    for (const path of sourceFiles) {
      const source = read(path)
      if (/^const \w+ = new (OpenAI|Anthropic)\(/m.test(source)) {
        offenders.push(relative(MODULE_ROOT, path))
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('the control plane cannot be reached from the application', () => {
  it(
    'is not imported by any Magic Engine source file',
    () => {
      const appSrc = join(process.cwd(), 'src')
      const appFiles = walk(appSrc).filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))
      // Not vacuous: if the walk ever returns nothing, the assertion below passes
      // for the wrong reason.
      expect(appFiles.length).toBeGreaterThan(100)
      const offenders = appFiles.filter((path) => read(path).includes('tools/ai-orchestrator'))
      expect(offenders.map((path) => relative(process.cwd(), path))).toEqual([])
    },
    // This reads every one of ~700 application source files synchronously while
    // the module's other suites run in parallel. Measured at 5-9s on a loaded
    // machine, which straddles vitest's 5s default and made it flake — as an
    // intermittent failure of a check that had found nothing, i.e. the worst
    // possible signal. The bound is the honest cost of a whole-repository scan,
    // not a workaround for a slow assertion.
    60_000
  )
})
