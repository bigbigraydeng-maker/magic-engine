'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  name: string;
  domain?: string;
  created_at: string;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/clients');
      const json = await res.json();
      setClients(json.clients ?? []);
    } catch {
      setError('Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error ?? 'Delete failed');
        return;
      }
      setClients(prev => prev.filter(c => c.id !== id));
    } catch {
      setError('Delete failed');
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const confirmingClient = clients.find(c => c.id === confirmDeleteId);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">{clients.length} client(s) total</p>
        </div>
        <Link
          href="/dashboard/clients/new"
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + New Client
        </Link>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-3">✕</button>
        </div>
      )}

      {/* Client List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-400 text-sm">Loading...</div>
        ) : clients.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <p className="text-gray-400 text-sm">No clients yet.</p>
            <Link
              href="/dashboard/clients/new"
              className="inline-block text-sm text-indigo-600 hover:text-indigo-800 font-medium underline underline-offset-2"
            >
              Add your first client →
            </Link>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name / Domain</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {clients.map((client) => (
                <tr
                  key={client.id}
                  className={`transition-colors ${confirmDeleteId === client.id ? 'bg-red-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">{client.name}</p>
                    {client.domain && (
                      <a href={`https://${client.domain}`} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">
                        {client.domain}
                      </a>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-400">
                    {new Date(client.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {confirmDeleteId === client.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-red-600 font-medium mr-1">Delete &quot;{client.name}&quot;?</span>
                        <button
                          onClick={() => handleDelete(client.id)}
                          disabled={deleting}
                          className="text-xs bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white px-3 py-1 rounded font-medium transition-colors"
                        >
                          {deleting ? 'Deleting…' : 'Yes, delete'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={deleting}
                          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-4">
                        <Link
                          href={`/dashboard/clients/${client.id}`}
                          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          View →
                        </Link>
                        <button
                          onClick={() => setConfirmDeleteId(client.id)}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                          title="Delete client"
                        >
                          🗑
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Safety note */}
      {clients.length > 0 && (
        <p className="text-xs text-gray-400">
          Deleting a client removes all associated data including briefs, content, and visibility runs.
        </p>
      )}
    </div>
  );
}
