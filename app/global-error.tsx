'use client'

// Replaces the root layout when it fails, so it must render its own <html> and <body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#f8fafc', color: '#0f172a' }}>
        <div style={{ maxWidth: 420, margin: '96px auto', textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#64748b' }}>The application failed to load. Please try again.</p>
          {error.digest && <p style={{ fontSize: 12, color: '#94a3b8' }}>Reference: {error.digest}</p>}
          <button
            onClick={reset}
            style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, background: '#4f46e5', color: '#fff', border: 0 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
