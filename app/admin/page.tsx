'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserCheck,
  Tag as TagIcon,
  RefreshCw,
  Copy,
  Plus,
  X,
  Sparkles,
  ExternalLink,
} from 'lucide-react'

interface Developer {
  id: string
  name: string | null
  email: string
  role: string
}

interface TagItem {
  id: string
  name: string
  source: 'ai' | 'human'
}

interface DuplicateItem {
  duplicate_of_bug_id: string
  similarity_score: number
  confirmed: boolean | null
  duplicate_of?: {
    id: string
    title: string
  }
}

interface AdminBugItem {
  id: string
  title: string
  description: string
  status: string
  ai_severity: string | null
  ai_confidence: number | null
  human_severity: string | null
  created_at: string
  assigned_to: string | null
  tags: TagItem[]
  duplicates: DuplicateItem[]
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

export default function AdminTriagePage() {
  const [bugs, setBugs] = useState<AdminBugItem[]>([])
  const [developers, setDevelopers] = useState<Developer[]>([])
  const [availableTags, setAvailableTags] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [newTagInputs, setNewTagInputs] = useState<Record<string, string>>({})
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)

  const loadData = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/triage')
      const data = await res.json()
      if (res.ok) {
        setBugs(data.bugs || [])
        setDevelopers(data.developers || [])
        setAvailableTags(data.availableTags || [])
      }
    } catch (err) {
      console.error('Failed to load admin triage data', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const executeAction = async (bugId: string, action: string, payload: any) => {
    try {
      setUpdatingId(bugId)
      setFeedbackMessage(null)
      const res = await fetch('/api/admin/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bug_id: bugId,
          action,
          payload,
          actor_email: 'admin@bugtrack.system',
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Action failed')
      }

      setFeedbackMessage(data.auditDescription || 'Action saved to audit log.')
      // Refresh data
      await loadData()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error updating triage record')
    } finally {
      setUpdatingId(null)
    }
  }

  // Count summaries
  const criticalCount = bugs.filter((b) => (b.human_severity || b.ai_severity) === 'Critical').length
  const pendingReviewCount = bugs.filter((b) => b.status === 'pending_review').length
  const duplicatesCount = bugs.filter((b) => b.duplicates && b.duplicates.length > 0).length

  return (
    <div className="space-y-8">
      {/* Header & Stats */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Admin Triage Dashboard</h1>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
              Admin / Dev Role
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Prioritize by AI severity, override classifications, manage tags, review duplicate flags, and assign developers.
          </p>
        </div>

        <button
          onClick={loadData}
          className="self-start md:self-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 transition shadow-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Queue
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <p className="text-xs font-semibold text-slate-500 uppercase">Total Bugs</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{bugs.length}</p>
        </div>
        <div className="p-4 rounded-xl bg-white border border-rose-200 shadow-xs">
          <p className="text-xs font-semibold text-rose-600 uppercase">Critical Priority</p>
          <p className="text-2xl font-bold text-rose-700 mt-1">{criticalCount}</p>
        </div>
        <div className="p-4 rounded-xl bg-white border border-purple-200 shadow-xs">
          <p className="text-xs font-semibold text-purple-600 uppercase">Needs Review (&lt;0.6 Conf)</p>
          <p className="text-2xl font-bold text-purple-700 mt-1">{pendingReviewCount}</p>
        </div>
        <div className="p-4 rounded-xl bg-white border border-amber-200 shadow-xs">
          <p className="text-xs font-semibold text-amber-600 uppercase">Duplicate Links</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{duplicatesCount}</p>
        </div>
      </div>

      {/* Toast Feedback Notification */}
      {feedbackMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Audit log updated: <strong>{feedbackMessage}</strong></span>
          </div>
          <button onClick={() => setFeedbackMessage(null)} className="text-emerald-600 hover:text-emerald-900">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Triage Table */}
      {loading && bugs.length === 0 ? (
        <div className="p-16 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-600 mb-2" />
          <p className="text-sm">Loading triage queue...</p>
        </div>
      ) : bugs.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-xl border border-slate-200 text-slate-500 text-sm">
          No bugs in the queue.
        </div>
      ) : (
        <div className="space-y-4">
          {bugs.map((bug) => {
            const currentSeverity = bug.human_severity || bug.ai_severity || 'Medium'
            const isHumanOverridden = Boolean(bug.human_severity)

            return (
              <div
                key={bug.id}
                className={`bg-white rounded-xl border p-5 sm:p-6 shadow-xs space-y-4 transition ${
                  currentSeverity === 'Critical'
                    ? 'border-rose-300 ring-1 ring-rose-200/50'
                    : currentSeverity === 'High'
                    ? 'border-orange-300'
                    : 'border-slate-200'
                }`}
              >
                {/* Header Row */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Effective Severity Badge */}
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                          currentSeverity === 'Critical'
                            ? 'bg-rose-100 text-rose-800'
                            : currentSeverity === 'High'
                            ? 'bg-orange-100 text-orange-800'
                            : currentSeverity === 'Medium'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {currentSeverity}
                        {isHumanOverridden && <span className="text-[10px] font-normal lowercase">(human override)</span>}
                      </span>

                      {/* AI Confidence */}
                      {bug.ai_confidence !== null && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">
                          <Sparkles className="w-3 h-3 text-indigo-500" />
                          AI Conf: {Math.round(bug.ai_confidence * 100)}%
                        </span>
                      )}

                      {/* Status */}
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 capitalize">
                        {bug.status.replace('_', ' ')}
                      </span>
                    </div>

                    <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                      <Link href={`/bugs/${bug.id}`} className="hover:text-indigo-600 transition">
                        {bug.title}
                      </Link>
                    </h2>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0">
                    <Link
                      href={`/bugs/${bug.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      View
                    </Link>
                  </div>
                </div>

                {/* Bug Description Excerpt */}
                <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed bg-slate-50 p-3 rounded-lg">
                  {bug.description}
                </p>

                {/* Triage Controls Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
                  {/* 1. Severity Override */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                      Override Severity
                    </label>
                    <select
                      value={bug.human_severity || bug.ai_severity || 'Medium'}
                      onChange={(e) => executeAction(bug.id, 'OVERRIDE_SEVERITY', { severity: e.target.value })}
                      disabled={updatingId === bug.id}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="Critical">Critical</option>
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                  </div>

                  {/* 2. Status Control */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                      Bug Status
                    </label>
                    <select
                      value={bug.status}
                      onChange={(e) => executeAction(bug.id, 'UPDATE_STATUS', { status: e.target.value })}
                      disabled={updatingId === bug.id}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white focus:ring-1 focus:ring-indigo-500 capitalize"
                    >
                      <option value="new">New</option>
                      <option value="pending_triage">Pending Triage</option>
                      <option value="pending_review">Pending Review</option>
                      <option value="triaged">Triaged</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>

                  {/* 3. Assign Developer */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                      Assign Developer
                    </label>
                    <select
                      value={bug.assigned_to || ''}
                      onChange={(e) => executeAction(bug.id, 'ASSIGN_DEVELOPER', { assigned_to: e.target.value || null })}
                      disabled={updatingId === bug.id}
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="">-- Unassigned --</option>
                      {developers.map((dev) => (
                        <option key={dev.id} value={dev.id}>
                          {dev.name || dev.email} ({dev.role})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Tags Management */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase">Tags</span>
                    <span className="text-[10px] text-slate-400">Click &times; to remove, or type to add</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {bug.tags.map((t) => (
                      <span
                        key={t.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700 border border-slate-200"
                      >
                        {t.name}
                        <span className="text-[9px] text-slate-400">({t.source})</span>
                        <button
                          onClick={() => executeAction(bug.id, 'REMOVE_TAG', { tag_id: t.id })}
                          disabled={updatingId === bug.id}
                          className="hover:text-red-600 transition ml-0.5"
                          title="Remove tag"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}

                    {/* Quick Add Tag Input */}
                    <div className="inline-flex items-center gap-1">
                      <input
                        type="text"
                        placeholder="+ tag name"
                        value={newTagInputs[bug.id] || ''}
                        onChange={(e) => setNewTagInputs({ ...newTagInputs, [bug.id]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newTagInputs[bug.id]?.trim()) {
                            e.preventDefault()
                            executeAction(bug.id, 'ADD_TAG', { tag_name: newTagInputs[bug.id].trim() })
                            setNewTagInputs({ ...newTagInputs, [bug.id]: '' })
                          }
                        }}
                        className="text-xs px-2 py-0.5 rounded border border-slate-300 w-24 focus:w-32 transition-all bg-white"
                      />
                      {newTagInputs[bug.id]?.trim() && (
                        <button
                          onClick={() => {
                            executeAction(bug.id, 'ADD_TAG', { tag_name: newTagInputs[bug.id].trim() })
                            setNewTagInputs({ ...newTagInputs, [bug.id]: '' })
                          }}
                          className="p-1 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Duplicate Review Flags */}
                {bug.duplicates.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-purple-100 bg-purple-50/40 p-3 rounded-lg">
                    <div className="flex items-center gap-1.5 text-purple-900 font-semibold text-xs">
                      <Copy className="w-3.5 h-3.5" />
                      <span>Semantic Duplicate Flags (pgvector cosine &gt; 0.85)</span>
                    </div>

                    <div className="space-y-2">
                      {bug.duplicates.map((dup, dIdx) => (
                        <div
                          key={dIdx}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded bg-white border border-purple-200 text-xs"
                        >
                          <div>
                            <span className="font-medium text-slate-900">
                              Matches: "{dup.duplicate_of?.title || dup.duplicate_of_bug_id}"
                            </span>
                            <span className="text-purple-700 ml-2 font-bold">
                              ({(dup.similarity_score * 100).toFixed(1)}% match)
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {dup.confirmed === true ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
                                <CheckCircle2 className="w-3 h-3" /> Confirmed
                              </span>
                            ) : dup.confirmed === false ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px]">
                                <XCircle className="w-3 h-3" /> Rejected
                              </span>
                            ) : null}

                            <button
                              onClick={() =>
                                executeAction(bug.id, 'REVIEW_DUPLICATE', {
                                  duplicate_of_bug_id: dup.duplicate_of_bug_id,
                                  confirmed: true,
                                })
                              }
                              disabled={updatingId === bug.id}
                              className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-[11px] font-medium transition"
                            >
                              Confirm Duplicate
                            </button>
                            <button
                              onClick={() =>
                                executeAction(bug.id, 'REVIEW_DUPLICATE', {
                                  duplicate_of_bug_id: dup.duplicate_of_bug_id,
                                  confirmed: false,
                                })
                              }
                              disabled={updatingId === bug.id}
                              className="px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 text-[11px] transition"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
