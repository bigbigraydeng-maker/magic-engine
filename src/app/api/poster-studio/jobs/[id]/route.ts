import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkImageStatus } from '@/lib/visual/atlas'

// GET /api/poster-studio/jobs/[id] — poll job status (image completion)
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params

  const { data: job, error } = await supabaseAdmin
    .from('poster_studio_jobs')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // If image is still in flight, poll Atlas
  if (job.atlas_job_id && job.image_status === 'pending' || job.image_status === 'processing') {
    try {
      const result = await checkImageStatus(job.atlas_job_id)

      if (result.status === 'completed' && result.image_url) {
        await supabaseAdmin
          .from('poster_studio_jobs')
          .update({
            image_url: result.image_url,
            image_status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)

        return NextResponse.json({ ...job, image_url: result.image_url, image_status: 'completed' })
      }

      if (result.status === 'failed') {
        await supabaseAdmin
          .from('poster_studio_jobs')
          .update({ image_status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', id)
        return NextResponse.json({ ...job, image_status: 'failed' })
      }

      return NextResponse.json({ ...job, image_status: result.status })
    } catch {
      // Non-fatal: return current state if Atlas poll fails
      return NextResponse.json(job)
    }
  }

  return NextResponse.json(job)
}
