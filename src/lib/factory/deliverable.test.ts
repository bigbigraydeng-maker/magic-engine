import { describe, expect, it } from 'vitest'
import { isAssetOnly } from './deliverable'

describe('isAssetOnly', () => {
  it('true only for the exact asset_only marker', () => {
    expect(isAssetOnly({ remotion: { deliverable: 'asset_only' } })).toBe(true)
  })

  it('false for non-object briefs', () => {
    expect(isAssetOnly(undefined)).toBe(false)
    expect(isAssetOnly(null)).toBe(false)
    expect(isAssetOnly('asset_only')).toBe(false)
    expect(isAssetOnly([])).toBe(false)
  })

  it('false for near-miss or malformed markers', () => {
    expect(isAssetOnly({ remotion: { deliverable: 'Asset_Only' } })).toBe(false)
    expect(isAssetOnly({ remotion: { deliverable: 'asset-only' } })).toBe(false)
    expect(isAssetOnly({ remotion: { deliverable: true } })).toBe(false)
    expect(isAssetOnly({ remotion: {} })).toBe(false)
    expect(isAssetOnly({ remotion: 'x' })).toBe(false)
  })
})
