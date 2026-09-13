// Minimal container: prove whether Cloudflare starts an image's ENTRYPOINT at all.
//
// Deliberately has nothing in common with the console but the base image and
// the port. If this serves, the platform and our wrangler settings are fine and
// the console's own image is at fault. If this exits too, the fault is upstream
// of anything we build, and this file is a reproduction small enough to send.
const http = require('http')
console.log('[probe] entrypoint running, argv=%j cwd=%s', process.argv, process.cwd())
console.log('[probe] PORT=%s HOSTNAME=%s', process.env.PORT, process.env.HOSTNAME)
const port = Number(process.env.PORT || 8080)
http
  .createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('probe ok pid=' + process.pid + ' uptime=' + process.uptime().toFixed(1) + 's\n')
  })
  .listen(port, '0.0.0.0', () => console.log('[probe] listening on 0.0.0.0:%d', port))
// If the platform kills us, say so on the way out.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { console.log('[probe] got %s', sig); process.exit(0) })
setInterval(() => console.log('[probe] alive %ss', process.uptime().toFixed(0)), 15000)
