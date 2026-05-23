import json
import os
import time
from typing import Optional

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(STATIC_DIR, 'state.json')

if load_dotenv:
    load_dotenv(os.path.join(STATIC_DIR, '.env'))

DATABASE_URL = os.getenv('DATABASE_URL')

DEFAULT_NAMES = {'p1': 'P1', 'p2': 'P2', 'p3': 'P3', 'p4': 'P4'}
CURRENT_SESSION_KEY = 'current_session_id'


def _new_session(name: str, names: Optional[dict] = None, created_at: Optional[int] = None) -> dict:
    ts = created_at if created_at is not None else int(time.time() * 1000)
    return {
        'id': f's_{ts}',
        'name': name,
        'createdAt': ts,
        'names': {**DEFAULT_NAMES, **(names or {})},
        'rallies': [],
    }


def _empty_state() -> dict:
    return {'currentSessionId': None, 'sessions': {}}


def _migrate_if_needed(data: dict) -> dict:
    """Wrap legacy {names, rallies} shape into a single session."""
    if 'sessions' in data and 'currentSessionId' in data:
        return data
    if 'names' in data and 'rallies' in data:
        try:
            mtime_ms = int(os.path.getmtime(DATA_FILE) * 1000)
        except OSError:
            mtime_ms = int(time.time() * 1000)
        session = _new_session('Session 1', data.get('names'), created_at=mtime_ms)
        session['rallies'] = data.get('rallies', [])
        return {'currentSessionId': session['id'], 'sessions': {session['id']: session}}
    return _empty_state()


def storage_backend() -> str:
    return 'postgres' if DATABASE_URL else 'json'


def load_state() -> dict:
    if DATABASE_URL:
        return _load_postgres_state()
    return _load_json_state()


def save_state(data: dict) -> None:
    if DATABASE_URL:
        _save_postgres_state(data)
    else:
        _save_json_state(data)


def load_json_state() -> dict:
    return _load_json_state()


def import_state_to_postgres(data: dict) -> None:
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL must be set to import state into PostgreSQL.')
    _upsert_postgres_state(data, delete_missing=False)


def _load_json_state() -> dict:
    if not os.path.exists(DATA_FILE):
        return _empty_state()
    with open(DATA_FILE, 'r') as f:
        raw = json.load(f)
    migrated = _migrate_if_needed(raw)
    if migrated is not raw:
        # Persist the migrated shape on first read so the on-disk file is fresh.
        _save_json_state(migrated)
    return migrated


def _save_json_state(data: dict) -> None:
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def _connect():
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError(
            'DATABASE_URL is set, but psycopg is not installed. '
            'Run: pip install -r requirements.txt'
        ) from exc
    return psycopg.connect(DATABASE_URL, prepare_threshold=None)


def init_db() -> None:
    if not DATABASE_URL:
        return
    with _connect() as conn:
        _ensure_schema(conn)


def _ensure_schema(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_state (
            key TEXT PRIMARY KEY,
            value TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at_ms BIGINT NOT NULL,
            names JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rallies (
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            id BIGINT NOT NULL,
            server TEXT,
            serve_box TEXT,
            serve TEXT,
            receiver TEXT,
            receive_box TEXT,
            receive TEXT,
            PRIMARY KEY (session_id, id)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS rallies_session_id_idx
        ON rallies(session_id)
        """
    )


def _load_postgres_state() -> dict:
    with _connect() as conn:
        _ensure_schema(conn)
        current = conn.execute(
            'SELECT value FROM app_state WHERE key = %s',
            (CURRENT_SESSION_KEY,),
        ).fetchone()
        session_rows = conn.execute(
            """
            SELECT id, name, created_at_ms, names
            FROM sessions
            ORDER BY created_at_ms DESC
            """
        ).fetchall()
        rally_rows = conn.execute(
            """
            SELECT session_id, id, server, serve_box, serve, receiver, receive_box, receive
            FROM rallies
            ORDER BY session_id, id
            """
        ).fetchall()

    state = {'currentSessionId': current[0] if current else None, 'sessions': {}}
    for session_id, name, created_at_ms, names in session_rows:
        state['sessions'][session_id] = {
            'id': session_id,
            'name': name,
            'createdAt': created_at_ms,
            'names': {**DEFAULT_NAMES, **(names or {})},
            'rallies': [],
        }
    for session_id, rally_id, server, serve_box, serve, receiver, receive_box, receive in rally_rows:
        session = state['sessions'].get(session_id)
        if session is None:
            continue
        session['rallies'].append({
            'id': rally_id,
            'server': server,
            'serveBox': serve_box,
            'serve': serve,
            'receiver': receiver,
            'receiveBox': receive_box,
            'receive': receive,
        })

    if state['currentSessionId'] not in state['sessions']:
        state['currentSessionId'] = None
    return state


def _save_postgres_state(data: dict) -> None:
    _upsert_postgres_state(data, delete_missing=True)


def _upsert_postgres_state(data: dict, delete_missing: bool) -> None:
    from psycopg.types.json import Jsonb

    session_ids = list(data.get('sessions', {}).keys())
    with _connect() as conn:
        _ensure_schema(conn)
        conn.execute(
            """
            INSERT INTO app_state(key, value)
            VALUES (%s, %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """,
            (CURRENT_SESSION_KEY, data.get('currentSessionId')),
        )

        if delete_missing:
            if session_ids:
                conn.execute(
                    'DELETE FROM sessions WHERE id <> ALL(%s)',
                    (session_ids,),
                )
            else:
                conn.execute('DELETE FROM sessions')

        for session in data.get('sessions', {}).values():
            conn.execute(
                """
                INSERT INTO sessions(id, name, created_at_ms, names)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    created_at_ms = EXCLUDED.created_at_ms,
                    names = EXCLUDED.names
                """,
                (
                    session['id'],
                    session['name'],
                    session['createdAt'],
                    Jsonb(session.get('names') or DEFAULT_NAMES),
                ),
            )
            if delete_missing:
                conn.execute('DELETE FROM rallies WHERE session_id = %s', (session['id'],))
            for rally in session.get('rallies', []):
                conn.execute(
                    """
                    INSERT INTO rallies(
                        session_id, id, server, serve_box, serve,
                        receiver, receive_box, receive
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (session_id, id) DO UPDATE SET
                        server = EXCLUDED.server,
                        serve_box = EXCLUDED.serve_box,
                        serve = EXCLUDED.serve,
                        receiver = EXCLUDED.receiver,
                        receive_box = EXCLUDED.receive_box,
                        receive = EXCLUDED.receive
                    """,
                    (
                        session['id'],
                        rally['id'],
                        rally.get('server'),
                        rally.get('serveBox'),
                        rally.get('serve'),
                        rally.get('receiver'),
                        rally.get('receiveBox'),
                        rally.get('receive'),
                    ),
                )
