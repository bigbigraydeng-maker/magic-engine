'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  MePanel,
  MePill,
  MeButton,
  MeChip,
  MeMeter,
  MeTrend,
  MeStatCard,
} from '@/components/ui/me-primitives';
import { GOLD_GRADIENT, cx } from '@/components/ui/me-theme';

interface Client {
  id: string;
  name: string;
  domain?: string;
}

interface Keyword {
  id: string;
  keyword: string;
  volume?: number;
  kd?: number;
  cpc?: number;
  intent?: string;
  opportunity_score?: number;
  status: string;
  source: string;
  created_at: string;
}

type Intent = 'transactional' | 'commercial' | 'informational' | 'navigational' | 'unknown';
type FilterKey = 'all' | 'opportunities' | 'gaps' | 'ranking-up';

// Tabs labels
const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all',         label: 'All' },
  { key: 'opportunities', label: 'Opportunities' },
  { key: 'gaps',        label: 'Gaps' },
  { key: 'ranking-up',  label: 'Ranking up' },
];

const STATUS_TONE: Record<string, 'track' | 'exec' | 'attn' | 'sched' | 'rej'> = {
  new:          'exec',
  approved:     'track',
  rejected:     'rej',
  reviewed:     'exec',
  published:    'sched',
  page_created: 'sched',
};

function normaliseIntent(raw?: string): Intent {
  const v = (raw ?? '').toLowerCase();
  if (v.includes('transact')) return 'transactional';
  if (v.includes('commerc')) return 'commercial';
  if (v.includes('inform'))  return 'informational';
  if (v.includes('navig'))   return 'navigational';
  return 'unknown';
}

function intentChip(raw?: string) {
  const intent = normaliseIntent(raw);
  const label =
    intent === 'transactional' ? 'Transactional' :
    intent === 'commercial'    ? 'Commercial'   :
    intent === 'informational' ? 'Informational':
    intent === 'navigational'  ? 'Navigational' : '—';
  // Gold-chip the highest-intent commercial signal (transactional)
  return <MeChip gold={intent === 'transactional'}>{label}</MeChip>;
}

// Use SEMrush AU/NZ database tag (us/au/nz). Falls back to NZ for unknowns.
function marketLabel(source?: string): 'NZ' | 'AU' | 'GLOBAL' {
  const s = (source ?? '').toLowerCase();
  if (s.includes('au') && !s.includes('aus')) return 'AU';
  if (s.includes('aus')) return 'AU';
  if (s.includes('nz')) return 'NZ';
  return 'NZ';
}

