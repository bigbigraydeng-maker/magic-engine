export type RuleCardData = {
  adLabel: string
  headline: string
  detail: string
  action: string
}

export type RuleCardsData = {
  title: string
  intro: string
  promise: string
  bodyReplaced: boolean
  cards: RuleCardData[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRuleCard(value: unknown): value is RuleCardData {
  if (!isRecord(value)) return false
  return typeof value.adLabel === 'string'
    && typeof value.headline === 'string'
    && typeof value.detail === 'string'
    && typeof value.action === 'string'
}

export function ruleCardsOf(evidence: unknown): RuleCardsData | null {
  if (!isRecord(evidence)) return null
  const raw = evidence.rule_cards
  if (!isRecord(raw)) return null
  if (typeof raw.title !== 'string') return null
  if (typeof raw.intro !== 'string') return null
  if (typeof raw.promise !== 'string') return null
  if (typeof raw.bodyReplaced !== 'boolean') return null
  if (!Array.isArray(raw.cards) || raw.cards.length < 1) return null
  if (!raw.cards.every(isRuleCard)) return null
  return {
    title: raw.title,
    intro: raw.intro,
    promise: raw.promise,
    bodyReplaced: raw.bodyReplaced,
    cards: raw.cards,
  }
}

function RuleCard({ card }: { card: RuleCardData }) {
  return <div className="min-w-0 space-y-1 rounded-lg border border-slate-200 bg-white p-3">
    <p className="break-all text-xs text-slate-500">广告：{card.adLabel}</p>
    <p className="break-words font-semibold text-slate-900">{card.headline}</p>
    <p className="break-words text-[15px] leading-7 text-slate-800">{card.detail}</p>
    <p className="break-words text-[15px] leading-7 text-slate-700">{card.action}</p>
  </div>
}

export default function RuleCards({ data }: { data: RuleCardsData }) {
  const visible = data.cards.slice(0, 5)
  const rest = data.cards.slice(5)
  return <section aria-label={data.title} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-100/70 p-4" data-testid="rule-cards">
    <h3 className="text-base font-semibold text-slate-950">{data.title}</h3>
    <p className="text-[15px] leading-7 text-slate-800">{data.intro}</p>
    <p className="text-[15px] leading-7 text-slate-700">{data.promise}</p>
    <div className="space-y-3">
      {visible.map((card, index) => <RuleCard key={`${index}-${card.adLabel}`} card={card} />)}
    </div>
    {rest.length > 0 && <details className="min-w-0 space-y-3">
      <summary className="cursor-pointer text-[15px] leading-7 text-slate-700">另外还有 {rest.length} 条花费较少的，点开查看</summary>
      <div className="mt-3 space-y-3">
        {rest.map((card, index) => <RuleCard key={`${index + 5}-${card.adLabel}`} card={card} />)}
      </div>
    </details>}
  </section>
}
