import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveRuleText, splitTableRow } from '@/lib/agent-learning/rules/resolve-rule-text'

const SEP7 = '|---|---|---|---|---|---|---|'
const SEP3 = '|---|---|---|'

const HEADER_ADS_C = '| 编号 | 条件 → 动作 | 层 | 谁 | 证据来源 | 样本门槛 | 代码 |'
const HEADER_ADS_RL = '| 编号 | 红线 | 条件 → 动作 | 谁 | 证据来源 | 样本 | 代码 |'
const HEADER_ADS_E = '| 编号 | 条件（全部满足才成立） | 动作 | 谁 | 证据来源 | 样本门槛 | 代码 |'
const HEADER_SOCIAL = '| 规则 | 条件 → 动作 | 执行者 / 证据 / 状态 |'

const ROW_C13 = `| **C-13** | **留资表单设计**：每多问一道题，填表率掉一大截。**复刻已验证表单（同字段、同顺序、同问题 key），只换表单名和开头介绍**；不问预算 / 出发时间 / 签证 / 人数 / 年龄 / 地址，让销售打电话时问；介绍卡只写常年不变的（已发布的表单改不了）。**要不要拿「预算」换精准度，必须跟到成交端才算得清，不得只看留资成本做决定** | 通用（机理）/ 客户（题目） | 在投广告换表单：**PM 本人**（PM 10-10 说的「换素材自己换」指视频 / 图片素材；换表单会改问的问题、影响线索量，PM 没提，仍按原样）；新建 PAUSED 新广告才可档2 | 通用手册 §二十；上海团计划 §5 | 点击→填完：老表单 15.1%（410 点击 → 62 留资）vs 新表单 3.0%（105 点击 → 3 留资）；CTS 一个广告组、同时间同受众（样本 2 个版本） | **尚无代码**（52 号 M5） |`

const ROW_RL01 = `| **RL-01** | **开投必须 PM 本人授权** | 任何「把暂停变开启」（含首次激活、暂停后重开、冲刺层加广告后开启、PM 自己在后台点开）→ 系统只建 \`PAUSED\` + 读回；PM 在对话里点名要开哪几层，才开；**自下而上**（先广告、再广告组、最后系列）；开后读回三层，点名的开了、没点名的仍暂停 | 档3 | 上海团计划 §8.5；52 号 §3.5 | — | **部分**：\`draft-and-gate.ts\` 的 \`approveDraft\` 只认 PM、先写回执；**已有的闸**：\`meta-ads/execute\` 重开已调 \`requireSpendActivationAuthority()\`（只认全局管理员，回执写不进就不调 Meta，读 \`route.ts\` 已核）；**剩余缺口**：PM「在对话里点名开哪几层」没有对应的机器事件（见 §2.2b），暂由 §8.5 协议顶着 |`

const ROW_E13 = `| **E-13 放量** | ①三窗口（30 / 14 / 7 天）**每个**每结果成本 ≤ 客户目标（客户层配置）；②最近窗口留资 ≥ 25 条（CTS 做法）或 ≥ 20 条（通用手册）——**以较严为准，待 PM 拍板**（§10 第 5 问）；③不在冻结期（C-06）、72 小时内没动过；④\`account_status = 1\` 且近期无付款失败（频繁扣款 + 近期刚失败加预算会更快撞扣款阈值，再断一次投放）；⑤预算口径下余量 ≥ 0（B-02 / B-03，口径待 PM 定）；⑥单次 ≤ +20%（Kernel 信封）；⑦加预算与改结构不在同一步 | 出「建议加预算」卡，**PM 本人点名批**；批后走受控通道，改完读回 | **档3** | 通用手册 §三十二、§三十三；CTS 预算计划 §4；\`autonomy-envelope.ts\` | 样本门槛见 E-04 | **判据缺一半**：成本三窗口比较、冻结、状态 / 付款检查**尚无代码**；执行侧 \`ads.scale_unit_budget\` 现在会自动批（§2.3，必须改） |`

