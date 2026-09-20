import { notFound,redirect } from 'next/navigation'
import { enabled } from '@/lib/meta/ai/contract'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import MetaAdsScreen from './screen'
export default async function Page({ params,searchParams }: { params:{ clientId:string };searchParams:{ outcome?:string } }) {
  if(!enabled()) notFound()
  const access=await requireOnboardingClientAccess(params.clientId)
  if(!access.ok) { if(access.status===401) redirect(`/login?next=${encodeURIComponent(`/meta-ads-ai/${params.clientId}`)}`); notFound() }
  return <MetaAdsScreen clientId={params.clientId} outcome={searchParams.outcome} />
}
export const dynamic='force-dynamic'
