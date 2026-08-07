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
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_URL=http://localhost/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Build via scripts/build.mjs (the canonical entry point). It
# self-heal-triggers `npm run install`, but install.mjs is now
# permissive — it skips re-install if node_modules already exists
# (the common case after `npm ci`), and only runs `npm install` when
# something's actually missing or drifted. The dev intent of the
# self-heal is preserved without interfering with the prod image.
RUN npm run build

EXPOSE 80

# Match scripts/build.mjs DEFAULT_DIST_DIR (.next-build). Next's
# standalone build self-deployed mode emits the minimal server.js
# into <distDir>/standalone/ — so when distDir=.next-build the
# entrypoint lives at .next-build/standalone/server.js. Earlier
# revisions used .next/standalone/server.js but build.mjs has since
# moved the build output to .next-build so the dev server's own
# .next/ directory stays untouched (see scripts/build.mjs for the
# rationale).
CMD ["node", ".next-build/standalone/server.js"]