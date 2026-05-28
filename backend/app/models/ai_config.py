import uuid
from sqlalchemy import Column, String, DateTime, Boolean, Text
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
from app.database import Base


class AIConfig(Base):
    __tablename__ = "ai_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider = Column(String(50), nullable=False)  # openai/claude/custom
    api_key_encrypted = Column(Text, nullable=True)
    base_url = Column(String(500), default="")
    model = Column(String(100), default="gpt-3.5-turbo")
    is_active = Column(Boolean, default=True)
    is_backup = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
