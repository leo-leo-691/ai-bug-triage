import { describe, it, expect } from 'vitest'
import { validateServerEnv } from '@/lib/env'

const base = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(40),
  GEMINI_API_KEY: 'gemini-key-123',
}

describe('validateServerEnv', () => {
  it('accepts a complete configuration', () => {
    expect(() => validateServerEnv(base)).not.toThrow()
  })

  it('names missing variables without echoing secret values', () => {
    const secret = 'super-secret-value-should-not-appear'
    try {
      validateServerEnv({ ...base, SUPABASE_SERVICE_ROLE_KEY: undefined, OPENAI_API_KEY: secret.replace(/^/, 'x') })
      expect.unreachable()
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('SUPABASE_SERVICE_ROLE_KEY')
      expect(msg).not.toContain(secret)
    }
  })

  it('requires at least one AI provider key', () => {
    expect(() => validateServerEnv({ ...base, GEMINI_API_KEY: '', OPENAI_API_KEY: '' })).toThrow(/AI provider/)
  })
})
