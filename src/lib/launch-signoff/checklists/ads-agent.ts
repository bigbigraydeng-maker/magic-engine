/**
 * 广告 Agent 机器验证 —— 上线签字清单（T1–T7）。
 *
 * 人读版：docs/specs/2026-10-19-ads-agent-test-checklist.md（一致性由测试核对 key）。
 * 这里是**结构化的权威定义**：判据文字改了 = 清单指纹变 = 已有签字自动作废，
 * 且判据变更本身须 A 级评审（设计稿第 5 节）。
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
      passCriteria: 'action_runs 出现 1 条 ads.* 动作，status 为 succeeded，且只动了目标系列',
      how: 'PM 在广告健康页点一次「止损」→ 选「暂停」；目标选一条已经停着的系列，不得使用 CTS 10/22 的两个系列',
      owner: 'PM 点一下；119 选目标并告诉 PM 点哪里',
      machineVerifiable: true,
      haltOnFail: true,
    },
    {
      key: 'T4',
      title: '验：执行后回读确认',
      goal: '证明执行后系统自己回读确认了结果',
      passCriteria: 'action_run_steps 里 readback 步骤 succeeded，且 verification 判过；Meta 端该系列实际为暂停',
      how: '看 T3 那条记录',
      owner: '119 读，18 复核',
      machineVerifiable: true,
      haltOnFail: false,
      sameRunAs: 'T3',
    },
    {
      key: 'T5',
      title: '回：结果写回',
      goal: '证明结果写回了飞轮',
      passCriteria: 'flywheel_actions 有对应 T3 那条动作的回执行，status 非空',
      how: '看 T3 那条记录',
      owner: '119 读，18 复核',
      machineVerifiable: true,
      haltOnFail: false,
      sameRunAs: 'T3',
    },
    {
      key: 'T6',
      title: '冷却期闸：72 小时内同一条不能再动',
      goal: '证明冷却期闸真的会拒绝',
      passCriteria: '被拒绝，拒绝原因文本含冷却期；「已经是暂停状态」等其他原因不算通过',
      how: 'T3 之后，对同一条再提交同样的动作',
      owner: '119',
      machineVerifiable: false,
      haltOnFail: false,
      evidenceTables: ['authorization_decisions'],
    },
    {
      key: 'T7',
      title: '钱闸：超过客户总闸必须被拒',
      goal: '证明超过客户总预算闸的加预算请求会被拒绝',
      passCriteria: '被拒绝，拒绝原因看得见（只测拒绝，不得真执行，批准环节不点批准）',
      how: '故意提交一个会超总闸的加预算请求（走 O1「加预算」那条需人批准的路）',
      owner: '119',
      machineVerifiable: false,
      haltOnFail: false,
      evidenceTables: ['authorization_decisions'],
    },
  ],
}

/** 登记表：feature_key → 清单。以后推广到别的功能只往这里加。 */
export const CHECKLISTS: Readonly<Record<string, Checklist>> = {
  [ADS_AGENT_FEATURE_KEY]: ADS_AGENT_CHECKLIST,
}
