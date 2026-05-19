#!/usr/bin/env python3
"""
Badminton Tracker – local sync server (FastAPI).
Serves static files + a tiny JSON state API.
Run: python server.py
"""

import os
import json
import socket
import threading

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

PORT      = 8000
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'state.json')
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
lock      = threading.Lock()

DEFAULT_STATE = {
    'names':   {'p1': 'P1', 'p2': 'P2', 'p3': 'P3', 'p4': 'P4'},
    'rallies': []
}

def load_state():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r') as f:
            return json.load(f)
    return dict(DEFAULT_STATE)

def save_state(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return 'localhost'


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['GET', 'POST', 'OPTIONS'],
    allow_headers=['Content-Type'],
)


@app.get('/api/state')
def get_state():
    with lock:
        return load_state()


@app.post('/api/state')
async def post_state(request: Request):
    body = await request.json()
    with lock:
        save_state(body)
    return {'ok': True}


# Static files mounted last so /api/* routes win.
app.mount('/', StaticFiles(directory=STATIC_DIR, html=True), name='static')


if __name__ == '__main__':
    ip = local_ip()
    print(f'  Badminton Tracker running')
    print(f'  Local:   http://localhost:{PORT}')
    print(f'  Network: http://{ip}:{PORT}')
    print(f'  Ctrl+C to stop')
    uvicorn.run(app, host='0.0.0.0', port=PORT, log_level='warning')
