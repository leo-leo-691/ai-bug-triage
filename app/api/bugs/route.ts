import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { orchestrateBugTriage } from '@/lib/ai-orchestrator'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { title, description, steps_to_reproduce, reporter_name, reporter_email } = body

    // 1. Basic validation
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }

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

    // 2. Find or create reporter user
    let reporterId: string | null = null
    if (reporter_email && typeof reporter_email === 'string' && reporter_email.trim().length > 0) {
      const email = reporter_email.trim().toLowerCase()
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle()

      if (existingUser) {
        reporterId = existingUser.id
      } else {
        const { data: newUser, error: userError } = await supabase
          .from('users')
          .insert({
            name: reporter_name?.trim() || email.split('@')[0],
            email: email,
            role: 'reporter',
          })
          .select('id')
          .single()

        if (!userError && newUser) {
          reporterId = newUser.id
        }
      }
    }

    // 3. Insert bug report with initial status 'new'
    const { data: bug, error: bugError } = await supabase
      .from('bug_reports')
      .insert({
        title: title.trim(),
        description: description.trim(),
        steps_to_reproduce: steps_to_reproduce ? steps_to_reproduce.trim() : null,
        reporter_id: reporterId,
        status: 'new',
      })
      .select('*, reporter:users!reporter_id(name)')
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
    const { data: updatedBug } = await supabase
      .from('bug_reports')
      .select('*, reporter:users!reporter_id(name)')
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
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const supabase = createAdminClient()

    let query = supabase
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
