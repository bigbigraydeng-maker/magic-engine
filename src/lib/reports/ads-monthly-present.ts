import type { MonthlyAdsSection } from './monthly-ads-section'

export function formatAdsMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return '—'
  const sym = currency === 'NZD' ? 'NZ$' : currency === 'AUD' ? 'A$' : currency ? `${currency} ` : ''
  return `${sym}${amount.toFixed(2)}`
}

export function vsTargetText(
  vs: MonthlyAdsSection['vsTarget'],
  target: number | null,
  currency: string | null,
): string {
  if (vs === 'no_target' || target == null) return '未设置目标成本'
  if (vs === 'not_comparable') return '进线成本算不出，无法对比目标'
  const t = formatAdsMoney(target, currency).replace('—', String(target))
  if (vs === 'at_or_below') return `达目标（≤ ${t}）`
  if (vs === 'above') return `高于目标（> ${t}）`
  return '—'
}

export function entityRowsHtml(rows: MonthlyAdsSection['topAdSets'], empty: string): string {
  if (rows.length === 0) return `<p style="font-size:12px;color:rgba(26,26,26,0.55);">${escapeHtml(empty)}</p>`
  return `<table style="width:100%;font-size:12px;margin-top:8px;"><tr><th>名称</th><th>花费</th><th>结果</th><th>单次成本</th></tr>${rows
    .map(
      r => `<tr><td>${escapeHtml(r.name)}</td><td>${r.spend.toFixed(2)}</td><td>${r.results}</td><td>${r.costPerResult?.toFixed(2) ?? '—'}</td></tr>`,
    )
    .join('')}</table>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
