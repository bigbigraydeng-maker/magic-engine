'use client';

import { useState, useEffect, useCallback } from 'react';

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

const statusColors: Record<string, string> = {
  new: 'bg-me-ochre/10 text-me-ochre',
  approved: 'bg-[#5C8A4A]/12 text-[#5C8A4A]',
  rejected: 'bg-[#C2453A]/10 text-[#C2453A]',
  reviewed: 'bg-me-ochre/10 text-me-ochre',
  published: 'bg-me-ivory text-me-charcoal/60',
  page_created: 'bg-me-ochre/10 text-me-ochre',
};

export default function KeywordsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedIntent, setSelectedIntent] = useState('');

  // Keyword fetch panel
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
      const list = d.clients ?? [];
      setClients(list);
      if (list.length > 0) {
        setFetchClient(list[0].id);
        setDomain(list[0].domain?.replace(/^https?:\/\//, '') ?? '');
      }
    });
  }, []);

  // Auto-fill domain when client changes
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
        ? '/api/semrush/related-keywords'
        : mode === 'gap'
          ? '/api/semrush/keyword-gap'
          : '/api/semrush/keyword-overview';

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
      setFetchSuccess(`✓ Fetched ${json.saved_count ?? json.data?.length ?? 0} keywords`);
      await fetchKeywords();
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setFetching(false);
    }
  };

  const handleStatusUpdate = async (kwId: string, newStatus: 'approved' | 'rejected') => {
    // Optimistic update
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

  const displayedKeywords = [...keywords].sort(
    (a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0)
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal/90">关键词情报</h1>
        <p className="text-sm text-me-charcoal/55 mt-1">SEO keyword library — discover, approve & track keywords across clients</p>
      </div>

      {/* Keyword Fetch Panel */}
      <div className="bg-white rounded-xl border border-black/10 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-me-charcoal/90">🔍 关键词抓取</h2>
        </div>
        <form onSubmit={handleFetch} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-me-charcoal/60 mb-1">Client</label>
              <select
                value={fetchClient}
                onChange={(e) => setFetchClient(e.target.value)}
                className="w-full border border-black/15 rounded-lg px-3 py-2 text-sm text-me-charcoal/90 placeholder:text-me-charcoal/45 bg-white focus:outline-none focus:ring-2 focus:ring-me-ochre"
              >
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-me-charcoal/60 mb-1">Domain</label>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full border border-black/15 rounded-lg px-3 py-2 text-sm text-me-charcoal/90 placeholder:text-me-charcoal/45 bg-white focus:outline-none focus:ring-2 focus:ring-me-ochre"
                placeholder="ctstours.co.nz"
              />
            </div>
          </div>

          {/* Mode */}
          <div>
            <label className="block text-xs font-medium text-me-charcoal/60 mb-2">Mode</label>
            <div className="flex gap-4">
              {(['related', 'gap', 'domain'] as const).map((m) => (
                <label key={m} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    value={m}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                    className="text-me-ochre focus:ring-me-ochre"
                  />
                  <span className="text-sm text-me-charcoal/75 capitalize">{m}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-me-charcoal/60 mb-1">
              {mode === 'related' ? 'Seed Keyword' : mode === 'gap' ? 'Competitor Domains (one per line)' : 'Keywords (one per line)'}
            </label>
            <textarea
              rows={3}
              value={seedKeywords}
              onChange={(e) => setSeedKeywords(e.target.value)}
              className="w-full border border-black/15 rounded-lg px-3 py-2 text-sm text-me-charcoal/90 placeholder:text-me-charcoal/45 bg-white focus:outline-none focus:ring-2 focus:ring-me-ochre resize-none"
              placeholder={mode === 'related' ? 'New Zealand tours' : mode === 'gap' ? 'competitor1.com\ncompetitor2.com' : 'keyword 1\nkeyword 2'}
            />
          </div>

          {fetchError && <p className="text-sm text-[#C2453A]">{fetchError}</p>}
          {fetchSuccess && <p className="text-sm text-[#5C8A4A]">{fetchSuccess}</p>}

          <button
            type="submit"
            disabled={fetching}
            className="bg-me-ochre hover:bg-me-ochre text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {fetching ? (
              <><span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" /> Fetching...</>
            ) : 'Fetch Keywords'}
          </button>
        </form>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <select
          value={selectedClient}
          onChange={(e) => setSelectedClient(e.target.value)}
          className="border border-black/15 rounded-lg px-3 py-2 text-sm text-me-charcoal/90 bg-white focus:outline-none focus:ring-2 focus:ring-me-ochre"
        >
          <option value="">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="border border-black/15 rounded-lg px-3 py-2 text-sm text-me-charcoal/90 bg-white focus:outline-none focus:ring-2 focus:ring-me-ochre"
        >
          <option value="">All Status</option>
          <option value="new">New</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="published">Published</option>
        </select>
        <select
          value={selectedIntent}
          onChange={(e) => setSelectedIntent(e.target.value)}
          className="border border-black/15 rounded-lg px-3 py-2 text-sm text-me-charcoal/90 bg-white focus:outline-none focus:ring-2 focus:ring-me-ochre"
        >
          <option value="">All Intent</option>
          <option value="informational">Informational</option>
          <option value="commercial">Commercial</option>
          <option value="transactional">Transactional</option>
          <option value="navigational">Navigational</option>
        </select>
        <span className="text-sm text-me-charcoal/45">{displayedKeywords.length} keywords</span>
      </div>

      {/* Keywords Table */}
      <div className="bg-white rounded-xl border border-black/10 overflow-x-auto">
        {loading ? (
          <div className="py-12 text-center text-me-charcoal/45 text-sm">Loading...</div>
        ) : displayedKeywords.length === 0 ? (
          <div className="py-12 text-center text-me-charcoal/45 text-sm">No keywords found. Use the keyword fetch panel above to get started.</div>
        ) : (
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="bg-me-ivory border-b border-black/[.06]">
                <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase">Keyword</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase">Volume</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase">KD</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase">CPC</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase">Intent</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase">Score</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[.06]">
              {displayedKeywords.map((kw) => {
                const currentStatus = pendingStatus[kw.id] ?? kw.status;
                return (
                  <tr key={kw.id} className="hover:bg-me-ivory transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-me-charcoal/90">{kw.keyword}</td>
                    <td className="px-4 py-3 text-sm text-me-charcoal/60 text-right">{kw.volume?.toLocaleString() ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-me-charcoal/60 text-right">{kw.kd ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-me-charcoal/60 text-right">{kw.cpc ? `$${kw.cpc.toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-3 text-sm text-me-charcoal/55 capitalize">{kw.intent ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-bold text-me-ochre">{kw.opportunity_score ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[currentStatus] ?? 'bg-me-ivory text-me-charcoal/60'}`}>
                        {currentStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleStatusUpdate(kw.id, 'approved')}
                          disabled={currentStatus === 'approved'}
                          className="text-xs px-2 py-1 bg-[#5C8A4A]/10 text-[#5C8A4A] rounded hover:bg-[#5C8A4A]/12 disabled:opacity-40 font-medium"
                          title="Approve"
                        >
                          ✅
                        </button>
                        <button
                          onClick={() => handleStatusUpdate(kw.id, 'rejected')}
                          disabled={currentStatus === 'rejected'}
                          className="text-xs px-2 py-1 bg-[#C2453A]/10 text-[#C2453A] rounded hover:bg-[#C2453A]/10 disabled:opacity-40 font-medium"
                          title="Reject"
                        >
                          ❌
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
