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
# That script is a local-dev helper for idempotency and re-resolves
# dependencies — useless in Docker (fresh node_modules every build)
# and actively harmful (it calls `npm install` which conflicts with
# `npm ci`'s lockfile-driven install). Real prod-image install is
# just `npm ci` from the lockfile, no postinstall.
RUN npm ci --ignore-scripts

COPY . .

ARG NEXT_PUBLIC_API_URL=http://localhost/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

EXPOSE 80

CMD ["node", ".next/standalone/server.js"]