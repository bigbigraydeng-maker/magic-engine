export const DEFAULT_PILLAR = 'ads'

/** keys = the repo's existing 6 pillar keys (DiagnosticDimension: seo / ai_visibility / ads / social / reputation / competitor) */
export const PILLAR_NAMES: Record<string, string> = {
  ads: '广告 Agent',
  seo: 'SEO Agent',
  social: '社媒 Agent',
  reputation: '口碑 Agent',
  ai_visibility: 'AI 可见度 Agent',
  competitor: '竞品 Agent',
}

export function pillarLabel(pillar: string): string {
  if (Object.prototype.hasOwnProperty.call(PILLAR_NAMES, pillar)) return PILLAR_NAMES[pillar]
  return pillar
}
