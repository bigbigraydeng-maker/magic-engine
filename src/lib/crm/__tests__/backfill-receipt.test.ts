import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeStartReceipt } from '../backfill-receipt'

describe('writeStartReceipt', () => {
  it('writes a run_started line to a writable path', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'receipt-')), 'wa.jsonl')
    writeStartReceipt(file, { client_id: 'c1', live: true })
    const row = JSON.parse(readFileSync(file, 'utf8').trim())
    expect(row).toMatchObject({ what: 'run_started', client_id: 'c1', live: true })
  })

  it('throws when the path is not writable, so no DB update can follow', () => {
    const file = join(tmpdir(), 'no-such-dir-xyz', 'wa.jsonl')
    expect(() => writeStartReceipt(file, { client_id: 'c1' })).toThrow(/回执文件不可写/)
  })
})
