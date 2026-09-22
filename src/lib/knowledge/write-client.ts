/**
 * The minimal supabase-js surface the knowledge module's WRITE paths call
 * (`review.ts`, `confirmation-requests.ts`).
 *
 * Deliberately separate from `db-client.ts` (`KnowledgeSupabaseClient`): that
 * one is the narrow READ surface shared by many read-only callers, and adding
 * `insert`/`update` to it would hand every one of them write capability in
 * the type system for free — the opposite of least privilege. Same reasoning
 * `confirmers.ts` already used when it defined its own write interface; this
 * file is the generalised version so a third write module doesn't spawn a
 * third near-identical copy.
 *
 * 🔴 The real supabase-js builder is thenable at EVERY step (not only at some
 * terminal method), so these interfaces extend `PromiseLike` rather than
 * requiring a `.execute()` that doesn't exist. Test fakes must model the same
 * PostgREST behaviours the real client has, in particular:
 *   - `insert(...)` / `update(...)` WITHOUT a trailing `.select()` resolve
 *     with `data: null` — not with the written rows;
 *   - a unique-constraint violation arrives as `error.code === '23505'`, it
 *     is not thrown;
 *   - a trigger's `RAISE EXCEPTION` arrives as `error.message`, also not
 *     thrown.
 * A fake that is more lenient than the real database is exactly how a real
 * bug shipped in this module area on 2026-09-14 and passed review.
 */

export interface KnowledgeWriteResult {
  data: unknown
  error: { message?: string; code?: string } | null
}

export interface KnowledgeSelectBuilder extends PromiseLike<KnowledgeWriteResult> {
  eq(column: string, value: unknown): KnowledgeSelectBuilder
  is(column: string, value: null): KnowledgeSelectBuilder
  in(column: string, values: readonly unknown[]): KnowledgeSelectBuilder
  order(column: string, opts?: { ascending?: boolean }): KnowledgeSelectBuilder
  limit(n: number): KnowledgeSelectBuilder
}

export interface KnowledgeUpdateBuilder extends PromiseLike<KnowledgeWriteResult> {
  eq(column: string, value: unknown): KnowledgeUpdateBuilder
  is(column: string, value: null): KnowledgeUpdateBuilder
  /** Without this, PostgREST returns `data: null` — the only way to know how many rows an update actually hit. */
  select(columns: string): KnowledgeUpdateBuilder
}

export interface KnowledgeInsertBuilder extends PromiseLike<KnowledgeWriteResult> {
  select(columns: string): KnowledgeInsertBuilder
}

export interface KnowledgeWriteTable {
  select(columns: string): KnowledgeSelectBuilder
  insert(row: Record<string, unknown>): KnowledgeInsertBuilder
  update(fields: Record<string, unknown>): KnowledgeUpdateBuilder
}

export interface KnowledgeWriteClient {
  from(table: string): KnowledgeWriteTable
  /**
   * Call a Postgres function (one statement-level transaction). The only
   * write path that needs this today is `consume_knowledge_confirmation_request`
   * — claiming a confirmation request AND writing every fact's sign-off must
   * commit or roll back together, which a sequence of separate `.update()`
   * calls from JS cannot guarantee (see confirmation-requests.ts).
   */
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<KnowledgeWriteResult>
}

/**
 * PostgREST hands back untyped records; this is the single place that narrows
 * them, so the reason is written down once instead of at every call site.
 * Column names at each call site are taken from the `supabase/migrations`
 * CREATE TABLE statements, and the write paths that use them are replayed
 * against a real local Postgres sandbox (see this module's SQL probe script)
 * rather than trusted from reading the SQL alone.
 */
export function asRows<T>(data: unknown): T[] {
  return (data ?? []) as T[]
}
