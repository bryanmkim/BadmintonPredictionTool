# Badminton Tracker

A local web app for recording and analyzing badminton rally data during doubles matches.

## Features

- **Record page**: log each rally by selecting the server, serve box, serve target, receiver, and return target.
- **Data page**: review rally history and serve/receive heatmaps.
- **Sessions**: create, switch, rename, and delete recording sessions.
- **Player names**: customize names for all four players.
- **PostgreSQL support**: use Supabase PostgreSQL when `DATABASE_URL` is configured.
- **Local fallback**: if `DATABASE_URL` is missing, the app falls back to local `state.json` storage.

## Setup

Create and activate a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the server:

```bash
python server.py
```

Open:

```text
http://localhost:8000
```

To stop the server, press `Ctrl+C` in the terminal running `python server.py`.

If port `8000` is already in use:

```bash
kill $(lsof -ti tcp:8000)
```

## Supabase PostgreSQL

The app uses Supabase/PostgreSQL when `DATABASE_URL` is present in `.env`.

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Run the contents of `schema.sql`.
4. Create a `.env` file in the project root.
5. Add your Supabase pooler connection string:

```bash
DATABASE_URL=postgresql://postgres.PROJECT_REF:YOUR_PASSWORD@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require
```

Use the Supabase **Connection pooler** URL if the direct `db.<project>.supabase.co:5432` URL fails locally. Copy the full pooler URL from Supabase; do not only change the port.

Then restart the server:

```bash
source .venv/bin/activate
python server.py
```

You should see:

```text
Storage: postgres
```

If you see `Storage: json`, the app did not load `DATABASE_URL` and is using local fallback storage.

## Database Structure

The PostgreSQL schema has three tables:

- `app_state`: stores app-level values like the current session id.
- `sessions`: stores each recording session, timestamp, display name, and player names.
- `rallies`: stores individual rally records linked to a session.

Relationship:

```text
sessions.id -> rallies.session_id
```

Supabase Auth is not implemented yet. When auth is added, sessions should get a `user_id` column so each user owns their own data.

## Project Structure

```text
badminton-tracker/
  server.py          # FastAPI server and API routes
  storage.py         # JSON/PostgreSQL persistence layer
  schema.sql         # Supabase/PostgreSQL table schema
  requirements.txt   # Python dependencies
  README.md
  static/
    index.html       # Record page
    data.html        # Data/stats page
    app.js           # Record page logic and sync client
    data.js          # Data page logic
    styles.css
```

Ignored local files:

- `.env`: local secrets, including `DATABASE_URL`
- `.venv/`: local Python virtual environment
- `state.json`: local fallback data file
- `__pycache__/`: generated Python cache

## Notes

- Keep `.env` private. Do not commit Supabase passwords.
- Keep `state.json` only if you still want a local backup/fallback.
- The browser should never connect directly to the database; FastAPI is the backend between the frontend and PostgreSQL.
