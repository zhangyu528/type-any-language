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
# --ignore-scripts: skip lifecycle scripts (postinstall hook that calls
# `npm install` recursively). The release image doesn't need idempotency
# tricks — `npm ci` from the lockfile is sufficient and reproducible.
RUN npm ci --ignore-scripts

COPY . .

ARG NEXT_PUBLIC_API_URL=http://localhost/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Skip the `npm run build` wrapper (scripts/build.mjs) because it
# self-heal-triggers `npm run install` which recursively re-resolves
# deps. For a release image that just compiled deps with `npm ci` from
# the lockfile, this self-heal is wrong (and was the source of an
# 18-min hang in CI). Invoke `next build` directly.
ENV NEXT_DIST_DIR=.next-build
RUN npx --offline next build

EXPOSE 80

CMD ["node", ".next/standalone/server.js"]