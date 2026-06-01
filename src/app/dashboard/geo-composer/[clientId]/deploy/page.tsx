/**
 * /dashboard/geo-composer/[clientId]/deploy
 * GEO Directive Deployment Assistant
 *
 * Main page for deploying GEO directives to customer web pages.
 * - Shows active GEO directive
 * - Provides snippet code for installation
 * - Records deployment confirmations
 * - Displays list of deployed pages
 *
 * Reference: ROADMAP.md P7.3.21-23, CLAUDE.md §十四
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { DeploymentForm } from '../_components/DeploymentForm';
import { DeployedPagesList } from '../_components/DeployedPagesList';
import { useDeploymentApi } from '@/lib/hooks/use-deployment-api';
import { DEPLOYMENT_CONFIG } from '@/lib/deployment-constants';
import type { GeoDirective } from '@/types/magic-engine';
import type { WordpressConnectionStatus, ShopifyConnectionStatus } from '@/lib/cms/vocabulary';

interface ClientData {
  id: string;
  name: string;
  domain?: string;
}

export interface CmsProviders {
  wordpress: WordpressConnectionStatus | null;
  shopify: ShopifyConnectionStatus | null;
}

export default function DeploymentPage() {
  const params = useParams();
  const clientId = params.clientId as string;

  const [client, setClient] = useState<ClientData | null>(null);
  const [directive, setDirective] = useState<GeoDirective | null>(null);
  const [cmsProviders, setCmsProviders] = useState<CmsProviders>({ wordpress: null, shopify: null });
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  const {
    deployments,
    loading: deploymentsLoading,
    error: deploymentsError,
    fetchDeployments,
    recordDeployment,
    revokeDeployment,
  } = useDeploymentApi();

  // Load client, active directive, and CMS provider status in parallel
  const loadData = useCallback(async () => {
    setPageLoading(true);
    setPageError('');
    try {
      const [clientRes, geoRes, cmsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/geo`),
        fetch(`/api/clients/${clientId}/cms/providers`).catch(() => null),
      ]);

      if (!clientRes.ok) throw new Error('Failed to load client');
      if (!geoRes.ok) throw new Error('Failed to load GEO directive');

      const clientData = await clientRes.json();
      setClient(clientData.client ?? null);

      const geoData = await geoRes.json();
      const directives: GeoDirective[] = geoData.directives ?? [];
      const active = directives.find((d) => d.status === 'active') ?? null;
      setDirective(active);

      // CMS providers — non-blocking, best-effort
      if (cmsRes?.ok) {
        const cmsData = await cmsRes.json();
        if (cmsData.success) {
          setCmsProviders({
            wordpress: cmsData.providers?.wordpress ?? null,
            shopify:   cmsData.providers?.shopify   ?? null,
          });
        }
      }

      // Load deployments
      await fetchDeployments(clientId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load data';
      setPageError(message);
    } finally {
      setPageLoading(false);
    }
  }, [clientId, fetchDeployments]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDeploymentRecorded = async () => {
    await fetchDeployments(clientId);
  };

  const handleRevoke = async (deploymentId: string): Promise<boolean> => {
    return await revokeDeployment(clientId, deploymentId);
  };

  if (pageLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="text-center">
          <div className="inline-block animate-spin">⏳</div>
          <p className="mt-2 text-me-charcoal/60">Loading deployment assistant...</p>
        </div>
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="p-4 bg-[#C2453A]/10 border border-[#C2453A]/30 rounded-lg">
          <p className="text-[#C2453A] font-medium">Error</p>
          <p className="text-[#C2453A] text-sm mt-1">{pageError}</p>
          <button
            onClick={loadData}
            className="mt-3 px-4 py-2 bg-[#C2453A] text-white rounded hover:bg-[#C2453A] transition text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-me-charcoal/90">{DEPLOYMENT_CONFIG.LABELS.PAGE_TITLE}</h1>
          {client && <p className="text-me-charcoal/60 mt-2">{client.name}</p>}
        </div>
        <Link
          href={`/dashboard/geo-composer/${clientId}`}
          className="px-4 py-2 border border-black/15 rounded-lg hover:bg-me-ivory transition text-sm"
        >
          ← Back to Composer
        </Link>
      </div>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-2 gap-8">
        {/* Left: Deployment Form */}
        <div>
          <DeploymentForm
            clientId={clientId}
            directive={directive}
            cmsProviders={cmsProviders}
            onDeploymentRecorded={handleDeploymentRecorded}
            loading={pageLoading}
          />
        </div>

        {/* Right: Deployed Pages List */}
        <div className="bg-white border border-black/10 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">
            {DEPLOYMENT_CONFIG.LABELS.DEPLOYED_PAGES}
          </h3>

          {deploymentsError && (
            <div className="mb-4 p-3 bg-[#C2453A]/10 border border-[#C2453A]/30 rounded text-[#C2453A] text-sm">
              {deploymentsError}
            </div>
          )}

          <DeployedPagesList
            clientId={clientId}
            deployments={deployments}
            loading={deploymentsLoading}
            onRevoke={handleRevoke}
          />
        </div>
      </div>
    </div>
  );
}
