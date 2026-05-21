/**
 * 鲁班 Lǔ Bān — 对话代理 system prompt（P8.10.S4.2）
 *
 * 鲁班是 Magic Engine 第三个 Agent（执行代理）。
 * 张骞发现 → 华佗处方 → 鲁班执行。
 * 鲁班陪 FDE 把单个执行项落地：起草内容、分析卡点、给下一步建议。
 *
 * 上下文富化：在执行层对话中注入
 *   ① 张骞发现数据（SEMrush / GBP / social / AI 可见度 / 关键词）
 *   ② Master Brief 品牌约束（语气 / 视觉 / 内容支柱 / 平台策略）
 *   ③ 当期 Campaign 运营方向
 *   ④ 华佗诊断明细（6 维分数 + 同维度 findings）
 */

import type { ExecutionItem, ExecutionLog, DiagnosticDimension, DiagnosticSeverity } from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { MasterBrief, CampaignBrief, ContentPillar, PlatformConfig } from '@/types/magic-engine'
import { formatBriefForPrompt } from '@/lib/content/brief-injector'
import { formatCampaignForPrompt } from '@/lib/content/campaign-injector'

// ── Token control constants ────────────────────────────────────────────────────

const MAX_KEYWORDS      = 8    // SEMrush / seed keyword rows shown
const MAX_AI_GAPS       = 6    // AI visibility miss-queries shown
const MAX_CAMPAIGNS     = 2    // Active campaigns injected
const FINDING_DESC_MAX  = 200  // Characters before finding description is truncated

// ── Lightweight finding type (avoids pulling full DiagnosticFinding into prompt layer) ──

export interface DiagnosticFindingLite {
  dimension:      DiagnosticDimension
  severity:       DiagnosticSeverity
  title:          string
  description:    string
  recommendation: string
}

// ── LubanContext ──────────────────────────────────────────────────────────────

export interface LubanContext {
  item:                ExecutionItem
  prescriptionSummary: string | null
  phaseName:           string | null
  businessName:        string | null
  industry:            string | null
  crisisType:          string | null
  recentLogs:          ExecutionLog[]
  // Enriched context — null / [] = graceful degradation, conversation still works
  discovery:           DiscoveryReport | null
  masterBrief:         MasterBrief | null
  activeCampaigns:     CampaignBrief[]
  dimensionScores:     Partial<Record<DiagnosticDimension, number | null>> | null
  topFindings:         DiagnosticFindingLite[]
}

// ── Display maps ───────────────────────────────────────────────────────────────

const DIM_CN: Record<DiagnosticDimension, string> = {
  seo:           'SEO 自然搜索',
  ai_visibility: 'AI 搜索可见度',
  ads:           '付费广告',
  social:        '社媒运营',
  reputation:    '口碑声誉',
  competitor:    '竞争格局',
}

const SEVERITY_CN: Record<DiagnosticSeverity, string> = {
  critical: '🔴 严重',
  high:     '🟠 高',
  medium:   '🟡 中',
  low:      '⚪ 低',
  info:     'ℹ️ 信息',
}

// ── Section format helpers ────────────────────────────────────────────────────

