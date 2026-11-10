/**
 * The AI digital-human steward page moved to the standalone Magic Network site (PM 2026-11-10
 * 「Redirect now」). This address stays alive for old links and sends visitors there, keeping ?ref=.
 */
import { redirect } from 'next/navigation'
import { magicNetworkUrl } from '@/lib/magic-network-url'

export const dynamic = 'force-dynamic'

export default async function AiStewardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(magicNetworkUrl('/products/ai-steward', await searchParams))
}
