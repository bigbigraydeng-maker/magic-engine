/**
 * AU Marketing Compliance — static rule library + checker.
 *
 * Reference: ROADMAP.md P8.12.S3.3
 *
 * 普通大模型不了解 AU 本地合规约束，本模块把人工调研整理的规则固化下来，
 * 对营销文案做关键词级的风险扫描。
 *
 * ⚠️ 定位：风险提示供人工复核，不是合规背书。checkLocalCompliance 不会、
 *    也不应给出「合规 / 不合规」的绝对判断 —— 只标出「值得人工关注的点」。
 *
 * 规则来源逐条标注在 `source` 字段，方便日后随法规更新维护。
 * industry_category 取值参照 src/lib/huatuo/industry-mapper.ts。
 */

import type {
  ComplianceRule,
  ComplianceCategory,
  ComplianceRiskFlag,
  ComplianceCheckResult,
} from './types'

const DISCLAIMER =
  '以上为基于关键词的合规风险提示，仅供人工复核参考，不构成合规背书或法律意见。' +
  '最终发布前请由熟悉 AU 广告法规的人员审核。'

/**
 * AU 合规规则库。每条规则在 `source` 标注法规 / 监管机构来源。
 */
export const AU_COMPLIANCE_RULES: ComplianceRule[] = [
  // ── Trades licensing ──────────────────────────────────────────────────────
  {
    id: 'trades-license-number',
    category: 'licensing',
    appliesTo: ['trades_plumbing_electrical'],
    riskLevel: 'high',
    description:
      'AU 各州对持牌行业（电工、水管工等）的广告普遍要求显示承包商 license 号。',
    detectionType: 'keyword_absent',
    patterns: ['licence', 'license'],
    guidance:
      '若此文案用于 trades 广告投放，请确认已显示有效的 license 号'
      + '（如 NSW Fair Trading / QLD QBCC / Energy Safe Victoria 等签发）。',
    source:
      'NSW Home Building Act 1989；QLD QBCC Act 1991；'
      + 'VIC Energy Safe Victoria — 各州持牌行业广告须列明 license 号',
  },
  // ── Financial services (AFSL) ─────────────────────────────────────────────
  {
    id: 'financial-advice-afsl',
    category: 'financial_services',
    appliesTo: ['accounting_advisory'],
    riskLevel: 'high',
    description:
      '提供金融产品建议（投资、理财规划等）须持有 AFSL；纯记账 / 报税不在此列。',
    detectionType: 'keyword_present',
    patterns: [
      'financial advice', 'investment advice', 'financial planning',
      'financial product', 'wealth management', 'superannuation advice',
    ],
    guidance:
      '出现金融建议类措辞 —— 请确认主体持有 AFSL（或为授权代表 Authorised '
      + 'Representative），或在文案中明确披露持牌信息与免责声明。',
    source:
      'Corporations Act 2001 (Cth) Part 7.6；'
      + 'ASIC — Australian Financial Services Licence 要求',
  },
  // ── Health / therapeutic claims (TGA + AHPRA) ─────────────────────────────
  {
    id: 'health-therapeutic-claims',
    category: 'health_therapeutic',
    appliesTo: ['dental_clinic'],
    riskLevel: 'high',
    description:
      '健康 / 医疗服务广告不得作绝对化疗效承诺；AHPRA 另禁止使用患者证言做广告。',
    detectionType: 'keyword_present',
    patterns: [
      'cure', 'guaranteed result', 'guaranteed results', 'pain-free guarantee',
      '100% safe', 'miracle', 'risk-free', 'permanent results', 'no side effects',
    ],
    guidance:
      '出现疗效承诺类措辞 —— 请确认符合 TGA 治疗性声明规定与 AHPRA 广告准则'
      + '（避免绝对化承诺、避免使用患者证言）。',
    source:
      'Therapeutic Goods Act 1989 (Cth)；'
      + 'AHPRA — Advertising a regulated health service（National Law s133）',
  },
  // ── Advertising claims (ACCC / Australian Consumer Law) — 全行业 ───────────
  {
    id: 'acl-price-superiority-claims',
    category: 'advertising_claims',
    appliesTo: 'all',
    riskLevel: 'medium',
    description:
      'ACL 禁止误导性陈述。最低价 / 最优 / 第一类「优越性声明」须有可证实依据。',
    detectionType: 'keyword_present',
    patterns: [
      'lowest price', 'best price', 'cheapest', 'lowest price guarantee',
      'price beat guarantee', 'number one', 'unbeatable', 'beat any price',
    ],
    guidance:
      '出现价格 / 优越性声明 —— 请确认有可证实的依据（如实时比价、可查证的市场'
      + '数据），否则可能构成误导性陈述。',
    source:
      'Competition and Consumer Act 2010 (Cth) Sch 2 (Australian Consumer Law) '
      + 's18、s29；ACCC 误导性陈述指引',
  },
  {
    id: 'acl-guarantee-free-claims',
    category: 'advertising_claims',
    appliesTo: 'all',
    riskLevel: 'medium',
    description:
      '「保证」「免费」「无风险」等措辞若附隐藏条件，可能构成误导。',
    detectionType: 'keyword_present',
    patterns: [
      'guarantee', 'guaranteed', '100% free', 'free', 'no obligation',
      'risk-free', 'no catch', 'no strings attached',
    ],
    guidance:
      '出现「保证 / 免费 / 无风险」类措辞 —— 请确认无隐藏条件，或在文案中清楚'
      + '披露适用条款与限制。',
    source:
      'Competition and Consumer Act 2010 (Cth) Sch 2 (Australian Consumer Law) '
      + 's29、s32；ACCC —「free」与条件性优惠指引',
  },
  {
    id: 'acl-fake-discount',
    category: 'advertising_claims',
    appliesTo: 'all',
    riskLevel: 'low',
    description:
      '「原价 / 现价」式折扣若原价非真实长期售价，属虚假折扣（fake "was/now" pricing）。',
    detectionType: 'keyword_present',
    patterns: [
      'was $', 'now only', 'reduced from', 'slashed', 'half price', 'rrp',
    ],
    guidance:
      '出现折扣对比措辞 —— 请确认「原价」为发布前合理期间的真实售价，避免虚高原价。',
    source:
      'Competition and Consumer Act 2010 (Cth) Sch 2 (Australian Consumer Law) '
      + 's18；ACCC — 虚假折扣（"was/now" pricing）指引',
  },
]

