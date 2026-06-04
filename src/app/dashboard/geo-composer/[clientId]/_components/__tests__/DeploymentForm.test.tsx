/**
 * Tests for DeploymentForm — MF8 drift banner behaviour (GEO-B+ Stage 1)
 *
 * MF8 (魏征 B2 review): when the FDE dismisses the drift dialog without
 * choosing, a yellow banner must remain so they can re-open the dialog.
 * These tests exercise the three state transitions:
 *
 *   1. EXTERNAL_DRIFT response  →  ConfirmDialog opens immediately
 *   2. FDE cancels dialog       →  yellow banner appears + "Review drift &
 *                                  choose →" button is visible
 *   3. FDE clicks that button   →  ConfirmDialog re-opens
 *   4. FDE confirms force       →  fetch called with force_overwrite=true
 *   5. Other error codes still  →  red error banner (not yellow drift banner)
 *      show the regular error banner
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { DeploymentForm } from '../DeploymentForm'
import type { GeoDirective } from '@/types/magic-engine'

void React

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/geo/html-generator', () => ({
  generateDirectiveHtml: vi.fn(() => '<script>GEO</script>'),
}))

vi.mock('@/lib/deployment-constants', () => ({
  DEPLOYMENT_CONFIG: {
    API:     { RECORD_DEPLOYMENT: (id: string) => `/api/clients/${id}/geo/deployments` },
    ERRORS:  { RECORD_FAILED: 'Failed to record deployment. Please try again.' },
    SUCCESS: { DEPLOYMENT_RECORDED: 'Deployment recorded successfully' },
    LABELS:  {
      MARK_DEPLOYED:   'Mark as Deployed',
      INSTALL_SNIPPET: 'Installation Instructions',
    },
  },
}))

// Mock child UI components to render minimal HTML so we can assert on them
vi.mock('../UrlInput', () => ({
  UrlInput: ({ onChange, onValidChange }: { onChange: (v: string) => void; onValidChange: (v: boolean) => void }) => (
    <input
      data-testid="url-input"
      onChange={e => { onChange(e.target.value); onValidChange(e.target.value.startsWith('https://')) }}
    />
  ),
}))

vi.mock('../CodeSnippetBox', () => ({
  CodeSnippetBox: ({ code }: { code: string }) => <pre data-testid="snippet">{code}</pre>,
}))

// ConfirmDialog: render a simple div with the title + buttons when isOpen=true
vi.mock('../ConfirmDialog', () => ({
  ConfirmDialog: ({
    isOpen,
    title,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean
    title: string
    confirmLabel?: string
    cancelLabel?: string
    onConfirm: () => void
    onCancel: () => void
  }) => isOpen ? (
    <div data-testid="confirm-dialog">
      <span data-testid="dialog-title">{title}</span>
      <button data-testid="dialog-confirm" onClick={onConfirm}>{confirmLabel ?? 'Confirm'}</button>
      <button data-testid="dialog-cancel"  onClick={onCancel}>{cancelLabel ?? 'Cancel'}</button>
    </div>
  ) : null,
}))

// ── Test fixtures ─────────────────────────────────────────────────────────────

const DIRECTIVE: GeoDirective = {
  id:            '12345678-0000-0000-0000-000000000000',
  client_id:     'client-abc',
  status:        'active',
  name:          'Test directive',
  audience:      'Kiwi travelers',
  brand_context: 'A travel brand',
  geo_signals:   [],
  created_at:    '2026-06-04T00:00:00Z',
  updated_at:    '2026-06-04T00:00:00Z',
} as unknown as GeoDirective

const GITHUB_PROVIDERS = {
  github: { connected: true, status: 'connected' as const },
}

function makeDriftResponse(driftedPaths: string[] = ['layouts/main.html']) {
  return {
    ok: false,
    json: vi.fn().mockResolvedValue({
      success:          false,
      code:             'EXTERNAL_DRIFT',
      error:            `${driftedPaths.length} target(s) were edited outside Magic Engine.`,
      drifted_targets:  driftedPaths.map(p => ({
        path:          p,
        expected_hash: 'abc',
        live_hash:     'xyz',
      })),
    }),
  }
}

function makeSuccessResponse(prUrl = 'https://github.com/acme/repo/pull/1') {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      success:      true,
      pr_url:       prUrl,
      pr_number:    1,
      target_paths: ['layouts/main.html'],
    }),
  }
}

function makeErrorResponse(code: string, message: string) {
  return {
    ok: false,
    json: vi.fn().mockResolvedValue({
      success: false,
      code,
      error:   message,
    }),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DeploymentForm — MF8 drift banner', () => {
  const CLIENT_ID = 'client-abc'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('1. EXTERNAL_DRIFT response opens ConfirmDialog immediately', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDriftResponse()))

    render(
      <DeploymentForm
        clientId={CLIENT_ID}
        directive={DIRECTIVE}
        cmsProviders={GITHUB_PROVIDERS}
      />,
    )

    fireEvent.click(screen.getByText('Open Pull Request'))

    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      expect(screen.getByTestId('dialog-title')).toHaveTextContent('External edits detected')
    })

    // Yellow banner should NOT be visible yet (dialog is open)
    expect(screen.queryByText(/Review drift & choose/)).toBeNull()
  })

  it('2. Cancelling the drift dialog shows yellow banner with "Review drift & choose" button', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDriftResponse()))

    render(
      <DeploymentForm
        clientId={CLIENT_ID}
        directive={DIRECTIVE}
        cmsProviders={GITHUB_PROVIDERS}
      />,
    )

    fireEvent.click(screen.getByText('Open Pull Request'))

    // Wait for dialog
    await waitFor(() => screen.getByTestId('confirm-dialog'))

    // Cancel the dialog
    fireEvent.click(screen.getByTestId('dialog-cancel'))

    // Dialog should be gone
    expect(screen.queryByTestId('confirm-dialog')).toBeNull()

    // Yellow banner should now be visible
    await waitFor(() => {
      expect(screen.getByText(/Drift detected on 1 file/)).toBeInTheDocument()
      expect(screen.getByText(/Review drift & choose →/)).toBeInTheDocument()
    })
  })

  it('3. Clicking "Review drift & choose →" re-opens the ConfirmDialog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDriftResponse()))

    render(
      <DeploymentForm
        clientId={CLIENT_ID}
        directive={DIRECTIVE}
        cmsProviders={GITHUB_PROVIDERS}
      />,
    )

    fireEvent.click(screen.getByText('Open Pull Request'))
    await waitFor(() => screen.getByTestId('confirm-dialog'))
    fireEvent.click(screen.getByTestId('dialog-cancel'))
    await waitFor(() => screen.getByText(/Review drift & choose →/))

    // Re-open
    fireEvent.click(screen.getByText(/Review drift & choose →/))

    await waitFor(() => {
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      expect(screen.getByTestId('dialog-title')).toHaveTextContent('External edits detected')
    })
  })

  it('4. Confirming force_overwrite calls fetch with force_overwrite=true', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeDriftResponse())
      .mockResolvedValueOnce(makeSuccessResponse())
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DeploymentForm
        clientId={CLIENT_ID}
        directive={DIRECTIVE}
        cmsProviders={GITHUB_PROVIDERS}
      />,
    )

    // Trigger drift
    fireEvent.click(screen.getByText('Open Pull Request'))
    await waitFor(() => screen.getByTestId('confirm-dialog'))

    // Confirm the force overwrite
    fireEvent.click(screen.getByTestId('dialog-confirm'))

    // Second fetch should have force_overwrite=true
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const [, secondInit] = fetchMock.mock.calls[1] as [string, { body: string }]
      const secondBody = JSON.parse(secondInit.body) as { force_overwrite: boolean }
      expect(secondBody.force_overwrite).toBe(true)
    })

    // Yellow banner should be gone (PR success clears state)
    await waitFor(() => {
      expect(screen.queryByText(/Review drift & choose/)).toBeNull()
    })
  })

  it('5. Non-drift errors show regular red error banner, not yellow drift banner', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeErrorResponse('GITHUB_API_ERROR', 'Token expired'),
    ))

    render(
      <DeploymentForm
        clientId={CLIENT_ID}
        directive={DIRECTIVE}
        cmsProviders={GITHUB_PROVIDERS}
      />,
    )

    fireEvent.click(screen.getByText('Open Pull Request'))

    await waitFor(() => {
      expect(screen.getByText('Token expired')).toBeInTheDocument()
    })

    // Must be the red error, not yellow drift banner
    expect(screen.queryByText(/Review drift & choose/)).toBeNull()
    expect(screen.queryByTestId('confirm-dialog')).toBeNull()
  })

  it('6. Multi-file drift shows correct file count in yellow banner', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeDriftResponse(['layouts/main.html', 'header.php', 'footer.php']),
    ))

    render(
      <DeploymentForm
        clientId={CLIENT_ID}
        directive={DIRECTIVE}
        cmsProviders={GITHUB_PROVIDERS}
      />,
    )

    fireEvent.click(screen.getByText('Open Pull Request'))
    await waitFor(() => screen.getByTestId('confirm-dialog'))
    fireEvent.click(screen.getByTestId('dialog-cancel'))

    await waitFor(() => {
      expect(screen.getByText(/Drift detected on 3 files/)).toBeInTheDocument()
    })
  })
})
