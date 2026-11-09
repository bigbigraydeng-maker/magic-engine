'use client'

import { useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
type Flywheel = 'all' | 'seo' | 'geo' | 'ads' | 'social' | 'infra'

interface NodeDetail {
  title: string
  badge: string
  badgeColor: string
  desc: string
  sections: Array<{ title: string; items: string[] }>
}

interface ArchNode {
  id: string
  label: string
  sub?: string
  fw: Flywheel[]
  detail: NodeDetail
}

interface ArchLayer {
  id: string
  label: string
  colorBg: string
  colorBorder: string
  colorText: string
  nodes: ArchNode[]
}

// ── Data ──────────────────────────────────────────────────────────────────────
const LAYERS: ArchLayer[] = [
  {
    id: 'l0', label: 'L0 · 入口层 — 客户端 UI', colorBg: '#0f2040', colorBorder: '#1d4ed8', colorText: '#60a5fa',
    nodes: [
      { id: 'dashboard', label: '🏠 Dashboard', fw: ['all'], detail: { title: '🏠 Dashboard 主页', badge: '✅ 已上线', badgeColor: '#22c55e', desc: '客户主页。展示 Zhuge 评分、六诊断维度快照、近期飞轮动作、记忆库入口。', sections: [{ title: '关键组件', items: ['ClientDashboardPage', 'ZhugeScoreCard', 'DiagnosticGrid', 'MemoryToolCard'] }, { title: '关联 Phase', items: ['Phase 12.A 飞轮地基 ✅', 'Phase 23 记忆库 (PR#112) ✅'] }] } },
      { id: 'seo_ui', label: '📈 SEO 面板', fw: ['seo'], detail: { title: '📈 SEO 面板', badge: '✅ 已上线', badgeColor: '#22c55e', desc: 'SEO 情报中心。关键词分析、博客生成、AI 可见度快照、内链图谱。', sections: [{ title: '入口路由', items: ['src/app/dashboard/clients/[id]/seo/'] }, { title: '数据来源', items: ['Keyword Intelligence (DataForSEO)', '搜索洞察 (GSC)'] }] } },
      { id: 'geo_ui', label: '🌐 GEO 面板', fw: ['geo'], detail: { title: '🌐 GEO 面板', badge: '✅ 已上线', badgeColor: '#22c55e', desc: 'AI 可见度追踪。每周 cron 自动运行，展示 ChatGPT/Perplexity/Gemini 排名趋势。', sections: [{ title: '关联 Phase', items: ['Phase 7.1 AI Tracker ✅', 'Phase 7.4 Weekly cron ✅'] }] } },
      { id: 'ads_ui', label: '💰 广告诊断', fw: ['ads'], detail: { title: '💰 广告诊断面板', badge: '🔄 Phase 18.A', badgeColor: '#f59e0b', desc: '当前最高优先级。Meta Ads 诊断、Fix 按钮（暂停亏损广告/调整出价/否定词）。', sections: [{ title: 'Phase 18.A 任务', items: ['P18.A.0 归因保真度', 'P18.A.1 Fix 按钮 → Meta MCP', 'P18.A.2 回写 flywheel_actions', 'P18.A.3 审计日志 before/after'] }] } },
      { id: 'social_ui', label: '📱 社媒矩阵', fw: ['social'], detail: { title: '📱 社媒内容矩阵', badge: '✅ 已上线', badgeColor: '#22c55e', desc: '多客户 Brand Brief · Campaign 批量生成 · 视觉工坊 · Publishing Hub 多平台发布。', sections: [{ title: '三路由', items: ['Route A: 关键词驱动', 'Route B: 参考帧学习', 'Route C: 自由主题'] }] } },
      { id: 'execution_board', label: '⚡ 执行看板', fw: ['all'], detail: { title: '⚡ 执行看板', badge: '✅ 已上线', badgeColor: '#22c55e', desc: '执行任务 Kanban，支持拖拽排序。FDE 手动录入（Phase 20.D）。Fix 按钮接 Meta Ads（Phase 18.A 进行中）。', sections: [{ title: '执行形态', items: ['in_house（自动执行）', 'third_party（平台编排）', 'fde_manual（人工录入）'] }] } },
      { id: 'memory_ui', label: '🧠 记忆库', fw: ['all'], detail: { title: '🧠 客户记忆库 (Phase 23)', badge: '✅ PR #112', badgeColor: '#22c55e', desc: '四 Tab 记忆浏览 + AI 自动抽取 + FDE 手动标注。', sections: [{ title: '四 L3 记忆表', items: ['client_patterns', 'client_failed_approaches', 'client_preferences', 'client_decisions'] }] } },
    ],
  },
  {
    id: 'l1', label: 'L1 · 四大飞轮', colorBg: '#0f2d1f', colorBorder: '#16a34a', colorText: '#4ade80',
    nodes: [
      { id: 'fw_seo', label: '🔍 SEO 内容引擎', sub: '关键词情报 · 博客 · 内链', fw: ['seo'], detail: { title: '🔍 SEO 内容引擎', badge: '✅ 成熟', badgeColor: '#22c55e', desc: '双信号博客（SEO×GEO）· 关键词情报 · 内链策略。DataForSEO 数据地基节省 96–99% 成本。', sections: [{ title: '博客 mode 字段', items: ['unified（SEO+GEO 双信号）', 'geo_only', 'seo_only'] }, { title: '必须记录', items: ['mode', 'source_query_id', 'geo_directive_id', 'primary_keyword + volume + kd'] }] } },
      { id: 'fw_geo', label: '🌐 GEO 可见度', sub: 'AI 追踪 · 隐藏指令 · 品牌实体', fw: ['geo'], detail: { title: '🌐 GEO 可见度飞轮', badge: '✅ 成熟', badgeColor: '#22c55e', desc: '2026 差异化窗口。AI 追踪弱项 × SEMrush 低 KD 交叉驱动选题。每周 cron 自动运行。', sections: [{ title: '核心', items: ['AI Tracker 每周 cron (Monday 1am UTC)', 'GEO Composer', 'GEO 隐藏指令块', '品牌实体 + FAQ 注入'] }] } },
      { id: 'fw_ads', label: '📢 Ads Intelligence', sub: 'Meta MVP · Fix / Talk to Us', fw: ['ads'], detail: { title: '📢 Ads Intelligence', badge: '🔄 Phase 18.A', badgeColor: '#f59e0b', desc: '当前最高优先级。Meta 优先 → Google Ads → TikTok → LinkedIn。归因保真度机制必须先建。', sections: [{ title: 'Fix 边界', items: ['✅ 自动: 暂停亏损词/调整出价/否定词/启停广告', '🔴 人工: 重构结构/预算策略/创意方向/跨账户'] }] } },
      { id: 'fw_social', label: '📱 社媒内容矩阵', sub: 'Campaign 批量 · 视觉工坊 · 发布', fw: ['social'], detail: { title: '📱 社媒内容矩阵', badge: '✅ 成熟', badgeColor: '#22c55e', desc: 'PostCard 追踪 post_id + fidelity score。归因保真度 Phase 18.A.0 先建。', sections: [{ title: 'cron', items: ['social-engagement-pullback: 0 4 * * *'] }] } },
    ],
  },
  {
    id: 'l2', label: 'L2 · AI Agent 层（Strategy Engine = Claude Sonnet）', colorBg: '#1e1030', colorBorder: '#7c3aed', colorText: '#a78bfa',
    nodes: [
      { id: 'zhuge', label: '⚔️ 诸葛亮', sub: 'Strategy Scheduler', fw: ['all'], detail: { title: '⚔️ 诸葛亮 — Strategy Scheduler', badge: 'Claude Sonnet', badgeColor: '#8b5cf6', desc: '每周优先级重排 cron (Monday 3am UTC)。读取客户记忆 L1/L2 注入。输出 execution_items 看板。', sections: [{ title: '输入', items: ['flywheel actions/metrics/outcomes', '客户记忆 L1/L2/L3', '六诊断维度评分'] }, { title: 'Phase', items: ['Phase 24.B weekly recalculate ✅'] }] } },
      { id: 'zhangqian', label: '🗺️ 张骞', sub: 'Discovery Agent', fw: ['seo', 'geo'], detail: { title: '🗺️ 张骞 — Discovery Agent', badge: 'Claude Sonnet', badgeColor: '#8b5cf6', desc: '深度客户网站诊断（Site Analyzer）。生成初始六维评分。sweeper cron 每 5 分钟清理卡住任务。', sections: [{ title: '六诊断维度', items: ['seo / ai_visibility / ads', 'social / reputation / competitor'] }, { title: 'cron', items: ['zhangqian-sweeper: */5 * * * *'] }] } },
      { id: 'huatuo', label: '🏥 华佗', sub: 'Performance Analyst', fw: ['ads', 'seo', 'geo', 'social'], detail: { title: '🏥 华佗 — Performance Analyst', badge: 'Claude Sonnet', badgeColor: '#8b5cf6', desc: '持续监测飞轮指标，生成 outcome 归因卡片（baseline/after/verdict）。每 6 小时 attribution cron。', sections: [{ title: '核心', items: ['flywheel_outcomes 写入', 'attribution cron: 0 */6 * * *', 'GSC/GA4 数据消费'] }] } },
      { id: 'luban', label: '🛠️ 鲁班', sub: 'Content Builder (GPT-4o-mini)', fw: ['seo', 'geo', 'social'], detail: { title: '🛠️ 鲁班 — Content Builder', badge: 'GPT-4o-mini', badgeColor: '#d97706', desc: '高频内容生成（博客/社媒/GEO指令）。低成本模型。输出必须带 mode/source_query_id/geo_directive_id。', sections: [{ title: '生成类型', items: ['双信号博客 (unified/geo_only/seo_only)', '社媒 Campaign', 'GEO 隐藏指令块', '视觉提示词'] }] } },
      { id: 'memory_layer', label: '🧠 Memory Layer', sub: 'L1/L2/L3 记忆注入', fw: ['all'], detail: { title: '🧠 Memory Layer (Phase 23)', badge: '✅ PR #112', badgeColor: '#22c55e', desc: '四 Agent 执行前注入客户历史：成功模式、失败经验、偏好、重要决策。避免重复错误。', sections: [{ title: '注入到', items: ['诸葛亮 (Strategy)', '张骞 (Discovery)', '华佗 (Analysis)', '鲁班 (Content)'] }] } },
    ],
  },
  {
    id: 'l3', label: 'L3 · 执行层（三种形态）', colorBg: '#1a1a10', colorBorder: '#ca8a04', colorText: '#fbbf24',
    nodes: [
      { id: 'inhouse', label: '🏠 In-House', sub: 'SEO内容 · GEO Composer · 社媒制作', fw: ['seo', 'geo', 'social'], detail: { title: '🏠 In-House 执行', badge: '自研工作台', badgeColor: '#22c55e', desc: 'Magic Engine 内自研工作台直接执行。内容生成、GEO Composer、社媒制作全流程自动化。', sections: [{ title: '覆盖飞轮', items: ['SEO 内容写作', 'GEO 指令生成', '社媒 Campaign 生成'] }] } },
      { id: 'third_party', label: '🔌 Third-Party', sub: 'Meta Ads · Publishing Hub · markisfact', fw: ['ads', 'social'], detail: { title: '🔌 Third-Party 编排', badge: '平台 API', badgeColor: '#38bdf8', desc: '编排第三方平台执行。Magic Engine 发指令，平台执行，结果回流到飞轮表。', sections: [{ title: '平台', items: ['Meta Ads Manager (Phase 18.A)', 'Publishing Hub（第三方发布工具，2026-10 已退役）', 'markisfact'] }] } },
      { id: 'fde_manual', label: '👤 FDE Manual', sub: 'Reputation · Newsletter · 外呼', fw: ['all'], detail: { title: '👤 FDE Manual 执行', badge: '人工录入', badgeColor: '#ef4444', desc: 'FDE 完全在 Magic Engine 外部完成，手动录入结果。reputation + competitor 维度只诊断不接入飞轮。', sections: [{ title: '类型', items: ['reputation 管理', 'newsletter 发送', '电话外呼', 'competitor 监控'] }] } },
    ],
  },
  {
    id: 'l4', label: 'L4 · 飞轮数据库（Supabase PostgreSQL）', colorBg: '#0f1f2d', colorBorder: '#0891b2', colorText: '#22d3ee',
    nodes: [
      { id: 'actions_table', label: '📋 flywheel_actions', sub: 'diagnostic / fde_manual / proactive', fw: ['all'], detail: { title: '📋 flywheel_actions', badge: 'L4 核心表', badgeColor: '#06b6d4', desc: '所有执行动作记录。source 字段区分来源：diagnostic（诊断触发）/ fde_manual（人工录入）/ proactive_signal（主动信号）。', sections: [{ title: '关键字段', items: ['flywheel: seo/geo/ads/social', 'execution_type: in_house/third_party/external_manual', 'source: diagnostic/fde_manual/proactive_signal', 'status: pending/in_progress/done/failed'] }] } },
      { id: 'metrics_table', label: '📊 flywheel_metrics', sub: '时序指标快照', fw: ['all'], detail: { title: '📊 flywheel_metrics', badge: 'L4 时序表', badgeColor: '#06b6d4', desc: '时序指标快照。GSC/GA4/Meta Ads/社媒参与度回流到此表。华佗 Agent 消费。', sections: [{ title: '数据来源 cron', items: ['GSC + GA4 daily: 0 3 * * *', 'Meta Ads insights (Phase 18.A.4)', '社媒参与度: 0 4 * * *'] }] } },
      { id: 'outcomes_table', label: '🎯 flywheel_outcomes', sub: 'baseline/after/verdict 归因', fw: ['all'], detail: { title: '🎯 flywheel_outcomes', badge: 'L4 归因表', badgeColor: '#06b6d4', desc: '每个 flywheel_action 的归因结果。华佗每 6 小时计算。Phase 21 内容飞轮的学习数据源（强依赖 18.A.4）。', sections: [{ title: '字段', items: ['baseline_value / after_value', 'verdict: improved/no_change/declined', 'confidence_score'] }] } },
      { id: 'memory_l4', label: '🧠 记忆四表', sub: 'patterns/failures/prefs/decisions', fw: ['all'], detail: { title: '🧠 记忆四表 (Phase 23)', badge: '✅ PR #112', badgeColor: '#22c55e', desc: '客户长期记忆层。4 张 L3 记忆表，Agents 每次执行前注入。', sections: [{ title: '四表', items: ['client_patterns', 'client_failed_approaches', 'client_preferences', 'client_decisions'] }] } },
      { id: 'anomaly_table', label: '⚠️ anomaly_signals', sub: 'Phase 22.D 规划中', fw: ['all'], detail: { title: '⚠️ anomaly_signals (Phase 22.D)', badge: '📋 规划中', badgeColor: '#9ca3af', desc: '主动异常检测信号表。Phase 22.D 规划中，用于 proactive_signal 来源的飞轮动作触发。', sections: [{ title: '依赖', items: ['需 flywheel_metrics 有足够历史数据'] }] } },
    ],
  },
  {
    id: 'l5', label: 'L5 · 外部数据源（封装名对外展示）', colorBg: '#1a0f0f', colorBorder: '#dc2626', colorText: '#f87171',
    nodes: [
      { id: 'keyword_intel', label: '🔑 Keyword Intelligence', sub: 'DataForSEO · SEMrush', fw: ['seo'], detail: { title: '🔑 Keyword Intelligence', badge: '封装名', badgeColor: '#22c55e', desc: '实际为 DataForSEO + SEMrush。DataForSEO 直连节省 96-99% 成本，替代 SEMrush 直连。AU/NZ 市场 (gl=au, db=au)。', sections: [{ title: 'cron', items: ['keyword-snapshots-weekly: 0 2 * * 1 (Monday 2am UTC)'] }] } },
      { id: 'site_analyzer', label: '🌐 Site Analyzer', sub: 'Jina.ai Reader', fw: ['seo', 'geo'], detail: { title: '🌐 Site Analyzer', badge: '封装名', badgeColor: '#22c55e', desc: '实际为 Jina.ai Reader。张骞 Discovery Agent 用于网页内容抓取和分析。', sections: [] } },
      { id: 'ai_tracking', label: '🤖 AI 可见度追踪', sub: 'ChatGPT / Perplexity / Claude', fw: ['geo'], detail: { title: '🤖 AI 可见度追踪', badge: '✅ Phase 7.1', badgeColor: '#22c55e', desc: '三引擎 AI 搜索排名追踪。问句必须带地域标签（"best X in New Zealand"）。avg_rank 1.49（CTS）。', sections: [{ title: 'cron', items: ['ai-tracker-weekly: 0 1 * * 1 (Monday 1am UTC)'] }] } },
      { id: 'gsc_ga4', label: '📈 搜索洞察 + 数据分析', sub: 'GSC · GA4', fw: ['seo', 'geo'], detail: { title: '📈 搜索洞察 + 数据分析', badge: '✅ Phase 17.A', badgeColor: '#22c55e', desc: '封装名。实际为 GSC + GA4。每日 3am UTC cron 同步快照到 flywheel_metrics。', sections: [{ title: 'cron', items: ['google-data-pullback-daily: 0 3 * * *'] }] } },
      { id: 'meta_ads_api', label: '📢 Meta Ads MCP', sub: 'Graph API', fw: ['ads'], detail: { title: '📢 Meta Ads MCP', badge: '🔄 Phase 18.A', badgeColor: '#f59e0b', desc: '已有 Meta Ads MCP 接入。Phase 18.A 建 Fix 按钮。P1 安全要求：entity ownership 验证。', sections: [{ title: 'P1 安全', items: ['entity ownership 验证（P1 bug）', 'before/after snapshot 审计日志'] }] } },
      { id: 'publishing_hub', label: '📤 Publishing Hub', sub: '已退役（2026-10）', fw: ['social'], detail: { title: '📤 Publishing Hub', badge: '封装名', badgeColor: '#22c55e', desc: '第三方发布工具封装，已于 2026-10 退役。Phase 18.A.0 要求发布时记录 post_id + fidelity_score 归因保真度。', sections: [] } },
      { id: 'content_workspace', label: '📋 Content Workspace', sub: 'Airtable', fw: ['social', 'seo'], detail: { title: '📋 Content Workspace', badge: '封装名', badgeColor: '#22c55e', desc: '实际为 Airtable REST API。写回用 .catch() 静默失败，不影响主流程。', sections: [] } },
      { id: 'visual_studio', label: '🎨 Visual Studio', sub: 'Atlas · WaveSpeed · Seedance', fw: ['social', 'seo'], detail: { title: '🎨 Visual Studio', badge: '封装名', badgeColor: '#22c55e', desc: '实际为 Atlas Cloud (WaveSpeed Flux-dev + Seedance 2.0)。视觉生成 cron 每 2 分钟 poll。', sections: [{ title: 'cron', items: ['poll-visual-jobs: */2 * * * *'] }] } },
    ],
  },
]

const FW_LABELS: Record<Flywheel, string> = {
  all: '全部', seo: '🔍 SEO', geo: '🌐 GEO', ads: '📢 广告', social: '📱 社媒', infra: '🔧 基建',
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ArchDiagram() {
  const [fwFilter, setFwFilter] = useState<Flywheel>('all')
  const [selected, setSelected] = useState<NodeDetail | null>(null)
  const [selId, setSelId] = useState<string>('')

  function handleNode(node: ArchNode) {
    if (selId === node.id) { setSelected(null); setSelId('') }
    else { setSelected(node.detail); setSelId(node.id) }
  }

  function isDimmed(node: ArchNode) {
    if (fwFilter === 'all') return false
    return !node.fw.includes(fwFilter) && !node.fw.includes('all')
  }

  return (
    <div style={{ display: 'flex', gap: 0, minHeight: 'calc(100vh - 65px)' }}>
      {/* ── Main arch area ── */}
      <div style={{ flex: 1, padding: '16px 20px', overflowX: 'auto' }}>
        {/* Flywheel filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {(['all', 'seo', 'geo', 'ads', 'social'] as Flywheel[]).map(fw => (
            <button key={fw} onClick={() => setFwFilter(fw)}
              style={{ padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: fwFilter === fw ? '#3b82f6' : '#1e293b', color: fwFilter === fw ? '#fff' : '#94a3b8' }}>
              {FW_LABELS[fw]}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569', alignSelf: 'center' }}>
            点击节点查看详情 · Esc 关闭
          </span>
        </div>

        {/* Layers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {LAYERS.map((layer, li) => (
            <div key={layer.id}>
              {/* Layer box */}
              <div style={{ background: layer.colorBg, border: `1px solid ${layer.colorBorder}`, borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: layer.colorText, marginBottom: 8, opacity: 0.8 }}>
                  {layer.label}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {layer.nodes.map(node => {
                    const dimmed = isDimmed(node)
                    const isSelected = selId === node.id
                    return (
                      <button key={node.id} onClick={() => handleNode(node)}
                        style={{
                          padding: '7px 11px', borderRadius: 7, border: `1.5px solid ${isSelected ? '#f59e0b' : layer.colorBorder}`,
                          background: isSelected ? '#1e3a5f' : layer.colorBg,
                          color: layer.colorText, fontSize: 12, cursor: 'pointer', textAlign: 'left',
                          opacity: dimmed ? 0.15 : 1, transition: 'all .15s',
                          outline: isSelected ? '2px solid #f59e0b' : 'none', outlineOffset: 2,
                          filter: dimmed ? 'none' : 'brightness(1)',
                        }}
                        onMouseEnter={e => { if (!dimmed) (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.2)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1)' }}
                      >
                        <div style={{ fontWeight: 600 }}>{node.label}</div>
                        {node.sub && <div style={{ fontSize: 10, opacity: 0.65, marginTop: 2 }}>{node.sub}</div>}
                      </button>
                    )
                  })}
                </div>
              </div>
              {/* Arrow between layers */}
              {li < LAYERS.length - 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3px 0', gap: 8 }}>
                  <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, #334155, transparent)' }} />
                  <span style={{ fontSize: 10, color: '#475569', whiteSpace: 'nowrap' }}>
                    {li === 0 ? '↓ 用户操作 / API 调用' : li === 1 ? '↓ 分配给 AI Agent' : li === 2 ? '↓ 生成执行指令' : li === 3 ? '↓ 回写飞轮数据' : '↓ 拉取外部数据'}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, #334155, transparent)' }} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16, paddingTop: 12, borderTop: '1px solid #1e293b' }}>
          {[['#22c55e', '✅ 已上线'], ['#f59e0b', '🔄 开发中'], ['#9ca3af', '📋 规划中']].map(([c, l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#64748b' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block' }} />
              {l}
            </div>
          ))}
        </div>
      </div>

      {/* ── Detail Panel ── */}
      {selected && (
        <div style={{ width: 300, flexShrink: 0, borderLeft: '1px solid #334155', padding: '16px', background: '#1e293b', overflowY: 'auto', maxHeight: 'calc(100vh - 65px)', position: 'sticky', top: 65 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#f1f5f9', lineHeight: 1.3, flex: 1 }}>{selected.title}</div>
            <button onClick={() => { setSelected(null); setSelId('') }}
              style={{ background: '#334155', border: 'none', color: '#94a3b8', width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', fontSize: 12, marginLeft: 8, flexShrink: 0 }}>
              ✕
            </button>
          </div>
          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, color: '#fff', background: selected.badgeColor, marginBottom: 10 }}>
            {selected.badge}
          </span>
          <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, marginBottom: 12 }}>{selected.desc}</p>
          {selected.sections.map(s => (
            <div key={s.title} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#475569', letterSpacing: '.5px', marginBottom: 5 }}>{s.title}</div>
              {s.items.map(item => (
                <div key={item} style={{ fontSize: 11, color: '#cbd5e1', padding: '3px 0', borderBottom: '1px solid #0f172a' }}>→ {item}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
