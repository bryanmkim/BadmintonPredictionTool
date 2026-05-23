#!/usr/bin/env python3
"""
Badminton Tracker – local sync server (FastAPI).
Serves static files + multi-session JSON state API.
Run: python server.py
"""

import os
import socket
import threading
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

from storage import DEFAULT_NAMES, _new_session, init_db, load_state, save_state, storage_backend

PORT       = 8000
ROOT_DIR   = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(ROOT_DIR, 'static')
lock       = threading.Lock()


# ─── Pydantic models ────────────────────────────────────────────────────────

class Rally(BaseModel):
    id: int
    server: Optional[str] = None
    serveBox: Optional[str] = None
    serve: Optional[str] = None
    receiver: Optional[str] = None
    receiveBox: Optional[str] = None
    receive: Optional[str] = None


class RallyPatch(BaseModel):
    server: Optional[str] = None
    serveBox: Optional[str] = None
    serve: Optional[str] = None
    receiver: Optional[str] = None
    receiveBox: Optional[str] = None
    receive: Optional[str] = None


class Session(BaseModel):
    id: str
    name: str
    createdAt: int
    names: dict
    rallies: list[Rally]


class SessionMeta(BaseModel):
    id: str
    name: str
    createdAt: int


class CreateSessionBody(BaseModel):
    name: str
    names: Optional[dict] = None


class PatchSessionBody(BaseModel):
    name: Optional[str] = None
    names: Optional[dict] = None


class SetCurrentBody(BaseModel):
    id: str


def _get_session_or_404(state: dict, session_id: str) -> dict:
    session = state['sessions'].get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f'session {session_id} not found')
    return session


def local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return 'localhost'


# ─── App setup ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


# ─── Routes ─────────────────────────────────────────────────────────────────

@app.get('/api/sessions')
def list_sessions():
    with lock:
        state = load_state()
    metas = [
        {'id': s['id'], 'name': s['name'], 'createdAt': s['createdAt']}
        for s in state['sessions'].values()
    ]
    metas.sort(key=lambda s: s['createdAt'], reverse=True)
    return {'currentSessionId': state['currentSessionId'], 'sessions': metas}


@app.get('/api/sessions/{session_id}')
def get_session(session_id: str):
    with lock:
        state = load_state()
        session = _get_session_or_404(state, session_id)
    return session


@app.post('/api/sessions', status_code=201)
def create_session(body: CreateSessionBody):
    with lock:
        state = load_state()
        session = _new_session(body.name.strip() or 'Untitled', body.names)
        # Avoid id collisions if two creates land in the same millisecond.
        while session['id'] in state['sessions']:
            session = _new_session(body.name.strip() or 'Untitled', body.names,
                                   created_at=session['createdAt'] + 1)
        state['sessions'][session['id']] = session
        if state['currentSessionId'] is None:
            state['currentSessionId'] = session['id']
        save_state(state)
    return session


@app.patch('/api/sessions/{session_id}')
def patch_session(session_id: str, body: PatchSessionBody):
    with lock:
        state = load_state()
        session = _get_session_or_404(state, session_id)
        if body.name is not None:
            session['name'] = body.name.strip() or session['name']
        if body.names is not None:
            session['names'] = {**session['names'], **body.names}
        save_state(state)
    return session


@app.delete('/api/sessions/{session_id}')
def delete_session(session_id: str):
    with lock:
        state = load_state()
        if session_id not in state['sessions']:
            raise HTTPException(status_code=404, detail='session not found')
        del state['sessions'][session_id]
        if state['currentSessionId'] == session_id:
            # Pick the newest remaining session, or None if empty.
            remaining = sorted(
                state['sessions'].values(),
                key=lambda s: s['createdAt'],
                reverse=True,
            )
            state['currentSessionId'] = remaining[0]['id'] if remaining else None
        save_state(state)
    return {'currentSessionId': state['currentSessionId']}


@app.put('/api/current-session')
def set_current_session(body: SetCurrentBody):
    with lock:
        state = load_state()
        _get_session_or_404(state, body.id)
        state['currentSessionId'] = body.id
        save_state(state)
    return {'currentSessionId': body.id}


@app.post('/api/sessions/{session_id}/rallies', status_code=201)
def append_rally(session_id: str, rally: Rally):
    with lock:
        state = load_state()
        session = _get_session_or_404(state, session_id)
        # Idempotent: if a rally with this id already exists, return it unchanged.
        if any(r['id'] == rally.id for r in session['rallies']):
            return {'ok': True, 'duplicate': True, 'rally': rally.model_dump()}
        session['rallies'].append(rally.model_dump())
        save_state(state)
    return {'ok': True, 'rally': rally.model_dump()}


@app.patch('/api/sessions/{session_id}/rallies/{rally_id}')
def patch_rally(session_id: str, rally_id: int, body: RallyPatch):
    with lock:
        state = load_state()
        session = _get_session_or_404(state, session_id)
        target = next((r for r in session['rallies'] if r['id'] == rally_id), None)
        if target is None:
            raise HTTPException(status_code=404, detail='rally not found')
        updates = body.model_dump(exclude_unset=True)
        target.update(updates)
        save_state(state)
    return {'ok': True, 'rally': target}


@app.delete('/api/sessions/{session_id}/rallies/{rally_id}')
def delete_rally(session_id: str, rally_id: int):
    with lock:
        state = load_state()
        session = _get_session_or_404(state, session_id)
        idx = next((i for i, r in enumerate(session['rallies']) if r['id'] == rally_id), None)
        removed = session['rallies'].pop(idx) if idx is not None else None
        save_state(state)
    return {'ok': True, 'removed': removed}


# Static files mounted last so /api/* routes win.
app.mount('/', StaticFiles(directory=STATIC_DIR, html=True), name='static')


if __name__ == '__main__':
    ip = local_ip()
    print(f'  Badminton Tracker running')
    print(f'  Storage: {storage_backend()}')
    print(f'  Local:   http://localhost:{PORT}')
    print(f'  Network: http://{ip}:{PORT}')
    print(f'  Ctrl+C to stop')
    uvicorn.run(app, host='0.0.0.0', port=PORT, log_level='warning')
