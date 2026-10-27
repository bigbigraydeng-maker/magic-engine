/**
 * 广告 Agent 机器验证 —— 上线签字清单。
 *
 * 人读版：docs/specs/2026-10-19-ads-agent-test-checklist.md（T 编号一致性由测试核对）。
 * 这里是**结构化的权威定义**：判据文字改了 = 清单指纹变 = 已有回执/复核/签字自动作废，
 * 且判据变更本身须 A 级评审（设计稿第 5 节）。
 *
 * 2026-10-19 统筹 18 号定稿（实查后修正）：
 *  · 内核对 NAL/CTS 全部 ads.* 动作是 auto_approve —— 经信封提交即直接执行；演练开关只管 D3 一条路径；
 *    人按止损走另一套人工止损信封，不受 72 小时冷却约束（冷却只约束 AI 信封）。
 *  · T5 拆成 T5a（本轮，人工止损路径：内核自身回执）和 T5b（AI 路径：飞轮回执，本轮没有 AI 提交路径 → 已知例外）。
 *  · T6 冷却期只能对 AI 信封做“只读评估”；生产记录验证（T6b）本轮不测 → 已知例外。
 *  · T7 钱闸为只读评估；评估所用事实是手工按生产真数字拼的，解析器在真实数据上能否算出：未验证（写在判据里）。
 *  · 已知例外不阻止签字，但必须在页面明确显示并写进签字快照 —— PM 签字 = 知情带例外签字。
 */

import type { Checklist } from '../types'

export const ADS_AGENT_FEATURE_KEY = 'ads-agent-machine-verify'

