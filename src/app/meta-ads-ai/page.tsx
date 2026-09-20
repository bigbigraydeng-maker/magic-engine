import Link from 'next/link'
import { notFound } from 'next/navigation'
import { enabled } from '@/lib/meta/ai/contract'
export default function MetaAdsRecovery() {
  if(!enabled()) notFound()
  return <main className="mx-auto max-w-xl space-y-4 p-8"><h1 className="text-2xl font-semibold">Facebook connection not completed</h1>
    <p>The authorisation expired, was cancelled, or was opened in a different browser session. Your existing ads have not been changed.</p>
    <p>Sign in to Magic Engine, open your client workspace and choose “Connect Meta Ads to your AI” to try again in the same browser.</p>
    <Link className="underline" href="/dashboard">Return to your workspace</Link></main>
}
