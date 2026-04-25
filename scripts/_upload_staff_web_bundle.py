"""Upload staff-web-export.tar.gz to VPS and extract to /var/www/erdataya/staff (like CI)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

HOST = os.environ.get("VPS_HOST", "207.180.205.85")
USER = os.environ.get("VPS_USER", "root")
PASSWORD = os.environ.get("VPS_ROOT_PASS", "").strip()
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TAR = ROOT / "staff-web-export.tar.gz"


def main() -> int:
    tar_path = Path(os.environ.get("STAFF_WEB_TAR", str(DEFAULT_TAR))).resolve()
    if not PASSWORD:
        print("Set VPS_ROOT_PASS", file=sys.stderr)
        return 2
    if not tar_path.is_file():
        print(f"Missing bundle: {tar_path}", file=sys.stderr)
        return 2

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            HOST,
            username=USER,
            password=PASSWORD,
            timeout=60,
            banner_timeout=60,
            auth_timeout=60,
        )
    except Exception as e:
        print(f"SSH failed: {e}", file=sys.stderr)
        return 1

    try:
        sftp = client.open_sftp()
        try:
            sftp.put(str(tar_path), "/tmp/staff-web-export.tar.gz")
        finally:
            sftp.close()

        cmd = r"""set -euo pipefail
mkdir -p /var/www/erdataya/staff
find /var/www/erdataya/staff -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
tar -xzf /tmp/staff-web-export.tar.gz -C /var/www/erdataya/staff
rm -f /tmp/staff-web-export.tar.gz
nginx -t
systemctl reload nginx
echo "Staff web deployed to /var/www/erdataya/staff"
"""
        stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
        stdin.close()
        for line in iter(stdout.readline, ""):
            if not line and stdout.channel.exit_status_ready():
                break
            if line:
                sys.stdout.write(line)
                sys.stdout.flush()
        err = stderr.read().decode("utf-8", errors="replace")
        if err.strip():
            sys.stderr.write(err)
        rc = stdout.channel.recv_exit_status()
        return int(rc) if rc else 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
