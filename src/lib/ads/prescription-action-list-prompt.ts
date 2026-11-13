import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'

/**
 * LLM prompt block for prescriptions.content.action_list (v1: emit only; AD-3 issues cards).
 */
export function prescriptionActionListPromptSection(): string {
  return [
    '### 机器可读广告动作 action_list（可选）',
    '- 当处方里确有「暂停某个广告组」或「调整某广告组日预算」的建议时，除人类可读 actions 外，可额外输出 action_list。',
    '- 数组里**最多**一条 `ads.pause_ad_set` 和一条 `ads.adjust_adset_daily_budget`；不要写第三条同类动作。',
    '- **禁止写真实 Meta 账户/系列/广告组 ID**；没有把握就省略 action_list，不要编造 ID。',
    '- 若仅示意结构，target 可用 `act_PLACEHOLDER`、`camp_PLACEHOLDER`、`adset_PLACEHOLDER` 这类占位（服务端保存前会校验；不确定则整段省略）。',
    '- 预算动作用 `proposed_daily_budget_cents`（整数分）；`direction`（up/down）与 `expected_metric` 可选，仅作提示。',
    '- 暂停动作必须写 `metric`（已拉取的 ads 指标 key，如 ads.account.spend）和 `reason`、`observation_days`（1–28）。',
    '- 同意这份处方后，系统只按 action_list 出确认卡，不会直接改广告；仍须用 phases.actions 写清人要做什么。',
    '- 不要写顶层 `pause_ad_set` 或其它预算块；预算只进 action_list。',
  ].join('\n')
}

export function prescriptionActionListSchemaExample(): string {
  return `"action_list": [
    {
      "type": "${ADS_ACTION_TYPE.PAUSE_AD_SET}",
      "target": { "ad_account_id": "act_PLACEHOLDER", "campaign_id": "camp_PLACEHOLDER", "adset_id": "adset_PLACEHOLDER" },
      "reason": "中文：为什么要先暂停（依据）",
      "observation_days": 7,
      "metric": "ads.account.spend"
    },
    {
      "type": "${ADS_ACTION_TYPE.ADJUST_ADSET_DAILY_BUDGET}",
      "target": { "ad_account_id": "act_PLACEHOLDER", "campaign_id": "camp_PLACEHOLDER", "adset_id": "adset_PLACEHOLDER" },
      "reason": "中文：为什么要调日预算",
      "observation_days": 7,
      "proposed_daily_budget_cents": 8800,
      "direction": "down"
    }
  ]  // 可选：不需要机器动作时整段省略；不要写超过 1+1 条`
}
