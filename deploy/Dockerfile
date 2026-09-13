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

WORKDIR /app

# The whole standalone tree: server.js, its traced node_modules, .next/static
# and public. Nothing else from the repo ships — no source, no root modules.
COPY apps/studio/.next/standalone/ ./

EXPOSE 8080

# Run the traced server directly. `next start` is not used: it hardcodes port
# 8082 in this repo's package.json, and the standalone server is both smaller
# and the thing Next actually intends you to run in a container.
CMD ["node", "apps/studio/server.js"]
