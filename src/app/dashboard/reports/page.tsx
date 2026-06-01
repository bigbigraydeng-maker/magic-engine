'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ClientRow {
  id: string;
  name: string;
}

/**
 * /dashboard/reports
 * Client selector — pick a client to view their monthly report.
 * Reference: ROADMAP.md P7.4.1
 */
export default function ReportsIndexPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.json())
      .then(j => setClients(j.clients ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal/90">📊 Monthly Reports</h1>
        <p className="text-sm text-me-charcoal/55 mt-1">
          Select a client to view their AI visibility + GEO monthly report.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-14 bg-me-stone rounded-xl" />)}
        </div>
      ) : clients.length === 0 ? (
        <p className="text-sm text-me-charcoal/45">No clients found.</p>
      ) : (
        <div className="space-y-2">
          {clients.map(c => (
            <Link
              key={c.id}
              href={`/dashboard/reports/${c.id}/monthly`}
              className="flex items-center justify-between px-5 py-4 bg-white border border-black/10 rounded-xl hover:border-me-ochre/50 hover:bg-me-ochre/40 transition-colors group"
            >
              <span className="font-medium text-me-charcoal/90 group-hover:text-me-ochre">
                {c.name}
              </span>
              <span className="text-xs text-me-charcoal/45 group-hover:text-me-ochre">
                View Monthly Report →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
