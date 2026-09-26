import Link from 'next/link'
import { ArrowRight, Bug, ShieldAlert } from 'lucide-react'

export default function HomePage() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="text-center max-w-2xl mx-auto pt-6 space-y-4">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          AI-Assisted Software Bug Reporting & Triage
        </h1>
        <p className="text-base text-slate-600 leading-relaxed">
          Report issues, track their progress, and help development teams resolve bugs faster.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link
            href="/report"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition shadow-sm"
          >
            <Bug className="w-4 h-4" />
            Report a Bug
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/bugs"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition"
          >
            View Bug Queue
          </Link>
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-800 transition"
          >
            <ShieldAlert className="w-4 h-4" />
            Admin Triage
          </Link>
        </div>
      </section>

      {/* 4 Architecture Pillars */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
        <div className="p-6 bg-white rounded-xl border border-slate-200 shadow-sm space-y-2">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            1
          </div>
          <h3 className="font-semibold text-slate-900 text-lg">Smart Bug Classification</h3>
          <p className="text-sm text-slate-600">
            Automatically organizes reported issues by severity and category to help teams prioritize what needs attention.
          </p>
        </div>

        <div className="p-6 bg-white rounded-xl border border-slate-200 shadow-sm space-y-2">
          <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
            2
          </div>
          <h3 className="font-semibold text-slate-900 text-lg">Duplicate Detection</h3>
          <p className="text-sm text-slate-600">
            Identifies similar reports to reduce duplicate issues and keep the bug queue organized.
          </p>
        </div>

        <div className="p-6 bg-white rounded-xl border border-slate-200 shadow-sm space-y-2">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            3
          </div>
          <h3 className="font-semibold text-slate-900 text-lg">Human Review & Triage</h3>
          <p className="text-sm text-slate-600">
            Potentially complex or uncertain issues can be reviewed and managed by authorized team members.
          </p>
        </div>
      </section>
    </div>
  )
}
