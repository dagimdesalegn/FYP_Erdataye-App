#!/usr/bin/env bash
set -euo pipefail
echo "=== [1/6] vps-deploy.sh (backend + landing from main) ==="
curl -fsSL -o /tmp/vps-deploy.sh "https://raw.githubusercontent.com/dagimdesalegn/FYP_Erdataye-App/main/scripts/vps-deploy.sh"
chmod +x /tmp/vps-deploy.sh
bash /tmp/vps-deploy.sh

echo "=== [2/6] Fresh APK from GitHub latest release ==="
python3 <<'PY'
import json, ssl, urllib.request
ctx = ssl.create_default_context()
req = urllib.request.Request(
    "https://api.github.com/repos/dagimdesalegn/FYP_Erdataye-App/releases/latest",
    headers={"User-Agent": "erdataye-vps-deploy"},
)
with urllib.request.urlopen(req, context=ctx, timeout=120) as resp:
    data = json.load(resp)
url = None
for a in data.get("assets") or []:
    if a.get("name") == "erdataye-release.apk":
        url = a.get("browser_download_url")
        break
if not url:
    raise SystemExit("Missing erdataye-release.apk on latest GitHub release")
print(url)
with open("/tmp/gh_apk_url.txt", "w") as f:
    f.write(url)
PY
URL="$(tr -d '\r\n' </tmp/gh_apk_url.txt)"
curl -fsSL "$URL" -o /tmp/erdataye-release-fresh.apk
SIZE="$(wc -c </tmp/erdataye-release-fresh.apk | tr -d ' ')"
test "$SIZE" -gt 1000000
python3 -c "import pathlib; p=pathlib.Path('/tmp/erdataye-release-fresh.apk').read_bytes()[:4]; raise SystemExit(0 if p.startswith(b'PK') else 1)"
mkdir -p /var/www/erdataya/downloads
install -D -m 0644 /tmp/erdataye-release-fresh.apk /var/www/erdataya/downloads/erdataye.apk
cp -f /tmp/erdataye-release-fresh.apk /var/www/erdataya/erdataye.apk
echo "APK bytes: $SIZE"

echo "=== [3/6] Install nginx vhosts from /tmp (uploaded by deploy client) ==="
for f in erdataye-site.conf staff-dashboard.conf; do
  test -f "/tmp/$f" || { echo "Missing /tmp/$f"; exit 1; }
  install -D -m 0644 "/tmp/$f" "/etc/nginx/sites-available/$f"
done
ln -sf /etc/nginx/sites-available/erdataye-site.conf /etc/nginx/sites-enabled/erdataye-site.conf
ln -sf /etc/nginx/sites-available/staff-dashboard.conf /etc/nginx/sites-enabled/staff-dashboard.conf

echo "=== [4/6] Staff web static (zip from client) ==="
test -f /tmp/staff-web-export.zip
mkdir -p /var/www/erdataya/staff
find /var/www/erdataya/staff -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
set +e
unzip -o /tmp/staff-web-export.zip -d /var/www/erdataya/staff
set -e
test -f /var/www/erdataya/staff/index.html

echo "=== [5/6] nginx test + reload ==="
nginx -t
systemctl reload nginx

echo "=== [6/6] Smoke curl ==="
set +o pipefail
curl -fsSI "https://erdatayee.tech/downloads/erdataye.apk" | head -n 15 || true
set -o pipefail
curl -fsS "https://erdatayee.tech/api/health" || true
echo "FULL_DEPLOY_OK"
