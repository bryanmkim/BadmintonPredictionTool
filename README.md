# Badminton Tracker

A local web app for recording and analyzing badminton rally data during doubles matches.

## Features

- **Record page** — log each rally by selecting the server, serve box, serve zone, and receiver response zone on an interactive court diagram
- **Data page** — review rally history and stats
- **Player names** — customizable names for all 4 players (Team A: P1/P2, Team B: P3/P4)
- **Local sync** — state is persisted to `state.json` via a lightweight Python server, so any device on the same network can view/record

## Setup

**Requirements:** Python 3

```bash
pip install -r requirements.txt
python3 server.py
```

Then open `http://localhost:8000` in your browser.

To stop the server, press `Ctrl+C` in the terminal. If it's running in the background:

```bash
kill $(lsof -ti tcp:8000)
```

## Network Access

The server prints a network URL on startup (e.g. `http://192.168.x.x:8000`) so other devices on the same Wi-Fi can connect.

## Files

| File | Purpose |
|------|---------|
| `server.py` | Python HTTP server — serves static files and the `/api/state` JSON endpoint |
| `index.html` | Record page |
| `data.html` | Data/stats page |
| `app.js` | Court geometry, zone definitions, and rally recording logic |
| `data.js` | Data page logic |
| `styles.css` | Styles |
| `state.json` | Persisted rally data (auto-created) |
