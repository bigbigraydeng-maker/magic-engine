'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  name: string;
  domain?: string;
}

/**
 * /dashboard/ai-visibility
 *
 * Landing page: pick a client to view their AI Visibility Tracker.
 * Reference: ROADMAP.md P7.1.12
 */
export default function AiVisibilityIndexPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/clients');
      if (!res.ok) throw new Error('Failed to load clients');
      const json = await res.json();
      setClients(json.clients ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Visibility Tracker</h1>
        <p className="text-sm text-gray-500 mt-1">
          Track how your clients rank across major AI assistants and search responses.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse bg-white rounded-xl border border-gray-200 p-5 h-24" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <p className="text-gray-400 text-sm">No clients found.</p>
          <Link href="/dashboard/clients" className="text-indigo-600 hover:underline text-sm mt-2 block">
            → Add a client first
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(client => (
            <Link
              key={client.id}
              href={`/dashboard/ai-visibility/${client.id}`}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all group"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-gray-900 group-hover:text-indigo-700 truncate">
                    {client.name}
                  </h2>
                  {client.domain && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{client.domain}</p>
                  )}
                </div>
                <span className="text-gray-300 group-hover:text-indigo-400 text-lg ml-2 flex-shrink-0">→</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                  View Rankings
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
