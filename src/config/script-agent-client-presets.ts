// Client-private creator settings for the transcript rewrite workflow.
// Move these values into Master Brief when a persisted creator profile field is available.
const presets: Record<string, string> = {
  '377468af-b103-45f0-984a-b353febb56a1': '大瑞真人出镜，面向海外华人和想出海的创业者；用中文口语讲澳新落地的 AI 获客、网站、广告、社媒、SEO 与 GEO。先用具体问题或反常识事实开场，再讲清机制和可操作动作。用真实操盘观察，不冒认原作者经历；客户一律匿名，数字未核实就标【待核实】。边走边录的语感，自然、直接，不用「报名」「立即购买」等硬促销。',
}

export function scriptAgentPersonaPreset(clientId: string): string {
  return presets[clientId] ?? ''
}
