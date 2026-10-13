import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockClient, hasOp, opArgs, type Resolver } from './helpers/supabase-mock'

const afterCallbacks: Array<() => unknown> = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (cb: () => unknown) => {
    afterCallbacks.push(cb)
  },
}))

const getSession = vi.fn()
const createAdminClient = vi.fn()
const orchestrateBugTriage = vi.fn()

vi.mock('@/lib/auth', () => ({ getSession: () => getSession() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => createAdminClient() }))
vi.mock('@/lib/ai-orchestrator', () => ({
  orchestrateBugTriage: (...a: unknown[]) => orchestrateBugTriage(...a),
}))

const { GET: listBugs, POST: createBug } = await import('@/app/api/bugs/route')
const { GET: getBug } = await import('@/app/api/bugs/[id]/route')

const USER_ID = '11111111-1111-4111-8111-111111111111'
const BUG_ID = '22222222-2222-4222-8222-222222222222'

function sessionWith(role: string | null, resolve?: Resolver) {
  const mock = createMockClient(resolve)
  getSession.mockResolvedValue({
    supabase: mock.client,
    user: { id: USER_ID },
    role,
    isStaff: role === 'admin' || role === 'developer',
  })
  return mock
}

function adminMock(resolve?: Resolver) {
  const mock = createMockClient(resolve)
  createAdminClient.mockReturnValue(mock.client)
  return mock
}

const postReq = (body: unknown) =>
  new Request('http://localhost/api/bugs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  afterCallbacks.length = 0
})

