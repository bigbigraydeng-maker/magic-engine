'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { BriefPanel } from './_components/BriefPanel';
import { CampaignPanel } from './_components/CampaignPanel';
import { GenerationDrawer } from './_components/GenerationDrawer';
import { ReelsStudio } from './_components/ReelsStudio';
import { SiteAuditPanel } from './_components/SiteAuditPanel';

interface Client {
  id: string;
  name: string;
  domain?: string;
  airtable_base_id?: string;
  airtable_content_table_id?: string;
  airtable_keywords_table_id?: string;
  airtable_embed_social?: string;
  airtable_embed_keywords?: string;
  airtable_embed_seo?: string;
  created_at: string;
}

interface ContentPost {
  id: string;
  title: string;
  status: string;
  route: string;
  created_at: string;
}

type Tab = 'overview' | 'airtable' | 'brief' | 'campaigns' | 'reels' | 'site-audit';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  scheduled: 'bg-blue-100 text-blue-800',
  published: 'bg-gray-100 text-gray-700',
  rejected: 'bg-red-100 text-red-800',
};

export default function ClientDetailPage() {
  const params = useParams();
  const clientId = params.id as string;

  const [client, setClient] = useState<Client | null>(null);
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('brief');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [airtableConfig, setAirtableConfig] = useState({
    airtable_base_id: '',
    airtable_content_table_id: '',
    airtable_keywords_table_id: '',
    airtable_embed_social: '',
    airtable_embed_keywords: '',
    airtable_embed_seo: '',
  });
  const [savingAirtable, setSavingAirtable] = useState(false);
  const [airtableMsg, setAirtableMsg] = useState('');
  const [hasActiveBrief, setHasActiveBrief] = useState<boolean | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, postsRes, briefRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/posts`),
        fetch(`/api/clients/${clientId}/brief?status=active`),
      ]);
      if (clientRes.ok) {
        const { client: c } = await clientRes.json();
        setClient(c);
        setAirtableConfig({
          airtable_base_id: c.airtable_base_id ?? '',
          airtable_content_table_id: c.airtable_content_table_id ?? '',
          airtable_keywords_table_id: c.airtable_keywords_table_id ?? '',
          airtable_embed_social: c.airtable_embed_social ?? '',
          airtable_embed_keywords: c.airtable_embed_keywords ?? '',
          airtable_embed_seo: c.airtable_embed_seo ?? '',
        });
      }
      if (postsRes.ok) {
        const { posts: p } = await postsRes.json();
        setPosts(p ?? []);
      }
      if (briefRes.ok) {
        const briefJson = await briefRes.json();
        setHasActiveBrief(Boolean(briefJson.brief));
      } else {
        setHasActiveBrief(false);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveAirtable = async () => {
    setSavingAirtable(true);
    setAirtableMsg('');
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(airtableConfig),
      });
      if (!res.ok) throw new Error('Failed to save');
      setAirtableMsg('Saved ✓');
      setTimeout(() => setAirtableMsg(''), 3000);
    } catch {
      setAirtableMsg('Error saving');
    } finally {
      setSavingAirtable(false);
    }
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
      {/* Master Brief reminder banner */}
      {hasActiveBrief === false && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-lg">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">No active Master Brief</p>
            <p className="text-xs text-amber-800">
              Upload brand documents and generate a Master Brief to unlock content
              generation. Open the <strong>Master Brief</strong> tab to get started.
            </p>
          </div>
          <button
            onClick={() => setActiveTab('brief')}
            className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline whitespace-nowrap"
          >
            Go to Master Brief →
          </button>
        </div>
      )}

      {/* Header */}
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
        <div className="ml-auto">
          <button
            onClick={() => setDrawerOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            🚀 生成内容
          </button>
        </div>
      </div>

      <GenerationDrawer
        clientId={clientId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {([
            { id: 'brief', label: '✨ Master Brief' },
            { id: 'campaigns', label: '🎯 推广活动' },
            { id: 'reels', label: '🎬 Reels Studio' },
            { id: 'site-audit', label: '🔍 Site Audit' },
            { id: 'overview', label: 'Overview' },
            { id: 'airtable', label: 'Airtable' },
          ] as { id: Tab; label: string }[]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'brief' && (
        <BriefPanel clientId={clientId} />
      )}

      {activeTab === 'campaigns' && (
        <CampaignPanel clientId={clientId} />
      )}

      {activeTab === 'site-audit' && (
        <SiteAuditPanel clientId={clientId} />
      )}

      {activeTab === 'reels' && (
        <ReelsStudio clientId={clientId} />
      )}

      {activeTab === 'overview' && (
        <div className="space-y-5">
          {/* Client Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Client Info</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Domain:</span>
                {client.domain ? (
                  <a href={`https://${client.domain}`} target="_blank" rel="noreferrer"
                    className="ml-2 text-indigo-600 hover:underline">{client.domain}</a>
                ) : <span className="ml-2 text-gray-400">—</span>}
              </div>
              <div>
                <span className="text-gray-500">Airtable Base:</span>
                <span className="ml-2 font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                  {client.airtable_base_id ?? '—'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Created:</span>
                <span className="ml-2 text-gray-900">{new Date(client.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Recent Content */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Recent Content</h2>
            </div>
            {posts.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">No content posts yet.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {posts.slice(0, 10).map(post => (
                  <div key={post.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{post.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {post.route} · {new Date(post.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[post.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {post.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'airtable' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Airtable Configuration</h2>
              <p className="text-xs text-gray-400 mt-0.5">同步设置 + 嵌入视图 URL</p>
            </div>
            <div className="flex items-center gap-3">
              {airtableMsg && <span className="text-sm text-green-600">{airtableMsg}</span>}
              <button
                onClick={handleSaveAirtable}
                disabled={savingAirtable}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
              >
                {savingAirtable ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sync Settings</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {([
                  { label: 'Airtable Base ID', key: 'airtable_base_id', placeholder: 'appXXXXXXXXXXXXXX' },
                  { label: 'Social Calendar Table ID', key: 'airtable_content_table_id', placeholder: 'tblXXXXXXXXXXXXXX' },
                  { label: 'Keywords Table ID', key: 'airtable_keywords_table_id', placeholder: 'tblXXXXXXXXX' },
                ] as { label: string; key: keyof typeof airtableConfig; placeholder: string }[]).map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input
                      value={airtableConfig[key]}
                      onChange={e => setAirtableConfig(c => ({ ...c, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Embed View URLs
                <span className="ml-2 font-normal normal-case text-gray-400">
                  Airtable → Share → Embed this view → copy src URL
                </span>
              </p>
              <div className="space-y-3">
                {([
                  { label: '📅 Social Calendar', key: 'airtable_embed_social' },
                  { label: '🔑 Keywords', key: 'airtable_embed_keywords' },
                  { label: '📈 SEO Strategy', key: 'airtable_embed_seo' },
                ] as { label: string; key: keyof typeof airtableConfig }[]).map(({ label, key }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input
                      value={airtableConfig[key]}
                      onChange={e => setAirtableConfig(c => ({ ...c, [key]: e.target.value }))}
                      placeholder="https://airtable.com/embed/shr…"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
