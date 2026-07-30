'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ContentHub } from './_components/ContentHub';
import { GenerationDrawer } from './_components/GenerationDrawer';
import { SettingsDrawer, type SettingsTab } from './_components/SettingsDrawer';
import { ZhugePriorityWidget } from './_components/ZhugePriorityWidget';
import { ZhugeDrawer } from './_components/ZhugeDrawer';
import { NextStepCard, type DiscoveryStatus, type PrescriptionStatus } from './_components/NextStepCard';
import type { ClientDiscoveryRow } from '@/lib/zhangqian/types';
import type { ZhugeOutput } from '@/lib/zhuge/types';
import { ClientDataTab } from './_components/ClientDataTab';
import { LocaleConfirmBanner } from './_components/LocaleConfirmBanner';
import { IntelligenceSummarySection } from './_components/intelligence/IntelligenceSummarySection';
import { BriefGateBanner } from './_components/BriefGateBanner';
import { GoalBanner } from './_components/GoalBanner';
import { WorkLogPanel } from './_components/WorkLogPanel';
import { ReviewInbox } from '../../factory/_components/ReviewInbox';


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
  if (v == null) return '#B7B1A5';
  if (v >= 60) return '#5C8A4A';
  if (v >= 40) return '#C4912E';
  return '#C2453A';
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
    .map((d, i) => {
      const s = scores[d.key];
      return s != null ? pt(i, (s / 100) * maxR) : null;
    })
    .filter((p): p is [number, number] => p !== null)
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
            fill={pct === 100 ? '#FBF8F3' : 'none'}
            stroke="#EAE6DF" strokeWidth="0.75" />
        );
      })}
      {HEALTH_DIMS.map((_, i) => {
        const [x, y] = pt(i, maxR);
        return <line key={i} x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="#EAE6DF" strokeWidth="0.75" />;
      })}
      <polygon points={scorePoly} fill="rgba(196,145,46,0.18)" stroke="#C4912E" strokeWidth="2" strokeLinejoin="round" />
      {HEALTH_DIMS.map((d, i) => {
        const s = scores[d.key];
        if (s == null) return null;
        const [x, y] = pt(i, (s / 100) * maxR);
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3.5" fill="#C4912E" stroke="white" strokeWidth="1.5" />;
      })}
      {HEALTH_DIMS.map((d, i) => {
        const [lx, ly] = pt(i, maxR + 19);
        const v = scores[d.key] as number | undefined ?? null;
        return (
          <g key={i}>
            <text x={lx.toFixed(1)} y={(ly - 4).toFixed(1)} textAnchor="middle" fontSize="9" fill="#1A1A1A" fontWeight="600">{d.label}</text>
            <text x={lx.toFixed(1)} y={(ly + 8).toFixed(1)} textAnchor="middle" fontSize="9" fill={scoreColor(v)} fontWeight="700">{v ?? '—'}</text>
          </g>
        );
      })}
    </svg>
  );
}

const CRISIS_BADGE: Record<string, { label: string; cls: string }> = {
  'TYPE_E 声誉陷阱': { label: '声誉陷阱', cls: 'bg-[#C2453A]/12 text-[#C2453A] border-[#C2453A]/30' },
  'TYPE_D 数字缺失': { label: '数字缺失', cls: 'bg-me-ochre/15 text-me-ochre border-me-ochre/30' },
  'TYPE_B 社媒空洞': { label: '社媒空洞', cls: 'bg-me-gold/30 text-me-ochre border-me-ochre/30' },
  'TYPE_A AI不可见': { label: 'AI不可见', cls: 'bg-[#3E6E8C]/12 text-[#3E6E8C] border-[#3E6E8C]/30' },
};

