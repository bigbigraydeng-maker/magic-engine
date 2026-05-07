'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  name: string;
  domain?: string;
  airtable_base_id?: string;
  created_at: string;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
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
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Airtable Base</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {clients.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">{client.name}</p>
                    {client.domain && (
                      <a href={`https://${client.domain}`} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">
                        {client.domain}
                      </a>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {client.airtable_base_id ? (
                      <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-1 rounded">{client.airtable_base_id}</span>
                    ) : (
                      <span className="text-xs text-gray-400">Not set</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-400">
                    {new Date(client.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/dashboard/clients/${client.id}`}
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
