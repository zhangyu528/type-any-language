# Release flow — GitHub Actions + TCR / Docker Hub

## 一图流

```
operator / maintainer
        │
        │ git tag v0.3.0 && git push --tags
        ▼
┌──────────────────────────────────────────────────────┐
│  GitHub Actions: .github/workflows/release-prod.yml   │
│                                                       │
│  1. checkout tag v0.3.0                               │
│  2. resolve version = "v0.3.0"                        │
│  3. docker login ${{ vars.DOCKER_REGISTRY }}          │
│  4. lint: REGISTRY file == vars.DOCKER_REGISTRY       │
│  5. ops/prod/release.sh prod v0.3.0 -y                     │
│     - bump backend/VERSION + frontend/VERSION (noop) │
│     - docker compose build                           │
│     - docker tag + push → registry                   │
│  6. docker logout                                     │
└──────────────────────────────────────────────────────┘
        │
        │ image: ccr.ccs.tencentyun.com/.../english_backend:v0.3.0
        ▼
┌──────────────────────────────────────────────────────┐
│  Container Registry (TCR / Docker Hub)               │
│                                                       │
│    /english_backend:v0.3.0                            │
│    /english_backend:latest                            │
│    /english_frontend:v0.3.0                           │
│    /english_frontend:latest                           │
└──────────────────────────────────────────────────────┘
        │
        │ operator 跑 ./ops/prod/lifecycle.sh restart
        ▼
┌──────────────────────────────────────────────────────┐
│  Prod CVM (RUN env)                                   │
│                                                       │
│  1. lifecycle.sh restart                              │
│     → docker compose up -d --force-recreate backend   │
│  2. compose 看到 ${DOCKER_REGISTRY}/english_backend:v0.3.0│
│     本地没有 → docker pull ←────────────────── 拉!    │
│  3. recreate container 用新 image                     │
│  4. (可选) ./ops/prod/doctor.sh 验 drift              │
└──────────────────────────────────────────────────────┘
```

## 配置一次,以后再跑

### 1. GitHub repo Settings

#### Variables(Variables tab)
| Name | Value | 用途 |
|---|---|---|
| `DOCKER_REGISTRY` | `ccr.ccs.tencentyun.com/your-tcr-id/type-any-language` | 所有 build/push 镜像的 namespace 前缀 |

**Variable 不是 secret** —— 全员可见,Audit log 有记录。适合放 namespace、镜像 tag 模板之类的项目级配置。

#### Secrets(Secrets tab)
| Name | 来源 | 用途 |
|---|---|---|
| `REGISTRY_USERNAME` | TCR / Docker Hub 用户名(或临时 token 的 id) | `docker login` |
| `REGISTRY_PASSWORD` | TCR / Docker Hub 密码(或临时 token) | `docker login` |

**Secret 只对 Actions workflow 可见**,CVM 不需要。
**不要**把用户名密码塞 Variable。

#### Environments(可选)
- Settings → Environments → `prod` → Required reviewers → 加自己 / 团队
- workflow 文件里 `environment: prod` 那行让 **dispatch 触发的 release** 在跑之前暂停等审批
- **tag push 触发的 release 不受这个保护**(因为 tag 是已有权限的产物)

### 2. 仓库根 `REGISTRY` 文件(给 CVM 看的)

把同一行 `DOCKER_REGISTRY=` 取消注释,跟 GH Variable 一致:

```
DOCKER_REGISTRY=ccr.ccs.tencentyun.com/your-tcr-id/type-any-language
```

**两边必须同步** —— workflow 的 `Verify registry mirror in sync` step 会检查,不一致直接 fail。

### 3. TCR(腾讯云容器镜像服务)初始化

只适用 TCR 用户。Docker Hub 用户跳过这一步。

```
1. 腾讯云控制台 → 容器镜像服务 TCR → 创建个人版实例(选最近的 region)
2. 实例里建命名空间: type-any-language
3. 创建一个临时 token(用户名+密码)用于 docker login
4. CVM 上(可选)用 RAM role 免 docker login:
   - TCR 控制台 → 访问管理 → 给 CVM 绑 RAM role
   - CVM 上无需额外配置,docker pull 自动鉴权
```

## 触发方式

### 方式 A:git tag push(推荐)

```bash
# 在 build 机 / 开发机上
git tag v0.3.0
git push origin v0.3.0

# GH 立刻跑 release-prod.yml
# → docker pull + compose build + push → registry
```

**前置条件**:`backend/VERSION` 和 `frontend/VERSION` 已经 bump 到 `v0.3.0`(手动或通过别的 release commit)。

### 方式 B:workflow_dispatch(手动)

GitHub 网页 → Actions → release-prod → Run workflow → 填 `version=0.3.0`

适合还没 commit VERSION bump、但想试一把的情况。release.sh 会自己 bump + commit。

## CVM 端的拉取时机

**只在 `lifecycle.sh start|restart` 时自动 pull**:

```bash
./ops/prod/lifecycle.sh restart   # ← 这里
```

内部流程:
1. `docker compose -f docker-compose.yml up -d --no-deps --force-recreate backend nginx`
2. compose 解析 image 引用:`${DOCKER_REGISTRY}/english_backend:${BACKEND_IMAGE_TAG}`
3. 本地没有对应 image → `docker pull ...`
4. recreate 容器

**没有专门的"拉 image"步骤**,全靠 compose 的 lazy pull。

## 验证拉到了

```bash
# 在 CVM 上
./ops/prod/doctor.sh

# 输出应该包含:
#   drift check (running containers vs local VERSION)
#   backend  drift OK (version=v0.3.0)   ← 必须匹配你刚 release 的版本
#   frontend drift OK (version=v0.3.0)
```

如果 drift 报"running=v0.2.x, expected=v0.3.0",说明:
- 要么 restart 没真跑(确认 lifecycle.sh 输出)
- 要么 REGISTRY 文件 vs GH Variable 不一致(检查 `$DOCKER_REGISTRY` 在 CVM 上解析出来的值)

## 常见错误

| 错误 | 原因 | 修复 |
|---|---|---|
| `DOCKER_REGISTRY variable not set` | GH Variable 没配 | Settings → Variables 加 |
| `DOCKER_REGISTRY drift: REGISTRY file says 'X', GH Variable says 'Y'` | 两边不一致 | 改 `REGISTRY` 文件或 GH Variable,保持一致 |
| `unauthorized: authentication required` | secrets 错 | 重新生成 token,更新 secrets |
| `denied: requested access to the resource is denied` | TCR 用户没 push 权限 | TCR 控制台给 namespace 授权 |
| CVM 上 `docker pull` 报 `not found` | REGISTRY 文件没跟 GH Variable 同步 | `git pull` 后改 REGISTRY |

## 为什么不用 PAT 让 CVM 拉

理论上可以让 CVM 装 `gh` 然后 `gh variable get DOCKER_REGISTRY` 拿到地址,但这要求 CVM 有 PAT:
- PAT 是 secret,得管起来(rotatation、过期)
- CVM 暴露 PAT = 多一个攻击面
- 完全没必要 —— `git pull` 拿 REGISTRY 文件就够了

如果将来 CVM 跟 GitHub 断开(罕见),再说 PAT 方案。