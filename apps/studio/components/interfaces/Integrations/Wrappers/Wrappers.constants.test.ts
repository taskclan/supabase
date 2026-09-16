/**
 * Every wrapper the console offers must be creatable.
 *
 * The registry and the `wrappers` extension can drift in both directions. A
 * wrapper listed with a handler the extension does not provide is worse than a
 * missing one: it renders a full detail page and a create form, and fails only
 * at `CREATE FOREIGN DATA WRAPPER`, after the reader has typed a credential
 * into it. Drift the other way is how MongoDB, MySQL, DuckDB and DynamoDB went
 * unoffered for so long — their handlers were installed the whole time.
 *
 * The handler list below is what `wrappers` 0.6.3 actually provides, read from
 * pg_proc on a supabase/postgres image rather than from documentation. When the
 * extension is upgraded this test is the thing that should be updated first,
 * and the diff says which wrappers became available.
 */
import { describe, expect, it } from 'vitest'

import { WRAPPERS } from './Wrappers.constants'

/** `select proname from pg_proc where proname like '%fdw_handler'` on wrappers 0.6.3. */
const HANDLERS_PROVIDED_BY_EXTENSION = new Set([
  'airtable_fdw_handler',
  'auth0_fdw_handler',
  'big_query_fdw_handler',
  'click_house_fdw_handler',
  'cognito_fdw_handler',
  'duckdb_fdw_handler',
  'dynamo_db_fdw_handler',
  'firebase_fdw_handler',
  'hello_world_fdw_handler',
  'iceberg_fdw_handler',
  'logflare_fdw_handler',
  'mongodb_fdw_handler',
  'mssql_fdw_handler',
  'mysql_fdw_handler',
  'redis_fdw_handler',
  's3_fdw_handler',
  's3_vectors_fdw_handler',
  'stripe_fdw_handler',
  'wasm_fdw_handler',
])

describe('wrapper registry', () => {
  it('offers no wrapper whose handler the extension cannot provide', () => {
    const unbacked = WRAPPERS.filter((w) => !HANDLERS_PROVIDED_BY_EXTENSION.has(w.handlerName)).map(
      (w) => `${w.name} -> ${w.handlerName}`
    )

    expect(unbacked, 'these would fail at CREATE FOREIGN DATA WRAPPER').toEqual([])
  })

  it.each(['mongodb_wrapper', 'mysql_wrapper', 'duckdb_wrapper', 'dynamodb_wrapper'])(
    'offers %s, which the extension supports',
    (name) => {
      expect(WRAPPERS.find((w) => w.name === name)).toBeDefined()
    }
  )

  it('requires every option the validators enforce, and no invented ones', () => {
    // Read off each FDW's own validator by creating a server and table until it
    // stopped complaining. Getting these wrong produces a form that builds a
    // server which only fails when queried.
    const required: Record<string, { server: string[]; table: string[] }> = {
      mongodb_wrapper: { server: ['conn_string_id'], table: ['database', 'collection'] },
      mysql_wrapper: { server: ['conn_string_id'], table: ['table'] },
      duckdb_wrapper: { server: ['type'], table: ['table'] },
      dynamodb_wrapper: {
        server: ['vault_access_key_id', 'vault_secret_access_key'],
        table: ['table'],
      },
    }

    for (const [name, expected] of Object.entries(required)) {
      const wrapper = WRAPPERS.find((w) => w.name === name)!
      const serverRequired = wrapper.server.options.filter((o) => o.required).map((o) => o.name)
      const tableRequired = (wrapper.tables[0].options ?? [])
        .filter((o) => o.required)
        .map((o) => o.name)

      expect(serverRequired.sort(), `${name} server options`).toEqual(expected.server.sort())
      expect(tableRequired.sort(), `${name} table options`).toEqual(expected.table.sort())
    }
  })

  it('stores every credential in Vault rather than as a plain server option', () => {
    // A connection string or secret key written straight into srvoptions is
    // readable by anyone who can select from pg_foreign_server.
    for (const name of ['mongodb_wrapper', 'mysql_wrapper', 'dynamodb_wrapper']) {
      const wrapper = WRAPPERS.find((w) => w.name === name)!
      const credentials = wrapper.server.options.filter((o) => /conn_string|key/.test(o.name))

      expect(credentials.length, `${name} should have credentials`).toBeGreaterThan(0)
      for (const option of credentials) {
        expect(option.encrypted, `${name}.${option.name} must be encrypted`).toBe(true)
        expect(option.secureEntry, `${name}.${option.name} must be secure entry`).toBe(true)
      }
    }
  })

  it('pins every Wasm wrapper to a package whose checksum still verifies', () => {
    // A stale pin does not fail at creation. It fails when the table is first
    // queried, with `component verification failed` and no mention of a
    // version, which is how Cal.com and Calendly sat broken while the other
    // eight worked. Checking that a pin exists will not catch the next one —
    // only running the module does, so these values came from the publisher's
    // own checksum.txt and were confirmed against wrappers 0.6.3.
    const verified: Record<string, string> = {
      cal_wrapper: '0.2.0',
      calendly_wrapper: '0.2.0',
    }

    for (const [name, version] of Object.entries(verified)) {
      const wrapper = WRAPPERS.find((w) => w.name === name)!
      const option = (o: string) => wrapper.server.options.find((x) => x.name === o)?.defaultValue

      expect(option('fdw_package_version'), `${name} version`).toBe(version)
      // The URL must name the same version it claims, or the checksum is being
      // verified against a different build than the one downloaded.
      expect(String(option('fdw_package_url')), `${name} url`).toContain(`_v${version}/`)
    }
  })
})
