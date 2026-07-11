FROM python:3.11-slim

# Project version (root ./VERSION, resolved by scripts/lib.sh) + git SHA
# (best-effort, "unknown" if not in a git checkout). Surfaces in
# `docker inspect` as type-any-language.app.{version,git-sha}.
ARG APP_VERSION=latest
ARG GIT_SHA=unknown
LABEL type-any-language.app.version="${APP_VERSION}"
LABEL type-any-language.app.git-sha="${GIT_SHA}"

WORKDIR /app

# 复制依赖文件
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
