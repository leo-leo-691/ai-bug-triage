'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Send, AlertCircle, Loader2 } from 'lucide-react'

export default function ReportBugPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    steps_to_reproduce: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!formData.title.trim()) {
      setErrorMessage('Please enter a bug title.')
      return
    }
    if (!formData.description.trim()) {
      setErrorMessage('Please enter a bug description.')
      return
    }

    try {
      setIsSubmitting(true)
      const res = await fetch('/api/bugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const data = await res.json()

      if (res.status === 401) {
        router.push('/login?redirect=/report')
        return
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit bug report')
      }

      // Navigate to the newly created bug details
      router.push(`/bugs/${data.bug.id}`)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/bugs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Bug Queue
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Report a Bug</h1>
          <p className="text-sm text-slate-500 mt-1">
            Provide details about the issue to help our team investigate and resolve it.
          </p>
        </div>

        {errorMessage && (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex items-start gap-3 text-red-700 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0 text-red-500 mt-0.5" />
            <div>
              <p className="font-semibold">Submission failed</p>
              <p>{errorMessage}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="title" className="block text-sm font-semibold text-slate-800 mb-1">
              Bug Title <span className="text-red-500">*</span>
            </label>
            <input
              id="title"
              type="text"
              required
              minLength={5}
              maxLength={200}
              placeholder="e.g., App crashes on checkout when coupon code is empty"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white"
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-semibold text-slate-800 mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              id="description"
              required
              minLength={10}
              maxLength={10000}
              rows={4}
              placeholder="Provide a clear description of what happened vs what was expected..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white"
            />
          </div>

          <div>
            <label htmlFor="steps" className="block text-sm font-semibold text-slate-800 mb-1">
              Steps to Reproduce
            </label>
            <textarea
              id="steps"
              maxLength={10000}
              rows={3}
              placeholder="1. Navigate to cart&#10;2. Leave promo field empty and click Apply&#10;3. Observe 500 server crash"
              value={formData.steps_to_reproduce}
              onChange={(e) => setFormData({ ...formData, steps_to_reproduce: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white font-mono text-xs"
            />
          </div>

          <div className="pt-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition shadow-sm text-sm"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting Bug Report...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Submit Bug Report
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
