import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runScaleFallback } from '../run'

describe('每天提议收回，自己不改预算', () => {
  it('读取失败时不出卡，也不改预算', async () => {
    const sb = { from() { throw new Error('down') } } as unknown as SupabaseClient
    const result = await runScaleFallback(sb, '00000000-0000-4000-8000-000000000001')
    expect(result.cards).toBe(0)
    expect(result.wroteMeta).toBe(false)
    expect(result.error).toContain('down')
  })

  it('这一步不调用广告接口，也不改预算', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/ads-strategy/scale-fallback/run.ts'), 'utf8')
    expect(source).not.toContain('graph.facebook')
    expect(source).toContain('wroteMeta: false')
    expect(source).toContain("lifetime: 'nz_day'")
  })
})
