export default function Loading() {
  return (
    <div className="p-16 text-center text-slate-500" role="status" aria-live="polite">
      <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
      <p className="text-sm">Loading...</p>
    </div>
  )
}
