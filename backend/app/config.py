import os
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql://english_user:password@localhost:5432/english_learning"

    # Security
    secret_key: str = "change-me-in-production"

    # AI Service
    ai_api_key: str = ""
    ai_base_url: str = "https://api.openai.com/v1"
    ai_model: str = "gpt-3.5-turbo"

    # Audio (for reference, not used with Web Speech)
    audio_dir: str = "/app/audio"

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
