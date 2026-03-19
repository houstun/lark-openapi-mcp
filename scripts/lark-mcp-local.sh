#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.local"
CLI_FILE="${ROOT_DIR}/dist/cli.js"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [[ ! -f "${CLI_FILE}" ]]; then
  echo "dist/cli.js not found. Run: npm run build" >&2
  exit 1
fi

exec node "${CLI_FILE}" "$@"
