#!/usr/bin/env bash
set -euo pipefail

# Professional one-command deploy for Erdataye VPS.
# Deploys BOTH backend (Docker) and landing frontend from GitHub main.

REPO_URL="${REPO_URL:-https://github.com/dagimdesalegn/FYP_Erdataye-App.git}"
BRANCH="${BRANCH:-main}"
BASE_DIR="${BASE_DIR:-/opt/erdataye}"
RELEASES_DIR="${RELEASES_DIR:-$BASE_DIR/releases}"
SHARED_DIR="${SHARED_DIR:-$BASE_DIR/shared}"
BACKUP_DIR="${BACKUP_DIR:-$BASE_DIR/backups}"
WEB_ROOT="${WEB_ROOT:-/var/www/erdataya}"
APK_PUBLIC_DIR="${APK_PUBLIC_DIR:-$WEB_ROOT/downloads}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-erdataye-backend}"
BACKEND_IMAGE_PREFIX="${BACKEND_IMAGE_PREFIX:-erdataye-backend}"
LIVE_PORT_BIND="${LIVE_PORT_BIND:-127.0.0.1:9000:8000}"
CANARY_PORT_BIND="${CANARY_PORT_BIND:-127.0.0.1:9001:8000}"

wait_for_health() {
  local url="$1"
  local attempts="${2:-10}"
  local delay="${3:-2}"
  local i
  for i in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

for c in git docker curl rsync nginx systemctl; do
  need_cmd "$c"
done

mkdir -p "$RELEASES_DIR" "$SHARED_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
sha="$(git ls-remote "$REPO_URL" "refs/heads/$BRANCH" | awk '{print $1}' | head -n1)"
[[ -n "$sha" ]] || {
  echo "Failed to resolve commit SHA from $REPO_URL ($BRANCH)" >&2
  exit 1
}

short_sha="${sha:0:8}"
release_dir="$RELEASES_DIR/$short_sha"
image_tag="$BACKEND_IMAGE_PREFIX:$short_sha"
canary_container="$BACKEND_CONTAINER-canary-$short_sha"
deploy_backup_dir="$BACKUP_DIR/$timestamp"

echo "[1/8] Preparing release $short_sha"
if [[ ! -d "$release_dir" ]]; then
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$release_dir"
fi
echo "$sha" > "$BASE_DIR/current.sha"

echo "[2/8] Capturing runtime env"
env_file="$SHARED_DIR/backend.env"
existing_cid="$(docker ps -aqf "name=^/${BACKEND_CONTAINER}$" | head -n1 || true)"
if [[ -n "$existing_cid" ]]; then
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$existing_cid" > "$env_file"
fi
[[ -f "$env_file" ]] || {
  echo "No backend env file found at $env_file and no running container env to capture." >&2
  exit 1
}

echo "[3/8] Building backend image $image_tag"
docker build -t "$image_tag" "$release_dir/backend"

echo "[4/8] Starting canary container"
docker rm -f "$canary_container" >/dev/null 2>&1 || true
docker run -d --name "$canary_container" --restart unless-stopped --env-file "$env_file" -p "$CANARY_PORT_BIND" "$image_tag" >/dev/null

cleanup() {
  docker rm -f "$canary_container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[5/8] Canary health check"
if ! wait_for_health "http://127.0.0.1:9001/health" 12 2; then
  echo "Canary health check failed. Leaving current live container unchanged." >&2
  docker logs --tail 120 "$canary_container" || true
  exit 1
fi

echo "[6/8] Switching live backend container"
docker stop "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
docker rm "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$BACKEND_CONTAINER" --restart unless-stopped --env-file "$env_file" -p "$LIVE_PORT_BIND" "$image_tag" >/dev/null
wait_for_health "http://127.0.0.1:9000/health" 12 2

echo "[7/8] Deploying landing frontend"
mkdir -p "$deploy_backup_dir/landing"
mkdir -p "$APK_PUBLIC_DIR"
[[ -f "$WEB_ROOT/index.html" ]] && cp -a "$WEB_ROOT/index.html" "$deploy_backup_dir/landing/index.html" || true
[[ -f "$WEB_ROOT/styles.css" ]] && cp -a "$WEB_ROOT/styles.css" "$deploy_backup_dir/landing/styles.css" || true
[[ -f "$WEB_ROOT/app-update.json" ]] && cp -a "$WEB_ROOT/app-update.json" "$deploy_backup_dir/landing/app-update.json" || true
[[ -f "$APK_PUBLIC_DIR/erdataye.apk" ]] && cp -a "$APK_PUBLIC_DIR/erdataye.apk" "$deploy_backup_dir/landing/erdataye.apk" || true

rsync -av "$release_dir/website/landing/" "$WEB_ROOT/" >/dev/null

apk_source=""
if [[ -f "$release_dir/erdataye-release-build27.apk" ]]; then
  apk_source="$release_dir/erdataye-release-build27.apk"
elif [[ -f "$release_dir/erdataye-production.apk" ]]; then
  apk_source="$release_dir/erdataye-production.apk"
fi

if [[ -n "$apk_source" ]]; then
  cp -f "$apk_source" "$APK_PUBLIC_DIR/erdataye.apk"
  cp -f "$apk_source" "$WEB_ROOT/erdataye.apk"
else
  echo "WARNING: No APK artifact found in release root; keeping existing public APK." >&2
fi

# Enforce basic APK integrity so users do not receive a corrupted download.
apk_target="$APK_PUBLIC_DIR/erdataye.apk"
if [[ ! -f "$apk_target" ]]; then
  echo "ERROR: APK missing at $apk_target" >&2
  exit 1
fi
apk_size="$(wc -c < "$apk_target" | tr -d ' ')"
if [[ "${apk_size:-0}" -lt 1000000 ]]; then
  echo "ERROR: APK too small (${apk_size} bytes), refusing deployment." >&2
  exit 1
fi
python3 - "$apk_target" <<'PY'
import pathlib
import sys
p = pathlib.Path(sys.argv[1]).read_bytes()[:4]
raise SystemExit(0 if p.startswith(b"PK") else 1)
PY
cp -f "$apk_target" "$WEB_ROOT/erdataye.apk"

echo "$sha" > "$WEB_ROOT/.release-main-sha"

# Clean legacy duplicate nginx site links that reuse the same server_name values.
if [[ -d /etc/nginx/sites-enabled ]]; then
  for f in /etc/nginx/sites-enabled/*; do
    [[ -e "$f" ]] || continue
    base="$(basename "$f")"
    case "$base" in
      erdataye-site.conf|staff-dashboard.conf) continue ;;
    esac
    if grep -qE 'erdatayee\.tech|www\.erdatayee\.tech|staff\.erdatayee\.tech|admin\.erdatayee\.tech' "$f" 2>/dev/null; then
      rm -f "$f"
    fi
  done
fi

nginx -t >/dev/null
systemctl reload nginx

echo "[8/8] Cleanup + final checks"
curl -fsS --max-time 8 http://127.0.0.1:9000/health >/dev/null
curl -fsS --max-time 8 "http://127.0.0.1/api/health" -H "Host: erdatayee.tech" >/dev/null
curl -fsS --max-time 10 "http://127.0.0.1/downloads/erdataye.apk" -H "Host: erdatayee.tech" -o /tmp/erdataye.apk.check
test "$(wc -c </tmp/erdataye.apk.check | tr -d ' ')" -gt 1000000
rm -f /tmp/erdataye.apk.check

echo "Deploy completed"
echo "  SHA: $sha"
echo "  Image: $image_tag"
echo "  Backup: $deploy_backup_dir/landing"
