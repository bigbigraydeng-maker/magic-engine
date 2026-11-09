/** One video's editorial relationship to the client's website and other campaigns. */
export type AlignmentState = 'aligned' | 'not_applicable' | 'unknown' | 'conflict'

export interface SearchEvidence {
  status: 'observed' | 'not_collected'
  source?: string
  observedAt?: string
  dateRange?: string
  market?: string
  finding?: string
  metricName?: string
  value?: number | null
}

export interface WebsiteCheck {
  status: 'verified' | 'unverified'
  url?: string
  checkedAt?: string
  pageTitle?: string
  contentHash?: string
  reason?: string
}

export interface TopicAlignment {
  contentTitleSnapshot: string
  videoFormat: 'long' | 'short'
  primaryKeyword: string
  searchIntent: string
  audienceMarket: string
  googleEvidence: SearchEvidence
  youtubeEvidence: SearchEvidence
  websiteUrl: string
  websiteTheme: string
  websiteCheck: WebsiteCheck
  promotionUrl: string | null
  promotionCheck: WebsiteCheck
  promotionAlignment: AlignmentState
  promotionNote: string
  campaignBriefId: string | null
  campaignSourceHash: string | null
  adsAlignment: AlignmentState
  adsNote: string
  socialPlanId: string | null
  socialSourceHash: string | null
  socialAlignment: AlignmentState
  socialNote: string
  contentPromise: string
}

export function officialWebsiteUrl(value: string, allowedHosts: string[]): URL | null {
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  const allowed = allowedHosts.some((host) => hostname === host.toLowerCase().replace(/^www\./, ''))
  return allowed ? url : null
}

export function websiteHosts(clientDomain: string | null, briefWebsite: string | null): string[] {
  const hosts = [clientDomain, briefWebsite].flatMap((value) => {
    if (!value) return []
    try { return [new URL(value.includes('://') ? value : `https://${value}`).hostname] } catch { return [] }
  })
  return [...new Set(hosts)]
}

function evidenceObserved(evidence: SearchEvidence, requireMetric: boolean): boolean {
  const observedTime = evidence.observedAt ? Date.parse(evidence.observedAt) : NaN
  const age = Date.now() - observedTime
  return evidence.status === 'observed' && Boolean(evidence.source?.trim()) &&
    Number.isFinite(age) && age >= -300_000 && age <= 90 * 86_400_000 &&
    Boolean(evidence.dateRange?.trim()) && Boolean(evidence.market?.trim()) &&
    Boolean(evidence.finding?.trim()) &&
    (!requireMetric || (Boolean(evidence.metricName?.trim()) &&
      typeof evidence.value === 'number' && Number.isFinite(evidence.value) && evidence.value >= 0))
}

function channelAligned(state: AlignmentState, ref: string | null, note: string): boolean {
  if (state === 'aligned') return Boolean(ref && note.trim())
  if (state === 'not_applicable') return note.trim().length >= 10
  return false
}

function checkedRecently(checkedAt: string | undefined): boolean {
  const checkedTime = checkedAt ? Date.parse(checkedAt) : NaN
  const age = Date.now() - checkedTime
  return Number.isFinite(age) && age >= -300_000 && age <= 7 * 86_400_000
}

export function topicAlignmentGaps(
  value: TopicAlignment | null,
  allowedHosts: string[],
  current?: { title: string; ratio?: string | null; campaignId?: string | null; keywords: string[]; campaignSourceHash: string | null; socialSourceHash: string | null },
): string[] {
  if (!value) return ['主题对齐卡未建立']
  const gaps: string[] = []
  if (current && value.contentTitleSnapshot !== current.title) gaps.push('标题变更后尚未重新核对主题')
  if (!['long', 'short'].includes(value.videoFormat)) gaps.push('横屏或 Short 类型未选')
  if (current?.ratio === '9:16' && value.videoFormat !== 'short' ||
      current?.ratio === '16:9' && value.videoFormat !== 'long') gaps.push('视频类型与内容画幅不一致')
  if (!value.primaryKeyword.trim()) gaps.push('主关键词缺失')
  if (current && !current.keywords.includes(value.primaryKeyword.trim().toLowerCase().replace(/\s+/g, ' '))) gaps.push('主关键词不在客户 SEO 关键词清单中')
  if (!value.searchIntent.trim() || !value.audienceMarket.trim()) gaps.push('搜索意图或目标市场缺失')
  if (!evidenceObserved(value.googleEvidence, true)) gaps.push('Google 网站搜索证据未核')
  if (!evidenceObserved(value.youtubeEvidence, false)) gaps.push('YouTube 选题证据未核')
  if (!officialWebsiteUrl(value.websiteUrl, allowedHosts)) gaps.push('官网承接页不属于已配置官网')
  if (!value.websiteTheme.trim()) gaps.push('官网主题对应关系未写')
  if (value.websiteCheck.status !== 'verified' || value.websiteCheck.url !== value.websiteUrl ||
      !value.websiteCheck.checkedAt || !value.websiteCheck.contentHash ||
      !checkedRecently(value.websiteCheck.checkedAt)) gaps.push('官网页面未在近 7 天读回核对')
  if (!channelAligned(value.promotionAlignment, value.promotionUrl, value.promotionNote)) gaps.push('官网推广内容对应关系未核')
  if (value.promotionAlignment === 'aligned' && !officialWebsiteUrl(value.promotionUrl ?? '', allowedHosts)) gaps.push('官网推广页面不属于已配置官网')
  if (value.promotionAlignment === 'aligned' && (value.promotionCheck.status !== 'verified' ||
      value.promotionCheck.url !== value.promotionUrl || !value.promotionCheck.contentHash ||
      !checkedRecently(value.promotionCheck.checkedAt))) gaps.push('官网推广页面未在近 7 天读回核对')
  if (!channelAligned(value.adsAlignment, value.campaignBriefId, value.adsNote)) gaps.push('广告活动主题对应关系未核')
  if (current?.campaignId && (value.adsAlignment !== 'aligned' || value.campaignBriefId !== current.campaignId)) {
    gaps.push('内容已关联广告活动，需核对同一活动')
  }
  if (current && value.adsAlignment === 'aligned' && (!value.campaignSourceHash || value.campaignSourceHash !== current.campaignSourceHash)) gaps.push('广告活动内容已变化，需重新核对')
  if (!channelAligned(value.socialAlignment, value.socialPlanId, value.socialNote)) gaps.push('社媒计划主题对应关系未核')
  if (current && value.socialAlignment === 'aligned' && (!value.socialSourceHash || value.socialSourceHash !== current.socialSourceHash)) gaps.push('社媒计划内容已变化，需重新核对')
  if (!value.contentPromise.trim()) gaps.push('视频承诺缺失')
  return gaps
}
