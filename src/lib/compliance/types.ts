/**
 * AU Marketing Compliance — types for the local compliance rule library.
 *
 * Reference: ROADMAP.md P8.12.S3.3
 *
 * 定位：风险提示供人工复核（risk flags for human review），不是合规背书。
 * checkLocalCompliance 永远不给「合规 / 不合规」的绝对判断 —— 只标出
 * 「值得人工关注的点」。
 */

/** 规则类别 — 对应一个 AU 监管领域。 */
export type ComplianceCategory =
  | 'licensing'            // 持牌行业（trades 等）广告须显示 license 号
  | 'financial_services'   // 金融产品建议须持 AFSL（ASIC）
  | 'health_therapeutic'   // 治疗性声明受 TGA / AHPRA 约束
  | 'advertising_claims'   // 误导性广告措辞（ACCC / Australian Consumer Law）

/** 风险等级 — 描述「需要人工关注的程度」，非合规结论。 */
export type ComplianceRiskLevel = 'high' | 'medium' | 'low'

/**
 * 检测方式：
 *  - keyword_present — 文案中「出现」敏感词即触发风险提示
 *  - keyword_absent  — 文案中「缺失」必需要素即触发风险提示
 */
export type ComplianceDetectionType = 'keyword_present' | 'keyword_absent'

/** 一条静态合规规则。 */
export interface ComplianceRule {
  id: string
  category: ComplianceCategory
  /**
   * 适用的 industry_category（取值参照 src/lib/huatuo/industry-mapper.ts）；
   * 'all' 表示全行业适用。
   */
  appliesTo: string[] | 'all'
  riskLevel: ComplianceRiskLevel
  /** 规则说明（这条规则约束的是什么）。 */
  description: string
  detectionType: ComplianceDetectionType
  /** 触发词 / 必需要素的匹配模式（按词边界、大小写不敏感匹配）。 */
  patterns: string[]
  /** 人工复核建议。 */
  guidance: string
  /** 规则来源（法规 / 监管机构），方便日后随法规更新维护。 */
  source: string
}

/** 检查命中的一条风险提示。 */
export interface ComplianceRiskFlag {
  ruleId: string
  category: ComplianceCategory
  riskLevel: ComplianceRiskLevel
  /** keyword_present 时为命中的原文片段；keyword_absent 时为 null。 */
  matchedText: string | null
  /** 面向人的风险描述（已含「供人工复核」语气）。 */
  message: string
  guidance: string
  source: string
}

/** checkLocalCompliance 的返回。 */
export interface ComplianceCheckResult {
  /** 检查时使用的行业代码（null = 未匹配到具体行业，仅跑全行业规则）。 */
  industryCategory: string | null
  /**
   * 命中的风险提示列表。
   * ⚠️ 空数组 ≠ 合规 —— 只表示未命中本规则库已知的风险点。
   */
  flags: ComplianceRiskFlag[]
  /** 固定免责声明：本结果是风险提示，非合规背书。 */
  disclaimer: string
}
