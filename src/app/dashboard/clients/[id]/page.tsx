'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ContentHub } from './_components/ContentHub';
import { GenerationDrawer } from './_components/GenerationDrawer';
import { SettingsDrawer, type SettingsTab } from './_components/SettingsDrawer';
import { ZhugePriorityWidget } from './_components/ZhugePriorityWidget';
import { ZhugeDrawer } from './_components/ZhugeDrawer';
import { NextStepCard, type DiscoveryStatus, type PrescriptionStatus } from './_components/NextStepCard';
import type { ClientDiscoveryRow } from '@/lib/zhangqian/types';


const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? '';

interface Client {
  id: string;
  name: string;
  domain?: string;
  created_at: string;
}

// ─── Brand Health Widget ──────────────────────────────────────────────────────

type ZhangqianStatus = 'loading' | 'none' | 'reviewing' | 'confirmed';

const HEALTH_DIMS = [
  { key: 'seo',            label: 'SEO' },
  { key: 'social',         label: '社媒' },
  { key: 'ai_visibility',  label: 'AI可见' },
  { key: 'ads',            label: '广告' },
  { key: 'competitor',     label: '竞品' },
  { key: 'reputation',     label: '口碑' },
] as const;

function scoreColor(v: number | null): string {
  if (v == null) return '#9ca3af';
  if (v >= 60) return '#16a34a';
  if (v >= 40) return '#d97706';
  return '#dc2626';
}

