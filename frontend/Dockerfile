FROM node:20-alpine

# Project version (per-segment VERSION file: frontend/VERSION for this
# image — the same file gates english_frontend_dev; resolved by
# ops/lib.sh → resolve_image_tag) + git SHA.
ARG APP_VERSION=latest
ARG GIT_SHA=unknown
LABEL type-any-language.app.version="${APP_VERSION}"
LABEL type-any-language.app.git-sha="${GIT_SHA}"

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_URL=http://localhost/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

EXPOSE 80

CMD ["node", ".next/standalone/server.js"]