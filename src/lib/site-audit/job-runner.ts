import { SupabaseClient } from '@supabase/supabase-js'

export type JobStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface SiteAuditJob {
  id: string
  client_id: string
  status: JobStatus
  domain: string
  max_pages: number
  rate_limit_ms: number
  total_urls_discovered: number
  total_urls_crawled: number
  total_pages_classified: number
  error_message: string | null
  failed_urls: string[]
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface SiteAuditPage {
  id: string
  job_id: string
  url: string
  page_type: 'blog' | 'landing' | 'product'
  topics: string[]
  has_geo_block: boolean
  markdown_content: string
  geo_block_info: {
    directive_id: string
    strategy: string
  } | null
  created_at: string
  updated_at: string
}

export interface CreateJobInput {
  domain: string
  maxPages?: number
  rateLimitMs?: number
}

export interface UpdateProgressInput {
  totalUrlsDiscovered?: number
  totalUrlsCrawled?: number
  totalPagesClassified?: number
}

export class JobRunner {
  constructor(private supabase: SupabaseClient) {}

  async createJob(
    clientId: string,
    input: CreateJobInput
  ): Promise<SiteAuditJob> {
    if (!clientId) throw new Error('Client ID is required')
    if (!input.domain) throw new Error('Domain is required')

    const { data, error } = await this.supabase
      .from('site_audit_jobs')
      .insert({
        client_id: clientId,
        domain: input.domain,
        max_pages: input.maxPages ?? 100,
        rate_limit_ms: input.rateLimitMs ?? 1000,
        status: 'pending',
        total_urls_discovered: 0,
        total_urls_crawled: 0,
        total_pages_classified: 0,
        failed_urls: [],
      })
      .select()
      .single()

    if (error) throw new Error(`Failed to create job: ${error.message}`)
    return data as SiteAuditJob
  }

  async getJob(jobId: string): Promise<SiteAuditJob | null> {
    if (!jobId) throw new Error('Job ID is required')

    const { data, error } = await this.supabase
      .from('site_audit_jobs')
      .select()
      .eq('id', jobId)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch job: ${error.message}`)
    }

    return (data as SiteAuditJob) || null
  }

  async startJob(jobId: string): Promise<SiteAuditJob> {
    if (!jobId) throw new Error('Job ID is required')

    const { data, error } = await this.supabase
      .from('site_audit_jobs')
      .update({
        status: 'in_progress' as JobStatus,
        started_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .select()
      .single()

    if (error) throw new Error(`Failed to start job: ${error.message}`)
    return data as SiteAuditJob
  }

  async updateProgress(
    jobId: string,
    input: UpdateProgressInput
  ): Promise<SiteAuditJob> {
    if (!jobId) throw new Error('Job ID is required')

    const updates: Record<string, any> = {}
    if (input.totalUrlsDiscovered !== undefined)
      updates.total_urls_discovered = input.totalUrlsDiscovered
    if (input.totalUrlsCrawled !== undefined)
      updates.total_urls_crawled = input.totalUrlsCrawled
    if (input.totalPagesClassified !== undefined)
      updates.total_pages_classified = input.totalPagesClassified

    const { data, error } = await this.supabase
      .from('site_audit_jobs')
      .update(updates)
      .eq('id', jobId)
      .select()
      .single()

    if (error) throw new Error(`Failed to update job: ${error.message}`)
    return data as SiteAuditJob
  }

  async completeJob(jobId: string): Promise<SiteAuditJob> {
    if (!jobId) throw new Error('Job ID is required')

    const { data, error } = await this.supabase
      .from('site_audit_jobs')
      .update({
        status: 'completed' as JobStatus,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .select()
      .single()

    if (error) throw new Error(`Failed to complete job: ${error.message}`)
    return data as SiteAuditJob
  }

  async failJob(
    jobId: string,
    error: string,
    failedUrls: string[] = []
  ): Promise<SiteAuditJob> {
    if (!jobId) throw new Error('Job ID is required')
    if (!error) throw new Error('Error message is required')

    const { data, error: updateError } = await this.supabase
      .from('site_audit_jobs')
      .update({
        status: 'failed' as JobStatus,
        error_message: error,
        failed_urls: failedUrls,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .select()
      .single()

    if (updateError)
      throw new Error(`Failed to mark job as failed: ${updateError.message}`)
    return data as SiteAuditJob
  }

  /**
   * Return the most recent in_progress job for a given client, or null if none.
   * Used by the crawl API route to enforce one-job-per-client concurrency.
   */
  async getInProgressJob(clientId: string): Promise<SiteAuditJob | null> {
    if (!clientId) throw new Error('Client ID is required')

    const { data, error } = await this.supabase
      .from('site_audit_jobs')
      .select()
      .eq('client_id', clientId)
      .eq('status', 'in_progress')
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) throw new Error(`Failed to query in-progress jobs: ${error.message}`)
    return (data?.[0] as SiteAuditJob) ?? null
  }

  /**
   * Return the most recent job (any status) for a given client, or null if none.
   * Used by the status API route to fetch the latest job regardless of completion state.
   */
  async getLatestJobByClientId(clientId: string): Promise<SiteAuditJob | null> {
    if (!clientId) throw new Error('Client ID is required')

    const { data, error } = await this.supabase
      .from('site_audit_jobs')
      .select()
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) throw new Error(`Failed to query latest job: ${error.message}`)
    return (data?.[0] as SiteAuditJob) ?? null
  }

  async cleanupOldJobs(retentionDays: number = 30): Promise<number> {
    if (retentionDays <= 0) throw new Error('Retention days must be positive')

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

    const { data, error } = await this.supabase
      .from('site_audit_jobs')
      .delete()
      .lt('completed_at', cutoffDate.toISOString())
      .neq('completed_at', null)
      .select('id')

    if (error) throw new Error(`Failed to cleanup jobs: ${error.message}`)
    return (data?.length as number) ?? 0
  }
}
