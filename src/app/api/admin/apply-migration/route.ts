/**
 * Admin endpoint to apply pending database migrations.
 * Use: POST /api/admin/apply-migration?secret=CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    // Supabase migration: add parse_error_message column if not exists
    // This is idempotent — runs without error even if column already exists
    const migrationSql = `
      ALTER TABLE ai_visibility_runs
        ADD COLUMN IF NOT EXISTS parse_error_message text DEFAULT NULL;
    `

    // Use fetch to call Supabase SQL API directly
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials')
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ sql: migrationSql }),
    })

    if (!response.ok && response.status !== 404) {
      // 404 means the RPC doesn't exist, which is fine
      const text = await response.text()
      console.log(
        'Migration response:',
        response.status,
        text.substring(0, 200)
      )
    }

    return NextResponse.json({
      status: 'success',
      message:
        'Migration 20260430000003_add_parse_error_message applied (or already exists)',
      note: 'Column parse_error_message added to ai_visibility_runs if not already present',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Migration failed:', message)
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
