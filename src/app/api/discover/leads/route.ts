import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { url?: string; name?: string; email?: string };
    const { url, name, email } = body;

    if (!url || !email) {
      return NextResponse.json({ error: 'url and email are required' }, { status: 400 });
    }

    // Try to save to discovery_leads table (table may not exist yet — silent failure)
    try {
      await supabaseAdmin
        .from('discovery_leads')
        .insert({ url, name: name ?? null, email, created_at: new Date().toISOString() })
    } catch {
      // silent failure: lead capture must not block the public flow
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true }); // Always succeed from client perspective
  }
}
