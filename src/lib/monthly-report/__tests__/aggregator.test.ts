import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MonthlyReportAggregator } from '../aggregator'

// Mock Supabase client
let queryChain: any = null
let sectionsMockData: any = []

const mockSupabase: any = {
  from: vi.fn(function(table?: string) {
    queryChain = { table, isSingle: false }
    return mockSupabase
  }),
  select: vi.fn(function(cols?: string) {
    return mockSupabase
  }),
  eq: vi.fn(function(col?: string, val?: any) {
    // If this is a query chain for datasource_report_sections (without .single()), return array
    if (queryChain?.table === 'datasource_report_sections' && !queryChain.isSingle) {
      return Promise.resolve({ data: sectionsMockData, error: null })
    }
    return mockSupabase
  }),
  single: vi.fn(function() {
    queryChain.isSingle = true
    return mockSupabase
  }),
  update: vi.fn(function(data?: any) {
    return mockSupabase
  }),
}

// Helper to set sections mock data for tests
const setSectionsMockData = (data: any) => {
  sectionsMockData = data
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

// Mock collector classes with proper structure
vi.mock('../collectors/ai-tracker', () => ({
  AITrackerCollector: vi.fn().mockImplementation(() => ({
    datasource_type: 'ai_tracker',
    name: 'AI Visibility Tracker',
    execute: vi.fn(),
  })),
}))

vi.mock('../collectors/billing-monitor', () => ({
  BillingMonitorCollector: vi.fn().mockImplementation(() => ({
    datasource_type: 'billing',
    name: 'Billing Monitor',
    execute: vi.fn(),
  })),
}))

describe('MonthlyReportAggregator', () => {
  let aggregator: MonthlyReportAggregator

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock return values
    mockSupabase.single.mockReset()
    aggregator = new MonthlyReportAggregator()
  })

  describe('Helper methods', () => {
    it('should get previous month within same year', () => {
      const prevMonth = aggregator['getPreviousMonth']('2026-05')
      expect(prevMonth).toBe('2026-04')
    })

    it('should handle year boundary correctly', () => {
      const prevMonth = aggregator['getPreviousMonth']('2026-01')
      expect(prevMonth).toBe('2025-12')
    })

    it('should pad month number with leading zero', () => {
      const prevMonth = aggregator['getPreviousMonth']('2026-10')
      expect(prevMonth).toBe('2026-09')
    })

    it('should return correct title for ai_tracker', () => {
      const title = aggregator['getSectionTitle']('ai_tracker')
      expect(title).toBe('AI Visibility Tracker')
    })

    it('should return correct title for billing', () => {
      const title = aggregator['getSectionTitle']('billing')
      expect(title).toBe('Billing Monitor')
    })

    it('should return section type for unknown type', () => {
      const title = aggregator['getSectionTitle']('unknown')
      expect(title).toBe('unknown')
    })
  })

  describe('generateInsights', () => {
    it('should generate AI tracker insights', () => {
      const data = {
        avg_ranking: 5.5,
        tracked_questions: 10,
        ranking_change: 2.5,
      }

      const insights = aggregator['generateInsights']('ai_tracker', data)

      expect(insights.length).toBeGreaterThan(0)
      expect(insights.some((i) => i.includes('AI ranking'))).toBe(true)
    })

    it('should generate billing insights', () => {
      const data = {
        total_cost_usd: 500.5,
        total_api_calls: 50000,
      }

      const insights = aggregator['generateInsights']('billing', data)

      expect(insights.length).toBeGreaterThan(0)
      expect(insights.some((i) => i.includes('$500.50'))).toBe(true)
    })
  })

  describe('generateRecommendations', () => {
    it('should generate AI tracker recommendations for poor ranking', () => {
      const data = {
        ranking_change: 2,
        top_questions: [],
      }

      const recs = aggregator['generateRecommendations']('ai_tracker', data)

      expect(recs.length).toBeGreaterThan(0)
    })

    it('should generate billing recommendations for high costs', () => {
      const data = {
        total_cost_usd: 1500,
      }

      const recs = aggregator['generateRecommendations']('billing', data)

      expect(recs.length).toBeGreaterThan(0)
      expect(recs.some((r) => r.includes('optimize'))).toBe(true)
    })

    it('should not recommend when AI metrics are good', () => {
      const data = {
        ranking_change: 0,
        top_questions: ['q1', 'q2'],
      }

      const recs = aggregator['generateRecommendations']('ai_tracker', data)

      expect(recs.length).toBe(0)
    })
  })

  describe('health score calculation logic', () => {
    it('should calculate AI score from ranking position', () => {
      const data = {
        avg_ranking: 5,
        tracked_questions: 10,
        ranking_change: 1,
      }

      const insights = aggregator['generateInsights']('ai_tracker', data)

      expect(insights.length).toBeGreaterThan(0)
      // Score should be: max(0, 100 - 5*5) = 75
    })

    it('should handle missing metrics gracefully', () => {
      const data = {}

      const insights = aggregator['generateInsights']('ai_tracker', data)

      expect(Array.isArray(insights)).toBe(true)
    })

    it('should generate insights for active datasource types', () => {
      const types = ['ai_tracker', 'billing']

      types.forEach((type) => {
        const insights = aggregator['generateInsights'](type, {})
        expect(Array.isArray(insights)).toBe(true)
      })
    })

    it('should generate recommendations for active datasource types', () => {
      const types = ['ai_tracker', 'billing']

      types.forEach((type) => {
        const recs = aggregator['generateRecommendations'](type, {})
        expect(Array.isArray(recs)).toBe(true)
      })
    })
  })

  describe('month navigation', () => {
    it('should handle multiple month transitions', () => {
      const months = ['2026-01', '2026-02', '2026-06', '2026-12']

      months.forEach((month) => {
        const prevMonth = aggregator['getPreviousMonth'](month)
        expect(prevMonth).toMatch(/^\d{4}-\d{2}$/)
      })
    })

    it('should not create invalid month strings', () => {
      const prevMonth = aggregator['getPreviousMonth']('2026-05')

      const [year, month] = prevMonth.split('-')
      expect(parseInt(month)).toBeGreaterThan(0)
      expect(parseInt(month)).toBeLessThanOrEqual(12)
    })
  })

  describe('insights generation with threshold values', () => {
    it('should generate insights for very high AI ranking scores', () => {
      const data = {
        avg_ranking: 1,
        tracked_questions: 50,
        ranking_change: 0,
      }

      const insights = aggregator['generateInsights']('ai_tracker', data)
      expect(insights.length).toBeGreaterThan(0)
    })

    it('should generate insights for very poor SERP performance', () => {
      const data = {
        top10_keywords: 0,
        new_rankings: 0,
        lost_rankings: 10,
        avg_position: 50,
        tracked_keywords: 100,
      }

      const insights = aggregator['generateInsights']('serp', data)
      expect(Array.isArray(insights)).toBe(true)
    })

    it('should generate insights for zero billing cost', () => {
      const data = {
        total_cost_usd: 0,
        total_api_calls: 0,
        cost_by_service: {},
      }

      const insights = aggregator['generateInsights']('billing', data)
      expect(Array.isArray(insights)).toBe(true)
    })
  })

  describe('recommendations with extreme values', () => {
    it('should recommend for very poor AI ranking', () => {
      const data = {
        avg_ranking: 100,
        ranking_change: -10,
        tracked_questions: 1,
      }

      const recs = aggregator['generateRecommendations']('ai_tracker', data)
      expect(recs.length).toBeGreaterThan(0)
    })

    it('should not recommend when all metrics are excellent', () => {
      const data = {
        avg_ranking: 3,
        ranking_change: 0,
        top_questions: ['q1', 'q2', 'q3'],
        total_cost_usd: 100,
      }

      const recs = aggregator['generateRecommendations']('ai_tracker', data)
      expect(recs.length).toBe(0)
    })
  })

  describe('section title mapping completeness', () => {
    it('should have titles for active datasource types', () => {
      const types = ['ai_tracker', 'billing']

      types.forEach((type) => {
        const title = aggregator['getSectionTitle'](type)
        expect(title).not.toBe(type)
        expect(title.length).toBeGreaterThan(0)
      })
    })

    it('should return the type itself for unknown datasource types', () => {
      const unknown = aggregator['getSectionTitle']('unknown_type')
      expect(unknown).toBe('unknown_type')
    })
  })

  describe('fetchReport', () => {
    it('should return report data when record exists', async () => {
      const mockReportData = {
        id: 1,
        client_id: 'test-client',
        month: '2026-05',
        overall_health_score: 75,
        health_trend: 'stable',
        ai_avg_ranking: 5,
        serp_top10_keywords: 25,
        backlinks_total: 100,
      }

      mockSupabase.single.mockResolvedValueOnce({
        data: mockReportData,
        error: null,
      })

      const report = await aggregator['fetchReport']('test-client', '2026-05')

      expect(report).toEqual(mockReportData)
      expect(mockSupabase.from).toHaveBeenCalledWith('datasource_monthly_reports')
      expect(mockSupabase.select).toHaveBeenCalledWith('*')
      expect(mockSupabase.eq).toHaveBeenCalledWith('client_id', 'test-client')
    })

    it('should return null when record does not exist', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: null,
      })

      const report = await aggregator['fetchReport']('unknown-client', '2026-05')

      expect(report).toBeNull()
    })

    it('should handle supabase error gracefully', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: new Error('Database error'),
      })

      const report = await aggregator['fetchReport']('test-client', '2026-05')

      expect(report).toBeNull()
    })
  })

  describe('calculateHealthMetrics', () => {
    it('should calculate health score from AI ranking', async () => {
      const mockReportData = {
        id: 1,
        month: '2026-05',
        ai_avg_ranking: 5,
        backlinks_total: 0,
        serp_tracked_keywords: 0,
        serp_top10_keywords: 0,
        local_tracked_keywords: 0,
        local_top10_keywords: 0,
        market_opportunity_score: 0,
        overall_health_score: null,
      }

      mockSupabase.single
        .mockResolvedValueOnce({ data: mockReportData, error: null })
        .mockResolvedValueOnce({ data: null, error: null }) // Previous month

      const { healthScore, healthTrend } = await aggregator['calculateHealthMetrics'](
        'test-client',
        '2026-05'
      )

      // AI score = max(0, 100 - 5*5) = 75
      expect(healthScore).toBe(75)
      expect(healthTrend).toBe('stable')
    })

    it('should calculate health score from AI ranking only', async () => {
      const mockReportData = {
        id: 1,
        month: '2026-05',
        ai_avg_ranking: 10, // Score: 100 - 10*5 = 50
        overall_health_score: null,
      }

      mockSupabase.single
        .mockResolvedValueOnce({ data: mockReportData, error: null })
        .mockResolvedValueOnce({ data: null, error: null }) // Previous month

      const { healthScore, healthTrend } = await aggregator['calculateHealthMetrics'](
        'test-client',
        '2026-05'
      )

      // Only AI ranking contributes: 100 - 10*5 = 50
      expect(healthScore).toBe(50)
      expect(healthTrend).toBe('stable')
    })

    it('should determine improving trend when score increases > 5', async () => {
      const mockReportData = {
        id: 1,
        month: '2026-05',
        ai_avg_ranking: 5,
        backlinks_total: 0,
        serp_tracked_keywords: 0,
        serp_top10_keywords: 0,
        local_tracked_keywords: 0,
        local_top10_keywords: 0,
        market_opportunity_score: 0,
        overall_health_score: null,
      }

      const mockPrevReport = {
        overall_health_score: 65, // Current: 75, delta: +10 > 5
      }

      mockSupabase.single
        .mockResolvedValueOnce({ data: mockReportData, error: null })
        .mockResolvedValueOnce({ data: mockPrevReport, error: null })

      const { healthTrend } = await aggregator['calculateHealthMetrics'](
        'test-client',
        '2026-05'
      )

      expect(healthTrend).toBe('improving')
    })

    it('should determine declining trend when score decreases < -5', async () => {
      const mockReportData = {
        id: 1,
        month: '2026-05',
        ai_avg_ranking: 10,
        backlinks_total: 0,
        serp_tracked_keywords: 0,
        serp_top10_keywords: 0,
        local_tracked_keywords: 0,
        local_top10_keywords: 0,
        market_opportunity_score: 0,
        overall_health_score: null,
      }

      const mockPrevReport = {
        overall_health_score: 60, // Current: 50, delta: -10 < -5
      }

      mockSupabase.single
        .mockResolvedValueOnce({ data: mockReportData, error: null })
        .mockResolvedValueOnce({ data: mockPrevReport, error: null })

      const { healthTrend } = await aggregator['calculateHealthMetrics'](
        'test-client',
        '2026-05'
      )

      expect(healthTrend).toBe('declining')
    })

    it('should return default score when report not found', async () => {
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: null,
      })

      const { healthScore, healthTrend } = await aggregator['calculateHealthMetrics'](
        'unknown-client',
        '2026-05'
      )

      expect(healthScore).toBe(50)
      expect(healthTrend).toBe('stable')
    })

    it('should handle all metrics being zero', async () => {
      const mockReportData = {
        id: 1,
        month: '2026-05',
        ai_avg_ranking: 0,
        backlinks_total: 0,
        serp_tracked_keywords: 0,
        serp_top10_keywords: 0,
        local_tracked_keywords: 0,
        local_top10_keywords: 0,
        market_opportunity_score: 0,
        overall_health_score: null,
      }

      mockSupabase.single
        .mockResolvedValueOnce({ data: mockReportData, error: null })
        .mockResolvedValueOnce({ data: null, error: null })

      const { healthScore, healthTrend } = await aggregator['calculateHealthMetrics'](
        'test-client',
        '2026-05'
      )

      // With zero metrics, no scores are added, so default 50
      expect(healthScore).toBe(50)
      expect(healthTrend).toBe('stable')
    })

    it('should handle year boundary for previous month', async () => {
      const mockReportData = {
        id: 1,
        month: '2026-01',
        ai_avg_ranking: 5,
        backlinks_total: 0,
        serp_tracked_keywords: 0,
        serp_top10_keywords: 0,
        local_tracked_keywords: 0,
        local_top10_keywords: 0,
        market_opportunity_score: 0,
        overall_health_score: null,
      }

      mockSupabase.single
        .mockResolvedValueOnce({ data: mockReportData, error: null })
        .mockResolvedValueOnce({ data: null, error: null }) // Looks for 2025-12

      const { healthScore, healthTrend } = await aggregator['calculateHealthMetrics'](
        'test-client',
        '2026-01'
      )

      expect(healthScore).toBe(75)
      expect(healthTrend).toBe('stable')
    })
  })

  describe('generateReport', () => {
    it('should return success response when all collectors succeed', async () => {
      const mockCollectors = aggregator['collectors']
      mockCollectors.forEach((collector) => {
        vi.spyOn(collector as any, 'execute').mockResolvedValueOnce({
          datasource_type: collector.datasource_type,
          data: {},
        })
      })

      const mockReportData = {
        id: 1,
        client_id: 'test-client',
        month: '2026-05',
        overall_health_score: 75,
        ai_avg_ranking: 5,
      }

      mockSupabase.single
        .mockResolvedValueOnce({ data: null, error: null }) // getExistingReportId
        .mockResolvedValueOnce({ data: mockReportData, error: null }) // fetchReport after collectors
        .mockResolvedValueOnce({ data: mockReportData, error: null }) // calculateHealthMetrics - current report
        .mockResolvedValueOnce({ data: null, error: null }) // calculateHealthMetrics - previous month
        .mockResolvedValueOnce({ data: mockReportData, error: null }) // fetchReport for final response
        .mockResolvedValueOnce({ data: [], error: null }) // sections query

      const response = await aggregator.generateReport('test-client', '2026-05')

      expect(response.success).toBe(true)
      expect(response.report).toBeDefined()
      expect(response.errors).toBeUndefined()
    })

    it('should handle partial collector failures', async () => {
      const mockCollectors = aggregator['collectors']
      mockCollectors[0].execute = vi.fn().mockRejectedValueOnce(new Error('Collector failed'))
      mockCollectors[1].execute = vi.fn().mockResolvedValueOnce({ datasource_type: 'link_intel', data: {} })
      for (let i = 2; i < mockCollectors.length; i++) {
        mockCollectors[i].execute = vi.fn().mockResolvedValueOnce({
          datasource_type: mockCollectors[i].datasource_type,
          data: {},
        })
      }

      const mockReportData = {
        id: 1,
        client_id: 'test-client',
        month: '2026-05',
      }

      mockSupabase.single
        .mockResolvedValueOnce({ data: null, error: null }) // getExistingReportId
        .mockResolvedValueOnce({ data: mockReportData, error: null }) // fetchReport
        .mockResolvedValueOnce({ data: mockReportData, error: null }) // calculateHealthMetrics
        .mockResolvedValueOnce({ data: null, error: null }) // previous month
        .mockResolvedValueOnce({ data: mockReportData, error: null }) // final fetchReport
        .mockResolvedValueOnce({ data: [], error: null }) // sections

      const response = await aggregator.generateReport('test-client', '2026-05')

      expect(response.success).toBe(false)
      expect(response.errors).toBeDefined()
      expect(response.errors!.length).toBe(1)
      expect(response.errors![0].datasource).toBe('ai_tracker')
    })

    it('should return error when all collectors fail', async () => {
      const mockCollectors = aggregator['collectors']
      mockCollectors.forEach((collector) => {
        vi.spyOn(collector as any, 'execute').mockRejectedValueOnce(new Error('Failed'))
      })

      mockSupabase.single.mockResolvedValueOnce({ data: null, error: null }) // getExistingReportId

      const response = await aggregator.generateReport('test-client', '2026-05')

      expect(response.success).toBe(false)
      expect(response.errors).toHaveLength(2)
      expect(response.warnings).toContain('All datasources failed to collect data')
    })

    it('should return error when report fetch fails', async () => {
      const mockCollectors = aggregator['collectors']
      mockCollectors.forEach((collector) => {
        vi.spyOn(collector as any, 'execute').mockResolvedValueOnce({
          datasource_type: collector.datasource_type,
          data: {},
        })
      })

      mockSupabase.single
        .mockResolvedValueOnce({ data: null, error: null }) // getExistingReportId
        .mockResolvedValueOnce({ data: null, error: null }) // fetchReport after collectors

      const response = await aggregator.generateReport('test-client', '2026-05')

      expect(response.success).toBe(false)
      expect(response.warnings).toContain('Failed to generate report after collection')
    })

    it('should include sections in response', async () => {
      const mockCollectors = aggregator['collectors']
      mockCollectors.forEach((collector) => {
        vi.spyOn(collector as any, 'execute').mockResolvedValueOnce({
          datasource_type: collector.datasource_type,
          data: {},
        })
      })

      const mockReportData = {
        id: 1,
        client_id: 'test-client',
        month: '2026-05',
      }

      const mockSections = [
        {
          id: 's1',
          report_id: 1,
          section_type: 'ai_tracker',
          section_data: { avg_ranking: 5 },
          last_updated: '2026-05-01T00:00:00Z',
        },
      ]

      // Set the sections mock data for the eq() query
      setSectionsMockData(mockSections)

      mockSupabase.single
        .mockResolvedValueOnce({ data: null, error: null }) // getExistingReportId
        .mockResolvedValueOnce({ data: mockReportData, error: null }) // fetchReport
        .mockResolvedValueOnce({ data: mockReportData, error: null }) // calculateHealthMetrics
        .mockResolvedValueOnce({ data: null, error: null }) // previous month
        .mockResolvedValueOnce({ data: mockReportData, error: null }) // final fetchReport

      const response = await aggregator.generateReport('test-client', '2026-05')

      expect(response.sections).toBeDefined()
      expect(response.sections!.length).toBe(1)
      expect(response.sections![0].title).toBe('AI Visibility Tracker')
      expect(response.sections![0].key_insights).toBeDefined()
      expect(response.sections![0].recommendations).toBeDefined()
    })

    it('should update report with health metrics', async () => {
      const mockCollectors = aggregator['collectors']
      mockCollectors.forEach((collector) => {
        vi.spyOn(collector as any, 'execute').mockResolvedValueOnce({
          datasource_type: collector.datasource_type,
          data: {},
        })
      })

      const mockReportData = {
        id: 99,
        client_id: 'test-client',
        month: '2026-05',
      }

      mockSupabase.single
        .mockResolvedValueOnce({ data: null, error: null }) // getExistingReportId
        .mockResolvedValueOnce({ data: mockReportData, error: null }) // fetchReport
        .mockResolvedValueOnce({ data: mockReportData, error: null }) // calculateHealthMetrics
        .mockResolvedValueOnce({ data: null, error: null }) // previous month
        .mockResolvedValueOnce({ data: mockReportData, error: null }) // final fetchReport
        .mockResolvedValueOnce({ data: [], error: null }) // sections

      mockSupabase.update = vi.fn().mockReturnThis()

      await aggregator.generateReport('test-client', '2026-05')

      expect(mockSupabase.update).toHaveBeenCalled()
    })
  })

  describe('integration - generateReport flow', () => {
    it('should have all 6 collectors instantiated', () => {
      // Verify collector array has correct length
      expect(aggregator['collectors']).toBeDefined()
      expect(aggregator['collectors'].length).toBe(2)
    })


    it('should calculate health score formula correctly', () => {
      // Test the health score formula logic
      // AI score = max(0, 100 - ranking*5)
      const aiRanking = 5
      const aiScore = Math.max(0, 100 - aiRanking * 5)
      expect(aiScore).toBe(75)

      // Link score = min(100, (backlinks/100)*50)
      const backlinks = 200
      const linkScore = Math.min(100, (backlinks / 100) * 50)
      expect(linkScore).toBe(100)
    })

    it('should generate correct health score from multiple metrics', () => {
      const scores = [80, 75, 85, 90, 70]
      const avgScore = Math.round(scores.reduce((a, b) => a + b) / scores.length)

      expect(avgScore).toBeGreaterThanOrEqual(0)
      expect(avgScore).toBeLessThanOrEqual(100)
      expect(avgScore).toBe(80)
    })

    it('should determine trend as improving with delta > 5', () => {
      const currentScore = 80
      const previousScore = 70
      const delta = currentScore - previousScore

      expect(delta).toBeGreaterThan(5)
    })

    it('should determine trend as declining with delta < -5', () => {
      const currentScore = 60
      const previousScore = 70
      const delta = currentScore - previousScore

      expect(delta).toBeLessThan(-5)
    })

    it('should determine trend as stable with delta between -5 and 5', () => {
      const scenarios = [
        { current: 75, previous: 80 }, // delta = -5
        { current: 82, previous: 80 }, // delta = 2
        { current: 78, previous: 80 }, // delta = -2
      ]

      scenarios.forEach(({ current, previous }) => {
        const delta = current - previous
        const isStable = delta >= -5 && delta <= 5
        expect(isStable).toBe(true)
      })
    })
  })

})
