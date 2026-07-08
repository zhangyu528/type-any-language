# backend/

type-any-language 的 FastAPI 读层。运行时有意做得很薄:提供已缓存的词库 + 预烤好的句子 + 静态 MP3。没有 AI、没有 TTS、没有调度器 —— 这些都在 CMS 主机的烘焙阶段跑。

完整的双主机架构(CMS 生产内容、目标机消费)在 [`../CLAUDE.md`](../CLAUDE.md) 里有说明。

## 技术栈

- Python 3 / FastAPI / SQLAlchemy / pydantic-settings
- 纯读层 —— 每次查询都落在 CMS 主机 `bake_image.sh` 烤进 db image 的 `content/runtime/init/01-content.sql` 预填的表上。`main.py` 里的 `Base.metadata.create_all()` 只是测试用的兜底,不是事实源。

## 目录结构

```
backend/
├── Dockerfile         # prod image
├── Dockerfile.dev     # dev image(uvicorn --reload,hash-aware entrypoint)
├── requirements.txt
├── app/
│   ├── main.py        # FastAPI 应用,CORS,挂载 /audio StaticFiles
│   ├── config.py      # pydantic-settings(DATABASE_URL[_FILE], ALLOWED_ORIGINS)
│   ├── database.py    # SQLAlchemy engine + Base
│   ├── models/        # SQLAlchemy ORM(vocabulary, sentence)
│   ├── routers/       # APIRouter 定义
│   └── schemas/       # pydantic 请求/响应模型
```

## 接口

| Method | Path | 用途 |
|---|---|---|
| `GET` | `/api/vocabulary/libs` | 列出所有词库 |
| `GET` | `/api/vocabulary/libs/{id}` | 单个词库 |
| `GET` | `/api/vocabulary/libs/{id}/words` | 词库里的单词 |
| `GET` | `/api/vocabulary/libs/{id}/random?n=10` | 随机 N 个单词 |
| `GET` | `/api/sentences` | 预烤好的句子(可筛选) |
| `GET` | `/api/sentences/random` | 随机一个句子 |
| `GET` | `/api/sentences/{id}` | 单个句子 |
| `GET` | `/audio/{filename}` | 静态 MP3(从 `/audio` 卷里取,烤在 db image 里) |
| `GET` | `/` | 版本 banner |
| `GET` | `/health` | 存活探针 |
| `GET` | `/docs` | Swagger UI(FastAPI 自动生成) |

## 配置

所有配置都从环境变量来,由 `app.config.get_settings()` 解析。

| 变量 | 来源 | 说明 |
|---|---|---|
| `DATABASE_URL` | compose secret(`DATABASE_URL_FILE`) | `postgresql://...` 连接串 |
| `ALLOWED_ORIGINS` | shell env | 逗号分隔的 CORS 白名单,例如 `https://my.domain`。Dev 默认 `http://localhost,http://localhost:3000` |

`DATABASE_URL` 优先用 `*_FILE` 间接方式(compose 的 `secrets:` 块),这样密码不会出现在 `docker inspect` 输出里。解析顺序见 `config.py:resolved_database_url()`。目标机不需要 `.env` 文件 —— `run.sh` 写 `.secrets/database_url`(chmod 600)然后 compose 挂载进去。

## 本地开发(不用 docker)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export DATABASE_URL=postgresql://english_user:<password>@localhost:5432/english_learning
export ALLOWED_ORIGINS=http://localhost,http://localhost:3000

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

需要有一个能通过 `$DATABASE_URL` 访问的 Postgres,且 schema 已经加载好了。最简单的路径:先用 `./dev.sh start` 把整个 dev 栈起来,然后让 uvicorn 指同一个 DB。

## 热重载(dev)

`docker-compose.dev.yml` 把 backend 服务 bind-mount 进去,跑 `uvicorn --reload`。改 `.py` 文件 → FastAPI 自动重启。无需重启容器。

依赖改动(`requirements.txt`)会被 `entrypoint.sh` 哈希感知:只有 SHA256 变了才重跑 `pip install`。所以确实需要 `./dev.sh restart` 重建容器 —— 但不需要重新 build image。

## 测试

还没有自动化测试。手动冒烟测试:

```bash
# dev 栈起来之后:
curl http://localhost:8000/health
curl http://localhost:8000/api/vocabulary/libs
curl http://localhost:8000/api/sentences/random
```