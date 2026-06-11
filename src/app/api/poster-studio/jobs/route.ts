import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// GET /api/poster-studio/jobs — list recent 20 jobs
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('poster_studio_jobs')
    .select('id, mode, platform, source_label, status, image_status, created_at, generated_copy, image_url')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ jobs: data ?? [] })
}
