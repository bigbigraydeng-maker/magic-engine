import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { shiftDate } from '@/lib/ledger/walk'
import { buildLedgerView } from '../ledger-view'

const TODAY = '2026-09-30'

let dirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-view-'))
  dirs.push(dir)
  return dir
}

function writeCard(dir: string, id: string, frontMatter: string[]): void {
  writeFileSync(join(dir, `${id}.md`), `---\n${frontMatter.join('\n')}\n---\n\nbody\n`)
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('buildLedgerView', () => {
  it('does not cover a decided card idle more than 7 days (dev lane)', () => {
    const dir = makeDir()
    writeCard(dir, 'card-decided', [
      'id: card-decided',
      'title: Decided card',
      'status: decided',
      'owner: pm',
      `decided_on: ${shiftDate(TODAY, -10)}`,
      'source: session:abcd1234',
      'verify_how: check the thing',
    ])

    const view = buildLedgerView(TODAY, dir)

    expect(view.cards.get('card-decided')?.status).toBe('decided')
    expect(view.coveredLedgerIds.has('card-decided')).toBe(false) // 决定了没动现在在开发欠账栏，PM 邮件里没有
    expect(view.parseErrorCount).toBe(0)
  })

  it('does not cover a done card past verify_by (dev lane)', () => {
    const dir = makeDir()
    writeCard(dir, 'card-done', [
      'id: card-done',
      'title: Done card',
      'status: done',
      'owner: agent',
      `decided_on: ${shiftDate(TODAY, -20)}`,
      'source: session:abcd1234',
      'verify_how: check the thing',
      `done_on: ${shiftDate(TODAY, -10)}`,
      'done_ref: doc:docs/x.md',
      `verify_by: ${shiftDate(TODAY, -3)}`,
    ])

    const view = buildLedgerView(TODAY, dir)

    expect(view.cards.get('card-done')?.status).toBe('done')
    expect(view.coveredLedgerIds.has('card-done')).toBe(false)
  })

  it('does not cover a failed card (dev lane)', () => {
    const dir = makeDir()
    writeCard(dir, 'card-failed', [
      'id: card-failed',
      'title: Failed card',
      'status: failed',
      'owner: agent',
      `decided_on: ${shiftDate(TODAY, -20)}`,
      'source: session:abcd1234',
      'verify_how: check the thing',
      `done_on: ${shiftDate(TODAY, -10)}`,
      'done_ref: doc:docs/x.md',
      'verified_ref: doc:docs/y.md',
      `last_checked: ${shiftDate(TODAY, -5)}`,
    ])

    const view = buildLedgerView(TODAY, dir)

    expect(view.cards.get('card-failed')?.status).toBe('failed')
    // 2026-10-12 起「验过不成」在开发欠账栏、PM 邮件里没有，所以不算「已覆盖」
    expect(view.coveredLedgerIds.has('card-failed')).toBe(false)
  })

  it('lists a verified card but does not cover it', () => {
    const dir = makeDir()
    writeCard(dir, 'card-verified', [
      'id: card-verified',
      'title: Verified card',
      'status: verified',
      'owner: agent',
      `decided_on: ${shiftDate(TODAY, -20)}`,
      'source: session:abcd1234',
      'verify_how: check the thing',
      `done_on: ${shiftDate(TODAY, -10)}`,
      'done_ref: doc:docs/x.md',
      'verified_ref: doc:docs/y.md',
      `last_checked: ${shiftDate(TODAY, -5)}`,
    ])

    const view = buildLedgerView(TODAY, dir)

    expect(view.cards.get('card-verified')?.status).toBe('verified')
    expect(view.cards.get('card-verified')?.verifiedRef).toBe('doc:docs/y.md')
    expect(view.coveredLedgerIds.has('card-verified')).toBe(false)
  })

  it('counts a malformed file as a parse error', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'broken.md'), 'not front matter at all\n')

    const view = buildLedgerView(TODAY, dir)

    expect(view.parseErrorCount).toBe(1)
  })

  it('throws when the directory does not exist', () => {
    const dir = join(tmpdir(), 'ledger-view-does-not-exist-xyz')

    expect(() => buildLedgerView(TODAY, dir)).toThrow()
  })
})
