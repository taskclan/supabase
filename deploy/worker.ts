/**
 * Cloudflare Worker in front of the Taskclan Cloud console container.
 *
 * The console used to be deployed *by* Taskclan Cloud, through the same builder
 * that ships tenant apps. That is the wrong dependency direction for a control
 * plane — you cannot deploy the console when the thing the console operates is
 * broken — and in practice the console inherited a build pipeline budgeted for
 * five-minute tenant apps. This Worker replaces the one the engine generated,
 * so the console deploys straight to Cloudflare from its own repo.
 *
 * Deliberately smaller than the generated one: no cron, no request sharding, no
 * edge cache. The console is authenticated, per-user and low-traffic; caching
 * its responses at the edge would be wrong, and there is nothing to shard.
 */
import { Container, getContainer } from '@cloudflare/containers'

export class ConsoleContainer extends Container<Env> {
  defaultPort = 8080
  // Long enough that a working session never pays a cold start, short enough
  // that an idle console is not billed overnight.
  sleepAfter = '30m'
  // The console talks to the engine API, Supabase and pg-meta.
  enableInternet = true
  // Pass every string binding through, and force PORT to the container port the
  // way Heroku does — the standalone server reads process.env.PORT and would
  // otherwise bind Next's default.
  envVars = {
    ...Object.fromEntries(Object.entries(this.env).filter(([, v]) => typeof v === 'string')),
    PORT: '8080',
  } as Record<string, string>
}

interface Env {
  CONSOLE: DurableObjectNamespace<ConsoleContainer>
  [key: string]: unknown
}

const ACCESS_COOKIE = 'tc_access'

/**
 * Private-site gate, kept from the generated Worker.
 *
 * Inert unless TC_ACCESS_TOKEN is set. It runs BEFORE any container call so
 * internet noise cannot wake a sleeping container — the open internet knocks
 * constantly, and answering at the Worker costs a fraction of what waking the
 * container costs.
 *
 * Note the monitoring consequence, which bit this platform for six days: a
 * gated site answers 401 before the container is ever consulted, so an uptime
 * probe that treats 401 as healthy is measuring the gate, not the app. The
 * engine's probe now sends the token for exactly this reason.
 */
function gate(env: Env, request: Request): Response | null {
  const want = typeof env.TC_ACCESS_TOKEN === 'string' ? env.TC_ACCESS_TOKEN.trim() : ''
  if (!want) return null

  const auth = request.headers.get('authorization') || ''
  const bearer = auth.slice(0, 7).toLowerCase() === 'bearer ' ? auth.slice(7).trim() : ''
  const header = (request.headers.get('x-tc-access') || '').trim()
  const cookie =
    (request.headers.get('cookie') || '')
      .split(';')
      .map((c) => c.trim())
      .filter((c) => c.slice(0, ACCESS_COOKIE.length + 1) === ACCESS_COOKIE + '=')
      .map((c) => c.slice(ACCESS_COOKIE.length + 1))[0] || ''
  if (bearer === want || header === want || cookie === want) return null

  // ?tc_access=<token> lets a human open the console in a browser: set the
  // cookie, then redirect to the same URL without the token so it stays out of
  // history, logs and referrers.
  const url = new URL(request.url)
  if ((url.searchParams.get(ACCESS_COOKIE) || '').trim() === want) {
    url.searchParams.delete(ACCESS_COOKIE)
    return new Response(null, {
      status: 302,
      headers: {
        location: url.toString(),
        'set-cookie': `${ACCESS_COOKIE}=${want}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
        'cache-control': 'no-store',
      },
    })
  }

  return new Response('Not authorised', { status: 401, headers: { 'cache-control': 'no-store' } })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const denied = gate(env, request)
    if (denied) return denied
    // One instance: the console holds no per-request state worth sharding, and
    // a single warm container is cheaper and simpler than several cold ones.
    return getContainer(env.CONSOLE, 'main').fetch(request)
  },
}
