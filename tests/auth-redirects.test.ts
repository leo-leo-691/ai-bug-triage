import { describe, it, expect, vi, beforeEach } from 'vitest'
import { safeRedirectPath } from '@/lib/safe-redirect'

const exchangeCodeForSession = vi.fn()
const verifyOtp = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { exchangeCodeForSession, verifyOtp } }),
}))

const { GET: callback } = await import('@/app/auth/callback/route')

describe('safeRedirectPath', () => {
  it.each([
    ['/bugs/123?tab=a#x', '/bugs/123?tab=a#x'],
    ['/admin', '/admin'],
  ])('allows same-origin path %s', (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected)
  })

  it.each([
    'https://evil.example',
    '//evil.example/path',
    '/\\evil.example',
    'javascript:alert(1)',
    'evil.example',
    '',
    null,
    undefined,
  ])('falls back for %s', (input) => {
    expect(safeRedirectPath(input as string | null | undefined, '/bugs')).toBe('/bugs')
  })
})

describe('GET /auth/callback', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exchanges a PKCE code and redirects to a safe next path', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null })
    const res = await callback(new Request('https://app.example/auth/callback?code=abc&next=/update-password'))
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc')
    expect(res.headers.get('location')).toBe('https://app.example/update-password')
  })

  it('never redirects off-site via next', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null })
    const res = await callback(new Request('https://app.example/auth/callback?code=abc&next=//evil.example'))
    expect(res.headers.get('location')).toBe('https://app.example/bugs')
  })

  it('verifies token_hash links', async () => {
    verifyOtp.mockResolvedValue({ error: null })
    const res = await callback(new Request('https://app.example/auth/callback?token_hash=t&type=recovery&next=/update-password'))
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 't', type: 'recovery' })
    expect(res.headers.get('location')).toBe('https://app.example/update-password')
  })

  it('sends invalid or expired links to login with an error', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'expired' } })
    const res = await callback(new Request('https://app.example/auth/callback?code=bad'))
    expect(res.headers.get('location')).toMatch(/^https:\/\/app\.example\/login\?error=/)
  })
})
