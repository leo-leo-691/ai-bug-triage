import { z } from 'zod'

const serverEnvSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url({ protocol: /^https?$/ }),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
    GEMINI_API_KEY: z.string().min(6).optional(),
    OPENAI_API_KEY: z.string().startsWith('sk-').optional(),
    SEVERITY_PROMPT_VERSION: z.enum(['v1', 'v2']).optional(),
  })
  .refine((env) => env.GEMINI_API_KEY || env.OPENAI_API_KEY, {
    message: 'Set GEMINI_API_KEY or OPENAI_API_KEY (at least one AI provider is required)',
    path: ['GEMINI_API_KEY'],
  })

/**
 * Validates required server environment variables. Throws with the names of the
 * missing/invalid variables (never their values).
 */
export function validateServerEnv(env: Record<string, string | undefined> = process.env) {
  const result = serverEnvSchema.safeParse({
    ...env,
    // Treat empty strings as unset.
    GEMINI_API_KEY: env.GEMINI_API_KEY || undefined,
    OPENAI_API_KEY: env.OPENAI_API_KEY || undefined,
    SEVERITY_PROMPT_VERSION: env.SEVERITY_PROMPT_VERSION || undefined,
  })
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`)
    throw new Error(`Invalid server environment configuration:\n  - ${problems.join('\n  - ')}`)
  }
  return result.data
}
