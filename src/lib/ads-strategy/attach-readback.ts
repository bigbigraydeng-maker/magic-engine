/**
 * 挂到已有系列或已有广告组之后的回读。
 * 只要求这次新建的东西是暂停的。原来的系列和广告组可以仍是开着的。
 */

import type { AdDraft } from './ad-draft'
import type { LaunchFinding } from './launch-readback'
import type { PublishedDraft } from '@/lib/meta/ad-publisher'
import type { RawMetaAdCreative, RawMetaAdSet } from './meta-readback-adapter'

function newAdFindings(published: PublishedDraft, ads: readonly RawMetaAdCreative[]): LaunchFinding[] {
  const byId = new Map(ads.map((ad) => [ad.adId, ad]))
  const bad: string[] = []
  for (const id of published.adIds) {
    const ad = byId.get(id)
    const status = typeof ad?.status === 'string' ? ad.status : ''
    if (!ad) bad.push('有一条新广告回读里没有')
    else if (status.toUpperCase() !== 'PAUSED') bad.push(`新广告回读到「${status || '读不到'}」`)
  }
  if (bad.length === 0) return []
  return [{
    code: 'not_paused',
    severity: 'blocker',
    message: `加到已有广告组的新广告必须是暂停的。${bad.join('；')}。`,
    learnedFrom: '2026-10-04 魏征复审：「全程 PAUSED」要有回读证据，读不到不等于暂停着',
  }]
}

export function attachReadbackFindings(
  draft: AdDraft,
  published: PublishedDraft,
  rawAdSet: RawMetaAdSet,
  ads: readonly RawMetaAdCreative[],
): LaunchFinding[] {
  if (draft.existingAdSetId) return newAdFindings(published, ads)
  if (!draft.existingCampaignId) return []
  const findings: LaunchFinding[] = []
  const status = typeof rawAdSet.status === 'string' ? rawAdSet.status : ''
  if (status.toUpperCase() !== 'PAUSED') {
    findings.push({
      code: 'not_paused',
      severity: 'blocker',
      message: `新广告组应该是暂停的，回读到「${status || '读不到'}」。读不到也算没确认。`,
      learnedFrom: '2026-10-04 魏征复审：「全程 PAUSED」要有回读证据，读不到不等于暂停着',
    })
  }
  const campaignId = typeof rawAdSet.campaign_id === 'string' ? rawAdSet.campaign_id : null
  if (campaignId !== draft.existingCampaignId) {
    findings.push({
      code: 'attached_to_wrong_campaign',
      severity: 'blocker',
      message: '新广告组回读到的系列，和确认卡上的已有系列对不上。保持暂停，不删除。',
      learnedFrom: '往已有系列加组时，系列编号必须和回读一致，不能建到别的系列下',
    })
  }
  return findings
}
