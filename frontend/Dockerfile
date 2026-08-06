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
# --ignore-scripts: skip the postinstall hook (`node scripts/install.mjs`).
# That hook is a local-dev helper for idempotency that re-runs
# `npm install` — useless in Docker (fresh node_modules every build,
# already installed correctly by `npm ci`) and actively harmful (re-runs
# would race with the lockfile-driven `npm ci` install).
RUN npm ci --ignore-scripts

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

CMD ["node", ".next/standalone/server.js"]