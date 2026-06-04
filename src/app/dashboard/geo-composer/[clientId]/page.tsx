'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { DirectiveEditor } from './_components/DirectiveEditor';
import { SnippetPreview } from './_components/SnippetPreview';
import { ConfirmDialog } from './_components/ConfirmDialog';
import type { GeoDirective, GeoScenario, GeoAudienceSignals } from '@/types/magic-engine';

interface Client {
  id: string;
  name: string;
  domain?: string;
}

const STATUS_COLORS: Record<string, string> = {
  active:   'bg-[#5C8A4A]/12 text-[#5C8A4A]',
  draft:    'bg-me-ochre/10 text-me-ochre',
  archived: 'bg-me-ivory text-me-charcoal/55',
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
  const [showActivateConfirm, setShowActivateConfirm] = useState(false);

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

  // Activate directive — wrapped in confirm dialog because activation now
  // archives the previous active AND all other drafts in one atomic step.
  const handleActivate = async () => {
    if (!selected) return;
    setShowActivateConfirm(false);
    setActivating(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/geo/${selected.id}/activate`, {
        method: 'POST',
      });
      const j = await res.json() as {
        success: boolean
        error?: string
        drafts_archived?: number
      };
      if (!res.ok || !j.success) throw new Error(j.error ?? 'Activation failed');
      const archivedCount = j.drafts_archived ?? 0;
      const suffix = archivedCount > 0
        ? `（已自动归档 ${archivedCount} 个草稿）`
        : '';
      flashMsg(`✓ Directive activated — it is now the live version${suffix}`, true);
      await fetchAll();
    } catch (err: unknown) {
      flashMsg(err instanceof Error ? err.message : 'Activation failed', false);
    } finally {
      setActivating(false);
    }
  };

  // Other drafts that will be archived when the selected one is activated.
  // Excludes the selected one itself, the current active, and already-archived rows.
  const otherDraftsCount = selected
    ? directives.filter(d => d.id !== selected.id && d.status === 'draft').length
    : 0;

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-me-stone rounded w-64" />
          <div className="grid grid-cols-2 gap-6">
            <div className="h-96 bg-me-stone rounded-xl" />
            <div className="h-96 bg-me-stone rounded-xl" />
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
        <Link href={`/dashboard/clients/${clientId}`} className="text-me-charcoal/45 hover:text-me-charcoal/60 text-sm flex-shrink-0">
          ← 返回客户
        </Link>
        <span className="text-me-charcoal/35">/</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal/90">{client?.name ?? clientId}</h1>
        {client?.domain && (
          <a href={`https://${client.domain}`} target="_blank" rel="noreferrer"
            className="text-xs text-me-ochre hover:text-me-ochre font-mono">
            {client.domain} ↗
          </a>
        )}
      </div>

      {/* Master Brief warning */}
      {hasMasterBrief === false && (
        <div className="flex items-center gap-2 bg-me-ochre/10 border border-me-ochre/30 rounded-lg px-4 py-2.5 text-sm text-me-ochre">
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
            <span className="text-sm bg-[#5C8A4A]/10 text-[#5C8A4A] border border-[#5C8A4A]/30 px-3 py-1.5 rounded-full font-medium">
              ✓ Active: Directive v{activeDirective.version} · {(activeDirective.deployed_pages ?? []).length} page{(activeDirective.deployed_pages ?? []).length !== 1 ? 's' : ''} deployed
            </span>
            <Link
              href={`/dashboard/geo-composer/${clientId}/deploy`}
              className="text-sm font-medium px-3 py-1.5 bg-[#5C8A4A] hover:bg-[#5C8A4A] text-white rounded-lg transition-colors"
            >
              部署 Snippet →
            </Link>
          </div>
        ) : (
          <span className="text-sm bg-me-ochre/10 text-me-ochre border border-me-ochre/30 px-3 py-1.5 rounded-full font-medium">
            ⚠ 尚无 active 指令 — 在下方生成并激活
          </span>
        )}

        {/* Action message */}
        {actionMsg && (
          <span className={`text-sm font-medium ${actionOk ? 'text-[#5C8A4A]' : 'text-[#C2453A]'}`}>
            {actionMsg}
          </span>
        )}

        <div className="ml-auto">
          <button
            onClick={handleGenerate}
            disabled={generating}
            title={directives.length === 0 ? '基于 AI Tracker 弱点 + Master Brief 生成指令' : '基于最新 AI Tracker 数据重新生成'}
            className="text-sm font-medium px-4 py-2 bg-me-ochre hover:bg-me-ochre disabled:bg-me-ochre/70 text-white rounded-lg transition-colors flex items-center gap-1.5"
          >
            {generating ? '⏳ 生成中…' : directives.length === 0 ? '✨ 生成 GEO 指令' : '✨ 重新生成'}
          </button>
        </div>
      </div>

      {/* Version selector */}
      {directives.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-me-charcoal/55">Version:</span>
          {directives.map(d => (
            <button
              key={d.id}
              onClick={() => loadDirective(d)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                selected?.id === d.id
                  ? 'bg-me-ochre text-white border-me-ochre'
                  : 'bg-white border-black/10 text-me-charcoal/60 hover:border-me-ochre/50'
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
        <div className="bg-me-ochre/10 border border-me-ochre/30 rounded-xl px-5 py-6 text-sm text-me-ochre">
          <strong>No directives yet.</strong> Click <strong>✨ Regenerate from AI Tracker</strong> to generate your first GEO directive automatically from the client&apos;s Brief and AI Visibility data.
        </div>
      )}

      {/* Two-column editor */}
      {selected && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left: editor */}
            <div>
              {isReadOnly && (
                <div className="mb-3 text-xs text-me-charcoal/45 bg-me-ivory border border-black/10 rounded-lg px-3 py-2">
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
            <div className="flex items-center justify-between bg-white border border-black/10 rounded-xl px-5 py-4">
              <p className="text-sm text-me-charcoal/55">
                v{selected.version} ·{' '}
                <span className={`font-medium px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[selected.status]}`}>
                  {selected.status}
                </span>
                {isDirty && <span className="ml-2 text-me-ochre text-xs">Unsaved changes</span>}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving || !isDirty}
                  className="px-4 py-2 text-sm font-medium border border-black/15 rounded-lg text-me-charcoal/75 hover:border-me-ochre/50 hover:text-me-ochre disabled:opacity-40 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save Draft'}
                </button>
                {selected.status !== 'active' && (
                  <button
                    onClick={() => setShowActivateConfirm(true)}
                    disabled={activating || isDirty}
                    title={isDirty ? 'Save your changes first' : 'Activate this directive'}
                    className="px-4 py-2 text-sm font-medium bg-[#5C8A4A] hover:bg-[#5C8A4A] disabled:bg-[#5C8A4A]/70 text-white rounded-lg transition-colors"
                  >
                    {activating ? 'Activating…' : '⚡ Activate'}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Activation confirm — tells the FDE that activating this version will
          also archive any other drafts for the same client (the previous
          active is always archived; this dialog surfaces the draft side-effect
          which is new behaviour and would otherwise be silent). */}
      <ConfirmDialog
        isOpen={showActivateConfirm}
        title="Activate this directive?"
        message={
          selected
            ? (otherDraftsCount > 0
                ? `Activating v${selected.version} will: (1) make it the live GEO directive for this client, (2) archive the current active version (if any), and (3) archive ${otherDraftsCount} other draft${otherDraftsCount === 1 ? '' : 's'}. Archived directives stay viewable in the version history but cannot be edited.`
                : `Activating v${selected.version} will make it the live GEO directive for this client. Any previously-active version will be moved to the archive (still viewable from the version history).`)
            : ''
        }
        confirmLabel="Activate"
        cancelLabel="Cancel"
        onConfirm={handleActivate}
        onCancel={() => setShowActivateConfirm(false)}
        loading={activating}
      />
    </div>
  );
}
