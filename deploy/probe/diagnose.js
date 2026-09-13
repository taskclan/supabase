// Make the container report why Next will not start.
//
// Every signal so far has been absent rather than wrong: container stdout does
// not reach Workers Logs, and Next exits 0 (its SIGTERM handler) so the exit
// code says nothing. Probes cleared the platform, the Worker, the entrypoint
// form and the image payload — a trivial server on this exact tree serves.
//
// So: listen FIRST, on the port the edge checks, so the container stays alive
// and reachable whatever Next does. Then boot Next in-process on a different
// port and serve whatever it threw at /.
const http = require('http')

const state = { phase: 'starting', node: process.version, cwd: process.cwd(), log: [] }
const push = (...a) => {
  const s = a.map((x) => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')
  state.log.push(s)
  console.log('[diag]', s)
}

http
  .createServer((_q, r) => {
    r.writeHead(200, { 'content-type': 'application/json' })
    r.end(JSON.stringify(state, null, 2))
  })
  .listen(Number(process.env.PORT || 8080), '0.0.0.0', () => push('diag server listening on', String(process.env.PORT || 8080)))

process.on('uncaughtException', (e) => { state.phase = 'uncaughtException'; push('uncaught:', e) })
process.on('unhandledRejection', (e) => { state.phase = 'unhandledRejection'; push('rejection:', e) })
process.on('exit', (c) => push('process exit code', String(c)))
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => push('received', sig))

// What the image actually contains, since the layout has moved around.
const fs = require('fs')
for (const p of ['/apps/studio/server.js', '/app/apps/studio/server.js', '/apps/studio/package.json', '/node_modules/next/package.json', '/apps/studio/.next/BUILD_ID']) {
  state.log.push(`exists ${p}: ${fs.existsSync(p)}`)
}

setTimeout(async () => {
  const entry = ['/apps/studio/server.js', '/app/apps/studio/server.js'].find((p) => fs.existsSync(p))
  if (!entry) { state.phase = 'no server.js found'; return }
  try {
    process.env.PORT = '8099' // not the port the edge checks
    state.phase = 'importing ' + entry
    push('importing', entry)
    await import('file://' + entry)
    state.phase = 'import returned without throwing'
    push('import returned')
  } catch (e) {
    state.phase = 'threw during import'
    push('THREW:', e)
  }
}, 1000)
