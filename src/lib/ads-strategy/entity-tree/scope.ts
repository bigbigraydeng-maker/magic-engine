/**
 * Keep only the client's own ad sets (and their ads / campaigns) in a shared ad account.
 * Reuses the diagnostics ownership rule: an ad set is the client's only when every ad under it
 * points at the client's Facebook page. Unsure → not listed (fail-closed), same as the health engine.
 */
import { ownershipOfAds } from '../portfolio/diagnostics/ownership'
import type { InsightRow, SnapshotRow } from './build'

export interface ScopedInputs {
  insights: InsightRow[]
  snapshots: SnapshotRow[]
  /** ad sets dropped because they are not the client's, or have no ad to prove it */
  droppedAdsets: number
}

function latestByEntity(rows: SnapshotRow[], level: SnapshotRow['level']): Map<string, SnapshotRow> {
  const out = new Map<string, SnapshotRow>()
  for (const r of rows) {
    if (r.level !== level) continue
    const prev = out.get(r.entityId)
    if (!prev || r.capturedAt > prev.capturedAt) out.set(r.entityId, r)
  }
  return out
}

export function scopeToClientPage(insights: InsightRow[], snapshots: SnapshotRow[], clientPageId: string | null): ScopedInputs {
  if (!clientPageId) return { insights: [], snapshots: [], droppedAdsets: 0 }

  const adsetIds = new Set<string>()
  for (const r of snapshots) if (r.level === 'adset') adsetIds.add(r.entityId)
  for (const r of insights) if (r.level === 'adset') adsetIds.add(r.entityId)

  const adsByAdset = new Map<string, SnapshotRow[]>()
  for (const ad of latestByEntity(snapshots, 'ad').values()) {
    if (!ad.adsetId) continue
    const list = adsByAdset.get(ad.adsetId) ?? []
    list.push(ad)
    adsByAdset.set(ad.adsetId, list)
  }

  const own = new Set<string>()
  for (const id of adsetIds) {
    const ads = adsByAdset.get(id) ?? []
    if (ads.length > 0 && ownershipOfAds(ads.map(a => ({ creative_page_id: a.creativePageId ?? null })), clientPageId) === 'own') own.add(id)
  }

  const adToAdset = new Map<string, string>()
  for (const ad of latestByEntity(snapshots, 'ad').values()) if (ad.adsetId) adToAdset.set(ad.entityId, ad.adsetId)
  for (const r of insights) if (r.level === 'ad' && r.parentId && !adToAdset.has(r.entityId)) adToAdset.set(r.entityId, r.parentId)

  const adsetCampaign = new Map<string, string>()
  for (const s of latestByEntity(snapshots, 'adset').values()) if (s.campaignId) adsetCampaign.set(s.entityId, s.campaignId)
  for (const r of insights) if (r.level === 'adset' && r.parentId && !adsetCampaign.has(r.entityId)) adsetCampaign.set(r.entityId, r.parentId)

  const keptCampaigns = new Set<string>()
  for (const id of own) {
    const c = adsetCampaign.get(id)
    if (c) keptCampaigns.add(c)
  }

  const keep = (level: SnapshotRow['level'], id: string): boolean => {
    if (level === 'adset') return own.has(id)
    if (level === 'ad') {
      const parent = adToAdset.get(id)
      return parent !== undefined && own.has(parent)
    }
    return keptCampaigns.has(id)
  }

  return {
    insights: insights.filter(r => keep(r.level, r.entityId)),
    snapshots: snapshots.filter(r => keep(r.level, r.entityId)),
    droppedAdsets: [...adsetIds].filter(id => !own.has(id)).length,
  }
}