function formatDiscoverySection(discovery: DiscoveryReport | null): string {
  if (!discovery) return '（张骞发现数据暂未完成，请先运行品牌扫描）'

  const lines: string[] = []

  // SEMrush domain snapshot
  const s = discovery.semrush_snapshot
  if (s) {
    lines.push('SEMrush 域名数据：')
    if (s.monthly_traffic != null) lines.push(`  月度访客：${s.monthly_traffic.toLocaleString()}`)
    if (s.trust_score != null)     lines.push(`  信任分：${s.trust_score}/100`)
    if (s.keyword_count != null)   lines.push(`  排名关键词数：${s.keyword_count}`)
    if (s.top_keywords.length > 0) {
      const kws = s.top_keywords
        .slice(0, MAX_KEYWORDS)
        .map(k => `${k.keyword}（#${k.position}${k.volume ? `，月搜${k.volume}` : ''}）`)
        .join('，')
      lines.push(`  主要排名词：${kws}`)
    }
  }

  // Google Business Profile
  if (discovery.gbp) {
    const g = discovery.gbp
    const parts: string[] = [g.business_name]
    if (g.rating != null)       parts.push(`${g.rating}/5 星`)
    if (g.review_count != null) parts.push(`${g.review_count} 条评价`)
    lines.push(`Google Business Profile：${parts.join(' · ')}`)
  }

  // Review platforms
  const rps = discovery.review_platforms
    .filter(r => r.rating != null || r.review_count != null)
    .map(r => {
      const parts: string[] = [r.platform]
      if (r.rating != null)       parts.push(`${r.rating}分`)
      if (r.review_count != null) parts.push(`${r.review_count}条`)
      return parts.join(' ')
    })
  if (rps.length > 0) lines.push(`评论平台：${rps.join(' | ')}`)

  // Social profiles
  if (discovery.social_profiles.length > 0) {
    lines.push('社媒档案：')
    for (const sp of discovery.social_profiles) {
      const parts: string[] = [sp.platform]
      if (sp.followers_count != null) parts.push(`${sp.followers_count.toLocaleString()} 粉丝`)
      if (sp.posts_last_30d != null)  parts.push(`近30天 ${sp.posts_last_30d} 帖`)
      if (sp.engagement_rate != null) parts.push(`互动率 ${(sp.engagement_rate * 100).toFixed(1)}%`)
      lines.push(`  ${parts.join(' · ')}`)
    }
  }

  // AI visibility gaps
  const aiResults = discovery.ai_visibility_results ?? []
  if (aiResults.length > 0) {
    const gaps = aiResults.filter(r => !r.client_mentioned).slice(0, MAX_AI_GAPS)
    if (gaps.length > 0) {
      lines.push('AI 搜索可见度缺口（以下问句中客户未被提及）：')
      for (const r of gaps) {
        const competitors = r.top_brands.slice(0, 3).join('、')
        lines.push(`  「${r.question}」→ 提及品牌：${competitors}`)
      }
    } else {
      lines.push('AI 搜索可见度：测试问句均有提及客户品牌 ✓')
    }
  }

  // Seed keyword performance
  const rankedKws = (discovery.seed_keywords ?? [])
    .filter(k => k.semrush_rank != null)
    .sort((a, b) => (a.semrush_rank ?? 999) - (b.semrush_rank ?? 999))
    .slice(0, MAX_KEYWORDS)
  if (rankedKws.length > 0) {
    lines.push('核心关键词表现：')
    for (const k of rankedKws) {
      const parts: string[] = [k.keyword]
      if (k.semrush_rank != null)   parts.push(`排名 #${k.semrush_rank}`)
      if (k.semrush_volume != null) parts.push(`月搜 ${k.semrush_volume}`)
      if (k.semrush_kd != null)     parts.push(`难度 ${k.semrush_kd}`)
      lines.push(`  ${parts.join(' · ')}`)
    }
  }

  return lines.length > 0 ? lines.join('\n') : '（张骞发现数据暂无有效指标）'
}

function formatBriefSection(brief: MasterBrief | null): string {
  if (!brief) return '（Master Brief 尚未建立，请先在 Social 模块完成品牌简报）'

  const base = formatBriefForPrompt(brief)
  const extra: string[] = []

  // Content pillars (structured field not covered by formatBriefForPrompt)
  if (brief.content_pillars && brief.content_pillars.length > 0) {
    const pillars = (brief.content_pillars as ContentPillar[])
      .map(p => `${p.name}（${Math.round(p.post_ratio * 100)}%）：${p.description}`)
      .join('；')
    extra.push(`内容支柱：${pillars}`)
  }

  // Platform strategy with frequencies (includes hashtag context)
  if (brief.platform_strategy && Object.keys(brief.platform_strategy).length > 0) {
    const active = Object.entries(brief.platform_strategy)
      .filter(([, cfg]) => (cfg as PlatformConfig).enabled)
      .map(([platform, cfg]) => {
        const c = cfg as PlatformConfig
        return `${platform}（${c.post_frequency}，${c.primary_content_type}）`
      })
    if (active.length > 0) extra.push(`平台发布策略：${active.join('；')}`)
  }

  // Structured brand voice (deeper than the legacy tone field)
  if (brief.brand_voice) {
    const bv = brief.brand_voice
    if (bv.tone_keywords?.length > 0)  extra.push(`语气关键词：${bv.tone_keywords.join('，')}`)
    if (bv.avoid_keywords?.length > 0) extra.push(`语气禁忌词：${bv.avoid_keywords.join('，')}`)
    extra.push(`正式程度：${bv.formality}，Emoji 使用：${bv.emoji_usage}`)
  }

  return extra.length > 0 ? `${base}\n${extra.join('\n')}` : base
}

function formatCampaignSection(campaigns: CampaignBrief[]): string {
  if (campaigns.length === 0) return '（当前无进行中的推广活动）'

  const shown     = campaigns.slice(0, MAX_CAMPAIGNS)
  const remaining = campaigns.length - shown.length
  const parts     = shown.map(c => formatCampaignForPrompt(c))

  let result = parts.join('\n\n---\n\n')
  if (remaining > 0) result += `\n\n（另有 ${remaining} 个推广活动未展开）`
  return result
}

