"""Create staff-web-export.tar.gz from ./dist (same layout as GitHub Actions)."""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
ARCHIVE = ROOT / "staff-web-export.tar.gz"


def main() -> None:
    if not DIST.is_dir():
        raise SystemExit(f"Missing {DIST}; run: npx expo export --platform web")
    if ARCHIVE.exists():
        ARCHIVE.unlink()
    shutil.make_archive(str(ROOT / "staff-web-export"), "gztar", str(DIST))
    print(f"Wrote {ARCHIVE} ({ARCHIVE.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
