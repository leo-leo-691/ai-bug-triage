import { createServerSupabaseClient } from '@/lib/supabase/server'

export type Role = 'reporter' | 'developer' | 'admin'

/**
 * Resolves the signed-in user from the request cookies.
 * Returns the session-scoped Supabase client (RLS applies) and the user's role,
 * read only from public.users — never from user-editable auth metadata.
 */
export async function getSession() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const role = (profile?.role ?? null) as Role | null

  return {
    supabase,
    user,
    role,
    isStaff: role === 'admin' || role === 'developer',
  }
}
