import { describe, expect, it } from 'vitest'
import { isSheetDealSyncEnabled } from '../sheet-deal-sync'

describe('isSheetDealSyncEnabled', () => {
  it('is off unless the flag is exactly 1 or true', () => {
    expect(isSheetDealSyncEnabled({})).toBe(false)
    expect(isSheetDealSyncEnabled({ CONVERSION_SHEET_DEAL_SYNC: '0' })).toBe(false)
    expect(isSheetDealSyncEnabled({ CONVERSION_SHEET_DEAL_SYNC: 'yes' })).toBe(false)
    expect(isSheetDealSyncEnabled({ CONVERSION_SHEET_DEAL_SYNC: '1' })).toBe(true)
    expect(isSheetDealSyncEnabled({ CONVERSION_SHEET_DEAL_SYNC: 'true' })).toBe(true)
  })
})
