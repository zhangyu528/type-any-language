#!/usr/bin/env bash
#
# Docker Development - Service control
# Start / stop / logs / status
# Supports: macOS, Linux, WSL, Git Bash (msys)
#

set -e

# ============ Cross-platform helpers ============

detect_os() {
    case "$(uname -s)" in
        Darwin*) echo "darwin" ;;
        Linux*) echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *) echo "unknown" ;;
    esac
}

find_docker() {
    local os=$(detect_os)
    local docker_path=""

    if [ "$os" = "darwin" ]; then
        [ -f "/Applications/Docker.app/Contents/Resources/bin/docker" ] && \
            docker_path="/Applications/Docker.app/Contents/Resources/bin/docker"
    elif [ "$os" = "windows" ]; then
        [ -f "/c/Program Files/Docker/Docker/resources/bin/docker.exe" ] && \
            docker_path="/c/Program Files/Docker/Docker/resources/bin/docker.exe"
    else
        command -v docker &>/dev/null && docker_path="docker"
    fi

    echo "$docker_path"
}

get_docker_path() {
    local path="$(pwd)"
    local os=$(detect_os)
    if [ "$os" = "windows" ]; then
        echo "$path" | sed 's|^/\([a-z]\)/|\1:/|'
    else
        echo "$path"
    fi
}

open_url() {
    local os=$(detect_os)
    if [ "$os" = "darwin" ]; then
        open "$1"
    elif [ "$os" = "windows" ]; then
        start "$1"
    else
        xdg-open "$1" 2>/dev/null || echo "请手动打开: $1"
    fi
}

get_compose_network() {
    local project="${COMPOSE_PROJECT_NAME:-type-any-language}"
    local os=$(detect_os)
    if [ "$os" = "windows" ]; then
        echo "${project}_default"
    else
        echo "${project}-default"
    fi
}

check_windows_shell() {
    local os=$(detect_os)
    if [ "$os" = "windows" ]; then
        # On Windows, require Git Bash or WSL by checking for bash with MSYS environment
        if ! command -v bash &> /dev/null; then
            echo -e "${RED}错误: 需要 Git Bash 或 WSL 来运行此脚本${NC}"
            exit 1
        fi
        # MSYS环境的标志：检查是否在正确的shell环境中
        if [ -z "$MSYSTEM" ] && ! echo "$0" | grep -qE '^/bash|^/usr/bin/bash|^/mingw'; then
            # 尝试通过检查路径格式判断是否在Git Bash中
            if ! echo "$PWD" | grep -qE '^/[a-z]/'; then
                echo -e "${RED}错误: 请在 Git Bash 或 WSL 中运行此脚本${NC}"
                echo ""
                echo "在 Windows 上，请使用以下方式之一运行:"
                echo "  1) Git Bash: ./scripts/dev.sh"
                echo "  2) WSL: wsl ./scripts/dev.sh"
                exit 1
            fi
        fi
    fi
}

# ============ Script start ============

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Add Docker to PATH if needed
DOCKER_BIN=$(find_docker)
if [ -n "$DOCKER_BIN" ] && [ "$DOCKER_BIN" != "docker" ]; then
    export PATH="$(dirname "$DOCKER_BIN"):$PATH"
fi

# Colors
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

# Check docker-compose vs docker compose
DOCKER_COMPOSE_CMD=""
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
else
    echo -e "${RED}错误: Docker Compose 未安装${NC}"
    exit 1
fi

check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}错误: Docker 未安装${NC}"
        exit 1
    fi
    if ! docker info &> /dev/null; then
        echo -e "${YELLOW}Docker 未运行，请先启动 Docker Desktop${NC}"
        exit 0
    fi
}

convert() {
    # Convert vocab TXT → CSV inside backend container
    echo -e "${BLUE}转换词库 TXT → CSV...${NC}"

    PROJECT_WIN_PATH=$(get_docker_path)
    COMPOSE_NETWORK=$(get_compose_network)

    docker run --rm \
      -v "${PROJECT_WIN_PATH}:/app" \
      -w /app \
      --network "${COMPOSE_NETWORK}" \
      python:3.11-slim \
      sh -c "pip install wordfreq -q && python scripts/convert_vocab.py"

    echo -e "${GREEN}词库转换完成${NC}"
}

start() {
    echo -e "${BLUE}启动开发服务...${NC}"
    $DOCKER_COMPOSE_CMD -f docker-compose.dev.yml up -d
    sleep 3

    # Convert vocab TXT → CSV if needed (first time only)
    CSV_COUNT=$(ls seed/vocabulary/*.csv 2>/dev/null | wc -l)
    if [ "$CSV_COUNT" -lt 4 ]; then
        echo -e "${BLUE}转换词库 TXT → CSV...${NC}"
        docker exec english_backend_dev sh -c "pip install wordfreq -q && python backend/scripts/convert_vocab.py" 2>/dev/null || \
            echo -e "${YELLOW}[SKIP]${NC} 词库转换跳过（请先运行 ./scripts/deploy-dev.sh）"
    fi

    echo -e "${GREEN}服务已启动${NC}"
    echo -e "  前端:   ${BLUE}http://localhost:3000${NC}"
    echo -e "  后端:   ${BLUE}http://localhost:8000${NC}"
    echo -e "  API文档: ${BLUE}http://localhost:8000/docs${NC}"
}

stop() {
    echo -e "${BLUE}停止开发服务...${NC}"
    $DOCKER_COMPOSE_CMD -f docker-compose.dev.yml down
    echo -e "${GREEN}服务已停止${NC}"
}

logs() {
    $DOCKER_COMPOSE_CMD -f docker-compose.dev.yml logs -f
}

status() {
    $DOCKER_COMPOSE_CMD -f docker-compose.dev.yml ps
}

usage() {
    echo "用法: ./scripts/dev.sh <command>"
    echo ""
    echo "命令:"
    echo "  convert 转换词库 (TXT → CSV)"
    echo "  start    启动服务"
    echo "  stop     停止服务"
    echo "  restart  重启服务"
    echo "  logs     查看日志 (Ctrl+C 退出)"
    echo "  status   查看状态"
    echo ""
    echo "示例:"
    echo "  ./scripts/dev.sh convert"
    echo "  ./scripts/dev.sh start"
}

case "${1:-}" in
    convert)
        check_docker
        check_windows_shell
        convert
        ;;
    start)
        check_docker
        check_windows_shell
        start
        ;;
    stop)
        check_docker
        check_windows_shell
        stop
        ;;
    restart)
        check_docker
        check_windows_shell
        echo -e "${BLUE}重启开发服务...${NC}"
        $DOCKER_COMPOSE_CMD -f docker-compose.dev.yml restart
        echo -e "${GREEN}服务已重启${NC}"
        ;;
    logs)
        check_docker
        check_windows_shell
        logs
        ;;
    status)
        check_docker
        check_windows_shell
        status
        ;;
    *)
        usage
        exit 0
        ;;
esac