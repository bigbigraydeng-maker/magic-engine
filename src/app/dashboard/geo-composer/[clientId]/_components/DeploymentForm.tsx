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

  interface DriftedTarget {
    path: string;
    expected_hash: string;
    live_hash: string;
  }

  const [githubPr, setGithubPr] = useState<{
    loading: boolean;
    prUrl: string | null;
    prNumber: number | null;
    targetPaths: string[];
    error: string | null;
    errorCode: string | null;
    drifted: DriftedTarget[];
  }>({
    loading: false,
    prUrl: null,
    prNumber: null,
    targetPaths: [],
    error: null,
    errorCode: null,
    drifted: [],
  });

  const [showDriftDialog, setShowDriftDialog] = useState(false);

  const runGithubPublish = async (forceOverwrite: boolean) => {
    setGithubPr(prev => ({ ...prev, loading: true, error: null, errorCode: null, drifted: [] }));
    try {
      const res = await fetch(`/api/clients/${clientId}/cms/publish-geo-to-github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force_overwrite: forceOverwrite }),
      });
      const data = await res.json() as {
        success: boolean;
        pr_url?: string;
        pr_number?: number;
        target_paths?: string[];
        error?: string;
        code?: string;
        drifted_targets?: DriftedTarget[];
        hint?: string;
      };
      if (!res.ok || !data.success) {
        // Drift requires explicit FDE confirmation — surface a dialog,
        // don't dump a raw error blob.
        if (data.code === 'EXTERNAL_DRIFT' && (data.drifted_targets?.length ?? 0) > 0) {
          setGithubPr(prev => ({
            ...prev,
            loading: false,
            error: null,
            errorCode: 'EXTERNAL_DRIFT',
            drifted: data.drifted_targets ?? [],
          }));
          setShowDriftDialog(true);
          return;
        }
        setGithubPr(prev => ({
          ...prev,
          loading: false,
          error: data.error ?? 'Failed to open GitHub PR',
          errorCode: data.code ?? null,
          drifted: [],
        }));
        return;
      }
      setGithubPr({
        loading: false,
        prUrl: data.pr_url ?? null,
        prNumber: data.pr_number ?? null,
        targetPaths: data.target_paths ?? [],
        error: null,
        errorCode: null,
        drifted: [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'GitHub PR failed';
      setGithubPr(prev => ({
        ...prev,
        loading: false,
        error: message,
        errorCode: null,
        drifted: [],
      }));
    }
  };

  const handleOpenGithubPr = () => { void runGithubPublish(false); };
  const handleConfirmForceOverwrite = () => {
    setShowDriftDialog(false);
    void runGithubPublish(true);
  };

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

      {/* GitHub PR Deploy — connected repo uses PR workflow, not REST */}
      {hasGithubOnly && (
        <div className="bg-white border border-[#5C8A4A]/30 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[#5C8A4A]">✓</span>
            <h3 className="text-lg font-semibold">Deploy via GitHub PR</h3>
          </div>
          <p className="text-sm text-me-charcoal/55 mb-4">
            Magic Engine reads your configured template paths, injects the GEO
            snippet inside each <code className="font-mono text-[11px]">&lt;head&gt;</code>,
            and opens a pull request you can review &amp; merge.
          </p>

          {!githubPr.prUrl ? (
            <button
              onClick={handleOpenGithubPr}
              disabled={githubPr.loading || loading}
              className="px-4 py-2 bg-[#5C8A4A] text-white rounded-lg hover:bg-[#4a7340] disabled:bg-me-stone disabled:cursor-not-allowed transition font-medium text-sm"
            >
              {githubPr.loading ? 'Opening PR…' : 'Open Pull Request'}
            </button>
          ) : (
            <div className="p-3 bg-[#5C8A4A]/10 border border-[#5C8A4A]/30 rounded text-[#5C8A4A] text-sm space-y-2">
              <div>
                PR #{githubPr.prNumber} opened —{' '}
                <a
                  href={githubPr.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-[#4a7340] font-medium"
                >
                  Review &amp; merge on GitHub →
                </a>
              </div>
              {githubPr.targetPaths.length > 0 && (
                <ul className="text-xs text-[#4a7340] list-disc pl-5">
                  {githubPr.targetPaths.map(p => (
                    <li key={p}><code className="font-mono">{p}</code></li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {githubPr.error && githubPr.errorCode === 'NO_TARGETS_CONFIGURED' && (
            <div className="mt-3 p-3 bg-me-ochre/10 border border-me-ochre/30 rounded text-me-ochre text-sm">
              <p className="mb-1">{githubPr.error}</p>
              <a
                href={`/dashboard/clients/${clientId}?settings=cms`}
                className="underline font-medium hover:text-me-ochre"
              >
                Open Settings → Website Connection →
              </a>
            </div>
          )}

          {/* MF8 (魏征 B2 review): when the FDE dismisses the drift dialog
              without choosing, leave a visible breadcrumb explaining what's
              pending so they don't think the click vanished. The dialog state
              and the lingering drift state are decoupled, so closing the
              dialog leaves errorCode='EXTERNAL_DRIFT' here to drive this UI. */}
          {githubPr.errorCode === 'EXTERNAL_DRIFT' &&
            !showDriftDialog &&
            !githubPr.prUrl &&
            githubPr.drifted.length > 0 && (
            <div className="mt-3 p-3 bg-me-ochre/10 border border-me-ochre/30 rounded text-me-ochre text-sm">
              <p className="mb-2">
                Drift detected on {githubPr.drifted.length} file
                {githubPr.drifted.length === 1 ? '' : 's'}. Re-publishing will
                replace the external edits.
              </p>
              <button
                onClick={() => setShowDriftDialog(true)}
                className="underline font-medium hover:text-me-ochre/80 text-sm"
              >
                Review drift &amp; choose →
              </button>
            </div>
          )}

          {githubPr.error &&
            githubPr.errorCode !== 'NO_TARGETS_CONFIGURED' &&
            githubPr.errorCode !== 'EXTERNAL_DRIFT' && (
            <div className="mt-3 p-3 bg-[#C2453A]/10 border border-[#C2453A]/30 rounded text-[#C2453A] text-sm">
              {githubPr.error}
            </div>
          )}
        </div>
      )}

      {/* Drift confirmation dialog */}
      <ConfirmDialog
        isOpen={showDriftDialog}
        title="External edits detected"
        message={`Magic Engine found ${githubPr.drifted.length} template file(s) whose ME-GEO block was changed outside this tool. Re-publish will replace those edits.\n\nAffected files:\n${githubPr.drifted.map(d => `  • ${d.path}`).join('\n')}`}
        confirmLabel="Replace external edits"
        cancelLabel="Cancel"
        onConfirm={handleConfirmForceOverwrite}
        onCancel={() => setShowDriftDialog(false)}
        loading={githubPr.loading}
      />


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
