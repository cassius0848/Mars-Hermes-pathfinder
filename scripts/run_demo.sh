#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_PYTHON="$ROOT/.venv/bin/python"

if [[ ! -x "$VENV_PYTHON" ]]; then
  "$PYTHON_BIN" -m venv "$ROOT/.venv"
fi

if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  "$VENV_PYTHON" -m pip install -r "$ROOT/requirements.txt"
fi

export PYTHONPATH="$ROOT/src"
"$VENV_PYTHON" "$ROOT/scripts/verify_demo_assets.py"

PORT="${PORT:-8501}"
echo "Mars Pathfinder AI demo: http://localhost:$PORT"
exec "$VENV_PYTHON" -m streamlit run "$ROOT/app/streamlit_app.py" --server.headless true --server.port "$PORT"