describe('GET /api/bugs', () => {
  it('returns 401 without a session and never touches the service-role client', async () => {
    getSession.mockResolvedValue(null)
    const admin = adminMock()
    const res = await listBugs(new Request('http://localhost/api/bugs'))
    expect(res.status).toBe(401)
    expect(admin.calls).toHaveLength(0)
  })

  it('reads bug_reports through the session client so RLS applies', async () => {
    const session = sessionWith('reporter', (table) =>
      table === 'bug_reports' ? { data: [{ id: BUG_ID }] } : undefined
    )
    const admin = adminMock()
    const res = await listBugs(new Request('http://localhost/api/bugs'))
    expect(res.status).toBe(200)
    expect(session.calls.map((c) => c.table)).toContain('bug_reports')
    expect(admin.calls).toHaveLength(0)
  })

  it('rejects an unknown status filter', async () => {
    sessionWith('reporter')
    const res = await listBugs(new Request('http://localhost/api/bugs?status=bogus'))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/bugs/[id]', () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) })

  it('returns 401 without a session', async () => {
    getSession.mockResolvedValue(null)
    const res = await getBug(new Request('http://localhost'), params(BUG_ID))
    expect(res.status).toBe(401)
  })

  it('returns 404 for a non-UUID id', async () => {
    sessionWith('reporter')
    const res = await getBug(new Request('http://localhost'), params('not-a-uuid'))
    expect(res.status).toBe(404)
  })

  it('returns 404 when RLS hides the bug (another reporter’s report)', async () => {
    sessionWith('reporter', () => ({ data: null }))
    const res = await getBug(new Request('http://localhost'), params(BUG_ID))
    expect(res.status).toBe(404)
  })

  it('does not query audit_log for reporters and drops hidden duplicate targets', async () => {
    const session = sessionWith('reporter', (table) => {
      if (table === 'bug_reports') return { data: { id: BUG_ID, title: 'x' } }
      if (table === 'duplicate_links')
        return { data: [{ confirmed: null, duplicate_of: null }, { confirmed: null, duplicate_of: { id: 'b' } }] }
      return { data: [] }
    })
    const res = await getBug(new Request('http://localhost'), params(BUG_ID))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(session.calls.map((c) => c.table)).not.toContain('audit_log')
    expect(body.duplicates).toHaveLength(1)
    expect(body.auditLogs).toEqual([])
  })
})

describe('POST /api/bugs', () => {
  const valid = {
    title: 'Checkout crashes on submit',
    description: 'Clicking submit on checkout throws a 500 error every time for all users.',
  }

  it('returns 401 without a session and writes nothing', async () => {
    getSession.mockResolvedValue(null)
    const admin = adminMock()
    const res = await createBug(postReq(valid))
    expect(res.status).toBe(401)
    expect(admin.calls).toHaveLength(0)
    expect(orchestrateBugTriage).not.toHaveBeenCalled()
  })

  it('returns 403 when the user has no profile row', async () => {
    sessionWith(null)
    const res = await createBug(postReq(valid))
    expect(res.status).toBe(403)
  })

  it('takes reporter_id from the session, ignores body identity fields, inserts via the session client', async () => {
    const session = sessionWith('reporter', (table, ops) =>
      table === 'bug_reports' && hasOp({ table, ops }, 'insert')
        ? { data: { id: BUG_ID, title: valid.title, description: valid.description, steps_to_reproduce: null } }
        : { data: { id: BUG_ID } }
    )
    const admin = adminMock(() => ({ count: 0 }))
    orchestrateBugTriage.mockResolvedValue({ appliedStatus: 'triaged' })

    const res = await createBug(
      postReq({ ...valid, reporter_email: 'admin@victim.example', reporter_name: 'Admin', reporter_id: 'spoofed' })
    )
    expect(res.status).toBe(201)

    const insert = session.calls.find((c) => c.table === 'bug_reports' && hasOp(c, 'insert'))!
    const row = opArgs(insert, 'insert')![0] as Record<string, unknown>
    expect(row.reporter_id).toBe(USER_ID)

    // No users rows are created or looked up by email, and bugs are never inserted with the service role.
    expect(admin.calls.some((c) => c.table === 'users')).toBe(false)
    expect(admin.calls.some((c) => c.table === 'bug_reports' && hasOp(c, 'insert'))).toBe(false)

    // Triage is deferred until after the response is sent.
    expect(orchestrateBugTriage).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(1)
    await afterCallbacks[0]()
    expect(orchestrateBugTriage).toHaveBeenCalledWith(BUG_ID, expect.objectContaining({ title: valid.title }))

    // Rate-limit row is keyed by user as well as IP.
    const rl = admin.calls.find((c) => c.table === 'rate_limits' && hasOp(c, 'insert'))!
    expect(opArgs(rl, 'insert')![0]).toEqual({ ip_address: '203.0.113.7', user_id: USER_ID })
  })

  it('marks the bug pending_triage if the background orchestrator throws', async () => {
    sessionWith('reporter', () => ({ data: { id: BUG_ID } }))
    const admin = adminMock(() => ({ count: 0 }))
    orchestrateBugTriage.mockRejectedValue(new Error('boom'))
    const res = await createBug(postReq(valid))
    expect(res.status).toBe(201)
    await afterCallbacks[0]()
    const upd = admin.calls.find((c) => c.table === 'bug_reports' && hasOp(c, 'update'))!
    expect(opArgs(upd, 'update')![0]).toEqual({ status: 'pending_triage' })
  })

  it('rejects over-long input with 400 before any AI or DB work', async () => {
    sessionWith('reporter')
    const admin = adminMock()
    const res = await createBug(postReq({ ...valid, description: 'x'.repeat(10_001) }))
    expect(res.status).toBe(400)
    expect(admin.calls).toHaveLength(0)
  })

  it('returns 429 once the per-user limit is reached', async () => {
    const session = sessionWith('reporter')
    adminMock((table, ops) =>
      table === 'rate_limits' && ops.some((o) => o.method === 'eq' && o.args[0] === 'user_id') ? { count: 5 } : { count: 0 }
    )
    const res = await createBug(postReq(valid))
    expect(res.status).toBe(429)
    expect(session.calls.some((c) => c.table === 'bug_reports')).toBe(false)
  })

  it('fails closed (503) if the rate-limit check errors', async () => {
    sessionWith('reporter')
    adminMock(() => ({ error: { message: 'db down' } }))
    const res = await createBug(postReq(valid))
    expect(res.status).toBe(503)
  })

  it('rejects non-string steps_to_reproduce with 400 before rate limiting', async () => {
    sessionWith('reporter')
    const admin = adminMock()
    const res = await createBug(postReq({ ...valid, steps_to_reproduce: 42 }))
    expect(res.status).toBe(400)
    expect(admin.calls).toHaveLength(0)
  })
})
