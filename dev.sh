#!/bin/bash
#
# ./dev — root-level entry for dev host operations.
#
# Thin dispatcher over ops/dev/. Use this when you want a short,
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
#   ./dev content        # on-demand: import staging files + bake + restart
#   ./dev                # 默认 = usage
#
# Equivalent to invoking the matching ops/dev/<cmd>.sh file
# directly. `exec` replaces this shell so signals (Ctrl+C) propagate to
# the child.
#
# Exit codes / behaviour are identical to the underlying script.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
    # lifecycle.sh handles start/stop/restart|reload (4 subcommands in 1 file)
    start|stop|restart|reload)
        exec "$SCRIPT_DIR/ops/dev/lifecycle.sh" "$@"
        ;;
    # setup.sh has its own sub-dispatcher — strip the `setup` keyword
    # (which is our dispatcher arm name, not setup.sh's) and exec the
    # remainder. So `./dev.sh setup` → `setup.sh` (default cmd_setup),
    # and `./dev.sh setup content` → `setup.sh content` (cmd_content).
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
  setup [content]  首次环境引导 (ops/dev/setup.sh)。
                   无参数 = 完整 bootstrap;带 content = on-demand 烤 + 重启
  doctor           pre-flight (ops/dev/doctor.sh)
  start            启动 dev 容器 (ops/dev/lifecycle.sh start)
  stop             停止容器 (ops/dev/lifecycle.sh stop)
  restart          recreate + 重读 secrets (ops/dev/lifecycle.sh restart)
  reload           同 restart
  logs [svc]       跟踪日志 (ops/dev/logs.sh)
  status           容器状态 (ops/dev/lifecycle.sh 的相关部分)
  migrate          apply schema migrations (ops/dev/migrate.sh)
  watch            前台 compose watch (ops/dev/watch.sh)
  build            build dev app images (ops/dev/build_image.sh)

示例:
  ./dev setup
  ./dev doctor
  ./dev start
  # ... 改代码 ...
  ./dev restart
  # ... git pull 了新的 cms/staging 内容后,按需烤 + 重启 ...
  ./dev setup content
EOF
        ;;
    *)
        echo "未知命令: $1" >&2
        exec "$SCRIPT_DIR/dev.sh" -h
        ;;
esac