export default function KeywordsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedIntent, setSelectedIntent] = useState('');
  const [filterTab, setFilterTab] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  // Fetch modal state
  const [showFetchModal, setShowFetchModal] = useState(false);
  const [fetchClient, setFetchClient] = useState('');
  const [domain, setDomain] = useState('');
  const [seedKeywords, setSeedKeywords] = useState('');
  const [mode, setMode] = useState<'related' | 'gap' | 'domain'>('related');
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [fetchSuccess, setFetchSuccess] = useState('');

  // Optimistic status updates
  const [pendingStatus, setPendingStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(d => {
      const list: Client[] = d.clients ?? [];
      setClients(list);
      if (list.length > 0) {
        setFetchClient(list[0].id);
        setDomain(list[0].domain?.replace(/^https?:\/\//, '') ?? '');
      }
    });
  }, []);

  // Auto-fill domain when fetch-modal client changes
  useEffect(() => {
    const client = clients.find(c => c.id === fetchClient);
    if (client?.domain) {
      setDomain(client.domain.replace(/^https?:\/\//, ''));
    }
  }, [fetchClient, clients]);

  const fetchKeywords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedClient) params.set('client_id', selectedClient);
      if (selectedStatus) params.set('status', selectedStatus);
      if (selectedIntent) params.set('intent', selectedIntent);
      const res = await fetch(`/api/keywords?${params}`);
      const json = await res.json();
      setKeywords(json.keywords ?? []);
    } finally {
      setLoading(false);
    }
  }, [selectedClient, selectedStatus, selectedIntent]);

  useEffect(() => {
    fetchKeywords();
  }, [fetchKeywords]);

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    setFetching(true);
    setFetchError('');
    setFetchSuccess('');

    try {
      const endpoint = mode === 'related'
        ? '/api/keyword-intelligence/related-keywords'
        : mode === 'gap'
          ? '/api/keyword-intelligence/keyword-gap'
          : '/api/keyword-intelligence/keyword-overview';

      const body = mode === 'related'
        ? { seed_keyword: seedKeywords.split('\n')[0].trim(), client_id: fetchClient }
        : mode === 'gap'
          ? { client_domain: domain, competitor_domains: seedKeywords.split('\n').filter(Boolean), client_id: fetchClient }
          : { keywords: seedKeywords.split('\n').filter(Boolean), client_id: fetchClient };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      setFetchSuccess(`Fetched ${json.saved_count ?? json.data?.length ?? 0} keywords`);
      await fetchKeywords();
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setFetching(false);
    }
  };

  const handleStatusUpdate = async (kwId: string, newStatus: 'approved' | 'rejected') => {
    setPendingStatus(prev => ({ ...prev, [kwId]: newStatus }));
    try {
      await fetch(`/api/keywords/${kwId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
    } finally {
      setPendingStatus(prev => {
        const next = { ...prev };
        delete next[kwId];
        return next;
      });
      fetchKeywords();
    }
  };

  // Filter pipeline: tab filter > search > sort by opportunity_score
  const displayedKeywords = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = [...keywords];
    if (term) {
      list = list.filter(kw => kw.keyword.toLowerCase().includes(term));
    }
    if (filterTab === 'opportunities') {
      // High opportunity_score and not yet acted on
      list = list.filter(kw =>
        (kw.opportunity_score ?? 0) >= 60 && kw.status === 'new'
      );
    } else if (filterTab === 'gaps') {
      // Gap source — flagged from keyword-gap API
      list = list.filter(kw => /gap/i.test(kw.source));
    } else if (filterTab === 'ranking-up') {
      // Approved or published — already moving up the funnel
      list = list.filter(kw =>
        kw.status === 'approved' || kw.status === 'published' || kw.status === 'page_created'
      );
    }
    return list.sort(
      (a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0)
    );
  }, [keywords, filterTab, search]);

  // Aggregate stats for the 4 stat cards
  const stats = useMemo(() => {
    const tracked = keywords.length;
    const topRanked = keywords.filter(kw =>
      kw.status === 'published' || kw.status === 'page_created'
    ).length;
    const gaps = keywords.filter(kw => /gap/i.test(kw.source)).length;
    const totalVolume = keywords.reduce((s, kw) => s + (kw.volume ?? 0), 0);
    const volumeLabel =
      totalVolume >= 1000
        ? `${(totalVolume / 1000).toFixed(1)}k`
        : String(totalVolume);
    return { tracked, topRanked, gaps, volumeLabel };
  }, [keywords]);

  // Tab counts
  const tabCounts: Record<FilterKey, number> = useMemo(() => ({
    all: keywords.length,
    opportunities: keywords.filter(kw => (kw.opportunity_score ?? 0) >= 60 && kw.status === 'new').length,
    gaps: keywords.filter(kw => /gap/i.test(kw.source)).length,
    'ranking-up': keywords.filter(kw =>
      kw.status === 'approved' || kw.status === 'published' || kw.status === 'page_created'
    ).length,
  }), [keywords]);

  const selectedClientLabel = clients.find(c => c.id === selectedClient)?.name ?? 'All clients';

  return (
    <div className="font-sans">
      {/* Topbar */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-me-charcoal">
            Keywords
          </h1>
          <p className="mt-[3px] text-[13px] text-black/55">
            AU/NZ keyword intelligence, gaps and rank tracking
          </p>
        </div>
        {/* Client picker (right) */}
        <label className="inline-flex items-center gap-2.5 rounded-xl border border-black/10 bg-white px-3.5 py-2 text-[13px] shadow-[0_1px_2px_rgba(26,26,26,.04)]">
          <span
            className="grid h-7 w-7 place-items-center rounded-md font-display text-[11px] font-bold text-[#2A2008]"
            style={{ background: GOLD_GRADIENT }}
          >
            {selectedClient
              ? (clients.find(c => c.id === selectedClient)?.name?.[0]?.toUpperCase() ?? 'C')
              : 'A'}
          </span>
          <select
            value={selectedClient}
            onChange={e => setSelectedClient(e.target.value)}
            aria-label="Client"
            className="bg-transparent text-me-charcoal outline-none font-medium pr-1"
          >
            <option value="">All clients</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </header>

      <div className="px-8 py-7 space-y-6">
        {/* Stat cards row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MeStatCard
            value={stats.tracked}
            label="Keywords tracked"
            tone="ochre"
            footer={<span className="text-black/40">AU / NZ databases · {selectedClientLabel}</span>}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]">
                <circle cx="7.5" cy="14.5" r="4.5" />
                <path d="m11 11 7-7M15 4h4v4" />
              </svg>
            }
          />
          <MeStatCard
            value={stats.topRanked}
            label="Top-10 published"
            tone="track"
            footer={
              <MeTrend dir={stats.topRanked > 0 ? 'up' : 'flat'}>
                {stats.topRanked > 0 ? `+${stats.topRanked} this cycle` : 'No movement'}
              </MeTrend>
            }
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[18px] w-[18px]">
                <path d="M3 17l5-5 4 3 6-7" />
                <path d="M3 21h18" />
              </svg>
            }
          />
          <MeStatCard
            value={stats.gaps}
            label="Content gaps"
            tone="attn"
            footer={
              stats.gaps > 0
                ? <MePill tone="attn">Opportunity</MePill>
                : <span className="text-black/40">No gaps detected</span>
            }
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]">
                <path d="M12 8v5M12 16h.01" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            }
          />
          <MeStatCard
            value={stats.volumeLabel}
            label="Monthly volume reach"
            tone="ochre"
            goldValue
            footer={<span className="text-black/40">Sum of tracked keyword volume</span>}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]">
                <path d="M4 19V5M10 19V9M16 19v-6M22 19H2" />
              </svg>
            }
          />
        </div>

        {/* Toolbar: tabs + filters + search + Fetch button */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Segmented tabs */}
          <div className="inline-flex items-center gap-1 rounded-xl border border-black/10 bg-white p-1 shadow-[0_1px_2px_rgba(26,26,26,.04)]">
            {FILTER_TABS.map(tab => {
              const active = filterTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilterTab(tab.key)}
                  className={cx(
                    'rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition',
                    active
                      ? 'bg-me-charcoal text-[#FBF8F3]'
                      : 'text-black/55 hover:bg-me-stone',
                  )}
                >
                  {tab.label}
                  <span className={cx(
                    'ml-1.5 tabular-nums',
                    active ? 'text-[#FBF8F3]/65' : 'text-black/35',
                  )}>
                    {tabCounts[tab.key]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Intent filter */}
          <select
            value={selectedIntent}
            onChange={e => setSelectedIntent(e.target.value)}
            aria-label="Intent"
            className="rounded-xl border border-black/10 bg-white px-3.5 py-2 text-[13px] font-medium text-me-charcoal shadow-[0_1px_2px_rgba(26,26,26,.04)] focus:outline-none focus:ring-2 focus:ring-me-ochre/40"
          >
            <option value="">All intents</option>
            <option value="informational">Informational</option>
            <option value="commercial">Commercial</option>
            <option value="transactional">Transactional</option>
            <option value="navigational">Navigational</option>
          </select>

          {/* Status filter */}
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            aria-label="Status"
            className="rounded-xl border border-black/10 bg-white px-3.5 py-2 text-[13px] font-medium text-me-charcoal shadow-[0_1px_2px_rgba(26,26,26,.04)] focus:outline-none focus:ring-2 focus:ring-me-ochre/40"
          >
            <option value="">All status</option>
            <option value="new">New</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="published">Published</option>
          </select>

          {/* Search */}
          <label className="flex flex-1 min-w-[220px] items-center gap-2 rounded-xl border border-black/10 bg-white px-3.5 py-2 text-[13px] shadow-[0_1px_2px_rgba(26,26,26,.04)] focus-within:border-me-ochre/50">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-black/40">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3-3" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter keywords…"
              className="flex-1 bg-transparent text-me-charcoal outline-none placeholder:text-black/35"
            />
          </label>

          <MeButton size="sm" onClick={() => setShowFetchModal(true)}>
            Fetch keywords
          </MeButton>
        </div>

        {/* Main table */}
        <MePanel className="p-0">
          {loading ? (
            <div className="py-14 text-center text-[13px] text-black/40">Loading keywords…</div>
          ) : displayedKeywords.length === 0 ? (
            <div className="space-y-3 py-14 text-center">
              <p className="text-[13.5px] text-black/55">
                {keywords.length === 0
                  ? 'No keywords yet.'
                  : 'No keywords match these filters.'}
              </p>
              {keywords.length === 0 ? (
                <MeButton size="sm" onClick={() => setShowFetchModal(true)}>
                  Fetch your first batch →
                </MeButton>
              ) : (
                <button
                  type="button"
                  onClick={() => { setFilterTab('all'); setSearch(''); setSelectedStatus(''); setSelectedIntent(''); }}
                  className="text-[13px] font-semibold text-me-ochre hover:underline"
                >
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse">
                <thead className="sticky top-0 z-10 bg-me-ivory">
                  <tr>
                    <th className="whitespace-nowrap border-b border-black/10 px-5 pb-3 pt-3.5 text-left text-[11px] font-semibold uppercase tracking-[.1em] text-black/40">Keyword</th>
                    <th className="whitespace-nowrap border-b border-black/10 px-5 pb-3 pt-3.5 text-left text-[11px] font-semibold uppercase tracking-[.1em] text-black/40">Intent</th>
                    <th className="whitespace-nowrap border-b border-black/10 px-5 pb-3 pt-3.5 text-left text-[11px] font-semibold uppercase tracking-[.1em] text-black/40">Market</th>
                    <th className="whitespace-nowrap border-b border-black/10 px-5 pb-3 pt-3.5 text-right text-[11px] font-semibold uppercase tracking-[.1em] text-black/40">Volume</th>
                    <th className="whitespace-nowrap border-b border-black/10 px-5 pb-3 pt-3.5 text-left text-[11px] font-semibold uppercase tracking-[.1em] text-black/40">Difficulty</th>
                    <th className="whitespace-nowrap border-b border-black/10 px-5 pb-3 pt-3.5 text-right text-[11px] font-semibold uppercase tracking-[.1em] text-black/40">Opportunity</th>
                    <th className="whitespace-nowrap border-b border-black/10 px-5 pb-3 pt-3.5 text-left text-[11px] font-semibold uppercase tracking-[.1em] text-black/40">Status</th>
                    <th className="whitespace-nowrap border-b border-black/10 px-5 pb-3 pt-3.5 text-right text-[11px] font-semibold uppercase tracking-[.1em] text-black/40">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedKeywords.map(kw => {
                    const currentStatus = pendingStatus[kw.id] ?? kw.status;
                    const tone = STATUS_TONE[currentStatus] ?? 'attn';
                    const oppScore = kw.opportunity_score;
                    const oppDir: 'up' | 'down' | 'flat' =
                      oppScore == null ? 'flat'
                        : oppScore >= 60 ? 'up'
                          : oppScore >= 30 ? 'flat' : 'down';
                    return (
                      <tr key={kw.id} className="transition-colors hover:bg-[#FBF8F3]">
                        <td className="border-b border-black/[.06] px-5 py-[15px] align-middle text-sm font-semibold text-me-charcoal">
                          {kw.keyword}
                        </td>
                        <td className="border-b border-black/[.06] px-5 py-[15px] align-middle">
                          {intentChip(kw.intent)}
                        </td>
                        <td className="border-b border-black/[.06] px-5 py-[15px] align-middle text-sm text-black/55">
                          {marketLabel(kw.source)}
                        </td>
                        <td className="border-b border-black/[.06] px-5 py-[15px] align-middle text-right font-mono text-sm tabular-nums text-me-charcoal/85">
                          {kw.volume?.toLocaleString() ?? '—'}
                        </td>
                        <td className="border-b border-black/[.06] px-5 py-[15px] align-middle">
                          {typeof kw.kd === 'number'
                            ? <MeMeter value={Math.max(0, Math.min(100, Math.round(kw.kd)))} />
                            : <span className="text-sm text-black/35">—</span>}
                        </td>
                        <td className="border-b border-black/[.06] px-5 py-[15px] align-middle text-right">
                          {oppScore != null
                            ? <MeTrend dir={oppDir}>{oppScore}</MeTrend>
                            : <span className="text-sm text-black/35">—</span>}
                        </td>
                        <td className="border-b border-black/[.06] px-5 py-[15px] align-middle">
                          <MePill tone={tone}>{currentStatus}</MePill>
                        </td>
                        <td className="border-b border-black/[.06] px-5 py-[15px] align-middle">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleStatusUpdate(kw.id, 'approved')}
                              disabled={currentStatus === 'approved'}
                              className="rounded-md border border-[#5C8A4A]/30 bg-[#5C8A4A]/10 px-2.5 py-1 text-[12px] font-semibold text-[#5C8A4A] transition hover:bg-[#5C8A4A]/15 disabled:cursor-not-allowed disabled:opacity-40"
                              title="Approve"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStatusUpdate(kw.id, 'rejected')}
                              disabled={currentStatus === 'rejected'}
                              className="rounded-md border border-[#C2453A]/30 bg-[#C2453A]/10 px-2.5 py-1 text-[12px] font-semibold text-[#C2453A] transition hover:bg-[#C2453A]/15 disabled:cursor-not-allowed disabled:opacity-40"
                              title="Reject"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </MePanel>
      </div>

      {/* Fetch keywords modal */}
      {showFetchModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => !fetching && setShowFetchModal(false)}
        >
          <div
            className="w-full max-w-[560px] max-h-[88vh] overflow-auto rounded-[20px] bg-white shadow-[0_18px_60px_rgba(0,0,0,.25)]"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-black/10 bg-white px-6 py-5">
              <div>
                <h3 className="font-display text-[18px] font-semibold text-me-charcoal">
                  Fetch keywords
                </h3>
                <p className="mt-1 text-[13px] text-black/55">
                  Pull fresh AU/NZ keyword data from Keyword Intelligence.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !fetching && setShowFetchModal(false)}
                disabled={fetching}
                className="grid h-8 w-8 place-items-center rounded-lg border border-black/10 text-black/55 transition hover:bg-me-stone disabled:opacity-50"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleFetch} className="space-y-5 px-6 py-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-black/45">
                    Client
                  </label>
                  <select
                    value={fetchClient}
                    onChange={e => setFetchClient(e.target.value)}
                    className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-[13px] text-me-charcoal focus:outline-none focus:ring-2 focus:ring-me-ochre/40"
                  >
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-black/45">
                    Domain
                  </label>
                  <input
                    value={domain}
                    onChange={e => setDomain(e.target.value)}
                    placeholder="ctstours.co.nz"
                    className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-[13px] text-me-charcoal placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-me-ochre/40"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[.08em] text-black/45">
                  Mode
                </label>
                <div className="inline-flex w-full rounded-xl border border-black/10 bg-me-ivory p-1">
                  {(['related', 'gap', 'domain'] as const).map(m => {
                    const active = mode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={cx(
                          'flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold capitalize transition',
                          active
                            ? 'bg-me-charcoal text-[#FBF8F3]'
                            : 'text-black/55 hover:text-me-charcoal',
                        )}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-black/45">
                  {mode === 'related'
                    ? 'Seed keyword'
                    : mode === 'gap'
                      ? 'Competitor domains (one per line)'
                      : 'Keywords (one per line)'}
                </label>
                <textarea
                  rows={3}
                  value={seedKeywords}
                  onChange={e => setSeedKeywords(e.target.value)}
                  placeholder={mode === 'related'
                    ? 'New Zealand tours'
                    : mode === 'gap'
                      ? 'competitor1.com\ncompetitor2.com'
                      : 'keyword 1\nkeyword 2'}
                  className="w-full resize-none rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-[13px] text-me-charcoal placeholder:text-black/35 focus:outline-none focus:ring-2 focus:ring-me-ochre/40"
                />
              </div>

              {fetchError && (
                <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-[#902F26]">
                  {fetchError}
                </div>
              )}
              {fetchSuccess && (
                <div className="rounded-xl border border-[#5C8A4A]/30 bg-[#5C8A4A]/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-[#3E6233]">
                  {fetchSuccess}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-black/[.06] pt-4">
                <MeButton
                  size="sm"
                  variant="ghost"
                  onClick={() => !fetching && setShowFetchModal(false)}
                  type="button"
                  disabled={fetching}
                >
                  Cancel
                </MeButton>
                <MeButton size="sm" type="submit" disabled={fetching}>
                  {fetching ? 'Fetching…' : 'Fetch'}
                </MeButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
