#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 qa/ui_audit.py "$@"
