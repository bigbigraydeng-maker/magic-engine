'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CrawlButton, JobStatus } from '../site-audit/_components/CrawlButton';
import { ProgressCard, SiteAuditJob } from '../site-audit/_components/ProgressCard';

interface SiteAuditPanelProps {
  clientId: string;
}

/**
 * API response shape from GET /api/clients/[id]/site-audit/status
 * Field names match the actual Supabase table (site_audit_jobs).
 */
interface ApiSiteAuditJob {
  id: string;
  client_id: string;
  status: JobStatus;
  domain: string;
  max_pages: number;
  rate_limit_ms: number;
  total_urls_discovered: number;
  total_urls_crawled: number;
  total_pages_classified: number;
  error_message: string | null;
  failed_urls: string[];
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface StatusApiResponse {
  job: ApiSiteAuditJob | null;
  progressPercent: number | null;
  etaSec: number | null;
  geoDetectedCount?: number;
}

/**
 * Adapt the API job shape to the ProgressCard's view model.
 * ProgressCard uses simpler field names; this function bridges the gap.
 */
function adaptJobForProgressCard(apiJob: ApiSiteAuditJob, geoDetectedCount = 0): SiteAuditJob {
  return {
    id: apiJob.id,
    client_id: apiJob.client_id,
    domain: apiJob.domain,
    status: apiJob.status,
    total_pages: apiJob.max_pages,
    crawled_pages: apiJob.total_urls_crawled,
    classified_pages: apiJob.total_pages_classified,
    geo_detected: geoDetectedCount,
    error_count: apiJob.failed_urls.length,
    error_message: apiJob.error_message ?? undefined,
    created_at: apiJob.created_at,
    updated_at: apiJob.updated_at,
  };
}

/**
 * SiteAuditPanel
 *
 * 整合 Site Audit 功能：
 * - CrawlButton: 启动网站爬虫任务
 * - ProgressCard: 实时显示爬虫进度
 */
export function SiteAuditPanel({ clientId }: SiteAuditPanelProps) {
  const router = useRouter();
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [currentJobStatus, setCurrentJobStatus] = useState<JobStatus | null>(null);
  const [jobData, setJobData] = useState<SiteAuditJob | null>(null);
  const [isLoadingJob, setIsLoadingJob] = useState(true);
  const [jobError, setJobError] = useState<string | null>(null);

  // On mount: fetch latest job so the panel isn't blank on first open
  useEffect(() => {
    async function fetchLatestJob() {
      try {
        const res = await fetch(`/api/clients/${clientId}/site-audit/status`);
        if (!res.ok) return;
        const data = await res.json() as StatusApiResponse;
        if (data.job) {
          setCurrentJobId(data.job.id);
          setCurrentJobStatus(data.job.status);
          setJobData(adaptJobForProgressCard(data.job, data.geoDetectedCount ?? 0));
        }
      } catch {
        // Non-fatal — just leave the panel empty
      } finally {
        setIsLoadingJob(false);
      }
    }
    fetchLatestJob();
  }, [clientId]);

  const handleJobStarted = (jobId: string) => {
    setCurrentJobId(jobId);
    setCurrentJobStatus('pending');
    setJobError(null);
    setJobData(null);
    setIsLoadingJob(true);
  };

  // 轮询 job 状态
  useEffect(() => {
    if (!currentJobId) return;

    let pollInterval: NodeJS.Timeout;

    const pollJobStatus = async () => {
      try {
        // Use query param (not path param) — API: GET /status?jobId={id}
        const response = await fetch(
          `/api/clients/${clientId}/site-audit/status?jobId=${currentJobId}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch job status');
        }

        const data = await response.json() as StatusApiResponse;

        if (data.job) {
          setJobData(adaptJobForProgressCard(data.job, data.geoDetectedCount ?? 0));
          setCurrentJobStatus(data.job.status);
        }
        setJobError(null);
        setIsLoadingJob(false); // Data arrived — stop showing skeleton

        // 如果job已完成或失败，停止轮询
        if (
          data.job?.status === 'completed' ||
          data.job?.status === 'failed'
        ) {
          if (pollInterval) clearInterval(pollInterval);
        }
      } catch (error) {
        console.error('Error polling job status:', error);
        setJobError(error instanceof Error ? error.message : 'Unknown error');
        setIsLoadingJob(false);
      }
    };

    // 立即检查一次
    pollJobStatus();

    // 每2秒检查一次
    pollInterval = setInterval(pollJobStatus, 2000);

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [currentJobId, clientId]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-xl border border-black/10 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-me-charcoal/90">Site Audit</h2>
            <p className="text-xs text-me-charcoal/55 mt-1">
              爬取网站内容、分析页面结构、检测地理位置标记。新客户接入时必须执行。
            </p>
          </div>
          <div className="flex-shrink-0">
            <CrawlButton
              clientId={clientId}
              currentJobStatus={currentJobStatus}
              onJobStarted={handleJobStarted}
            />
          </div>
        </div>
      </div>

      {/* Progress */}
      <ProgressCard
        job={jobData}
        isLoading={isLoadingJob}
        error={jobError}
        onViewPages={() => router.push(`/dashboard/clients/${clientId}/site-audit/pages`)}
      />

      {/* Info Box */}
      <div className="bg-me-ochre/10 border border-me-ochre/30 rounded-xl p-4">
        <p className="text-xs text-me-charcoal">
          <strong>❓ Site Audit 用于什么？</strong>
          <br />
          获取网站内容清单、页面主题分类、地理位置标记状态，为后续的内容生成、GEO 优化、SEO 分析提供基础数据。
          爬虫通常需要 5-30 分钟（取决于网站规模），完成后可用于生成策略驱动的内容。
        </p>
      </div>
    </div>
  );
}
