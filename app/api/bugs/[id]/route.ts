import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params
    const id = params.id

    const supabase = createAdminClient()
    
    // Determine user role
    let isStaff = false
    try {
      const authClient = await createServerSupabaseClient()
      const { data: { user } } = await authClient.auth.getUser()
      if (user) {
        const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
        if (profile && ['admin', 'developer'].includes(profile.role)) {
          isStaff = true
        }
      }
    } catch (e) {
      // Ignore auth errors for public routes
    }

    // 1. Fetch bug details
    const selectQuery = isStaff
      ? 'id, title, description, steps_to_reproduce, status, ai_severity, ai_confidence, human_severity, created_at, reporter:users!reporter_id(name), assignee:users!assigned_to(name)'
      : 'id, title, description, steps_to_reproduce, status, ai_severity, human_severity, created_at, reporter:users!reporter_id(name), assignee:users!assigned_to(name)'

    const { data: bug, error: bugError } = await supabase
      .from('bug_reports')
      .select(selectQuery)
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
    // If not staff, don't fetch similarity_score
    const dupSelect = isStaff
      ? 'similarity_score, confirmed, duplicate_of:bug_reports!duplicate_of_bug_id(id, title, status, ai_severity)'
      : 'confirmed, duplicate_of:bug_reports!duplicate_of_bug_id(id, title, status)'
      
    const { data: duplicates } = await supabase
      .from('duplicate_links')
      .select(dupSelect)
      .eq('bug_id', id)

    // 4. Fetch audit log (only for staff)
    let auditLogs: any[] = []
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
      duplicates: duplicates || [],
      auditLogs,
    })
  } catch (err: unknown) {
    console.error('API /api/bugs/[id] error:', err)
    return NextResponse.json({ error: 'Unable to complete the request. Please try again.' }, { status: 500 })
  }
}
