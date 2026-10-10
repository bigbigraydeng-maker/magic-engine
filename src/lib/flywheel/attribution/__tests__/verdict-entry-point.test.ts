/**
 * Every stored verdict goes through computeOutcomeVerdict — asserted on the source.
 *
 * computeVerdict stays exported for its own unit tests, but calling it directly from a
 * writer would skip the whole-site rule (isSiteLevelUnattributable) without changing
 * any behaviour a test could see today. So the rule is checked where it can be broken:
 * the only non-comment call to computeVerdict in src/ must be the one inside
 * computeOutcomeVerdict in job.ts.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.join(process.cwd(), 'src')
const CALL = /\bcomputeVerdict\(/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/** Lines that are code, not comments — a comment may mention the function by name. */
function codeLines(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
}

describe('verdict entry point', () => {
  it('only job.ts calls computeVerdict, and only from computeOutcomeVerdict', () => {
    const callers = sourceFiles(SRC)
      .filter((file) => codeLines(file).some((line) => CALL.test(line)))
      .map((file) => path.relative(process.cwd(), file))

    expect(callers).toEqual([path.join('src', 'lib', 'flywheel', 'attribution', 'job.ts')])

    const jobLines = codeLines(path.join(SRC, 'lib', 'flywheel', 'attribution', 'job.ts'))
    const hits = jobLines.filter((line) => CALL.test(line))
    // The definition itself plus the single call inside computeOutcomeVerdict.
    expect(hits).toHaveLength(2)
    expect(hits.some((line) => line.includes('export function computeVerdict('))).toBe(true)
  })

  it('both writers score through computeOutcomeVerdict', () => {
    const job = readFileSync(path.join(SRC, 'lib', 'flywheel', 'attribution', 'job.ts'), 'utf8')
    const bridge = readFileSync(path.join(SRC, 'lib', 'flywheel', 'attribution', 'gsc-bridge.ts'), 'utf8')
    expect(job).toContain('computeOutcomeVerdict(expected_metric')
    expect(bridge.match(/computeOutcomeVerdict\(dim\.metricKey/g)?.length).toBe(2)
  })
})
