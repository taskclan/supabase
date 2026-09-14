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
import type { StopParams } from '@cloudflare/containers'

export class ConsoleContainer extends Container<Env> {
  defaultPort = 8080
  // Long enough that a working session never pays a cold start, short enough
  // that an idle console is not billed overnight.
  sleepAfter = '30m'
  // The console talks to the engine API, Supabase and pg-meta.
  enableInternet = true
  // Pass every string binding through, then force the two the edge depends on.
  //
  // Both are also set as ENV in the Dockerfile, and that is deliberate
  // duplication rather than belt-and-braces for its own sake: Cloudflare
  // demonstrably ignores part of the image config (it drops CMD — see the
  // Dockerfile), so nothing in the image is load-bearing on its own. Set here,
  // they hold whatever the runtime does with the image.
  //
  // PORT because the standalone server reads process.env.PORT and would
  // otherwise bind Next's default; HOSTNAME because a server listening on
  // 127.0.0.1 is invisible to the edge's port check, which is the same symptom
  // as not starting at all.
  envVars = {
    ...Object.fromEntries(Object.entries(this.env).filter(([, v]) => typeof v === 'string')),
    PORT: '8080',
    HOSTNAME: '0.0.0.0',
  } as Record<string, string>

  // Lifecycle logging, because the edge only ever says "the container just
  // exited" or "the container is not running" — true, and useless for telling
  // a missing binary from an app that threw. These surface in `wrangler tail`.
  //
  // The exit code is the part worth having: 127 is a command that does not
  // exist, 1 is the app failing on its own terms, 139 is a segfault. Several
  // deploys were spent inferring which of those it was.
  override onStart() {
    console.log('[console-container] started')
  }

  override onStop({ exitCode, reason }: StopParams) {
    console.error('[console-container] stopped exitCode=%s reason=%s', exitCode, reason)
  }

  override onError(error: unknown) {
    console.error(
      '[console-container] error: %s',
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    )
    return error
  }
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
/**
 * Paths the gate lets through unauthenticated.
 *
 * Only the front door and the assets that render it. A landing page behind a
 * 401 is not a landing page, but the exemption has to be narrow: the console
 * has no sign-in of its own, so everything the gate does not name is the only
 * thing standing between the open internet and a SQL editor over every app's
 * database.
 *
 * `/_next/static/` is here because the landing cannot render without its CSS
 * and JS. Those are compiled bundles that any Next site serves publicly; they
 * carry no data and no credentials. Note what is NOT exempt: `/_next/data/`,
 * which is page props — that would leak the very thing the gate protects.
 */
function isPublicPath(pathname: string): boolean {
  if (pathname === '/landing') return true
  if (pathname.startsWith('/_next/static/')) return true
  if (pathname === '/favicon.ico' || pathname.startsWith('/favicon/')) return true
  return false
}

function gate(env: Env, request: Request): Response | null {
  const want = typeof env.TC_ACCESS_TOKEN === 'string' ? env.TC_ACCESS_TOKEN.trim() : ''
  if (!want) return null

  if (isPublicPath(new URL(request.url).pathname)) return null

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
