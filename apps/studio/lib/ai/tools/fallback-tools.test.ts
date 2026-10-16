/**
 * The assistant's fallback schema tool runs its query in-process, so unlike the
 * HTTP pg-meta routes nothing resolves the caller for it. It must thread the app
 * `ref` and the `caller` into executeQuery. Passing executeQuery bare lost both:
 * with per-app credentials on, no `ref` silently read the shared database (the
 * one holding cloud_api_keys), and a `ref` with no `caller` threw.
 *
 * Regression for Kin "tell me more about my data" failing with
 * `No caller for "forge3d-spaces": a per-app query must say who is asking.`
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getFallbackTools } from './fallback-tools'
import { executeSql } from '@/data/sql/execute-sql-mutation'
import { executeQuery } from '@/lib/api/self-hosted/query'
import type { Caller } from '@/lib/taskclan/callerContext'

vi.mock('common', () => ({ IS_PLATFORM: false }))
vi.mock('@supabase/pg-meta', () => ({ getEntityDefinitionsSql: () => 'select 1' }))
vi.mock('@/data/database-functions/database-functions-query', () => ({
  getDatabaseFunctions: vi.fn(),
}))
vi.mock('@/data/database-policies/database-policies-query', () => ({
  getDatabasePolicies: vi.fn(),
}))

// For self-hosted, executeSql runs the fetcherOverride (its 4th arg) rather than
// going over HTTP. Invoke it so the test sees exactly what the tool hands
// executeQuery.
vi.mock('@/data/sql/execute-sql-mutation', () => ({
  executeSql: vi.fn(
    async (
      _opts: unknown,
      _signal: unknown,
      _headers: unknown,
      fetcherOverride?: (o: { query: string; headers?: HeadersInit }) => Promise<unknown>
    ) => {
      if (fetcherOverride) await fetcherOverride({ query: 'select 1', headers: {} })
      return { result: [] }
    }
  ),
}))

vi.mock('@/lib/api/self-hosted/query', () => ({
  executeQuery: vi.fn(async () => ({ data: [], error: undefined })),
}))

const CALLER: Caller = { kind: 'user', token: 'jwt.body.sig', org: 'org-1' }
const TOOL_OPTS = { toolCallId: 'test', messages: [], context: {} } as any

describe('getFallbackTools getSchemaTables — per-app isolation', () => {
  beforeEach(() => {
    vi.mocked(executeSql).mockClear()
    vi.mocked(executeQuery).mockClear()
  })

  it('runs the in-process query against the app ref as the caller, never the shared DB', async () => {
    const tools = getFallbackTools({
      projectRef: 'forge3d-spaces',
      connectionString: '',
      caller: CALLER,
      includeSchemaMetadata: true,
    })

    const execute = tools.getSchemaTables.execute
    if (!execute) throw new Error('getSchemaTables.execute is undefined')
    await execute({ schemas: ['public'] }, TOOL_OPTS)

    expect(executeQuery).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(executeQuery).mock.calls[0][0]
    // Without `ref` the query falls to the shared connection; without `caller`
    // the per-app guard throws. Both must be present, or isolation is lost.
    expect(arg.ref).toBe('forge3d-spaces')
    expect(arg.caller).toBe(CALLER)
    expect(arg.readOnly).toBe(true)
  })
})
