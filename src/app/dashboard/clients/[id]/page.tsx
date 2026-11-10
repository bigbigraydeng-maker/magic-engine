'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { GenerationDrawer } from './_components/GenerationDrawer';
import { SettingsDrawer, type SettingsTab } from './_components/SettingsDrawer';
import { ZhugePriorityWidget } from './_components/ZhugePriorityWidget';
import { ZhugeDrawer } from './_components/ZhugeDrawer';
import { NextStepCard, type DiscoveryStatus, type PrescriptionStatus } from './_components/NextStepCard';
import type { ZhugeOutput } from '@/lib/zhuge/types';
import { ClientDataTab } from './_components/ClientDataTab';
import { LocaleConfirmBanner } from './_components/LocaleConfirmBanner';
import { IntelligenceSummarySection } from './_components/intelligence/IntelligenceSummarySection';
import { GoalBanner } from './_components/GoalBanner';
import { WorkLogPanel } from './_components/WorkLogPanel';
import { BrandHealthWidget } from './_components/BrandHealthWidget';
import { WorkflowProgress } from './_components/ClientWorkflowProgress';
import { ClientToolsGrid } from './_components/ClientToolsGrid';
import { ClientHomeFdeView } from './_components/fde-home/ClientHomeFdeView';
import type { Client } from './_components/client-types';
import { homeEntryVisible, type HomeEntry } from '@/lib/auth/home-entries';
import { useWorkspaceViewer } from '@/app/dashboard/workspace-viewer';

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
  const viewer = useWorkspaceViewer();
  const showEntry = (entry: HomeEntry) => homeEntryVisible(viewer, entry);

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasActiveBrief, setHasActiveBrief] = useState<boolean | null>(null);
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryStatus>('none');
  const [prescriptionStatus, setPrescriptionStatus] = useState<PrescriptionStatus>('none');
  const [prescriptionId, setPrescriptionId] = useState<string | null>(null);
  const discoveryConfirmed = discoveryStatus === 'confirmed';

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
      const [clientRes, briefRes, discoveryRes, prescriptionRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/brief?status=active`),
        fetch(`/api/clients/${clientId}/zhangqian/latest`).catch(() => null),
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
      if (prescriptionRes?.ok) {
        const pData = await prescriptionRes.json();
        const raw = pData?.prescription?.status as string | undefined;
        const id = pData?.prescription?.id;
        const valid: PrescriptionStatus[] = ['generating', 'failed', 'draft', 'approved'];
        setPrescriptionStatus(valid.includes(raw as PrescriptionStatus) ? (raw as PrescriptionStatus) : 'none');
        setPrescriptionId(typeof id === 'string' ? id : null);
      } else {
        setPrescriptionStatus('none');
        setPrescriptionId(null);
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

  const isFdeHome = viewer.role === 'admin'

  const clientDrawers = (
    <>
      <GenerationDrawer
        clientId={clientId}
        open={generationOpen}
        onClose={() => setGenerationOpen(false)}
        executionItemId={execItemId}
      />
      <ZhugeDrawer
        clientId={clientId}
        isOpen={zhugeDrawerOpen}
        onClose={() => setZhugeDrawerOpen(false)}
        onComplete={(output) => {
          setZhugeFreshOutput(output)
          setZhugeRefreshKey(k => k + 1)
        }}
      />
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false)
          const params = new URLSearchParams(searchParams?.toString() ?? '')
          let dirty = false
          if (params.has('brief')) { params.delete('brief'); dirty = true }
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
    </>
  )

  if (isFdeHome) {
    return (
      <div className="min-h-screen bg-me-ivory">
        <LocaleConfirmBanner clientId={clientId} />
        <GoalBanner clientId={clientId} />
        <ClientHomeFdeView
          client={client}
          clientId={clientId}
          discoveryStatus={discoveryStatus}
          prescriptionStatus={prescriptionStatus}
          prescriptionId={prescriptionId}
          discoveryConfirmed={discoveryConfirmed}
          showEntry={showEntry}
          hasActiveBrief={hasActiveBrief}
          onOpenSettings={() => openSettings('brief')}
          onOpenGeneration={() => setGenerationOpen(true)}
          zhugeRefreshKey={zhugeRefreshKey}
          zhugeFreshOutput={zhugeFreshOutput}
          onAskZhuge={() => setZhugeDrawerOpen(true)}
        />
        {clientDrawers}
      </div>
    )
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
        {([ ['overview', '概览'], ['data', '数据'], ['tools', '工具'], ['logs', '日志'] ] as const)
          .filter(([id]) => id !== 'logs' || showEntry('work-logs'))
          .map(([id, label]) => (
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
          {/* Workflow progress bar — 3-step overview */}
          <WorkflowProgress
            discoveryConfirmed={discoveryConfirmed}
            hasPrescription={prescriptionStatus !== 'none'}
            prescriptionId={prescriptionStatus === 'none' ? null : prescriptionId}
            clientId={clientId}
          />

          <NextStepCard
            discoveryStatus={discoveryStatus}
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
        <ClientToolsGrid
          clientId={clientId}
          client={client}
          showEntry={showEntry}
          onOpenGeneration={() => setGenerationOpen(true)}
          prescriptionStatus={prescriptionStatus}
          prescriptionId={prescriptionId}
        />
      )}

      {/* ── 日志 tab ──────────────────────────────────────────────────────────── */}
      {activeTab === 'logs' && showEntry('work-logs') && (
        <div className="max-w-2xl">
          <WorkLogPanel clientId={clientId} />
        </div>
      )}

      {clientDrawers}
    </div>
  );
}
