# 英语学习 Web 应用 - 开发环境

## 部署

```bash
./scripts/deploy-dev.sh
```

首次运行自动配置：
- 检测 Docker 环境
- 生成 `.env.dev` 环境变量文件
- 引导配置 AI_API_KEY、TENCENT_SECRET_ID 等
- 构建 Docker 镜像

## 服务控制

```bash
./scripts/dev.sh start   # 启动服务
./scripts/dev.sh stop    # 停止服务
./scripts/dev.sh restart # 重启服务
./scripts/dev.sh logs    # 查看日志
./scripts/dev.sh status  # 查看状态
```

## 访问

- 前端: http://localhost:3000
- API 文档: http://localhost:8000/docs