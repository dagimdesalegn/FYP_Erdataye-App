"""One-shot remote deploy: reads VPS_ROOT_PASS from env, never stores credentials."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "207.180.205.85")
USER = os.environ.get("VPS_USER", "root")
PASSWORD = os.environ.get("VPS_ROOT_PASS", "").strip()
REPO = os.environ.get("DEPLOY_REPO", "dagimdesalegn/FYP_Erdataye-App")
BRANCH = os.environ.get("DEPLOY_BRANCH", "main")

REMOTE = f"""set -euo pipefail
curl -fsSL -o /tmp/vps-deploy.sh "https://raw.githubusercontent.com/{REPO}/{BRANCH}/scripts/vps-deploy.sh"
chmod +x /tmp/vps-deploy.sh
exec /tmp/vps-deploy.sh
"""


def main() -> int:
    if not PASSWORD:
        print("VPS_ROOT_PASS environment variable is required.", file=sys.stderr)
        return 2
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            HOST,
            username=USER,
            password=PASSWORD,
            timeout=45,
            banner_timeout=45,
            auth_timeout=45,
        )
    except Exception as e:
        print(f"SSH connect failed: {e}", file=sys.stderr)
        return 1

    try:
        stdin, stdout, stderr = client.exec_command("bash -s", get_pty=True)
        stdin.write(REMOTE.encode("utf-8"))
        stdin.close()
        while True:
            line = stdout.readline()
            if line:
                sys.stdout.write(line)
                sys.stdout.flush()
            elif stdout.channel.exit_status_ready():
                break
        err = stderr.read().decode("utf-8", errors="replace")
        if err.strip():
            sys.stderr.write(err)
        rc = stdout.channel.recv_exit_status()
        return int(rc) if rc is not None else 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
