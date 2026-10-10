/**
 * Review-due dates for docs/registry/platform-candidates.md rows.
 *
 * The markdown table is the single authoritative record of what a candidate
 * IS (owner, evidence, status, links) — this file is only the minimal mirror
 * needed to plug the monthly review into the existing pm-daily-todo cron
 * (already scheduled in render.yaml, runs NZ weekday mornings) instead of
 * leaving it as "当值 FDE 记得每月第一个周一" — a calendar SOP with nothing
 * in code that ever creates the task (CLAUDE.md 铁律 3: 遇卡点必自动化,
 * 管道不许断头).
 *
 * Whoever adds a row to the registry, or updates its 复查日 after a review,
 * MUST add/update the matching entry here in the SAME commit — otherwise the
 * reminder silently stops firing and the registry is back to relying on
 * memory. `me-platform-tier-gate` §默认降级·强制候选登记 references this file.
 */
export interface PlatformCandidateReview {
  /** Must match the 候选名 column in docs/registry/platform-candidates.md. */
  name: string
  /** YYYY-MM-DD, must match the 复查日 column. */
  reviewDate: string
}

export const PLATFORM_CANDIDATE_REGISTRY_URL =
  'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/registry/platform-candidates.md'

export const PLATFORM_CANDIDATE_REVIEWS: PlatformCandidateReview[] = [
  {
    // 必须与 docs/registry/platform-candidates.md 里的候选名完全一致
    name: '借助 Claude Design 生成品牌 VI 视觉资产（logo · 品牌手册 · 视觉规范）',
    reviewDate: '2026-09-27',
  },
  {
    name: '品牌 VI 强制执行（brand tokens 中央注入所有客户交付物 · logo / 色 / 字体 / 风格）',
    reviewDate: '2026-09-28',
  },
  {
    name: '客户官网结构化素材抓取（sitemap → 产品页 → 图片 → 品牌片段）',
    reviewDate: '2026-09-28',
  },
  {
    name: 'HTML → PDF 多页排版渲染（A4/A3 print / 品牌一致的多章节 brochure）',
    reviewDate: '2026-09-28',
  },
  {
    name: 'ME 旅游版 Catalogue Chapter Playbook（旅游行业 catalogue 的 chapter 结构 / 素材抓取通道 / 版式规则）',
    reviewDate: '2026-09-28',
  },
  {
    name: 'Lead 温度打分（多因子：邮件打开频次+最近打开衰减+注册新旧+备注文字里的时间意向 → Hot/Warm/Cold）',
    reviewDate: '2026-09-09',
  },
  {
    name: 'Current-Sponsored Competitor Discovery（当前活跃广告主实时发现 + diff 竞品清单）',
    reviewDate: '2026-09-28',
  },
  {
    name: '创作者专属 collection + 独立 UTM（每个合作创作者一个可归因落地页）',
    reviewDate: '2026-09-30',
  },
  {
    name: '内容排产输入从"想主题"改成"读客户 products.json 上新 feed"',
    reviewDate: '2026-09-30',
  },
  {
    name: '促销走购物车层折扣叠加、不批量改 `compare_at_price`',
    reviewDate: '2026-09-30',
  },
  {
    name: '电商 SEO 检测方向：aggregateRating 空评分 / hreflang 适用性判断 / sitemap 内部垃圾过滤',
    reviewDate: '2026-09-30',
  },
  {
    name: 'AI agent 能否直接购买（Shopify UCP / agents.md 是否平台默认开放）作为 AI 可见度测量口径候选维度',
    reviewDate: '2026-09-30',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: '跨源交叉验证与对照实验设计（用独立数据源互证结论 · 用对照组排除替代解释）',
    reviewDate: '2026-09-30',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: 'AI 单页站生成器（事实采集 → AI 文案 → 模板渲染 → 静态发布）',
    reviewDate: '2026-09-30',
  },
  {
    name: 'AU/NZ 本地商业目录批量登记 SOP（NAP 文案模板 + 目录清单，供未来客户 onboarding 复用）',
    reviewDate: '2026-10-02',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: 'Governed Lead-Reply Agent（结构化事实驱动的广告留资对话生成 + 发送前防幻觉/禁用清单校验引擎，接管 Messenger/WhatsApp 等渠道的黑箱平台自带 AI 客服）',
    reviewDate: '2026-09-15',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: '行业市场研究报告出品能力（署名 "Magic Insight 数据研究院"，面向高级会员定期出品行业级市场研究）',
    reviewDate: '2026-10-03',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: '分档 AI 视频配额闸（每档每月 i2v 条数硬顶 · 满额后优雅退化到静图版 · 超额走 Add-on 加购）',
    reviewDate: '2026-10-04',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: 'Meta 广告受众管理与类似人群能力（建/改自定义受众 + 建 Lookalike 类似人群 + audience-ladder 接线到触发点）',
    reviewDate: '2026-10-06',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: '三层漏斗广告打法剧本（认知→线索→再营销→回传闭环 · 骨架通用 + 分行业配方）',
    reviewDate: '2026-10-06',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: '内容发布→广告草稿直链（Daily Plan 发布完成 → 自动建暂停态广告进指定广告组 · me_ad_launch）',
    reviewDate: '2026-10-06',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: 'Meta 广告数据地基健康诊断（pixel/CAPI 分浏览器端 vs 服务端回传 · 修前基线→修后验证标准）',
    reviewDate: '2026-10-06',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: '转化真相回流能力（Conversion Truth Uplink · 从 CRM 成交事件 → 多平台广告 API：Meta CAPI 先做，Google/TikTok 预留接口）',
    reviewDate: '2026-10-07',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: 'ME 「基于产品事实的 Meta 广告方案生成」能力(拉官网真行程/价 + 现有受众池水位 + 客户历史广告成本基线 → 出三层漏斗 A/B/C 三版文案 + 受众种子选择 + 预算分配 + 激活闲置类似人群 · 全程官网 grounding 不编造)',
    reviewDate: '2026-10-07',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: '广告效果按天诊断引擎（拉 campaign/adset/ad 级每日 Insights → 算成本效率（CPM/CTR/单次线索成本/单次私信开聊成本）→ 查再营销受众是否为空 → 输出预算调整建议 + 原因）',
    reviewDate: '2026-10-13',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: '行程转路线地图生成器（按 Tour 结构化行程数据——城市顺序 + 交通方式 + 停留天数——自动画出风格化路线图，供社媒/广告/落地页使用）',
    reviewDate: '2026-10-13',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: '私信/WhatsApp 对话内容判断有效咨询/成交 → 回传 Meta CAPI',
    reviewDate: '2026-10-13',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: 'AI 辅助图片识别打标签（看图识地名，用来补 hero-rules.ts 关键词清单收不到的生僻地方）',
    reviewDate: '2026-10-15',
  },
  {
    // 与 docs/registry/platform-candidates.md 候选名逐字一致
    name: '从客户历史对话（Messenger/WhatsApp）批量提炼接待风格/标准应对+还没入库的事实，喂给客户知识库',
    reviewDate: '2026-10-15',
  },
]
