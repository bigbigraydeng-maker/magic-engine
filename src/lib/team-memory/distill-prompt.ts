/**
 * Team Working Memory — 提炼用的 prompt
 *
 * 单独成文件，因为 prompt 是这套系统里最容易需要反复调的东西，
 * 混在 distill.ts 里会让那个文件每改一次文案就动一次逻辑。
 */

import type { EvidenceVerdict } from './evidence'

export const DISTILL_SYSTEM_PROMPT = `你在给一个「跨窗口工作记忆系统」做提炼。

背景：使用者同时开 30 多个 Claude Code 窗口在 4 个项目上干活。每个窗口的本地记忆
互相看不见，于是同一个坑会在不同窗口里被重复踩。你的任务是从一次会话的操作记录里，
提炼出**下一个窗口应该提前知道的东西**。

你要产出三样：

1. summary —— 交接摘要（中文，3-5 句）。让接手的窗口不用问就知道：这次在干什么、
   干到哪、下一步该干什么、有什么没做完的坑。这是「咒语」的自动版。

2. lessons —— 教训（可以 0 条）。只写**下次能让人少走弯路**的事实性结论。
   - scope 填 "project"：只跟这个项目有关（某个表怎么用、某个客户的规矩）
   - scope 填 "global"：换个项目也成立（沟通方式、通用工程判断）
   - lesson_key 用短横线小写英文，稳定可复现（同一件事在别的会话里也要能生成同样的 key）
   - 不要写「这次做了 X」这种流水账，要写「以后遇到 X 要 Y，因为 Z」
   - 宁可 0 条，也不要凑数。噪音会让整个系统被忽略。

3. skills —— 套路（可以 0 条）。只在这次会话里**完整跑通了一条可复用流程**时才写。
   - procedure 是有序步骤，每步 action 写具体动作，why 写为什么这么做
   - stop_conditions 写什么情况下要停下来问人
   - 一次性的、跟具体客户强绑定的、只跑通一半的，都不要写

严格要求：
- 只依据下面给你的操作记录，**不要脑补**没发生过的事。
- 记录里可能有 [已抹去:xxx] 的占位符，那是密钥被抹掉了，不要试图还原或推测。
- 只输出 JSON，不要任何解释文字、不要 markdown 代码围栏。

JSON 结构：
{
  "summary": "…",
  "goal": "一句话说明这次会话在干什么",
  "lessons": [
    { "lesson_key": "…", "scope": "project|global", "title": "…", "lesson": "…", "rationale": "…" }
  ],
  "skills": [
    { "skill_key": "…", "scope": "project|global", "name": "…", "description": "什么时候该用它",
      "preconditions": ["…"], "procedure": [{ "step": 1, "action": "…", "why": "…" }],
      "success_criteria": ["…"], "stop_conditions": ["…"] }
  ]
}`

interface PromptSession {
  project_key: string
  git_branch: string | null
  goal: string | null
  files_changed: string[]
  commit_shas: string[]
  tests_passed: boolean | null
  tests_failed: boolean | null
  user_corrections: number
}

interface PromptEvent {
  seq: number
  kind: string
  tool_name: string | null
  summary: string
  target: string | null
  ok: boolean | null
}

/** 事件流里最多喂多少条给 AI，控制 token 花费 */
const MAX_EVENTS_IN_PROMPT = 180

export function buildDistillUserPrompt(
  session: PromptSession,
  events: PromptEvent[],
  verdict: EvidenceVerdict,
): string {
  const head = [
    `项目：${session.project_key}`,
    `分支：${session.git_branch ?? '(未知)'}`,
    `原始目标：${session.goal ?? '(未记录)'}`,
    `改动文件：${session.files_changed.slice(0, 40).join(', ') || '(无)'}`,
    `提交：${session.commit_shas.join(', ') || '(无)'}`,
    `测试：${describeTests(session)}`,
    `使用者当场纠正次数：${session.user_corrections}`,
    `已认定的硬证据：${verdict.kinds.join('、') || '无'}`,
  ].join('\n')

  const gate = verdict.primary
    ? '这次会话有硬证据，允许提出新教训。'
    : '⚠️ 这次会话**没有**硬证据（没人纠正、没合入改动、没跑通测试）。' +
      '你仍然可以提出教训，但只有当它跟以前已经存在的教训是同一条时才会被采纳；' +
      '全新的会被丢弃。所以不要为了凑数而编。'

  const stream = sampleEvents(events)
    .map((e) => {
      const flag = e.ok === false ? ' ❌' : ''
      const target = e.target ? ` [${e.target}]` : ''
      return `${e.seq}. (${e.kind}${e.tool_name ? `/${e.tool_name}` : ''})${flag} ${e.summary}${target}`
    })
    .join('\n')

  return `${head}\n\n${gate}\n\n=== 操作记录 ===\n${stream}`
}

function describeTests(s: PromptSession): string {
  if (s.tests_failed) return '跑过，有失败'
  if (s.tests_passed) return '跑过，全通过'
  return '没跑'
}

/**
 * 事件太多时取样：头尾必留（开头是怎么起的、结尾是怎么收的），
 * 中间优先留失败和报错 —— 教训基本都藏在那儿。
 */
function sampleEvents(events: PromptEvent[]): PromptEvent[] {
  if (events.length <= MAX_EVENTS_IN_PROMPT) return events

  const head = events.slice(0, 40)
  const tail = events.slice(-40)
  const middle = events.slice(40, -40)
  const failures = middle.filter((e) => e.ok === false || e.kind === 'error' || e.kind === 'correction')
  const budget = MAX_EVENTS_IN_PROMPT - head.length - tail.length

  const picked = failures.slice(0, budget)
  if (picked.length < budget) {
    const rest = middle.filter((e) => !picked.includes(e)).slice(0, budget - picked.length)
    picked.push(...rest)
  }

  return [...head, ...picked.sort((a, b) => a.seq - b.seq), ...tail]
}
