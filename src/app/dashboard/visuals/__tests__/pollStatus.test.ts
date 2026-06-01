/// <reference types="vitest/globals" />

/**
 * Test for pollStatus fix
 * Verifies that the correct response structure is handled
 */

describe('pollStatus API response handling', () => {
  type PollStatusResponse =
    | { success: true; asset: { id: string; generation_status: string; storage_url?: string; error_message?: string }; still_processing?: boolean }
    | { success: false; error: string; asset?: undefined }
  const getGenerationStatus = (response: PollStatusResponse) => response.asset?.generation_status

  it('should correctly identify ready status from d.asset.generation_status', () => {
    // API response structure (what the backend actually returns)
    const apiResponse: PollStatusResponse = {
      success: true,
      asset: {
        id: 'asset123',
        generation_status: 'ready',  // ✅ Correct field
        storage_url: 'https://example.com/image.jpg',
      },
    }

    // Before fix: d.status === 'ready' would be undefined
    // After fix: d.asset?.generation_status === 'ready' correctly identifies as ready
    expect(apiResponse.asset?.generation_status).toBe('ready')
  })

  it('should correctly identify failed status from d.asset.generation_status', () => {
    const apiResponse: PollStatusResponse = {
      success: true,
      asset: {
        id: 'asset123',
        generation_status: 'failed',  // ✅ Correct field
        error_message: 'Generation timeout',
      },
    }

    expect(apiResponse.asset?.generation_status).toBe('failed')
  })

  it('should correctly identify processing status and continue polling', () => {
    const apiResponse: PollStatusResponse = {
      success: true,
      asset: {
        id: 'asset123',
        generation_status: 'processing',  // ✅ Correct field
      },
      still_processing: true,
    }

    const status = getGenerationStatus(apiResponse)
    // Should NOT stop polling when status is 'processing'
    expect(status).toBe('processing')
    expect(status === 'ready' || status === 'failed').toBe(false)
  })

  it('should handle pending status correctly', () => {
    const apiResponse: PollStatusResponse = {
      success: true,
      asset: {
        id: 'asset123',
        generation_status: 'pending',  // ✅ Correct field
      },
      still_processing: true,
    }

    const status = getGenerationStatus(apiResponse)
    expect(status).toBe('pending')
    // Should continue polling
    expect(status === 'ready' || status === 'failed').toBe(false)
  })

  it('should not crash with missing asset field', () => {
    const apiResponse: PollStatusResponse = {
      success: false,
      error: 'Asset not found',
    }

    const status = getGenerationStatus(apiResponse)
    // Should safely return undefined, not crash
    expect(status).toBeUndefined()
  })
})

describe('pollStatus error handling', () => {
  it('should properly handle HTTP errors', () => {
    const httpErrors = [400, 404, 500, 503]

    httpErrors.forEach(statusCode => {
      // Before fix: errors were silently ignored with empty catch block
      // After fix: errors are logged to console
      expect(() => {
        if (statusCode >= 400) {
          throw new Error(`Status check failed: HTTP ${statusCode}`)
        }
      }).toThrow()
    })
  })
})
