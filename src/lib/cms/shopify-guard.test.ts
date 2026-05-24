/**
 * shopify-guard unit tests — Phase 14.A.4
 */

import { describe, it, expect } from 'vitest'
import { validateShopifyShopUrl, shopifyAdminBase } from './shopify-guard'

describe('validateShopifyShopUrl', () => {
  // ── Valid inputs ─────────────────────────────────────────────────────────

  it('accepts a plain myshopify.com domain', () => {
    const r = validateShopifyShopUrl('my-store.myshopify.com')
    expect(r.ok).toBe(true)
    expect(r.normalizedUrl).toBe('https://my-store.myshopify.com')
  })

  it('accepts an https:// prefixed myshopify.com URL', () => {
    const r = validateShopifyShopUrl('https://my-store.myshopify.com')
    expect(r.ok).toBe(true)
    expect(r.normalizedUrl).toBe('https://my-store.myshopify.com')
  })

  it('accepts a custom domain with https', () => {
    const r = validateShopifyShopUrl('https://shop.example.com')
    expect(r.ok).toBe(true)
    expect(r.normalizedUrl).toBe('https://shop.example.com')
  })

  it('strips path and query from URL', () => {
    const r = validateShopifyShopUrl('https://my-store.myshopify.com/admin?foo=bar')
    expect(r.ok).toBe(true)
    expect(r.normalizedUrl).toBe('https://my-store.myshopify.com')
  })

  // ── Rejection: non-HTTPS ─────────────────────────────────────────────────

  it('rejects http://', () => {
    const r = validateShopifyShopUrl('http://my-store.myshopify.com')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/https/)
  })

  // ── Rejection: private / localhost ───────────────────────────────────────

  it('rejects localhost', () => {
    expect(validateShopifyShopUrl('localhost').ok).toBe(false)
  })

  it('rejects *.local domains', () => {
    expect(validateShopifyShopUrl('shop.local').ok).toBe(false)
  })

  it('rejects private IPv4 10.x.x.x', () => {
    const r = validateShopifyShopUrl('https://10.0.0.1')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/IP|private/i)
  })

  it('rejects private IPv4 192.168.x.x', () => {
    const r = validateShopifyShopUrl('https://192.168.1.1')
    expect(r.ok).toBe(false)
  })

  it('rejects IPv4 public IP addresses', () => {
    const r = validateShopifyShopUrl('https://1.2.3.4')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/IP address/i)
  })

  it('rejects non-standard port', () => {
    const r = validateShopifyShopUrl('https://my-store.myshopify.com:8080')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/port/i)
  })

  it('rejects embedded credentials', () => {
    const r = validateShopifyShopUrl('https://user:pass@my-store.myshopify.com')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/credentials/i)
  })

  it('rejects single-label host', () => {
    expect(validateShopifyShopUrl('shopify').ok).toBe(false)
  })

  it('rejects empty input', () => {
    expect(validateShopifyShopUrl('').ok).toBe(false)
    expect(validateShopifyShopUrl(null).ok).toBe(false)
    expect(validateShopifyShopUrl(undefined).ok).toBe(false)
  })

  it('rejects .internal domains', () => {
    expect(validateShopifyShopUrl('shop.internal').ok).toBe(false)
  })
})

describe('shopifyAdminBase', () => {
  it('builds the expected admin API base URL', () => {
    expect(shopifyAdminBase('https://my-store.myshopify.com'))
      .toBe('https://my-store.myshopify.com/admin/api/2024-01')
  })

  it('respects a custom API version', () => {
    expect(shopifyAdminBase('https://my-store.myshopify.com', '2025-01'))
      .toBe('https://my-store.myshopify.com/admin/api/2025-01')
  })
})
