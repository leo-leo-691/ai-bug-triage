import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const supabase = createAdminClient()

    // 1. Fetch all bug reports with reporter and assignee
    const { data: bugs, error: bugsError } = await supabase
      .from('bug_reports')
      .select('*, reporter:users!reporter_id(id, name, email), assignee:users!assigned_to(id, name, email)')

    if (bugsError) {
      console.error('Error fetching bug reports for triage:', bugsError)
      return NextResponse.json({ error: 'Unable to complete the request. Please try again.' }, { status: 500 })
    }

    // 2. Fetch all bug tags
    const { data: allBugTags } = await supabase
      .from('bug_tags')
      .select('bug_id, source, tag:tags(id, name)')

    // 3. Fetch all duplicate links
    const { data: allDuplicates } = await supabase
      .from('duplicate_links')
      .select('bug_id, duplicate_of_bug_id, similarity_score, confirmed, duplicate_of:bug_reports!duplicate_of_bug_id(id, title)')

    // 4. Fetch available developers
    const { data: developers } = await supabase
      .from('users')
      .select('id, name, email, role')
      .in('role', ['developer', 'admin'])

    // 5. Fetch all system tags
    const { data: tags } = await supabase
      .from('tags')
      .select('id, name')
      .order('name', { ascending: true })

    // Map tags and duplicates to bugs
    const tagMap = new Map<string, any[]>()
    if (allBugTags) {
      for (const item of allBugTags as any[]) {
        if (!tagMap.has(item.bug_id)) tagMap.set(item.bug_id, [])
        const tagObj = Array.isArray(item.tag) ? item.tag[0] : item.tag
        if (tagObj) {
          tagMap.get(item.bug_id)!.push({ id: tagObj.id, name: tagObj.name, source: item.source })
        }
      }
    }

    const dupMap = new Map<string, any[]>()
    if (allDuplicates) {
      for (const dup of allDuplicates as any[]) {
        if (!dupMap.has(dup.bug_id)) dupMap.set(dup.bug_id, [])
        const dupObj = Array.isArray(dup.duplicate_of) ? dup.duplicate_of[0] : dup.duplicate_of
        dupMap.get(dup.bug_id)!.push({
          ...dup,
          duplicate_of: dupObj,
        })
      }
    }

    // Severity sort priority (Critical first)
    const severityWeight: Record<string, number> = {
      Critical: 4,
      High: 3,
      Medium: 2,
      Low: 1,
    }

    const enrichedBugs = (bugs || []).map((bug) => {
      const effSeverity = bug.human_severity || bug.ai_severity || 'Low'
      return {
        ...bug,
        tags: tagMap.get(bug.id) || [],
        duplicates: dupMap.get(bug.id) || [],
        sortWeight: severityWeight[effSeverity] || 0,
      }
    })

    // Sort: Critical first, then High, Medium, Low, then by date desc
    enrichedBugs.sort((a, b) => {
      if (b.sortWeight !== a.sortWeight) {
        return b.sortWeight - a.sortWeight
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    return NextResponse.json({
      bugs: enrichedBugs,
      developers: developers || [],
      availableTags: tags || [],
    })
  } catch (err: unknown) {
    console.error('API /api/admin/triage GET error:', err)
    return NextResponse.json({ error: 'Something went wrong processing your request. Please try again.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { bug_id, action, payload, actor_email } = body

    if (!bug_id || !action) {
      return NextResponse.json({ error: 'bug_id and action are required' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Find or identify actor
    let actorId: string | null = null
    if (actor_email) {
      const { data: actor } = await supabase
        .from('users')
        .select('id')
        .eq('email', actor_email)
        .maybeSingle()
      if (actor) actorId = actor.id
    }

    let auditDescription = ''

    switch (action) {
      case 'OVERRIDE_SEVERITY': {
        const { severity } = payload // 'Critical' | 'High' | 'Medium' | 'Low'
        await supabase
          .from('bug_reports')
          .update({ human_severity: severity })
          .eq('id', bug_id)

        auditDescription = `Admin manually set severity to "${severity}"`
        break
      }

      case 'UPDATE_STATUS': {
        const { status } = payload // 'new' | 'pending_triage' | 'pending_review' | 'triaged' | 'in_progress' | 'resolved' | 'closed'
        await supabase
          .from('bug_reports')
          .update({ status })
          .eq('id', bug_id)

        auditDescription = `Status updated to "${status}"`
        break
      }

      case 'ASSIGN_DEVELOPER': {
        const { assigned_to } = payload // user uuid or null
        await supabase
          .from('bug_reports')
          .update({ assigned_to: assigned_to || null })
          .eq('id', bug_id)

        auditDescription = assigned_to ? `Assigned bug to developer (${assigned_to})` : 'Unassigned developer'
        break
      }

      case 'ADD_TAG': {
        const { tag_name } = payload
        if (!tag_name) break

        // Upsert tag in tags table
        const { data: tag } = await supabase
          .from('tags')
          .upsert({ name: tag_name.toLowerCase().trim() }, { onConflict: 'name' })
          .select('id')
          .single()

        if (tag) {
          await supabase.from('bug_tags').upsert(
            {
              bug_id,
              tag_id: tag.id,
              source: 'human',
            },
            { onConflict: 'bug_id, tag_id' }
          )
        }

        auditDescription = `Added tag "${tag_name}" (human)`
        break
      }

      case 'REMOVE_TAG': {
        const { tag_id } = payload
        await supabase
          .from('bug_tags')
          .delete()
          .eq('bug_id', bug_id)
          .eq('tag_id', tag_id)

        auditDescription = `Removed tag (${tag_id})`
        break
      }

      case 'REVIEW_DUPLICATE': {
        const { duplicate_of_bug_id, confirmed } = payload // confirmed: true | false
        await supabase
          .from('duplicate_links')
          .update({ confirmed })
          .eq('bug_id', bug_id)
          .eq('duplicate_of_bug_id', duplicate_of_bug_id)

        auditDescription = confirmed
          ? `Confirmed duplicate of bug ${duplicate_of_bug_id}`
          : `Rejected duplicate flag for bug ${duplicate_of_bug_id}`
        break
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    // Write to audit_log
    await supabase.from('audit_log').insert({
      bug_id,
      action: auditDescription,
      actor: actorId,
    })

    return NextResponse.json({ success: true, action, auditDescription })
  } catch (err: unknown) {
    console.error('Admin triage API error:', err)
    return NextResponse.json({ error: 'Something went wrong processing your request. Please try again.' }, { status: 500 })
  }
}
