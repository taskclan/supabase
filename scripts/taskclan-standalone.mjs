/**
 * Finish Next's standalone output so `node server.js` can actually serve.
 *
 * `output: 'standalone'` traces the server's modules but deliberately leaves
 * out `.next/static` and `public` — Vercel serves those from its CDN, so Next
 * assumes something else will. Nothing else does here: Taskclan Cloud runs the
 * standalone server in a Cloudflare Container and serves its own assets, so
 * without this the app boots and every stylesheet, script and image 404s. The
 * page renders as unstyled HTML, which reads like a broken build rather than a
 * missing copy step.
 *
 * In a pnpm workspace the traced output is nested by workspace path, so the
 * server lives at `.next/standalone/apps/studio/server.js` and the assets have
 * to land beside it rather than at the standalone root.
 *
 * 164 MB of assets, so this is a copy rather than a bundle: the container image
 * carries them, and the Worker in front never sees them.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const studio = join(repoRoot, 'apps/studio')
const standalone = join(studio, '.next/standalone/apps/studio')

if (!existsSync(standalone)) {
  console.error('[taskclan-standalone] no standalone output at %s — did the studio build run?', standalone)
  process.exit(1)
}

const copies = [
  [join(studio, '.next/static'), join(standalone, '.next/static')],
  [join(studio, 'public'), join(standalone, 'public')],
]

for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.log('[taskclan-standalone] skip (absent): %s', from)
    continue
  }
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
  console.log('[taskclan-standalone] %s -> %s', from.replace(repoRoot + '/', ''), to.replace(repoRoot + '/', ''))
}

console.log('[taskclan-standalone] server entry: %s', join(standalone, 'server.js').replace(repoRoot + '/', ''))
