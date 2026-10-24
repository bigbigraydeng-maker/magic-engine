/**
 * Close execution_items left in_progress with no update for more than 30 days.
 *
 * Default is dry-run: list the rows and write nothing.
 * Pass --apply to mark them skipped with auto_run_error stale_in_progress_30d.
 *
 * Do not run this against production as part of the change that added it.
 * It needs the app's service-role env. The weekly prescribe job and a non-dry
 * auto-run already call the same close.
 *
 *   npx esbuild scripts/close-stale-in-progress-execution-items.ts --bundle --platform=node \
 *     --format=esm --packages=external --outfile=/tmp/close-stale.mjs
 *   node --env-file=.env.local /tmp/close-stale.mjs [--apply]
 */

import { closeStaleInProgressItems } from '../src/lib/execution/auto-run'
import { listStaleInProgressItems } from '../src/lib/execution/stale-in-progress'
import { supabaseAdmin } from '../src/lib/supabase'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const now = new Date()
  const rows = await listStaleInProgressItems(supabaseAdmin, now)
  console.log(`stale in_progress (>30d): ${rows.length}`)
  for (const row of rows) {
    console.log(`${row.id}\t${row.client_id}\t${row.updated_at ?? ''}\t${row.title ?? ''}`)
  }
  if (!apply) {
    console.log('dry-run: nothing written. Pass --apply to mark them skipped.')
    return
  }
  const closed = await closeStaleInProgressItems(supabaseAdmin, now)
  console.log(`closed: ${closed}`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