const ALL_DIMS: DiagnosticDimension[] = [
  'seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor',
]

function formatDiagnosisSection(
  scores: Partial<Record<DiagnosticDimension, number | null>> | null,
  findings: DiagnosticFindingLite[],
): string {
  const lines: string[] = []

  if (scores && Object.keys(scores).length > 0) {
    lines.push('华佗 6 维诊断分数（0–100；分越低越需要优先修复）：')
    const scored = ALL_DIMS.filter(d => d in scores)
      .sort((a, b) => (scores[a] ?? 0) - (scores[b] ?? 0))
    for (const d of scored) {
      const v = scores[d]
      const flag = v != null && v < 50 ? ' ⚠️ 偏弱' : ''
      lines.push(`  ${DIM_CN[d]}：${v ?? '暂无数据'}${flag}`)
    }
    const unscored = ALL_DIMS.filter(d => !(d in scores))
    for (const d of unscored) lines.push(`  ${DIM_CN[d]}：（暂无数据）`)
  } else {
    lines.push('华佗 6 维诊断分数：（诊断尚未完成）')
  }

  if (findings.length > 0) {
    lines.push('')
    lines.push('华佗诊断发现的具体问题（与当前执行维度相关，按严重度排序）：')
    for (const f of findings) {
      lines.push(`  [${SEVERITY_CN[f.severity]}] ${f.title}`)
      if (f.description) {
        const desc = f.description.length > FINDING_DESC_MAX
          ? `${f.description.slice(0, FINDING_DESC_MAX)}…`
          : f.description
        lines.push(`    ↳ 问题：${desc}`)
      }
      if (f.recommendation) {
        lines.push(`    ↳ 华佗建议：${f.recommendation}`)
      }
    }
  }

  return lines.join('\n')
}

// ── Existing status maps ───────────────────────────────────────────────────────

const FIX_TYPE_CN: Record<string, string> = {
  me_auto:     'Magic Engine 可自动执行',
  fde_manual:  'FDE 手动执行',
  third_party: '需第三方平台/客户配合',
}

const STATUS_CN: Record<string, string> = {
  pending:     '待处理',
  in_progress: '进行中',
  completed:   '已完成',
  skipped:     '已跳过',
}

// ── Main system prompt builder ─────────────────────────────────────────────────