// ─── Checker ──────────────────────────────────────────────────────────────────

/** 转义正则特殊字符，使 pattern 能按字面量匹配。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 在 content 里查找 pattern；返回首个命中的原文片段（未命中返回 null）。
 * 纯单词 pattern 用词边界匹配（避免 "free" 误伤 "freedom"）；
 * 含空格 / 符号的 pattern 退化为普通包含匹配。
 */
function findMatch(content: string, pattern: string): string | null {
  const isPlainWord = /^[a-z]+$/i.test(pattern)
  const body = escapeRegExp(pattern)
  const re = isPlainWord
    ? new RegExp(`\\b${body}\\b`, 'i')
    : new RegExp(body, 'i')
  const m = content.match(re)
  return m ? m[0] : null
}

/** 判断一条规则是否适用于给定行业。 */
function ruleApplies(rule: ComplianceRule, industryCategory: string | null): boolean {
  if (rule.appliesTo === 'all') return true
  if (!industryCategory) return false
  return rule.appliesTo.includes(industryCategory)
}

/** category 的中文标签。 */
function categoryLabel(category: ComplianceCategory): string {
  const map: Record<ComplianceCategory, string> = {
    licensing: '持牌信息显示',
    financial_services: '金融服务持牌（AFSL）',
    health_therapeutic: '健康 / 治疗性声明（TGA / AHPRA）',
    advertising_claims: '广告措辞（ACCC / ACL）',
  }
  return map[category]
}

/** 把规则 + 命中信息组装成一条风险提示。 */
function buildFlag(rule: ComplianceRule, matchedText: string | null): ComplianceRiskFlag {
  const label = categoryLabel(rule.category)
  const message = matchedText
    ? `文案中出现「${matchedText}」，可能触及「${label}」风险点，建议人工复核。`
    : `文案疑似缺少「${label}」所需要素，建议人工复核。`
  return {
    ruleId: rule.id,
    category: rule.category,
    riskLevel: rule.riskLevel,
    matchedText,
    message,
    guidance: rule.guidance,
    source: rule.source,
  }
}

/**
 * 扫描营销文案，返回 AU 合规风险提示列表。
 *
 * ⚠️ 返回的是「值得人工复核的风险点」，不是合规结论。flags 为空 ≠ 合规。
 *
 * @param content 营销文案纯文本
 * @param industryCategory 行业代码（参照 industry-mapper.ts），null = 仅跑全行业规则
 */
export function checkLocalCompliance(
  content: string,
  industryCategory: string | null,
): ComplianceCheckResult {
  const flags: ComplianceRiskFlag[] = []

  for (const rule of AU_COMPLIANCE_RULES) {
    if (!ruleApplies(rule, industryCategory)) continue

    if (rule.detectionType === 'keyword_present') {
      // 出现任一敏感词即提示；一条规则只报一次，避免刷屏
      for (const pattern of rule.patterns) {
        const matched = findMatch(content, pattern)
        if (matched) {
          flags.push(buildFlag(rule, matched))
          break
        }
      }
    } else {
      // keyword_absent：所有必需要素都没出现 → 提示缺失
      const anyPresent = rule.patterns.some(p => findMatch(content, p) !== null)
      if (!anyPresent) flags.push(buildFlag(rule, null))
    }
  }

  return { industryCategory, flags, disclaimer: DISCLAIMER }
}