export const ADS_AGENT_CHECKLIST: Checklist = {
  featureKey: ADS_AGENT_FEATURE_KEY,
  title: '广告 Agent 机器验证',
  riskLevel: 'A',
  docPath: 'docs/specs/2026-10-19-ads-agent-test-checklist.md',
  scopeNote:
    '通过只证明“人点一下，机器把整条链走完、留下完整回执，防护闸拦得住”；不等于可以关演练开关（autopilot_dry_run），也不等于 Agent 可以自己投广告或加预算。',
  // 第一刀目标：NAL（119 已核实，见清单文档第 7 节）；本轮 10/19 起算，更早的历史记录不算证据
  evidencePolicy: {
    targetClientId: '4ae76381-cd45-43bd-85cd-98cfd7604007',
    roundStartedAt: '2026-10-19T00:00:00Z',
  },
  items: [
    {
      key: 'T1',
      title: '看：体检天天在跑',
      goal: '证明广告健康体检每天都在产出结论',
      passCriteria: '目标客户当天 ad_health_narratives 有一行',
      how: '只读查库',
      owner: '119',
      machineVerifiable: true,
      haltOnFail: false,
    },
    {
      key: 'T2',
      title: '判：「花钱没结果」能判出来',
      goal: '证明目标成本已填的客户，体检能给出真判断',
      passCriteria: '该行里该判断为 hit 或 healthy，不是 not_comparable',
      how: '等 10/20 早 6 点那轮体检；NAL 目标成本已填 3 纽币',
      owner: '119 读，18 复核',
      machineVerifiable: false,
      haltOnFail: false,
      evidenceTables: ['ad_health_narratives'],
    },
    {
      key: 'T3',
      title: '开：第一条真实执行',
      goal: '证明 PM 点一下，机器能真的执行一条动作（只动一条已经停着的系列）',
      passCriteria:
        'action_runs 出现 1 条 ads.* 动作，status 为 succeeded 且 triggered_by 为 human；若 apply 步骤 applied:false，证据自动标「空操作成功：写入 Meta 那一步未被检验」',
      how: 'PM 在广告健康页点一次「止损」→ 选「暂停」；目标选一条已经停着的系列，不得使用 CTS 10/22 的两个系列',
      owner: 'PM 点一下；119 选目标并告诉 PM 点哪里',
      machineVerifiable: true,
      haltOnFail: true,
    },
    {
      key: 'T4',
      title: '验：执行后回读确认',
      goal: '证明执行后系统自己回读确认了结果',
      passCriteria:
        '同一 run 的 snapshot_pre / apply / readback 三步都 succeeded，readback 的 verification（ads_readback_integrity）passed 为 true；同样自动标空操作等级',
      how: '看 T3 那条记录',
      owner: '119 读，18 复核',
      machineVerifiable: true,
      haltOnFail: false,
      sameRunAs: 'T3',
    },
    {
      key: 'T5a',
      title: '回（人工止损路径）：内核自身回执齐全',
      goal: '证明人工止损这条路径，内核自己的回执是完整的',
      passCriteria:
        '同一 run 的 action_runs + 三步 action_run_steps + authorization_decisions（verdict=allow）由服务端回读核对',
      how: '看 T3 那条记录',
      owner: '119 读，18 复核',
      machineVerifiable: true,
      haltOnFail: false,
      sameRunAs: 'T3',
      grade: '内核回执',
    },
    {
      key: 'T5b',
      title: '回（AI 路径）：飞轮回执',
      goal: '证明 AI 信封执行后结果写回飞轮',
      passCriteria: 'flywheel_actions 有该次动作的回执行',
      how: '本轮没有 AI 提交路径；止损按钮路径设计上不写飞轮（见台账卡 2026-10-19-stop-loss-route-writes-no-flywheel-row）',
      owner: '另案',
      machineVerifiable: false,
      haltOnFail: false,
      exception: { label: '没测', reason: '本轮没有 AI 提交路径；止损按钮路径设计上不写飞轮行' },
    },
    {
      key: 'T6',
      title: '冷却期闸：72 小时内同一对象不能再动（AI 信封）',
      goal: '证明冷却期闸会拒绝 AI 信封',
      passCriteria:
        '对 AI 信封（triggered_by=agent）用真代码+真生产数据做只读评估：同一对象刚有内核执行记录后被拒，且拒绝原文含「距上次设置变动只过了 N 小时，不足 72 小时」。人工止损路径设计上不受 72 小时约束，不得用人工路径再提交来验证',
      how: '只读评估，证据 = 评估结论原文 + 所在 PR 编号（119 的 PR 2892：hoursSinceLastChange=0.0239，agent 判拒、human 判放行）',
      owner: '119',
      machineVerifiable: false,
      haltOnFail: false,
      manualEvidence: 'readonly_eval',
      grade: '只读评估',
    },
    {
      key: 'T6b',
      title: '冷却期闸：生产记录验证',
      goal: '证明冷却期闸在生产上真的拒绝过一次 AI 信封',
      passCriteria: '生产库里有被冷却期拒绝的 AI 信封记录',
      how: '需要 AI 路径真提交，本轮没有',
      owner: '另案',
      machineVerifiable: false,
      haltOnFail: false,
      exception: { label: '没测', reason: '需要 AI 路径真提交一次才有生产记录；本轮没有 AI 提交路径' },
    },
    {
      key: 'T7',
      title: '钱闸：超过客户总闸必须被拒',
      goal: '证明超过客户总预算闸的加预算请求会被拒绝',
      passCriteria:
        '只读评估：会被拒，且拒绝原文指向账户上限/客户总闸。注明：评估所用事实是按生产真数字手工拼的，解析器在真实数据上能否算出：未验证',
      how: '只读评估，不得真执行，批准环节不点批准；证据 = 评估结论原文 + 所在 PR 编号',
      owner: '119',
      machineVerifiable: false,
      haltOnFail: false,
      manualEvidence: 'readonly_eval',
      grade: '只读评估（事实手工拼，解析器在真实数据上未验证）',
    },
  ],
}

/** 登记表：feature_key → 清单。以后推广到别的功能只往这里加。 */
export const CHECKLISTS: Readonly<Record<string, Checklist>> = {
  [ADS_AGENT_FEATURE_KEY]: ADS_AGENT_CHECKLIST,
}
