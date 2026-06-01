'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MasterBrief } from '@/types/magic-engine';
import { BriefSourcesForm } from './BriefSourcesForm';
import { BriefEditor } from './BriefEditor';
import { BriefChat } from './BriefChat';
import { BriefDocument } from './BriefDocument';

type ViewMode = 'edit' | 'document';

interface Props {
  clientId: string;
}

export function BriefPanel({ clientId }: Props) {
  const [brief, setBrief] = useState<MasterBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('edit');

  const fetchActiveBrief = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/brief?status=active`);
      if (res.ok) {
        const json = await res.json();
        setBrief(json.brief ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  // On initial mount also check for drafts if no active brief
  const fetchLatestBrief = useCallback(async () => {
    setLoading(true);
    try {
      // Try active first
      const activeRes = await fetch(`/api/clients/${clientId}/brief?status=active`);
      if (activeRes.ok) {
        const { brief: activeBrief } = await activeRes.json();
        if (activeBrief) {
          setBrief(activeBrief);
          return;
        }
      }
      // Fall back to latest draft
      const draftRes = await fetch(`/api/clients/${clientId}/brief?status=draft`);
      if (draftRes.ok) {
        const { brief: draftBrief } = await draftRes.json();
        if (draftBrief) setBrief(draftBrief);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchLatestBrief();
  }, [fetchLatestBrief]);

  const handleGenerated = async (briefId: string) => {
    // Fetch the newly created draft by loading all and finding it
    const res = await fetch(`/api/clients/${clientId}/brief/${briefId}`);
    if (res.ok) {
      const { brief: newBrief } = await res.json();
      setBrief(newBrief);
    }
  };

  const handleActivate = () => {
    // After activate, refresh to get updated status
    fetchActiveBrief();
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="animate-pulse text-sm font-semibold text-me-charcoal/45">Loading brief...</div>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 gap-5 print:block xl:grid-cols-[minmax(0,1.25fr)_390px]">
      {/* Left panel — full width in document mode */}
      <div className={viewMode === 'document' && brief ? 'min-w-0 xl:col-span-2' : 'min-w-0'}>
        {!brief ? (
          <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h3 className="font-display text-base font-semibold tracking-tight text-me-charcoal">Generate Master Brief</h3>
              <p className="mt-1 text-xs font-semibold text-me-charcoal/55">
                Provide brand data sources. Strategy Engine will analyze them and generate a complete brand strategy document.
              </p>
            </div>
            <BriefSourcesForm clientId={clientId} onGenerated={handleGenerated} />
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
            {/* Brief header: title + view toggle + actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[.06] px-5 py-4">
              <h3 className="font-display text-xl font-semibold tracking-tight text-me-charcoal">
                {brief.brand_name ?? 'Master Brief'}
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                {/* View mode toggle */}
                <div className="flex overflow-hidden rounded-lg border border-black/10 bg-white text-xs">
                  <button
                    onClick={() => setViewMode('edit')}
                    className={`px-4 py-2 font-black transition-colors ${
                      viewMode === 'edit'
                        ? 'bg-me-charcoal text-white'
                        : 'text-me-charcoal/55 hover:bg-me-ivory'
                    }`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setViewMode('document')}
                    className={`px-4 py-2 font-black transition-colors ${
                      viewMode === 'document'
                        ? 'bg-me-charcoal text-white'
                        : 'text-me-charcoal/55 hover:bg-me-ivory'
                    }`}
                  >
                    Document
                  </button>
                </div>
                {viewMode === 'document' && (
                  <button
                    onClick={() => window.print()}
                    className="rounded-lg border border-black/10 px-3 py-2 text-xs font-black text-me-charcoal/55 transition-colors hover:text-me-charcoal/75"
                    title="Print or save as PDF"
                  >
                    Print
                  </button>
                )}
                <button
                  onClick={() => setBrief(null)}
                  className="rounded-lg px-3 py-2 text-xs font-black text-me-charcoal/45 transition-colors hover:bg-me-ivory hover:text-me-ochre"
                  title="Generate a new brief"
                >
                  + New
                </button>
              </div>
            </div>

            {viewMode === 'edit' ? (
              <div className="p-5">
                <BriefEditor
                  brief={brief}
                  briefId={brief.id}
                  clientId={clientId}
                  onUpdated={setBrief}
                  onActivate={handleActivate}
                />
              </div>
            ) : (
              <div className="p-6 print:overflow-visible">
                <BriefDocument brief={brief} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right panel — hidden in document mode */}
      {viewMode === 'edit' && (
        <div className="min-h-[520px] rounded-xl border border-black/10 bg-white shadow-sm print:hidden xl:sticky xl:top-5 xl:h-[calc(100vh-190px)]">
          <BriefChat
            briefId={brief?.id ?? ''}
            clientId={clientId}
            disabled={!brief}
            onBriefUpdated={setBrief}
          />
        </div>
      )}
    </div>
  );
}
