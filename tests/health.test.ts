import { describe, it, expect, vi } from 'vitest'
import { createMockClient } from './helpers/supabase-mock'

const createAdminClient = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => createAdminClient() }))
const { GET } = await import('@/app/api/health/route')

describe('GET /api/health', () => {
  it('returns 200 when the database responds', async () => {
    createAdminClient.mockReturnValue(createMockClient(() => ({ count: 7 })).client)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', database: 'ok' })
  })

  it('returns 503 without leaking the database error', async () => {
    createAdminClient.mockReturnValue(createMockClient(() => ({ error: { message: 'password authentication failed for user' } })).client)
    const res = await GET()
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('password')
  })
})
