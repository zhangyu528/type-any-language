#!/usr/bin/env bash
#
# Docker Development Deployment (one-time setup)
# Supports: macOS, Linux, Windows (Git Bash/WSL)
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

echo -e "${BLUE}==========================================${NC}"
echo -e "${BLUE}英语学习 Web 应用 - 开发环境部署${NC}"
echo -e "${BLUE}==========================================${NC}"
echo ""

# ============ Step 1: Check Docker ============
echo "[1/4] 检查 Docker..."

# Check docker command
if ! command -v docker &> /dev/null; then
    echo -e "${RED}错误: Docker 未安装${NC}"
    echo ""
    echo "是否需要帮你打开 Docker 下载页面？"
    echo "  1) 打开下载页面"
    echo "  2) 退出"
    read -p "请选择 [1/2]: " choice
    case "$choice" in
        1)
            open_url "https://docs.docker.com/get-docker/"
            echo "下载完成后重新运行此脚本"
            exit 0
            ;;
        *) exit 0 ;;
    esac
fi

# Check if daemon is running
if ! docker info &> /dev/null; then
    echo -e "${YELLOW}Docker 未运行，请先启动 Docker Desktop${NC}"
    echo "等待 Docker 启动后，再运行: ./scripts/deploy-dev.sh"
    exit 0
fi

echo -e "${GREEN}[OK]${NC} Docker 已就绪: $(docker --version 2>&1 | head -1)"

# Detect docker compose command
DOCKER_COMPOSE_CMD=""
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
else
    echo -e "${RED}错误: Docker Compose 未安装${NC}"
    exit 1
fi
echo -e "${GREEN}[OK]${NC} Docker Compose 已就绪"

# ============ Step 2: Setup .env.dev ============
echo ""
echo "[2/4] 配置环境..."

DB_USER="english_user"
DB_NAME="english_learning_dev"

# Check if password already exists
DB_PASS=$(grep "^POSTGRES_PASSWORD=" .env.dev 2>/dev/null | cut -d'=' -f2-)
[ -z "$DB_PASS" ] && DB_PASS=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 16)

# Ensure .env.dev exists
[ ! -f ".env.dev" ] && [ -f ".env.example" ] && cp .env.example .env.dev

write_env() {
    local var=$1
    local val=$2
    if grep -q "^${var}=" .env.dev 2>/dev/null; then
        sed -i.bak "s|^${var}=.*|${var}=${val}|" .env.dev 2>/dev/null || \
            sed -i '' -e "s|^${var}=.*|${var}=${val}|" .env.dev 2>/dev/null
    else
        echo "${var}=${val}" >> .env.dev
    fi
    rm -f .env.dev.bak 2>/dev/null
}

write_env "POSTGRES_USER" "$DB_USER"
write_env "POSTGRES_PASSWORD" "$DB_PASS"
write_env "POSTGRES_DB" "$DB_NAME"
write_env "DATABASE_URL" "postgresql://${DB_USER}:${DB_PASS}@db:5432/${DB_NAME}"

echo -e "${GREEN}数据库配置已自动写入 .env.dev:${NC}"
echo "  用户名: $DB_USER"
echo "  数据库: $DB_NAME"

# Load existing values
[ -f ".env.dev" ] && source .env.dev

prompt() {
    local var=$1
    local desc=$2
    local default=$3
    local current=""

    current=$(grep "^${var}=" .env.dev 2>/dev/null | cut -d'=' -f2-)
    [ -z "$current" ] && current="$default"

    echo -n "$desc"
    [ -n "$current" ] && echo -n " [$current]"
    echo -n ": "
    read value
    [ -z "$value" ] && value="$current"

    local escaped=$(echo "$value" | sed 's/[\/&]/\\&/g')
    if grep -q "^${var}=" .env.dev 2>/dev/null; then
        sed -i.bak "s|^${var}=.*|${var}=${escaped}|" .env.dev 2>/dev/null || \
            sed -i '' -e "s|^${var}=.*|${var}=${escaped}|" .env.dev 2>/dev/null
    else
        echo "${var}=${escaped}" >> .env.dev
    fi
    rm -f .env.dev.bak 2>/dev/null
}

echo ""
echo "--- AI 服务配置 ---"
prompt "AI_API_KEY" "AI API Key (必须)" ""
prompt "AI_BASE_URL" "API 基础URL" "https://api.minimaxi.com/anthropic"
prompt "AI_MODEL" "AI 模型" "MiniMax-M2.7"

echo ""
echo "--- 检查配置 ---"
if [ -z "$(grep "^AI_API_KEY=" .env.dev | cut -d'=' -f2-)" ]; then
    echo -e "${YELLOW}警告: AI_API_KEY 未配置，句子生成功能将不可用${NC}"
    read -p "是否继续? (y/N): " confirm
    [ "$confirm" != "y" ] && [ "$confirm" != "Y" ] && exit 0
fi

# ============ Step 3: Build images ============
echo ""
echo "[3/4] 构建 Docker 镜像..."
$DOCKER_COMPOSE_CMD -f docker-compose.dev.yml build

# ============ Step 4: Done ============
echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}部署完成!${NC}"
echo -e "${GREEN}==========================================${NC}"
echo ""
echo "下一步: 启动服务"
echo -e "  ${BLUE}./scripts/dev.sh start${NC}"
echo ""
echo "首次启动会自动转换词库"
echo ""