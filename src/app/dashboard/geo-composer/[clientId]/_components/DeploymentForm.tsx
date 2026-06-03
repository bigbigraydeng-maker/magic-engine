/**
 * Component: DeploymentForm
 *
 * Form for entering a page URL and showing GEO directive snippet.
 * Also supports one-click deployment to connected WordPress / Shopify CMS.
 *
 * Reference: ROADMAP.md P7.3.22, P24.C
 */

'use client';

import React, { useState, useMemo } from 'react';
import { UrlInput } from './UrlInput';
import { CodeSnippetBox } from './CodeSnippetBox';
import { ConfirmDialog } from './ConfirmDialog';
import { DEPLOYMENT_CONFIG } from '@/lib/deployment-constants';
import { generateDirectiveHtml } from '@/lib/geo/html-generator';
import type { GeoDirective } from '@/types/magic-engine';
import type { CmsProviders } from '../deploy/page';

interface DeploymentFormProps {
  clientId: string;
  directive: GeoDirective | null;
  cmsProviders?: CmsProviders;
  onDeploymentRecorded?: () => void;
  loading?: boolean;
}

type CmsProvider = 'wordpress' | 'shopify';

interface CmsPublishState {
  loading: boolean;
  success: boolean;
  error: string | null;
  publishedUrl: string | null;
}

const CMS_LABELS: Record<CmsProvider, string> = {
  wordpress: 'WordPress',
  shopify:   'Shopify',
};

