FROM node:20-alpine

# Project version (per-segment VERSION file: frontend/VERSION for this
# image — resolved by ops/lib.sh → resolve_image_tag) + git SHA.
ARG APP_VERSION=latest
ARG GIT_SHA=unknown
LABEL type-any-language.app.version="${APP_VERSION}"
LABEL type-any-language.app.git-sha="${GIT_SHA}"

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
# scripts/install.mjs must be present before `npm ci`, because npm ci
# triggers the `install` script (= node scripts/install.mjs) as a
# lifecycle hook, and install.mjs is not part of the COPY . . layer
# that happens after npm ci. Copy it explicitly first.
COPY scripts/install.mjs ./scripts/install.mjs
# `npm ci` triggers the package.json `install` script (which runs
# install.mjs). install.mjs is now permissive: it sees node_modules
# already populated by `npm ci` itself, records the lock hash, and
# exits 0 — no recursive `npm install`. So we don't need
# --ignore-scripts anymore.
#
# NOTE: `ENV NODE_ENV=production` (line 12) is in scope here, so a plain
# `npm ci` would SKIP devDependencies. But `next build` (below) needs
# `typescript` + `eslint` for type-checking/linting and would otherwise
# re-fetch them on the fly over a flaky runner egress — that's the
# "Installing devDependencies (npm): typescript @types/react @types/node"
# stall seen in release builds. `--include=dev` installs them up front so
# the build is fast and deterministic. The standalone runtime output
# (.next-build/standalone) still excludes them by tracing, so the running
# container never pays for them.
# Harden against transient registry blips: the lockfile pins packages to
# registry.npmmirror.com, which occasionally 502s a single tarball and makes
# `npm ci` hard-fail the whole build (seen 2026-08-07: npmmirror 502 on
# caniuse-lite). Retry instead of dying.
# The lockfile pins tarballs to registry.npmmirror.com (generated on a CN
# machine). From GitHub's US runners that mirror is both SLOW and was the
# source of the 502 build failure (caniuse-lite). Rewrite resolved URLs to
# npmjs.org for the build only — the committed lockfile is untouched, so
# local CN dev keeps using npmmirror. npmjs.org has a global CDN and is
# fast/reliable from GitHub runners.
RUN sed -i 's#https://registry.npmmirror.com/#https://registry.npmjs.org/#g' package-lock.json
RUN npm ci --include=dev --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

# Copy the source tree WITHOUT the build output. The build runs
# below, after this COPY — we don't `COPY . .` here because that
# would have to be re-done post-build anyway, and double-copying
# `node_modules` blows up the image.
COPY . .

ARG NEXT_PUBLIC_API_URL=/
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Build via scripts/build.mjs (the canonical entry point). It
# self-heal-triggers `npm run install`, but install.mjs is now
# permissive — it skips re-install if node_modules already exists
# (the common case after `npm ci`), and only runs `npm install` when
# something's actually missing or drifted. The dev intent of the
# self-heal is preserved without interfering with the prod image.
RUN npm run build

EXPOSE 80

# Next.js 'standalone' output mode produces a self-contained
# .next-build/standalone/ tree, but DOES NOT copy the static
# assets (.next/static) or the public/ directory — those are served
# at runtime as plain files. Without the explicit copies below,
# the browser sees the page HTML (server.js handles the SSR)
# but every /_next/static/* request 404s. This is the
# recommended pattern in the Next.js docs at
# https://nextjs.org/docs/pages/api-reference/next-config-js/output#automatically-copying-traced-files
#
# IMPORTANT: `cp -r src dest` will NOT create intermediate parents of
# `dest`, so `mkdir -p` first. And do NOT mask a static-copy failure with
# `|| true` — a previous version did exactly that, the copy silently
# failed (the .next parent didn't exist), and the build "succeeded" while
# shipping an image with no static assets. The static copy MUST fail the
# build loudly if it ever can't run.
RUN mkdir -p .next-build/standalone/.next && \
    cp -r .next-build/static .next-build/standalone/.next/static
# public/ is optional in this app (assets live under /_next/static). Copy
# it if present, but never let a missing public/ fail the build.
RUN cp -r public .next-build/standalone/public 2>/dev/null || true

# Match scripts/build.mjs DEFAULT_DIST_DIR (.next-build). Next's
# standalone build self-deployed mode emits the minimal server.js
# into <distDir>/standalone/ — so when distDir=.next-build the
# entrypoint lives at .next-build/standalone/server.js. Earlier
# revisions used .next/standalone/server.js but build.mjs has since
# moved the build output to .next-build so the dev server's own
# .next/ directory stays untouched (see scripts/build.mjs for the
# rationale).
CMD ["node", ".next-build/standalone/server.js"]