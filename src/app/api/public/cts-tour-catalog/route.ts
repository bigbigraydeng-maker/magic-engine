import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { todayIso } from '@/lib/tour-catalog/dates';
import { loadPublishedProducts } from '@/lib/tour-catalog/store-publish';

export const dynamic = 'force-dynamic';

const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000';
const PUBLIC_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=15',
};
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

/**
 * Public, read-only CTS website feed. It reads only the published snapshot and
 * returns only the first-party product projection; draft and internal fields
 * never cross this boundary.
 */
export async function GET() {
  try {
    const catalog = await loadPublishedProducts(
      supabaseAdmin,
      CTS_CLIENT_ID,
      todayIso(new Date()),
    );
    if (!catalog.published) {
      return NextResponse.json(
        { published: false, version: null, products: [] },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        published: true,
        version: catalog.version,
        products: catalog.tours,
      },
      { headers: PUBLIC_CACHE_HEADERS },
    );
  } catch (error) {
    console.error(
      'cts_public_tour_catalog_failed',
      error instanceof Error ? error.name : 'unknown',
    );
    return NextResponse.json(
      { published: false, version: null, products: [] },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
