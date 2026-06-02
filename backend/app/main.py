from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.database import engine, Base
from app.routers import vocabulary, sentences
from app.config import get_settings
from app.services.scheduler import start_scheduler, stop_scheduler
from app.auto_migrate import run_auto_migrate

settings = get_settings()

# Auto-migrate missing columns before creating tables
run_auto_migrate()

# 创建数据库表
Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    if settings.cache_prewarm_enabled:
        start_scheduler()
    yield
    # Shutdown
    stop_scheduler()


app = FastAPI(
    title="英语学习 API",
    description="听音写句 - 英语句子学习后端服务",
    version="0.1.0",
    lifespan=lifespan
)

# Serve audio files (Tencent Cloud TTS generated MP3s)
app.mount("/audio", StaticFiles(directory=settings.audio_dir), name="audio")

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