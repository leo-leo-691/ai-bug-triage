'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, User, Tag, Copy, AlertTriangle, ShieldCheck, History, CheckCircle2, XCircle } from 'lucide-react'

interface TagItem {
  source: 'ai' | 'human'
  tag: {
    id: string
    name: string
  }
}

interface DuplicateItem {
  similarity_score: number
  confirmed: boolean | null
  duplicate_of: {
    id: string
    title: string
    status: string
    ai_severity: string | null
  }
}

interface AuditLogItem {
  id: string
  action: string
  created_at: string
  actor?: {
    name: string | null
    email: string | null
    role: string | null
  } | null
}

interface BugDetail {
  id: string
  title: string
  description: string
  steps_to_reproduce: string | null
  status: string
  ai_severity: string | null
  ai_confidence: number | null
  human_severity: string | null
  created_at: string
  reporter?: {
    id: string
    name: string | null
    email: string | null
  } | null
  assignee?: {
    id: string
    name: string | null
    email: string | null
  } | null
}

export default function BugDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const id = resolvedParams.id

  const [bug, setBug] = useState<BugDetail | null>(null)
  const [tags, setTags] = useState<TagItem[]>([])
  const [duplicates, setDuplicates] = useState<DuplicateItem[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadBug() {
      try {
        setLoading(true)
        const res = await fetch(`/api/bugs/${id}`)
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || 'Failed to load bug report')
        }

        setBug(data.bug)
        setTags(data.tags || [])
        setDuplicates(data.duplicates || [])
        setAuditLogs(data.auditLogs || [])
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to fetch bug')
      } finally {
        setLoading(false)
      }
    }

    loadBug()
  }, [id])

  if (loading) {
    return (
      <div className="p-16 text-center text-slate-500">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-sm">Loading bug report details...</p>
      </div>
    )
  }

  if (error || !bug) {
    return (
      <div className="max-w-xl mx-auto p-8 text-center bg-white rounded-xl border border-red-200 space-y-4">
        <AlertTriangle className="w-10 h-10 text-red-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Bug Report Not Found</h2>
        <p className="text-sm text-slate-600">{error || 'Could not find the requested bug report.'}</p>
        <Link
          href="/bugs"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Bug Queue
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/bugs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Bug Queue
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-400">ID: {bug.id.slice(0, 8)}...</span>
        </div>
      </div>

      {/* Main Bug Header Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 pb-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-slate-100 text-slate-700 uppercase tracking-wide">
                Status: {bug.status.replace('_', ' ')}
              </span>
              {bug.human_severity && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
                  Severity: {bug.human_severity} (Human Verified)
                </span>
              )}
              {bug.ai_severity && !bug.human_severity && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                  AI Severity: {bug.ai_severity}
                  {bug.ai_confidence && ` (${Math.round(bug.ai_confidence * 100)}% conf)`}
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              {bug.title}
            </h1>
          </div>

          <div className="text-xs text-slate-500 shrink-0 sm:text-right space-y-1">
            <div className="flex items-center sm:justify-end gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>{new Date(bug.created_at).toLocaleString()}</span>
            </div>
            <div className="flex items-center sm:justify-end gap-1.5">
              <User className="w-3.5 h-3.5" />
              <span>{bug.reporter?.name || bug.reporter?.email || 'Anonymous reporter'}</span>
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Description</h3>
          <p className="text-slate-800 text-sm whitespace-pre-wrap leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-100">
            {bug.description}
          </p>
        </div>

        {/* Steps to Reproduce */}
        {bug.steps_to_reproduce && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Steps to Reproduce</h3>
            <pre className="text-xs text-slate-700 bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto font-mono whitespace-pre-wrap">
              {bug.steps_to_reproduce}
            </pre>
          </div>
        )}

        {/* Tags */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Tags</h3>
          {tags.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No tags attached yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <span
                  key={t.tag.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200"
                >
                  <Tag className="w-3 h-3 text-slate-400" />
                  {t.tag.name}
                  <span className="text-[10px] text-slate-400">({t.source})</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Potential Duplicates (pgvector) */}
        {duplicates.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <Copy className="w-4 h-4 text-purple-600" />
              <h3 className="text-sm font-bold text-slate-900">Semantic Duplicates Detected by pgvector</h3>
            </div>
            <div className="space-y-2">
              {duplicates.map((dup, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg border border-purple-200 bg-purple-50/50 text-xs"
                >
                  <div className="space-y-0.5">
                    <Link
                      href={`/bugs/${dup.duplicate_of.id}`}
                      className="font-medium text-purple-900 hover:underline"
                    >
                      {dup.duplicate_of.title}
                    </Link>
                    <div className="text-slate-500">
                      Similarity Score: <span className="font-semibold text-purple-700">{(dup.similarity_score * 100).toFixed(1)}%</span> &bull; Status: {dup.duplicate_of.status}
                    </div>
                  </div>
                  <div>
                    {dup.confirmed === true && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
                        <CheckCircle2 className="w-3 h-3" /> Confirmed Duplicate
                      </span>
                    )}
                    {dup.confirmed === false && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px]">
                        <XCircle className="w-3 h-3" /> Rejected Duplicate
                      </span>
                    )}
                    {dup.confirmed === null && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-medium">
                        Unreviewed
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Audit Log Timeline */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Audit History</h3>
          </div>
          {auditLogs.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No audit records found.</p>
          ) : (
            <div className="space-y-2">
              {auditLogs.map((log) => (
                <div key={log.id} className="text-xs flex items-center justify-between p-2 rounded bg-slate-50 text-slate-600">
                  <span>{log.action}</span>
                  <span className="text-slate-400">
                    {new Date(log.created_at).toLocaleString()} {log.actor ? `by ${log.actor.name || log.actor.email}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
