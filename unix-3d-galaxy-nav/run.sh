#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
ROOT="${ROOT:-/}"
DEPTH="${DEPTH:-2}"

PYTHON_BIN="python3"
if [ -x "$SCRIPT_DIR/.venv/bin/python3" ]; then
  PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python3"
fi

"$PYTHON_BIN" backend/server.py --host "$HOST" --port "$PORT" --root "$ROOT" --depth "$DEPTH" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://$HOST:$PORT/api/config"; then
    break
  fi
  sleep 0.1
done

URL="http://$HOST:$PORT/"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
else
  echo "Open $URL in your browser."
fi

wait "$SERVER_PID"
