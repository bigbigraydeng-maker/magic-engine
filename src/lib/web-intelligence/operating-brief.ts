import { matchTravelScope, type TravelScope, type TourRecord } from './profiles/travel'

export type OperatingFactType = 'fact' | 'inference' | 'recommendation' | 'unknown'
export type ProductMatchStatus = 'comparable' | 'out_of_scope' | 'insufficient_evidence'

export type OperatingEvidence = {
  id: string
  client_id: string
  source: string
  scope: 'client' | 'competitor' | 'industry'
  statement: string
  observed_at: string | null
  fact_type: OperatingFactType
  confidence: 'high' | 'medium' | 'low'
}

export type OperatingSignal = {
  statement: string
  source_url: string
  observed_at: string | null
  valid_until: string | null
}

export type ProductMatch = {
  status: ProductMatchStatus
  client_product: string | null
  client_duration_days?: number
  client_price?: string
  competitor_product: string | null
  competitor_domain?: string
  competitor_duration_days?: number
  competitor_price?: string
  match_score?: number
  reason: string
}

export type TourCatalogItem = {
  domain: string
  source_url: string
  observed_at: string | null
  record: TourRecord
}

export type TourComparisonCandidate = {
  client_product: OperatingBriefInput['client_products'][number]
  competitor_product: { name: string; source_url: string; observed_at: string | null; record: TourRecord }
  match_score: number
}

export type OperatingDecision = {
  question: string
  context: string[]
  external_signal: OperatingSignal[]
  impact: string
  recommendation: string
  authorization: 'review_required'
  evidence: OperatingEvidence[]
  unknowns: string[]
  check_and_tune: string
}

export type OperatingBrief = {
  as_of: string
  client_id: string
  client_name: string
  goal: { title: string; status: string; metric: string; target: number | null; period_start: string; period_end: string } | null
  product_scope: TravelScope
  client_products: OperatingBriefInput['client_products']
  tour_catalog: TourCatalogItem[]
  comparison_candidates: TourComparisonCandidate[]
  matches: ProductMatch[]
  decision: OperatingDecision
  data_gaps: string[]
}

export type OperatingBriefInput = {
  client: { id: string; name: string }
  goal: OperatingBrief['goal']
  product_scope: TravelScope
  client_products: Array<{ name: string; destination?: string; route?: string; duration_days?: number; price?: string; departure_window?: string; includes?: string; positioning?: string; audience?: string }>
  competitor_products: Array<{ domain: string; source_url: string; observed_at: string | null; records: TourRecord[] }>
  evidence: OperatingEvidence[]
  now?: Date
}

export type OperatingGoalCandidate = {
  title: string
  status: string
  primary_metric_label: string
  target_value: number | null
  period_start: string
  period_end: string
}

export function resolveCurrentOperatingGoal(goals: OperatingGoalCandidate[], now: Date): OperatingBrief['goal'] {
  const today = now.toISOString().slice(0, 10)
  const current = goals.find(goal => goal.status === 'active' && goal.period_start <= today && goal.period_end >= today)
  return current ? {
    title: current.title, status: current.status, metric: current.primary_metric_label,
    target: current.target_value, period_start: current.period_start, period_end: current.period_end,
  } : null
}

export function normalizeOperatingProducts(raw: unknown): OperatingBriefInput['client_products'] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const value = item as Record<string, unknown>
    const text = (key: string) => typeof value[key] === 'string' ? value[key].trim() : undefined
    const number = (key: string) => typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] : undefined
    return [{
      name: text('name') ?? '', destination: text('destination'), route: text('route'), duration_days: number('duration_days'),
      price: text('price'), departure_window: text('departure_window'), includes: text('includes'), positioning: text('positioning'), audience: text('audience'),
    }]
  })
}

export function operatingProductFromTour(record: TourRecord): OperatingBriefInput['client_products'][number] {
  return {
    name: record.name,
    route: record.route || undefined,
    duration_days: record.durationDays || undefined,
    price: record.price || undefined,
    departure_window: record.departureWindow || undefined,
    includes: record.includes || undefined,
    positioning: record.positioning || undefined,
    audience: record.audience || undefined,
  }
}

function productLabel(product: TourRecord): string {
  return `${product.name} · ${product.durationDays} 天 · ${product.price}`
}

export function parseTourRecordLine(line: string): TourRecord | null {
  const values = new Map(line.split('|').map(part => {
    const [key, ...rest] = part.split(':')
    return [key.trim().toLowerCase(), rest.join(':').trim()]
  }))
  const name = values.get('tour')
  const duration = Number(values.get('duration')?.match(/\d+/)?.[0])
  if (!name || !Number.isFinite(duration)) return null
  return {
    name,
    durationDays: duration,
    price: values.get('price') ?? 'not stated',
    promotion: values.get('promotion') ?? 'not stated',
    reviews: values.get('reviews') ?? 'not stated',
    includes: values.get('includes') ?? 'not stated',
    route: values.get('route') ?? 'not stated',
    departureWindow: values.get('departure') ?? values.get('departure_window'),
    positioning: values.get('positioning'),
    audience: values.get('audience'),
    itinerary: values.get('itinerary')?.split(' || ').map(value => value.trim()).filter(Boolean),
  }
}

