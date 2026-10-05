// Pins existing behaviour: the server-side admin client must NEVER silently
// fall back to the anonymous client. When SUPABASE_SERVICE_ROLE_KEY is unset,
// importing '@/lib/supabase' throws. (route-a/b/c still contain a stale
// 'using anon client' console.error that can never run.)

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('@/lib/supabase service-role enforcement', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('throws when SUPABASE_SERVICE_ROLE_KEY is unset (empty string)', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    await expect(import('@/lib/supabase')).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('succeeds and exposes a distinct admin client when all env vars are set', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key');

    const mod = await import('@/lib/supabase');

    expect(mod.supabaseAdmin).toBeDefined();
    expect(mod.supabase).toBeDefined();
    expect(mod.supabaseAdmin).not.toBe(mod.supabase);
  });

  it('throws for the anon-key reason when NEXT_PUBLIC_SUPABASE_ANON_KEY is unset', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test-key');

    await expect(import('@/lib/supabase')).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY/
    );
  });
});
