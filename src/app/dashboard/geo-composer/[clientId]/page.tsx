'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { DirectiveEditor } from './_components/DirectiveEditor';
import { SnippetPreview } from './_components/SnippetPreview';
import type { GeoDirective, GeoScenario, GeoAudienceSignals } from '@/types/magic-engine';

interface Client {
  id: string;
  name: string;
  domain?: string;
}

const STATUS_COLORS: Record<string, string> = {
  active:   'bg-green-100 text-green-700',
  draft:    'bg-amber-100 text-amber-700',
  archived: 'bg-gray-100 text-gray-500',
};

/**
 * /dashboard/geo-composer/[clientId]
 * Main GEO Composer page: generate, edit, and activate GEO directives.
 * Reference: ROADMAP.md P7.2.11–P7.2.18, ARCHITECTURE.md §11.6
 */
export default function GeoComposerPage() {
  const params = useParams();
  const clientId = params.clientId as string;

  const [client, setClient] = useState<Client | null>(null);
  const [directives, setDirectives] = useState<GeoDirective[]>([]);
  const [selected, setSelected] = useState<GeoDirective | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMasterBrief, setHasMasterBrief] = useState<boolean | null>(null);

  // Editor state (tracks edits to selected directive)
  const [primaryRecommendation, setPrimaryRecommendation] = useState('');
  const [scenarios, setScenarios] = useState<GeoScenario[]>([]);
  const [audienceSignals, setAudienceSignals] = useState<GeoAudienceSignals>({});
  const [competitivePositioning, setCompetitivePositioning] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  // Action states
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [actionOk, setActionOk] = useState<boolean | null>(null);

  const flashMsg = (msg: string, ok: boolean) => {
    setActionMsg(msg);
    setActionOk(ok);
    setTimeout(() => { setActionMsg(''); setActionOk(null); }, 6000);
  };

  // Load initial data
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, geoRes, briefRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`, { cache: 'no-store' }),
        fetch(`/api/clients/${clientId}/geo`, { cache: 'no-store' }),
        fetch(`/api/clients/${clientId}/brief?status=active`, { cache: 'no-store' }),
      ]);
      if (clientRes.ok) {
        const j = await clientRes.json();
        setClient(j.client ?? null);
      }
      if (geoRes.ok) {
        const j = await geoRes.json();
        const list: GeoDirective[] = j.directives ?? [];
        setDirectives(list);
        // Auto-select: active first, then latest draft
        const toSelect = list.find(d => d.status === 'active') ?? list[0] ?? null;
        if (toSelect) loadDirective(toSelect);
      }
      if (briefRes.ok) {
        const j = await briefRes.json();
        setHasMasterBrief(!!(j.brief));
      } else {
        setHasMasterBrief(false);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const loadDirective = (d: GeoDirective) => {
    setSelected(d);
    setPrimaryRecommendation(d.primary_recommendation);
    setScenarios(d.scenarios ?? []);
    setAudienceSignals(d.audience_signals ?? {});
    setCompetitivePositioning(d.competitive_positioning ?? '');
    setIsDirty(false);
  };

  const handleEditorChange = (fields: {
    primaryRecommendation: string;
    scenarios: GeoScenario[];
    audienceSignals: GeoAudienceSignals;
    competitivePositioning: string;
  }) => {
    setPrimaryRecommendation(fields.primaryRecommendation);
    setScenarios(fields.scenarios);
    setAudienceSignals(fields.audienceSignals);
    setCompetitivePositioning(fields.competitivePositioning);
    setIsDirty(true);
  };

  // Generate from AI Tracker + Brief
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/geo/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ use_tracker: true }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? 'Generation failed');
      await fetchAll();
      flashMsg(`✓ Draft v${j.directive.version} generated ($${j.cost_usd?.toFixed(4) ?? '?'})`, true);
    } catch (err: unknown) {
      flashMsg(err instanceof Error ? err.message : 'Generation failed', false);
    } finally {
      setGenerating(false);
    }
  };

  // Save edits
  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/geo/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary_recommendation: primaryRecommendation,
          scenarios,
          audience_signals: audienceSignals,
          competitive_positioning: competitivePositioning,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? 'Save failed');
      setIsDirty(false);
      flashMsg('✓ Saved', true);
      await fetchAll();
    } catch (err: unknown) {
      flashMsg(err instanceof Error ? err.message : 'Save failed', false);
    } finally {
      setSaving(false);
    }
  };

  // Activate directive
  const handleActivate = async () => {
    if (!selected) return;
    setActivating(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/geo/${selected.id}/activate`, {
        method: 'POST',
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? 'Activation failed');
      flashMsg('✓ Directive activated — it is now the live version', true);
      await fetchAll();
    } catch (err: unknown) {
      flashMsg(err instanceof Error ? err.message : 'Activation failed', false);
    } finally {
      setActivating(false);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="grid grid-cols-2 gap-6">
            <div className="h-96 bg-gray-200 rounded-xl" />
            <div className="h-96 bg-gray-200 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  const activeDirective = directives.find(d => d.status === 'active');
  const isReadOnly = selected?.status === 'archived';

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/dashboard/geo-composer" className="text-gray-400 hover:text-gray-600 text-sm flex-shrink-0">
          ← GEO Composer
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">{client?.name ?? clientId}</h1>
        {client?.domain && (
          <a href={`https://${client.domain}`} target="_blank" rel="noreferrer"
            className="text-xs text-indigo-500 hover:text-indigo-700 font-mono">
            {client.domain} ↗
          </a>
        )}
      </div>

      {/* Master Brief warning */}
      {hasMasterBrief === false && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-700">
          <span>⚠</span>
          <span>
            此客户尚未创建 Master Brief，生成内容质量会受影响。
            建议先完成{' '}
            <Link href={`/dashboard/clients/${clientId}/strategy`} className="underline font-medium">
              Master Brief
            </Link>{' '}
            再生成 GEO 指令。
          </span>
        </div>
      )}

      {/* Status strip */}
      <div className="flex items-center gap-3 flex-wrap">
        {activeDirective ? (
          <div className="flex items-center gap-2">
            <span className="text-sm bg-green-50 text-green-700 border border-green-200 px-3 py-1.5 rounded-full font-medium">
              ✓ Active: Directive v{activeDirective.version} · {(activeDirective.deployed_pages ?? []).length} page{(activeDirective.deployed_pages ?? []).length !== 1 ? 's' : ''} deployed
            </span>
            <Link
              href={`/dashboard/geo-composer/${clientId}/deploy`}
              className="text-sm font-medium px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
            >
              部署 Snippet →
            </Link>
          </div>
        ) : (
          <span className="text-sm bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-full font-medium">
            ⚠ 尚无 active 指令 — 在下方生成并激活
          </span>
        )}

        {/* Action message */}
        {actionMsg && (
          <span className={`text-sm font-medium ${actionOk ? 'text-green-600' : 'text-red-600'}`}>
            {actionMsg}
          </span>
        )}

        {directives.length > 0 && (
          <div className="ml-auto">
            <button
              onClick={handleGenerate}
              disabled={generating}
              title="基于最新 AI Tracker 数据重新生成"
              className="text-sm font-medium px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg transition-colors flex items-center gap-1.5"
            >
              {generating ? '⏳ 生成中…' : '✨ 重新生成'}
            </button>
          </div>
        )}
      </div>

      {/* Version selector */}
      {directives.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Version:</span>
          {directives.map(d => (
            <button
              key={d.id}
              onClick={() => loadDirective(d)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                selected?.id === d.id
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300'
              }`}
            >
              v{d.version}
              <span className={`ml-1.5 px-1.5 py-0.5 rounded text-xs ${STATUS_COLORS[d.status]}`}>
                {d.status}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {directives.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-6 text-sm text-amber-700 flex flex-col items-start gap-3">
          <p>
            <strong>还没有任何 GEO 指令。</strong>点击下方按钮，从客户的 Master Brief 和 AI 可见度数据自动生成第一条 GEO 指令。
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-sm font-medium px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg transition-colors flex items-center gap-1.5"
          >
            {generating ? '⏳ 生成中…' : '✨ 生成 GEO 指令'}
          </button>
        </div>
      )}

      {/* Two-column editor */}
      {selected && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left: editor */}
            <div>
              {isReadOnly && (
                <div className="mb-3 text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  This directive is archived. Select a draft or active version to edit.
                </div>
              )}
              <DirectiveEditor
                primaryRecommendation={primaryRecommendation}
                scenarios={scenarios}
                audienceSignals={audienceSignals}
                competitivePositioning={competitivePositioning}
                onChange={handleEditorChange}
                readOnly={isReadOnly}
              />
            </div>

            {/* Right: live preview */}
            <div className="lg:sticky lg:top-6">
              <SnippetPreview
                primaryRecommendation={primaryRecommendation}
                scenarios={scenarios}
                audienceSignals={audienceSignals}
                competitivePositioning={competitivePositioning}
              />
            </div>
          </div>

          {/* Bottom action bar */}
          {!isReadOnly && (
            <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-5 py-4">
              <p className="text-sm text-gray-500">
                v{selected.version} ·{' '}
                <span className={`font-medium px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[selected.status]}`}>
                  {selected.status}
                </span>
                {isDirty && <span className="ml-2 text-amber-600 text-xs">Unsaved changes</span>}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving || !isDirty}
                  className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-40 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save Draft'}
                </button>
                {selected.status !== 'active' && (
                  <button
                    onClick={handleActivate}
                    disabled={activating || isDirty}
                    title={isDirty ? 'Save your changes first' : 'Activate this directive'}
                    className="px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-lg transition-colors"
                  >
                    {activating ? 'Activating…' : '⚡ Activate'}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
