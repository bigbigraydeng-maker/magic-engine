import { headers } from 'next/headers'
import { redirect, permanentRedirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase'
import PortalNav from './_components/PortalNav'

interface Props {
  children: React.ReactNode
  params: { clientId: string }
}

export default async function PortalLayout({ children, params }: Props) {
  // P29.B.1 — portal routes unified into dashboard; 308 permanent redirect
  permanentRedirect(`/dashboard/clients/${params.clientId}`)

  const headerStore = headers()
  const allowedClientId = headerStore.get('x-allowed-client-id')

  // Middleware already enforces this; keep the server-side guard for direct hits.
  if (!allowedClientId || allowedClientId !== params.clientId) {
    redirect('/unauthorized')
  }

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .eq('id', params.clientId)
    .single()

  const clientName = client?.name
  if (!clientName) redirect('/unauthorized')

  return (
    <div className="min-h-screen bg-[#f6f7f2] text-slate-950">
      <PortalNav clientId={params.clientId} clientName={clientName} />
      <main className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 lg:py-8">
        {children}
      </main>
    </div>
  )
}
