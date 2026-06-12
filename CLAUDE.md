# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A pipeline for recording, transcribing, and browsing **Russian-language group meeting summaries**:

1. **Audio pipeline** (`process_audio.py`) — runs on Android/Termux; splits audio, uploads chunks to Gemini for transcription, generates a structured Russian summary, saves to disk, and optionally uploads to Nextcloud.
2. **Backend** (`backend/`) — Bun + Hono HTTP server that indexes summary `.md` files into SQLite, serves a REST API, and runs an optional Telegram bot.
3. **Frontend** (`frontend/`) — React SPA (Vite) styled as a Telegram Web App; lists meetings, shows individual summaries rendered as Markdown, and includes a chat page backed by the AI agent.

---

## Development commands

### Backend (Bun required)

```bash
cd backend
bun run dev        # watch mode with .env loaded
bun run start      # production start
bun run index      # re-index all summaries from SUMMARIES_DIR into SQLite
```

### Frontend

```bash
cd frontend
npm run dev        # Vite dev server (proxies /api to localhost:3001 via vite.config.ts)
npm run build      # tsc + vite build → dist/
npm run preview    # preview production build
```

### Audio pipeline (Python, Termux/macOS)

```bash
python process_audio.py <audio-file>
python process_audio.py --summary-only <transcript.txt>
```

Requires `ffmpeg`, `ffprobe`, and the `requests` package. Reads `GEMINI_API_KEY` from `.env` or environment.

---

## Architecture

### Data flow

```
Audio file → process_audio.py → transcript.txt + summary.md
                                        ↓
                              summaries/ directory
                                        ↓
                          bun run index (indexer.ts)
                                        ↓
                           SQLite (data/meetings.db)
                          ├── meetings table (content + embeddings)
                          └── meetings_fts virtual table (FTS5)
                                        ↓
                    Hono API (/api/meetings, /api/search, /api/chat)
                                        ↓
                          React SPA  ←→  Telegram Bot
```

### Backend modules (`backend/src/`)

| File | Role |
|------|------|
| `index.ts` | Hono app entry: mounts API routes, serves built frontend, starts Telegram bot |
| `db.ts` | SQLite singleton via `bun:sqlite`; runs migrations + FTS5 triggers on first connect |
| `indexer.ts` | One-shot script: reads `summaries/*.md`, embeds each, upserts into SQLite |
| `embedder.ts` | Loads `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (ONNX, quantized); cached in `data/models/` |
| `search.ts` | `searchMeetings()`: tries semantic search (cosine sim over stored embeddings), falls back to FTS5 |
| `agent.ts` | RAG chat: searches meetings for context, calls Gemini via Vercel AI SDK `generateText` |
| `bot.ts` | grammY Telegram bot: `/start`, `/list`, text → AI chat, inline mode → search results |

### Frontend pages (`frontend/src/pages/`)

- `MeetingList` — lists all meetings + search bar; links to detail or chat
- `MeetingView` — fetches full meeting by id, renders content with `react-markdown`
- `Chat` — multi-turn chat UI; sends message history to `POST /api/chat`

App routing is manual state (`useState<View>`), not React Router. Hash-based deep links (`#/meeting/:id`) come from Telegram inline results.

---

## Environment variables

Backend `.env` (see `backend/.env.example`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3001` | HTTP port |
| `SUMMARIES_DIR` | `../summaries` | Path to `.md` summary files |
| `DB_PATH` | `../data/meetings.db` | SQLite database location |
| `GOOGLE_GENERATIVE_AI_API_KEY` | — | Gemini key for AI agent |
| `AI_MODEL` | `gemini-2.0-flash` | Model used by `agent.ts` |
| `BOT_TOKEN` | — | Telegram bot token (bot is skipped if unset) |
| `WEBAPP_URL` | — | Public URL sent in bot buttons |
| `EMBED_MODEL` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | Embedding model |
| `MODEL_CACHE` | `../data/models` | Where ONNX models are cached |

Root `.env` is for `process_audio.py`:

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Gemini API key for transcription + summarization |
| `DOWNLOADS_DIR` | Where transcripts and summaries are saved |
| `NEXTCLOUD_HOST/USER/PASS/FOLDER` | Optional Nextcloud upload |

Frontend reads `VITE_API_URL` at build time; defaults to `/api` (relative, served by the backend).

---

## Key design notes

- **Search priority**: semantic (embedding cosine similarity) → FTS5 keyword fallback. Embeddings are stored as JSON arrays in the `embedding` TEXT column; `ALTER TABLE ... ADD COLUMN` is run idempotently on startup.
- **Chunked transcription**: audio is split into 10-minute MP3 chunks before uploading to Gemini to avoid repetition loops and token limits. Each chunk is deleted from the Files API after use.
- **Model switching**: `agent.ts` uses Vercel AI SDK; swapping from Gemini to Anthropic/OpenAI is a one-line provider change (commented in the file).
- **Summary format**: the summarization prompt (`process_audio.py:summarize`) is tightly structured with 9 named sections in Russian. Don't alter the prompt structure without checking existing summaries.
- **Telegram Web App**: the frontend uses `@twa-dev/sdk` and is intended to be opened inside Telegram as a WebApp. The bot sends `webApp` keyboard buttons pointing at `WEBAPP_URL`.
