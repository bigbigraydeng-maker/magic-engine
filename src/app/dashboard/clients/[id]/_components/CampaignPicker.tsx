'use client'

/**
 * Picks which campaign the 图文帖子 tab shows. Titles are long, so the control shows the short name
 * (full title on hover); two or three campaigns are side-by-side buttons, more than that a dropdown.
 * Display only: it just tells the page which campaign id was chosen.
 */
import { shortCampaignNames } from '@/lib/social/campaign-labels'

interface PickerCampaign {
  id: string
  title: string
}

const LABEL = 'text-xs font-semibold text-me-charcoal/70'
const SEGMENTED_LIMIT = 3

export function CampaignPicker({ campaigns, selectedId, onSelect }: {
  campaigns: ReadonlyArray<PickerCampaign>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (campaigns.length < 2) return null
  const names = shortCampaignNames(campaigns.map((campaign) => campaign.title))
  if (campaigns.length <= SEGMENTED_LIMIT) {
    return (
      <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="campaign-picker-label">
        <span id="campaign-picker-label" className={LABEL}>推广活动</span>
        {campaigns.map((campaign, index) => (
          <button
            key={campaign.id}
            type="button"
            title={campaign.title}
            aria-pressed={campaign.id === selectedId}
            onClick={() => onSelect(campaign.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              campaign.id === selectedId
                ? 'border-me-ochre bg-me-ochre text-me-charcoal'
                : 'border-black/10 bg-white text-me-charcoal/70 hover:border-me-ochre/40'
            }`}
          >
            {names[index]}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="campaign-picker" className={LABEL}>推广活动</label>
      <select
        id="campaign-picker"
        value={selectedId ?? ''}
        onChange={(event) => onSelect(event.target.value)}
        className="min-w-0 max-w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm text-me-charcoal focus:outline-none focus:ring-2 focus:ring-me-ochre"
      >
        {campaigns.map((campaign, index) => (
          <option key={campaign.id} value={campaign.id} title={campaign.title}>
            {names[index]}
          </option>
        ))}
      </select>
      <span className="text-xs text-me-charcoal/65">共 {campaigns.length} 个进行中</span>
    </div>
  )
}
