import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/** Liveness + database reachability for uptime monitors. Returns no data or config details. */
export async function GET() {
  try {
    const { error } = await createAdminClient().from('tags').select('id', { head: true, count: 'exact' }).limit(1)
    if (error) throw new Error(error.message)
    return NextResponse.json({ status: 'ok', database: 'ok' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('Health check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ status: 'degraded', database: 'unreachable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
