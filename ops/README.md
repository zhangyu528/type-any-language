# ops/

目标机运维入口 + 镜像 build/release 编排器。运维和发版需要的几乎所有东西都在这里。

## 目录结构

```
ops/
├── README.md           本文件
├── lib.sh              共享 helper —— 每个脚本都 source 它
├── build.sh            本地多镜像 build(db + dev + prod),no push
├── release.sh          发版编排器(bump + build + push)
├── build_ielts_csv.py  一次性数据准备工具(IELTS 词表 → cms CSV 格式)
├── dev/                dev 目标机(热重载,compose-watch)
│   ├── _common.sh      共享 bootstrap(image refs、db labels、secrets、watch lifecycle、preflight gates)
│   ├── lifecycle.sh    start / stop / restart | reload
│   ├── doctor.sh       只读 preflight env check(docker、compose、images、labels、ports)+ drift check
│   ├── setup.sh        首次 bootstrap:拉/检查 db image + build dev apps
│   ├── logs.sh         docker compose logs -f wrapper
│   ├── migrate.sh      把 pending schema migrations 应用到运行中的 dev db
│   ├── watch.sh        前台 docker compose watch(Ctrl+C 停;后台版由 lifecycle.sh start 自动 spawn)
│   └── build_image.sh  本地 build english_backend_dev + english_frontend_dev
└── prod/               prod 目标机(预编译,no watch,auto-pull db)
    ├── _common.sh      共享 bootstrap
    ├── lifecycle.sh    start / stop / restart | reload(auto-pull db image from registry)
    ├── doctor.sh       只读 preflight env check for prod
    ├── setup.sh        首次 bootstrap for fresh prod host(no db bake)
    ├── logs.sh         docker compose logs -f wrapper
    ├── build_image.sh  本地 build english_backend + english_frontend
    ├── push_image.sh   推送 prod backend+frontend 到 $DOCKER_REGISTRY(dev 不推送)
    └── nginx.conf      prod-only 反向代理配置(无 /audio location —— audio 由 COS 直出)
```

双主机架构(CMS 主机生产内容,dev/prod 目标机消费)在仓库根 `CLAUDE.md` 有完整说明。本 README 聚焦在脚本本身。

## 常用入口

| 想做的事 | 命令 |
|---|---|
| 发版 | `./ops/release.sh dev\|prod [X.Y.Z] [-y]` |
| 查看当前版本 | `./ops/release.sh show` |
| 本地 build 多镜像(不 push) | `./ops/build.sh all\|db\|dev\|prod` |
| 首次拉/检查 db image + build dev apps | `./ops/dev/setup.sh` |
| 首次拉 db image + build prod apps | `./ops/prod/setup.sh` |
| 检查主机就绪状态 | `./ops/<host>/doctor.sh` |
| 启动 / 停止 / 重启容器 | `./ops/<host>/lifecycle.sh start\|stop\|restart` |
| 滚动重载(同容器、不重建) | `./ops/<host>/lifecycle.sh reload` |
| 查看容器日志 | `./ops/<host>/logs.sh [svc]` |
| Apply schema migrations(dev-only) | `./ops/dev/migrate.sh` |
| 本地 build dev/prod 镜像 | `./ops/<host>/build_image.sh` |
| 推送 prod 镜像到 registry | `./ops/prod/push_image.sh -y` |
| 烘焙 db image(CMS) | `./db/scripts/build.sh` |
| 推送 db image | `./db/scripts/push.sh -y` |
| 管理 cms/.env(CMS) | `./cms/scripts/env.sh [init\|update\|show\|doctor]` |

`<host>` 是 `dev` 或 `prod`。CMS 脚本在 `cms/scripts/` 下,db 脚本在 `db/scripts/` 下 —— 这两个独立子系统的入口不在 `ops/` 里,保留各自的命名空间。

## `lib.sh` —— 共享 helper

