import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadProjects } from '@/lib/project-console/load'
import { requireStaffScope } from '@/lib/project-console/staff'
import { Notice } from '../_components/Notice'
import { ProjectDetail } from '../_components/ProjectDetail'

export const dynamic = 'force-dynamic'

export default async function ImpactDetailPage({ params }: { params: { clientId: string } }) {
  const scope = await requireStaffScope()
  if (!scope.ok) return <Notice title="项目" body={scope.message} back />
  if (scope.kind === 'one' && scope.clientId !== params.clientId) {
    return <Notice title="无权访问" body="这不是你负责的客户。" back />
  }
  const access = await requireDashboardClientAccess(params.clientId)
  if (!access.ok) return <Notice title="无权访问" body="打不开这个客户。" back />

  const loaded = await loadProjects(supabaseAdmin, { clientId: params.clientId }, new Date().toISOString())
  if (!loaded.ok) return <Notice title="项目" body={loaded.message} back />
  const project = loaded.projects[0]
  if (!project) return <Notice title="没有这个客户" body="名单里没有这一条。" back />
  return <ProjectDetail project={project} />
}