export function DeploymentForm({
  clientId,
  directive,
  cmsProviders,
  onDeploymentRecorded,
  loading = false,
}: DeploymentFormProps) {
  const [pageUrl, setPageUrl] = useState('');
  const [isUrlValid, setIsUrlValid] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isSuccess: boolean } | null>(null);
  const [cmsPublish, setCmsPublish] = useState<CmsPublishState>({
    loading: false,
    success: false,
    error: null,
    publishedUrl: null,
  });

  const snippet = useMemo(() => {
    if (!directive) return '';
    return generateDirectiveHtml(directive);
  }, [directive]);

  // Detect one-click capable providers (wordpress / shopify create pages via REST).
  // github is tracked separately: it's connected but uses a PR workflow, not REST,
  // so the publish-geo-snippet API does NOT accept it (validated in route.ts).
  // Showing a "Deploy to GitHub" button here would 400 — see B+ followup.
  const connectedProviders = useMemo<CmsProvider[]>(() => {
    if (!cmsProviders) return [];
    const list: CmsProvider[] = [];
    if (cmsProviders.wordpress?.connected) list.push('wordpress');
    if (cmsProviders.shopify?.connected)   list.push('shopify');
    return list;
  }, [cmsProviders]);

  const hasConnectedCms = connectedProviders.length > 0;
  const hasGithubOnly = !!(cmsProviders?.github?.connected) && !hasConnectedCms;

  const handleRecordDeployment = async () => {
    setIsRecording(true);
    try {
      const res = await fetch(DEPLOYMENT_CONFIG.API.RECORD_DEPLOYMENT(clientId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_url: pageUrl }),
      });

      if (!res.ok) throw new Error(DEPLOYMENT_CONFIG.ERRORS.RECORD_FAILED);

      setFeedback({ message: DEPLOYMENT_CONFIG.SUCCESS.DEPLOYMENT_RECORDED, isSuccess: true });
      setPageUrl('');
      setShowConfirm(false);
      onDeploymentRecorded?.();

      setTimeout(() => setFeedback(null), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : DEPLOYMENT_CONFIG.ERRORS.RECORD_FAILED;
      setFeedback({ message, isSuccess: false });
    } finally {
      setIsRecording(false);
    }
  };

  const handleCmsPublish = async (provider: CmsProvider) => {
    setCmsPublish({ loading: true, success: false, error: null, publishedUrl: null });
    try {
      const res = await fetch(`/api/clients/${clientId}/cms/publish-geo-snippet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });

      const data = await res.json() as { success: boolean; published_url?: string; error?: string };

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? 'Failed to publish to CMS');
      }

      setCmsPublish({ loading: false, success: true, error: null, publishedUrl: data.published_url ?? null });
      onDeploymentRecorded?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'CMS publish failed';
      setCmsPublish({ loading: false, success: false, error: message, publishedUrl: null });
    }
  };

  if (!directive) {
    return (
      <div className="p-6 bg-me-ochre/10 border border-me-ochre/30 rounded-lg">
        <p className="text-me-ochre">
          No active GEO directive found. Create one in the GEO Composer first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Banner — no CMS connected at all */}
      {cmsProviders !== undefined && !hasConnectedCms && !hasGithubOnly && (
        <div className="p-4 bg-me-ochre/10 border border-me-ochre/30 rounded-lg flex items-start gap-3">
          <span className="text-me-ochre text-xl mt-0.5">🔗</span>
          <div>
            <p className="text-me-ochre font-medium text-sm">Connect your website for one-click deployment</p>
            <p className="text-me-ochre text-xs mt-1">
              Link a website in{' '}
              <a href={`/dashboard/clients/${clientId}?settings=cms`} className="underline hover:text-me-ochre">
                Settings → Website Connection
              </a>{' '}
              to deploy this snippet automatically.
            </p>
          </div>
        </div>
      )}

      {/* Banner — only a version-control repository is connected (github).
          The one-click REST publish flow doesn't apply, so we surface the
          actual next step the FDE needs to take instead of a dead-end status. */}
      {hasGithubOnly && (
        <div className="p-4 bg-[#5C8A4A]/10 border border-[#5C8A4A]/30 rounded-lg flex items-start gap-3">
          <span className="text-[#5C8A4A] text-xl mt-0.5">✓</span>
          <div>
            <p className="text-[#5C8A4A] font-medium text-sm">Repository connected</p>
            <p className="text-[#5C8A4A]/90 text-xs mt-1">
              Your site uses a code-based deployment. Open a pull request that adds the
              snippet below to the page <code className="font-mono text-[11px] bg-white/60 px-1 py-0.5 rounded">&lt;head&gt;</code>,
              then use <strong>Add Page</strong> below to record the URL once the PR is merged.
            </p>
          </div>
        </div>
      )}

      {/* One-Click CMS Deploy — shown when a CMS is connected */}
      {hasConnectedCms && (
        <div className="bg-white border border-[#5C8A4A]/30 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-1">One-Click Deploy</h3>
          <p className="text-sm text-me-charcoal/55 mb-4">
            Publish the GEO snippet directly to your connected website.
          </p>

          <div className="flex flex-wrap gap-3">
            {connectedProviders.map((provider) => (
              <button
                key={provider}
                onClick={() => handleCmsPublish(provider)}
                disabled={cmsPublish.loading || loading}
                className="px-4 py-2 bg-[#5C8A4A] text-white rounded-lg hover:bg-[#5C8A4A] disabled:bg-me-stone disabled:cursor-not-allowed transition font-medium text-sm"
              >
                {cmsPublish.loading
                  ? 'Publishing…'
                  : `Deploy to ${CMS_LABELS[provider]}`}
              </button>
            ))}
          </div>

          {cmsPublish.success && (
            <div className="mt-3 p-3 bg-[#5C8A4A]/10 border border-[#5C8A4A]/30 rounded text-[#5C8A4A] text-sm">
              Published successfully!{' '}
              {cmsPublish.publishedUrl && (
                <a
                  href={cmsPublish.publishedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-[#5C8A4A]"
                >
                  View page →
                </a>
              )}
            </div>
          )}
          {cmsPublish.error && (
            <div className="mt-3 p-3 bg-[#C2453A]/10 border border-[#C2453A]/30 rounded text-[#C2453A] text-sm">
              {cmsPublish.error}
            </div>
          )}
        </div>
      )}

      {/* Manual Install Section */}
      <div className="bg-white border border-black/10 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Add Page</h3>

        <div className="space-y-4">
          <UrlInput
            value={pageUrl}
            onChange={setPageUrl}
            onValidChange={setIsUrlValid}
            disabled={loading || isRecording}
          />

          <button
            onClick={() => setShowConfirm(true)}
            disabled={!isUrlValid || loading || isRecording || pageUrl.length === 0}
            className="w-full px-4 py-2 bg-me-ochre text-white rounded-lg hover:bg-me-ochre disabled:bg-me-stone disabled:cursor-not-allowed transition font-medium"
          >
            {isRecording ? 'Recording...' : DEPLOYMENT_CONFIG.LABELS.MARK_DEPLOYED}
          </button>
        </div>
      </div>

      {/* Snippet Display */}
      <div className="bg-white border border-black/10 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">
          {DEPLOYMENT_CONFIG.LABELS.INSTALL_SNIPPET}
        </h3>

        <div className="space-y-4 text-sm text-me-charcoal/60">
          <p>1. Copy the snippet below</p>
          <p>2. Paste it into your page {'<head>'} or {'<body>'} tag</p>
          <p>3. Click "{DEPLOYMENT_CONFIG.LABELS.MARK_DEPLOYED}" to confirm installation</p>
        </div>

        <div className="mt-6">
          <CodeSnippetBox
            code={snippet}
            title="GEO Directive Snippet"
            copyable={true}
          />
        </div>
      </div>

      {/* Feedback Message */}
      {feedback && (
        <div
          className={`p-4 rounded-lg ${
            feedback.isSuccess
              ? 'bg-[#5C8A4A]/10 text-[#5C8A4A] border border-[#5C8A4A]/30'
              : 'bg-[#C2453A]/10 text-[#C2453A] border border-[#C2453A]/30'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showConfirm}
        title="Confirm Deployment"
        message={`Mark ${pageUrl} as deployed with this GEO directive?`}
        confirmLabel={DEPLOYMENT_CONFIG.LABELS.MARK_DEPLOYED}
        cancelLabel="Cancel"
        onConfirm={handleRecordDeployment}
        onCancel={() => setShowConfirm(false)}
        loading={isRecording}
      />
    </div>
  );
}