每个脚本都 source 它:

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"   # 顶层 ops/<name>.sh
# 或
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)" # ops/<host>/<name>.sh
cd "$PROJECT_DIR"
source "$PROJECT_DIR/ops/lib.sh"
```

`lib.sh` 提供:

| Helper | 用途 |
|---|---|
| `ok / warn / err / info`     | 彩色打印(stdout/stderr 区分)。请用这些,不要用 `echo` 写状态。 |
| `gen_secret <len>`           | URL-safe 随机串(lifecycle.sh 用它生成 POSTGRES_PASSWORD)。 |
| `detect_default_registry`    | `docker.io/$USER` 或空(取得到的)。 |
| `find_repo_root`             | 向上找到 `.git` 或任何 `VERSION*` 文件。 |
| `read_version_file [path]`   | VERSION 文件的首个非空非注释行,或 `v0.0.0`。 |
| `resolve_image_tag VAR [path]` | per-image env > `IMAGE_TAG` > version file > `v0.0.0`。 |
| `warn_if_version_default <tag> [path]` | VERSION 缺失时的一次性 warn。 |
| `resolve_docker_registry`    | shell env > REGISTRY 文件 > auto-detect > 空。 |
| `resolve_content_env_file`   | `cms/.env` 的路径解析。 |
| `sed_inplace PAT FILE`       | 跨平台原地编辑(GNU vs BSD/macOS sed)。 |
| `check_docker_installed`     | 静默布尔。 |
| `check_docker_daemon_running`| 静默布尔(5s 超时,Docker Desktop 启动时不会假死)。 |
| `require_docker`             | docker / compose 缺失时友好报错并 exit 1。 |
| `image_exists NAME`          | `docker image inspect` —— 静默布尔。 |
| `require_image NAME [hint]`  | 缺失时友好报错并给出修复提示。 |
| `resolve_image_ref NAME TAG` | 拼出 `$DOCKER_REGISTRY/$NAME:$TAG` 或本地名。 |
| `image_label NAME KEY`       | 读 OCI label。 |
| `port_in_use PORT`           | 静默布尔。 |
| `warn_port_in_use PORT DESC` | 仅警告(`set -e` 下不会失败)。 |
| `detect_compose_cmd`         | 设置 `DOCKER_COMPOSE_CMD`(docker-compose vs `docker compose`)。 |
| `file_exists / require_file` | 文件存在性 helper。 |
| `py_cmd`                     | 解析 `python` / `python3`(优先 venv)。 |

两条约定请记住:
- **状态消息一律走 `ok/warn/err/info`** —— 永远不要裸 `echo`。这些打印函数统一处理颜色、TTY 检测和 `[OK]/[WARN]/[ERR]/[INFO]` 前缀。
- **函数通过 stdout 返回值时**(比如 `tag="$(resolve_image_tag ...)"`),日志必须走 **stderr**(`>&2`),否则会被一起捕获进返回值。

## 新脚本的约定

本仓库的每个 shell 脚本都遵循同一骨架:

```bash
#!/bin/bash
#
# <path>/<name>.sh — <一行摘要>。
#
# <多行说明:脚本做什么、何时用、不做什么、读什么环境变量。>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# PROJECT_DIR 必须是仓库根,不是 ops/。往上走足够的层数落到仓库根,
# 跟嵌套深度无关。
#   ops/<name>.sh                  → 1 层  (../)
#   ops/<host>/<name>.sh           → 2 层  (../../)
PROJECT_DIR="$(cd "$SCRIPT_DIR/<正确的相对路径>" && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$PROJECT_DIR/ops/lib.sh"

require_docker    # 脚本用到 docker 时

# 1. 解析配置(env > VERSION 文件 > 默认值)。
# 2. 实现 cmd_doctor / cmd_<action>。
# 3. case "${1:-}" in ... esac —— 路由 subcommand。
```

注意:
- **`PROJECT_DIR` 必须是仓库根。** 所有 compose 文件、VERSION 文件、`cms/.env`、`cms/` 等都在那里。常见 bug 是少走一层(落在 `ops/` 而不是仓库根)—— 每个 `ops/<host>/` 脚本用 `$SCRIPT_DIR/../..` 就是为了避开这个坑。
- **顶部 `set -e`**。fail fast;让 `lib.sh` 的 `require_*` 处理友好报错。
- **Subcommand API**: `cmd_<subcommand>` 函数,通过 `case "${1:-}" in` 路由。`usage()` 出 help。退出码:
  - 0 = 成功或用户取消
  - 1 = 前置条件缺失
  - 2 = docker / push 失败
- **`ops/` 下的脚本不要用 Python。** CMS 流水线用 Python(`cms/cms_pipeline/*.py`),但 `ops/` 全 shell。目标机甚至不应该装 Python。
- **`source "$PROJECT_DIR/ops/lib.sh"`** 是引入方式。不要 `source ./lib.sh` —— 操作员切了目录就找不到。

## 版本模型

仓库根两个文件控制 image tag:

| 文件 | 管哪些 image |
|---|---|
| `VERSION.dev`  | `english_backend_dev`、`english_frontend_dev` |
| `VERSION.prod` | `english_db_content`、`english_backend`、`english_frontend` |

dev 目标机的 `lifecycle.sh` 也读 `VERSION.prod` 来取 `DB_IMAGE_TAG`(因为 db 是 "prod-bound" 内容,两边共享)。完整的解析链和覆盖优先级见仓库根 `CLAUDE.md` 的 "Image version tags" 段。

`ops/release.sh` 是版本管理的唯一入口 —— 优先用它,别手改 VERSION 文件。

## 新增脚本流程

1. 选对子目录:
   - 影响某台主机的容器生命周期 → `ops/<host>/lifecycle.sh` + 配套
     `doctor.sh` / `setup.sh` / `logs.sh` / `migrate.sh`(只 dev)/ `watch.sh`(只 dev)
   - 跨切面编排(build all / release) → `ops/` 根(`build.sh` / `release.sh`)
   - 操作某 service 的 image / config → 那个 service 自己的目录
     (如 `cms/scripts/env.sh`、`db/scripts/build.sh`)
2. 复制一个相同形状的现有脚本作模板(`lifecycle.sh` / `build_image.sh`
   是最规范的例子)。多 subcommand 的脚本共享一个 `_common.sh` 做
   setup bootstrap。
3. 用上面那个 `SCRIPT_DIR / PROJECT_DIR` 骨架 —— 确认 `PROJECT_DIR`
   落在仓库根。
4. source `lib.sh`,用它提供的打印函数和 helper。
5. 写 `usage()`,用 `case` 路由 subcommand。
6. 如果是面向用户的脚本,加到上面的 "常用入口" 表,并补到仓库根 `CLAUDE.md`。

## 参见

- `../CLAUDE.md` —— 项目总览、双主机架构、完整命令参考