import { PLAY_CATALOG } from '../play-vocabulary'
import { PLAY_KEYS } from './ad-plays'

/**
 * 给 LLM 的「广告打法」提示段。**只从 PLAY_CATALOG 生成** —— 打法 key 与
 * 人话名字都不手写，加一个打法时这里自动跟上，不会出现提示词和词表对不上的情况。
 */
export function adPlaysPromptSection(): string {
  const lines: string[] = []
  lines.push('### 广告打法 ad_plays（可选，只给结构）')
  lines.push('可选的打法清单（play 只能取下面的 key）：')
  for (const [key, def] of Object.entries(PLAY_CATALOG)) {
    lines.push(`- \`${key}\` — ${def.label}：${def.what}（成效看：${def.successSignal}）`)
  }
  lines.push('规则：')
  lines.push('- 仅当该阶段确有广告投放动作（dimension=ads 且要花钱投）才填 ad_plays；其它阶段不要这个字段（不是空数组，是整个字段不出现）。')
  lines.push('- 每条写成 {"step_key": "kebab-case 唯一", "play": "<上面清单里的一个 key>"}，step_key 在整份处方内唯一（建议带阶段号，如 phase1-lead-form），最多 8 条。')
  lines.push('- 顺序 = 优先级（先做的放前面）。')
  lines.push('- ad_plays 只写打法类型与顺序（step_key + play）；不要写账户、预算、人数、花费、日期，一个都不要写——这些由系统用真实数据计算。')
  lines.push('- 拿不准要不要投广告 → 不填。')
  return lines.join('\n')
}

/** 给 LLM 的 ad_plays 字段示例（play 的取值从 PLAY_KEYS 拼出来，不手写）。 */
export function adPlaysSchemaExample(): string {
  return `"ad_plays": [{ "step_key": "phase1-xxx", "play": "${PLAY_KEYS.join('|')}" }]`
}
