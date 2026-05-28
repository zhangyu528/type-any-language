from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routers import vocabulary, sentences

# 创建数据库表
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="英语学习 API",
    description="听音写句 - 英语句子学习后端服务",
    version="0.1.0"
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(vocabulary.router)
app.include_router(sentences.router)


@app.get("/")
def root():
    return {"message": "英语学习 API v0.1.0", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}
