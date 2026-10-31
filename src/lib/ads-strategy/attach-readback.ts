/**
 * 挂到已有系列之后的回读。
 * 只要求这次新建的广告组是暂停的。原来的系列可以仍是开着的，不能因此去关它。
 */

import type { AdDraft } from './ad-draft'
import type { LaunchFinding } from './launch-readback'
import type { RawMetaAdSet } from './meta-readback-adapter'

export function attachReadbackFindings(draft: AdDraft, rawAdSet: RawMetaAdSet): LaunchFinding[] {
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
