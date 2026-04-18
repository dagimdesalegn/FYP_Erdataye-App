#!/usr/bin/env bash
set -euo pipefail

# Local helper: push scripts/vps-deploy.sh to VPS and run it in one command.
# Usage:
#   VPS_PASS='your-password' ./scripts/run-vps-deploy.sh

VPS_HOST="${VPS_HOST:-207.180.205.85}"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-22}"
VPS_PASS="${VPS_PASS:-}"

if [[ -z "$VPS_PASS" ]]; then
  echo "Set VPS_PASS environment variable first." >&2
  echo "Example: VPS_PASS='***' ./scripts/run-vps-deploy.sh" >&2
  exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
  echo "sshpass is required locally." >&2
  exit 1
fi

script_path="$(cd "$(dirname "$0")" && pwd)/vps-deploy.sh"

export SSHPASS="$VPS_PASS"
sshpass -e scp -P "$VPS_PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$script_path" "$VPS_USER@$VPS_HOST:/usr/local/bin/erdataye-deploy"

sshpass -e ssh -p "$VPS_PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$VPS_USER@$VPS_HOST" \
  "chmod +x /usr/local/bin/erdataye-deploy && /usr/local/bin/erdataye-deploy"
