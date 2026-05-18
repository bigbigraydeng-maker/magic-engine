'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ContentHub } from './_components/ContentHub';
import { GenerationDrawer } from './_components/GenerationDrawer';
import { SettingsDrawer, type SettingsTab } from './_components/SettingsDrawer';
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

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-gray-500 w-12 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[40px]">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-6 text-right tabular-nums">{value}</span>
    </div>
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

  // ── Confirmed — show mini scorecard ──
  const diag = discovery?.payload?.diagnosis;
  const scores = diag?.scores;
  const crisisType = diag?.crisis_type ?? null;
  const crisisBadge = crisisType ? CRISIS_BADGE[crisisType] : null;

  return (
    <div className="rounded-xl border border-green-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">🩺</span>
          <div>
            <p className="text-sm font-semibold text-gray-900">品牌健康快照</p>
            {discovery?.generated_at && (
              <p className="text-xs text-gray-400">
                发现于 {new Date(discovery.generated_at).toLocaleDateString('zh-CN', { timeZone: 'Pacific/Auckland' })}
              </p>
            )}
          </div>
          {crisisBadge && (
            <span className={`text-xs font-semibold border rounded-full px-2 py-0.5 ${crisisBadge.cls}`}>
              {crisisBadge.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/dashboard/clients/${clientId}/zhangqian`}
            className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:border-gray-300 transition-colors"
          >
            查看报告
          </Link>
          <Link
            href={`/dashboard/clients/${clientId}/prescription/new`}
            className="text-xs font-semibold rounded-lg bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 transition-colors"
          >
            生成处方 →
          </Link>
        </div>
      </div>

      {scores && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-2">
          <ScoreBar label="SEO" value={scores.seo}
            color={scores.seo >= 60 ? 'bg-green-400' : scores.seo >= 40 ? 'bg-yellow-400' : 'bg-red-400'} />
          <ScoreBar label="社媒" value={scores.social}
            color={scores.social >= 60 ? 'bg-green-400' : scores.social >= 40 ? 'bg-yellow-400' : 'bg-red-400'} />
          <ScoreBar label="口碑" value={scores.reputation}
            color={scores.reputation >= 60 ? 'bg-green-400' : scores.reputation >= 40 ? 'bg-yellow-400' : 'bg-red-400'} />
          <ScoreBar label="AI可见" value={scores.ai_visibility}
            color={scores.ai_visibility >= 60 ? 'bg-green-400' : scores.ai_visibility >= 40 ? 'bg-yellow-400' : 'bg-red-400'} />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const clientId = params.id as string;

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasActiveBrief, setHasActiveBrief] = useState<boolean | null>(null);

  const [generationOpen, setGenerationOpen] = useState(false);
  // ?brief=1 (from 张骞 confirm) auto-opens the brief settings drawer
  const [settingsOpen, setSettingsOpen] = useState(searchParams.get('brief') === '1');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('brief');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, briefRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/brief?status=active`),
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

      {/* Brand Health Widget — plays seeding role, links to prescription */}
      <BrandHealthWidget clientId={clientId} />

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

      {/* Content Hub — main workspace */}
      <ContentHub clientId={clientId} />

      {/* Generation drawer */}
      <GenerationDrawer
        clientId={clientId}
        open={generationOpen}
        onClose={() => setGenerationOpen(false)}
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
