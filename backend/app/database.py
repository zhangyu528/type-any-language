from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import get_settings

settings = get_settings()

# resolved_database_url() honours DATABASE_URL_FILE indirection (see config.py).
engine = create_engine(
    settings.resolved_database_url(),
    # Fail fast instead of hanging the request thread when Postgres is
    # unreachable or the pool is exhausted. Without these, a stalled DB
    # connection leaves /api/dashboard pending forever and the SPA spins.
    connect_args={"connect_timeout": 5},
    pool_pre_ping=True,
    pool_timeout=10,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
