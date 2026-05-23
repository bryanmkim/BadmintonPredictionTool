CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at_ms BIGINT NOT NULL,
    names JSONB NOT NULL DEFAULT '{}'::jsonb
);

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
);

CREATE INDEX IF NOT EXISTS rallies_session_id_idx
ON rallies(session_id);
