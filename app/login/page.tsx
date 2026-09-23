'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { LogIn, AlertCircle, ShieldAlert, Sparkles, Loader2 } from 'lucide-react'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/admin'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const supabase = createClient()
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authErr) {
        throw authErr
      }

      router.push(redirect)
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
          <div>
            <p className="font-semibold">Sign in error</p>
            <p>{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSignIn} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
            Email Address
          </label>
          <input
            type="email"
            required
            placeholder="admin@bugtrack.system"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
            Password
          </label>
          <input
            type="password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition shadow-sm"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          Sign In
        </button>
      </form>

      <div className="pt-2 border-t border-slate-100 space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Don't have an account?</span>
          <Link href="/signup" className="text-indigo-600 font-semibold hover:underline">
            Create Account
          </Link>
        </div>

      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="max-w-md mx-auto py-8 space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 text-white shadow-sm mb-2">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Sign In to BugTrack</h1>
        <p className="text-xs text-slate-500">
          Admin and developer accounts have full access to the triage queue and audit logs.
        </p>
      </div>

      <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500">Loading sign in...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
