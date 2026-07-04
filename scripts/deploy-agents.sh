#!/usr/bin/env bash
# Thin wrapper — delegates to digital-agency deploy script with this repo as instance.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTANCE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CATALOGUE="${CATALOGUE_ROOT:-${INSTANCE_ROOT}/../digital-agency}"

if [[ ! -x "${CATALOGUE}/scripts/deploy-squad-agents.sh" ]]; then
  echo "error: digital-agency deploy script not found at ${CATALOGUE}/scripts/deploy-squad-agents.sh" >&2
  exit 1
fi

exec "${CATALOGUE}/scripts/deploy-squad-agents.sh" "$@" --instance "$INSTANCE_ROOT"
