FROM node:22-slim
ENV PORT=8080
COPY deploy/probe/probe.js /srv/probe.js
EXPOSE 8080
# Explicit ENTRYPOINT, no CMD, no shell — the narrowest possible start path.
ENTRYPOINT ["node", "/srv/probe.js"]
