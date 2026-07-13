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
├── Dockerfile.dev     # dev image(next dev,HMR,热重载)
├── entrypoint.sh      # 哈希感知的 npm ci(如果 package*.json 没变就跳过)
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
| `NEXT_PUBLIC_API_URL` | build | dev compose `http://localhost:8000` / prod compose `/api` | 浏览器访问的 base URL。**仅 build 时生效** —— 改了要重新 build(`./scripts/ops/{dev,prod}-host/build_image.sh`)。 |

值来自 compose 的 `${NEXT_PUBLIC_API_URL:-default}` 替换,而这个变量又可以被主机的 shell env 覆盖(`export NEXT_PUBLIC_API_URL=... ./dev.sh start`)。详见 `docker-compose.dev.yml` 和 `docker-compose.yml`。

## 本地开发(不用 docker)

```bash
cd frontend
npm install
export NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev          # Next dev server 在 http://localhost:3000
```

默认开了热重载。页面会调 `$NEXT_PUBLIC_API_URL` 指向的 backend —— 确保那个地址 backend 是好的。

## 热重载(dev)

`docker-compose.dev.yml` 的 frontend 服务**没有 bind mount**——源码直接烤进 image(`Dockerfile.dev` 的 `COPY . .`,配 `.dockerignore` 排除 `node_modules` / `.next` / `.git`),依赖在 image build 时 `npm ci` 预装好。运行时通过 **`docker compose watch`** 把热路径(详见 `develop.watch` 块)sync 进容器:

| 改动路径 | 触发方式 |
|---|---|
| `src/**` | compose watch `sync` → next dev HMR(无需重启) |
| `public/**` | compose watch `sync` → next dev 热加载 |
| `package.json` / `package-lock.json` | compose watch `sync` → 容器里文件被覆盖 → `./run.sh restart` 让 entrypoint 哈希感知后重跑 `npm ci` |
| `next.config.js` / `tsconfig.json` | compose watch `sync` → 重启生效 |
| `Dockerfile.dev` / `Dockerfile` / `.dockerignore` | `./scripts/dev-host/build_image.sh && ./run.sh restart` |

`run.sh start` 自动在后台 spawn 一个 `compose watch` 进程(PID 在 `.compose-frontend-watch.pid`,日志在 `.compose-frontend-watch.log`);`run.sh stop` 顺手清掉。想前台看 sync 日志用 `run.sh watch`。

注意:node_modules **不在命名卷里**了——容器重建会清掉,entrypoint 在 cold start 重装,warm start 走 hash + `.package-lock.json` 双校验跳过。trade-off 是丢掉了"`compose down` 后 deps 还在"的能力,换来了"宿主机 `frontend/` 目录永远干净(不会有 `.next/` 写入)"。

## 生产 build

`Dockerfile` 跑 `npm run build`(`next.config.js` 里配了 `output: 'standalone'`),然后启动 standalone server:

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://my.domain/api \
  -t english_frontend \
  ./frontend
```

standalone server 默认 3000 端口。`docker-compose.yml` 里的 nginx 容器把宿主机 :80 代理到 `frontend:3000`。

## 备注

- `frontend/nginx.conf` 存在但 **没有任何 compose 文件或 Dockerfile 引用它**(跑的是项目级 `nginx/nginx.conf`)。是早期脚手架时代的遗留,删了也没事。