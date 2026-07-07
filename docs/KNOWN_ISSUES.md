# Known Issues & Observations

本文件记录 type-any-language 项目在日常开发与 v1 auth 落地过程中发现的所有问题、非显然约束与待办提醒。**目的**：让下一个接手的人不踩同一个坑。

> 维护约定：发现新问题时追加到对应分类末尾；解决后打勾移到「已解决」段；不删除历史记录（保留当时观察到的问题）。

---

## 1. 代码层已知问题（未修）

### 🐛 1.1 `vocabulary.py` 用了未导入的 `HTTPException`

**文件**：`backend/app/routers/vocabulary.py:27`

**现象**：`GET /api/vocabulary/libs/{id}` 在词库 ID 不存在时会抛 `NameError: name 'HTTPException' is not defined`，而不是预期的 404。

**原因**：文件顶部 `from fastapi import APIRouter, Depends, Query` —— 漏了 `HTTPException`。

**触发条件**：调用 `/api/vocabulary/libs/{non-existent-uuid}`。

**影响**：低（端点几乎不会被访问到没 ID 的情况）；但属于潜在 crash。

**建议修法**：加 `HTTPException` 到 import 列表。

**不在 v1 PR 范围**：本次 auth PR 不动无关代码。

---

### 🐛 1.2 `cache_service.py` 引用了已删除的列

**文件**：`backend/app/services/cache_service.py`

**现象**：模块里 hardcode 引用 `Sentence.is_cached` / `Sentence.is_stale` 字段，但这俩字段在 migration 0005 (`0005_drop_dead_columns`) 就被删了。**没有 router import 这个 service**，所以死代码无运行时影响。

**建议处理**：删除整个文件（~50 行死代码）。

**不在 v1 PR 范围**：跟 auth 无关。

---

### 🐛 1.3 `frontend/nginx.conf` 是死代码

**文件**：`frontend/nginx.conf`

**现象**：README 已经标记为「leftover scaffolding」，dev compose 不挂 nginx，prod compose 用的是 `nginx/nginx.conf`（项目根目录下）。`frontend/nginx.conf` 完全没人引用。

**建议处理**：删除文件。

**不在 v1 PR 范围**：跟 auth 无关。

---

## 2. 部署 / 运维层问题

### ⚠️ 2.1 dev DB image 还是老的，没有 users 表

**现象**：feat/auth 第一次 restart 后 PracticePage 卡在「Loading...」。根因是 backend 容器启动时 crash 在 `JWT_SECRET is not configured` —— 因为 `.secrets/jwt_secret` 文件不存在 + compose 文件改动未生效。

**更深层**：dev DB image `english_db_content:v0.2.0-rc.1` 是 **bake 之前的版本**，里面没有 users 表，也没有 `schema_migrations` 表。`run.sh migrate` 命令会失败（见 2.2）。

**当前临时方案**：用 docker exec + psql 直接灌 0007 的 DDL：

```sql
CREATE TABLE IF NOT EXISTS users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name  VARCHAR(50)  NOT NULL,
    role          VARCHAR(20)  NULL,
    tier          VARCHAR(20)  NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP    NOT NULL DEFAULT now(),
    updated_at    TIMESTAMP    NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS ix_users_role ON users (role) WHERE role IS NOT NULL;
INSERT INTO schema_migrations (version) VALUES ('0001_baseline') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('0007_add_users') ON CONFLICT DO NOTHING;
```

**根治**：CMS 主机重 bake + push `english_db_content` 新 image，然后 dev/prod 各自 `restart` 拉新 image。新 image 启动 initdb 时会自动跑 `01-content.sql`（已包含 users 表），且自带 `schema_migrations` 表的初始结构。

---

### ⚠️ 2.2 `run.sh migrate` 在 dev 环境会失败（需要 `.env.db`）

**现象**：执行 `./scripts/ops/dev-host/run.sh migrate` 报：
```
.env.db 不存在 (/.env.db) — 跑 ./scripts/ops/db/env.sh 先引导
```

**根因**：`cmd_migrate` 走 sidecar 跑 `pipeline.migrations.runner`，runner 用 `pipeline.env.load_config()` 读 DB 配置，env 模块在 dev 没 `.env.db` 时报错。

**问题**：dev 环境的 DB 凭据走 `.secrets/postgres_password` + image labels，**从来不需要** `.env.db`。但 migrate runner 假设 `.env.db` 存在。

**建议处理**：修改 `db/pipeline/env.py` 让 dev 环境也能识别 `.secrets/` 模式（跟 `run.sh write_secrets` 一样的逻辑）。或者让 `cmd_migrate` 显式传 env vars 给 sidecar。

**不在 v1 PR 范围**：跟 auth 无关，但是 dev 工作流的现实阻碍。

---

### ⚠️ 2.3 JWT_SECRET 轮换 = 所有用户被踢下线（设计如此）

**现象**：rotate `.secrets/jwt_secret`（删除文件让 `run.sh start` 重新生成）后，所有之前签发的 token 立刻无效，用户需要重新登录。

**原因**：stateless JWT 设计——服务端不维护 token 表，只验证签名 + 过期。密钥变了 = 旧 token 全部作废。

**影响**：故意为之（plan 阶段确认过）。但要记录下来，避免未来误以为是 bug。

**未来如何实现「单独踢某个用户」**：需要切换到 stateful sessions（DB 存 token / session 表），或者维护 denylist。

---

