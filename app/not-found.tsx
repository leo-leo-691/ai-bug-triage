import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="max-w-md mx-auto py-16 text-center space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Page not found</h1>
      <p className="text-sm text-slate-500">The page you are looking for does not exist or you do not have access to it.</p>
      <Link href="/bugs" className="inline-block px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
        Back to bug queue
      </Link>
    </div>
  )
}