const ROW_SO01 = `| **SO-01 来源先于结论** | 外部技巧进入学习卡前，记录作者、原始链接、发布日期、实际读取范围与来源类型；未读部分不得写成已读。 | 学习 Agent；原页面/转写；已存在于 \`me-expert-source-to-skill\`。 |`

const ROW_WITH_CARD = '| **C-13** | 乙组正文 card-x.md | 层 | 谁 | 源 | 样本 | 代码 |'
const ROW_NO_CARD = '| **C-13** | 甲组正文 | 层 | 谁 | 源 | 样本 | 代码 |'

const ADS_BOOK = 'docs/sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md'
const SOCIAL_BOOK = 'docs/sops/2026-10-19-social-agent-playbook-and-rules-v1.0.md'

const STRUCTURAL_FAILURES = [
  'rule_unresolved:header_not_found',
  'rule_unresolved:no_body_column',
  'rule_unresolved:row_shape_mismatch',
]

function table(header: string, separator: string, ...rows: string[]): string {
  return [header, separator, ...rows].join('\n')
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function errorOf(result: ReturnType<typeof resolveRuleText>): string {
  return result.ok ? '' : result.error
}

function valueOf(result: ReturnType<typeof resolveRuleText>) {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

describe('splitTableRow', () => {
  it('不拆转义竖线与反引号内的竖线', () => {
    expect(splitTableRow('| a | `x | y` | b \\| c |')).toEqual(['a', '`x | y`', 'b \\| c'])
  })
})

describe('真实行的规则句解析', () => {
  it('C-13：只取条件列，不含层与代码列', () => {
    const v = valueOf(resolveRuleText(table(HEADER_ADS_C, SEP7, ROW_C13), 'C-13', 'card-x'))
    expect(v.text.startsWith('留资表单设计：每多问一道题')).toBe(true)
    expect(v.text).not.toContain('通用（机理）')
    expect(v.text).not.toContain('尚无代码')
    expect(v.title).toBe('')
  })

  it('RL-01：红线列不是正文', () => {
    const v = valueOf(resolveRuleText(table(HEADER_ADS_RL, SEP7, ROW_RL01), 'RL-01', 'card-x'))
    expect(v.text.startsWith('任何「把暂停变开启」')).toBe(true)
    expect(v.text).not.toContain('开投必须 PM 本人授权')
    expect(v.title).toBe('')
  })

  it('E-13：条件列后接动作列', () => {
    const v = valueOf(resolveRuleText(table(HEADER_ADS_E, SEP7, ROW_E13), 'E-13', 'card-x'))
    expect(v.text).toContain('①三窗口')
    expect(v.text).toContain(' → 出「建议加预算」卡')
    expect(v.title).toBe('放量')
  })

  it('SO-01：第 1 列只有编号和短标题', () => {
    const v = valueOf(resolveRuleText(table(HEADER_SOCIAL, SEP3, ROW_SO01), 'SO-01', 'card-x'))
    expect(v.text.startsWith('外部技巧进入学习卡前')).toBe(true)
    expect(v.title).toBe('来源先于结论')
    expect(v.text).not.toContain('学习 Agent')
  })

  it('textSha 是 64 位十六进制且等于 text 的 sha256', () => {
    const file = table(HEADER_SOCIAL, SEP3, ROW_SO01)
    const first = valueOf(resolveRuleText(file, 'SO-01', 'card-x'))
    const second = valueOf(resolveRuleText(file, 'SO-01', 'card-x'))
    expect(first.textSha).toMatch(/^[0-9a-f]{64}$/)
    expect(first.textSha).toBe(sha256(first.text))
    expect(second.textSha).toBe(first.textSha)
  })
})

describe('失败组', () => {
  it('手册里没有这个编号', () => {
    const file = table(HEADER_ADS_C, SEP7, ROW_C13)
    expect(errorOf(resolveRuleText(file, 'C-99', 'card-x'))).toBe('rule_unresolved:row_not_found')
  })

  it('同一编号多行且都没写本卡文件名', () => {
    const file = table(HEADER_ADS_C, SEP7, ROW_NO_CARD, ROW_WITH_CARD.replace(' card-x.md', ''))
    expect(errorOf(resolveRuleText(file, 'C-13', 'card-y'))).toBe('rule_unresolved:row_ambiguous')
  })

  it('同一编号多行、只有一行写了本卡文件名时取那一行', () => {
    const file = table(HEADER_ADS_C, SEP7, ROW_NO_CARD, ROW_WITH_CARD)
    const v = valueOf(resolveRuleText(file, 'C-13', 'card-x'))
    expect(v.text).toBe('乙组正文 card-x.md')
  })

  it('表头没有条件/判据列', () => {
    const file = table('| 编号 | 红线 | 谁 |', SEP3, '| **C-13** | 红线甲 | 谁 |')
    expect(errorOf(resolveRuleText(file, 'C-13', 'card-x'))).toBe('rule_unresolved:no_body_column')
  })

  it('单元格数与表头不符', () => {
    const file = table(HEADER_ADS_C, SEP7, '| **C-13** | 只有两格 |')
    expect(errorOf(resolveRuleText(file, 'C-13', 'card-x'))).toBe('rule_unresolved:row_shape_mismatch')
  })

  it('正文列为空', () => {
    const file = table(HEADER_ADS_C, SEP7, '| **C-13** |  | 层 | 谁 | 源 | 样本 | 代码 |')
    expect(errorOf(resolveRuleText(file, 'C-13', 'card-x'))).toBe('rule_unresolved:body_empty')
  })

  it('正文只剩短标题', () => {
    const file = table(HEADER_SOCIAL, SEP3, '| **SO-01 来源先于结论** | 来源先于结论 | 学习 Agent |')
    expect(errorOf(resolveRuleText(file, 'SO-01', 'card-x'))).toBe('rule_unresolved:body_empty')
  })

  it('正文是纯规则编号', () => {
    const file = table(HEADER_ADS_C, SEP7, '| **C-13** | C-13 | 层 | 谁 | 源 | 样本 | 代码 |')
    expect(errorOf(resolveRuleText(file, 'C-13', 'card-x'))).toBe('rule_unresolved:body_empty')
  })

  it('正文超 600 字符不截断', () => {
    const file = table(HEADER_ADS_C, SEP7, `| **C-13** | ${'x'.repeat(601)} | 层 | 谁 | 源 | 样本 | 代码 |`)
    expect(errorOf(resolveRuleText(file, 'C-13', 'card-x'))).toBe('rule_unresolved:too_long')
  })

  it('命中行上方没有分隔行', () => {
    const file = [HEADER_ADS_C, ROW_C13].join('\n')
    expect(errorOf(resolveRuleText(file, 'C-13', 'card-x'))).toBe('rule_unresolved:header_not_found')
  })

  it('表头取自命中行所在的那张表，不受前面别的表影响', () => {
    const file = [
      table('| 编号 | 红线 | 谁 |', SEP3, '| **C-99** | 红线甲 | 谁 |'),
      '',
      table(HEADER_ADS_C, SEP7, ROW_C13),
    ].join('\n')
    const v = valueOf(resolveRuleText(file, 'C-13', 'card-x'))
    expect(v.text.startsWith('留资表单设计：每多问一道题')).toBe(true)
  })
})

describe('真实手册结构断言', () => {
  it('C-13 与 SO-01 能解析出规则句', () => {
    const ads = readFileSync(join(process.cwd(), ADS_BOOK), 'utf8')
    const social = readFileSync(join(process.cwd(), SOCIAL_BOOK), 'utf8')
    expect(errorOf(resolveRuleText(ads, 'C-13', 'none'))).toBe('')
    expect(errorOf(resolveRuleText(social, 'SO-01', 'none'))).toBe('')
  })

  it('ads 的 RL-01 / RL-05 不出现表头类失败', () => {
    const ads = readFileSync(join(process.cwd(), ADS_BOOK), 'utf8')
    for (const ruleId of ['RL-01', 'RL-05']) {
      const result = resolveRuleText(ads, ruleId, 'none')
      if (!result.ok) expect(STRUCTURAL_FAILURES).not.toContain(result.error)
    }
  })
})
