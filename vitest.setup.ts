/**
 * Vitest Setup File
 * Configures global test utilities and mocks
 */

import { vi } from 'vitest'
import '@testing-library/jest-dom'

// jsdom has no ResizeObserver — needed by any chart using recharts' ResponsiveContainer.
class ResizeObserverStub implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe(_target: Element) {}
  unobserve(_target: Element) {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub

// Mock environment variables for tests
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.OPENAI_API_KEY = 'test-openai-key'

// Global test utilities
export const createMockNextRequest = (
  url: string,
  options?: {
    method?: string
    body?: Record<string, unknown>
    headers?: Record<string, string>
  }
) => {
  const searchParams = new URL(url, 'http://localhost:3000').searchParams
  return {
    url,
    method: options?.method || 'GET',
    body: options?.body ? JSON.stringify(options.body) : undefined,
    headers: options?.headers || {},
    searchParams,
    json: async () => options?.body || {},
  }
}

// Mock Supabase error handler
export const mockSupabaseError = (message: string, statusCode: number = 500) => {
  const error = new Error(message)
  return {
    message,
    status: statusCode,
    toString: () => message,
  }
}
