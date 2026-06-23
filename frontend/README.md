# frontend/

Next.js 14 (App Router) client for type-any-language. Single page that lets
the user pick a vocabulary library, play a sentence's audio, and type the
full sentence. Talks to the backend over a single `NEXT_PUBLIC_API_URL`.

The full two-host architecture (CMS produces content, target hosts consume it)
is described in [`../CLAUDE.md`](../CLAUDE.md).

## Stack

- Next.js 14 (App Router, standalone output mode)
- React 18 / TypeScript 5
- Plain CSS (Tailwind not in use)
- `NEXT_PUBLIC_*` env vars are inlined at **build time** — the URL the
  browser sees is baked into the JS bundle.

## Layout

```
frontend/
├── Dockerfile         # prod image (next build + standalone server)
├── Dockerfile.dev     # dev image (next dev, HMR, hot-reload)
├── entrypoint.sh      # hash-aware npm ci (skips if package*.json unchanged)
├── next.config.js     # output: 'standalone' + NEXT_PUBLIC_API_URL
├── package.json
├── public/            # static assets served from /
└── src/
    └── app/           # App Router
        ├── layout.tsx # root layout
        ├── page.tsx   # <PracticePage /> — the only page
        ├── api.ts     # typed client: getVocabularyLibs / generateSentences / checkAnswer / getAudioUrl
        └── globals.css
```

## Config

| Var | Build/Runtime | Default | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | build | `http://localhost:8000` (dev compose) / `/api` (prod compose) | Base URL the browser fetches from. **Build-time only** — change requires a rebuild (`./scripts/ops/{dev,prod}-host/build_image.sh`). |

The value comes from compose's `${NEXT_PUBLIC_API_URL:-default}` substitution,
which in turn can be set by the host's shell env (`export NEXT_PUBLIC_API_URL=...
./dev.sh start`). See `docker-compose.dev.yml` and `docker-compose.yml`.

## Local dev (without docker)

```bash
cd frontend
npm install
export NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev          # Next dev server on http://localhost:3000
```

Hot reload is on by default. The page calls the backend at
`$NEXT_PUBLIC_API_URL` — make sure the backend is up at that address.

## Hot reload (in dev)

In `docker-compose.dev.yml`, the frontend service bind-mounts `./frontend`
(except `node_modules`) and runs `npm run dev`. HMR works out of the box.

For dependency changes (`package.json` / `package-lock.json`),
`entrypoint.sh` is hash-aware: it re-runs `npm ci` only when the file
SHA256 changes. You do need `./dev.sh restart` to recreate the container.

## Production build

`Dockerfile` runs `npm run build` (with `output: 'standalone'` in
`next.config.js`) and starts the standalone server:

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://my.domain/api \
  -t english_frontend \
  ./frontend
```

The standalone server defaults to port 3000. The main nginx container in
`docker-compose.yml` proxies host :80 → `frontend:3000`.

## Notes

- `frontend/nginx.conf` exists but is **not referenced by any compose file or
  Dockerfile** (the project-level `nginx/nginx.conf` is what runs). It's
  leftover from an earlier CRA-based setup and safe to delete.
