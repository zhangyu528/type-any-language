#!/bin/bash
#
# ./dev — root-level entry for dev host operations.
#
# Thin dispatcher over ops/dev/. Use this when you want a short,
# memorable command from the project root:
#
#   ./dev setup          # first-time: build dev app images
#   ./dev doctor         # pre-flight (docker / images / ports / docker postgres)
#   ./dev start          # compose up + 后台 spawn compose watch (热重载)
#   ./dev stop
#   ./dev restart        # hard restart (recreate + re-read env)
#   ./dev reload         # alias for restart
#   ./dev logs [svc]     # docker compose logs -f
#   ./dev status         # 容器状态
#   ./dev migrate        # apply pending schema migrations (host-side runner)
#   ./dev watch          # foreground compose watch (Ctrl+C 退出)
#   ./dev build          # build dev app images (backend + frontend)
#   ./dev                # 默认 = usage
#
# Equivalent to invoking the matching ops/dev/<cmd>.sh file
# directly. `exec` replaces this shell so signals (Ctrl+C) propagate to
# the child.
#
# Exit codes / behaviour are identical to the underlying script.
#
# Note: the dev db is a `postgres:15-alpine` container in
# docker-compose.dev.yml — no cloud-db / .secrets/ indirection.
# `./dev import` doesn't exist because `./dev` doesn't know how to
# import content; use `./ops/dev/import_content.sh` (or
# `make dev-import-content`) instead.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
    # lifecycle.sh handles start/stop/restart|reload (4 subcommands in 1 file)
    start|stop|restart|reload)
        exec "$SCRIPT_DIR/ops/dev/lifecycle.sh" "$@"
        ;;
    # setup.sh has its own sub-dispatcher — strip the `setup` keyword
    # (which is our dispatcher arm name, not setup.sh's) and exec the
    # remainder. So `./dev setup` → `setup.sh` (default cmd_setup).
    setup)
        case "${2:-}" in
            -h|--help|help) exec "$SCRIPT_DIR/dev.sh" -h ;;
            *)              shift; exec "$SCRIPT_DIR/ops/dev/setup.sh" "$@" ;;
        esac
        ;;
    # One-file-per-cmd subcommands
    doctor|logs|migrate|watch|build|status)
        exec "$SCRIPT_DIR/ops/dev/$1.sh" "$@"
        ;;
    ""|-h|--help|help)
        cat <<EOF
用法: ./dev <command>

命令(直接对应 ops/dev/ 下的同名文件):
  setup             首次环境引导 (ops/dev/setup.sh)
                   — build dev 应用镜像(幂等);不起容器、不写 secrets
  doctor            pre-flight (ops/dev/doctor.sh)
  start             启动 dev 容器 (ops/dev/lifecycle.sh start)
                   — 起 db + backend + frontend + 后台 spawn compose watch;
                     若 db 是空会 warn 提示跑 ./ops/dev/import_content.sh
  stop              停止容器 (ops/dev/lifecycle.sh stop)
  restart [svc...]  recreate + 重读 env (ops/dev/lifecycle.sh restart)
                   — 不传 = recreate backend + frontend;传 = 只 recreate 那些
  reload            同 restart
  logs [svc]        跟踪日志 (ops/dev/logs.sh)
  status            容器状态
  migrate           apply schema migrations (ops/dev/migrate.sh — host-side runner)
  watch             前台 compose watch (ops/dev/watch.sh)
  build             build dev app images (ops/dev/build_image.sh)

内容导入(用 ./ops/dev/import_content.sh,不在本 dispatcher 里):
  ./ops/dev/import_content.sh           # UPSERT cms/content/ → docker postgres
                                        # 自动起 db(如需)+跑 backfills;无需 restart
  make dev-import-content                # 同上

示例:
  ./dev setup                           # build dev 应用镜像
  ./dev doctor                          # 体检
  ./dev start                           # 起容器
  # ... 改代码 ...
  ./dev restart                         # recreate
  # ... 改了 schema 后 ...
  ./dev migrate                         # apply migration(可选;restart 也会自动跑)
  # CMS 主机更新后:
  ./ops/dev/import_content.sh           # 灌入新内容
EOF
        ;;
    *)
        echo "未知命令: $1" >&2
        exec "$SCRIPT_DIR/dev.sh" -h
        ;;
esac