import { Container, getContainer } from '@cloudflare/containers'

/**
 * Probe 5: does the console's image just need longer to open its port?
 *
 * @cloudflare/containers waits TIMEOUT_TO_GET_PORTS_MS = 20_000 for the port,
 * and containerFetch() never overrides it. The CI smoke test slept exactly 20s
 * on a four-core runner before Next answered; standard-1 is half a vCPU, and
 * this build has experimental.preloadEntriesOnStart = true, so Next loads every
 * route entry before it listens.
 *
 * Next's start-server installs SIGTERM/SIGINT handlers that call
 * process.exit(0). So a container killed for missing its port deadline exits
 * ZERO — which is exactly what onStop reported, and why this looked for hours
 * like a container that was never started rather than one that was stopped.
 */
export class ProbeContainer extends Container<Env> {
  defaultPort = 8080
  sleepAfter = '10m'
  envVars = { PORT: '8080', HOSTNAME: '0.0.0.0' } as Record<string, string>

  override onStart() { console.log('[probe-container] started') }
  override onStop({ exitCode, reason }: { exitCode: number; reason: string }) {
    console.error('[probe-container] stopped exitCode=%s reason=%s', exitCode, reason)
  }
  override onError(error: unknown) {
    console.error('[probe-container] error: %s', error instanceof Error ? error.message : String(error))
    return error
  }

  // The whole point of the probe: wait minutes, not twenty seconds.
  override async fetch(request: Request): Promise<Response> {
    const started = Date.now()
    try {
      await this.startAndWaitForPorts(this.defaultPort, {
        portReadyTimeoutMS: 240_000,
        waitInterval: 1_000,
      })
    } catch (e) {
      const secs = ((Date.now() - started) / 1000).toFixed(0)
      return new Response(
        `port never opened after ${secs}s: ${e instanceof Error ? e.message : String(e)}\n`,
        { status: 504, headers: { 'cache-control': 'no-store' } },
      )
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    console.log('[probe-container] port ready after %ss', secs)
    const res = await super.fetch(request)
    const out = new Response(res.body, res)
    out.headers.set('x-probe-port-ready-seconds', secs)
    return out
  }
}

interface Env { PROBE: DurableObjectNamespace<ProbeContainer>; [k: string]: unknown }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.PROBE, 'main').fetch(request)
  },
}
