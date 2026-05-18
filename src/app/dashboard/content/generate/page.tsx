import { redirect } from 'next/navigation'

// Content generation happens via the client GenerationDrawer (/dashboard/clients/[id])
export default function GenerateContentPage() {
  redirect('/dashboard/clients')
}
