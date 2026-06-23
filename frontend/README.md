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

`docker-compose.dev.yml` 把 frontend 服务 bind-mount 进去(`node_modules` 除外),跑 `npm run dev`。HMR 开箱即用。

依赖改动(`package.json` / `package-lock.json`)会被 `entrypoint.sh` 哈希感知:只有文件 SHA256 变了才重跑 `npm ci`。确实需要 `./dev.sh restart` 重建容器。

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

- `frontend/nginx.conf` 存在但 **没有任何 compose 文件或 Dockerfile 引用它**(跑的是项目级 `nginx/nginx.conf`)。是早期 CRA 时代的遗留,删了也没事。