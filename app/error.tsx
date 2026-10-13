'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Only the digest is useful for correlating with server logs; no stack is shown to users.
    console.error('Page error', error.digest ?? error.message)
  }, [error])

  return (
    <div className="max-w-md mx-auto py-16 text-center space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
      <p className="text-sm text-slate-500">An unexpected error occurred. Please try again.</p>
      {error.digest && <p className="text-xs text-slate-400">Reference: {error.digest}</p>}
      <div className="flex justify-center gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
        >
          Try again
        </button>
        <Link href="/" className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50">
          Go home
        </Link>
      </div>
    </div>
  )
}
