import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockClient, hasOp, opArgs, type Resolver } from './helpers/supabase-mock'

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({ getSession: () => getSession() }))
const createAdminClient = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => createAdminClient() }))

const { GET, POST } = await import('@/app/api/admin/triage/route')

const STAFF_ID = '44444444-4444-4444-8444-444444444444'
const BUG_ID = '55555555-5555-4555-8555-555555555555'
const DEV_ID = '66666666-6666-4666-8666-666666666666'

function sessionWith(role: string | null, resolve?: Resolver) {
  const mock = createMockClient(resolve)
  getSession.mockResolvedValue({
    supabase: mock.client,
    user: { id: STAFF_ID },
    role,
    isStaff: role === 'admin' || role === 'developer',
  })
  return mock
}

const post = (body: unknown) =>
  new Request('http://localhost/api/admin/triage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

// Bug exists; everything else succeeds unless overridden.
const okResolver: Resolver = (table, ops) => {
  if (table === 'bug_reports' && hasOp({ table, ops }, 'maybeSingle')) return { data: { id: BUG_ID } }
  return {}
}

beforeEach(() => vi.clearAllMocks())

describe('admin triage authorization', () => {
  it('returns 401 when signed out', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET(new Request('http://localhost/api/admin/triage'))).status).toBe(401)
    expect((await POST(post({}))).status).toBe(401)
  })

  it('returns 403 for reporters on GET and POST, without touching data', async () => {
    const session = sessionWith('reporter')
    expect((await GET(new Request('http://localhost/api/admin/triage'))).status).toBe(403)
    const res = await POST(post({ bug_id: BUG_ID, action: 'UPDATE_STATUS', payload: { status: 'closed' } }))
    expect(res.status).toBe(403)
    expect(session.calls).toHaveLength(0)
  })

  it('never uses the service-role client', async () => {
    sessionWith('admin', okResolver)
    await POST(post({ bug_id: BUG_ID, action: 'UPDATE_STATUS', payload: { status: 'closed' } }))
    await GET(new Request('http://localhost/api/admin/triage'))
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('admin triage POST validation', () => {
  it.each([
    [{ bug_id: BUG_ID, action: 'OVERRIDE_SEVERITY', payload: { severity: 'Catastrophic' } }],
    [{ bug_id: BUG_ID, action: 'UPDATE_STATUS', payload: { status: 'deleted' } }],
    [{ bug_id: 'not-a-uuid', action: 'UPDATE_STATUS', payload: { status: 'closed' } }],
    [{ bug_id: BUG_ID, action: 'ADD_TAG', payload: { tag_name: 'Bad Tag!' } }],
    [{ bug_id: BUG_ID, action: 'DROP_TABLE', payload: {} }],
    [{ bug_id: BUG_ID, action: 'UPDATE_STATUS' }],
  ])('rejects %j with 400', async (body) => {
    const session = sessionWith('developer', okResolver)
    const res = await POST(post(body))
    expect(res.status).toBe(400)
    expect(session.calls).toHaveLength(0)
  })

  it('returns 404 for a bug the caller cannot see', async () => {
    sessionWith('admin', () => ({ data: null }))
    const res = await POST(post({ bug_id: BUG_ID, action: 'UPDATE_STATUS', payload: { status: 'closed' } }))
    expect(res.status).toBe(404)
  })

  it('refuses to assign a bug to a non-staff user', async () => {
    const session = sessionWith('admin', (table, ops) => {
      if (table === 'users') return { data: null }
      return okResolver(table, ops)
    })
    const res = await POST(post({ bug_id: BUG_ID, action: 'ASSIGN_DEVELOPER', payload: { assigned_to: DEV_ID } }))
    expect(res.status).toBe(400)
    expect(session.calls.some((c) => c.table === 'bug_reports' && hasOp(c, 'update'))).toBe(false)
  })
})

describe('admin triage POST writes', () => {
  it('writes an audit entry with the session user as actor on success', async () => {
    const session = sessionWith('developer', okResolver)
    const res = await POST(post({ bug_id: BUG_ID, action: 'OVERRIDE_SEVERITY', payload: { severity: 'High' } }))
    expect(res.status).toBe(200)
    const audit = session.calls.find((c) => c.table === 'audit_log')!
    expect(opArgs(audit, 'insert')![0]).toMatchObject({ bug_id: BUG_ID, actor: STAFF_ID })
  })

  it('returns 500 and writes no audit entry when the update fails', async () => {
    const session = sessionWith('admin', (table, ops) => {
      if (table === 'bug_reports' && hasOp({ table, ops }, 'update')) return { error: { message: 'denied' } }
      return okResolver(table, ops)
    })
    const res = await POST(post({ bug_id: BUG_ID, action: 'UPDATE_STATUS', payload: { status: 'resolved' } }))
    expect(res.status).toBe(500)
    expect(session.calls.some((c) => c.table === 'audit_log')).toBe(false)
  })

  it('returns 404 when the duplicate link does not exist', async () => {
    sessionWith('admin', (table, ops) => {
      if (table === 'duplicate_links') return { data: [] }
      return okResolver(table, ops)
    })
    const res = await POST(
      post({ bug_id: BUG_ID, action: 'REVIEW_DUPLICATE', payload: { duplicate_of_bug_id: DEV_ID, confirmed: true } })
    )
    expect(res.status).toBe(404)
  })
})

describe('admin triage GET', () => {
  it('selects explicit columns (no embedding), paginates, and sanitizes search', async () => {
    const session = sessionWith('admin', (table, ops) =>
      table === 'bug_reports' && hasOp({ table, ops }, 'range') ? { data: [], count: 0 } : { data: [], count: 0 }
    )
    const res = await GET(new Request('http://localhost/api/admin/triage?page=3&pageSize=500&q=crash%22),id.eq.(x'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pageSize).toBe(100)

    const list = session.calls.find((c) => c.table === 'bug_reports' && hasOp(c, 'range'))!
    const columns = opArgs(list, 'select')![0] as string
    expect(columns).not.toContain('*')
    expect(columns).not.toContain('embedding')
    expect(opArgs(list, 'range')).toEqual([200, 299])
    const orFilter = opArgs(list, 'or')![0] as string
    expect(orFilter).not.toMatch(/[()]/)
    expect(orFilter.match(/"/g)).toHaveLength(4)
  })

  it('rejects an unknown status filter', async () => {
    sessionWith('admin')
    expect((await GET(new Request('http://localhost/api/admin/triage?status=open'))).status).toBe(400)
  })
})
