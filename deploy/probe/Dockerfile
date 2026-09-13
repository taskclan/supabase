FROM node:22-slim
ENV PORT=8080
COPY deploy/probe/probe.js /srv/probe.js
EXPOSE 8080
# Same probe, but started through a shell with a multi-word -c argument — the
# shape the console uses. The exec form ["node","/srv/probe.js"] is already
# proven to serve on Cloudflare. If this one exits instead, the entrypoint FORM
# is the difference, and the fix is a single-argument exec entrypoint.
ENTRYPOINT ["/bin/sh", "-c", "cd /srv && exec node probe.js"]
CMD []
