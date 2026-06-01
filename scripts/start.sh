#!/bin/bash

echo "=========================================="
echo "英语学习 Web 应用 - Docker 生产环境"
echo "=========================================="

# 1. 检查 .env 文件
echo "[1/5] 检查环境配置..."

# Helper to prompt for value with default
prompt() {
    local var=$1
    local desc=$2
    local default=$3
    local value=""
    echo -n "$desc"
    if [ -n "$default" ]; then
        echo -n " [$default]"
    fi
    echo -n ": "
    read value
    if [ -z "$value" ] && [ -n "$default" ]; then
        value="$default"
    fi
    local escaped=$(echo "$value" | sed 's/[\/&]/\\&/g')
    if sed -i.bak "s/^${var}=.*/${var}=${escaped}/" .env 2>/dev/null; then
        rm -f .env.bak
    elif sed -i '' -e "s/^${var}=.*/${var}=${escaped}/" .env 2>/dev/null; then
        rm -f .env.bak 2>/dev/null
    fi
}

# Ensure .env exists
if [ ! -f ".env" ]; then
    cp .env.example .env
fi

echo ""
echo "--- 数据库配置 ---"
prompt "POSTGRES_USER" "PostgreSQL 用户名" "english_user"
prompt "POSTGRES_PASSWORD" "PostgreSQL 密码" "password"
prompt "POSTGRES_DB" "数据库名称" "english_learning"

echo ""
echo "--- AI 服务配置 ---"
prompt "AI_API_KEY" "OpenAI API Key (必须)" ""
prompt "AI_BASE_URL" "API 基础URL" "https://api.openai.com/v1"
prompt "AI_MODEL" "AI 模型" "gpt-3.5-turbo"

echo ""
echo "--- 检查配置 ---"
AI_API_KEY=$(grep "^AI_API_KEY=" .env | cut -d'=' -f2-)
if [ -z "$AI_API_KEY" ]; then
    echo "警告: AI_API_KEY 未配置，句子生成功能将不可用"
    read -p "是否继续? (y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        exit 0
    fi
fi

# 2. 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "错误: 请先安装 Docker"
    exit 1
fi

# Check docker-compose or docker compose
DOCKER_COMPOSE_CMD=""
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
else
    echo "错误: 请先安装 Docker Compose"
    exit 1
fi

# 3. 生成词库（如需要）
echo ""
echo "[3/5] 生成词库 CSV..."
if [ ! -d "backend/seed/vocabulary" ] || [ -z "$(ls -A backend/seed/vocabulary/*.csv 2>/dev/null)" ]; then
    pip install wordfreq -q
    python backend/generate_vocab.py
else
    echo "词库已存在，跳过生成"
fi

# 4. 构建并启动容器
echo "[4/5] 构建 Docker 容器..."
$DOCKER_COMPOSE_CMD -f docker-compose.yml build

echo "[5/5] 启动服务..."
$DOCKER_COMPOSE_CMD -f docker-compose.yml up -d

# 检查状态
echo ""
echo "==================================="
echo "服务状态:"
$DOCKER_COMPOSE_CMD ps
echo ""
echo "访问地址:"
echo "  前端: http://localhost"
echo "  API:  http://localhost/api/docs"
echo "==================================="
