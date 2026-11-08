// 广告统一考卷的题目登记表。
// 每道题指向一条或一组已有测试（file + match = 测试全名里的一段原文）。
// expect: 'pass' 正常题；'known_fail' 已知待修（对应测试用 it.fails 写，现在代码答错才算通过）；
// 'todo' 只登记还没出题（it.todo）。
// 题目答案只收 PM 或事故复盘确认过的；改登记表时同步改对应测试名，
// questions.test.ts 会核对每个 match 真的出现在文件里。

export type ExamExpect = 'pass' | 'known_fail' | 'todo'

export interface ExamQuestion {
  /** 题号，Q01 起，唯一。 */
  readonly id: string
  /** 一句人话：考什么、正确答案是什么。 */
  readonly title: string
  /** 答案出自哪里：PR / 台账卡 / 提交号。 */
  readonly source: string
  /** 测试文件，相对仓库根目录。 */
  readonly file: string
  /** 测试全名（describe + it 标题）里的一段原文；命中的所有测试一起判这道题。 */
  readonly match: string
  readonly expect: ExamExpect
}

const REPLAY = 'src/lib/ads-strategy/portfolio/diagnostics/__tests__/replay.test.ts'
const D3 = 'src/lib/ads-strategy/portfolio/diagnostics/__tests__/d3-scope.test.ts'
const RULES = 'src/lib/ads-strategy/rules/__tests__/rules.test.ts'
const O1 = 'src/lib/ads-strategy/portfolio/opportunities/__tests__/o1-hot-creative.test.ts'
const EXEC = 'src/lib/flywheel/attribution/__tests__/execution-evidence.test.ts'
const GATEWAY = 'src/lib/kernel/__tests__/gateway.test.ts'
const SRC_REPLAY = '广告诊断回放（PR 1664，样本 11-03 已脱敏）'
const SRC_STEP0 = '台账 2026-11-03-agent-loop-step0-exam-baseline（PR 3529）'

