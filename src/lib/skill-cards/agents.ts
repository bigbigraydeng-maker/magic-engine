export const DEFAULT_AGENT = 'ads'

export const AGENT_NAMES: Record<string, string> = {
  ads: '广告 Agent',
  seo: 'SEO Agent',
  social: '社媒 Agent',
  reputation: '口碑 Agent',
  geo: 'AI 可见度 Agent',
  competitor: '竞品 Agent',
}

export function agentLabel(agent: string): string {
  if (Object.prototype.hasOwnProperty.call(AGENT_NAMES, agent)) return AGENT_NAMES[agent]
  return agent
}
