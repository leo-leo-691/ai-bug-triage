import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params
    const id = params.id

    const supabase = createAdminClient()

    // 1. Fetch bug details with reporter and assigned developer
    const { data: bug, error: bugError } = await supabase
      .from('bug_reports')
      .select('*, reporter:users!reporter_id(id, name), assignee:users!assigned_to(id, name)')
      .eq('id', id)
      .single()

    if (bugError || !bug) {
      return NextResponse.json({ error: 'Bug report not found' }, { status: 404 })
    }

    // 2. Fetch associated tags
    const { data: tagLinks } = await supabase
      .from('bug_tags')
      .select('source, tag:tags(id, name)')
      .eq('bug_id', id)

    // 3. Fetch duplicate links
    const { data: duplicates } = await supabase
      .from('duplicate_links')
      .select('similarity_score, confirmed, duplicate_of:bug_reports!duplicate_of_bug_id(id, title, status, ai_severity)')
      .eq('bug_id', id)

    // 4. Fetch audit log (non-identifying action and timestamp only)
    const { data: auditLogs } = await supabase
      .from('audit_log')
      .select('id, action, created_at')
      .eq('bug_id', id)
      .order('created_at', { ascending: false })

    return NextResponse.json({
      bug,
      tags: tagLinks || [],
      duplicates: duplicates || [],
      auditLogs: auditLogs || [],
    })
  } catch (err: unknown) {
    console.error('API /api/bugs/[id] error:', err)
    return NextResponse.json({ error: 'Unable to complete the request. Please try again.' }, { status: 500 })
  }
}