export const ADS_EXAM_QUESTIONS: readonly ExamQuestion[] = [
  {
    id: 'Q01',
    title: '再营销名单没建好时，攒池视频花了钱 → 报 D4',
    source: SRC_REPLAY,
    file: REPLAY,
    match: 'D4 命中：2026-09-13 NZ 21:00',
    expect: 'pass',
  },
  {
    id: 'Q02',
    title: '名单建好不满 72 小时 → D4 判不了，不再报',
    source: SRC_REPLAY,
    file: REPLAY,
    match: 'D4 名单建好后',
    expect: 'pass',
  },
  {
    id: 'Q03',
    title: '主结果归不到广告时 → D5 判不了，并点名那个系列',
    source: SRC_REPLAY,
    file: REPLAY,
    match: 'D5：9 月新 3PL 系列',
    expect: 'pass',
  },
  {
    id: 'Q04',
    title: '主结果换成留资但留资归不上 → D5 仍判不了',
    source: SRC_REPLAY,
    file: REPLAY,
    match: 'D5 主结果换成留资',
    expect: 'pass',
  },
  {
    id: 'Q05',
    title: '样本太少 → D5 只点名不出命中',
    source: SRC_REPLAY,
    file: REPLAY,
    match: 'D5 样本量闸',
    expect: 'pass',
  },
  {
    id: 'Q06',
    title: 'D5 只比独立预算单位，不拿系列预算里的组比',
    source: SRC_REPLAY,
    file: REPLAY,
    match: 'D5 只比独立预算单位',
    expect: 'pass',
  },
  {
    id: 'Q07',
    title: '没配目标单次成本 → D3 判不了，不拿行业默认凑',
    source: SRC_REPLAY,
    file: REPLAY,
    match: 'D3：没配目标单次成本',
    expect: 'pass',
  },
  {
    id: 'Q08',
    title: '配了目标、成本超 2 倍 → D3 命中；主力组不误伤',
    source: SRC_REPLAY,
    file: REPLAY,
    match: 'D3：配了目标（留资 NZ$29.25）',
    expect: 'pass',
  },
  {
    id: 'Q09',
    title: '有开聊但主结果归不上 → 报 D8',
    source: SRC_REPLAY,
    file: REPLAY,
    match: 'D8：领先结果（私信开聊）有',
    expect: 'pass',
  },
  {
    id: 'Q10',
    title: '连续 10 小时零投放且预算没花完 → 报 D1',
    source: SRC_REPLAY,
    file: REPLAY,
    match: 'D1 命中：2026-09-13 14:00 起连续 10 小时零投放',
    expect: 'pass',
  },
  {
    id: 'Q11',
    title: '同一天除 D1、D9 外不多报别的',
    source: SRC_REPLAY,
    file: REPLAY,
    match: '2026-09-13 除 D1、D9 外没有别的命中',
    expect: 'pass',
  },
  {
    id: 'Q12',
    title: '视频刚开投、全天在投 → 除真实漏洞外不报',
    source: SRC_REPLAY,
    file: REPLAY,
    match: '反例：2026-09-08、09-09',
    expect: 'pass',
  },
  {
    id: 'Q13',
    title: '在做 A/B 实验的广告组 → 排除出所有诊断',
    source: SRC_REPLAY,
    file: REPLAY,
    match: 'A/B 实验（',
    expect: 'pass',
  },
  {
    id: 'Q14',
    title: '表单组稳定在投 → 零诊断（反例）',
    source: SRC_REPLAY,
    file: REPLAY,
    match: '2026-08-04 ~ 08-13（单个表单留资组稳定在投',
    expect: 'pass',
  },
  {
    id: 'Q15',
    title: '演练、被拦、失败、等批准的暂停提议 → 不算「已执行」（已知待修）',
    source: SRC_STEP0,
    file: EXEC,
    match: '【已知待修·第1步】payload.status=',
    expect: 'known_fail',
  },
  {
    id: 'Q16',
    title: '真执行的暂停（有内核运行编号）→ 算可评估',
    source: SRC_STEP0,
    file: EXEC,
    match: '真执行的暂停（行上有内核运行编号）算可评估',
    expect: 'pass',
  },
  {
    id: 'Q17',
    title: '72 小时内刚改过设置的广告组 → 不出加预算建议（已知待修）',
    source: SRC_STEP0,
    file: O1,
    match: '【已知待修·第1步】72 小时内设置变过的广告组',
    expect: 'known_fail',
  },
  {
    id: 'Q18',
    title: '设置改动已是 6 天前 → 加预算建议照常出',
    source: SRC_STEP0,
    file: O1,
    match: '设置变化已经是 6 天前',
    expect: 'pass',
  },
  {
    id: 'Q19',
    title: '刚改过设置也不压住止损：花钱零结果照样报、可进暂停建议',
    source: SRC_STEP0,
    file: D3,
    match: '【考卷3】',
    expect: 'pass',
  },
  {
    id: 'Q20',
    title: '「确认无效」的结论 14 天后作废（还没出题）',
    source: SRC_STEP0,
    file: REPLAY,
    match: '【考卷4】',
    expect: 'todo',
  },
  {
    id: 'Q21',
    title: '没设置结果口径 → 不出「花钱没结果」',
    source: SRC_STEP0,
    file: D3,
    match: '没配目标 → 判不了（不回落默认）',
    expect: 'pass',
  },
  {
    id: 'Q22',
    title: '读回没对上或重试到上限 → 进「要人处理」和今日待办',
    source: SRC_STEP0,
    file: GATEWAY,
    match: 'Gateway：重试 / 死信 / 断点续跑',
    expect: 'pass',
  },
  {
    id: 'Q23',
    title: 'WhatsApp 开聊组按自己的开聊数判，不按客户主结果（留资）当没结果',
    source: '台账 2026-11-03-ads-d3-judges-whatsapp-adsets-by-leads（PR 3535）',
    file: D3,
    match: '【考卷7】',
    expect: 'pass',
  },
  {
    id: 'Q24',
    title: '视频组、开聊组的结果种类跟着广告组目的地走，不按留资数',
    source: '11-03 回放 5 条止损全误判（提交 6b31bc9be）',
    file: RULES,
    match: '【考卷8】',
    expect: 'pass',
  },
  {
    id: 'Q25',
    title: '已暂停或样本太小的组 → 不亮「花钱没结果」红灯',
    source: '台账 2026-11-04-fix-ads-health-stale-red-lights（提交 e14734337）',
    file: D3,
    match: '【考卷9】',
    expect: 'pass',
  },
]
