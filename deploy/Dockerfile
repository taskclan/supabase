# Runtime image for the Taskclan Cloud console.
#
# Thin by design: the Next build already happened on the CI runner, so this
# copies the traced standalone output rather than building anything. A build
# here would run inside Docker's default memory limits on top of the runner's,
# which is how the same compile ends up killed twice over.
#
# The standalone output is nested by workspace path — apps/studio/server.js —
# because this is a pnpm monorepo. `.next/static` and `public` are copied in
# beside it by scripts/taskclan-standalone.mjs; Next deliberately omits them
# from standalone output because Vercel serves them from a CDN, and nothing
# does that here.
FROM node:22-slim

# Cloudflare Containers probe the port they were told to expect and kill
# anything that does not answer. PORT is forced by the Worker's envVars, and
# Next's standalone server honours it; 8080 is only the fallback.
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# The traced server is at apps/studio/server.js inside the standalone tree, and
# Next resolves .next and public relative to the CURRENT DIRECTORY, not to
# __dirname. Running `node apps/studio/server.js` from /app therefore starts a
# server that cannot find its own build. Locally it worked only because it was
# run from inside that directory.
#
# node_modules still resolves: Node walks up from /app/apps/studio and finds
# /app/node_modules, where the traced dependencies live.
WORKDIR /app

# The whole standalone tree: server.js, its traced node_modules, .next/static
# and public. Nothing else from the repo ships — no source, no root modules.
#
# Copied from deploy/app rather than apps/studio/.next/standalone: the root
# .dockerignore excludes **/.next and **/node_modules, so the real path is
# invisible to the build context. CI stages the tree here first.
COPY deploy/app/ ./

EXPOSE 8080

# ENTRYPOINT, not CMD, and it carries its own `cd`.
#
# This is the difference between an image that works in Docker and one that
# works on Cloudflare, and it cost a full day. node:22-slim ships
# ENTRYPOINT ["docker-entrypoint.sh"], CMD ["node"]. Setting only CMD here
# leaves that shim as the entrypoint:
#
#   Docker      -> docker-entrypoint.sh node server.js   -> server listens
#   Cloudflare  -> docker-entrypoint.sh                  -> `exec node`
#
# Cloudflare runs the image's ENTRYPOINT without appending CMD. With no
# arguments the shim falls through to `exec node`, node treats its closed stdin
# as the program to run, and the process EXITS 0 in milliseconds. The edge
# reports that as "the container is not running, consider calling start()",
# which reads like a platform fault and is really a clean, instant success.
#
# So: one explicit entrypoint, no reliance on CMD being appended, and the `cd`
# inlined rather than left to WORKDIR — a runtime that drops CMD has not earned
# trust with the rest of the image config. exec keeps the server as PID 1 so it
# still receives SIGTERM.
WORKDIR /app/apps/studio
ENTRYPOINT ["/bin/sh", "-c", "cd /app/apps/studio && exec node server.js"]
CMD []
