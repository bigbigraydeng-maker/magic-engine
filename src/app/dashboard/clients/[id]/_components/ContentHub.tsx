'use client'

import { CampaignPanel } from './CampaignPanel'

interface Props {
  clientId: string
}

// 生产快捷入口(社媒日常 / 内容工厂)已摘:客户页「工具」tab 的社媒门卡、出片门卡
// 才是唯一入口(spec 2026-10-25-video-factory-consolidation)。页面路由本身保留。
export function ContentHub({ clientId }: Props) {
  return (
    <div className="space-y-6">
      {/* Campaign management — strategic layer */}
      <CampaignPanel clientId={clientId} />
    </div>
  )
}
