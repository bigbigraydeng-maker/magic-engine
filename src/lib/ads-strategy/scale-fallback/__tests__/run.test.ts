import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runScaleFallback } from '../run'

const loadApprovedPromoDeliveryStage = vi.fn()

vi.mock('@/lib/marketing-plan/promo/approved-delivery-stage', () => ({
  loadApprovedPromoDeliveryStage: (...args: unknown[]) => loadApprovedPromoDeliveryStage(...args),
}))

beforeEach(() => {
  loadApprovedPromoDeliveryStage.mockReset()
  loadApprovedPromoDeliveryStage.mockResolvedValue({ kind: 'set', stage: 'scale' })
})

describe('每天提议收回，自己不改预算', () => {
  it('缺投放阶段时不出卡，并写明 no_delivery_stage', async () => {
    loadApprovedPromoDeliveryStage.mockResolvedValue({ kind: 'missing' })
    const sb = { from() { throw new Error('down') } } as unknown as SupabaseClient
    const result = await runScaleFallback(sb, '00000000-0000-4000-8000-000000000001')
    expect(result).toMatchObject({ cards: 0, skipped: ['no_delivery_stage'], wroteMeta: false })
  })

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
