import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deriveProject } from '@/lib/project-console/derive'
import type { ProjectInput } from '@/lib/project-console/types'
import { ProjectList } from './ProjectList'

function waitingProject(): ProjectInput {
  return {
    clientId: 'client-1',
    clientName: '北岛旅行',
    goalId: null,
    goalTitle: null,
    prescriptionId: null,
    brandScan: 'missing',
    chain: null,
    pausedDraftPending: false,
    goLiveDraftIds: [],
    review: null,
    figures: {
      monthlyBudget: null,
      budgetCurrency: null,
      metricLabel: null,
      targetValue: null,
      currentValue: null,
      dailyCapCents: null,
      partial: false,
    },
  }
}

describe('ProjectList', () => {
  it('says who has to click, in Chinese, without a status code', () => {
    render(<ProjectList projects={[deriveProject(waitingProject())]} />)
    expect(screen.getByRole('heading', { name: '项目' })).toBeInTheDocument()
    expect(screen.getByText(/等这一下：去做品牌扫描/)).toBeInTheDocument()
    expect(screen.getByText(/谁来点：内部同事/)).toBeInTheDocument()
    expect(screen.queryByText(/blocked|unread|json/i)).toBeNull()
  })
})
