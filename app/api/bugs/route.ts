import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { orchestrateBugTriage } from '@/lib/ai-orchestrator'
import { getSession } from '@/lib/auth'
import { BUG_STATUSES, bugSubmissionSchema, firstIssue } from '@/lib/validation'

// Background triage (after()) runs within this route's duration budget.
export const maxDuration = 120

const BUG_RESPONSE_COLUMNS =
  'id, title, description, steps_to_reproduce, status, ai_severity, human_severity, created_at, reporter:users!reporter_id(name)'

const RATE_WINDOW_MS = 10 * 60 * 1000
const PER_USER_LIMIT = 5
const PER_IP_LIMIT = 10
const GLOBAL_LIMIT = 200

export async function POST(request: Request) {
  try {
    // Reporter identity comes only from the authenticated session.
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Please sign in to submit a bug report.' }, { status: 401 })
    }
    if (!session.role) {
      // No public.users row yet; reporter_id would violate the foreign key.
      return NextResponse.json({ error: 'Your account profile is not set up yet. Please contact support.' }, { status: 403 })
    }

    // 1. Validation (lengths bound AI token spend)
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })
    }
    const parsed = bugSubmissionSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
    }
    const { title, description, steps_to_reproduce } = parsed.data
    const reporterId = session.user.id

    // Service-role client for server-only tables (rate_limits, audit_log) and AI writes.
    const supabase = createAdminClient()

    // 2. Rate limiting: per user, per IP (x-forwarded-for is set by Vercel), and a global cap
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()

    const countSince = (column?: 'user_id' | 'ip_address', value?: string) => {
      let q = supabase.from('rate_limits').select('*', { count: 'exact', head: true }).gte('created_at', since)
      if (column && value) q = q.eq(column, value)
      return q
    }

    const [userCount, ipCount, globalCount] = await Promise.all([
      countSince('user_id', reporterId),
      countSince('ip_address', ip),
      countSince(),
    ])

    if (userCount.error || ipCount.error || globalCount.error) {
      console.error('Rate limit check failed:', userCount.error?.message || ipCount.error?.message || globalCount.error?.message)
      return NextResponse.json({ error: 'Service is temporarily unavailable. Please try again later.' }, { status: 503 })
    }
    if ((userCount.count ?? 0) >= PER_USER_LIMIT || (ipCount.count ?? 0) >= PER_IP_LIMIT) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    }
    if ((globalCount.count ?? 0) >= GLOBAL_LIMIT) {
      return NextResponse.json({ error: 'Service is temporarily busy. Please try again later.' }, { status: 429 })
    }

    await supabase.from('rate_limits').insert({ ip_address: ip, user_id: reporterId })
    // Expire old rate-limit rows (indexed on created_at) so the table stays small.
    await supabase
      .from('rate_limits')
      .delete()
      .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

    // 3. Insert bug report with initial status 'new'
    // Insert as the user so RLS enforces reporter_id = auth.uid().
    const { data: bug, error: bugError } = await session.supabase
      .from('bug_reports')
      .insert({
        title,
        description,
        steps_to_reproduce,
        reporter_id: reporterId,
        status: 'new',
      })
      .select(BUG_RESPONSE_COLUMNS)
      .single()

    if (bugError || !bug) {
      console.error('Error inserting bug report:', bugError?.message)
      return NextResponse.json({ error: 'Unable to complete the request. Please try again.' }, { status: 500 })
    }

    // 4. Initial submission audit log
    await supabase.from('audit_log').insert({
      bug_id: bug.id,
      action: 'Bug report submitted by reporter',
      actor: reporterId,
    })

    // 5. AI triage runs after the response is sent, so slow providers never block submission.
    // The orchestrator handles classification, tagging, pgvector duplicates, the confidence
    // threshold (<0.6 => pending_review) and fault tolerance (=> pending_triage).
    after(async () => {
      try {
        await orchestrateBugTriage(bug.id, { title, description, steps_to_reproduce })
      } catch (aiErr) {
        console.error('AI Orchestration uncaught fallback error:', aiErr instanceof Error ? aiErr.message : aiErr)
        await createAdminClient().from('bug_reports').update({ status: 'pending_triage' }).eq('id', bug.id)
      }
    })

    return NextResponse.json({ success: true, bug }, { status: 201 })
  } catch (err: unknown) {
    console.error('API /api/bugs error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Something went wrong processing your request. Please try again.' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('pageSize') || '25', 10) || 25))

    if (status && status !== 'all' && !(BUG_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
    }

    // Session client: RLS returns only the reporter's own bugs; staff see all.
    let query = session.supabase
      .from('bug_reports')
      .select('id, title, description, status, ai_severity, human_severity, created_at, reporter:users!reporter_id(name)', {
        count: 'exact',
      })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data: bugs, error, count } = await query

    if (error) {
      console.error('Error fetching bug reports:', error.message)
      return NextResponse.json({ error: 'Unable to complete the request. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ bugs, page, pageSize, total: count ?? 0 })
  } catch (err: unknown) {
    console.error('API /api/bugs GET error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Something went wrong processing your request. Please try again.' }, { status: 500 })
  }
}
