#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 vm/screenshot.py --tab batch --output vm/screenshots/batch.png
python3 vm/screenshot.py --tab batch --sample --output vm/screenshots/batch-sample.png
python3 vm/screenshot.py --tab single --output vm/screenshots/single.png
python3 vm/screenshot.py --tab contacts --output vm/screenshots/contacts.png
echo "Screenshots written to: $ROOT/vm/screenshots"
