import { z } from 'zod'

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const
export const BUG_STATUSES = [
  'new',
  'pending_triage',
  'pending_review',
  'triaged',
  'in_progress',
  'resolved',
  'closed',
] as const

export const LIMITS = {
  title: 200,
  description: 10_000,
  steps: 10_000,
  tag: 32,
} as const

export const TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Body of POST /api/bugs. Reporter identity is never accepted from the client. */
export const bugSubmissionSchema = z.object({
  title: z
    .string({ error: 'Title is required' })
    .trim()
    .min(5, 'Bug title must be at least 5 characters long.')
    .max(LIMITS.title, `Bug title must be at most ${LIMITS.title} characters.`),
  description: z
    .string({ error: 'Description is required' })
    .trim()
    .min(10, 'Bug description must be at least 10 characters long.')
    .max(LIMITS.description, `Bug description must be at most ${LIMITS.description} characters.`),
  steps_to_reproduce: z
    .string({ error: 'Steps to reproduce must be text' })
    .trim()
    .max(LIMITS.steps, `Steps to reproduce must be at most ${LIMITS.steps} characters.`)
    .nullish()
    .transform((v) => (v ? v : null)),
})

export const tagNameSchema = z.string().trim().toLowerCase().max(LIMITS.tag).regex(TAG_RE)

/** Severity classification returned by the LLM. Anything else is rejected, not coerced. */
export const severityOutputSchema = z.object({
  severity: z.enum(SEVERITIES),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(500),
})

/** Tag suggestion returned by the LLM; invalid entries are dropped individually. */
export const tagsOutputSchema = z.object({
  tags: z.array(z.unknown()).max(10),
})

export function cleanTags(raw: unknown[]): string[] {
  const out: string[] = []
  for (const t of raw) {
    const parsed = tagNameSchema.safeParse(t)
    if (parsed.success && !out.includes(parsed.data)) out.push(parsed.data)
    if (out.length === 3) break
  }
  return out
}

/** First human-readable message from a zod error. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid request'
}
