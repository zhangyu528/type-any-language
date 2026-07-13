#!/bin/bash
#
# ./dev — root-level entry for dev host operations.
#
# Thin dispatcher over scripts/dev-host/. Use this when you want a short,
# memorable command from the project root:
#
#   ./dev setup          # first-time: 拉/检查 db image, build dev app images
#   ./dev doctor         # pre-flight
#   ./dev start          # compose up + 后台 spawn compose watch (热重载)
#   ./dev stop
#   ./dev restart        # hard restart (recreate + re-read secrets)
#   ./dev reload         # alias for restart
#   ./dev logs [svc]     # docker compose logs -f
#   ./dev status         # 容器状态
#   ./dev migrate        # apply pending schema migrations
#   ./dev watch          # foreground compose watch (Ctrl+C 退出)
#   ./dev build          # build dev app images (backend + frontend)
#   ./dev                # 默认 = usage
#
# Equivalent to invoking the matching scripts/dev-host/<cmd>.sh file
# directly. `exec` replaces this shell so signals (Ctrl+C) propagate to
# the child.
#
# Exit codes / behaviour are identical to the underlying script.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
    # lifecycle.sh handles start/stop/restart|reload (4 subcommands in 1 file)
    start|stop|restart|reload)
        exec "$SCRIPT_DIR/scripts/dev-host/lifecycle.sh" "$@"
        ;;
    # One-file-per-cmd subcommands
    setup|doctor|logs|migrate|watch|build|status)
        exec "$SCRIPT_DIR/scripts/dev-host/$1.sh" "$@"
        ;;
    ""|-h|--help|help)
        cat <<EOF
用法: ./dev <command>

命令(直接对应 scripts/dev-host/ 下的同名文件):
  setup        首次环境引导 (scripts/dev-host/setup.sh)
  doctor       pre-flight (scripts/dev-host/doctor.sh)
  start        启动 dev 容器 (scripts/dev-host/lifecycle.sh start)
  stop         停止容器 (scripts/dev-host/lifecycle.sh stop)
  restart      recreate + 重读 secrets (scripts/dev-host/lifecycle.sh restart)
  reload       同 restart
  logs [svc]   跟踪日志 (scripts/dev-host/logs.sh)
  status       容器状态 (scripts/dev-host/lifecycle.sh 的相关部分)
  migrate      apply schema migrations (scripts/dev-host/migrate.sh)
  watch        前台 compose watch (scripts/dev-host/watch.sh)
  build        build dev app images (scripts/dev-host/build_image.sh)

示例:
  ./dev setup
  ./dev doctor
  ./dev start
  # ... 改代码 ...
  ./dev restart
EOF
        ;;
    *)
        echo "未知命令: $1" >&2
        exec "$SCRIPT_DIR/dev.sh" -h
        ;;
esac
