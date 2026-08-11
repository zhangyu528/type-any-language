# backend/

type-any-language 的 FastAPI 读层。运行时有意做得很薄:提供已缓存的词库 + 预烤好的句子。音频由前端从腾讯云 COS 直接拉(URL 存在 `sentences.audio_url` 字段),后端不持有音频文件。没有 AI、没有 TTS、没有调度器 —— 这些都在 CMS 主机的 ETL 流水线里跑。

完整的双主机架构(CMS 生产内容、目标机消费)在 [`../CLAUDE.md`](../CLAUDE.md) 里有说明。

## 技术栈

- Python 3 / FastAPI / SQLAlchemy / pydantic-settings
- 纯读层 —— 每次查询都落在 CMS 主机 `db/scripts/import_staging.sh` UPSERT 到云 db 的表上。`main.py` 里的 `Base.metadata.create_all()` 只是测试用的兜底,不是事实源。

## 目录结构

```
backend/
├── Dockerfile         # prod image
├── requirements.txt
├── app/
│   ├── main.py        # FastAPI 应用,CORS
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
| `GET` | `/` | 版本 banner |
| `GET` | `/health` | 存活探针 |
| `GET` | `/docs` | Swagger UI(FastAPI 自动生成) |

**音频服务**:不在这里。`sentences[i].audio_url` 直接是腾讯云 COS 上的完整 URL,前端读这个字段后让浏览器自己拉。详见 [CLAUDE.md](../CLAUDE.md) 的"音频与 COS"段。

## 配置

所有配置都从环境变量来,由 `app.config.get_settings()` 解析。

| 变量 | 来源 | 说明 |
|---|---|---|
| `DATABASE_URL` | shell env(native 由 `ops/dev/native.sh` 自动 export;docker 由 compose `environment:` 注入) | `postgresql://...` 连接串 |
| `ALLOWED_ORIGINS` | shell env | 逗号分隔的 CORS 白名单,例如 `https://my.domain`。Native + dev 默认 `http://localhost,http://localhost:3000,http://localhost:54102,http://localhost:55407,http://localhost:55500` |

目标机不需要 `.env` 文件 —— native 路径由 `ops/dev/native.sh` 自动 export;docker 路径由 compose `environment:` block 注入。**`DATABASE_URL_FILE` 已被废弃** —— 那是 cloud-db 时代的旧间接方式,当前所有路径都不再使用它。

## 本地开发(默认 — host-native)

直接宿主机跑 uvicorn,db 仍然在 docker(`./.docker-postgres-data/`)。这是新的
默认路径,比 backend 容器快很多。完整流程:

```bash
# 一次性 bootstrap:venv + node_modules + 起 db 容器
make dev-setup                  # = ./ops/dev/setup.sh

# 起 native 进程 (uvicorn + next dev 都在宿主机上)
make dev-start                  # = ./ops/dev/native.sh start

# 改 backend/ 下任何 .py → uvicorn 自动 --reload
# 改 requirements.txt → make dev-restart(venv 会感知 hash 变化重 pip install)
# 想看进程 / 日志:
make dev-status
make dev-logs
# 想停:
make dev-stop
```

默认环境变量(`native.sh` 自动 export,你不用手动):

| 变量 | 默认值 |
|---|---|
| `DATABASE_URL` | `postgresql://english_dev:devpw@localhost:5432/english_dev` |
| `ALLOWED_ORIGINS` | `http://localhost,http://localhost:3000,http://localhost:54102,http://localhost:55407,http://localhost:55500` |

要换就 `ALLOWED_ORIGINS=... make dev-start`。

## 热重载(dev — host-native)

uvicorn 以 `--reload` 跑。改任意 `app/**/*.py` → FastAPI 自动重启,无需手
动操作。改 `requirements.txt` → host 上 `setup.sh` 感知 hash 变化会重跑
`pip install`(需要 `make dev-setup` 重新触发,然后 `make dev-restart` 重
起 uvicorn 进程)。

Schema 改动后:`make dev-migrate`(宿主机直接打 docker postgres,不会重
起 backend)。

## 测试

还没有自动化测试。手动冒烟测试:

```bash
# dev 栈起来之后:
curl http://localhost:8000/health
curl http://localhost:8000/api/vocabulary/libs
curl http://localhost:8000/api/sentences/random
```