function BrandHealthWidget({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<ZhangqianStatus>('loading');
  const [discovery, setDiscovery] = useState<ClientDiscoveryRow | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/zhangqian/latest`);
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
      <div className="h-32 animate-pulse rounded-xl border border-black/10 bg-white p-4" />
    );
  }

  // ── No discovery yet ──
  if (status === 'none') {
    return (
      <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-me-ochre/30 bg-me-ochre/10 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-me-charcoal text-xs font-black text-white">DI</span>
          <div>
            <p className="text-sm font-black text-me-charcoal">品牌健康扫描未完成</p>
            <p className="text-xs font-semibold text-me-charcoal/55">张骞发现 Agent 将自动分析品牌现状，生成诊断报告</p>
          </div>
        </div>
        <Link
          href={`/dashboard/clients/${clientId}/zhangqian`}
          className="shrink-0 rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white transition-colors hover:bg-me-charcoal/85"
        >
          启动发现 →
        </Link>
      </div>
    );
  }

  // ── Awaiting confirmation ──
  if (status === 'reviewing') {
    return (
      <div className="flex items-center justify-between gap-4 rounded-xl border border-me-ochre/30 bg-me-ochre/10 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-me-ochre/15 text-xs font-black text-me-ochre">QA</span>
          <div>
            <p className="text-sm font-black text-me-charcoal">发现报告待确认</p>
            <p className="text-xs font-semibold text-me-ochre">张骞已完成扫描，请核查数据后确认导入</p>
          </div>
        </div>
        <Link
          href={`/dashboard/clients/${clientId}/zhangqian`}
          className="shrink-0 rounded-lg bg-me-ochre px-4 py-2 text-sm font-black text-white transition-colors hover:bg-me-ochre/90"
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
    <div className="rounded-xl border border-me-ochre/30 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-me-ochre/10 text-xs font-black text-me-ochre">BH</span>
        <p className="text-sm font-black text-me-charcoal">品牌健康快照</p>
        {crisisBadge && (
          <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs font-bold ${crisisBadge.cls}`}>
            {crisisBadge.label}
          </span>
        )}
      </div>
      {discovery?.generated_at && (
        <p className="mb-3 text-xs font-semibold text-me-charcoal/45">
          发现于 {new Date(discovery.generated_at).toLocaleDateString('zh-CN', { timeZone: 'Pacific/Auckland' })}
        </p>
      )}

      {scores && <RadarChart scores={scores} />}

      {scores && (
        <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 border-t border-black/[.06] pt-3">
          {HEALTH_DIMS.map(({ key, label }) => {
            const v = scores[key] as number | undefined ?? null;
            return (
              <div key={key} className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold text-me-charcoal/45">{label}</span>
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

const BADGE_CONFIG: Record<ToolBadge, { label: string; cls: string }> = {
  in_house: { label: '系统内',  cls: 'bg-me-ochre/10 text-me-ochre border-me-ochre/20' },
  external: { label: '外部执行', cls: 'bg-me-ochre/10 text-me-ochre border-me-ochre/20'  },
}

function ToolCard({
  href, onClick, title, desc, badge, soon,
}: {
  href?: string
  onClick?: () => void
  title: string
  desc: string
  badge: ToolBadge
  soon?: boolean
}) {
  const b = BADGE_CONFIG[badge]
  const interactive = !soon && (!!href || !!onClick)
  const inner = (
    <div className={`flex items-center gap-3 rounded-xl border bg-white p-4 transition-all ${
      soon
        ? 'cursor-not-allowed border-dashed border-black/10 opacity-60'
        : interactive
          ? 'group cursor-pointer border-black/10 hover:border-me-ochre/40 hover:shadow-sm'
          : 'border-black/10'
    }`}>
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-me-charcoal text-[11px] font-black text-white">
        {title.slice(0, 2).toUpperCase()}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-black text-me-charcoal">{title}</p>
          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none ${b.cls}`}>
            {b.label}
          </span>
          {soon && <span className="rounded-full bg-me-ivory px-1.5 py-0.5 text-[10px] font-bold leading-none text-me-charcoal/45">Soon</span>}
        </div>
        <p className="text-xs font-semibold text-me-charcoal/55">{desc}</p>
      </div>
      {interactive && <span className="flex-shrink-0 text-me-charcoal/35 transition-colors group-hover:text-me-ochre">→</span>}
    </div>
  )
  if (href && !soon) return <Link href={href}>{inner}</Link>
  if (onClick && !soon) return <button className="w-full text-left" onClick={onClick}>{inner}</button>
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
    <div className="overflow-x-auto rounded-xl border border-black/10 bg-white px-4 py-4 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-0">
      {steps.map((step, i) => {
        const isActive = i === firstPending
        const isDone   = step.done
        const inner = (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
            isActive ? 'bg-me-ochre/10' : ''
          }`}>
            <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-black ${
              isDone  ? 'bg-[#5C8A4A] text-white'
              : isActive ? 'bg-me-charcoal text-white'
              : 'bg-me-ivory text-me-charcoal/45'
            }`}>
              {isDone ? '✓' : i + 1}
            </div>
            <div>
              <p className={`text-xs font-black leading-none ${
                isDone ? 'text-[#5C8A4A]' : isActive ? 'text-me-charcoal' : 'text-me-charcoal/45'
              }`}>{step.label}</p>
              <p className="mt-0.5 text-[10px] font-semibold text-me-charcoal/45">{step.sublabel}</p>
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
                steps[i].done ? 'bg-[#5C8A4A]/70' : 'bg-me-stone'
              }`} />
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// Valid SettingsTab keys (must match SettingsDrawer's exported union).
// Used to validate ?settings=<tab> URL parameters.
const VALID_SETTINGS_TABS: ReadonlyArray<SettingsTab> = ['brief', 'client-info', 'cms', 'users', 'platform']

export default function ClientDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
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
  const [activeTab, setActiveTab] = useState<'overview' | 'data' | 'tools' | 'logs'>('overview');

  const execItemId = searchParams.get('exec');
  const [generationOpen, setGenerationOpen] = useState(Boolean(execItemId));
  // Open the settings drawer via URL:
  //   ?brief=1               → opens with the "brief" tab (张骞 confirm flow)
  //   ?settings=<tab-id>     → opens with the given tab (e.g. ?settings=cms
  //                             from the GEO deploy page's "connect website" link)
  // We compute initial state in the useState initializer (runs once on mount).
  const initialSettingsTab = ((): SettingsTab => {
    const raw = searchParams.get('settings')
    if (raw && (VALID_SETTINGS_TABS as readonly string[]).includes(raw)) {
      return raw as SettingsTab
    }
    return 'brief'
  })()
  const [settingsOpen, setSettingsOpen] = useState(
    searchParams.get('brief') === '1' || searchParams.get('settings') !== null,
  );
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(initialSettingsTab);
  const [zhugeDrawerOpen, setZhugeDrawerOpen] = useState(false);
  const [zhugeRefreshKey, setZhugeRefreshKey] = useState(0);
  const [zhugeFreshOutput, setZhugeFreshOutput] = useState<ZhugeOutput | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, briefRes, discoveryRes, diagnosticRes, prescriptionRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/brief?status=active`),
        fetch(`/api/clients/${clientId}/zhangqian/latest`).catch(() => null),
        fetch(`/api/clients/${clientId}/diagnostic/latest`).catch(() => null),
        fetch(`/api/clients/${clientId}/prescriptions/latest-draft`).catch(() => null),
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
          <div className="h-8 bg-me-stone rounded w-48" />
          <div className="h-4 bg-me-stone rounded w-64" />
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-6">
        <p className="text-me-charcoal/55">Client not found.</p>
        <Link href="/dashboard/clients" className="text-me-ochre hover:underline text-sm mt-2 block">
          ← Back to clients
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-5 bg-[#f6f7f2] px-4 py-5 md:px-6">
      {/* Locale confirmation banner — shown until client confirms */}
      <LocaleConfirmBanner clientId={clientId} />

      {/* Phase 31 Beta: Active Goal banner */}
      <GoalBanner clientId={clientId} />

      {/* Page header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Link href="/dashboard/clients" className="text-sm font-semibold text-me-charcoal/45 hover:text-me-charcoal/75">
          ← Clients
        </Link>
        <span className="text-me-charcoal/35">/</span>
        <h1 className="font-display text-3xl font-bold tracking-tight text-me-charcoal">{client.name}</h1>
        {client.domain && (
          <a
            href={`https://${client.domain}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-me-ochre/20 bg-me-ochre/10 px-2 py-1 font-mono text-xs font-bold text-me-ochre hover:border-me-ochre/30"
          >
            {client.domain}
          </a>
        )}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <button
            onClick={() => openSettings('brief')}
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-4 text-sm font-black text-me-charcoal/75 transition-colors hover:border-black/15 hover:text-me-charcoal"
          >
            设置
          </button>
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-xl border border-black/10 bg-white p-1">
        {([ ['overview', '概览'], ['data', '数据'], ['tools', '工具'], ['logs', '日志'] ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 rounded-lg py-2 text-sm font-black transition-colors ${
              activeTab === id
                ? 'bg-me-charcoal text-white'
                : 'text-me-charcoal/55 hover:bg-me-ivory hover:text-me-charcoal/90'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── 概览 tab ──────────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <>
          {/* 内容工厂待审 — 有成片等你拍板时冒出来(spec me-native-design v0.2) */}
          <ReviewInbox clientId={clientId} hideWhenEmpty />

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
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[320px_1fr]">
              <BrandHealthWidget clientId={clientId} />
              <ZhugePriorityWidget
                clientId={clientId}
                discoveryConfirmed={discoveryConfirmed}
                refreshKey={zhugeRefreshKey}
                freshOutput={zhugeFreshOutput}
                onAskZhuge={() => setZhugeDrawerOpen(true)}
              />
            </div>
          ) : (
            <ZhugePriorityWidget
              clientId={clientId}
              discoveryConfirmed={discoveryConfirmed}
              refreshKey={zhugeRefreshKey}
              freshOutput={zhugeFreshOutput}
              onAskZhuge={() => setZhugeDrawerOpen(true)}
            />
          )}

          {/* Data Intelligence — 7 trend cards + insights */}
          <IntelligenceSummarySection clientId={clientId} variant="full" />

          {/* Master Brief warning banner */}
          {hasActiveBrief === false && (
            <div className="flex items-start gap-3 rounded-xl border border-me-ochre/30 bg-me-ochre/10 px-4 py-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-me-ochre" />
              <div className="flex-1">
                <p className="text-sm font-black text-me-charcoal">尚未配置 Master Brief</p>
                <p className="text-xs font-semibold text-me-ochre">
                  请先上传品牌文件并生成 Master Brief，才能开始内容生产。
                </p>
              </div>
              <button
                onClick={() => openSettings('brief')}
                className="whitespace-nowrap text-xs font-black text-me-ochre hover:text-me-charcoal"
              >
                配置 Master Brief →
              </button>
            </div>
          )}

          {/* ── 推广活动（Campaign 基座）──────────────────────────────────────────
              Master Brief × Campaign = FDE 工作的上下文基座。
              所有内容生产（社媒/博客/广告）应当在某个活跃 Campaign 下进行。 */}
          <BriefGateBanner clientId={clientId} featureLabel="workspace production entry points">
            <section>
              <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-me-ochre">推广活动</p>
              <ContentHub clientId={clientId} />
            </section>
          </BriefGateBanner>
        </>
      )}

      {/* ── 数据 tab ──────────────────────────────────────────────────────────── */}
      {activeTab === 'data' && (
        <div className="max-w-4xl mx-auto">
          <ClientDataTab clientId={clientId} />
        </div>
      )}

      {/* ── 工具 tab ──────────────────────────────────────────────────────────── */}
      {activeTab === 'tools' && (
        <>
          {/* Zone A: 内容生产 */}
          <BriefGateBanner clientId={clientId} featureLabel="workspace production entry points">
            <section>
              <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-me-ochre">内容生产</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <ToolCard href={`/dashboard/clients/${clientId}/marketing-plan`} title="Marketing Plan" desc="AI 生成营销计划 → 派发任务到鲁班"   badge="in_house" />
                <ToolCard href={`/dashboard/clients/${clientId}/blog`}           title="博客"           desc="双信号博客生产与管理"            badge="in_house" />
                <ToolCard href={`/dashboard/content?client=${clientId}`}         title="社媒矩阵"       desc="Campaign · 排期 · 多平台发布"    badge="in_house" />
                <ToolCard href={`/dashboard/geo-composer/${clientId}`}           title="GEO Composer"  desc="部署 AI 搜索优化指令"            badge="in_house" />
                <ToolCard href={`/dashboard/ai-visibility/${clientId}`}          title="AI 可见度追踪" desc="监控 AI 搜索中的品牌曝光"         badge="in_house" />
                <ToolCard href={`/dashboard/clients/${clientId}/connectors`}     title="广告连接器"    desc="连接 Meta · Google 广告账户"      badge="in_house" />
                <ToolCard href={`/dashboard/clients/${clientId}/ads-health`}     title="广告健康"      desc="每天自动体检 · 每条广告跟自己最好一周比 · 疲劳预警" badge="in_house" />
                {/* 视频工厂此前只在内部导航(跨客户总览),客户维度没有入口 —— 跟紧邻的
                    「素材库」不一致,而且 PM 是按客户干活的。?client= 进去只看这个客户。 */}
                <ToolCard href={`/dashboard/factory?client=${clientId}`}          title="视频工厂"      desc="看片 · 拍板 · 跟 Claude 说人话改片 · 只看这个客户"  badge="in_house" />
                <ToolCard href={`/dashboard/clients/${clientId}/assets`}          title="素材库"        desc="上传图片 → Vision AI 自动分析 → Hook/Middle/CTA 评分 → 视频提示词"  badge="in_house" />
                <ToolCard href={`/dashboard/visuals?client=${clientId}`}         title="Launch Hub"    desc="Reels · 图片 · 视频素材生产"      badge="in_house" />
                <ToolCard href={`/dashboard/clients/${clientId}/production`}     title="内容生产包"    desc="查看各维度内容包状态 · 生成内容后自动归集" badge="in_house" />
                <ToolCard onClick={() => setGenerationOpen(true)}              title="生成单条内容" desc="按关键词 · 视频 · 话题快速生成一条社媒帖子"  badge="in_house" />
              </div>
            </section>
          </BriefGateBanner>

          {/* Zone A2: 经营工具
              注意：这一区不属于 DAPE 任何一段，也不对应 6 支柱 —— 它不是 ME 替客户做的
              营销动作，而是客户拿去做自己生意的工具。单独成区，别混进「内容生产」。
              不套 BriefGateBanner：Brief 是营销服务的前置，跟客户自己的日常经营无关。 */}
          <section>
            <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-me-ochre">经营工具</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <ToolCard
                href={`/dashboard/clients/${clientId}/tailor-made`}
                title="Tailor-made 行程单"
                desc="定制行程报价单：填表 → 预览 → 导出品牌 PDF 发给客户"
                badge="in_house"
              />
            </div>
          </section>

          {/* Zone B: 诊断与分析 */}
          <section>
            <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-me-ochre">诊断与分析</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* 客户消息不是"诊断",但它跟诊断一样是每天要开的页;放生产区会被
                  一堆内容工具淹掉,所以放在诊断与分析区首位 —— 销售一进客户页就看到。 */}
              {/* 销售每天第一件事就是开这一页,放在诊断区最前面。 */}
              <ToolCard href={`/dashboard/clients/${clientId}/crm`}                title="今天该联系谁"   desc="全渠道接触记录自动排序 · 说过别再联系的已挡在名单外"  badge="in_house" />
              <ToolCard href={`/dashboard/clients/${clientId}/crm/all`}            title="全部客人"       desc="一张表看全部客人 · 点开看往来记录、记一笔、改跟进阶段"  badge="in_house" />
              <ToolCard href={`/dashboard/clients/${clientId}/messenger`}          title="客户消息"       desc="Facebook 私信 · AI 写好需求卡和回复草稿 · 你按发送"  badge="in_house" />
              <ToolCard href={`/dashboard/clients/${clientId}/zhangqian`}          title="张骞发现"       desc="扫描社媒、评价、关键词、竞品，生成品牌现状全景报告"  badge="in_house" />
              <ToolCard href={`/dashboard/clients/${clientId}/diagnostic`}         title="华佗深度诊断"   desc="从 SEO/社媒/口碑/广告/AI可见/竞品六维打分，找到核心病灶"  badge="in_house" />
              <ToolCard href={`/dashboard/clients/${clientId}/prescription/new`}   title="诸葛亮处方"     desc="基于华佗诊断结果，生成优先级排序的具体执行行动路线图"  badge="in_house" />
              <ToolCard href={`/dashboard/clients/${clientId}/site-audit/pages`}   title="站点审计"       desc="逐页检查标题/描述/H1/图片ALT等 SEO 技术项，输出修复清单"  badge="in_house" />
              <ToolCard href={`/dashboard/clients/${clientId}/seo-gap`}            title="SEO Gap 分析"   desc="对比竞品，找出客户未覆盖但流量大的关键词机会"  badge="in_house" />
              <ToolCard href={`/dashboard/clients/${clientId}/memory`}             title="客户记忆库"     desc="L3 长期学习：好模式 / 失败记录 / 偏好 / 决策历史（仅 FDE）"  badge="in_house" />
              <ToolCard                                                             title="口碑管理"       desc="Google 评价 · 公众号舆情"        badge="external" soon />
              <ToolCard                                                             title="竞品追踪"       desc="持续监控竞品动态"                 badge="external" soon />
            </div>
          </section>

          {/* Zone C: SEO 工具 */}
          <section>
            <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-me-ochre">SEO 工具</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ToolCard href={`/dashboard/clients/${clientId}/strategy`}           title="内容策略"        desc="根据关键词机会和竞品数据，制定博客选题与内容发布计划"  badge="in_house" />
              <ToolCard href={`/dashboard/clients/${clientId}/seo-intelligence`}   title="SEO Intelligence" desc="关键词排名 · 流量趋势 · 竞品对比 · Untapped 词挖掘"    badge="in_house" />
            </div>
          </section>
        </>
      )}

      {/* ── 日志 tab ──────────────────────────────────────────────────────────── */}
      {activeTab === 'logs' && (
        <div className="max-w-2xl">
          <WorkLogPanel clientId={clientId} />
        </div>
      )}

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
        onComplete={(output) => {
          setZhugeFreshOutput(output)
          setZhugeRefreshKey(k => k + 1)
        }}
      />

      {/* Settings drawer.
          On close we also strip the auto-open URL params (?brief, ?settings)
          so a page refresh doesn't re-open the drawer the FDE just closed.
          Other params (e.g. ?exec) are preserved. */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false)
          const params = new URLSearchParams(searchParams?.toString() ?? '')
          let dirty = false
          if (params.has('brief'))    { params.delete('brief');    dirty = true }
          if (params.has('settings')) { params.delete('settings'); dirty = true }
          if (dirty && pathname) {
            const query = params.toString()
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
          }
        }}
        clientId={clientId}
        client={client}
        activeTab={settingsTab}
        onTabChange={setSettingsTab}
      />
    </div>
  );
}