function competitorFacts(input: OperatingBriefInput, now: Date): OperatingSignal[] {
  return input.competitor_products.flatMap(item => item.records.slice(0, 3).map(record => ({
    statement: `${item.domain}：${productLabel(record)}`,
    source_url: item.source_url,
    observed_at: item.observed_at,
    valid_until: item.observed_at ? new Date(Date.parse(item.observed_at) + 8 * 86_400_000).toISOString() : null,
  }))).filter(item => item.observed_at !== null && Number.isFinite(Date.parse(item.observed_at)) && now.getTime() - Date.parse(item.observed_at) >= 0 && now.getTime() - Date.parse(item.observed_at) <= 8 * 86_400_000)
}

function completeClientProduct(product: OperatingBriefInput['client_products'][number]): boolean {
  return [product.destination, product.route, product.duration_days, product.price, product.departure_window, product.includes, product.positioning, product.audience]
    .every(value => typeof value === 'string' ? value.trim().length > 0 : typeof value === 'number' && Number.isFinite(value))
}

function completeCompetitorProduct(record: TourRecord): boolean {
  return [record.route, record.durationDays, record.price, record.departureWindow, record.includes, record.positioning, record.audience]
    .every(value => typeof value === 'string' ? value.trim().length > 0 : typeof value === 'number' && Number.isFinite(value))
}