function RadarChart({ scores }: { scores: Record<string, number> }) {
  const cx = 110, cy = 110, maxR = 78;
  const n = HEALTH_DIMS.length;
  const angle = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt = (i: number, r: number): [number, number] => [
    cx + r * Math.cos(angle(i)),
    cy + r * Math.sin(angle(i)),
  ];

  const rings = [25, 50, 75, 100];

  const scorePoly = HEALTH_DIMS
    .map((d, i) => pt(i, ((scores[d.key] ?? 0) / 100) * maxR))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox="0 0 220 220" className="w-full" style={{ maxHeight: 190 }}>
      {rings.map(pct => {
        const pts = HEALTH_DIMS.map((_, i) => {
          const [x, y] = pt(i, (pct / 100) * maxR);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        return (
          <polygon key={pct} points={pts}
            fill={pct === 100 ? '#f9fafb' : 'none'}
            stroke="#e5e7eb" strokeWidth="0.75" />
        );
      })}
      {HEALTH_DIMS.map((_, i) => {
        const [x, y] = pt(i, maxR);
        return <line key={i} x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="#e5e7eb" strokeWidth="0.75" />;
      })}
      <polygon points={scorePoly} fill="rgba(99,102,241,0.18)" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />
      {HEALTH_DIMS.map((d, i) => {
        const [x, y] = pt(i, ((scores[d.key] ?? 0) / 100) * maxR);
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3.5" fill="#6366f1" stroke="white" strokeWidth="1.5" />;
      })}
      {HEALTH_DIMS.map((d, i) => {
        const [lx, ly] = pt(i, maxR + 19);
        const v = scores[d.key] as number | undefined ?? null;
        return (
          <g key={i}>
            <text x={lx.toFixed(1)} y={(ly - 4).toFixed(1)} textAnchor="middle" fontSize="9" fill="#4b5563" fontWeight="600">{d.label}</text>
            <text x={lx.toFixed(1)} y={(ly + 8).toFixed(1)} textAnchor="middle" fontSize="9" fill={scoreColor(v)} fontWeight="700">{v ?? '—'}</text>
          </g>
        );
      })}
    </svg>
  );
}

const CRISIS_BADGE: Record<string, { label: string; cls: string }> = {
  'TYPE_E 声誉陷阱': { label: '声誉陷阱', cls: 'bg-red-100 text-red-700 border-red-200' },
  'TYPE_D 数字缺失': { label: '数字缺失', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  'TYPE_B 社媒空洞': { label: '社媒空洞', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  'TYPE_A AI不可见': { label: 'AI不可见', cls: 'bg-purple-100 text-purple-700 border-purple-200' },
};

function BrandHealthWidget({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<ZhangqianStatus>('loading');
  const [discovery, setDiscovery] = useState<ClientDiscoveryRow | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/zhangqian/latest`, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        });
        if (res.status === 404) { setStatus('none'); return; }
        if (!res.ok) { setStatus('none'); return; }
        const data = await res.json() as { success: boolean; discovery: ClientDiscoveryRow };
        if (data.success && data.discovery) {
          setDiscovery(data.discovery);
          setStatus(data.discovery.confirmed_at ? 'confirmed' : 'reviewing');
        } else {
          setStatus('none');
        }
      } catch {
        setStatus('none');
      }
    })();
  }, [clientId]);

  // ── Loading ──
  if (status === 'loading') {
    return (
      <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-4 h-16" />
    );
  }

  // ── No discovery yet ──
  if (status === 'none') {
    return (
      <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50 p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🗺️</span>
          <div>
            <p className="text-sm font-semibold text-indigo-900">品牌健康扫描未完成</p>
            <p className="text-xs text-indigo-600">张骞发现 Agent 将自动分析品牌现状，生成诊断报告</p>
          </div>
        </div>
        <Link
          href={`/dashboard/clients/${clientId}/zhangqian`}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          启动发现 →
        </Link>
      </div>
    );
  }

  // ── Awaiting confirmation ──
  if (status === 'reviewing') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⏳</span>
          <div>
            <p className="text-sm font-semibold text-amber-900">发现报告待确认</p>
            <p className="text-xs text-amber-700">张骞已完成扫描，请核查数据后确认导入</p>
          </div>
        </div>
        <Link
          href={`/dashboard/clients/${clientId}/zhangqian`}
          className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 transition-colors"
        >
          查看 &amp; 确认 →
        </Link>
      </div>
    );
  }

  // ── Confirmed — show radar chart ──
  const diag = discovery?.payload?.diagnosis;
  const scores = diag?.scores as Record<string, number> | undefined;
  const crisisType = diag?.crisis_type ?? null;
  const crisisBadge = crisisType ? CRISIS_BADGE[crisisType] : null;

  return (
    <div className="rounded-xl border border-green-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">🩺</span>
        <p className="text-sm font-semibold text-gray-900">品牌健康快照</p>
        {crisisBadge && (
          <span className={`ml-auto text-xs font-semibold border rounded-full px-2 py-0.5 ${crisisBadge.cls}`}>
            {crisisBadge.label}
          </span>
        )}
      </div>
      {discovery?.generated_at && (
        <p className="text-xs text-gray-400 mb-3">
          发现于 {new Date(discovery.generated_at).toLocaleDateString('zh-CN', { timeZone: 'Pacific/Auckland' })}
        </p>
      )}

      {scores && <RadarChart scores={scores} />}

      {scores && (
        <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 border-t border-gray-100 pt-3">
          {HEALTH_DIMS.map(({ key, label }) => {
            const v = scores[key] as number | undefined ?? null;
            return (
              <div key={key} className="flex items-center justify-between gap-1">
                <span className="text-[11px] text-gray-400">{label}</span>
                <span className="text-[11px] font-bold tabular-nums" style={{ color: scoreColor(v) }}>
                  {v ?? '—'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── ToolCard ─────────────────────────────────────────────────────────────────

type ToolBadge = 'in_house' | 'external'

const BADGE_CONFIG: Record<ToolBadge, { icon: string; label: string; cls: string }> = {
  in_house: { icon: '🖥️', label: '系统内',  cls: 'bg-indigo-50 text-indigo-600 border-indigo-100' },
  external: { icon: '📞', label: '外部执行', cls: 'bg-amber-50  text-amber-600  border-amber-100'  },
}

function ToolCard({
  href, icon, title, desc, badge, soon,
}: {
  href?: string
  icon: string
  title: string
  desc: string
  badge: ToolBadge
  soon?: boolean
}) {
  const b = BADGE_CONFIG[badge]
  const inner = (
    <div className={`flex items-center gap-3 p-4 rounded-xl border bg-white transition-all ${
      soon
        ? 'border-dashed border-gray-200 opacity-60 cursor-not-allowed'
        : href
          ? 'border-gray-200 hover:border-indigo-300 hover:shadow-sm group cursor-pointer'
          : 'border-gray-200'
    }`}>
      <span className="text-2xl flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <span className={`text-[10px] font-medium border rounded-full px-1.5 py-0.5 leading-none ${b.cls}`}>
            {b.icon} {b.label}
          </span>
          {soon && <span className="text-[10px] bg-gray-100 text-gray-400 rounded-full px-1.5 py-0.5 leading-none">Soon</span>}
        </div>
        <p className="text-xs text-gray-500">{desc}</p>
      </div>
      {href && !soon && <span className="text-gray-300 group-hover:text-indigo-400 transition-colors flex-shrink-0">→</span>}
    </div>
  )
  if (href && !soon) return <Link href={href}>{inner}</Link>
  return inner
}

// ─── Workflow Progress ────────────────────────────────────────────────────────

function WorkflowProgress({
  discoveryConfirmed,
  hasCompletedDiagnostic,
  hasPrescription,
  clientId,
}: {
  discoveryConfirmed: boolean
  hasCompletedDiagnostic: boolean
  hasPrescription: boolean
  clientId: string
}) {
  const steps = [
    {
      label: '品牌扫描',
      sublabel: '张骞',
      done: discoveryConfirmed,
      href: `/dashboard/clients/${clientId}/zhangqian`,
    },
    {
      label: '深度诊断',
      sublabel: '华佗',
      done: hasCompletedDiagnostic,
      href: `/dashboard/clients/${clientId}/diagnostic`,
    },
    {
      label: '处方制定',
      sublabel: '诸葛亮',
      done: hasPrescription,
      href: `/dashboard/clients/${clientId}/prescription/new`,
    },
    {
      label: '执行追踪',
      sublabel: '鲁班',
      done: false,
      href: `/dashboard/clients/${clientId}/execution`,
    },
  ]

  const firstPending = steps.findIndex(s => !s.done)

  return (
    <div className="flex items-center gap-0 bg-white border border-gray-200 rounded-xl px-5 py-3">
      {steps.map((step, i) => {
        const isActive = i === firstPending
        const isDone   = step.done
        const inner = (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
            isActive ? 'bg-indigo-50' : ''
          }`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
              isDone  ? 'bg-green-500 text-white'
              : isActive ? 'bg-indigo-600 text-white'
              : 'bg-gray-200 text-gray-400'
            }`}>
              {isDone ? '✓' : i + 1}
            </div>
            <div>
              <p className={`text-xs font-semibold leading-none ${
                isDone ? 'text-green-700' : isActive ? 'text-indigo-700' : 'text-gray-400'
              }`}>{step.label}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{step.sublabel}</p>
            </div>
          </div>
        )
        return (
          <div key={step.label} className="flex items-center">
            {step.href && !isDone
              ? <a href={step.href}>{inner}</a>
              : inner
            }
            {i < steps.length - 1 && (
              <div className={`w-8 h-px mx-1 flex-shrink-0 ${
                steps[i].done ? 'bg-green-300' : 'bg-gray-200'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const clientId = params.id as string;

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasActiveBrief, setHasActiveBrief] = useState<boolean | null>(null);
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryStatus>('none');
  const [hasCompletedDiagnostic, setHasCompletedDiagnostic] = useState<boolean>(false);
  const [prescriptionStatus, setPrescriptionStatus] = useState<PrescriptionStatus>('none');
  // Derived shorthands
  const discoveryConfirmed = discoveryStatus === 'confirmed';
  const huatuoDone = hasCompletedDiagnostic || prescriptionStatus !== 'none';

  // ?exec=<itemId> 来自执行看板的「在社媒矩阵中执行」跳转：
  // 自动打开 GenerationDrawer 并把生成的内容关联回该执行项（内容飞轮闭环）
  const execItemId = searchParams.get('exec');
  const [generationOpen, setGenerationOpen] = useState(Boolean(execItemId));
  // ?brief=1 (from 张骞 confirm) auto-opens the brief settings drawer
  const [settingsOpen, setSettingsOpen] = useState(searchParams.get('brief') === '1');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('brief');
  const [zhugeDrawerOpen, setZhugeDrawerOpen] = useState(false);
  const [zhugeRefreshKey, setZhugeRefreshKey] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, briefRes, discoveryRes, diagnosticRes, prescriptionRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/brief?status=active`),
        fetch(`/api/clients/${clientId}/zhangqian/latest`, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        }).catch(() => null),
        fetch(`/api/clients/${clientId}/diagnostic/latest`, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        }).catch(() => null),
        fetch(`/api/clients/${clientId}/prescriptions/latest-draft`, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        }).catch(() => null),
      ]);
      if (clientRes.ok) {
        const { client: c } = await clientRes.json();
        setClient(c);
      }
      if (briefRes.ok) {
        const { brief } = await briefRes.json();
        setHasActiveBrief(Boolean(brief));
      } else {
        setHasActiveBrief(false);
      }
      // discovery status: none / reviewing / confirmed
      if (discoveryRes?.ok) {
        const data = await discoveryRes.json();
        setDiscoveryStatus(data?.discovery?.confirmed_at ? 'confirmed' : 'reviewing');
      } else {
        setDiscoveryStatus('none');
      }
      setHasCompletedDiagnostic(diagnosticRes?.ok ?? false);
      // prescription status: granular
      if (prescriptionRes?.ok) {
        const pData = await prescriptionRes.json();
        const raw = pData?.prescription?.status as string | undefined;
        const valid: PrescriptionStatus[] = ['generating', 'failed', 'draft', 'approved'];
        setPrescriptionStatus(valid.includes(raw as PrescriptionStatus) ? (raw as PrescriptionStatus) : 'none');
      } else {
        setPrescriptionStatus('none');
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openSettings = (tab: SettingsTab = 'brief') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-4 bg-gray-200 rounded w-64" />
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Client not found.</p>
        <Link href="/dashboard/clients" className="text-indigo-600 hover:underline text-sm mt-2 block">
          ← Back to clients
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard/clients" className="text-gray-400 hover:text-gray-600 text-sm">
          ← Clients
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
        {client.domain && (
          <a
            href={`https://${client.domain}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-indigo-500 hover:text-indigo-700 font-mono"
          >
            {client.domain} ↗
          </a>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => openSettings('brief')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-lg transition-colors"
          >
            ⚙️ 设置
          </button>
          <button
            onClick={() => setGenerationOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            🚀 生成内容
          </button>
        </div>
      </div>

      {/* Workflow progress bar — 3-step overview */}
      <WorkflowProgress
        discoveryConfirmed={discoveryConfirmed}
        hasCompletedDiagnostic={hasCompletedDiagnostic}
        hasPrescription={prescriptionStatus !== 'none'}
        clientId={clientId}
      />

      {/* Dynamic next-step guidance — always shows one clear action */}
      <NextStepCard
        discoveryStatus={discoveryStatus}
        hasCompletedDiagnostic={hasCompletedDiagnostic}
        prescriptionStatus={prescriptionStatus}
        clientId={clientId}
      />

      {/* Brand Health (left) + Zhuge Priority Actions (right) — side-by-side cards */}
      {discoveryStatus === 'confirmed' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 items-start">
          <BrandHealthWidget clientId={clientId} />
          <ZhugePriorityWidget
            clientId={clientId}
            discoveryConfirmed={discoveryConfirmed}
            refreshKey={zhugeRefreshKey}
            onAskZhuge={() => setZhugeDrawerOpen(true)}
          />
        </div>
      ) : (
        <ZhugePriorityWidget
          clientId={clientId}
          discoveryConfirmed={discoveryConfirmed}
          refreshKey={zhugeRefreshKey}
          onAskZhuge={() => setZhugeDrawerOpen(true)}
        />
      )}

      {/* Master Brief warning banner */}
      {hasActiveBrief === false && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-lg">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">尚未配置 Master Brief</p>
            <p className="text-xs text-amber-800">
              请先上传品牌文件并生成 Master Brief，才能开始内容生产。
            </p>
          </div>
          <button
            onClick={() => openSettings('brief')}
            className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline whitespace-nowrap"
          >
            配置 Master Brief →
          </button>
        </div>
      )}

      {/* ── 推广活动（Campaign 基座）──────────────────────────────────────────
          Master Brief × Campaign = FDE 工作的上下文基座。
          所有内容生产（社媒/博客/广告）应当在某个活跃 Campaign 下进行。 */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">推广活动</p>
        <ContentHub clientId={clientId} />
      </section>

      {/* ── Zone A: 内容生产 ─────────────────────────────────────────────────── */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">内容生产</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <ToolCard href={`/dashboard/clients/${clientId}/marketing-plan`} icon="📋" title="Marketing Plan" desc="AI 生成营销计划 → 派发任务到鲁班"   badge="in_house" />
          <ToolCard href={`/dashboard/clients/${clientId}/blog`}           icon="📝" title="博客"           desc="双信号博客生产与管理"            badge="in_house" />
          <ToolCard href={`/dashboard/content?client=${clientId}`}         icon="📱" title="社媒矩阵"       desc="Campaign · 排期 · 多平台发布"    badge="in_house" />
          <ToolCard href={`/dashboard/geo-composer/${clientId}`}           icon="🌐" title="GEO Composer"  desc="部署 AI 搜索优化指令"            badge="in_house" />
          <ToolCard href={`/dashboard/ai-visibility/${clientId}`}          icon="🤖" title="AI 可见度追踪" desc="监控 AI 搜索中的品牌曝光"         badge="in_house" />
          <ToolCard href={`/dashboard/clients/${clientId}/connectors`}     icon="🔗" title="广告连接器"    desc="连接 Meta · Google 广告账户"      badge="in_house" />
          <ToolCard href={`/dashboard/visuals?client=${clientId}`}         icon="🚀" title="Launch Hub"    desc="Reels · 图片 · 视频素材生产"      badge="in_house" />
          <ToolCard href={`/dashboard/clients/${clientId}/production`}     icon="📦" title="内容生产包"    desc="查看各维度内容包状态 · 生成内容后自动归集" badge="in_house" />
        </div>
      </section>

      {/* ── Zone B: 诊断与分析 ───────────────────────────────────────────────── */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">诊断与分析</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <ToolCard href={`/dashboard/clients/${clientId}/zhangqian`}          icon="🗺️" title="张骞发现"       desc="扫描社媒、评价、关键词、竞品，生成品牌现状全景报告"  badge="in_house" />
          <ToolCard href={`/dashboard/clients/${clientId}/diagnostic`}         icon="🩺" title="华佗深度诊断"   desc="从 SEO/社媒/口碑/广告/AI可见/竞品六维打分，找到核心病灶"  badge="in_house" />
          <ToolCard href={`/dashboard/clients/${clientId}/prescription/new`}   icon="💊" title="华佗处方"       desc="基于诊断结果，生成优先级排序的具体执行行动路线图"  badge="in_house" />
          <ToolCard href={`/dashboard/clients/${clientId}/site-audit/pages`}   icon="🔍" title="站点审计"       desc="逐页检查标题/描述/H1/图片ALT等 SEO 技术项，输出修复清单"  badge="in_house" />
          <ToolCard href={`/dashboard/clients/${clientId}/seo-gap`}            icon="📊" title="SEO Gap 分析"   desc="对比竞品，找出客户未覆盖但流量大的关键词机会"  badge="in_house" />
          <ToolCard                                                             icon="⭐" title="口碑管理"       desc="Google 评价 · 公众号舆情"        badge="external" soon />
          <ToolCard                                                             icon="🏆" title="竞品追踪"       desc="持续监控竞品动态"                 badge="external" soon />
        </div>
      </section>

      {/* ── Zone C: SEO 工具 ──────────────────────────────────────────────────── */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">SEO 工具</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ToolCard href={`/dashboard/clients/${clientId}/strategy`}           icon="🎯" title="内容策略"        desc="根据关键词机会和竞品数据，制定博客选题与内容发布计划"  badge="in_house" />
          <ToolCard href={`/dashboard/clients/${clientId}/seo-intelligence`}   icon="📈" title="SEO Intelligence" desc="关键词排名 · 流量趋势 · 竞品对比 · Untapped 词挖掘"    badge="in_house" />
        </div>
      </section>

      {/* Generation drawer */}
      <GenerationDrawer
        clientId={clientId}
        open={generationOpen}
        onClose={() => setGenerationOpen(false)}
        executionItemId={execItemId}
      />

      {/* Zhuge AI drawer — real-time conduct + Luban trigger */}
      <ZhugeDrawer
        clientId={clientId}
        isOpen={zhugeDrawerOpen}
        onClose={() => setZhugeDrawerOpen(false)}
        onComplete={() => setZhugeRefreshKey(k => k + 1)}
      />

      {/* Settings drawer */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        clientId={clientId}
        client={client}
        activeTab={settingsTab}
        onTabChange={setSettingsTab}
      />
    </div>
  );
}
