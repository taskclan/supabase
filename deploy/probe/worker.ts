import { Container, getContainer } from '@cloudflare/containers'

export class ProbeContainer extends Container<Env> {
  defaultPort = 8080
  sleepAfter = '5m'
  override onStart() { console.log('[probe-container] started') }
  override onStop({ exitCode, reason }: { exitCode: number; reason: string }) {
    console.error('[probe-container] stopped exitCode=%s reason=%s', exitCode, reason)
  }
  override onError(error: unknown) {
    console.error('[probe-container] error: %s', error instanceof Error ? error.message : String(error))
    return error
  }
}

interface Env { PROBE: DurableObjectNamespace<ProbeContainer>; [k: string]: unknown }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.PROBE, 'main').fetch(request)
  },
}
