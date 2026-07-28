# frontend/

type-any-language 的 Next.js 14(App Router)客户端。单页:用户选词库,听句子音频,输入完整句子。通过唯一的 `NEXT_PUBLIC_API_URL` 跟 backend 通信。

完整的双主机架构(CMS 生产内容、目标机消费)在 [`../CLAUDE.md`](../CLAUDE.md) 里有说明。

## 技术栈

- Next.js 14(App Router,standalone 输出模式)
- React 18 / TypeScript 5
- 原生 CSS(没用 Tailwind)
- `NEXT_PUBLIC_*` 类环境变量在 **build 时**内联 —— 浏览器看到的是写死在 JS bundle 里的 URL

## 目录结构

```
frontend/
├── Dockerfile         # prod image(next build + standalone server)
├── next.config.js     # output: 'standalone' + NEXT_PUBLIC_API_URL
├── package.json
├── public/            # / 路径下的静态资源
└── src/
    └── app/           # App Router
        ├── layout.tsx # 根布局
        ├── page.tsx   # <PracticePage /> —— 唯一的页面
        ├── api.ts     # 类型化客户端:getVocabularyLibs / generateSentences / checkAnswer / getAudioUrl
        └── globals.css
```

## 配置

| 变量 | build/runtime | 默认值 | 说明 |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | build | `http://localhost:8000` (dev) / `/api` (prod nginx) | 浏览器访问的 base URL。**仅 build 时生效** —— 改了要重新 build(`./ops/prod/build_image.sh`)。 |

值由 host shell env `NEXT_PUBLIC_API_URL=...` 覆盖,prod compose 的 `frontend` service 把这个值传给 Dockerfile 构参。Native dev 路径下 `ops/dev/native.sh` 自动 export `http://localhost:8000`,无需手设。

## 本地开发(默认 — host-native)

直接宿主机跑 `next dev`,后端在 `http://localhost:8000`(host-native
uvicorn)。完整流程:

```bash
make dev-setup     # 一次性: frontend node_modules + backend venv + 起 db
make dev-start     # 同时起 backend (uvicorn) + frontend (next dev) on host
# 浏览器打开 http://localhost:3000
```

`native.sh` 自动 export `NEXT_PUBLIC_API_URL=http://localhost:8000`(Next.js
在 dev 模式下首次 render 时把这个值 bake 进 client JS)。改值:

```bash
NEXT_PUBLIC_API_URL=https://my.tunnel.example make dev-start
```

## 热重载(dev — host-native)

Next.js Fast Refresh:改 `src/**` 或 `app/**` 立即在浏览器里更新,状态保留。
改 `package.json` / `package-lock.json` → `make dev-setup` 感知 hash 变化
触发 `npm install`,然后 `make dev-restart` 重起 `next dev` 进程让新的
deps 生效。改 `next.config.js` / `tsconfig.json` → `make dev-restart`。

## 生产 build

`Dockerfile` 跑 `npm run build`(`next.config.js` 里配了 `output: 'standalone'`),然后启动 standalone server:

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://my.domain/api \
  -t english_frontend \
  ./frontend
```

standalone server 默认 3000 端口。`docker-compose.yml` 里的 nginx 容器把宿主机 :80 代理到 `frontend:3000`。