import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { orchestrateBugTriage } from '@/lib/ai-orchestrator'
import { getSession } from '@/lib/auth'

const BUG_RESPONSE_COLUMNS =
  'id, title, description, steps_to_reproduce, status, ai_severity, human_severity, created_at, reporter:users!reporter_id(name)'

const BUG_STATUSES = ['new', 'pending_triage', 'pending_review', 'triaged', 'in_progress', 'resolved', 'closed']

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

    const body = await request.json()
    const { title, description, steps_to_reproduce } = body

    // 1. Basic validation
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }

    if (steps_to_reproduce != null && typeof steps_to_reproduce !== 'string') {
      return NextResponse.json({ error: 'Steps to reproduce must be text' }, { status: 400 })
    }

    // Service-role client for server-only tables (rate_limits, audit_log) and AI writes.
    const supabase = createAdminClient()

    // 1.5 Rate Limiting
    // Requests with no determinable client IP share a single 'unknown' bucket,
    // so they are still capped at PER_IP_LIMIT and can't collectively bypass it.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const PER_IP_LIMIT = 5
    const GLOBAL_LIMIT = 100

    const { count: ipCount } = await supabase
      .from('rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .gte('created_at', tenMinsAgo)

    if (ipCount && ipCount >= PER_IP_LIMIT) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    }

    // Global safeguard: bounds total AI-orchestrator spend even under a
    // distributed flood across many different IPs.
    const { count: globalCount } = await supabase
      .from('rate_limits')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', tenMinsAgo)

    if (globalCount && globalCount >= GLOBAL_LIMIT) {
      return NextResponse.json({ error: 'Service is temporarily busy. Please try again later.' }, { status: 429 })
    }

    await supabase.from('rate_limits').insert({ ip_address: ip })

    const reporterId = session.user.id

    // 3. Insert bug report with initial status 'new'
    // Insert as the user so RLS enforces reporter_id = auth.uid().
    const { data: bug, error: bugError } = await session.supabase
      .from('bug_reports')
      .insert({
        title: title.trim(),
        description: description.trim(),
        steps_to_reproduce: steps_to_reproduce ? steps_to_reproduce.trim() : null,
        reporter_id: reporterId,
        status: 'new',
      })
      .select(BUG_RESPONSE_COLUMNS)
      .single()

    if (bugError || !bug) {
      console.error('Error inserting bug report:', bugError)
      return NextResponse.json({ error: 'Unable to complete the request. Please try again.' }, { status: 500 })
    }

    // 4. Initial submission audit log
    await supabase.from('audit_log').insert({
      bug_id: bug.id,
      action: 'Bug report submitted by reporter',
      actor: reporterId,
    })

    // 5. Invoke AI Orchestrator Service
    // The orchestrator handles few-shot classification, tagging, pgvector duplicates,
    // confidence thresholding (<0.6 => pending_review), and graceful fault tolerance (pending_triage).
    let triageResult = null
    try {
      triageResult = await orchestrateBugTriage(bug.id, {
        title: bug.title,
        description: bug.description,
        steps_to_reproduce: bug.steps_to_reproduce,
      })
    } catch (aiErr) {
      // In the rare case orchestrator throws, ensure bug is still safely preserved as pending_triage
      console.error('AI Orchestration uncaught fallback error:', aiErr)
      await supabase
        .from('bug_reports')
        .update({ status: 'pending_triage' })
        .eq('id', bug.id)
    }

    // 6. Fetch refreshed bug row with updated triage data
    const { data: updatedBug } = await session.supabase
      .from('bug_reports')
      .select(BUG_RESPONSE_COLUMNS)
      .eq('id', bug.id)
      .single()

    return NextResponse.json(
      {
        success: true,
        bug: updatedBug || bug,
        triage: triageResult,
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    console.error('API /api/bugs error:', err)
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

    if (status && status !== 'all' && !BUG_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
    }

    // Session client: RLS returns only the reporter's own bugs; staff see all.
    let query = session.supabase
      .from('bug_reports')
      .select('id, title, description, status, ai_severity, human_severity, created_at, reporter:users!reporter_id(name)')
      .order('created_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data: bugs, error } = await query

    if (error) {
      console.error('Error fetching bug reports:', error)
      return NextResponse.json({ error: 'Unable to complete the request. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ bugs })
  } catch (err: unknown) {
    console.error('API /api/bugs GET error:', err)
    return NextResponse.json({ error: 'Something went wrong processing your request. Please try again.' }, { status: 500 })
  }
}