const comparableText = (value: string | undefined) => (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const tokens = (value: string | undefined) => new Set(comparableText(value).split(' ').filter(token => token.length > 2))
const overlap = (left: string | undefined, right: string | undefined) => {
  const a = tokens(left), b = tokens(right)
  if (!a.size || !b.size) return 0
  return [...a].filter(token => b.has(token)).length / Math.max(a.size, b.size)
}
function tourSimilarity(client: OperatingBriefInput['client_products'][number], competitor: TourRecord): number {
  const route = overlap(client.route, competitor.route)
  const includes = overlap(client.includes, competitor.includes)
  const positioning = overlap(client.positioning, competitor.positioning)
  const audience = overlap(client.audience, competitor.audience)
  const duration = Math.max(0, 1 - Math.abs((client.duration_days ?? 0) - competitor.durationDays) / Math.max(client.duration_days ?? 1, competitor.durationDays))
  const departure = overlap(client.departure_window, competitor.departureWindow)
  return Math.round((route * 40 + duration * 20 + includes * 15 + positioning * 10 + audience * 10 + departure * 5) * 100)
}

function rankedCandidates(input: OperatingBriefInput, product: OperatingBriefInput['client_products'][number]) {
  const records = input.competitor_products.flatMap(item => item.records.map(record => ({ item, record })))
  return records
    .filter(({ record }) => matchTravelScope(`${record.name} ${record.route}`, '', input.product_scope).status === 'matched')
    .filter(({ record }) => completeCompetitorProduct(record))
    .map(item => ({ ...item, score: tourSimilarity(product, item.record) }))
    .sort((a, b) => b.score - a.score)
}

function matchesFor(input: OperatingBriefInput): ProductMatch[] {
  const competitorRecords = input.competitor_products.flatMap(item => item.records.map(record => ({ item, record })))
  if (!input.client_products.length) {
    return competitorRecords.slice(0, 4).map(({ item, record }) => {
      const scopeMatch = matchTravelScope(`${record.name} ${record.route}`, '', input.product_scope)
      return {
      status: scopeMatch.status === 'outside' ? 'out_of_scope' : 'insufficient_evidence',
      client_product: null,
      competitor_product: `${item.domain}：${productLabel(record)}`,
      reason: scopeMatch.status === 'outside' ? '这条团属于客户这次关注范围之外，所以不拿来做经营比较。' : 'CTS 自己的产品资料还没有准备好，暂时无法判断这条竞品团是否值得比较。',
      }
    })
  }
  return input.client_products.map(product => {
    const scoped = competitorRecords.filter(({ record }) => matchTravelScope(`${record.name} ${record.route}`, '', input.product_scope).status === 'matched')
    const ranked = rankedCandidates(input, product)
    const candidate = ranked[0] ?? scoped[0]
    const comparable = completeClientProduct(product) && Boolean(candidate) && (ranked[0]?.score ?? 0) >= 35
    if (!comparable) return {
      status: 'insufficient_evidence' as const,
      client_product: product.name,
      client_duration_days: product.duration_days,
      client_price: product.price,
      competitor_product: candidate ? `${candidate.item.domain}：${productLabel(candidate.record)}` : null,
      competitor_domain: candidate?.item.domain,
      competitor_duration_days: candidate?.record.durationDays,
      competitor_price: candidate?.record.price,
      match_score: candidate && 'score' in candidate ? candidate.score : undefined,
      reason: !completeClientProduct(product) ? '客户产品缺少必要资料，AI 还不能可靠说明它和竞品各自的优劣势。' : !candidate ? '暂时没找到路线和产品内容足够接近的竞品团。' : !completeCompetitorProduct(candidate.record) ? '这条竞品团的资料还不完整，暂时无法公平比较。' : '虽然目的地范围相近，但路线、天数或产品内容差异较大，先不把它当作主要对手。',
    }
    return {
      status: 'comparable' as const,
      client_product: product.name,
      client_duration_days: product.duration_days,
      client_price: product.price,
      competitor_product: `${candidate.item.domain}：${productLabel(candidate.record)}`,
      competitor_domain: candidate.item.domain,
      competitor_duration_days: candidate.record.durationDays,
      competitor_price: candidate.record.price,
      match_score: candidate.score,
      reason: '这是按目的地范围和产品形状找到的最接近竞品候选，不代表两团相同；价格、城市、天数、日期、包含项目和定位差异交由 AI 解释优劣势。',
    }
  })
}

function comparisonCandidates(input: OperatingBriefInput): TourComparisonCandidate[] {
  return input.client_products.flatMap(product => {
    const candidate = rankedCandidates(input, product)[0]
    return candidate && completeClientProduct(product) && candidate.score >= 35 ? [{
      client_product: product,
      competitor_product: { name: candidate.record.name, source_url: candidate.item.source_url, observed_at: candidate.item.observed_at, record: candidate.record },
      match_score: candidate.score,
    }] : []
  })
}

export function buildOperatingBrief(input: OperatingBriefInput): OperatingBrief {
  const now = input.now ?? new Date()
  const matches = matchesFor(input)
  const competitorSignal = competitorFacts(input, now)
  const allInsufficient = matches.length === 0 || matches.every(match => match.status === 'insufficient_evidence')
  const incompleteClientProducts = input.client_products.filter(product => !completeClientProduct(product)).length
  const evidence = input.evidence.filter(item => item.scope === 'client' || item.scope === 'competitor')
  const unknowns = [
    ...(input.client_products.length ? [] : ['我们还没有 CTS 自己每条团的完整资料（路线、天数、价格、出发日期和余位）。']),
    ...(incompleteClientProducts && input.client_products.length ? [`有 ${incompleteClientProducts} 个 CTS 产品仍缺少路线、价格、日期或包含项目等对比字段。`] : []),
    ...(input.goal ? [] : ['目前没有明确的经营目标，所以暂时不能判断哪项变化最重要。']),
    ...(competitorSignal.length ? [] : ['竞品最近没有可用的新资料，旧资料不能代表现在。']),
    '目前没有 CTS 和竞品之间的询盘、成交或转化数据，所以还不能判断哪一条团真正卖得更好。',
  ]
  const recommendation = allInsufficient
    ? !input.client_products.length
      ? '先暂不调价或改促销。我们还缺 CTS 自己这条团的完整资料，补齐后再和竞品比较。'
      : incompleteClientProducts
        ? '先暂不调价或改促销。CTS 产品已进入分析，但仍有部分产品缺少公平比较所需字段；先补齐重点产品，再和竞品比较。'
        : '先暂不调价或改促销。CTS 产品资料已经进入分析，但当前没有找到路线、天数和产品内容都足够接近的竞品对位；先核对重点样本，再决定是否调整。'
    : '我们找到了一条比较接近的竞品团。先人工核对城市、天数、价格和包含内容，再决定要不要调整。'
  const context = input.goal
    ? [`当前目标：${input.goal.title}（${input.goal.status}）`, `目标指标：${input.goal.metric}${input.goal.target == null ? '' : `，目标 ${input.goal.target}`}`, `目标周期：${input.goal.period_start} 至 ${input.goal.period_end}`]
    : ['当前没有可确认的有效经营目标。']
  if (input.product_scope.labels.length) context.push(`客户产品范围：${input.product_scope.labels.join('、')}（来源：${input.product_scope.source}）`)
  return {
    as_of: now.toISOString(), client_id: input.client.id, client_name: input.client.name,
    goal: input.goal, product_scope: input.product_scope, client_products: input.client_products,
    comparison_candidates: comparisonCandidates(input),
    tour_catalog: input.competitor_products.flatMap(item => item.records.map(record => ({
      domain: item.domain, source_url: item.source_url, observed_at: item.observed_at, record,
    }))),
    matches,
    decision: {
      question: '当前是否需要跟进主要竞品的中国团价格或促销？',
      context, external_signal: competitorSignal,
      impact: allInsufficient ? '现在只能确认竞品在卖什么，还不能说明 CTS 受到了影响。' : '现在有一条比较接近的竞品团，但还不能只凭网页资料判断谁更有优势。',
      recommendation, authorization: 'review_required', evidence,
      unknowns, check_and_tune: `${input.client_products.length && !incompleteClientProducts ? '下一步先核对重点 CTS 产品与竞品样本的城市、天数、价格和包含项目。' : '下一步先补齐重点 CTS 产品资料。'} 之后每次更新竞品页面时，再结合询盘和成交情况决定是否调整。`,
    },
    data_gaps: unknowns,
  }
}
