/**
 * 90-day delivery template (Phase B · FDE delivery cockpit).
 *
 * Encodes the $990 / 90-day founding SOP (docs FDE Delivery Kit) as an ordered,
 * data-driven checklist that the FDE cockpit renders per client — each step
 * deep-links straight to the ME tool that performs it, so the FDE clicks
 * through in order instead of remembering a doc + hunting for the right screen.
 *
 * Pure config + helpers, no I/O — safe to import from server or client. The
 * per-client completion state is layered on separately (see the cockpit page);
 * this module is the single source of truth for WHAT the steps are.
 *
 * Source of truth for the deliverables themselves:
 * docs/superpowers/specs/2026-07-07-990-growth-engine-package-v1.md (contract
 * Schedule B). Keep this list in sync with the spec.
 */

export type DeliveryPhaseKey = 'kickoff' | 'foundation' | 'lead_engine' | 'proof'

/** Which lead-engine track a step belongs to. 'all' = every client. */
export type DeliveryTrack = 'all' | 'search' | 'nurture'

export interface DeliveryPhase {
  key: DeliveryPhaseKey
  label: string
  weeks: string
}

export interface DeliveryStep {
  key: string
  phase: DeliveryPhaseKey
  order: number
  title: string
  /** One line: what the FDE actually does here. */
  whatToDo: string
  /** Acceptance — the step is done when this is true. */
  doneWhen: string
  track: DeliveryTrack
  /** Deep-link into the ME tool that performs this step. null = work done
   *  outside ME (on the client's own site / external), shown as a note. */
  toolLabel: string | null
  /** Href pattern with a ':id' placeholder for the client id. Some tools take
   *  the id in a non-standard position, so this is a full pattern, not a suffix. */
  toolHrefPattern: string | null
}

export const DELIVERY_PHASES: DeliveryPhase[] = [
  { key: 'kickoff',     label: '开工',              weeks: 'Day 0–3' },
  { key: 'foundation',  label: '数字地基',          weeks: 'Weeks 1–3' },
  { key: 'lead_engine', label: '获客引擎',          weeks: 'Weeks 3–8' },
  { key: 'proof',       label: '回流复盘',          weeks: 'Weeks 9–12' },
]