export function buildLubanSystemPrompt(ctx: LubanContext): string {
  const { item } = ctx
  const steps = (item.steps_json ?? {}) as Record<string, unknown>

  const hours   = typeof steps.estimated_hours === 'number' ? `${steps.estimated_hours} 小时` : '未估算'
  const skills  = Array.isArray(steps.required_skills) ? (steps.required_skills as string[]).join('、') : '未指定'
  const measure = typeof steps.measurement_method === 'string' ? steps.measurement_method : '未指定'
  const moduleK = typeof steps.module === 'string' ? steps.module : '未指定'

  const logsText = ctx.recentLogs.length > 0
    ? ctx.recentLogs.map(l => {
        const who = l.author === 'fde' ? 'FDE' : l.author === 'luban' ? '鲁班' : '系统'
        return `  - [${who} | ${l.kind}] ${l.content}`
      }).join('\n')
    : '  （暂无工作记录）'

  return `你是鲁班（Lǔ Bān），Magic Engine 的执行代理。

历史背景：真实的鲁班是中国古代的工匠祖师，发明了锯、刨、墨斗等工具，亲手建造，因材施工。你的使命与之相同——陪 FDE 工程师把营销处方里的每一个执行项**真正落地**。

## 你的角色

Magic Engine 三个 Agent 接力：
- **张骞** 发现品牌健康现状
- **华佗** 开出三阶段营销处方
- **你（鲁班）** 陪 FDE 把处方里的执行项一项一项做出来

你**不是**纸上谈兵的顾问，你是**动手的工匠**。FDE 用自然语言跟你对话，你要：
1. **起草** — 内容类任务（博客、社媒文案、邮件、GBP 描述等）直接写出可用初稿
2. **分析** — FDE 遇到卡点，你结合上下文给出具体解决路径
3. **建议下一步** — 把大任务拆成 FDE 现在就能做的小步骤
4. **务实** — 考虑客户的真实约束（预算、团队能力、有没有设备），不给做不到的建议

## 当前执行项（你正在协助的任务）

- **标题**：${item.title}
- **说明**：${item.description}
- **所属阶段**：${ctx.phaseName ?? `Phase ${item.phase}`}
- **执行维度**：${DIM_CN[item.dimension] ?? item.dimension}
- **执行类型**：${FIX_TYPE_CN[item.fix_type] ?? item.fix_type}
- **当前状态**：${STATUS_CN[item.status] ?? item.status}
- **预计工时**：${hours}
- **所需技能**：${skills}
- **成效度量方式**：${measure}
- **对应 Magic Engine 模块**：${moduleK}

## 处方与客户背景

- **客户**：${ctx.businessName ?? '（未知）'}${ctx.industry ? `（${ctx.industry}）` : ''}
- **诊断危机类型**：${ctx.crisisType ?? '（未指定）'}
- **处方整体思路**：${ctx.prescriptionSummary ?? '（无摘要）'}

## 张骞发现的客观数据

${formatDiscoverySection(ctx.discovery)}

## 客户品牌约束（Master Brief — 内容创作必须遵守）

${formatBriefSection(ctx.masterBrief)}

## 当前推广活动（Campaign）

${formatCampaignSection(ctx.activeCampaigns)}

## 华佗诊断明细

${formatDiagnosisSection(ctx.dimensionScores, ctx.topFindings)}

## 这个执行项已有的工作记录

${logsText}

## 你的工具

**主动调用**（不用等 FDE 开口）：

- **add_work_log(kind, content)** — 把一条工作记录写进这个执行项的工作日志。何时用：
  - 你和 FDE 达成一个明确结论 → \`kind: "note"\`
  - 你产出了一份可直接用的草稿（博客、文案、邮件等）→ \`kind: "ai_assist"\`
  - FDE 报告了一个卡点 → \`kind: "blocker"\`
  content 用中文、简洁。调用后在回复里自然告诉 FDE 你存了什么，不要默默操作；也不要重复存同一条，只在真正有沉淀价值时调用。

- **generate_content(topic?, instructions?)** — 调用这个执行项对应模块的内容生成能力，**直接产出内容并落库为草稿**，而不是只在对话里贴文本。何时用：
  - 执行项是内容产出类任务（写博客、SEO 文章等），且 FDE 让你「直接生成」「出一篇」「落进系统」
  - topic 留空就用执行项标题；instructions 可选，补充角度 / 重点 / 字数倾向
  目前只直连「SEO 内容引擎」（执行项模块为 seo_engine 时真正落库；其他模块会返回提示，这时你就在对话里直接起草）。
  生成成功后内容进入对应模块的草稿列表等 FDE 审核——在回复里把标题告诉 FDE，并说明去哪里查看。
  注意：只在 FDE 明确要「直接生成 / 落库」时才调用；如果只是讨论思路，用对话回复就好。

**按需调用**（FDE 要求时使用）：

- **publish_to_gbp(post_text, ...)** — 向 Google Business Profile 发布贴子；GBP API 写权限未配置时自动降级为草稿 + 人工发布模式，并把草稿写进工作日志。

- **discover_local_competitors(industry, location, limit?)** — 从 Yellow Pages AU 和 Localsearch.com.au 抓取本地竞品列表（名称 / 电话 / 地址 / 评分）。何时用：FDE 要了解客户所在地区的竞争格局，或执行项需要竞品调研时。industry 和 location 用英文（如 "travel agent" + "Sydney NSW"）。

## 对话风格

- 用中文，像同事一样自然对话（FDE 在跟你聊，不是在读文档）
- 回复**简洁、可操作**——FDE 要的是"现在做什么"，不是长篇大论
- 起草内容时直接给成品，不要"你可以这样写……"绕弯子
- 不确定客户的某个约束时，**主动问 FDE**，而不是假设
- 如果 FDE 描述的卡点超出这个执行项范围（比如需要改处方），明确说"这个建议要回到华佗处方层调整"

## 重要约束：内容创作必须有据可依

**起草任何内容（文案、建议、策略）时，必须遵守以下优先级：**

1. **数据驱动**：引用上方「张骞发现的客观数据」和「华佗诊断明细」作为出发点——例如"根据华佗发现社媒维度 38 分，优先修复发布频率"；"根据 AI 可见度缺口，这篇内容需要覆盖问句 X"
2. **品牌遵守**：所有文案必须符合「客户品牌约束」中的语气、视觉风格、内容支柱比例和禁忌词
3. **Campaign 对齐**：若当前有进行中的 Campaign，内容方向和 CTA 必须体现推广重点
4. **有疑问先问**：以上数据不足以支撑有把握的建议时，主动向 FDE 确认，不要自行补全假设

记住：你是工匠，FDE 是你的搭档。一起把活干漂亮。`
}
