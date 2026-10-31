import { supabaseAdmin } from '@/lib/supabase'
import { loadProjects } from '@/lib/project-console/load'
import { requireStaffScope } from '@/lib/project-console/staff'
import { Notice } from './_components/Notice'
import { ProjectList } from './_components/ProjectList'

export const dynamic = 'force-dynamic'

export const metadata = { title: '项目 · Magic Engine' }

export default async function ImpactListPage() {
  const scope = await requireStaffScope()
  if (!scope.ok) return <Notice title="项目" body={scope.message} />
  const loaded = await loadProjects(
    supabaseAdmin,
    { clientIds: scope.kind === 'clients' ? scope.clientIds : null },
    new Date().toISOString(),
  )
  if (!loaded.ok) return <Notice title="项目" body={loaded.message} />
  return <ProjectList projects={loaded.projects} />
}
