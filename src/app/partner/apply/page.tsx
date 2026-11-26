/**
 * The distributor application moved to the standalone Magic Network site (PM 2026-11-10
 * 「Redirect now」). This address stays alive for old links and sends visitors there, keeping ?ref=.
 * The form, rules and simulator components in this folder are no longer rendered here; they are
 * removed together with the rest of the old ME pages once the new site has its own database.
 */
import { redirect } from 'next/navigation'
import { magicNetworkUrl } from '@/lib/magic-network-url'

export const dynamic = 'force-dynamic'

export default async function ApplyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(magicNetworkUrl('/join', await searchParams))
}
