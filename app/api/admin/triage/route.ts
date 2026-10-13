import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { BUG_STATUSES, SEVERITIES, firstIssue, tagNameSchema } from '@/lib/validation'

const BUG_COLUMNS =
  'id, title, description, status, ai_severity, ai_confidence, human_severity, created_at, assigned_to, reporter:users!reporter_id(id, name, email), assignee:users!assigned_to(id, name, email)'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

/** Staff-only. Returns the session (RLS-scoped client) or an error response. */
async function requireStaff() {
  const session = await getSession()
  if (!session) {
    return { response: NextResponse.json({ error: 'Unauthorized: Authentication required.' }, { status: 401 }) }
  }
  if (!session.isStaff) {
    return { response: NextResponse.json({ error: 'Forbidden: Admin or Developer role required.' }, { status: 403 }) }
  }
  return { session }
}

/** Keeps search text safe to embed in a PostgREST or() filter. */
function sanitizeSearch(q: string | null): string {
  return (q || '').replace(/[^\p{L}\p{N}\s\-_.]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}

export async function GET(request: Request) {
  try {
    const auth = await requireStaff()
    if (!auth.session) return auth.response
    const { supabase } = auth.session

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number.parseInt(searchParams.get('pageSize') || `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE)
    )
    const status = searchParams.get('status') || 'all'
    if (status !== 'all' && !(BUG_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
    }
    const q = sanitizeSearch(searchParams.get('q'))

    // 1. One page of bugs, Critical first then newest (severity_rank is a generated column)
    let bugsQuery = supabase
      .from('bug_reports')
      .select(BUG_COLUMNS, { count: 'exact' })
      .order('severity_rank', { ascending: false })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)
    if (status !== 'all') bugsQuery = bugsQuery.eq('status', status)
    if (q) bugsQuery = bugsQuery.or(`title.ilike."%${q}%",description.ilike."%${q}%"`)

    const countBugs = () => supabase.from('bug_reports').select('id', { count: 'exact', head: true })

    const [bugsRes, developersRes, totalRes, criticalRes, reviewRes, dupRes] = await Promise.all([
      bugsQuery,
      supabase.from('users').select('id, name, email, role').in('role', ['developer', 'admin']),
      countBugs(),
      countBugs().eq('severity_rank', 4),
      countBugs().eq('status', 'pending_review'),
      supabase.from('duplicate_links').select('bug_id', { count: 'exact', head: true }).is('confirmed', null),
    ])

    if (bugsRes.error) {
      console.error('Error fetching bug reports for triage:', bugsRes.error.message)
      return NextResponse.json({ error: 'Unable to complete the request. Please try again.' }, { status: 500 })
    }

    const bugs = bugsRes.data || []
    const ids = bugs.map((b) => b.id)

    // 2. Tags and duplicate links for this page only
    type TagLink = { bug_id: string; source: string; tag: { id: string; name: string } | { id: string; name: string }[] | null }
    type DupLink = {
      bug_id: string
      duplicate_of_bug_id: string
      similarity_score: number
      confirmed: boolean | null
      duplicate_of: { id: string; title: string } | { id: string; title: string }[] | null
    }

    const [tagRes, dupLinksRes] = ids.length
      ? await Promise.all([
          supabase.from('bug_tags').select('bug_id, source, tag:tags(id, name)').in('bug_id', ids),
          supabase
            .from('duplicate_links')
            .select('bug_id, duplicate_of_bug_id, similarity_score, confirmed, duplicate_of:bug_reports!duplicate_of_bug_id(id, title)')
            .in('bug_id', ids),
        ])
      : [{ data: [] }, { data: [] }]

    const tagMap = new Map<string, Array<{ id: string; name: string; source: string }>>()
    for (const item of (tagRes.data || []) as unknown as TagLink[]) {
      const tagObj = Array.isArray(item.tag) ? item.tag[0] : item.tag
      if (!tagObj) continue
      if (!tagMap.has(item.bug_id)) tagMap.set(item.bug_id, [])
      tagMap.get(item.bug_id)!.push({ id: tagObj.id, name: tagObj.name, source: item.source })
    }

    const dupMap = new Map<string, Array<Omit<DupLink, 'duplicate_of'> & { duplicate_of?: { id: string; title: string } }>>()
    for (const dup of (dupLinksRes.data || []) as unknown as DupLink[]) {
      const dupObj = Array.isArray(dup.duplicate_of) ? dup.duplicate_of[0] : dup.duplicate_of
      if (!dupMap.has(dup.bug_id)) dupMap.set(dup.bug_id, [])
      dupMap.get(dup.bug_id)!.push({ ...dup, duplicate_of: dupObj || undefined })
    }

    return NextResponse.json({
      bugs: bugs.map((bug) => ({
        ...bug,
        tags: tagMap.get(bug.id) || [],
        duplicates: dupMap.get(bug.id) || [],
      })),
      developers: developersRes.data || [],
      page,
      pageSize,
      total: bugsRes.count ?? 0,
      summary: {
        total: totalRes.count ?? 0,
        critical: criticalRes.count ?? 0,
        pendingReview: reviewRes.count ?? 0,
        unreviewedDuplicates: dupRes.count ?? 0,
      },
    })
  } catch (err: unknown) {
    console.error('API /api/admin/triage GET error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Something went wrong processing your request. Please try again.' }, { status: 500 })
  }
}

const uuid = z.uuid()

const actionSchema = z.discriminatedUnion('action', [
  z.object({ bug_id: uuid, action: z.literal('OVERRIDE_SEVERITY'), payload: z.object({ severity: z.enum(SEVERITIES) }) }),
  z.object({ bug_id: uuid, action: z.literal('UPDATE_STATUS'), payload: z.object({ status: z.enum(BUG_STATUSES) }) }),
  z.object({ bug_id: uuid, action: z.literal('ASSIGN_DEVELOPER'), payload: z.object({ assigned_to: uuid.nullable() }) }),
  z.object({ bug_id: uuid, action: z.literal('ADD_TAG'), payload: z.object({ tag_name: tagNameSchema }) }),
  z.object({ bug_id: uuid, action: z.literal('REMOVE_TAG'), payload: z.object({ tag_id: uuid }) }),
  z.object({
    bug_id: uuid,
    action: z.literal('REVIEW_DUPLICATE'),
    payload: z.object({ duplicate_of_bug_id: uuid, confirmed: z.boolean() }),
  }),
])

const failed = (message: string, status: number) => NextResponse.json({ error: message }, { status })

export async function POST(request: Request) {
  try {
    const auth = await requireStaff()
    if (!auth.session) return auth.response
    const { supabase, user } = auth.session

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return failed('Request body must be JSON', 400)
    }
    const parsed = actionSchema.safeParse(rawBody)
    if (!parsed.success) {
      return failed(firstIssue(parsed.error), 400)
    }
    const body = parsed.data
    const bugId = body.bug_id

    const { data: bugRow, error: bugError } = await supabase.from('bug_reports').select('id').eq('id', bugId).maybeSingle()
    if (bugError) {
      console.error('Triage lookup failed:', bugError.message)
      return failed('Unable to complete the request. Please try again.', 500)
    }
    if (!bugRow) return failed('Bug report not found', 404)

    let auditDescription = ''

    switch (body.action) {
      case 'OVERRIDE_SEVERITY': {
        const { error } = await supabase.from('bug_reports').update({ human_severity: body.payload.severity }).eq('id', bugId)
        if (error) return failed('Failed to update severity.', 500)
        auditDescription = `Admin manually set severity to "${body.payload.severity}"`
        break
      }

      case 'UPDATE_STATUS': {
        const { error } = await supabase.from('bug_reports').update({ status: body.payload.status }).eq('id', bugId)
        if (error) return failed('Failed to update status.', 500)
        auditDescription = `Status updated to "${body.payload.status}"`
        break
      }

      case 'ASSIGN_DEVELOPER': {
        const assignee = body.payload.assigned_to
        if (assignee) {
          const { data: dev } = await supabase
            .from('users')
            .select('id')
            .eq('id', assignee)
            .in('role', ['developer', 'admin'])
            .maybeSingle()
          if (!dev) return failed('Bugs can only be assigned to developers or admins.', 400)
        }
        const { error } = await supabase.from('bug_reports').update({ assigned_to: assignee }).eq('id', bugId)
        if (error) return failed('Failed to update assignee.', 500)
        auditDescription = assignee ? `Assigned bug to developer (${assignee})` : 'Unassigned developer'
        break
      }

      case 'ADD_TAG': {
        const tagName = body.payload.tag_name
        const { data: tag, error: tagError } = await supabase
          .from('tags')
          .upsert({ name: tagName }, { onConflict: 'name' })
          .select('id')
          .single()
        if (tagError || !tag) return failed('Failed to create tag.', 500)

        const { error } = await supabase
          .from('bug_tags')
          .upsert({ bug_id: bugId, tag_id: tag.id, source: 'human' }, { onConflict: 'bug_id, tag_id' })
        if (error) return failed('Failed to add tag.', 500)
        auditDescription = `Added tag "${tagName}" (human)`
        break
      }

      case 'REMOVE_TAG': {
        const { error } = await supabase.from('bug_tags').delete().eq('bug_id', bugId).eq('tag_id', body.payload.tag_id)
        if (error) return failed('Failed to remove tag.', 500)
        auditDescription = `Removed tag (${body.payload.tag_id})`
        break
      }

      case 'REVIEW_DUPLICATE': {
        const { duplicate_of_bug_id, confirmed } = body.payload
        const { data: updated, error } = await supabase
          .from('duplicate_links')
          .update({ confirmed })
          .eq('bug_id', bugId)
          .eq('duplicate_of_bug_id', duplicate_of_bug_id)
          .select('bug_id')
        if (error) return failed('Failed to update duplicate review.', 500)
        if (!updated || updated.length === 0) return failed('Duplicate link not found', 404)
        auditDescription = confirmed
          ? `Confirmed duplicate of bug ${duplicate_of_bug_id}`
          : `Rejected duplicate flag for bug ${duplicate_of_bug_id}`
        break
      }
    }

    // Audit entry as the verified session user (RLS requires actor = auth.uid()).
    const { error: auditError } = await supabase.from('audit_log').insert({
      bug_id: bugId,
      action: auditDescription,
      actor: user.id,
    })
    if (auditError) {
      console.error('Audit log insert failed:', auditError.message)
      return failed('The change was saved but could not be recorded in the audit log.', 500)
    }

    return NextResponse.json({ success: true, action: body.action, auditDescription })
  } catch (err: unknown) {
    console.error('Admin triage API error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Something went wrong processing your request. Please try again.' }, { status: 500 })
  }
}
