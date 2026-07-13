# scripts/

主机运维入口和共享 helper。运维需要的几乎所有东西都在这里。

## 目录结构

```
scripts/
├── README.md           本文件
├── lib.sh              共享 helper —— 每个脚本都 source 它
├── release.sh          release 编排器(bump + build + push)
├── ops/
│   ├── cms/         CMS 主机:内容生产 + content image 烘焙
│   │   ├── env.sh        cms/.env 生命周期(init/update/show/doctor)
│   │   ├── content.sh    sync / sentences / audio / publish / export / doctor
│   │   ├── bake_image.sh dump + audio 拷贝 + docker build
│   │   └── push_image.sh 推到 $DOCKER_REGISTRY
│   ├── dev-host/       dev 目标主机(热重载)
│   │   ├── run.sh        compose 生命周期(start/stop/restart/logs/doctor)
│   │   ├── build_image.sh 本地 build backend+frontend image
│   │   └── push_image.sh  推到 $DOCKER_REGISTRY
│   └── prod-host/      prod 目标主机(预编译)
│       ├── run.sh        compose 生命周期(start/stop/restart/logs/doctor)
│       ├── build_image.sh 本地 build backend+frontend image
│       └── push_image.sh  推到 $DOCKER_REGISTRY
└── dev/                开发者工具(lint/test/generate/...)—— 暂为空
```

双主机架构(CMS 主机生产内容,dev/prod 目标机消费)在仓库根的 `CLAUDE.md` 里有完整说明。本 README 聚焦在脚本本身。

## 常用入口

| 想做的事 | 命令 |
|---|---|
| 发版 | `./scripts/release.sh dev\|prod [X.Y.Z] [-y]` |
| 查看当前版本 | `./scripts/release.sh show` |
| 检查主机就绪状态 | `./scripts/ops/<host>/run.sh doctor` |
| 启动 / 停止 / 重启容器 | `./scripts/ops/<host>/run.sh start\|stop\|restart` |
| 烘焙 + 推送 db image(CMS) | `./db/scripts/build.sh && ./db/scripts/push.sh -y` |
| Build + 推送应用镜像(目标机) | `./scripts/ops/<host>/build_image.sh && ./scripts/ops/<host>/push_image.sh -y` |
| 管理 cms/.env(CMS) | `./cms/scripts/env.sh [init\|update\|show\|doctor]` |

`<host>` 是 `dev-host` 或 `prod-host`。CMS 脚本在 `cms/scripts/` 下。

## `lib.sh` —— 共享 helper

每个脚本都 source 它:
```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../../lib.sh"
```

`lib.sh` 提供:

| Helper | 用途 |
|---|---|
| `ok / warn / err / info`     | 彩色打印(stdout/stderr 区分)。请用这些,不要用 `echo` 写状态。 |
| `gen_secret <len>`           | URL-safe 随机串(run.sh 用它生成 POSTGRES_PASSWORD)。 |
| `detect_default_registry`    | `docker.io/$USER` 或空(取得到的)。 |
| `find_repo_root`             | 向上找到 `.git` 或任何 `VERSION*` 文件。 |
| `read_version_file [path]`   | VERSION 文件的首个非空非注释行,或 `v0.0.0`。 |
| `resolve_image_tag VAR [path]` | per-image env > `IMAGE_TAG` > version file > `v0.0.0`。 |
| `warn_if_version_default <tag> [path]` | VERSION 缺失时的一次性 warn。 |
| `sed_inplace PAT FILE`       | 跨平台原地编辑(GNU vs BSD/macOS sed)。 |
| `check_docker_installed`     | 静默布尔。 |
| `check_docker_daemon_running`| 静默布尔(5s 超时,Docker Desktop 启动时不会假死)。 |
| `require_docker`             | docker / compose 缺失时友好报错并 exit 1。 |
| `image_exists NAME`          | `docker image inspect` —— 静默布尔。 |
| `require_image NAME [hint]`  | 缺失时友好报错并给出修复提示。 |
| `port_in_use PORT`           | 静默布尔。 |
| `warn_port_in_use PORT DESC` | 仅警告(`set -e` 下不会失败)。 |
| `detect_compose_cmd`         | 设置 `DOCKER_COMPOSE_CMD`(docker-compose vs `docker compose`)。 |
| `file_exists / require_file` | 文件存在性 helper。 |

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
# PROJECT_DIR 必须是仓库根,不是 scripts/。往上走足够的层数落到仓库根,
# 跟嵌套深度无关。
#   scripts/<name>.sh                  → 1 层  (../)
#   scripts/ops/<host>/<name>.sh       → 3 层 (../../..)
PROJECT_DIR="$(cd "$SCRIPT_DIR/<正确的相对路径>" && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/<lib.sh 相对 SCRIPT_DIR 的路径>"

require_docker    # 脚本用到 docker 时

# 1. 解析配置(env > VERSION 文件 > 默认值)。
# 2. 实现 cmd_doctor / cmd_<action>。
# 3. case "${1:-}" in ... esac —— 路由 subcommand。
```

注意:
- **`PROJECT_DIR` 必须是仓库根。** 所有 compose 文件、VERSION 文件、`cms/.env`、`cms/` 等都在那里。常见 bug 是少走一层(落在 `scripts/` 而不是仓库根)—— 每个 `scripts/ops/*/` 脚本用 `$SCRIPT_DIR/../../..` 就是为了避开这个坑。
- **顶部 `set -e`**。fail fast;让 `lib.sh` 的 `require_*` 处理友好报错。
- **Subcommand API**: `cmd_<subcommand>` 函数,通过 `case "${1:-}" in` 路由。`usage()` 出 help。退出码:
  - 0 = 成功或用户取消
  - 1 = 前置条件缺失
  - 2 = docker / push 失败
- **ops 脚本不要用 Python。** CMS 流水线用 Python(`cms/tools/cms/*.py`),但 `scripts/ops/` 全 shell。目标机甚至不应该装 Python。
- **`source "$SCRIPT_DIR/../../lib.sh"`** 是引入方式。不要 `source ./lib.sh` —— 操作员切了目录就找不到。

## 版本模型

仓库根两个文件控制 image tag:

| 文件 | 管哪些 image |
|---|---|
| `VERSION.dev`  | `english_backend_dev`、`english_frontend_dev` |
| `VERSION.prod` | `english_db_content`、`english_backend`、`english_frontend` |

dev 目标机的 `run.sh` 也会读 `VERSION.prod` 来取 `DB_IMAGE_TAG`(因为 db 是 "prod-bound" 内容,两边共享)。完整的解析链和覆盖优先级见仓库根 `CLAUDE.md` 的 "Image version tags" 段。

`scripts/release.sh` 是版本管理的唯一入口 —— 优先用它,别手改 VERSION 文件。

## 新增脚本流程

1. 选对子目录:
   - 影响某台主机的容器生命周期 → `scripts/<host>/lifecycle.sh` + 配套
     `doctor.sh` / `setup.sh` / `logs.sh` / `migrate.sh`(只 dev)/ `watch.sh`(只 dev)
   - 操作某 service 的 image / config → 那个 service 自己的 `scripts/`
     (如 `cms/scripts/env.sh`、`db/scripts/build.sh`)
   - 跨切面编排 → `scripts/` 根(`build.sh` / `release.sh`)
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
- `../cms/tools/cms/README.md` —— Python 内容生产流水线(仅 CMS)