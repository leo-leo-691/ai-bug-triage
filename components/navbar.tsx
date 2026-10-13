'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import { LogOut, LogIn } from 'lucide-react'

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()

    // Role comes only from public.users; auth user_metadata is user-editable.
    async function loadRole(current: User | null) {
      setUser(current)
      if (!current) {
        setUserRole(null)
        return
      }
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', current.id)
        .maybeSingle()
      setUserRole(profile?.role ?? null)
    }

    supabase.auth.getUser().then(({ data: { user } }) => loadRole(user))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Defer the query: supabase-js must not be awaited inside this callback.
      setTimeout(() => loadRole(session?.user ?? null), 0)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    setUser(null)
    setUserRole(null)
    router.push('/')
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
              AI
            </span>
            <span className="font-semibold text-lg tracking-tight text-slate-900">
              BugTrack <span className="text-indigo-600">Triage</span>
            </span>
          </Link>
        </div>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/report"
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
              pathname === '/report'
                ? 'bg-slate-100 text-indigo-600'
                : 'text-slate-700 hover:text-indigo-600 hover:bg-slate-100'
            }`}
          >
            Report Bug
          </Link>
          <Link
            href="/bugs"
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
              pathname.startsWith('/bugs')
                ? 'bg-slate-100 text-indigo-600'
                : 'text-slate-700 hover:text-indigo-600 hover:bg-slate-100'
            }`}
          >
            Bug Queue
          </Link>
          <Link
            href="/admin"
            className={`px-3 py-1.5 text-sm font-medium rounded-md border transition ${
              pathname === '/admin'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200'
            }`}
          >
            Admin Triage
          </Link>

          {/* User Session status */}
          <div className="pl-2 border-l border-slate-200 flex items-center gap-2">
            {user ? (
              <div className="flex items-center gap-2">
                <div className="hidden md:flex flex-col items-end text-right">
                  <span className="text-xs font-semibold text-slate-800 leading-tight">
                    {user.email?.split('@')[0]}
                  </span>
                  <span className="text-[10px] uppercase font-bold text-indigo-600">
                    {userRole || 'User'}
                  </span>
                </div>
                <button
                  onClick={handleSignOut}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign In
              </Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  )
}
