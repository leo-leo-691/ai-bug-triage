/**
 * Minimal chainable stand-in for a supabase-js client.
 * Every from(table) chain is recorded; awaiting it calls `resolve` with the
 * table and the ordered list of builder calls, so tests decide the result.
 */

export type Op = { method: string; args: unknown[] }
export type Call = { table: string; ops: Op[] }
export type Result = { data?: unknown; error?: unknown; count?: number | null }
export type Resolver = (table: string, ops: Op[]) => Result | undefined

const CHAIN_METHODS = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'or', 'not',
  'order', 'range', 'limit', 'single', 'maybeSingle',
]

export function createMockClient(resolve: Resolver = () => undefined) {
  const calls: Call[] = []

  function from(table: string) {
    const call: Call = { table, ops: [] }
    calls.push(call)
    const builder: Record<string, unknown> = {}
    for (const method of CHAIN_METHODS) {
      builder[method] = (...args: unknown[]) => {
        call.ops.push({ method, args })
        return builder
      }
    }
    builder.then = (onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) => {
      const r = resolve(table, call.ops) ?? {}
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null }).then(
        onFulfilled,
        onRejected
      )
    }
    return builder
  }

  const rpc = (fn: string, args: unknown) => {
    calls.push({ table: `rpc:${fn}`, ops: [{ method: 'rpc', args: [args] }] })
    const r = resolve(`rpc:${fn}`, []) ?? {}
    return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
  }

  return { client: { from, rpc } as never, calls }
}

export const hasOp = (call: Call, method: string) => call.ops.some((o) => o.method === method)
export const opArgs = (call: Call, method: string) => call.ops.find((o) => o.method === method)?.args
