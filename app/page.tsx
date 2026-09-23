import Link from 'next/link'
import { ArrowRight, Bug, Sparkles, ShieldAlert, Cpu } from 'lucide-react'

export default function HomePage() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="text-center max-w-2xl mx-auto pt-6 space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          Powered by Gemini / OpenAI + Supabase pgvector
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          AI-Assisted Software Bug Reporting & Triage
        </h1>
        <p className="text-base text-slate-600 leading-relaxed">
          Submit bugs, automatically classify severity, detect semantic duplicates using high-dimensional vector embeddings, and streamline engineer triage workflows.
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
          <h3 className="font-semibold text-slate-900 text-lg">Automated Severity & Tags</h3>
          <p className="text-sm text-slate-600">
            Few-shot prompt reasoning classifies reports into Critical, High, Medium, or Low with confidence calibration.
          </p>
        </div>

        <div className="p-6 bg-white rounded-xl border border-slate-200 shadow-sm space-y-2">
          <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
            2
          </div>
          <h3 className="font-semibold text-slate-900 text-lg">pgvector Duplicate Detection</h3>
          <p className="text-sm text-slate-600">
            Semantic vector embeddings match title and reproduction steps against existing open reports (&gt;0.85 cosine similarity).
          </p>
        </div>

        <div className="p-6 bg-white rounded-xl border border-slate-200 shadow-sm space-y-2">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            3
          </div>
          <h3 className="font-semibold text-slate-900 text-lg">Human-in-the-Loop Triage</h3>
          <p className="text-sm text-slate-600">
            Low confidence calls (&lt;0.6) flag for human review, and all admin overrides are strictly recorded in the audit log.
          </p>
        </div>
      </section>
    </div>
  )
}
