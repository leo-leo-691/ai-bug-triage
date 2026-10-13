/**
 * Returns `value` only if it is a same-origin relative path (e.g. "/bugs/123?x=1"),
 * otherwise `fallback`. Blocks absolute URLs, protocol-relative "//host" and "/\host".
 */
export function safeRedirectPath(value: string | null | undefined, fallback = '/bugs'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback
  }
  try {
    const base = 'http://internal.invalid'
    const url = new URL(value, base)
    if (url.origin !== base) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
