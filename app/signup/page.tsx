'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { UserPlus, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'

export default function SignUpPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const supabase = createClient()

      // 1. Supabase Auth signup
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name, role: 'reporter' },
        },
      })

      if (signUpErr) throw signUpErr

      // 2. Also ensure record exists in users table with role
      if (data.user) {
        await supabase.from('users').upsert({
          id: data.user.id,
          name,
          email,
          role: 'reporter',
        })
      }

      setSuccess(true)
      setTimeout(() => {
        router.push('/bugs')
      }, 1500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto py-8 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Create an Account
        </h1>
        <p className="text-sm text-slate-500">
          Join the bug tracking system to report and monitor issues
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm flex items-start gap-2 border border-red-100">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm flex items-start gap-2 border border-emerald-100">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <p>Registration successful! Redirecting...</p>
          </div>
        )}

        <form onSubmit={handleSignUp} className="space-y-4 mb-6">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              Full Name
            </label>
            <input
              type="text"
              required
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              placeholder="jane@university.edu"
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
              minLength={6}
              placeholder="At least 6 characters"
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
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Register Account
          </button>
        </form>

        <div className="pt-2 border-t border-slate-100 text-center text-xs text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="text-indigo-600 font-semibold hover:underline">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}
