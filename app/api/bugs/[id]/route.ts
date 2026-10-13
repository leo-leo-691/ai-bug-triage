import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params

    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
    }

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Bug report not found' }, { status: 404 })
    }

    // Session client: RLS limits reporters to their own bugs, staff see all.
    const { supabase, isStaff } = session

    // 1. Fetch bug details
    const selectQuery = isStaff
      ? 'id, title, description, steps_to_reproduce, status, ai_severity, ai_confidence, human_severity, created_at, reporter:users!reporter_id(name), assignee:users!assigned_to(name)'
      : 'id, title, description, steps_to_reproduce, status, ai_severity, human_severity, created_at, reporter:users!reporter_id(name), assignee:users!assigned_to(name)'

    const { data: bug, error: bugError } = await supabase
      .from('bug_reports')
      .select(selectQuery)
      .eq('id', id)
      .maybeSingle()

    if (bugError || !bug) {
      return NextResponse.json({ error: 'Bug report not found' }, { status: 404 })
    }

    // 2. Fetch associated tags
    const { data: tagLinks } = await supabase
      .from('bug_tags')
      .select('source, tag:tags(id, name)')
      .eq('bug_id', id)

    // 3. Fetch duplicate links
    // If not staff, don't fetch similarity_score
    const dupSelect = isStaff
      ? 'similarity_score, confirmed, duplicate_of:bug_reports!duplicate_of_bug_id(id, title, status, ai_severity)'
      : 'confirmed, duplicate_of:bug_reports!duplicate_of_bug_id(id, title, status)'

    const { data: duplicates } = await supabase
      .from('duplicate_links')
      .select(dupSelect)
      .eq('bug_id', id)

    // RLS hides duplicate targets the caller may not read; drop those links.
    const visibleDuplicates = ((duplicates || []) as unknown as Array<{ duplicate_of: unknown }>).filter(
      (d) => d.duplicate_of != null
    )

    // 4. Fetch audit log (only for staff; RLS also enforces this)
    let auditLogs: Array<{ id: string; action: string; created_at: string }> = []
    if (isStaff) {
      const { data } = await supabase
        .from('audit_log')
        .select('id, action, created_at')
        .eq('bug_id', id)
        .order('created_at', { ascending: false })
      auditLogs = data || []
    }

    return NextResponse.json({
      bug,
      tags: tagLinks || [],
      duplicates: visibleDuplicates,
      auditLogs,
    })
  } catch (err: unknown) {
    console.error('API /api/bugs/[id] error:', err)
    return NextResponse.json({ error: 'Unable to complete the request. Please try again.' }, { status: 500 })
  }
}
