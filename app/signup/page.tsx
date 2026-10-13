'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { UserPlus, AlertCircle, CheckCircle2, Loader2, KeyRound, Eye, EyeOff } from 'lucide-react'

export default function SignUpPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Steps: 'register' -> 'verify' -> 'success'
  const [step, setStep] = useState<'register' | 'verify' | 'success'>('register')

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      setLoading(false)
      return
    }

    try {
      const supabase = createClient()

      // 1. Supabase Auth signup
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/bugs`,
        },
      })

      if (signUpErr) throw signUpErr

      // Detect existing account
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setError('An account with this email already exists. Please sign in instead.')
        return
      }

      // The public.users profile (role 'reporter') is created by a database trigger.

      // Check if session was created immediately. If not, email confirmation is required.
      if (!data.session) {
        setStep('verify')
      } else {
        setStep('success')
        setTimeout(() => router.push('/bugs'), 1500)
      }
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
            <div className="flex-1">
              <p>{error}</p>
              {error.includes('already exists') && (
                <p className="mt-1 text-xs">
                  <Link href="/login" className="font-semibold text-indigo-700 underline hover:text-indigo-900">
                    Sign in here &rarr;
                  </Link>
                </p>
              )}
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm flex items-start gap-2 border border-emerald-100">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <p>Registration successful! Redirecting...</p>
          </div>
        )}

        {step === 'register' && (
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
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
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
        )}

        {step === 'verify' && (
          <div className="space-y-4 mb-6 text-center">
            <div className="p-4 bg-blue-50 border border-blue-100 text-blue-800 rounded-lg text-sm mb-4">
              <p className="font-semibold text-base mb-2">Check your inbox!</p>
              <p>We've sent a confirmation link to <strong>{email}</strong>.</p>
              <p className="mt-2 text-blue-700">Please click the link in the email to activate your account. You can then close that window and sign in below.</p>
            </div>
            
            <button
              onClick={() => router.push('/login')}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition shadow-sm"
            >
              Go to Sign In
            </button>
          </div>
        )}

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