export const DELIVERY_STEPS: DeliveryStep[] = [
  // ── Kickoff ──────────────────────────────────────────────────────────────
  {
    key: 'onboarding', phase: 'kickoff', order: 10, track: 'all',
    title: '开工配置 + 收权限',
    whatToDo: '填客户档案（关键词/竞品/品牌别名/GBP/社媒），确认已收网站、GBP、素材、老客户名单。',
    doneWhen: '客户档案关键字段已填，7 项开工前置收齐（缺的记为顺延）。',
    toolLabel: '客户设置', toolHrefPattern: '/dashboard/clients/:id/settings',
  },
  // ── Foundation (Weeks 1–3) ───────────────────────────────────────────────
  {
    key: 'website_refresh', phase: 'foundation', order: 20, track: 'all',
    title: '网站视觉升级',
    whatToDo: '在客户自己网站上翻新（单页深度 / ≤5 页，2 轮改），手机端首屏放 CTA + 一键拨号。',
    doneWhen: '手机+电脑截图存档，客户书面确认定稿。',
    toolLabel: null, toolHrefPattern: null, // 在客户站上做，ME 外
  },
  {
    key: 'enquiry_form', phase: 'foundation', order: 30, track: 'all',
    title: '询盘表单 + 绑定手机',
    whatToDo: '生成嵌入表单 snippet，贴到客户网站；提交实时进老板手机。',
    doneWhen: '测试提交，老板 60 秒内收到通知；一键拨号在首屏。',
    toolLabel: '生成表单 snippet', toolHrefPattern: '/dashboard/clients/:id/lead-form',
  },
  {
    key: 'analytics', phase: 'foundation', order: 40, track: 'all',
    title: 'GA4 + 转化事件',
    whatToDo: '客户 Google 账户下建 GA4，连 connector，设表单提交/点击拨号为 key event。',
    doneWhen: 'GA4 Realtime 看到自测事件；property 归客户账户。',
    toolLabel: '连接器', toolHrefPattern: '/dashboard/clients/:id/connectors',
  },
  {
    key: 'gbp', phase: 'foundation', order: 50, track: 'all',
    title: 'GBP 设立 / 优化',
    whatToDo: '认领+优化 Google Business Profile：类目、服务项、照片、营业时间、服务区、Q&A。',
    doneWhen: 'GBP 资料完整度拉满，截图存档。',
    toolLabel: 'GBP 设置', toolHrefPattern: '/dashboard/clients/:id/settings',
  },
  {
    key: 'seo', phase: 'foundation', order: 60, track: 'all',
    title: '网站 SEO 升级',
    whatToDo: '逐页写 title/meta/H1（含本地词），加 LocalBusiness schema，基础速度项，确认 HTTPS。',
    doneWhen: '每页唯一 title/meta/H1；Schema 校验过；绿锁。',
    toolLabel: 'SEO 情报', toolHrefPattern: '/dashboard/clients/:id/seo-intelligence',
  },
  {
    key: 'geo', phase: 'foundation', order: 70, track: 'all',
    title: 'GEO snippet 安装',
    whatToDo: '生成客户 GEO 代码块并装到网站，记录 AI 提及基线。',
    doneWhen: 'snippet 上线，AI 提及基线截图存档。',
    toolLabel: 'GEO Composer', toolHrefPattern: '/dashboard/geo-composer/:id',
  },
  // ── Lead engine (Weeks 3–8) ──────────────────────────────────────────────
  {
    key: 'review_engine', phase: 'lead_engine', order: 80, track: 'search',
    title: '评价邀约一轮（搜索轨）',
    whatToDo: '导入老客户名单，群发「一键留 Google 评价」链接，分批发盯回收（只请求真实老客户）。',
    doneWhen: '评价邀约已发出（数量不承诺）。',
    toolLabel: null, toolHrefPattern: null, // 评价引擎待建（Wave 2）
  },
  {
    key: 'video_ads', phase: 'lead_engine', order: 90, track: 'nurture',
    title: '10 条视频 + 蓄水池（种草轨）',
    whatToDo: '用客户素材 AI 批量出 10 条短视频，ThruPlay 投放，蓄满 ≥1000 人受众（客户 ≥$100 预算）。',
    doneWhen: '10 条视频投放上线，池 ≥1000（客户出预算前提下）。',
    toolLabel: 'Reels Studio', toolHrefPattern: '/dashboard/clients/:id/reels',
  },
  // ── Proof (Weeks 9–12) ───────────────────────────────────────────────────
  {
    key: 'proof_report', phase: 'proof', order: 100, track: 'all',
    title: 'Before/After 复盘报告',
    whatToDo: '用漏斗诊断复检，5 段对比开局分，出 before/after 报告交付客户。',
    doneWhen: '报告已交付；所有资产在客户自己账户。',
    toolLabel: '诊断报告', toolHrefPattern: '/dashboard/clients/:id/diagnostic/report',
  },
]

/** Resolve a step's deep-link for a given client, or null if it's external work. */
export function resolveToolHref(step: DeliveryStep, clientId: string): string | null {
  return step.toolHrefPattern ? step.toolHrefPattern.replace(':id', clientId) : null
}

/**
 * Steps that apply to a client on the given primary track. 'all' steps always
 * apply; the two lead-engine tracks (search / nurture) are mutually exclusive —
 * pass the client's primary track to drop the other track's step.
 */
export function stepsForTrack(track: 'search' | 'nurture'): DeliveryStep[] {
  return DELIVERY_STEPS
    .filter(s => s.track === 'all' || s.track === track)
    .sort((a, b) => a.order - b.order)
}
