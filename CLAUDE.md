# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

English learning web app — plays sentence audio (via Web Speech API) and users type the complete sentence. Features AI-generated practice sentences.

## Architecture

```
├── backend/              # FastAPI + SQLAlchemy + PostgreSQL
│   ├── app/
│   │   ├── main.py      # FastAPI app entry, CORS,路由注册
│   │   ├── config.py    # Settings from .env via pydantic-settings
│   │   ├── database.py  # SQLAlchemy engine/session
│   │   ├── models/      # SQLAlchemy models (VocabularyLib, VocabularyWord, Sentence)
│   │   ├── routers/     # API routes (vocabulary, sentences)
│   │   ├── schemas/     # Pydantic request/response models
│   └── services/    # AI (OpenAI) services
│   └── requirements.txt
│
├── frontend/             # React + TypeScript (react-scripts 5.0.1)
│   └── src/
│       ├── api/         # API client
│       └── pages/       # Page components
│
├── scripts/             # Root-level utility scripts
│   ├── generate_vocab.py  # Generates CSV vocab files via wordfreq zipf frequency
│   └── seed_vocabulary.py # Imports CSV into PostgreSQL
│
├── seed/vocabulary/     # Generated CSV vocab files (beginner, cet4, cet6, ielts)
├── nginx/               # Nginx reverse proxy config
└── docker-compose.yml   # Orchestrates db, nginx, backend, frontend
```

## Commands

### Docker (Production)

```bash
./start.sh              # Full setup: generates vocab CSVs, builds containers, starts services
```

### Local Development Without Docker

**Backend:**
```bash
cd backend
pip install -r requirements.txt

# Set env vars then:
python ../scripts/generate_vocab.py    # Generate seed/vocabulary/*.csv
python ../scripts/seed_vocabulary.py   # Import CSV into PostgreSQL
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm start               # Dev server on :3000
```

### Testing

```bash
# Frontend
cd frontend
npm test               # Interactive tests

# Backend - single test (requires pytest)
cd backend
python -m pytest tests/test_file.py::test_name -v
```

## Key API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/vocabulary/libs` | GET | List all vocabulary libraries |
| `/api/vocabulary/libs/{id}/random` | GET | Get N random words from a library |
| `/api/sentences/generate` | POST | Generate practice sentences (uses cache or AI) |
| `/api/sentences/check` | POST | Validate user input against correct answer |

## Data Flow

1. User opens the app
2. Backend returns sentences generated via OpenAI GPT
3. Audio is played via browser Web Speech API (no backend TTS)
4. User submits answer → `validate_answer()` normalizes and compares (lowercase, strip punctuation/spaces)

## Environment Variables

Required in `.env`:
- `DATABASE_URL` (PostgreSQL connection)
- `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` (OpenAI)