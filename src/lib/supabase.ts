/**
 * Supabase client initialization and utilities
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
  );
}

// Public client (for client-side, respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client (for server-side API routes, bypasses RLS)
// Fail loudly at startup rather than silently falling back to anon key,
// which would cause all admin operations to fail with confusing RLS errors.
if (!supabaseServiceKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY — server cannot start without it');
}
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  // 🔴 数据库读取绝不许走 Next 的 fetch 缓存。
  // Next 14 会把 App Router 里的 GET fetch 缓存起来——Supabase 客户端底下就是 fetch，
  // 于是「读一次库」可能拿到的是上一轮的旧快照。
  // 真实事故(2026-08-04):讲课片发布成功后清掉了待发布标记,但下一轮 cron 读到的还是
  // 缓存里那份「待发布」,同一条片连发了三次;而发布回执也被旧快照覆写掉,页面上看着像没发过。
  // 缓存一条数据库读 = 拿过期状态做决策,对写操作来说等于重复执行。
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, cache: 'no-store' }),
  },
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    // Use implicit flow so signInWithOtp does NOT generate a PKCE code_challenge.
    // If PKCE is used server-side, the code_verifier is stored in MemoryStorage and
    // is lost after the request — the user's callback can never retrieve it.
    flowType: 'implicit',
  },
});

/**
 * Helper function to handle Supabase errors
 */
export function handleSupabaseError(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: 'Unknown error occurred' };
}

/**
 * Verify project access (placeholder - no auth system yet, always allows)
 * TODO: Add proper auth when user login is implemented
 */
export async function verifyProjectOwnership(_projectId: string): Promise<boolean> {
  return true;
}

/**
 * Ensure default project exists in the database
 */
export async function ensureDefaultProject(projectId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('projects')
    .upsert([{
      id: projectId,
      user_id: '00000000-0000-0000-0000-000000000000',
      name: 'Default Project',
    }], { onConflict: 'id' });

  if (error) {
    console.warn('Failed to ensure default project:', error.message);
  }
}
