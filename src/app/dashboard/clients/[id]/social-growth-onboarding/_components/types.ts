import type { IndustryProfileId } from '@/lib/social-onboarding/industry-profiles'

export type SourceCoverage = {
  masterBrief: boolean
  socialSnapshot: boolean
  adSnapshot: boolean
  adSnapshotStale: boolean
  facebookPage: boolean
  followerCount: boolean
  objectiveBreakdown: boolean
}

export type FormState = {
  industryProfile: IndustryProfileId
  primaryGoal: 'grow_audience' | 'build_trust' | 'generate_leads' | 'mixed'
  audience: string
  currentFollowers: number | null
  organicPostsPerWeek: number | null
  monthlyAdBudgetCap: number | null
  leadResponseMinutes: number | null
  constraints: string
}

export type Plan = {
  id: string
  status: 'draft' | 'reviewed'
  created_at: string
  inputs: FormState
  recommendation: {
    executive_summary: string
    stages: Array<{ stage: string; timing: string; objective: string; actions: string[]; success_signals: string[] }>
    organic_plan: { posts_per_week: number; reels_per_month: number; themes: string[]; rationale: string }
    paid_mix: Array<{ objective: string; role: string; start_condition: string; measurement: string }>
    measurement: Array<{ metric: string; meaning: string; source_status: 'available' | 'missing' | 'connect_first' }>
    open_questions: string[]
    risks: string[]
  }
  evidence_snapshot: {
    coverage: SourceCoverage
    masterBrief: { id: string; version: number; updated_at: string } | null
    socialFindings: Array<{ dimension: string; title: string; created_at: string; evidence: unknown }>
    diagnosticSnapshots: Array<{ dimension: 'social' | 'ads'; completedAt: string; findingCount: number }>
    adSnapshots: Array<{ period_start: string; period_end: string; impressions: number | null; clicks: number | null; conversions: number | null; ctr: number | null; roas: number | null; fetched_at: string }>
  }
}

export type PageData = {
  client: { name: string; industry: string | null }
  evidence: { coverage: SourceCoverage }
  suggestedIndustryProfile: FormState['industryProfile']
  plans: Plan[]
}
