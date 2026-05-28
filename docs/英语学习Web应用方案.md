# 英语学习 Web 应用方案

**版本：v2.0.0**

---

## 1. 产品概述

开发一个英语学习 Web 应用，核心功能：**听音写句** —— 播放句子音频，用户根据音频输入完整句子。

---

## 2. 系统架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend   │────▶│  AI API     │
│   (React)   │◀────│   (FastAPI) │◀────│ (OpenAI等)  │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                    ┌─────▼─────┐     ┌─────────────┐
                    │ Database  │────▶│  Tencent TTS│
                    │(PostgreSQL)│     │            │
                    └───────────┘     └─────────────┘
```

---

## 3. 技术栈

| 层级 | 选型 |
|------|------|
| 前端 | React + TypeScript + TailwindCSS |
| 后端 | Python/FastAPI + SQLAlchemy |
| 数据库 | PostgreSQL |
| AI 服务 | OpenAI API / Claude API（可配置） |
| TTS | 腾讯云 TTS（首 200 万次/月免费） |
| 部署 | Docker Compose |

---

## 4. 核心流程

```
1. 用户选择词库（如 CET-4）
       │
       ▼
2. 系统从词库随机选取词汇
       │
       ▼
3. AI 根据词汇生成句子（首次需生成，后续走缓存）
       │
       ▼
4. 腾讯云 TTS 生成音频（首次需生成，后续走缓存）
       │
       ▼
5. 用户开始练习：
   - 播放音频
   - 输入句子
   - 提交答案
   - 获得反馈
```

---

## 5. 数据库设计

### 5.1 词库表 (vocabulary_libs)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | VARCHAR(100) | 词库名称 |
| level | VARCHAR(20) | beginner/cet4/cet6/ielts |
| word_count | INT | 词汇数量 |
| created_at | TIMESTAMP | 创建时间 |

### 5.2 词汇表 (vocabulary_words)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| lib_id | UUID | 外键，关联词库 |
| word | VARCHAR(100) | 英文单词 |
| phonetic | VARCHAR(100) | 国际音标 |
| translation | TEXT | 中文释义 |
| part_of_speech | VARCHAR(20) | 词性 |
| created_at | TIMESTAMP | 创建时间 |

### 5.3 句子表 (sentences)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| lib_id | UUID | 外键，关联词库 |
| text | TEXT | 完整句子 |
| target_words | TEXT[] | 包含的目标词汇 |
| difficulty | VARCHAR(20) | 难度级别 |
| audio_url | VARCHAR(500) | 音频文件路径 |
| is_cached | BOOLEAN | 是否已缓存 |
| use_count | INT | 被使用次数 |
| created_at | TIMESTAMP | 创建时间 |

---

## 6. 词库生成策略

### 按考试等级筛选（基于 Zipf 词频）

| 等级 | Zipf 范围 | 词汇量 |
|------|-----------|--------|
| 初中基础 | 6.5 - 8.5 | ~1500 |
| CET-4 | 5.0 - 7.0 | ~2500 |
| CET-6 | 4.0 - 5.5 | ~2500 |
| IELTS | 3.0 - 4.5 | ~3000 |

### 生成脚本

使用 `scripts/generate_vocab.py` 生成 CSV 文件，再用 `scripts/seed_vocabulary.py` 导入数据库。

---

## 7. API 端点

### 7.1 词库相关

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/vocabulary/libs` | GET | 获取所有词库 |
| `/api/vocabulary/libs/{id}/random` | GET | 随机获取 N 个词汇 |

### 7.2 句子相关

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sentences/generate` | POST | 生成练习句子 |
| `/api/sentences/{id}/audio` | GET | 获取音频文件 |
| `/api/sentences/check` | POST | 校验答案 |

---

## 8. 前端练习流程

```
┌─────────────────────────────────────┐
│  1. 选择词库                         │
│     [ CET-4 ▼ ]  [ 开始练习 ]        │
├─────────────────────────────────────┤
│  2. 显示单词提示（可选）              │
│     [ apple ] [ red ]               │
├─────────────────────────────────────┤
│  3. 播放音频                         │
│     🔊 [ ▶ 播放 ]  [ 🔄 重播 ]       │
├─────────────────────────────────────┤
│  4. 输入句子                         │
│     [____________________]           │
├─────────────────────────────────────┤
│  5. 提交答案                         │
│     [ 提交 ]                         │
├─────────────────────────────────────┤
│  6. 即时反馈                         │
│     ✅ 正确！ / ❌ 再试一次           │
└─────────────────────────────────────┘
```

---

## 9. 部署

### 一键部署

```bash
./start.sh
```

### 环境变量

```bash
# .env 配置
DATABASE_URL=postgresql://user:pass@host:5432/db
AI_API_KEY=sk-xxx
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-3.5-turbo
TENCENT_SECRET_ID=xxx
TENCENT_SECRET_KEY=xxx
TENCENT_APP_ID=123456789
```

---

## 10. 目录结构

```
project/
├── docker-compose.yml           # Docker 编排配置
├── docker-compose.dev.yml       # 开发环境配置
├── .env                         # 环境变量（不提交）
├── .env.example                 # 环境变量模板
├── start.sh                     # 一键部署脚本
│
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 主入口
│   │   ├── config.py            # 配置管理
│   │   ├── database.py          # 数据库连接
│   │   ├── models/              # SQLAlchemy 模型
│   │   ├── routers/             # API 路由
│   │   ├── schemas/             # Pydantic 模型
│   │   └── services/           # AI / TTS 服务
│   ├── audio/                   # 音频文件
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   ├── package.json
│   └── Dockerfile
│
├── scripts/
│   ├── generate_vocab.py        # 生成词库 CSV
│   ├── seed_vocabulary.py       # 导入词库到数据库
│   ├── deploy-dev.sh           # 开发环境部署
│   └── dev.sh                  # 开发服务控制
│
├── seed/
│   └── vocabulary/             # 词库 CSV
│       ├── beginner.csv
│       ├── cet4.csv
│       ├── cet6.csv
│       └── ielts.csv
│
├── nginx/                       # Nginx 配置
└── docs/                        # 方案文档
```