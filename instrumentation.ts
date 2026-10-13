// Runs once when a server instance starts: fail fast on missing configuration.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return
  const { validateServerEnv } = await import('@/lib/env')
  validateServerEnv()
}
