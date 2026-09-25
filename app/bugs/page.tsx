'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Bug, Clock, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react'

interface BugItem {
  id: string
  title: string
  description: string
  status: string
  ai_severity: string | null
  human_severity: string | null
  created_at: string
  reporter?: {
    name: string | null
  } | null
}

export default function BugsListPage() {
  const [bugs, setBugs] = useState<BugItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const fetchBugs = async () => {
    try {
      setLoading(true)
      const url = statusFilter === 'all' ? '/api/bugs' : `/api/bugs?status=${statusFilter}`
      const res = await fetch(url)
      const data = await res.json()
      if (res.ok) {
        setBugs(data.bugs || [])
      }
    } catch (err) {
      console.error('Failed to fetch bugs', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBugs()
  }, [statusFilter])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">New</span>
      case 'pending_triage':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">Pending Triage</span>
      case 'pending_review':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">Pending Review</span>
      case 'triaged':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800">Triaged</span>
      case 'in_progress':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-cyan-100 text-cyan-800">In Progress</span>
      case 'resolved':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800">Resolved</span>
      case 'closed':
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-800">Closed</span>
      default:
        return <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-700">{status}</span>
    }
  }

  const getSeverityBadge = (human: string | null, ai: string | null) => {
    const sev = human || ai
    if (!sev) {
      return <span className="text-xs text-slate-400 italic">Unassigned</span>
    }

    const isHuman = !!human
    const style = (() => {
      switch (sev.toLowerCase()) {
        case 'critical':
          return 'bg-rose-100 text-rose-800 border-rose-200'
        case 'high':
          return 'bg-orange-100 text-orange-800 border-orange-200'
        case 'medium':
          return 'bg-amber-100 text-amber-800 border-amber-200'
        case 'low':
          return 'bg-emerald-100 text-emerald-800 border-emerald-200'
        default:
          return 'bg-slate-100 text-slate-700 border-slate-200'
      }
    })()

    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}>
        {sev} {isHuman && <span className="text-[10px] font-normal opacity-75">(Human)</span>}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Bug Queue</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Active bug reports submitted by users and system tests.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchBugs}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link
            href="/report"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition text-sm shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Report New Bug
          </Link>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        {['all', 'new', 'pending_triage', 'pending_review', 'triaged', 'in_progress', 'resolved'].map((filter) => (
          <button
            key={filter}
            onClick={() => setStatusFilter(filter)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition ${
              statusFilter === filter
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {filter.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Bug Table / List */}
      {loading ? (
        <div className="p-12 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-600 mb-2" />
          <p className="text-sm">Loading bug reports...</p>
        </div>
      ) : bugs.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-xl border border-slate-200 space-y-3">
          <Bug className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="font-semibold text-slate-800">No bugs found</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            {statusFilter === 'all'
              ? 'No bug reports have been submitted yet. Submit your first bug to test the system.'
              : `No bug reports with status "${statusFilter}".`}
          </p>
          <Link
            href="/report"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Report a Bug
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3.5">Title & Description</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Severity</th>
                  <th className="px-6 py-3.5">Reporter</th>
                  <th className="px-6 py-3.5">Date</th>
                  <th className="px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {bugs.map((bug) => (
                  <tr key={bug.id} className="hover:bg-slate-50/75 transition">
                    <td className="px-6 py-4 max-w-md">
                      <Link href={`/bugs/${bug.id}`} className="group block">
                        <span className="font-medium text-slate-900 group-hover:text-indigo-600 transition">
                          {bug.title}
                        </span>
                        <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                          {bug.description}
                        </p>
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(bug.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getSeverityBadge(bug.human_severity, bug.ai_severity)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">
                      {bug.reporter?.name || 'Anonymous'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                      {new Date(bug.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                      <Link
                        href={`/bugs/${bug.id}`}
                        className="text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        View Details &rarr;
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
