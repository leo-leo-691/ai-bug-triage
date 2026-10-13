// Safety guard imported first by every script in this folder.
// Scripts write to (and run-evaluation.mjs wipes) the Supabase project in the
// loaded env, and call paid AI APIs. Refuse to run unless explicitly allowed.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ref = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || (url ? url : '(no Supabase URL set)')

console.log(`[scripts] Target Supabase project ref: ${ref}`)

if (process.env.ALLOW_SCRIPT_WRITES !== 'true') {
  console.error(
    '[scripts] Refusing to run: set ALLOW_SCRIPT_WRITES=true to confirm you intend to write to the project above.\n' +
      '[scripts] Never point these scripts at the production project.'
  )
  process.exit(1)
}
