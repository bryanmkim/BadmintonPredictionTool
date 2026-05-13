#!/usr/bin/env python3
"""
Badminton Tracker – local sync server.
Serves static files + a tiny JSON state API.
Run: python server.py
"""

import http.server
import json
import os
# used later to detect machine IP address.
import socket
# provides to prevent race conditions for simulatenous requests.
import threading

PORT      = 8000
DATA_FILE = os.path.join(os.path.dirname(__file__), 'state.json')
lock      = threading.Lock()

DEFAULT_STATE = {
    'names':   {'p1': 'P1', 'p2': 'P2', 'p3': 'P3', 'p4': 'P4'},
    'rallies': []
}

def load_state():
    # if data file exists, load them all.
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r') as f:
            return json.load(f)
    return dict(DEFAULT_STATE)

def save_state(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2)


class Handler(http.server.SimpleHTTPRequestHandler):

    def do_OPTIONS(self):
        # if the HTTTP server responds with "200" it means "OK"
        self.send_response(200)
        self._cors()
        # CORS = Cross Origin Resource Sharing. Headers used by HTTP
        self.end_headers()

    def do_GET(self):
        # calls this python server aka the API and sends data site.
        if self.path == '/api/state':
            with lock:
                data = load_state()
            self._json(200, data)
        else:
            super().do_GET()

    def do_POST(self):
        # POST: When frontend wants to SAVE updated data/state
        if self.path == '/api/state':
            length = int(self.headers.get('Content-Length', 0))
            # Length simply grabs how many bytes we need to read from rfile to pass into out state.json
            # rfile is an inherited variable from the above inherited class. 
            # rfile: incoming request body
            body   = self.rfile.read(length)
            try:
                data = json.loads(body)
                with lock:
                    save_state(data)
                self._json(200, {'ok': True})
            except Exception as e:
                # "400" in HTTP measn an error
                self._json(400, {'error': str(e)})
        else:
            self.send_response(404)
            self.end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        # send_header is also an inherited function.
        # it writes one HTTP response haeder lien.
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, fmt, *args):
        ip     = self.client_address[0]
        method = self.command
        path   = self.path
        from datetime import datetime
        ts = datetime.now().strftime('%H:%M:%S')
        # Only log API calls and first page load; skip noisy asset requests
        if path.startswith('/api/') or path in ('/', '/index.html', '/data.html'):
            print(f'  [{ts}]  {ip:<18} {method} {path}')


def local_ip():
    try:
        # creates a UDP socket(not TCP because UDP is quicker for non-real-time-sync)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # connects to google DNS server.
        s.connect(('8.8.8.8', 80))
        # getsockanme returns the local IP the socket is bound to.
        # if we never connected the socket to Google DNS, the OS would never
        # pick up this socket and thus this socket will never be connected/intiated
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return 'localhost'


if __name__ == '__main__':
    import socketserver
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    ip = local_ip()
    with socketserver.TCPServer(('', PORT), Handler) as httpd:
        print(f'  Badminton Tracker running')
        print(f'  Local:   http://localhost:{PORT}')
        print(f'  Network: http://{ip}:{PORT}')
        print(f'  Ctrl+C to stop')
        httpd.serve_forever()
