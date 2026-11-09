/**
 * 通话分析里的「事实」读出来给界面用：key / value / 原话，外加这句原话是谁说的。
 * 说话人不认识就不带（界面写「原话」，不乱猜成客人说的）。
 */

export interface CallAnalysisFactView {
  key: string
  value: string
  quote: string
  speaker?: 'customer' | 'employee'
}

export function asFacts(v: unknown): CallAnalysisFactView[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((f) => {
    const o = (f ?? {}) as Record<string, unknown>
    return typeof o.key === 'string' && typeof o.value === 'string' && typeof o.quote === 'string'
      ? [
          {
            key: o.key,
            value: o.value,
            quote: o.quote,
            // 这句原话是谁说的：界面据此写「客人原话 / 员工原话」，不能一律印成客人。
            ...(o.speaker === 'customer' || o.speaker === 'employee' ? { speaker: o.speaker } : {}),
          },
        ]
      : []
  })
}