## 3. 架构约束 / 非显然事实（不是 bug，是设计）

### 📐 3.1 「内容更新 + 用户数据」张力未解决

**问题**：当前架构假设「内容坏了可以靠 `docker compose down -v` 重 init volume 复原」。加了 users 表之后这条不成立——删 volume 会丢掉所有用户。

**当前选择**：v1 不解决，靠手动 `pg_dump users` 备份 + `pg_restore`。等真的需要更新内容时再选方案。

详见 plan 文件 `great-review-curious-iverson.md` 里的「架构张力」章节。

---

### 📐 3.2 `Base.metadata.create_all()` 是兜底，不是真理

**现象**：`main.py:26` 在 import 时调用 `Base.metadata.create_all(bind=engine)`，会按 SQLAlchemy 模型定义自动建表。

**设计**：schema 的真理在 `db/init/01-content.sql`（baked into image）。`create_all()` 只在两种场景兜底：
- 测试环境（`Base.metadata.create_all` 会创建 users 表让 pytest 能跑）
- 全新 dev DB 在 image 还没烤好时

**不会发生冲突**：因为两边都 `IF NOT EXISTS`，幂等。

---

### 📐 3.3 「dev compose DB 不暴露端口」+「测试用 localhost:5432 的另一个 DB」

**环境差异**：
- **dev compose** 的 `db` 容器（`type-any-language-db-1`）：Docker 网络内部 hostname `db:5432`，**不**映射到主机端口
- **host 上 pytest** 用的 `english_db` 容器：postgres:15-alpine，**有** `0.0.0.0:5432` 端口映射

两者是**不同的 DB 实例**（一个 dev compose 管的，一个是独立的 CMS 源 DB）。后者的密码是 `L4a7flP0notlYUAhUpbWTxb`，写死在 `.env` 里。

**影响**：host 上跑 pytest 不会动到 dev compose 的 DB 数据；反之亦然。

---

## 4. v1 已解决的问题（避免重复排查）

### ✅ 4.1 [A.1] Backend 启动 crash：JWT_SECRET 未配置

**现象**：第一次 restart 后容器秒退，日志：
```
RuntimeError: JWT_SECRET is not configured: JWT_SECRET is not set
```

**修复**：确保 `run.sh restart` 跑过 `write_secrets`（生成 `.secrets/jwt_secret`）+ compose 的 `JWT_SECRET_FILE` env 正确传递。验证：
```bash
docker exec type-any-language-backend-1 printenv | grep JWT_SECRET_FILE
# 应输出: JWT_SECRET_FILE=/run/secrets/jwt_secret

docker exec type-any-language-backend-1 ls /run/secrets/
# 应包含 jwt_secret
```

---

### ✅ 4.2 [A.2] pytest 在 host 上跑会因为 audio mount crash

**现象**：pytest import `app.main` 时 crash `Directory '/audio' does not exist`，因为 macOS `/` 是只读 fs。

**修复**：`main.py` 把 audio mount 改成条件：
```python
if _os.path.isdir("/audio"):
    app.mount("/audio", StaticFiles(directory="/audio"), name="audio")
```
dev compose 下 `/audio` 一定存在，正常挂载；host 上跑测试时跳过。

---

### ✅ 4.3 [A.3] `logout` 的 Set-Cookie header 在 TestClient 里看不到

**现象**：`assert "tal_session" in resp.cookies` 失败，因为 httpx TestClient 看到 `Max-Age=0` 的过期 cookie 就从 jar 里删掉了。

**修复**：测试改断言为 `assert "tal_session" in resp.headers.get("set-cookie", "")`，检查 raw header 而不是 cookie jar。

**端点实现没变**：logout 始终正确发出 Set-Cookie 来清 cookie，浏览器能正确处理。

---

## 5. 验证记录（v1 完成时跑过的检查）

| 检查 | 命令 | 结果 |
|---|---|---|
| pytest 全套 | `cd backend && DATABASE_URL=... pytest tests/` | ✅ 19/19 passed |
| 前端 typecheck | `cd frontend && npx tsc --noEmit` | ✅ clean |
| 前端 build | `npm run build` | ✅ 7 routes compiled |
| bash 语法（run.sh） | `bash -n scripts/ops/{dev,prod}-host/run.sh` | ✅ |
| migration 应用 | `python3 -m pipeline.migrations.runner` | ✅ 0007 applied |
| DB schema 验证 | `psql -c "\d users"` | ✅ 9 cols + 2 indexes + 2 constraints |
| API smoke test | `curl POST /api/auth/signup` | ✅ 200 + HttpOnly cookie set |
| 端到端浏览器测试 | http://localhost:3000 | ✅ PracticePage + login/signup/history 全部 OK |

---

## 6. 未来可能补的「已修复但还没改」

| 编号 | 描述 | 严重程度 |
|---|---|---|
| F.1 | `backend/app/routers/vocabulary.py:27` HTTPException 未导入 | 低（几乎不触发） |
| F.2 | 删除 `backend/app/services/cache_service.py`（死代码） | 低 |
| F.3 | 删除 `frontend/nginx.conf`（死代码） | 低 |
| F.4 | 修复 `run.sh migrate` 让 dev 环境不依赖 `.env.db` | 中（dev 工作流阻碍） |
| F.5 | 优化 `cache_service.py` 等死代码扫描（grep orphan modules） | 低 |
| F.6 | 加 pre-commit hook 跑 pytest + tsc | 中（CI 友好） |