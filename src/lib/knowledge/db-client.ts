/**
 * The minimal query-builder surface `entitlement.ts` / `read.ts` actually
 * call. Defined locally (instead of importing `SupabaseClient` from
 * `@supabase/supabase-js` everywhere) so:
 *
 *   - tests can inject a small in-memory fake
 *     (`__tests__/fake-supabase.ts`) that structurally satisfies this
 *     interface without needing a cast to the real, much larger
 *     `SupabaseClient` type;
 *   - the real `supabaseAdmin` (a genuine `SupabaseClient`) is still
 *     assignable here as-is — its `.from(table)` builder implements every
 *     method below plus many more, and TypeScript's structural typing
 *     accepts a wider type wherever a narrower one is expected.
 */

export interface KnowledgeQueryResult {
  data: Array<Record<string, unknown>> | null
  error: { message?: string } | null
}

export interface KnowledgeTableHandle {
  select(columns: string): KnowledgeFilterBuilder
}

export interface KnowledgeFilterBuilder {
  eq(column: string, value: unknown): KnowledgeFilterBuilder
  lte(column: string, value: string): KnowledgeFilterBuilder
  is(column: string, value: null): KnowledgeFilterBuilder
  or(expr: string): KnowledgeFilterBuilder
  order(column: string, opts?: { ascending?: boolean }): KnowledgeFilterBuilder
  limit(n: number): KnowledgeFilterBuilder
  then<TResult1 = KnowledgeQueryResult, TResult2 = never>(
    onfulfilled?: ((value: KnowledgeQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>
}

export interface KnowledgeSupabaseClient {
  from(table: string): KnowledgeTableHandle
}
