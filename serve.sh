#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-5173}"
DIR="$(cd "$(dirname "$0")" && pwd)/frontend"

echo "Serving $DIR on http://localhost:$PORT/"
python3 -m http.server "$PORT" --directory "$DIR"